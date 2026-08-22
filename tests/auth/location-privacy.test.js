const test = require("node:test");
const assert = require("node:assert/strict");
const { discloseLocation, LOCATION_PRECISION } = require("../../server/people/location-disclosure");
const { haversineKm } = require("../../server/driver/location");

const runId = process.env.PATAP_TEST_RUN_ID;
const baseUrl = process.env.PATAP_AUTH_BASE_URL;
if (!runId || !baseUrl || !process.env.PATAP_DB_PATH || !process.env.PATAP_AUTH_SECRET_PATH) {
  throw new Error("Auth tests must be started through scripts/run-auth-tests.js");
}

let sequence = 0;
let ipSequence = 210;

class Client {
  constructor() {
    this.cookies = {};
    this.csrfToken = null;
    this.clientIp = `198.51.100.${++ipSequence}`;
  }
  cookieHeader() { return Object.entries(this.cookies).map(([key, value]) => `${key}=${value}`).join("; "); }
  storeCookies(headers) {
    for (const value of headers.getSetCookie ? headers.getSetCookie() : []) {
      const [pair] = value.split(";"); const index = pair.indexOf("="); const key = pair.slice(0, index); const raw = pair.slice(index + 1);
      if (raw === "") delete this.cookies[key]; else this.cookies[key] = raw;
    }
  }
  async request(pathname, options = {}) {
    const headers = { Accept:"application/json", Origin:"http://127.0.0.1:8090", "CF-Connecting-IP":this.clientIp, ...(options.headers || {}) };
    const cookie = this.cookieHeader(); if (cookie) headers.Cookie = cookie;
    if (this.csrfToken) headers["X-CSRF-Token"] = this.csrfToken;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers, body:options.body === undefined ? undefined : JSON.stringify(options.body) });
    this.storeCookies(response.headers);
    const data = await response.json().catch(() => ({}));
    if (data.csrfToken) this.csrfToken = data.csrfToken;
    return { response, data };
  }
  async csrf() { return this.request("/api/csrf"); }
}

async function createDriver(label) {
  const id = ++sequence;
  const client = new Client();
  const tag = String(runId).replace(/[^a-zA-Z0-9]/g, "").slice(-6) || "run";
  const username = `lp_${label}_${id}_${tag}`.toLowerCase().slice(0, 32);
  const nickname = `LP_${label}_${id}_${tag}`.slice(0, 32);
  await client.csrf();
  let result = await client.request("/api/register", { method:"POST", body:{ username, email:`${username}@patap.test`, password:"location-privacy-123", confirmPassword:"location-privacy-123" } });
  assert.equal(result.response.status, 201);
  result = await client.request("/api/driver/profile", { method:"PUT", body:{ nickname, driverType:"TIR", countryCode:"PL", vehicle:`Truck ${id}` } });
  assert.equal(result.response.status, 201);
  return { client, nickname };
}

async function enableLocation(driver, latitude, longitude, accuracy = 8) {
  let result = await driver.client.request("/api/driver/gps", { method:"PUT", body:{ enabled:true } });
  assert.equal(result.response.status, 200);
  result = await driver.client.request("/api/driver/location", { method:"PUT", body:{ latitude, longitude, accuracy } });
  assert.equal(result.response.status, 200);
}

async function makeContacts(left, right) {
  let result = await left.client.request(`/api/driver/drivers/${encodeURIComponent(right.nickname)}/contact`, { method:"POST", body:{} });
  assert.equal(result.response.status, 200);
  result = await right.client.request(`/api/driver/drivers/${encodeURIComponent(left.nickname)}/contact`, { method:"POST", body:{} });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.driver.relationship, "CONTACT");
}

async function mapTarget(viewer, nickname) {
  const result = await viewer.client.request("/api/driver/nearby", { method:"POST", body:{ radius:5 } });
  assert.equal(result.response.status, 200);
  return result.data.drivers.find((item) => item.nickname === nickname) || null;
}

async function peopleTarget(viewer, nickname) {
  const result = await viewer.client.request("/api/driver/people/nearby?radius=5");
  assert.equal(result.response.status, 200);
  return result.data.people.find((item) => item.nickname === nickname) || null;
}

test("location disclosure is deterministic and never improves source accuracy", () => {
  const raw = { latitude:50.2663, longitude:19.0267, accuracy:8 };
  const publicOne = discloseLocation(raw, LOCATION_PRECISION.PUBLIC_APPROXIMATE);
  const publicTwo = discloseLocation(raw, LOCATION_PRECISION.PUBLIC_APPROXIMATE);
  assert.deepEqual(publicOne, publicTwo);
  assert.notEqual(publicOne.latitude, raw.latitude);
  assert.notEqual(publicOne.longitude, raw.longitude);
  assert.ok(publicOne.accuracy >= 1600);

  const contact = discloseLocation(raw, LOCATION_PRECISION.CONTACT_APPROXIMATE);
  assert.notEqual(contact.latitude, raw.latitude);
  assert.notEqual(contact.longitude, raw.longitude);
  assert.ok(contact.accuracy >= 400);
  assert.ok(contact.accuracy < publicOne.accuracy);

  const precise = discloseLocation(raw, LOCATION_PRECISION.PRECISE);
  assert.deepEqual({ latitude:precise.latitude, longitude:precise.longitude, accuracy:precise.accuracy }, raw);
  assert.equal(discloseLocation(raw, LOCATION_PRECISION.NONE), null);
});

test("nearby GPS discloses public, contact and trusted precision only on the server boundary", async () => {
  const viewer = await createDriver("viewer");
  const target = await createDriver("target");
  const viewerLocation = { latitude:50.2649, longitude:19.0238 };
  const targetLocation = { latitude:50.2663, longitude:19.0267 };
  await enableLocation(viewer, viewerLocation.latitude, viewerLocation.longitude, 7);
  await enableLocation(target, targetLocation.latitude, targetLocation.longitude, 8);

  let map = await mapTarget(viewer, target.nickname);
  assert.ok(map, "default EVERYONE remains discoverable to a stranger");
  assert.notEqual(map.latitude, targetLocation.latitude);
  assert.notEqual(map.longitude, targetLocation.longitude);
  assert.ok(map.accuracy >= 1600);
  assert.equal(map.distanceKm, Number(haversineKm(viewerLocation.latitude, viewerLocation.longitude, map.latitude, map.longitude).toFixed(3)));

  let person = await peopleTarget(viewer, target.nickname);
  assert.ok(person);
  assert.equal(person.locationPrecision, "PUBLIC_APPROXIMATE");
  assert.ok(person.distanceKm >= 1);
  assert.equal(person.distanceKm % 1, 0);
  assert.equal("latitude" in person, false);
  assert.equal("longitude" in person, false);

  await makeContacts(viewer, target);
  map = await mapTarget(viewer, target.nickname);
  assert.ok(map);
  assert.notEqual(map.latitude, targetLocation.latitude);
  assert.notEqual(map.longitude, targetLocation.longitude);
  assert.ok(map.accuracy >= 400 && map.accuracy < 1600);

  person = await peopleTarget(viewer, target.nickname);
  assert.ok(person);
  assert.equal(person.locationPrecision, "CONTACT_APPROXIMATE");
  assert.equal(Number((person.distanceKm * 2).toFixed(8)) % 1, 0);

  let result = await target.client.request(`/api/driver/people/contacts/${encodeURIComponent(viewer.nickname)}/preferences`, { method:"PATCH", body:{ trusted:true } });
  assert.equal(result.response.status, 200);
  map = await mapTarget(viewer, target.nickname);
  assert.ok(map);
  assert.equal(map.latitude, targetLocation.latitude);
  assert.equal(map.longitude, targetLocation.longitude);
  assert.equal(map.accuracy, 8);

  person = await peopleTarget(viewer, target.nickname);
  assert.ok(person);
  assert.equal(person.locationPrecision, "PRECISE");
  assert.equal(person.distanceKm, Number(haversineKm(viewerLocation.latitude, viewerLocation.longitude, targetLocation.latitude, targetLocation.longitude).toFixed(1)));

  result = await target.client.request("/api/driver/people/settings", { method:"PATCH", body:{ nearbyVisibility:"NOBODY" } });
  assert.equal(result.response.status, 200);
  assert.equal(await mapTarget(viewer, target.nickname), null);
  assert.equal(await peopleTarget(viewer, target.nickname), null);
});
