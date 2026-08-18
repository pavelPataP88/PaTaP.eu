const test = require("node:test");
const assert = require("node:assert/strict");
const { openDb } = require("../../server/auth/db");

const runId = process.env.PATAP_TEST_RUN_ID;
const baseUrl = process.env.PATAP_AUTH_BASE_URL;
if (!runId || !baseUrl || !process.env.PATAP_DB_PATH || !process.env.PATAP_AUTH_SECRET_PATH) {
  throw new Error("Auth tests must be started through scripts/run-auth-tests.js");
}

let clientSequence = 150;
let identitySequence = 0;

class Client {
  constructor() {
    this.cookies = {};
    this.csrfToken = null;
    clientSequence += 1;
    this.clientIp = `203.0.113.${clientSequence}`;
  }
  cookieHeader() { return Object.entries(this.cookies).map(([key, value]) => `${key}=${value}`).join("; "); }
  storeCookies(headers) {
    for (const value of headers.getSetCookie ? headers.getSetCookie() : []) {
      const [pair] = value.split(";");
      const [key, raw] = pair.split("=");
      if (raw === "") delete this.cookies[key]; else this.cookies[key] = raw;
    }
  }
  async request(pathname, options = {}) {
    const headers = { Accept: "application/json", Origin: "http://127.0.0.1:8090", "CF-Connecting-IP": this.clientIp, ...options.headers };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (this.csrfToken) headers["X-CSRF-Token"] = this.csrfToken;
    const cookie = this.cookieHeader(); if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined });
    this.storeCookies(response.headers);
    const data = await response.json().catch(() => ({}));
    if (data.csrfToken) this.csrfToken = data.csrfToken;
    return { response, data };
  }
  async csrf() { return this.request("/api/csrf"); }
  async binaryRequest(pathname, body, headers = {}) {
    const requestHeaders = { Origin: "http://127.0.0.1:8090", "CF-Connecting-IP": this.clientIp, "Content-Type": "audio/webm", ...headers };
    if (this.csrfToken) requestHeaders["X-CSRF-Token"] = this.csrfToken;
    const cookie = this.cookieHeader(); if (cookie) requestHeaders.Cookie = cookie;
    return fetch(`${baseUrl}${pathname}`, { method: "POST", headers: requestHeaders, body });
  }
  async openRadioEvents() {
    const controller = new AbortController();
    const headers = { Accept: "text/event-stream", Origin: "http://127.0.0.1:8090", "CF-Connecting-IP": this.clientIp };
    const cookie = this.cookieHeader(); if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${baseUrl}/api/driver/radio/events`, { headers, signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    async function nextPayload(timeoutMs = 3_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const blockEnd = buffer.indexOf("\n\n");
        if (blockEnd >= 0) {
          const block = buffer.slice(0, blockEnd);
          buffer = buffer.slice(blockEnd + 2);
          const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
          if (dataLine) return JSON.parse(dataLine.slice(6));
          continue;
        }
        const remaining = Math.max(1, deadline - Date.now());
        const result = await Promise.race([
          reader.read(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("radio_sse_timeout")), remaining))
        ]);
        if (result.done) throw new Error("radio_sse_closed");
        buffer += decoder.decode(result.value, { stream: true }).replaceAll("\r\n", "\n");
      }
      throw new Error("radio_sse_timeout");
    }
    return { controller, reader, nextPayload };
  }
}

async function createDriver(label) {
  identitySequence += 1;
  const client = new Client();
  const tag = `${label}_${identitySequence}_${runId}`;
  const nickname = `RadioV2_${label}_${identitySequence}_${String(runId).slice(-8)}`.slice(0, 32);
  await client.csrf();
  let result = await client.request("/api/register", {
    method: "POST",
    body: { username: `rv2_${tag}`.slice(0, 32), email: `rv2_${tag}@patap.test`, password: "radio-console-123", confirmPassword: "radio-console-123" }
  });
  assert.equal(result.response.status, 201);
  result = await client.request("/api/driver/profile", { method: "PUT", body: { nickname, driverType: "TIR", countryCode: "PL" } });
  assert.equal(result.response.status, 201);
  return { client, nickname };
}

async function makeContacts(left, right) {
  let result = await left.client.request(`/api/driver/drivers/${encodeURIComponent(right.nickname)}/contact`, { method: "POST", body: {} });
  assert.equal(result.response.status, 200);
  result = await right.client.request(`/api/driver/drivers/${encodeURIComponent(left.nickname)}/contact`, { method: "POST", body: {} });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.driver.relationship, "CONTACT");
}

async function cancelLease(driver, lease) {
  const result = await driver.client.request(`/api/driver/radio/transmissions/${lease.transmissionId}/audio`, {
    method: "DELETE", headers: { "X-Radio-Upload-Token": lease.uploadToken }, body: {}
  });
  assert.equal(result.response.status, 200);
}

test("Radio Console v2 enforces group roles, discovery, moderation, settings, alerts, pins, SSE and legacy direct access", async () => {
  const owner = await createDriver("owner");
  const trusted = await createDriver("trusted");
  const publicUser = await createDriver("public");
  const stranger = await createDriver("stranger");
  await makeContacts(owner, trusted);
  await makeContacts(owner, publicUser);

  let result = await owner.client.request("/api/driver/radio/overview");
  assert.equal(result.response.status, 200);
  const general = result.data.channels.find((item) => item.kind === "GENERAL");
  assert.ok(general);
  assert.equal(general.title, "Общий эфир");
  assert.equal(general.visibility, "PUBLIC");
  assert.equal(general.canTalk, true);
  assert.equal(result.data.settings.status, "AVAILABLE");

  const events = await owner.client.openRadioEvents();
  try {
    assert.equal((await events.nextPayload()).type, "radio.ready");
    result = await owner.client.request("/api/driver/radio/channels", {
      method: "POST",
      body: { title: "TIR Polska Test", description: "Закрытый тестовый канал", visibility: "PRIVATE", talkPolicy: "TRUSTED" }
    });
    assert.equal(result.response.status, 201);
    assert.equal((await events.nextPayload()).type, "radio.refresh");
  } finally {
    events.controller.abort();
    await events.reader.cancel().catch(() => {});
  }
  const privateId = result.data.channel.id;
  assert.equal(result.data.channel.kind, "GROUP");
  assert.equal(result.data.channel.role, "OWNER");
  assert.equal(result.data.channel.canTalk, true);

  result = await stranger.client.request("/api/driver/radio/discover?q=TIR%20Polska");
  assert.equal(result.response.status, 200);
  assert.equal(result.data.channels.some((item) => item.id === privateId), false);

  result = await owner.client.request(`/api/driver/radio/channels/${privateId}/invites`, { method: "POST", body: { nickname: trusted.nickname } });
  assert.equal(result.response.status, 200);
  result = await owner.client.request(`/api/driver/radio/channels/${privateId}/invites`, { method: "POST", body: { nickname: stranger.nickname } });
  assert.equal(result.response.status, 403);
  assert.equal(result.data.error, "radio_contact_required");

  result = await trusted.client.request("/api/driver/radio/overview");
  assert.equal(result.data.invites.some((item) => item.channelId === privateId), true);
  result = await trusted.client.request(`/api/driver/radio/invites/${privateId}/respond`, { method: "POST", body: { action: "ACCEPT" } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.accepted, true);

  result = await trusted.client.request(`/api/driver/radio/channels/${privateId}/ptt`, { method: "POST", body: {} });
  assert.equal(result.response.status, 403);
  assert.equal(result.data.error, "radio_talk_not_allowed");

  result = await owner.client.request(`/api/driver/radio/channels/${privateId}/members/${encodeURIComponent(trusted.nickname)}`, { method: "PATCH", body: { role: "TRUSTED" } });
  assert.equal(result.response.status, 200);
  result = await trusted.client.request(`/api/driver/radio/channels/${privateId}/ptt`, { method: "POST", body: {} });
  assert.equal(result.response.status, 201);
  await cancelLease(trusted, result.data);

  result = await trusted.client.request(`/api/driver/radio/channels/${privateId}/preferences`, { method: "PATCH", body: { muted: true, favorite: true } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.preferences.muted, true);
  assert.equal(result.data.preferences.favorite, true);
  result = await trusted.client.request("/api/driver/radio/settings", { method: "PATCH", body: { status: "SOLO", soloChannelId: privateId, defaultChannelId: privateId, autoPlay: true, playbackRate: 1.5 } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.settings.status, "SOLO");
  assert.equal(result.data.settings.soloChannelId, privateId);
  assert.equal(result.data.settings.playbackRate, 1.5);

  result = await owner.client.request(`/api/driver/radio/channels/${privateId}/alerts`, { method: "POST", body: {} });
  assert.equal(result.response.status, 201);
  result = await trusted.client.request("/api/driver/radio/overview");
  assert.equal(result.data.alerts.some((item) => item.channelId === privateId), true);

  result = await owner.client.request(`/api/driver/radio/channels/${privateId}/ptt`, { method: "POST", body: {} });
  assert.equal(result.response.status, 201);
  const committedLease = result.data;
  const upload = await owner.client.binaryRequest(`/api/driver/radio/transmissions/${committedLease.transmissionId}/audio`, Buffer.from([1, 2, 3, 4, 5, 6]), { "X-Radio-Upload-Token": committedLease.uploadToken });
  assert.equal(upload.status, 201);
  result = await owner.client.request(`/api/driver/radio/channels/${privateId}/pins/${committedLease.transmissionId}`, { method: "POST", body: {} });
  assert.equal(result.response.status, 200);
  result = await trusted.client.request(`/api/driver/radio/channels/${privateId}/pins`);
  assert.equal(result.response.status, 200);
  assert.equal(result.data.pins.length, 1);
  assert.equal(result.data.pins[0].id, committedLease.transmissionId);

  result = await owner.client.request("/api/driver/radio/channels", { method: "POST", body: { title: "Public Road Test", description: "Открытый тест", visibility: "PUBLIC", talkPolicy: "EVERYONE" } });
  assert.equal(result.response.status, 201);
  const publicId = result.data.channel.id;
  result = await publicUser.client.request("/api/driver/radio/discover?q=Public");
  assert.equal(result.response.status, 200);
  assert.equal(result.data.channels.some((item) => item.id === publicId), true);
  result = await publicUser.client.request(`/api/driver/radio/channels/${publicId}/join`, { method: "POST", body: {} });
  assert.equal(result.response.status, 200);

  result = await owner.client.request(`/api/driver/radio/channels/${publicId}/members/${encodeURIComponent(publicUser.nickname)}`, { method: "DELETE", body: { ban: true } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.banned, true);
  result = await publicUser.client.request(`/api/driver/radio/channels/${publicId}/join`, { method: "POST", body: {} });
  assert.equal(result.response.status, 403);
  assert.equal(result.data.error, "radio_channel_banned");

  result = await owner.client.request("/api/driver/radio/direct", { method: "POST", body: { nickname: trusted.nickname } });
  assert.ok([200, 201].includes(result.response.status));
  assert.equal(result.data.channel.kind, "DIRECT");
  result = await stranger.client.request("/api/driver/radio/direct", { method: "POST", body: { nickname: trusted.nickname } });
  assert.equal(result.response.status, 403);
  assert.equal(result.data.error, "radio_contact_required");

  result = await stranger.client.request(`/api/driver/radio/channels/${privateId}`, { method: "PATCH", body: { title: "Hacked channel" } });
  assert.equal(result.response.status, 403);
  assert.equal(result.data.error, "radio_channel_forbidden");

  const db = openDb();
  assert.equal(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version, 12);
  assert.equal(db.prepare("SELECT version FROM radio_schema_meta WHERE singleton = 1").get().version, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM radio_channel_profiles WHERE space_kind = 'GROUP'").get().n >= 2, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM radio_channel_profiles WHERE space_kind = 'GENERAL'").get().n, 1);
  db.close();
});
