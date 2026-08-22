const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");

const runId = process.env.PATAP_TEST_RUN_ID;
const baseUrl = process.env.PATAP_AUTH_BASE_URL;
const dbPath = process.env.PATAP_DB_PATH;
if (!runId || !baseUrl || !dbPath || !process.env.PATAP_AUTH_SECRET_PATH) {
  throw new Error("Auth tests must be started through scripts/run-auth-tests.js");
}

class Client {
  constructor() {
    this.cookies = {};
    this.csrfToken = null;
  }

  cookieHeader() {
    return Object.entries(this.cookies).map(([key, value]) => `${key}=${value}`).join("; ");
  }

  storeCookies(headers) {
    for (const value of headers.getSetCookie ? headers.getSetCookie() : []) {
      const [pair] = value.split(";");
      const index = pair.indexOf("=");
      const key = pair.slice(0, index);
      const raw = pair.slice(index + 1);
      if (raw === "") delete this.cookies[key];
      else this.cookies[key] = raw;
    }
  }

  async request(pathname, options = {}) {
    const headers = {
      Accept: "application/json",
      Origin: "http://127.0.0.1:8090",
      "CF-Connecting-IP": "203.0.113.206",
      ...(options.headers || {})
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (this.csrfToken) headers["X-CSRF-Token"] = this.csrfToken;
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
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

  csrf() {
    return this.request("/api/csrf");
  }
}

function activity(db, userId) {
  const session = db.prepare(`
    SELECT id, last_seen_at, revoked_at
    FROM sessions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId);
  const user = db.prepare("SELECT last_seen_at FROM users WHERE id = ?").get(userId);
  return {
    sessionId: session.id,
    sessionLastSeenAt: session.last_seen_at,
    userLastSeenAt: user.last_seen_at,
    revokedAt: session.revoked_at
  };
}

test("session activity writes are throttled while expiry and revoke checks stay immediate", async () => {
  const client = new Client();
  const suffix = String(runId).slice(-8).toLowerCase().replace(/[^a-z0-9]/g, "x");
  const username = `touch_${suffix}`.slice(0, 32);

  await client.csrf();
  let result = await client.request("/api/register", {
    method: "POST",
    body: {
      username,
      email: `${username}@patap.test`,
      password: "touch-test-123",
      confirmPassword: "touch-test-123"
    }
  });
  assert.equal(result.response.status, 201);
  const userId = Number(result.data.user.id);

  // The first authenticated read initializes users.last_seen_at for a newly
  // registered account. Everything after this point is measured from a
  // stable baseline inside the one-minute touch window.
  result = await client.request("/api/session");
  assert.equal(result.response.status, 200);
  assert.equal(result.data.user.username, username);

  const db = new DatabaseSync(dbPath);
  try {
    const baseline = activity(db, userId);
    assert.ok(baseline.sessionLastSeenAt);
    assert.ok(baseline.userLastSeenAt);

    for (let index = 0; index < 8; index += 1) {
      result = await client.request(index % 2 === 0 ? "/api/session" : "/api/driver/profile");
      assert.equal(result.response.status, 200);
    }

    const withinWindow = activity(db, userId);
    assert.equal(withinWindow.sessionLastSeenAt, baseline.sessionLastSeenAt,
      "session timestamp must not be rewritten inside the touch window");
    assert.equal(withinWindow.userLastSeenAt, baseline.userLastSeenAt,
      "user timestamp must not be rewritten inside the touch window");

    const staleAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(staleAt, baseline.sessionId);
    db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(staleAt, userId);

    const beforeTouchMs = Date.now();
    result = await client.request("/api/session");
    assert.equal(result.response.status, 200);
    const touched = activity(db, userId);
    assert.notEqual(touched.sessionLastSeenAt, staleAt);
    assert.notEqual(touched.userLastSeenAt, staleAt);
    assert.ok(Date.parse(touched.sessionLastSeenAt) >= beforeTouchMs - 1000);
    assert.equal(touched.sessionLastSeenAt, touched.userLastSeenAt,
      "session and user activity should be touched with the same timestamp");
    assert.equal(result.data.user.lastSeenAt, touched.userLastSeenAt);

    for (let index = 0; index < 5; index += 1) {
      result = await client.request("/api/session");
      assert.equal(result.response.status, 200);
    }
    const afterBurst = activity(db, userId);
    assert.equal(afterBurst.sessionLastSeenAt, touched.sessionLastSeenAt);
    assert.equal(afterBurst.userLastSeenAt, touched.userLastSeenAt);

    const revokedAt = new Date().toISOString();
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").run(revokedAt, baseline.sessionId);
    result = await client.request("/api/session");
    assert.equal(result.response.status, 200);
    assert.equal(result.data.user, null, "revoked session must be rejected immediately despite touch throttle");
    const afterRevoke = activity(db, userId);
    assert.equal(afterRevoke.sessionLastSeenAt, touched.sessionLastSeenAt,
      "rejected session must not be touched");
  } finally {
    db.close();
  }
});
