# Multi-Agent Research System

This repository contains a Tavily web-search tool that can be used by a LangChain or LangGraph agent. It searches the web and returns up to five results with each result's title, URL, and a short content snippet.

## Requirements

- Python 3.10 or newer
- A Tavily API key

## Setup

Create and activate a virtual environment, then install the project dependencies:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create a `.env` file in the project directory and add your Tavily key:

```text
TAVILY_API_KEY=your_tavily_api_key
```

Keep the `.env` file private. It is excluded from Git by `.gitignore`.

## Run the search tool

Run the included example search from a terminal:

```powershell
python tools.py
```

The script prints the search results to the terminal. You can also import and invoke the tool from Python:

```python
from tools import web_search

results = web_search.invoke({"query": "recent advances in renewable energy"})
print(results)
```

## Dependencies

Dependencies are listed in [requirements.txt](requirements.txt), including LangChain, LangGraph, Tavily, and `python-dotenv`.
