import fs from "node:fs/promises";
import path from "node:path";
import { escapeHtml } from "../../security/redactor.js";
import type { RunReport } from "../../types/index.js";

/**
 * Safely encodes JSON for inclusion inside an HTML `<script type="application/json">` block,
 * preventing `</script>` or HTML comment breakouts (XSS protection).
 */
export function safeJsonForHtml(data: unknown): string {
  return JSON.stringify(data)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export class HtmlReporter {
  render(report: RunReport, options?: { artifactBasePrefix?: string }): string {
    const prefix = options?.artifactBasePrefix ?? "";
    const embeddedReport = safeJsonForHtml({
      ...report,
      artifactBasePrefix: prefix,
    });

    const title = `OfflineLab Report (${escapeHtml(report.runId)})`;
    const passRate =
      report.summary.total > 0
        ? Math.round((report.summary.passed / report.summary.total) * 100)
        : 0;

    return `<!DOCTYPE html>
<html lang="en" data-theme="auto">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<style>
  :root {
    --bg: #f8fafc;
    --surface: #ffffff;
    --surface-2: #f1f5f9;
    --border: #cbd5e1;
    --text: #0f172a;
    --muted: #475569;
    --accent: #0f766e;
    --accent-soft: #ccfbf1;
    --pass: #15803d;
    --pass-bg: #dcfce7;
    --fail: #b91c1c;
    --fail-bg: #fee2e2;
    --warn: #a16207;
    --warn-bg: #fef9c3;
    --skip: #475569;
    --skip-bg: #e2e8f0;
    --focus: #2563eb;
    --radius: 8px;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    html[data-theme="auto"] {
      --bg: #0b1120;
      --surface: #111827;
      --surface-2: #1e293b;
      --border: #334155;
      --text: #f1f5f9;
      --muted: #94a3b8;
      --accent: #2dd4bf;
      --accent-soft: #134e4a;
      --pass: #4ade80;
      --pass-bg: #14532d;
      --fail: #f87171;
      --fail-bg: #7f1d1d;
      --warn: #facc15;
      --warn-bg: #713f12;
      --skip: #cbd5e1;
      --skip-bg: #334155;
      --focus: #60a5fa;
    }
  }
  html[data-theme="dark"] {
    --bg: #0b1120;
    --surface: #111827;
    --surface-2: #1e293b;
    --border: #334155;
    --text: #f1f5f9;
    --muted: #94a3b8;
    --accent: #2dd4bf;
    --accent-soft: #134e4a;
    --pass: #4ade80;
    --pass-bg: #14532d;
    --fail: #f87171;
    --fail-bg: #7f1d1d;
    --warn: #facc15;
    --warn-bg: #713f12;
    --skip: #cbd5e1;
    --skip-bg: #334155;
    --focus: #60a5fa;
  }
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
    font-size: 14px;
  }
  :focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; animation: none !important; }
  }
  .skip-link {
    position: absolute;
    left: -9999px;
    top: 0;
    background: var(--accent);
    color: #fff;
    padding: 8px 12px;
    z-index: 100;
  }
  .skip-link:focus { left: 8px; top: 8px; }
  header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 16px 24px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .brand { display: flex; flex-direction: column; gap: 2px; }
  .brand h1 { margin: 0; font-size: 20px; letter-spacing: -0.02em; }
  .brand p { margin: 0; color: var(--muted); font-size: 12px; }
  .header-meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
  button, select, input {
    font-family: inherit;
    font-size: 13px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 10px;
  }
  button { cursor: pointer; }
  button:hover { background: var(--surface-2); }
  nav[aria-label="Report sections"] {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 0 24px;
    display: flex;
    gap: 4px;
    overflow-x: auto;
  }
  .tab-btn {
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    background: transparent;
    padding: 10px 14px;
    font-weight: 600;
    color: var(--muted);
    white-space: nowrap;
  }
  .tab-btn[aria-selected="true"] {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  main { max-width: 1280px; margin: 0 auto; padding: 20px 24px 48px; }
  .panel { display: none; }
  .panel.active { display: block; }
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
  }
  .kpi {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px;
  }
  .kpi-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .kpi-value { font-size: 26px; font-weight: 700; margin-top: 4px; }
  .kpi-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
    margin-bottom: 16px;
  }
  .card h2, .card h3 { margin: 0 0 12px; font-size: 16px; }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .badge-passed { background: var(--pass-bg); color: var(--pass); }
  .badge-failed { background: var(--fail-bg); color: var(--fail); }
  .badge-skipped, .badge-unsupported { background: var(--skip-bg); color: var(--skip); }
  .badge-warning { background: var(--warn-bg); color: var(--warn); }
  .badge-info { background: var(--surface-2); color: var(--muted); }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 16px;
    align-items: center;
  }
  .filters label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
  .scenario-item {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    margin-bottom: 12px;
    overflow: hidden;
  }
  .scenario-header {
    width: 100%;
    text-align: left;
    border: none;
    border-radius: 0;
    padding: 14px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: var(--surface);
  }
  .scenario-header:hover { background: var(--surface-2); }
  .scenario-body {
    border-top: 1px solid var(--border);
    padding: 16px;
    background: var(--bg);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th, td {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  th { color: var(--muted); font-weight: 600; font-size: 12px; background: var(--surface-2); }
  code, pre { font-family: var(--mono); font-size: 12px; }
  pre {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px;
    overflow-x: auto;
    margin: 8px 0;
  }
  .bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .bar-label { width: 200px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { flex: 1; height: 14px; background: var(--surface-2); border-radius: 4px; overflow: hidden; border: 1px solid var(--border); }
  .bar-fill { height: 100%; background: var(--accent); }
  .bar-fill.failed { background: var(--fail); }
  .bar-val { width: 80px; text-align: right; font-family: var(--mono); font-size: 12px; color: var(--muted); }
  .timeline-list { list-style: none; padding: 0; margin: 0; }
  .timeline-item {
    display: grid;
    grid-template-columns: 90px 160px 1fr;
    gap: 12px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .screenshot-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
  }
  .screenshot-card {
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    background: var(--surface);
  }
  .screenshot-card img { width: 100%; height: 180px; object-fit: cover; display: block; border-bottom: 1px solid var(--border); }
  .screenshot-card .caption { padding: 8px 10px; font-size: 12px; color: var(--muted); }
  .two-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
  .empty { color: var(--muted); font-style: italic; padding: 12px 0; }
</style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to report content</a>
<header>
  <div class="brand">
    <h1>OfflineLab Report</h1>
    <p>Break the network. Not your app. &middot; Run <code>${escapeHtml(report.runId)}</code></p>
  </div>
  <div class="header-meta">
    <span>Generated: ${escapeHtml(report.completedAt)}</span>
    <span>Pass Rate: <strong>${passRate}%</strong></span>
    <button id="theme-toggle" type="button" aria-label="Toggle light and dark theme">Theme: Auto</button>
  </div>
</header>

<nav aria-label="Report sections" role="tablist">
  <button class="tab-btn" role="tab" aria-selected="true" aria-controls="panel-overview" id="tab-overview">Overview</button>
  <button class="tab-btn" role="tab" aria-selected="false" aria-controls="panel-scenarios" id="tab-scenarios">Scenarios (${report.summary.total})</button>
  <button class="tab-btn" role="tab" aria-selected="false" aria-controls="panel-timeline" id="tab-timeline">Network Timeline</button>
  <button class="tab-btn" role="tab" aria-selected="false" aria-controls="panel-requests" id="tab-requests">Request Explorer (${report.summary.totalRequests})</button>
  <button class="tab-btn" role="tab" aria-selected="false" aria-controls="panel-pwa" id="tab-pwa">PWA Inspector</button>
  <button class="tab-btn" role="tab" aria-selected="false" aria-controls="panel-artifacts" id="tab-artifacts">Artifacts (${report.artifacts.length})</button>
  <button class="tab-btn" role="tab" aria-selected="false" aria-controls="panel-diagnostics" id="tab-diagnostics">Diagnostics</button>
</nav>

<main id="main-content">
  <section id="panel-overview" class="panel active" role="tabpanel" aria-labelledby="tab-overview"></section>
  <section id="panel-scenarios" class="panel" role="tabpanel" aria-labelledby="tab-scenarios"></section>
  <section id="panel-timeline" class="panel" role="tabpanel" aria-labelledby="tab-timeline"></section>
  <section id="panel-requests" class="panel" role="tabpanel" aria-labelledby="tab-requests"></section>
  <section id="panel-pwa" class="panel" role="tabpanel" aria-labelledby="tab-pwa"></section>
  <section id="panel-artifacts" class="panel" role="tabpanel" aria-labelledby="tab-artifacts"></section>
  <section id="panel-diagnostics" class="panel" role="tabpanel" aria-labelledby="tab-diagnostics"></section>
</main>

<script id="offlinelab-data" type="application/json">${embeddedReport}</script>
<script>
(function () {
  const report = JSON.parse(document.getElementById("offlinelab-data").textContent || "{}");
  const prefix = report.artifactBasePrefix || "";

  function esc(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function fmtMs(ms) {
    if (ms === undefined || ms === null) return "-";
    if (ms >= 1000) return (ms / 1000).toFixed(2) + "s";
    return Math.round(ms) + "ms";
  }

  function badge(status) {
    const s = String(status || "info").toLowerCase();
    return '<span class="badge badge-' + esc(s) + '" aria-label="Status: ' + esc(s) + '">' + esc(s) + '</span>';
  }

  // Theme switcher
  const themeBtn = document.getElementById("theme-toggle");
  const themes = ["auto", "light", "dark"];
  let themeIdx = 0;
  themeBtn.addEventListener("click", function () {
    themeIdx = (themeIdx + 1) % themes.length;
    const t = themes[themeIdx];
    document.documentElement.setAttribute("data-theme", t);
    themeBtn.textContent = "Theme: " + t.charAt(0).toUpperCase() + t.slice(1);
  });

  // Tab navigation (accessible click + arrow keys)
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
  function activateTab(tab) {
    tabs.forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
    panels.forEach((p) => p.classList.toggle("active", p.id === tab.getAttribute("aria-controls")));
  }
  tabs.forEach((tab, idx) => {
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { tabs[(idx + 1) % tabs.length].focus(); activateTab(tabs[(idx + 1) % tabs.length]); }
      if (e.key === "ArrowLeft") { tabs[(idx - 1 + tabs.length) % tabs.length].focus(); activateTab(tabs[(idx - 1 + tabs.length) % tabs.length]); }
    });
  });

  const scenarios = report.scenarios || [];
  const summary = report.summary || {};
  const allProfiles = Array.from(new Set(scenarios.flatMap((s) => s.profilesUsed || [])));

  // 1. Overview
  const maxDur = Math.max(1, ...scenarios.map((s) => s.durationMs || 0));
  const durationBars = scenarios.map((s) => {
    const pct = Math.max(2, Math.round(((s.durationMs || 0) / maxDur) * 100));
    return '<div class="bar-row">' +
      '<div class="bar-label" title="' + esc(s.name) + '">' + esc(s.name) + ' (' + esc(s.browser) + ')</div>' +
      '<div class="bar-track" role="img" aria-label="' + esc(s.name) + ' took ' + fmtMs(s.durationMs) + '">' +
      '<div class="bar-fill ' + (s.status === "failed" ? "failed" : "") + '" style="width:' + pct + '%"></div></div>' +
      '<div class="bar-val">' + fmtMs(s.durationMs) + ' &middot; ' + esc(s.status) + '</div>' +
      '</div>';
  }).join("");

  const allReqs = scenarios.flatMap((s) => (s.requests || []).map((r) => ({ ...r, scenarioName: s.name, browser: s.browser })));
  const okReqs = allReqs.filter((r) => !r.failed).length;
  const injectedFailReqs = allReqs.filter((r) => r.injectedRuleId).length;
  const uninjectedFailReqs = allReqs.filter((r) => r.failed && !r.injectedRuleId).length;
  const maxReqBucket = Math.max(1, okReqs, injectedFailReqs, uninjectedFailReqs);

  document.getElementById("panel-overview").innerHTML =
    '<div class="kpi-grid">' +
      '<div class="kpi"><div class="kpi-label">Total Scenarios</div><div class="kpi-value">' + esc(summary.total) + '</div><div class="kpi-sub">Duration: ' + fmtMs(report.durationMs) + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Passed</div><div class="kpi-value" style="color:var(--pass)">' + esc(summary.passed) + '</div><div class="kpi-sub">Assertions passed: ' + esc(summary.passedAssertions) + (summary.flaky ? ' &middot; Flaky: ' + esc(summary.flaky) : '') + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Failed</div><div class="kpi-value" style="color:var(--fail)">' + esc(summary.failed) + '</div><div class="kpi-sub">Assertions failed: ' + esc(summary.failedAssertions) + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Skipped / Unsupported</div><div class="kpi-value">' + esc((summary.skipped || 0) + (summary.unsupported || 0)) + '</div><div class="kpi-sub">Unsupported: ' + esc(summary.unsupported || 0) + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Network Requests</div><div class="kpi-value">' + esc(summary.totalRequests) + '</div><div class="kpi-sub">Failed: ' + esc(summary.failedRequests) + ' &middot; Injected: ' + esc(summary.injectedFaults) + '</div></div>' +
    '</div>' +
    '<div class="two-col">' +
      '<div class="card"><h2>Scenario Duration Breakdown</h2>' + (durationBars || '<p class="empty">No scenarios executed.</p>') + '</div>' +
      '<div class="card"><h2>Request Outcome Distribution</h2>' +
        '<div class="bar-row"><div class="bar-label">Succeeded</div><div class="bar-track"><div class="bar-fill" style="width:' + Math.round((okReqs / maxReqBucket) * 100) + '%"></div></div><div class="bar-val">' + okReqs + '</div></div>' +
        '<div class="bar-row"><div class="bar-label">Injected Faults</div><div class="bar-track"><div class="bar-fill" style="width:' + Math.round((injectedFailReqs / maxReqBucket) * 100) + '%;background:var(--warn)"></div></div><div class="bar-val">' + injectedFailReqs + '</div></div>' +
        '<div class="bar-row"><div class="bar-label">Uninjected Failures</div><div class="bar-track"><div class="bar-fill failed" style="width:' + Math.round((uninjectedFailReqs / maxReqBucket) * 100) + '%"></div></div><div class="bar-val">' + uninjectedFailReqs + '</div></div>' +
        '<hr style="border:none;border-top:1px solid var(--border);margin:14px 0" />' +
        '<p><strong>Application:</strong> <code>' + esc(report.environment?.baseURL || "Configured per scenario") + '</code></p>' +
        '<p><strong>Browsers:</strong> ' + esc((report.environment?.browsers || []).join(", ")) + '</p>' +
        '<p><strong>Network Profiles Used:</strong> ' + esc(allProfiles.join(", ") || "online") + '</p>' +
        '<p><strong>Runtime:</strong> Node ' + esc(report.environment?.nodeVersion) + ' (' + esc(report.environment?.platform) + '/' + esc(report.environment?.arch) + ') &middot; Playwright ' + esc(report.environment?.playwrightVersion) + '</p>' +
      '</div>' +
    '</div>' +
    (report.notes && report.notes.length
      ? '<div class="card"><h2>Run Notes</h2><ul>' + report.notes.map((n) => '<li>' + esc(n) + '</li>').join("") + '</ul></div>'
      : '');

  // 2. Scenario Explorer
  const browsers = Array.from(new Set(scenarios.map((s) => s.browser)));
  const scenarioPanel = document.getElementById("panel-scenarios");
  scenarioPanel.innerHTML =
    '<div class="filters">' +
      '<label>Search<input id="sc-search" type="search" placeholder="Filter by name or description..." /></label>' +
      '<label>Status<select id="sc-status"><option value="all">All statuses</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="unsupported">Unsupported</option><option value="skipped">Skipped</option></select></label>' +
      '<label>Browser<select id="sc-browser"><option value="all">All browsers</option>' + browsers.map((b) => '<option value="' + esc(b) + '">' + esc(b) + '</option>').join("") + '</select></label>' +
    '</div><div id="sc-list"></div>';

  function renderScenarios() {
    const q = (document.getElementById("sc-search").value || "").toLowerCase();
    const st = document.getElementById("sc-status").value;
    const br = document.getElementById("sc-browser").value;
    const filtered = scenarios.filter((s) => {
      if (st !== "all" && s.status !== st) return false;
      if (br !== "all" && s.browser !== br) return false;
      if (q && !(s.name.toLowerCase().includes(q) || (s.description || "").toLowerCase().includes(q))) return false;
      return true;
    });

    const listEl = document.getElementById("sc-list");
    if (filtered.length === 0) {
      listEl.innerHTML = '<p class="empty">No scenarios match the current filter.</p>';
      return;
    }

    listEl.innerHTML = filtered.map((s, idx) => {
      const stepsHtml = (s.steps || []).length
        ? '<table><thead><tr><th>#</th><th>Action</th><th>Status</th><th>Duration</th><th>Details / Error</th></tr></thead><tbody>' +
          s.steps.map((stItem) => '<tr><td>' + (stItem.index + 1) + '</td><td><code>' + esc(stItem.action) + '</code></td><td>' + badge(stItem.status) + '</td><td>' + fmtMs(stItem.durationMs) + '</td><td>' + esc(stItem.error || (stItem.details ? JSON.stringify(stItem.details) : "")) + '</td></tr>').join("") +
          '</tbody></table>'
        : '<p class="empty">No steps recorded.</p>';

      const assertionsHtml = (s.assertions || []).length
        ? '<table><thead><tr><th>Assertion</th><th>Status</th><th>Elapsed</th><th>Message</th></tr></thead><tbody>' +
          s.assertions.map((a) => '<tr><td><code>' + esc(a.name) + '</code></td><td>' + badge(a.status) + '</td><td>' + fmtMs(a.elapsedMs) + '</td><td>' + esc(a.message || "") + '</td></tr>').join("") +
          '</tbody></table>'
        : '<p class="empty">No assertions recorded.</p>';

      const screenshots = (s.artifacts || []).filter((a) => a.type === "screenshot");
      const traces = (s.artifacts || []).filter((a) => a.type === "trace");

      return '<div class="scenario-item">' +
        '<button type="button" class="scenario-header" aria-expanded="' + (s.status === "failed" ? "true" : "false") + '" data-sc-idx="' + idx + '">' +
          '<div><strong>' + esc(s.name) + '</strong> <span style="color:var(--muted);font-size:12px">(' + esc(s.browser) + ' &middot; ' + esc(s.mode) + ')</span>' +
          (s.description ? '<div style="color:var(--muted);font-size:12px">' + esc(s.description) + '</div>' : '') + '</div>' +
          '<div style="display:flex;align-items:center;gap:10px"><span>' + fmtMs(s.durationMs) + '</span>' + badge(s.status) + '</div>' +
        '</button>' +
        '<div class="scenario-body" style="display:' + (s.status === "failed" ? "block" : "none") + '">' +
          (s.error ? '<pre role="alert"><strong>' + esc(s.error.name) + ':</strong> ' + esc(s.error.message) + '</pre>' : '') +
          '<h3>Steps</h3>' + stepsHtml +
          '<h3 style="margin-top:16px">Assertions</h3>' + assertionsHtml +
          (screenshots.length ? '<h3 style="margin-top:16px">Screenshots</h3><div class="screenshot-grid">' + screenshots.map((sc) => '<div class="screenshot-card"><a href="' + esc(prefix + sc.relativePath) + '" target="_blank"><img src="' + esc(prefix + sc.relativePath) + '" alt="' + esc(sc.name) + '" /></a><div class="caption">' + esc(sc.name) + '</div></div>').join("") + '</div>' : '') +
          (traces.length ? '<p style="margin-top:12px"><strong>Playwright Trace:</strong> ' + traces.map((t) => '<a href="' + esc(prefix + t.relativePath) + '">' + esc(t.relativePath) + '</a> (open with <code>npx playwright show-trace ' + esc(t.path) + '</code>)').join(", ") + '</p>' : '') +
        '</div>' +
      '</div>';
    }).join("");

    listEl.querySelectorAll(".scenario-header").forEach((btn) => {
      btn.addEventListener("click", () => {
        const body = btn.nextElementSibling;
        const expanded = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", String(!expanded));
        body.style.display = expanded ? "none" : "block";
      });
    });
  }
  document.getElementById("sc-search").addEventListener("input", renderScenarios);
  document.getElementById("sc-status").addEventListener("change", renderScenarios);
  document.getElementById("sc-browser").addEventListener("change", renderScenarios);
  renderScenarios();

  // 3. Network Timeline
  const timelinePanel = document.getElementById("panel-timeline");
  timelinePanel.innerHTML =
    '<div class="filters">' +
      '<label>Scenario<select id="tl-scenario"><option value="all">All scenarios</option>' + scenarios.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + ' (' + esc(s.browser) + ')</option>').join("") + '</select></label>' +
      '<label>Event Type<select id="tl-type"><option value="all">All events</option><option value="network">Network transitions</option><option value="fault">Injected faults</option><option value="request">Requests</option><option value="assertion">Assertions</option><option value="console">Console errors</option></select></label>' +
    '</div><div class="card"><ul class="timeline-list" id="tl-list"></ul></div>';

  function renderTimeline() {
    const scId = document.getElementById("tl-scenario").value;
    const typeFilter = document.getElementById("tl-type").value;
    const events = scenarios
      .filter((s) => scId === "all" || s.id === scId)
      .flatMap((s) => (s.events || []).map((e) => ({ ...e, scenarioName: s.name })))
      .filter((e) => typeFilter === "all" || e.type.startsWith(typeFilter));

    const ul = document.getElementById("tl-list");
    if (!events.length) {
      ul.innerHTML = '<li class="empty">No timeline events match this filter.</li>';
      return;
    }
    ul.innerHTML = events.slice(0, 600).map((e) =>
      '<li class="timeline-item">' +
        '<div><code>+' + fmtMs(e.elapsedMs) + '</code></div>' +
        '<div>' + badge(e.severity === "error" ? "failed" : e.severity === "warning" ? "warning" : "info") + ' <code>' + esc(e.type) + '</code></div>' +
        '<div><strong>' + esc(e.scenarioName) + '</strong> ' + esc(JSON.stringify(e.details || {})) + '</div>' +
      '</li>'
    ).join("");
  }
  document.getElementById("tl-scenario").addEventListener("change", renderTimeline);
  document.getElementById("tl-type").addEventListener("change", renderTimeline);
  renderTimeline();

  // 4. Request Explorer
  const reqPanel = document.getElementById("panel-requests");
  reqPanel.innerHTML =
    '<div class="filters">' +
      '<label>Filter URL<input id="req-search" type="search" placeholder="Filter redacted URLs..." /></label>' +
      '<label>Outcome<select id="req-outcome"><option value="all">All requests</option><option value="failed">Failed only</option><option value="injected">Injected faults only</option></select></label>' +
    '</div><div class="card" style="overflow-x:auto"><table><thead><tr><th>Scenario</th><th>Method</th><th>Redacted URL</th><th>Status</th><th>Duration</th><th>Failure / Fault</th></tr></thead><tbody id="req-body"></tbody></table></div>';

  function renderRequests() {
    const q = (document.getElementById("req-search").value || "").toLowerCase();
    const out = document.getElementById("req-outcome").value;
    const filtered = allReqs.filter((r) => {
      if (out === "failed" && !r.failed) return false;
      if (out === "injected" && !r.injectedRuleId) return false;
      if (q && !r.url.toLowerCase().includes(q)) return false;
      return true;
    });
    const tbody = document.getElementById("req-body");
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">No requests match this filter.</td></tr>';
      return;
    }
    tbody.innerHTML = filtered.slice(0, 500).map((r) =>
      '<tr>' +
        '<td>' + esc(r.scenarioName) + '</td>' +
        '<td><code>' + esc(r.method) + '</code></td>' +
        '<td style="word-break:break-all"><code>' + esc(r.url) + '</code></td>' +
        '<td>' + (r.status ? '<code>' + esc(r.status) + '</code>' : (r.failed ? badge("failed") : "-")) + (r.fromServiceWorker ? ' <span class="badge badge-info">SW</span>' : '') + '</td>' +
        '<td>' + fmtMs(r.durationMs) + '</td>' +
        '<td>' + esc(r.injectedFault ? ('Injected: ' + r.injectedFault + ' (' + r.injectedRuleId + ')') : (r.failureReason || "")) + '</td>' +
      '</tr>'
    ).join("");
  }
  document.getElementById("req-search").addEventListener("input", renderRequests);
  document.getElementById("req-outcome").addEventListener("change", renderRequests);
  renderRequests();

  // 5. PWA Inspector
  const pwaPanel = document.getElementById("panel-pwa");
  const pwaCards = scenarios.map((s) => {
    const sw = s.serviceWorker;
    const cache = s.cacheStorage;
    if (!sw && !cache) return "";
    return '<div class="card">' +
      '<h2>' + esc(s.name) + ' (' + esc(s.browser) + ')</h2>' +
      (sw ? '<p><strong>Service Worker Supported:</strong> ' + esc(sw.supported) + ' &middot; <strong>Controlled:</strong> ' + esc(sw.controlled) + (sw.controllerScriptURL ? ' &middot; <code>' + esc(sw.controllerScriptURL) + '</code>' : '') + '</p>' +
        (sw.registrations && sw.registrations.length
          ? '<table><thead><tr><th>Scope</th><th>Active</th><th>Waiting</th><th>Installing</th></tr></thead><tbody>' +
            sw.registrations.map((r) => '<tr><td><code>' + esc(r.scope) + '</code></td><td>' + esc(r.activeState || "-") + '</td><td>' + esc(r.waitingState || "-") + '</td><td>' + esc(r.installingState || "-") + '</td></tr>').join("") +
            '</tbody></table>'
          : '<p class="empty">No Service Worker registrations observed.</p>')
        : '') +
      (cache ? '<h3 style="margin-top:14px">Cache Storage (' + esc(cache.totalEntries) + ' entries)</h3>' +
        (cache.caches && cache.caches.length
          ? cache.caches.map((c) => '<p><strong>' + esc(c.name) + '</strong> (' + esc(c.entryCount) + ' entries)</p><pre>' + esc((c.entries || []).map((e) => (e.status || "-") + " " + e.url).join("\\n")) + '</pre>').join("")
          : '<p class="empty">No Cache Storage entries observed.</p>')
        : '') +
    '</div>';
  }).filter(Boolean).join("");
  pwaPanel.innerHTML = pwaCards || '<div class="card"><p class="empty">No Service Worker or Cache Storage observations captured in this run.</p></div>';

  // 6. Artifacts
  const artPanel = document.getElementById("panel-artifacts");
  const allScreenshots = (report.artifacts || []).filter((a) => a.type === "screenshot");
  const otherArts = (report.artifacts || []).filter((a) => a.type !== "screenshot");
  artPanel.innerHTML =
    '<div class="card"><h2>Screenshots (' + allScreenshots.length + ')</h2>' +
      (allScreenshots.length
        ? '<div class="screenshot-grid">' + allScreenshots.map((a) => '<div class="screenshot-card"><a href="' + esc(prefix + a.relativePath) + '" target="_blank"><img src="' + esc(prefix + a.relativePath) + '" alt="' + esc(a.name) + '" /></a><div class="caption"><strong>' + esc(a.name) + '</strong><br/>' + esc(a.relativePath) + '</div></div>').join("") + '</div>'
        : '<p class="empty">No screenshots captured.</p>') +
    '</div>' +
    '<div class="card"><h2>Traces &amp; Redacted Logs (' + otherArts.length + ')</h2>' +
      (otherArts.length
        ? '<table><thead><tr><th>Type</th><th>Name</th><th>Relative Path</th><th>Size</th></tr></thead><tbody>' +
          otherArts.map((a) => '<tr><td><code>' + esc(a.type) + '</code></td><td>' + esc(a.name) + '</td><td><a href="' + esc(prefix + a.relativePath) + '">' + esc(a.relativePath) + '</a></td><td>' + esc(a.sizeBytes ?? "-") + ' B</td></tr>').join("") +
          '</tbody></table>'
        : '<p class="empty">No traces or log files captured.</p>') +
    '</div>';

  // 7. Diagnostics
  const diagPanel = document.getElementById("panel-diagnostics");
  const allDiags = scenarios.flatMap((s) => (s.diagnostics || []).map((d) => ({ ...d, scenarioName: s.name, browser: s.browser })));
  diagPanel.innerHTML = allDiags.length
    ? allDiags.map((d) =>
        '<div class="card">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">' +
            '<strong>' + esc(d.title) + ': ' + esc(d.scenarioName) + ' (' + esc(d.browser) + ')</strong>' +
            badge(d.severity === "error" ? "failed" : d.severity) +
          '</div>' +
          '<p>' + esc(d.explanation) + '</p>' +
          '<p><strong>Suggested next step:</strong> ' + esc(d.suggestion) + '</p>' +
          (d.evidence && d.evidence.length ? '<pre>' + esc(d.evidence.join("\\n")) + '</pre>' : '') +
        '</div>'
      ).join("")
    : '<div class="card"><p class="empty">No diagnostic warnings or errors were recorded for this run.</p></div>';
})();
</script>
</body>
</html>
`;
  }

  async write(
    report: RunReport,
    outputPath: string,
    options?: { artifactBasePrefix?: string },
  ): Promise<string> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const html = this.render(report, options);
    await fs.writeFile(outputPath, html, "utf8");
    return outputPath;
  }
}
