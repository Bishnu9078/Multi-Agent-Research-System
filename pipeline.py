"""Orchestrate the multi-agent research workflow.

The public ``run_research_pipeline`` function returns plain Python data so the
backend can later be called from a CLI, API, or UI without coupling this module
to any frontend.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any

from config import ConfigurationError, Settings
from agents import (
    build_critic_chain,
    build_llm,
    build_reader_agent,
    build_search_agent,
    build_writer_chain,
)
from tools import read_page, search_web


class ResearchPipelineError(RuntimeError):
    """A stage-specific error suitable for callers and API handlers."""

    def __init__(self, stage: str, message: str) -> None:
        super().__init__(f"{stage.capitalize()} stage failed: {message}")
        self.stage = stage
        self.message = message


def _exception_detail(exc: Exception, settings: Settings) -> str:
    """Return useful provider detail without echoing configured API keys."""
    detail = str(exc).strip()
    for secret in (settings.groq_api_key, settings.tavily_api_key):
        if secret:
            detail = detail.replace(secret, "[redacted]")
    if not detail:
        detail = "No provider details were returned."
    return f"{type(exc).__name__}: {detail}"


def _message_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            str(block.get("text", "")) if isinstance(block, dict) else str(block)
            for block in content
        )
    return str(content)


def _tool_messages(response: dict[str, Any], tool_name: str) -> list[Any]:
    return [
        message
        for message in response.get("messages", [])
        if getattr(message, "name", None) == tool_name
    ]


def _parse_search_results(response: dict[str, Any]) -> list[dict[str, str]]:
    for message in _tool_messages(response, "web_search"):
        try:
            data = json.loads(_message_text(message.content))
        except (TypeError, json.JSONDecodeError):
            continue
        if isinstance(data, list):
            results = [
                {
                    "title": str(item.get("title", "Untitled source")),
                    "url": str(item.get("url", "")),
                    "content": str(item.get("content", "")),
                }
                for item in data
                if isinstance(item, dict) and item.get("url")
            ]
            if results:
                return results
    return []


def _parse_reader_results(
    response: dict[str, Any], allowed_urls: set[str]
) -> list[dict[str, str]]:
    call_urls: dict[str, str] = {}
    for message in response.get("messages", []):
        for call in getattr(message, "tool_calls", []) or []:
            if call.get("name") == "scrape_url":
                call_urls[str(call.get("id", ""))] = str(
                    (call.get("args") or {}).get("url", "")
                )

    scraped: list[dict[str, str]] = []
    seen: set[str] = set()
    for message in _tool_messages(response, "scrape_url"):
        url = call_urls.get(str(getattr(message, "tool_call_id", "")), "")
        content = _message_text(message.content).strip()
        if not url or url not in allowed_urls or not content:
            continue
        if content.startswith("Unable to scrape ") or url in seen:
            continue
        seen.add(url)
        scraped.append({"url": url, "content": content})
    return scraped


def _collect_scraped_content(
    search_results: list[dict[str, str]],
    llm: Any,
    settings: Settings,
    warnings: list[str],
) -> list[dict[str, str]]:
    sources = search_results[: settings.max_scraped_pages]
    allowed_urls = {source["url"] for source in sources}
    reader_agent = build_reader_agent(llm=llm)
    source_context = json.dumps(sources, ensure_ascii=False)
    try:
        reader_response = reader_agent.invoke(
            {
                "messages": [
                    (
                        "user",
                        "Read the most relevant source pages from the supplied search "
                        f"results. Call scrape_url for up to {settings.max_scraped_pages} "
                        "URLs, using only URLs from this list. Return a concise summary "
                        "for each page and identify its URL.\n\n"
                        f"Search results:\n{source_context}",
                    )
                ]
            }
        )
        scraped = _parse_reader_results(reader_response, allowed_urls)
    except Exception:
        scraped = []
        warnings.append("Reader agent could not complete; direct page reading was used.")

    if scraped:
        return scraped

    # Deterministic fallback keeps the pipeline useful if the model declines to
    # call its tool or the agent response does not include tool messages.
    for source in sources:
        try:
            content = read_page(source["url"], settings)
            scraped.append({"url": source["url"], "content": content})
        except Exception:
            continue
    if not scraped:
        warnings.append(
            "No source pages could be read; the writer will use search snippets only."
        )
    return scraped


def _format_research(
    search_results: list[dict[str, str]], scraped_content: list[dict[str, str]]
) -> str:
    search_text = "\n\n".join(
        f"Title: {source['title']}\nURL: {source['url']}\nSnippet: {source['content']}"
        for source in search_results
    )
    pages_text = "\n\n".join(
        f"URL: {page['url']}\nExtracted content:\n{page['content']}"
        for page in scraped_content
    )
    return (
        f"SEARCH RESULTS\n{search_text}\n\n"
        f"SCRAPED SOURCE CONTENT\n{pages_text or '(No source pages were readable.)'}"
    )


def _append_sources(report: str, search_results: list[dict[str, str]]) -> str:
    canonical_sources = "\n".join(
        f"{index}. [{source['title']}]({source['url']})"
        for index, source in enumerate(search_results, start=1)
    )
    return f"{report.rstrip()}\n\n## Sources\n{canonical_sources}"


def _extract_score(feedback: str) -> int | None:
    match = re.search(r"Score\s*:\s*(\d{1,2})\s*(?:/\s*10)?", feedback, re.IGNORECASE)
    if not match:
        return None
    score = int(match.group(1))
    return score if 1 <= score <= 10 else None


def run_research_pipeline(topic: str) -> dict[str, Any]:
    """Run search, reading, writing, and review stages for a research topic.

    Returns a JSON-friendly dictionary with the outputs from each stage. This
    function raises ``ConfigurationError`` for missing settings and
    ``ResearchPipelineError`` when a required stage cannot complete.
    """
    topic = topic.strip()
    if not topic:
        raise ValueError("Research topic must not be empty.")
    if len(topic) > 500:
        raise ValueError("Research topic must be 500 characters or fewer.")

    settings = Settings.from_env()
    warnings: list[str] = []
    state: dict[str, Any] = {"topic": topic}
    llm = build_llm(settings)

    try:
        search_agent = build_search_agent(llm=llm)
        search_response = search_agent.invoke(
            {
                "messages": [
                    (
                        "user",
                        f"Find recent, reliable sources with useful detail about: {topic}",
                    )
                ]
            }
        )
        search_results = _parse_search_results(search_response)
    except Exception:
        search_results = []
        warnings.append("Search agent could not complete; direct web search was used.")

    if not search_results:
        try:
            search_results = search_web(topic, settings)
        except Exception as exc:
            raise ResearchPipelineError(
                "search",
                "Could not retrieve web results. Check Tavily access and network access. "
                f"Provider error: {_exception_detail(exc, settings)}",
            ) from exc

    if not search_results:
        raise ResearchPipelineError("search", "No web results were returned for this topic.")
    state["search_results"] = search_results

    state["scraped_content"] = _collect_scraped_content(
        search_results, llm, settings, warnings
    )

    try:
        writer_chain = build_writer_chain(llm=llm)
        draft = writer_chain.invoke(
            {"topic": topic, "research": _format_research(search_results, state["scraped_content"])}
        )
        state["report"] = _append_sources(str(draft).strip(), search_results)
    except Exception as exc:
        raise ResearchPipelineError(
            "writer",
            "Could not generate the report. Check GROQ_MODEL and Groq API access. "
            f"Provider error: {_exception_detail(exc, settings)}",
        ) from exc

    try:
        critic_chain = build_critic_chain(llm=llm)
        state["feedback"] = str(critic_chain.invoke({"report": state["report"]})).strip()
        state["score"] = _extract_score(state["feedback"])
    except Exception as exc:
        raise ResearchPipelineError(
            "critic",
            "Could not review the report. Check GROQ_MODEL and Groq API access. "
            f"Provider error: {_exception_detail(exc, settings)}",
        ) from exc

    state["sources"] = search_results
    state["warnings"] = warnings
    return state


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Research a topic using Tavily search and Groq-powered agents."
    )
    parser.add_argument(
        "topic",
        nargs="?",
        help="The topic to research (if omitted, you will be prompted)",
    )
    args = parser.parse_args()

    topic = args.topic
    if topic is None:
        try:
            topic = input("Research topic: ").strip()
        except EOFError:
            topic = ""
    if not topic:
        print("Error: Research topic must not be empty.", file=sys.stderr)
        return 2

    try:
        result = run_research_pipeline(topic)
    except (ConfigurationError, ResearchPipelineError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(result["report"])
    print("\n## Critic Review\n")
    print(result["feedback"])
    if result["warnings"]:
        print("\nWarnings:")
        for warning in result["warnings"]:
            print(f"- {warning}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
