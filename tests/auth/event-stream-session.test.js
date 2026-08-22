const test = require("node:test");
const assert = require("node:assert/strict");
const { eventStreamSessionRecheckMs, DEFAULT_EVENT_STREAM_SESSION_RECHECK_MS } = require("../../server/events/routes");

const runId = process.env.PATAP_TEST_RUN_ID;
const baseUrl = process.env.PATAP_AUTH_BASE_URL;
if (!runId || !baseUrl || !process.env.PATAP_DB_PATH || !process.env.PATAP_AUTH_SECRET_PATH) {
  throw new Error("Auth tests must be started through scripts/run-auth-tests.js");
}

let sequence = 0;

class Client {
  constructor() {
    this.cookies = {};
    this.csrfToken = null;
    this.clientIp = `203.0.113.${140 + (++sequence % 80)}`;
  }

  cookieHeader() {
    return Object.entries(this.cookies).map(([key, value]) => `${key}=${value}`).join("; ");
  }

  storeCookies(headers) {
    for (const value of headers.getSetCookie ? headers.getSetCookie() : []) {
      const [pair] = value.split(";");
      const at = pair.indexOf("=");
      const key = pair.slice(0, at);
      const raw = pair.slice(at + 1);
      if (raw === "") delete this.cookies[key];
      else this.cookies[key] = raw;
    }
  }

  headers(extra = {}) {
    const headers = {
      Origin: "http://127.0.0.1:8090",
      "CF-Connecting-IP": this.clientIp,
      ...extra
    };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    if (this.csrfToken) headers["X-CSRF-Token"] = this.csrfToken;
    return headers;
  }

  async request(pathname, options = {}) {
    const headers = this.headers({ Accept: "application/json", ...(options.headers || {}) });
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    this.storeCookies(response.headers);
    const data = await response.json().catch(() => ({}));
    if (data.csrfToken) this.csrfToken = data.csrfToken;
    return { response, data };
  }
}

async function createDriver() {
  const client = new Client();
  const suffix = `${Date.now().toString(36)}_${sequence}_${String(runId).slice(-5)}`;
  const username = `sse_${suffix}`.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 32);
  const nickname = `SSE_${suffix}`.slice(0, 32);
  let result = await client.request("/api/csrf");
  assert.equal(result.response.status, 200);
  result = await client.request("/api/register", {
    method: "POST",
    body: {
      username,
      email: `${username}@patap.test`,
      password: "event-stream-123",
      confirmPassword: "event-stream-123"
    }
  });
  assert.equal(result.response.status, 201);
  result = await client.request("/api/driver/profile", {
    method: "PUT",
    body: { nickname, driverType: "TIR", countryCode: "PL", vehicle: "SSE Test" }
  });
  assert.ok([200, 201].includes(result.response.status));
  return client;
}

async function readUntil(reader, pattern, timeoutMs = 3000) {
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const chunk = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("sse_read_timeout")), remaining))
    ]);
    if (chunk.done) break;
    text += Buffer.from(chunk.value || []).toString("utf8");
    if (pattern.test(text)) return text;
  }
  assert.match(text, pattern);
  return text;
}

async function expectClosed(reader, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const chunk = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("sse_close_timeout")), remaining))
    ]);
    if (chunk.done) return;
  }
  assert.fail("Revoked Event Center SSE stream stayed open");
}

test("Event stream session recheck interval stays bounded", () => {
  assert.equal(eventStreamSessionRecheckMs("10"), 250);
  assert.equal(eventStreamSessionRecheckMs("15000"), 15000);
  assert.equal(eventStreamSessionRecheckMs("999999"), 60000);
  assert.equal(eventStreamSessionRecheckMs("invalid"), DEFAULT_EVENT_STREAM_SESSION_RECHECK_MS);
});

test("Event Center SSE closes after the established session is revoked", async () => {
  const client = await createDriver();
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/driver/events/stream`, {
    headers: client.headers({ Accept: "text/event-stream" }),
    signal: controller.signal
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  try {
    await readUntil(reader, /event\.ready/);
    const logout = await client.request("/api/logout", { method: "POST", body: {} });
    assert.equal(logout.response.status, 200);
    await expectClosed(reader);
  } finally {
    controller.abort();
  }
});
