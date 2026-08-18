const test = require("node:test");
const assert = require("node:assert/strict");
const { createRoadReportStore } = require("../../server/road-reports/repository");

const runId = process.env.PATAP_TEST_RUN_ID;
const baseUrl = process.env.PATAP_AUTH_BASE_URL;

if (!runId || !baseUrl || !process.env.PATAP_DB_PATH || !process.env.PATAP_AUTH_SECRET_PATH) {
  throw new Error("Auth tests must be started through scripts/run-auth-tests.js");
}

let clientSequence = 160;

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
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (this.csrfToken) headers["X-CSRF-Token"] = this.csrfToken;
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...options,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
    this.storeCookies(response.headers);
    const data = await response.json().catch(() => ({}));
    if (data.csrfToken) this.csrfToken = data.csrfToken;
    return { response, data };
  }

  async csrf() {
    return this.request("/api/csrf");
  }
}

async function register(client, suffix, withProfile = true) {
  await client.csrf();
  const username = `road_report_${suffix}_${runId}`;
  let result = await client.request("/api/register", {
    method: "POST",
    body: {
      username,
      email: `${username}@patap.test`,
      password: "road-report-123",
      confirmPassword: "road-report-123"
    }
  });
  assert.equal(result.response.status, 201);
  if (withProfile) {
    result = await client.request("/api/driver/profile", {
      method: "PUT",
      body: { nickname: `Road_${suffix}_${runId}`, driverType: "TIR", countryCode: "PL" }
    });
    assert.equal(result.response.status, 201);
  }
}

async function enableLocation(client, latitude = 50.2649, longitude = 19.0238) {
  let result = await client.request("/api/driver/gps", { method: "PUT", body: { enabled: true } });
  assert.equal(result.response.status, 200);
  result = await client.request("/api/driver/location", {
    method: "PUT",
    body: { latitude, longitude, accuracy: 10 }
  });
  assert.equal(result.response.status, 200);
}

test("road report store expires reports and needs distinct peers to close", () => {
  let clock = Date.parse("2026-08-18T12:00:00.000Z");
  const store = createRoadReportStore({ now: () => clock });
  const report = store.create(10, { type: "OBSTACLE", lane: null, latitude: 50, longitude: 19 });
  assert.ok(report);
  assert.equal("authorId" in report, false);
  assert.equal(store.confirm(20, report.id, "GONE").closed, false);
  assert.equal(store.confirm(20, report.id, "GONE").closed, false);
  assert.equal(store.confirm(21, report.id, "GONE").closed, true);
  assert.equal(store.list().length, 0);

  const expiring = store.create(10, { type: "OBSTACLE", lane: null, latitude: 50, longitude: 19 });
  assert.ok(expiring);
  clock += 46 * 60 * 1000;
  assert.equal(store.list().length, 0);
});

test("road report API enforces rights, GPS distance, privacy and confirmation", async () => {
  const guest = new Client();
  let result = await guest.request("/api/driver/road-reports");
  assert.equal(result.response.status, 401);

  const profileless = new Client();
  await register(profileless, "nop", false);
  result = await profileless.request("/api/driver/road-reports", {
    method: "POST",
    body: { type: "OBSTACLE", lane: null, latitude: 50.2649, longitude: 19.0238 }
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.data.error, "driver_profile_required");

  const first = new Client();
  const second = new Client();
  await register(first, "a");
  await register(second, "b");
  await enableLocation(first);
  await enableLocation(second, 50.2650, 19.0240);

  result = await first.request("/api/driver/road-reports", {
    method: "POST",
    body: { type: "OBSTACLE", lane: "LEFT", latitude: 50.2649, longitude: 19.0238 }
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.error, "invalid_road_report");

  result = await first.request("/api/driver/road-reports", {
    method: "POST",
    body: { type: "ACCIDENT", lane: "LEFT", latitude: 51.1079, longitude: 17.0385 }
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.error, "road_report_too_far");

  result = await first.request("/api/driver/road-reports", {
    method: "POST",
    body: { type: "ACCIDENT", lane: "LEFT", latitude: 50.2649, longitude: 19.0238 }
  });
  assert.equal(result.response.status, 201);
  const report = result.data.report;
  assert.equal(report.type, "ACCIDENT");
  assert.equal(report.lane, "LEFT");
  assert.equal("authorId" in report, false);
  assert.equal("userId" in report, false);
  assert.equal("nickname" in report, false);

  result = await second.request("/api/driver/road-reports");
  assert.equal(result.response.status, 200);
  const listed = result.data.reports.find((item) => item.id === report.id);
  assert.ok(listed);
  assert.equal("authorId" in listed, false);
  assert.equal("userId" in listed, false);
  assert.equal("nickname" in listed, false);

  result = await second.request(`/api/driver/road-reports/${report.id}/confirm`, {
    method: "POST",
    body: { status: "ACTIVE" }
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.closed, false);
  assert.ok(Date.parse(result.data.report.expiresAt) >= Date.parse(report.expiresAt));
  assert.equal(result.data.report.confirmations.active, 1);

  result = await first.request(`/api/driver/road-reports/${report.id}/confirm`, {
    method: "POST",
    body: { status: "GONE" }
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.closed, true);

  result = await second.request("/api/driver/road-reports");
  assert.equal(result.response.status, 200);
  assert.equal(result.data.reports.some((item) => item.id === report.id), false);

  result = await second.request("/api/driver/road-reports/999999/confirm", {
    method: "POST",
    body: { status: "MAYBE" }
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.error, "invalid_road_report_confirmation");
});
