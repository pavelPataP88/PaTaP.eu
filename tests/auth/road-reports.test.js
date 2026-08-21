const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createRoadReportRepository } = require("../../server/road-reports/repository");

const runId = process.env.PATAP_TEST_RUN_ID;
const baseUrl = process.env.PATAP_AUTH_BASE_URL;

if (!runId || !baseUrl || !process.env.PATAP_DB_PATH || !process.env.PATAP_AUTH_SECRET_PATH) {
  throw new Error("Auth tests must be started through scripts/run-auth-tests.js");
}

let clientSequence = 160;
let registrationSequence = 0;
const runNicknameTag = String(runId).replace(/[^a-zA-Z0-9]/g, "").slice(-8) || "run";

class Client {
  constructor() {
    this.cookies = {};
    this.csrfToken = null;
    clientSequence += 1;
    this.clientIp = `198.51.100.${clientSequence}`;
  }
  cookieHeader() { return Object.entries(this.cookies).map(([key, value]) => `${key}=${value}`).join("; "); }
  storeCookies(headers) {
    const values = headers.getSetCookie ? headers.getSetCookie() : [];
    for (const value of values) {
      const [pair] = value.split(";");
      const [key, raw] = pair.split("=");
      if (raw === "") delete this.cookies[key]; else this.cookies[key] = raw;
    }
  }
  async request(pathname, options = {}) {
    const headers = { Accept: "application/json", Origin: "http://127.0.0.1:8090", "CF-Connecting-IP": this.clientIp, ...options.headers };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (this.csrfToken) headers["X-CSRF-Token"] = this.csrfToken;
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined });
    this.storeCookies(response.headers);
    const data = await response.json().catch(() => ({}));
    if (data.csrfToken) this.csrfToken = data.csrfToken;
    return { response, data };
  }
  async csrf() { return this.request("/api/csrf"); }
}

function nextTestIdentity(suffix) {
  registrationSequence += 1;
  const safeSuffix = String(suffix).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8) || "driver";
  const sequence = registrationSequence.toString(36);
  return {
    username: `rr_${safeSuffix}_${runNicknameTag}_${sequence}`,
    nickname: `Road_${safeSuffix}_${runNicknameTag}_${sequence}`
  };
}

async function register(client, suffix, withProfile = true) {
  await client.csrf();
  const identity = nextTestIdentity(suffix);
  let result = await client.request("/api/register", { method: "POST", body: { username: identity.username, email: `${identity.username}@patap.test`, password: "road-report-123", confirmPassword: "road-report-123" } });
  assert.equal(result.response.status, 201);
  if (withProfile) {
    result = await client.request("/api/driver/profile", { method: "PUT", body: { nickname: identity.nickname, driverType: "TIR", countryCode: "PL" } });
    assert.equal(result.response.status, 201);
  }
}

async function enableLocation(client, latitude = 50.2649, longitude = 19.0238) {
  let result = await client.request("/api/driver/gps", { method: "PUT", body: { enabled: true } });
  assert.equal(result.response.status, 200);
  result = await client.request("/api/driver/location", { method: "PUT", body: { latitude, longitude, accuracy: 10 } });
  assert.equal(result.response.status, 200);
}

test("road report repository survives database reopen, preserves votes, expires and never reuses ids", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "patap-road-reports-"));
  const databasePath = path.join(directory, "road-reports.sqlite");
  let clock = Date.parse("2026-08-18T12:00:00.000Z");
  const nowIso = () => new Date(clock).toISOString();
  let db;
  try {
    db = new DatabaseSync(databasePath);
    db.exec("PRAGMA foreign_keys = ON; CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users(id) VALUES(10),(20),(21);");
    let reports = createRoadReportRepository(db, { nowIso });
    const report = reports.create(10, { type: "OBSTACLE", lane: null, latitude: 50, longitude: 19 });
    assert.ok(report);
    assert.equal("authorId" in report, false);
    assert.equal(reports.confirm(20, report.id, "GONE").closed, false);
    db.close();
    db = null;

    db = new DatabaseSync(databasePath);
    db.exec("PRAGMA foreign_keys = ON");
    reports = createRoadReportRepository(db, { nowIso });
    const restored = reports.list().find((item) => item.id === report.id);
    assert.ok(restored);
    assert.equal(restored.confirmations.gone, 1);
    assert.equal(reports.confirm(20, report.id, "GONE").closed, false);
    const closed = reports.confirm(21, report.id, "GONE");
    assert.equal(closed.closed, true);
    assert.equal(closed.report.confirmations.gone, 2);
    assert.equal(reports.list().length, 0);

    const next = reports.create(10, { type: "OBSTACLE", lane: null, latitude: 50, longitude: 19 });
    assert.ok(next.id > report.id);
    clock += 46 * 60 * 1000;
    assert.equal(reports.list().length, 0);
  } finally {
    try { db?.close(); } catch {}
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("road report ACTIVE confirmation persists and extends TTL", () => {
  const db = new DatabaseSync(":memory:");
  let clock = Date.parse("2026-08-18T12:00:00.000Z");
  const nowIso = () => new Date(clock).toISOString();
  try {
    db.exec("PRAGMA foreign_keys = ON; CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users(id) VALUES(10),(20);");
    const reports = createRoadReportRepository(db, { nowIso });
    const report = reports.create(10, { type: "OBSTACLE", lane: null, latitude: 50, longitude: 19 });
    const firstExpiry = Date.parse(report.expiresAt);
    clock += 30 * 60 * 1000;
    const result = reports.confirm(20, report.id, "ACTIVE");
    assert.equal(result.closed, false);
    assert.equal(result.report.confirmations.active, 1);
    assert.ok(Date.parse(result.report.expiresAt) > firstExpiry);
  } finally {
    db.close();
  }
});

test("road report API keeps guest list safe and requires nearby fresh GPS for peer confirmations", async () => {
  const first = new Client();
  const noGps = new Client();
  const distant = new Client();
  const near = new Client();
  await register(first, "a");
  await register(noGps, "nogps");
  await register(distant, "far");
  await register(near, "near");
  await enableLocation(first);
  await enableLocation(distant, 51.1079, 17.0385);
  await enableLocation(near, 50.2650, 19.0240);

  let result = await first.request("/api/driver/road-reports", { method: "POST", body: { type: "ACCIDENT", lane: "LEFT", latitude: 50.2649, longitude: 19.0238 } });
  assert.equal(result.response.status, 201);
  const report = result.data.report;

  const guest = new Client();
  result = await guest.request("/api/driver/road-reports");
  assert.equal(result.response.status, 200);
  const guestReport = result.data.reports.find((item) => item.id === report.id);
  assert.ok(guestReport);
  for (const key of ["authorId", "userId", "nickname", "author", "votes"]) assert.equal(key in guestReport, false);
  assert.deepEqual(Object.keys(guestReport.confirmations).sort(), ["active", "gone"]);

  result = await noGps.request(`/api/driver/road-reports/${report.id}/confirm`, { method: "POST", body: { status: "ACTIVE" } });
  assert.equal(result.response.status, 409);
  assert.equal(result.data.error, "road_report_location_required");

  result = await distant.request(`/api/driver/road-reports/${report.id}/confirm`, { method: "POST", body: { status: "GONE" } });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.error, "road_report_too_far");

  result = await near.request(`/api/driver/road-reports/${report.id}/confirm`, { method: "POST", body: { status: "ACTIVE" } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.closed, false);
  assert.equal(result.data.report.confirmations.active, 1);

  result = await first.request(`/api/driver/road-reports/${report.id}/confirm`, { method: "POST", body: { status: "GONE" } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.closed, true);
});

test("road report API keeps create validation, profile, distance and confirmation validation", async () => {
  const profileless = new Client();
  await register(profileless, "nop", false);
  let result = await profileless.request("/api/driver/road-reports", { method: "POST", body: { type: "OBSTACLE", lane: null, latitude: 50.2649, longitude: 19.0238 } });
  assert.equal(result.response.status, 409);
  assert.equal(result.data.error, "driver_profile_required");

  const first = new Client();
  await register(first, "validation");
  await enableLocation(first);
  result = await first.request("/api/driver/road-reports", { method: "POST", body: { type: "OBSTACLE", lane: "LEFT", latitude: 50.2649, longitude: 19.0238 } });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.error, "invalid_road_report");
  result = await first.request("/api/driver/road-reports", { method: "POST", body: { type: "ACCIDENT", lane: "LEFT", latitude: 51.1079, longitude: 17.0385 } });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.error, "road_report_too_far");
  result = await first.request("/api/driver/road-reports/999999/confirm", { method: "POST", body: { status: "MAYBE" } });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.error, "invalid_road_report_confirmation");
});
