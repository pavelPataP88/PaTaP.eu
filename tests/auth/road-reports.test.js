const test = require("node:test");
const assert = require("node:assert/strict");
const { createRoadReportStore, normalizeInput } = require("../../server/road-reports/repository");

const runId = process.env.PATAP_TEST_RUN_ID;
const baseUrl = process.env.PATAP_AUTH_BASE_URL;

if (!runId || !baseUrl || !process.env.PATAP_DB_PATH || !process.env.PATAP_AUTH_SECRET_PATH) {
  throw new Error("Auth tests must be started through scripts/run-auth-tests.js");
}

let clientSequence = 160;
let registrationSequence = 0;
const runTag = String(runId).replace(/[^a-zA-Z0-9]/g, "").slice(-8) || "run";

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

function nextIdentity(suffix) {
  registrationSequence += 1;
  const safe = String(suffix).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8) || "driver";
  const seq = registrationSequence.toString(36);
  return { username: `rr_${safe}_${runTag}_${seq}`, nickname: `Road_${safe}_${runTag}_${seq}` };
}

async function register(client, suffix, withProfile = true) {
  await client.csrf();
  const identity = nextIdentity(suffix);
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

test("road report store keeps PaTaP TTL, privacy and optional lane semantics", () => {
  let clock = Date.parse("2026-08-18T12:00:00.000Z");
  const store = createRoadReportStore({ now: () => clock });
  assert.ok(normalizeInput({ type: "ACCIDENT", lane: null, latitude: 50, longitude: 19 }));
  assert.equal(normalizeInput({ type: "OBSTACLE", lane: "LEFT", latitude: 50, longitude: 19 }), null);
  const report = store.create(10, { type: "ACCIDENT", lane: null, latitude: 50, longitude: 19 });
  assert.equal("authorId" in report, false);
  assert.equal(new Date(report.expiresAt).getTime() - clock, 60 * 60 * 1000);
  const beforeConfirm = new Date(report.expiresAt).getTime();
  clock += 5 * 60 * 1000;
  const confirmed = store.confirm(20, report.id, "ACTIVE");
  assert.ok(new Date(confirmed.report.expiresAt).getTime() > beforeConfirm);
  assert.equal(store.confirm(21, report.id, "GONE").closed, false);
  assert.equal(store.confirm(22, report.id, "GONE").closed, true);
});

test("road report API creates at fresh nearby GPS and keeps guest list private", async () => {
  const author = new Client();
  const peer = new Client();
  await register(author, "author");
  await register(peer, "peer");
  await enableLocation(author);
  await enableLocation(peer, 50.2650, 19.0240);

  let result = await author.request("/api/driver/road-reports", { method: "POST", body: { type: "ROADWORK", lane: null, latitude: 50.2649, longitude: 19.0238 } });
  assert.equal(result.response.status, 201);
  const report = result.data.report;
  assert.equal(report.type, "ROADWORK");
  assert.equal(report.lane, null);

  const guest = new Client();
  result = await guest.request("/api/driver/road-reports");
  assert.equal(result.response.status, 200);
  const listed = result.data.reports.find((item) => item.id === report.id);
  assert.ok(listed);
  for (const key of ["authorId", "userId", "nickname", "author", "votes"]) assert.equal(key in listed, false);

  result = await peer.request(`/api/driver/road-reports/${report.id}/confirm`, { method: "POST", body: { status: "ACTIVE" } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.closed, false);
  assert.equal(result.data.report.confirmations.active, 1);
});

test("road report API rejects missing or distant GPS and protects confirmations", async () => {
  const noGps = new Client();
  const distant = new Client();
  const author = new Client();
  await register(noGps, "nogps");
  await register(distant, "far");
  await register(author, "owner");
  await enableLocation(distant, 51.1079, 17.0385);
  await enableLocation(author);

  let result = await noGps.request("/api/driver/road-reports", { method: "POST", body: { type: "OBSTACLE", lane: null, latitude: 50.2649, longitude: 19.0238 } });
  assert.equal(result.response.status, 409);
  assert.equal(result.data.error, "road_report_location_required");

  result = await author.request("/api/driver/road-reports", { method: "POST", body: { type: "ACCIDENT", lane: "LEFT", latitude: 50.2649, longitude: 19.0238 } });
  assert.equal(result.response.status, 201);
  const report = result.data.report;

  result = await distant.request(`/api/driver/road-reports/${report.id}/confirm`, { method: "POST", body: { status: "GONE" } });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.error, "road_report_too_far");

  result = await author.request(`/api/driver/road-reports/${report.id}/confirm`, { method: "POST", body: { status: "GONE" } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.closed, true);
});
