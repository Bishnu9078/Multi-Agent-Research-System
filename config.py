"""Environment-backed settings for the research backend."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


class ConfigurationError(ValueError):
    """Raised when required backend configuration is missing or invalid."""


@dataclass(frozen=True)
class Settings:
    groq_api_key: str = field(repr=False)
    tavily_api_key: str = field(repr=False)
    model_name: str = "openai/gpt-oss-120b"
    temperature: float = 0.0
    max_search_results: int = 5
    max_scraped_pages: int = 2
    request_timeout: float = 15.0
    max_page_bytes: int = 2_000_000
    max_page_chars: int = 8_000

    @classmethod
    def from_env(cls) -> "Settings":
        """Load settings from the process environment and the project .env file."""
        load_dotenv(Path(__file__).resolve().with_name(".env"))

        missing = [
            key
            for key in ("GROQ_API_KEY", "TAVILY_API_KEY")
            if not os.getenv(key, "").strip()
        ]
        if missing:
            names = ", ".join(missing)
            raise ConfigurationError(
                f"Missing required environment variable(s): {names}. "
                "Copy .env.example to .env and add valid API keys."
            )

        try:
            settings = cls(
                groq_api_key=os.environ["GROQ_API_KEY"].strip(),
                tavily_api_key=os.environ["TAVILY_API_KEY"].strip(),
                model_name=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b").strip(),
                temperature=float(os.getenv("LLM_TEMPERATURE", "0")),
                max_search_results=int(os.getenv("MAX_SEARCH_RESULTS", "5")),
                max_scraped_pages=int(os.getenv("MAX_SCRAPED_PAGES", "2")),
                request_timeout=float(os.getenv("REQUEST_TIMEOUT", "15")),
                max_page_bytes=int(os.getenv("MAX_PAGE_BYTES", "2000000")),
                max_page_chars=int(os.getenv("MAX_PAGE_CHARS", "8000")),
            )
        except ValueError as exc:
            raise ConfigurationError(
                "One or more numeric settings in .env have an invalid value."
            ) from exc

        if not settings.model_name:
            raise ConfigurationError("GROQ_MODEL must not be empty.")
        if not 0 <= settings.temperature <= 2:
            raise ConfigurationError("LLM_TEMPERATURE must be between 0 and 2.")
        if not 1 <= settings.max_search_results <= 10:
            raise ConfigurationError("MAX_SEARCH_RESULTS must be between 1 and 10.")
        if not 1 <= settings.max_scraped_pages <= 5:
            raise ConfigurationError("MAX_SCRAPED_PAGES must be between 1 and 5.")
        if settings.request_timeout <= 0:
            raise ConfigurationError("REQUEST_TIMEOUT must be greater than 0.")
        if settings.max_page_bytes <= 0 or settings.max_page_chars <= 0:
            raise ConfigurationError("Page size limits must be greater than 0.")

        return settings
