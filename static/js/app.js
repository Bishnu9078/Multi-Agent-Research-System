"use strict";

const form = document.querySelector("#research-form");
const topicInput = document.querySelector("#topic-input");
const characterCount = document.querySelector("#character-count");
const submitButton = document.querySelector("#submit-button");
const loadingState = document.querySelector("#loading-state");
const errorBanner = document.querySelector("#error-banner");
const errorMessage = document.querySelector("#error-message");
const resultsSection = document.querySelector("#results-section");
const copyButton = document.querySelector("#copy-button");
const downloadButton = document.querySelector("#download-button");

let latestResult = null;

topicInput.addEventListener("input", () => {
  characterCount.textContent = String(topicInput.value.length);
});

document.querySelectorAll(".suggestion-chip").forEach((button) => {
  button.addEventListener("click", () => {
    topicInput.value = button.dataset.topic || "";
    topicInput.dispatchEvent(new Event("input", { bubbles: true }));
    topicInput.focus();
  });
});

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
  button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll(".tab-button")];
    const current = tabs.indexOf(button);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(current + direction + tabs.length) % tabs.length];
    next.focus();
    activateTab(next.dataset.tab);
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const topic = topicInput.value.trim();

  hideError();
  if (!topic) {
    showError("Enter a research topic to start.");
    topicInput.focus();
    return;
  }
  if (topic.length > 500) {
    showError("Keep the research topic to 500 characters or fewer.");
    topicInput.focus();
    return;
  }

  setLoading(true);
  resultsSection.hidden = true;
  latestResult = null;
  copyButton.disabled = true;
  downloadButton.disabled = true;

  try {
    const response = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ topic }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(formatApiError(payload.detail) || `The server returned HTTP ${response.status}.`);
    }
    renderResults(payload);
  } catch (error) {
    const message = error instanceof TypeError
      ? "Could not reach the local research server. Check that UI.py is running and try again."
      : (error instanceof Error ? error.message : "An unexpected error occurred.");
    showError(message);
  } finally {
    setLoading(false);
  }
});

copyButton.addEventListener("click", async () => {
  if (!latestResult || typeof latestResult.report !== "string") return;
  try {
    await navigator.clipboard.writeText(latestResult.report);
    setButtonLabel(copyButton, "Copied");
  } catch {
    showError("Clipboard access was unavailable. Select and copy the report text instead.");
  }
});

downloadButton.addEventListener("click", () => {
  if (!latestResult || typeof latestResult.report !== "string") return;
  const blob = new Blob([latestResult.report], { type: "text/markdown;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `${makeFileSlug(latestResult.topic || "research-report")}.md`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
});

document.querySelector("#new-research-button").addEventListener("click", () => {
  resultsSection.hidden = true;
  latestResult = null;
  topicInput.value = "";
  characterCount.textContent = "0";
  hideError();
  topicInput.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

function setLoading(isLoading) {
  loadingState.hidden = !isLoading;
  submitButton.disabled = isLoading;
  submitButton.querySelector("span").textContent = isLoading ? "Researching…" : "Research topic";
}

function showError(message) {
  errorMessage.textContent = message;
  errorBanner.hidden = false;
}

function hideError() {
  errorBanner.hidden = true;
  errorMessage.textContent = "";
}

function formatApiError(detail) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item && typeof item.msg === "string" ? item.msg : "Invalid request.").join(" ");
  }
  if (detail && typeof detail.message === "string") return detail.message;
  return "";
}

function renderResults(result) {
  latestResult = result;
  const sources = Array.isArray(result.sources)
    ? result.sources
    : (Array.isArray(result.search_results) ? result.search_results : []);
  const scraped = Array.isArray(result.scraped_content) ? result.scraped_content : [];
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const score = Number.isInteger(result.score) && result.score >= 1 && result.score <= 10
    ? result.score
    : null;

  document.querySelector("#result-topic").textContent = result.topic || topicInput.value.trim();
  document.querySelector("#score-metric").textContent = score === null ? "—" : `${score}/10`;
  document.querySelector("#review-score-value").textContent = score === null ? "—" : String(score);
  document.querySelector("#sources-metric").textContent = String(sources.length);
  document.querySelector("#pages-metric").textContent = String(scraped.length);
  document.querySelector("#warnings-metric").textContent = String(warnings.length);
  document.querySelector("#sources-tab-count").textContent = String(sources.length);

  renderFormattedText(document.querySelector("#report-content"), result.report || "No report was returned.");
  renderFormattedText(document.querySelector("#feedback-content"), result.feedback || "No critic feedback was returned.");
  renderSources(sources, scraped);
  renderWarnings(warnings);

  copyButton.disabled = typeof result.report !== "string" || result.report.length === 0;
  downloadButton.disabled = copyButton.disabled;
  setButtonLabel(copyButton, "Copy");
  activateTab("report");
  hideError();
  resultsSection.hidden = false;
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSources(sources, scrapedPages) {
  const list = document.querySelector("#sources-list");
  list.replaceChildren();

  if (sources.length === 0) {
    list.append(makeEmptyMessage("No search sources were returned."));
    return;
  }

  const pageByUrl = new Map();
  scrapedPages.forEach((page) => {
    if (page && typeof page.url === "string") pageByUrl.set(page.url, page.content || "");
  });

  sources.forEach((source, index) => {
    const card = document.createElement("article");
    card.className = "source-card";

    const header = document.createElement("div");
    header.className = "source-card-header";
    const number = document.createElement("span");
    number.className = "source-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const titleWrap = document.createElement("div");
    titleWrap.className = "source-title-wrap";
    const title = document.createElement("h4");
    title.className = "source-title";
    title.textContent = typeof source.title === "string" && source.title.trim()
      ? source.title
      : "Untitled source";
    titleWrap.append(title);

    const sourceUrl = safeHttpUrl(source.url);
    if (sourceUrl) {
      const link = document.createElement("a");
      link.className = "source-url";
      link.href = sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = source.url;
      link.setAttribute("aria-label", `Open source: ${source.title || source.url}`);
      titleWrap.append(link);
    } else {
      const invalidUrl = document.createElement("span");
      invalidUrl.className = "source-url";
      invalidUrl.textContent = "Source URL unavailable";
      titleWrap.append(invalidUrl);
    }

    header.append(number, titleWrap);
    card.append(header);

    if (typeof source.content === "string" && source.content.trim()) {
      const snippet = document.createElement("p");
      snippet.className = "source-snippet";
      snippet.textContent = source.content;
      card.append(snippet);
    }

    const pageText = typeof source.url === "string" ? pageByUrl.get(source.url) : "";
    const details = document.createElement("details");
    details.className = "source-details";
    const summary = document.createElement("summary");
    summary.textContent = pageText ? "Show extracted page text" : "Page text unavailable";
    details.append(summary);
    if (pageText) {
      const pre = document.createElement("pre");
      pre.textContent = pageText;
      details.append(pre);
    }
    card.append(details);
    list.append(card);
  });
}

function renderWarnings(warnings) {
  const panel = document.querySelector("#warnings-panel");
  const list = document.querySelector("#warnings-list");
  list.replaceChildren();
  panel.hidden = warnings.length === 0;
  warnings.forEach((warning) => {
    const item = document.createElement("li");
    item.textContent = typeof warning === "string" ? warning : String(warning);
    list.append(item);
  });
}

function renderFormattedText(container, markdown) {
  container.replaceChildren();
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  let activeList = null;
  let activeListType = "";

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      activeList = null;
      activeListType = "";
      return;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      activeList = null;
      activeListType = "";
      const level = Math.min(4, heading[1].length);
      const element = document.createElement(`h${level}`);
      appendInlineContent(element, heading[2]);
      container.append(element);
      return;
    }

    const listItem = trimmed.match(/^(?:([-*])|(\d+\.))\s+(.+)$/);
    if (listItem) {
      const listType = listItem[2] ? "ol" : "ul";
      if (!activeList || activeListType !== listType) {
        activeList = document.createElement(listType);
        activeListType = listType;
        container.append(activeList);
      }
      const item = document.createElement("li");
      appendInlineContent(item, listItem[3]);
      activeList.append(item);
      return;
    }

    activeList = null;
    activeListType = "";
    const paragraph = document.createElement("p");
    appendInlineContent(paragraph, trimmed);
    container.append(paragraph);
  });
}

function appendInlineContent(parent, text) {
  const tokenPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*(.+?)\*\*/g;
  let cursor = 0;
  let match;

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > cursor) parent.append(document.createTextNode(text.slice(cursor, match.index)));
    if (match[1] !== undefined) {
      const url = safeHttpUrl(match[2]);
      if (url) {
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = match[1];
        parent.append(link);
      } else {
        parent.append(document.createTextNode(match[0]));
      }
    } else {
      const strong = document.createElement("strong");
      strong.textContent = match[3];
      parent.append(strong);
    }
    cursor = tokenPattern.lastIndex;
  }
  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
}

function safeHttpUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function makeEmptyMessage(message) {
  const paragraph = document.createElement("p");
  paragraph.className = "empty-message";
  paragraph.textContent = message;
  return paragraph;
}

function activateTab(name) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== name;
  });
}

function setButtonLabel(button, label) {
  const span = button.querySelector("span");
  if (span) span.textContent = label;
}

function makeFileSlug(value) {
  const slug = String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "research-report";
}

activateTab("report");
