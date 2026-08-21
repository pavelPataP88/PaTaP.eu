const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { openDb, DATA_DIR } = require("../../server/auth/db");
const { createRadioRetentionCleaner } = require("../../server/radio/retention");

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

async function commitAudio(client, channelId, bytes) {
  let result = await client.request(`/api/driver/radio/channels/${channelId}/ptt`, { method: "POST", body: {} });
  assert.equal(result.response.status, 201);
  const session = result.data;
  const response = await client.binaryRequest(
    `/api/driver/radio/transmissions/${session.transmissionId}/audio`,
    bytes,
    { "X-Radio-Upload-Token": session.uploadToken }
  );
  assert.equal(response.status, 201);
  const data = await response.json();
  return data.transmission;
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

test("radio retention cleanup deletes only expired committed audio in bounded idempotent batches", async () => {
  const first = new Client();
  const second = new Client();
  const firstNick = `RadioRetentionA_${runId}`;
  const secondNick = `RadioRetentionB_${runId}`;
  await createDriver(first, "c", firstNick);
  await createDriver(second, "d", secondNick);

  let result = await first.request(`/api/driver/drivers/${encodeURIComponent(secondNick)}/contact`, { method: "POST", body: {} });
  assert.equal(result.response.status, 200);
  result = await second.request(`/api/driver/drivers/${encodeURIComponent(firstNick)}/contact`, { method: "POST", body: {} });
  assert.equal(result.response.status, 200);
  result = await first.request("/api/driver/radio/direct", { method: "POST", body: { nickname: secondNick } });
  assert.equal(result.response.status, 201);
  const channelId = result.data.channel.id;

  const expired = await commitAudio(first, channelId, Buffer.from("old"));
  const missing = await commitAudio(first, channelId, Buffer.from("gone"));
  const active = await commitAudio(first, channelId, Buffer.from("alive"));

  const db = openDb();
  const storageDir = path.join(DATA_DIR, "radio");
  const expiredRow = db.prepare("SELECT channel_id, sender_id, storage_key FROM radio_transmissions WHERE id = ?").get(expired.id);
  const missingRow = db.prepare("SELECT storage_key FROM radio_transmissions WHERE id = ?").get(missing.id);
  const activeRow = db.prepare("SELECT storage_key FROM radio_transmissions WHERE id = ?").get(active.id);
  assert.ok(expiredRow && missingRow && activeRow);

  const expiredFile = path.join(storageDir, expiredRow.storage_key);
  const missingFile = path.join(storageDir, missingRow.storage_key);
  const activeFile = path.join(storageDir, activeRow.storage_key);
  assert.equal(fs.existsSync(expiredFile), true);
  assert.equal(fs.existsSync(missingFile), true);
  assert.equal(fs.existsSync(activeFile), true);

  db.prepare("UPDATE radio_transmissions SET expires_at = ? WHERE id IN (?, ?)")
    .run("2000-01-01T00:00:00.000Z", expired.id, missing.id);
  db.prepare("UPDATE radio_transmissions SET expires_at = ? WHERE id = ?")
    .run("2999-01-01T00:00:00.000Z", active.id);
  db.prepare("INSERT INTO radio_channel_pins(channel_id, transmission_id, pinned_by, created_at) VALUES(?, ?, ?, ?)")
    .run(expiredRow.channel_id, expired.id, expiredRow.sender_id, "2026-08-21T00:00:00.000Z");
  fs.rmSync(missingFile, { force: true });

  const cleaner = createRadioRetentionCleaner({
    db,
    storageDir,
    nowIso: () => "2026-08-21T12:00:00.000Z"
  });

  let cleanup = cleaner.cleanupBatch({ limit: 1 });
  assert.equal(cleanup.candidates, 1);
  assert.equal(cleanup.deletedRows, 1);
  assert.equal(cleanup.deletedFiles, 1);
  assert.equal(cleanup.bytesFreed, 3);
  assert.equal(cleanup.failures, 0);
  assert.equal(fs.existsSync(expiredFile), false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM radio_channel_pins WHERE transmission_id = ?").get(expired.id).n, 0);

  cleanup = cleaner.cleanupBatch({ limit: 100 });
  assert.equal(cleanup.candidates, 1);
  assert.equal(cleanup.deletedRows, 1);
  assert.equal(cleanup.deletedFiles, 0);
  assert.equal(cleanup.missingFiles, 1);
  assert.equal(cleanup.failures, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM radio_transmissions WHERE id = ?").get(missing.id).n, 0);

  cleanup = cleaner.cleanupBatch({ limit: 100 });
  assert.equal(cleanup.candidates, 0);
  assert.equal(cleanup.deletedRows, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM radio_transmissions WHERE id = ?").get(active.id).n, 1);
  assert.equal(fs.existsSync(activeFile), true);
  db.close();

  result = await first.request(`/api/driver/radio/transmissions/${active.id}`, { method: "DELETE", body: {} });
  assert.equal(result.response.status, 200);
  assert.equal(fs.existsSync(activeFile), false);
});
