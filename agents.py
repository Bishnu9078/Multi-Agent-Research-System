"""Factories for the search, reader, writer, and critic components."""

from __future__ import annotations

from langchain.agents import create_agent
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_groq import ChatGroq

from config import Settings
from tools import scrape_url, web_search


SEARCH_SYSTEM_PROMPT = """You are the search agent in a research system.
For every request, call the web_search tool before answering. Use its live results
to identify relevant, recent sources. Keep source titles, URLs, and snippets intact.
Do not invent sources or claim that a source says something beyond its snippet."""

READER_SYSTEM_PROMPT = """You are the reader agent in a research system.
Use the scrape_url tool to read the most relevant URLs supplied by the search agent.
Read no more than the number of URLs requested. Summarize only information found in
the page text, and clearly identify which URL each summary came from."""

WRITER_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You are an expert research writer. Produce clear, structured, factual reports. "
            "Distinguish sourced facts from uncertainty and do not invent evidence.",
        ),
        (
            "human",
            """Write a detailed research report on the topic below.

Topic: {topic}

Research gathered:
{research}

Use these sections:
- Introduction
- Key Findings (at least 3 well-explained points when the evidence supports them)
- Conclusion

Use only the supplied research. Cite claims with source URLs where useful. Do not add a
Sources section; the backend adds the canonical source list after generation.""",
        ),
    ]
)

CRITIC_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You are a constructive research critic. Check factual support, clarity, "
            "coverage, and whether claims match the supplied sources.",
        ),
        (
            "human",
            """Review the report below. Give a score from 1 to 10 and specific feedback.

Report:
{report}

Respond in this format:
Score: X/10

Strengths:
- ...
- ...

Areas to Improve:
- ...
- ...

One line verdict:
...""",
        ),
    ]
)


def build_llm(settings: Settings | None = None) -> ChatGroq:
    """Create the configured Groq chat model without doing work at import time."""
    settings = settings or Settings.from_env()
    return ChatGroq(
        model=settings.model_name,
        api_key=settings.groq_api_key,
        temperature=settings.temperature,
        # Groq retries transient 429 rate limits; extra attempts help when a
        # run reaches the per-minute token limit between pipeline stages.
        max_retries=5,
    )


def build_search_agent(llm: ChatGroq | None = None, settings: Settings | None = None):
    """Build an agent that must use the live web search tool."""
    return create_agent(
        model=llm or build_llm(settings),
        tools=[web_search],
        system_prompt=SEARCH_SYSTEM_PROMPT,
    )


def build_reader_agent(llm: ChatGroq | None = None, settings: Settings | None = None):
    """Build an agent that reads selected source URLs with the scrape tool."""
    return create_agent(
        model=llm or build_llm(settings),
        tools=[scrape_url],
        system_prompt=READER_SYSTEM_PROMPT,
    )


def build_writer_chain(llm: ChatGroq | None = None, settings: Settings | None = None):
    """Build the report-writing chain."""
    return WRITER_PROMPT | (llm or build_llm(settings)) | StrOutputParser()


def build_critic_chain(llm: ChatGroq | None = None, settings: Settings | None = None):
    """Build the report-review chain."""
    return CRITIC_PROMPT | (llm or build_llm(settings)) | StrOutputParser()
