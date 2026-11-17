"""Search and page-reading tools used by the research agents."""

from __future__ import annotations

import argparse
import json
from typing import Any
from urllib.parse import urlsplit

import requests
from bs4 import BeautifulSoup
from langchain.tools import tool
from tavily import TavilyClient

from config import Settings


def search_web(query: str, settings: Settings | None = None) -> list[dict[str, str]]:
    """Return normalized Tavily results for a query."""
    normalized_query = query.strip()
    if not normalized_query:
        raise ValueError("Search query must not be empty.")

    settings = settings or Settings.from_env()
    client = TavilyClient(api_key=settings.tavily_api_key)
    response = client.search(
        query=normalized_query,
        max_results=settings.max_search_results,
        search_depth="advanced",
        include_answer=False,
    )

    results: list[dict[str, str]] = []
    for item in response.get("results", []):
        url = str(item.get("url", "")).strip()
        if not url:
            continue
        results.append(
            {
                "title": str(item.get("title", "Untitled source")).strip(),
                "url": url,
                "content": str(item.get("content", "")).strip(),
            }
        )
    return results


@tool
def web_search(query: str) -> str:
    """Search the live web and return source titles, URLs, and snippets as JSON."""
    return json.dumps(search_web(query), ensure_ascii=False)


def read_page(url: str, settings: Settings | None = None) -> str:
    """Fetch and extract readable text from an HTTP(S) page with size limits."""
    settings = settings or Settings.from_env()
    parsed = urlsplit(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Only absolute HTTP and HTTPS URLs can be scraped.")
    if parsed.username or parsed.password:
        raise ValueError("URLs containing embedded credentials cannot be scraped.")

    headers = {
        "User-Agent": "MultiAgentResearchSystem/1.0 (+research reader)",
        "Accept": "text/html,application/xhtml+xml",
    }
    with requests.get(
        url,
        headers=headers,
        timeout=settings.request_timeout,
        stream=True,
        allow_redirects=True,
    ) as response:
        response.raise_for_status()
        content_type = response.headers.get("Content-Type", "").lower()
        if content_type and "html" not in content_type and "xhtml" not in content_type:
            raise ValueError(f"The URL returned non-HTML content ({content_type}).")

        chunks: list[bytes] = []
        total_bytes = 0
        for chunk in response.iter_content(chunk_size=64_000):
            if not chunk:
                continue
            remaining = settings.max_page_bytes - total_bytes
            chunks.append(chunk[:remaining])
            total_bytes += min(len(chunk), remaining)
            if total_bytes >= settings.max_page_bytes or len(chunk) > remaining:
                break

        raw_html = b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")

    soup = BeautifulSoup(raw_html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "noscript"]):
        tag.decompose()

    text = soup.get_text(separator=" ", strip=True)
    if not text:
        raise ValueError("No readable text was found on the page.")
    return text[: settings.max_page_chars]


@tool
def scrape_url(url: str) -> str:
    """Scrape readable text from a public HTTP or HTTPS page URL."""
    try:
        return read_page(url)
    except (requests.RequestException, ValueError) as exc:
        return f"Unable to scrape {url}: {exc}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Search the web with the configured Tavily key.")
    parser.add_argument("query", help="The topic or question to search for")
    args = parser.parse_args()
    results: list[dict[str, Any]] = search_web(args.query)
    print(json.dumps(results, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
