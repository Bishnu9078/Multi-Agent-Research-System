"""FastAPI web interface for the multi-agent research backend."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

from config import ConfigurationError
from pipeline import ResearchPipelineError, run_research_pipeline


logger = logging.getLogger(__name__)
PROJECT_DIR = Path(__file__).resolve().parent
STATIC_DIR = PROJECT_DIR / "static"

app = FastAPI(
    title="Multi-Agent Research System",
    description="Research a topic with Tavily, BeautifulSoup, and Groq-powered agents.",
    version="1.0.0",
)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


class ResearchRequest(BaseModel):
    """Validated request body for a research run."""

    topic: str

    @field_validator("topic")
    @classmethod
    def normalize_topic(cls, value: str) -> str:
        topic = value.strip()
        if not topic:
            raise ValueError("Enter a research topic.")
        if len(topic) > 500:
            raise ValueError("Research topic must be 500 characters or fewer.")
        return topic


@app.get("/", include_in_schema=False)
def home() -> FileResponse:
    """Serve the single-page research interface."""
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health", include_in_schema=False)
def health() -> dict[str, str]:
    """Expose a lightweight health check for the local web server."""
    return {"status": "ok"}


@app.post("/api/research")
def research(request: ResearchRequest) -> dict[str, Any]:
    """Run the existing synchronous pipeline in FastAPI's worker thread pool."""
    try:
        return run_research_pipeline(request.topic)
    except ConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ResearchPipelineError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected error while running the research pipeline")
        raise HTTPException(
            status_code=500,
            detail="An unexpected server error occurred. Check the UI terminal logs.",
        ) from exc
