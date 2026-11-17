# Multi-Agent Research System (Backend)

A Python research system that searches the live web with Tavily, reads selected source pages, writes a sourced report with Groq, and asks a critic chain to review and score it. The pipeline is available as a Python function, a command-line entry point, and a FastAPI-served HTML/CSS/JavaScript interface.

The search and reader agents use LangChain's tool-calling agent loop (ReAct-style). The report writer and critic are LCEL pipelines composed from prompts, the Groq chat model, and string output parsers. Tavily provides search results; BeautifulSoup extracts readable text from selected pages.

## Requirements

- Python 3.10 or newer
- A Groq API key
- A Tavily API key

## Setup

From the project directory, create and activate a virtual environment, then install the dependencies:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Create a local `.env` file from the example and add valid API keys:

```powershell
Copy-Item .env.example .env
```

Set `GROQ_API_KEY` and `TAVILY_API_KEY` in `.env`. The remaining settings are optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Groq chat model used by the agents and LCEL runnables |
| `LLM_TEMPERATURE` | `0` | Model temperature, from 0 to 2 |
| `MAX_SEARCH_RESULTS` | `5` | Search results to retrieve, from 1 to 10 |
| `MAX_SCRAPED_PAGES` | `2` | Search result pages to read, from 1 to 5 |
| `REQUEST_TIMEOUT` | `15` | Page request timeout in seconds |
| `MAX_PAGE_BYTES` | `2000000` | Maximum HTML downloaded per page |
| `MAX_PAGE_CHARS` | `8000` | Maximum extracted text retained per page |

`.env` is excluded from Git. Do not commit API keys.

## Run the full pipeline

```powershell
python pipeline.py "How are heat pumps changing home energy use?"
```

If you omit the topic, the CLI prompts for one:

```powershell
python pipeline.py
```

The pipeline runs four stages:

1. The search agent retrieves current sources with Tavily.
2. The reader agent scrapes selected result pages. If the agent does not call its tool, the backend tries direct page reading.
3. The writer chain produces an introduction, key findings, conclusion, and a canonical source list.
4. The critic chain reviews the report and returns a score and feedback.

The backend returns stage data as a JSON-friendly dictionary, so another Python application can call it without invoking the CLI:

```python
from pipeline import run_research_pipeline

result = run_research_pipeline("How are heat pumps changing home energy use?")
print(result["report"])
print(result["score"])
print(result["sources"])
```

The returned dictionary contains `topic`, `search_results`, `scraped_content`, `report`, `feedback`, `score`, `sources`, and `warnings`. Missing API keys and stage failures raise clear configuration or pipeline exceptions.

## Run the web UI

Install the dependencies if you have not already, then start the local FastAPI server:

```powershell
python -m pip install -r requirements.txt
python -m uvicorn UI:app --reload
```

Open <http://127.0.0.1:8000>. The interface calls `POST /api/research` and displays the report, critic score and feedback, source snippets, extracted page text, and pipeline warnings. The `/health` endpoint returns the local server status. API keys remain in the Python process and are never sent to the browser.

The static interface files are `static/index.html`, `static/css/styles.css`, and `static/js/app.js`.

## Run the search tool by itself

```powershell
python tools.py "recent advances in renewable energy"
```

## Backend modules

- `config.py` loads and validates environment settings.
- `tools.py` provides Tavily search and bounded HTML extraction tools.
- `agents.py` builds the search and reader agents plus writer and critic chains.
- `pipeline.py` coordinates the workflow and exposes the backend function.
