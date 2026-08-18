const test = require("node:test");
const assert = require("node:assert/strict");
const { openDb } = require("../../server/auth/db");

const runId = process.env.PATAP_TEST_RUN_ID;
const baseUrl = process.env.PATAP_AUTH_BASE_URL;

if (!runId || !baseUrl || !process.env.PATAP_DB_PATH || !process.env.PATAP_AUTH_SECRET_PATH) {
  throw new Error("Auth tests must be started through scripts/run-auth-tests.js");
}

let clientSequence = 100;

class Client {
  constructor() {
    this.cookies = {};
    this.csrfToken = null;
    clientSequence += 1;
    this.clientIp = `198.51.100.${clientSequence}`;
  }

  cookieHeader() {
    return Object.entries(this.cookies).map(([key, value]) => `${key}=${value}`).join("; ");
  }

  storeCookies(headers) {
    const values = headers.getSetCookie ? headers.getSetCookie() : [];
    for (const value of values) {
      const [pair] = value.split(";");
      const [key, raw] = pair.split("=");
      if (raw === "") delete this.cookies[key];
      else this.cookies[key] = raw;
    }
  }

  async request(pathname, options = {}) {
    const headers = {
      Accept: "application/json",
      Origin: "http://127.0.0.1:8090",
      "CF-Connecting-IP": this.clientIp,
      ...options.headers
    };
    if (options.body) headers["Content-Type"] = "application/json";
    if (this.csrfToken) headers["X-CSRF-Token"] = this.csrfToken;
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    this.storeCookies(response.headers);
    const data = await response.json().catch(() => ({}));
    if (data.csrfToken) this.csrfToken = data.csrfToken;
    return { response, data };
  }

  async csrf() {
    return this.request("/api/csrf");
  }

  async binaryRequest(pathname, body, headers = {}) {
    const requestHeaders = {
      Origin: "http://127.0.0.1:8090",
      "CF-Connecting-IP": this.clientIp,
      "Content-Type": "audio/webm",
      ...headers
    };
    if (this.csrfToken) requestHeaders["X-CSRF-Token"] = this.csrfToken;
    const cookie = this.cookieHeader();
    if (cookie) requestHeaders.Cookie = cookie;
    const response = await fetch(`${baseUrl}${pathname}`, { method: "POST", headers: requestHeaders, body });
    this.storeCookies(response.headers);
    return response;
  }
}

async function createDriver(client, suffix, nickname) {
  await client.csrf();
  const username = `radio_reliability_${suffix}_${runId}`;
  let result = await client.request("/api/register", {
    method: "POST",
    body: {
      username,
      email: `${username}@patap.test`,
      password: "radio-reliability-123",
      confirmPassword: "radio-reliability-123"
    }
  });
  assert.equal(result.response.status, 201);
  result = await client.request("/api/driver/profile", {
    method: "PUT",
    body: { nickname, driverType: "TAXI", countryCode: "PL" }
  });
  assert.equal(result.response.status, 201);
}

test("failed oversized radio upload releases the pending PTT lease immediately", async () => {
  const first = new Client();
  const second = new Client();
  const firstNick = `RadioRecoverA_${runId}`;
  const secondNick = `RadioRecoverB_${runId}`;
  await createDriver(first, "a", firstNick);
  await createDriver(second, "b", secondNick);

  let result = await first.request(`/api/driver/drivers/${encodeURIComponent(secondNick)}/contact`, { method: "POST", body: {} });
  assert.equal(result.response.status, 200);
  result = await second.request(`/api/driver/drivers/${encodeURIComponent(firstNick)}/contact`, { method: "POST", body: {} });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.driver.relationship, "CONTACT");

  result = await first.request("/api/driver/radio/direct", { method: "POST", body: { nickname: secondNick } });
  assert.equal(result.response.status, 201);
  const channelId = result.data.channel.id;

  result = await first.request(`/api/driver/radio/channels/${channelId}/ptt`, { method: "POST", body: {} });
  assert.equal(result.response.status, 201);
  const failedSession = result.data;

  const response = await first.binaryRequest(
    `/api/driver/radio/transmissions/${failedSession.transmissionId}/audio`,
    Buffer.alloc(3 * 1024 * 1024 + 1, 1),
    { "X-Radio-Upload-Token": failedSession.uploadToken }
  );
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, "payload_too_large");

  const db = openDb();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM radio_transmissions WHERE id = ?").get(failedSession.transmissionId).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM radio_speaker_leases WHERE channel_id = ?").get(channelId).n, 0);
  db.close();

  result = await second.request(`/api/driver/radio/channels/${channelId}/ptt`, { method: "POST", body: {} });
  assert.equal(result.response.status, 201);
  await second.request(`/api/driver/radio/transmissions/${result.data.transmissionId}/audio`, {
    method: "DELETE",
    headers: { "X-Radio-Upload-Token": result.data.uploadToken },
    body: {}
  });
});
