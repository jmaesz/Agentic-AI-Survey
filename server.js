const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
// Load local settings without a dependency; real process variables take precedence.
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const REQUESTS_PER_MINUTE = Math.max(1, Math.min(60, Number(process.env.OPENAI_REQUESTS_PER_MINUTE) || 10));
const MIN_REQUEST_INTERVAL_MS = 60_000 / REQUESTS_PER_MINUTE;
let lastApiRequestAt = 0;
let apiQueue = Promise.resolve();
const PUBLIC_FILES = new Map([["/", "index.html"], ["/index.html", "index.html"], ["/app.js", "app.js"], ["/styles.css", "styles.css"]]);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const send = (res, status, data) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(data));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4096) reject(new Error("Request too large"));
    });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}

function validate(answer) {
  if (!Number.isInteger(answer.wait_minutes) || answer.wait_minutes < 3 || answer.wait_minutes > 20) throw new Error("wait_minutes must be a whole number from 3 to 20");
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Request cancelled"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Request cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function generateResponse(agentIndex, signal) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw Object.assign(new Error("Server is missing OPENAI_API_KEY"), { retryable: false, status: 503 });
  const prompt = `Generate one SYNTHETIC answer from a hypothetical Singaporean commuter. This is not a real person's response or empirical data. Answer this survey question: "Imagine you are a Singaporean commuter taking Bus 96 between Clementi Bus Interchange and NUS. As a student or commuter with a schedule to follow, you value punctuality and would prefer to minimise unnecessary waiting time, especially when travelling to classes. While extremely short waiting times (e.g. 1–2 minutes) may be unrealistic due to practical bus operational constraints, you would still expect a reasonably frequent bus service. What is the waiting time you would consider comfortable and acceptable?" Return only a JSON object with one key, wait_minutes, containing a whole number from 3 to 20. Avoid unrealistic 1- or 2-minute answers and waits over 20 minutes. Vary the answer naturally across hypothetical commuters. This is agent ${agentIndex + 1}; make this answer independently plausible.`;
  const body = {
    model: MODEL,
    input: [
      { role: "system", content: "Generate synthetic survey responses only. Never imply a response came from a real person." },
      { role: "user", content: prompt },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "bus_wait_time_response",
        strict: true,
        schema: {
          type: "object",
          properties: { wait_minutes: { type: "integer" } },
          required: ["wait_minutes"],
          additionalProperties: false,
        },
      },
    },
    max_output_tokens: 64,
  };
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw Object.assign(new Error(error.message || "Could not connect to OpenAI"), { retryable: true, status: 503 });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || `OpenAI request failed (${response.status})`;
    const code = payload.error?.code || "";
    const outOfCredits = /insufficient_quota|billing_hard_limit_reached/i.test(`${code} ${message}`);
    const retryable = response.status === 408 || (response.status === 429 && !outOfCredits) || response.status >= 500;
    throw Object.assign(new Error(message), { retryable, status: response.status });
  }
  const content = (payload.output || []).flatMap((item) => item.content || []);
  const refusal = content.find((item) => item.type === "refusal")?.refusal;
  if (refusal) throw Object.assign(new Error(`OpenAI refused the request: ${refusal}`), { retryable: false, status: 422 });
  const text = content.filter((item) => item.type === "output_text").map((item) => item.text || "").join("");
  if (!text) throw Object.assign(new Error("OpenAI returned an empty response"), { retryable: true, status: 502 });
  let answer;
  try {
    answer = JSON.parse(text);
    validate(answer);
  } catch (error) {
    throw Object.assign(new Error(error.message || "OpenAI response was invalid"), { retryable: true, status: 502 });
  }
  return answer;
}

function enqueueApiResponse(agentIndex, signal) {
  const task = apiQueue.then(async () => {
    const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastApiRequestAt));
    if (wait) await sleep(wait, signal);
    if (signal.aborted) throw new Error("Request cancelled");
    lastApiRequestAt = Date.now();
    return generateResponse(agentIndex, signal);
  });
  apiQueue = task.catch(() => {});
  return task;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/api/status") return send(res, 200, { configured: Boolean(process.env.OPENAI_API_KEY), provider: "OpenAI", model: MODEL, requestsPerMinute: REQUESTS_PER_MINUTE });
  if (req.method === "POST" && url.pathname === "/api/respond") {
    const controller = new AbortController();
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    try {
      const data = await readBody(req);
      if (!Number.isInteger(data.agentIndex) || data.agentIndex < 0 || data.agentIndex >= 200) return send(res, 400, { error: "agentIndex must be from 0 to 199" });
      return send(res, 200, { response: await enqueueApiResponse(data.agentIndex, controller.signal) });
    } catch (error) {
      if (controller.signal.aborted) return;
      return send(res, error.status || 502, { error: error.message, retryable: Boolean(error.retryable) });
    }
  }
  if ((req.method === "GET" || req.method === "HEAD") && PUBLIC_FILES.has(url.pathname)) {
    const file = path.join(ROOT, PUBLIC_FILES.get(url.pathname));
    return fs.readFile(file, (error, content) => {
      if (error) return send(res, 404, { error: "Not found" });
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)], "X-Content-Type-Options": "nosniff" });
      if (req.method === "HEAD") return res.end();
      res.end(content);
    });
  }
  return send(res, req.method === "GET" || req.method === "HEAD" ? 404 : 405, { error: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => console.log(`Survey app ready at http://127.0.0.1:${PORT}`));
