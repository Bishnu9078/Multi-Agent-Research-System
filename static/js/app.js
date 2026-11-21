"use strict";

const form = document.querySelector("#research-form");
const topicInput = document.querySelector("#topic-input");
const characterCount = document.querySelector("#character-count");
const submitButton = document.querySelector("#submit-button");
const loadingState = document.querySelector("#loading-state");
const errorBanner = document.querySelector("#error-banner");
const errorTitle = document.querySelector("#error-title");
const errorMessage = document.querySelector("#error-message");
const errorAction = document.querySelector("#error-action");
const errorTechnicalDetails = document.querySelector("#error-technical-details");
const errorTechnicalMessage = document.querySelector("#error-technical-message");
const resultsSection = document.querySelector("#results-section");
const copyButton = document.querySelector("#copy-button");
const downloadButton = document.querySelector("#download-button");
const themeToggle = document.querySelector("#theme-toggle");
const themeIcon = document.querySelector("#theme-icon");
const themeIconPath = themeIcon.querySelector("path");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const moonIconPath = "M16.2 12.7A7 7 0 0 1 7.3 3.8a7.1 7.1 0 1 0 8.9 8.9Z";
const sunIconPath = "M10 6.8a3.2 3.2 0 1 0 0 6.4a3.2 3.2 0 0 0 0-6.4M10 1.8v2m0 12.4v2m8.2-8.2h-2M3.8 10h-2m14-5.8-1.4 1.4m-8.8 8.8-1.4 1.4m11.6 0-1.4-1.4M5.6 5.6 4.2 4.2";

let latestResult = null;

function applyTheme(theme, savePreference = false) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  themeToggle.title = isDark ? "Switch to light mode" : "Switch to dark mode";
  themeIconPath.setAttribute("d", isDark ? sunIconPath : moonIconPath);
  if (themeColorMeta) themeColorMeta.content = isDark ? "#101411" : "#f6f7f3";

  if (savePreference) {
    try {
      localStorage.setItem("fieldnote-theme", isDark ? "dark" : "light");
    } catch {
      // Theme switching still works when browser storage is unavailable.
    }
  }
}

applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
themeToggle.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme, true);
});

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
    showError({
      title: "Add a research topic",
      message: "Enter a question or subject to start your research.",
    });
    topicInput.focus();
    return;
  }
  if (topic.length > 500) {
    showError({
      title: "Shorten your research topic",
      message: "Your topic is longer than the 500-character limit.",
      action: "Remove a few words, then try again.",
    });
    topicInput.focus();
    return;
  }

  setLoading(true);
  resultsSection.hidden = true;
  latestResult = null;
  copyButton.disabled = true;
  downloadButton.disabled = true;

  setLoading(true);
  try {
    let response;
    try {
      response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ topic }),
      });
    } catch (error) {
      showError({
        title: "Couldn’t reach the research server",
        message: "The request did not reach the server, so research could not start.",
        action: "Check your connection and confirm the research app is running, then try again.",
        technical: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
      return;
    }

    const parsed = await readApiResponse(response);
    if (!response.ok) {
      showError(describeApiFailure(response, parsed));
      return;
    }

    if (parsed.error || !isRecord(parsed.payload) || typeof parsed.payload.report !== "string" || !parsed.payload.report.trim()) {
      showError({
        title: "The research server returned an incomplete result",
        message: "The server responded, but the result was empty or in an unexpected format.",
        action: "Try again. If this keeps happening, check the server logs.",
        technical: formatResponseDetails(response, parsed),
      });
      return;
    }

    try {
      renderResults(parsed.payload);
    } catch (error) {
      showError({
        title: "We couldn’t display the research result",
        message: "The server returned a result, but the browser could not render it.",
        action: "Reload the page and try the research again.",
        technical: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
  } catch (error) {
    showError({
      title: "We couldn’t process the research response",
      message: "Something unexpected happened while reading the server response.",
      action: "Try again. If this keeps happening, check the server logs.",
      technical: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  } finally {
    setLoading(false);
  }
});

copyButton.addEventListener("click", async () => {
  if (!latestResult || typeof latestResult.report !== "string") return;
  try {
    await navigator.clipboard.writeText(latestResult.report);
    setButtonLabel(copyButton, "Copied");
  } catch (error) {
    showError({
      title: "Couldn’t copy the report",
      message: "Your browser did not allow clipboard access.",
      action: "Select the report text and copy it manually.",
      technical: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
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
  submitButton.querySelector("span").textContent = isLoading ? "Researching…" : "Generate report";
}

function showError(error) {
  const details = typeof error === "string" ? { message: error } : (error || {});
  errorTitle.textContent = details.title || "Research could not be completed";
  errorMessage.textContent = details.message || "An unexpected error occurred.";
  errorAction.textContent = details.action || "";
  errorAction.hidden = !details.action;
  errorTechnicalMessage.textContent = sanitizeTechnicalDetails(details.technical || "");
  errorTechnicalDetails.hidden = !details.technical;
  errorTechnicalDetails.open = false;
  errorBanner.hidden = false;
}

function hideError() {
  errorBanner.hidden = true;
  errorTitle.textContent = "Research could not be completed";
  errorMessage.textContent = "";
  errorAction.textContent = "";
  errorAction.hidden = true;
  errorTechnicalMessage.textContent = "";
  errorTechnicalDetails.hidden = true;
  errorTechnicalDetails.open = false;
}

function formatApiError(detail) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => {
      if (!item || typeof item !== "object") return "Invalid request.";
      const location = Array.isArray(item.loc) ? item.loc.filter((part) => part !== "body").join(" → ") : "";
      const message = typeof item.msg === "string" ? item.msg : "Invalid request.";
      return location ? `${location}: ${message}` : message;
    }).join(" ");
  }
  if (detail && typeof detail.message === "string") return detail.message;
  return "";
}

async function readApiResponse(response) {
  const contentType = response.headers.get("content-type") || "Not provided";
  const text = await response.text();
  if (!text.trim()) {
    return { payload: null, error: "The response body was empty.", contentType, preview: "" };
  }

  try {
    return { payload: JSON.parse(text), error: "", contentType, preview: "" };
  } catch {
    const isHtml = /text\/html/i.test(contentType) || /^\s*<!doctype html|^\s*<html/i.test(text);
    const preview = isHtml
      ? "HTML response body omitted."
      : text.trim().slice(0, 400);
    return { payload: null, error: "The response body was not valid JSON.", contentType, preview };
  }
}

function describeApiFailure(response, parsed) {
  const detail = formatApiError(parsed.payload && parsed.payload.detail).trim();
  const normalizedDetail = detail.toLowerCase();
  const technical = formatResponseDetails(response, parsed, detail);

  if (response.status === 422) {
    return {
      title: "Check your research topic",
      message: "The server could not accept this request.",
      action: "Review the topic and try again.",
      technical,
    };
  }
  if (response.status === 503) {
    return {
      title: "The research service needs configuration",
      message: "The server is missing a required setting or one of its settings is invalid.",
      action: "Check the server environment settings, including the Groq and Tavily keys. Keep key values private.",
      technical,
    };
  }
  if (response.status === 502 && /no web results/.test(normalizedDetail)) {
    return {
      title: "No sources were found",
      message: "The search service completed, but it did not return usable sources for this topic.",
      action: "Try a broader topic or use different wording.",
      technical,
    };
  }
  if (response.status === 502 && (/search stage failed|could not retrieve web results/.test(normalizedDetail))) {
    return {
      title: "Web search couldn’t be completed",
      message: "The research service could not retrieve search results.",
      action: "Check the server’s Tavily access and network connection, then try again.",
      technical,
    };
  }
  if (response.status === 502 && /writer stage failed|could not generate the report/.test(normalizedDetail)) {
    return {
      title: "The report couldn’t be written",
      message: "Search finished, but the AI service could not generate the report.",
      action: "Try again shortly. If it repeats, check the model setting, provider status, and usage limits.",
      technical,
    };
  }
  if (response.status === 502 && /critic stage failed|could not review the report/.test(normalizedDetail)) {
    return {
      title: "The report review couldn’t be completed",
      message: "The report was prepared, but the AI service could not finish its review.",
      action: "Try again shortly. If it repeats, check the model setting, provider status, and usage limits.",
      technical,
    };
  }
  if (response.status === 429) {
    return {
      title: "The research service is busy",
      message: "Too many requests were sent in a short time.",
      action: "Wait a little and try again.",
      technical,
    };
  }
  if (response.status >= 500) {
    return {
      title: "Something went wrong on the server",
      message: "The server could not complete this research request.",
      action: "Try again. If the problem continues, check the server logs; unexpected server details may only be available there.",
      technical,
    };
  }
  return {
    title: "The request couldn’t be completed",
    message: "The research service rejected the request.",
    action: "Review the technical details or try again.",
    technical,
  };
}

function formatResponseDetails(response, parsed, detail = "") {
  const lines = [`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`];
  lines.push(`Content-Type: ${parsed.contentType}`);
  if (detail) lines.push(detail);
  if (parsed.error) lines.push(parsed.error);
  if (parsed.preview) lines.push(`Response preview: ${parsed.preview}`);
  return lines.join("\n");
}

function sanitizeTechnicalDetails(value) {
  return String(value)
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(?:gsk_|tvly-)[A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
    .slice(0, 2400);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
