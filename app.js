const $ = (selector) => document.querySelector(selector);
const questions = [
  { key: "wait_minutes", title: "Reasonable and acceptable bus waiting time (minutes)", numeric: true },
];
let responses = [];
let controller;
let requestsPerMinute = 10;

async function checkStatus() {
  const status = $("#api-status");
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    requestsPerMinute = data.requestsPerMinute || requestsPerMinute;
    status.textContent = data.configured ? `OpenAI is ready (${data.model}). Limited to ${requestsPerMinute} requests per minute; temporary failures retry automatically.` : "OpenAI API key is not configured. Set OPENAI_API_KEY and restart the server.";
    status.className = `hint ${data.configured ? "ready" : "error"}`;
    $("#run-button").disabled = !data.configured;
  } catch {
    status.textContent = "Start the local app server to connect to OpenAI.";
    status.className = "hint error";
    $("#run-button").disabled = true;
  }
}

function setProgress(done, total, message = "Preparing agents…") {
  $("#progress").max = total;
  $("#progress").value = done;
  $("#progress-count").textContent = `${done} / ${total}`;
  $("#progress-text").textContent = message;
}

async function runSurvey() {
  const count = Number($("#agent-count").value);
  responses = [];
  $("#results").hidden = true;
  $("#progress-wrap").hidden = false;
  $("#run-button").hidden = true;
  $("#stop-button").hidden = false;
  $("#agent-count").disabled = true;
  controller = new AbortController();
  let completed = 0, retryCount = 0, fatalError = "";
  setProgress(0, count, `Starting · up to ${requestsPerMinute} OpenAI requests per minute`);
  while (completed < count && !controller.signal.aborted) {
    const index = completed;
    let attempt = 0;
    while (!controller.signal.aborted) {
      try {
        const res = await fetch("/api/respond", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentIndex: index }), signal: controller.signal });
        const payload = await res.json();
        if (!res.ok) {
          const error = new Error(payload.error || `Request failed (${res.status})`);
          error.retryable = Boolean(payload.retryable);
          throw error;
        }
        responses[index] = { agent: index + 1, ...payload.response };
        completed++;
        setProgress(completed, count, `Agent ${completed} completed · continuing until all ${count} responses are collected`);
        break;
      } catch (error) {
        if (error.name === "AbortError" || controller.signal.aborted) break;
        if (error.retryable === false) {
          fatalError = error.message;
          controller.abort();
          break;
        }
        attempt++;
        retryCount++;
        const delay = Math.min(60_000, 2_000 * (2 ** Math.min(attempt - 1, 5)));
        setProgress(completed, count, `Temporary API issue · retrying agent ${index + 1} (attempt ${attempt}) in ${Math.ceil(delay / 1000)}s`);
        await new Promise((resolve) => {
          if (controller.signal.aborted) return resolve();
          const timer = setTimeout(done, delay);
          function done() { controller.signal.removeEventListener("abort", cancelled); resolve(); }
          function cancelled() { clearTimeout(timer); done(); }
          controller.signal.addEventListener("abort", cancelled, { once: true });
        });
      }
    }
  }
  const successful = responses.filter(Boolean);
  $("#stop-button").hidden = true;
  $("#run-button").hidden = false;
  $("#agent-count").disabled = false;
  if (fatalError) $("#progress-text").textContent = `Stopped: ${fatalError}`;
  else if (controller.signal.aborted) $("#progress-text").textContent = `Stopped by user · ${completed} responses collected`;
  else $("#progress-text").textContent = `Complete · ${completed} responses collected${retryCount ? ` after ${retryCount} retries` : ""}`;
  if (successful.length) renderResults(successful, count, fatalError ? `Stopped early: ${fatalError}` : controller.signal.aborted ? "Run stopped by user." : "");
}

function renderResults(rows, requested, runNote = "") {
  $("#results").hidden = false;
  $("#result-summary").textContent = `${rows.length} of ${requested} simulated agents responded. Percentages use successful responses only.${runNote ? ` ${runNote}` : ""}`;
  const waits = rows.map((r) => Number(r.wait_minutes)).filter(Number.isFinite);
  const avg = waits.reduce((sum, value) => sum + value, 0) / waits.length;
  const sorted = [...waits].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  $("#wait-stat").innerHTML = `<div><div class="eyebrow" style="color:#d4e2d6">BUS WAITING TIME</div><div class="big">${avg.toFixed(1)} min average acceptable wait</div><div class="caption">Across ${waits.length} successful agent responses</div></div><div class="small">Median ${median.toFixed(1)} min<br>Range ${Math.min(...waits)}–${Math.max(...waits)} min</div>`;
  $("#charts").innerHTML = makeWaitChart(waits);
  renderTable(rows);
}

function makeWaitChart(waits) {
  const minimum = Math.min(...waits), maximum = Math.max(...waits);
  const counts = new Map();
  for (let minute = minimum; minute <= maximum; minute++) counts.set(minute, waits.filter((value) => value === minute).length);
  const values = [...counts].map(([minute, count]) => ({ minute, count, pct: count / waits.length * 100 }));
  const height = 430, left = 58, right = 18, top = 28, bottom = 74, slot = 54;
  const width = Math.max(920, left + right + values.length * slot);
  const plotWidth = width - left - right, plotHeight = height - top - bottom, bottomY = top + plotHeight;
  const maxPct = Math.max(...values.map((item) => item.pct));
  const maxY = Math.max(10, Math.ceil(maxPct / 20) * 20);
  const barWidth = 30;
  const colors = ["#56bcc4", "#20a9d2", "#318bd6", "#efc94f", "#ee941e"];
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = maxY * (4 - index) / 4;
    const y = top + plotHeight * index / 4;
    return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="chart-gridline"/><text x="${left - 12}" y="${y + 4}" text-anchor="end" class="chart-axis-label">${value.toFixed(0)}%</text>`;
  }).join("");
  const bars = values.map((item, index) => {
    const barHeight = item.pct / maxY * plotHeight;
    const x = left + slot * index + (slot - barWidth) / 2;
    const y = bottomY - barHeight;
    const center = x + barWidth / 2;
    const valueY = Math.max(top + 13, y - 10);
    const label = `${item.minute} min`;
    const valueLabel = item.count ? `<text x="${center}" y="${valueY}" text-anchor="middle" class="chart-value-label">${item.pct.toFixed(0)}%</text>` : "";
    return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="${colors[index % colors.length]}"/>${valueLabel}<text x="${center}" y="${bottomY + 25}" text-anchor="middle" class="chart-category-label">${label}</text><text x="${center}" y="${bottomY + 47}" text-anchor="middle" class="chart-count-label">${item.count}</text>`;
  }).join("");
  return `<article class="chart wait-chart"><h3>Responses by exact waiting time</h3><p class="chart-caption">One-minute intervals · labels show percentage and response count</p><div class="chart-scroll"><svg viewBox="0 0 ${width} ${height}" style="width:${width}px;max-width:none" role="img" aria-label="Vertical bar chart showing one-minute waiting-time intervals from ${minimum} to ${maximum} minutes">${grid}<line x1="${left}" y1="${bottomY}" x2="${width - right}" y2="${bottomY}" class="chart-axis"/>${bars}</svg></div></article>`;
}

function renderTable(rows) {
  const headers = ["Agent", ...questions.map((q) => q.title)];
  const keys = ["agent", ...questions.map((q) => q.key)];
  $("#response-table").innerHTML = `<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${keys.map((key) => `<td>${escapeHtml(String(row[key] ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

function escapeHtml(value) { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function download(name, content, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}
function csvEscape(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

$("#run-button").addEventListener("click", runSurvey);
$("#stop-button").addEventListener("click", () => controller?.abort());
$("#download-json").addEventListener("click", () => download("agentic-ai-survey-responses.json", JSON.stringify({ simulated: true, responses: responses.filter(Boolean) }, null, 2), "application/json"));
$("#download-csv").addEventListener("click", () => {
  const keys = ["agent", ...questions.map((q) => q.key)];
  const rows = [keys, ...responses.filter(Boolean).map((r) => keys.map((key) => r[key]))];
  download("agentic-ai-survey-responses.csv", rows.map((row) => row.map(csvEscape).join(",")).join("\n"), "text/csv");
});
checkStatus();
