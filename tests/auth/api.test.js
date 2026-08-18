const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { WebSocket } = require("ws");

const root = path.resolve(__dirname, "..", "..");
const runDir = path.dirname(process.env.PATAP_DB_PATH || "");
const runId = process.env.PATAP_TEST_RUN_ID;
const baseUrl = process.env.PATAP_AUTH_BASE_URL;

if (!runDir || !runId || !baseUrl || !process.env.PATAP_AUTH_SECRET_PATH) {
  throw new Error("Auth tests must be started through scripts/run-auth-tests.js");
}

const {
  openDb,
  hashPassword,
  nowIso,
  DB_PATH
} = require("../../server/auth/db");

const names = {
  owner: `owner_${runId}`,
  ownerEmail: `owner_${runId}@patap.test`,
  alice: `alice_${runId}`,
  aliceEmail: `alice_${runId}@patap.test`,
  bob: `bob_${runId}`,
  bobEmail: `bob_${runId}@patap.test`,
  profileOne: `profile1_${runId}`,
  profileOneEmail: `profile1_${runId}@patap.test`,
  profileTwo: `profile2_${runId}`,
  profileTwoEmail: `profile2_${runId}@patap.test`,
  locationOne: `location1_${runId}`,
  locationOneEmail: `location1_${runId}@patap.test`,
  locationTwo: `location2_${runId}`,
  locationTwoEmail: `location2_${runId}@patap.test`,
  chatOne: `chat1_${runId}`,
  chatOneEmail: `chat1_${runId}@patap.test`,
  chatTwo: `chat2_${runId}`,
  chatTwoEmail: `chat2_${runId}@patap.test`,
  radioOne: `radio1_${runId}`,
  radioOneEmail: `radio1_${runId}@patap.test`,
  radioTwo: `radio2_${runId}`,
  radioTwoEmail: `radio2_${runId}@patap.test`,
  radioThree: `radio3_${runId}`,
  radioThreeEmail: `radio3_${runId}@patap.test`
};

let clientSequence = 0;

class Client {
  constructor() {
    this.cookies = {};
    this.csrfToken = null;
    clientSequence += 1;
    this.clientIp = `192.0.2.${clientSequence}`;
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

  async binaryRequest(pathname, { method = "POST", body, headers = {} } = {}) {
    const requestHeaders = {
      Origin: "http://127.0.0.1:8090",
      "CF-Connecting-IP": this.clientIp,
      ...headers
    };
    if (this.csrfToken) requestHeaders["X-CSRF-Token"] = this.csrfToken;
    const cookie = this.cookieHeader();
    if (cookie) requestHeaders.Cookie = cookie;
    const response = await fetch(`${baseUrl}${pathname}`, { method, headers: requestHeaders, body: ["GET", "HEAD"].includes(method) ? undefined : (body || Buffer.alloc(0)) });
    this.storeCookies(response.headers);
    return response;
  }
}

const publicDriverHeaders = {
  "X-Forwarded-Host": "patap.eu",
  Origin: "https://driver.patap.eu",
  "X-Forwarded-Proto": "https"
};

test.before(async () => {
  const db = openDb();
  const now = nowIso();
  db.prepare(`
    INSERT INTO users(username, email, password_hash, role, created_at, updated_at)
    VALUES(?, ?, ?, 'Owner', ?, ?)
  `).run(names.owner, names.ownerEmail, hashPassword("owner-password-123"), now, now);
  const principal = db.prepare("SELECT p.user_id, u.username FROM principal_owner p JOIN users u ON u.id = p.user_id WHERE p.singleton = 1").get();
  assert.equal(principal.username, names.owner);
  db.close();
});

test("registration, duplicate checks, hash storage, login/logout/session", async () => {
  const tooShortClient = new Client();
  await tooShortClient.csrf();
  let tooShortResult = await tooShortClient.request("/api/register", {
    method: "POST",
    body: {
      username: `short_${runId}`,
      email: `short_${runId}@patap.test`,
      password: "Ab1!x",
      confirmPassword: "Ab1!x"
    }
  });
  assert.equal(tooShortResult.response.status, 400);

  const client = new Client();
  let result = await client.request("/api/health");
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data, { ok: true, database: "ok" });
  await client.csrf();

  result = await client.request("/api/register", {
    method: "POST",
    body: {
      username: names.alice,
      email: names.aliceEmail,
      password: "Ab1!xy",
      confirmPassword: "Ab1!xy"
    }
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.data.user.username, names.alice);
  assert.equal(result.data.user.role, "User");
  assert.ok(client.cookies.patap_session);
  assert.ok(!result.data.user.password_hash);

  const db = openDb();
  const row = db.prepare("SELECT password_hash FROM users WHERE username = ?").get(names.alice);
  assert.ok(row.password_hash.startsWith("scrypt$"));
  assert.notEqual(row.password_hash, "Ab1!xy");
  db.close();

  result = await client.request("/api/logout", { method: "POST", body: {} });
  assert.equal(result.response.status, 200);
  await client.csrf();

  result = await client.request("/api/register", {
    method: "POST",
    body: {
      username: names.alice,
      email: `alice2_${runId}@patap.test`,
      password: "Ab1!xy",
      confirmPassword: "Ab1!xy"
    }
  });
  assert.equal(result.response.status, 409);

  result = await client.request("/api/register", {
    method: "POST",
    body: {
      username: `alice2_${runId}`,
      email: names.aliceEmail,
      password: "Ab1!xy",
      confirmPassword: "Ab1!xy"
    }
  });
  assert.equal(result.response.status, 409);

  result = await client.request("/api/register", {
    method: "POST",
    body: {
      username: "bad",
      email: "bad@patap.test",
      password: "short",
      confirmPassword: "different"
    }
  });
  assert.equal(result.response.status, 400);

  result = await client.request("/api/login", {
    method: "POST",
    body: { identifier: names.alice, password: "wrong-password" }
  });
  assert.equal(result.response.status, 401);

  result = await client.request("/api/login", {
    method: "POST",
    body: { identifier: names.alice, password: "Ab1!xy" }
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.user.username, names.alice);

  result = await client.request("/api/session");
  assert.equal(result.response.status, 200);
  assert.equal(result.data.user.username, names.alice);

  result = await client.request("/api/logout", { method: "POST", body: {} });
  assert.equal(result.response.status, 200);
  await client.csrf();

  result = await client.request("/api/login", {
    method: "POST",
    body: { identifier: names.aliceEmail, password: "Ab1!xy" }
  });
  assert.equal(result.response.status, 200);

  result = await client.request("/api/logout", { method: "POST", body: {} });
  assert.equal(result.response.status, 200);
  await client.csrf();
  const driverUsername = `driver_register_${runId}`;
  result = await client.request("/api/driver/register", {
    method: "POST",
    body: {
      username: driverUsername,
      email: `${driverUsername}@patap.test`,
      password: "Ab1!xy",
      confirmPassword: "Ab1!xy",
      nickname: `DriverRegister_${runId}`,
      driverType: "TAXI"
    }
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.data.user.username, driverUsername);
  assert.deepEqual(result.data.profile.nickname, `DriverRegister_${runId}`);
  assert.equal(result.data.profile.driverType, "TAXI");

  const driverDb = openDb();
  const storedProfile = driverDb.prepare("SELECT nickname, driver_type FROM driver_profiles WHERE user_id = ?").get(result.data.user.id);
  assert.equal(storedProfile.nickname, `DriverRegister_${runId}`);
  assert.equal(storedProfile.driver_type, "TAXI");
  driverDb.close();
});

test("trusted Driver subdomain shares Patap cookies and passes CSRF checks", async () => {
  const db = openDb();
  const now = nowIso();
  db.prepare(`
    INSERT INTO users(username, email, password_hash, role, created_at, updated_at)
    VALUES(?, ?, ?, 'User', ?, ?)
  `).run(
    `driver_${runId}`,
    `driver_${runId}@patap.test`,
    hashPassword("driver-password-123"),
    now,
    now
  );
  db.close();

  const client = new Client();
  let result = await client.request("/api/csrf", { headers: publicDriverHeaders });
  assert.equal(result.response.status, 200);
  const csrfCookies = result.response.headers.getSetCookie();
  assert.equal(csrfCookies.length, 2);
  assert.equal(csrfCookies.filter((value) => /Domain=patap\.eu/i.test(value)).length, 1);
  assert.ok(csrfCookies.every((value) => /Secure/i.test(value)));

  result = await client.request("/api/login", {
    method: "POST",
    headers: publicDriverHeaders,
    body: {
      identifier: `driver_${runId}`,
      password: "driver-password-123"
    }
  });
  assert.equal(result.response.status, 200);
  const authCookies = result.response.headers.getSetCookie();
  assert.equal(authCookies.length, 4);
  assert.equal(authCookies.filter((value) => /Domain=patap\.eu/i.test(value)).length, 2);
  assert.equal(authCookies.filter((value) => /Max-Age=0/i.test(value)).length, 2);

  result = await client.request("/api/session", {
    headers: { ...publicDriverHeaders, "X-Forwarded-Host": "driver.patap.eu" }
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.user.username, `driver_${runId}`);
  const refreshedCookies = result.response.headers.getSetCookie();
  assert.equal(refreshedCookies.length, 4);
  assert.equal(refreshedCookies.filter((value) => /Domain=patap\.eu/i.test(value)).length, 2);

  result = await client.request("/api/logout", {
    method: "POST",
    headers: { ...publicDriverHeaders, Origin: "https://untrusted.example" },
    body: {}
  });
  assert.equal(result.response.status, 403);

  result = await client.request("/api/logout", {
    method: "POST",
    headers: { ...publicDriverHeaders, "X-Forwarded-Host": "driver.patap.eu" },
    body: {}
  });
  assert.equal(result.response.status, 200);
  const clearedCookies = result.response.headers.getSetCookie();
  assert.equal(clearedCookies.length, 4);
  assert.equal(clearedCookies.filter((value) => /Domain=patap\.eu/i.test(value)).length, 2);
  assert.ok(clearedCookies.every((value) => /Max-Age=0/i.test(value)));
});

test("Driver profile is authenticated, validated, editable, and nickname-unique", async () => {
  const anonymous = new Client();
  let result = await anonymous.request("/api/driver/profile");
  assert.equal(result.response.status, 401);

  const first = new Client();
  await first.csrf();
  result = await first.request("/api/register", {
    method: "POST",
    body: {
      username: names.profileOne,
      email: names.profileOneEmail,
      password: "profile-one-password-123",
      confirmPassword: "profile-one-password-123"
    }
  });
  assert.equal(result.response.status, 201);

  result = await first.request("/api/driver/profile");
  assert.equal(result.response.status, 200);
  assert.equal(result.data.profile, null);

  result = await first.request("/api/driver/profile", {
    method: "PUT",
    body: {
      nickname: `Kierowca_${runId}`,
      driverType: "TIR",
      realName: "Jan Testowy",
      vehicle: "Volvo FH",
      countryCode: "PL"
    }
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.data.profile.nickname, `Kierowca_${runId}`);
  assert.equal(result.data.profile.driverType, "TIR");
  assert.equal(result.data.profile.vehicle, "Volvo FH");
  assert.ok(!("user_id" in result.data.profile));
  assert.ok(!("nickname_key" in result.data.profile));

  result = await first.request("/api/driver/profile", {
    method: "PUT",
    body: { nickname: `Kierowca_${runId}`, driverType: "TAXI", countryCode: "GE" }
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.profile.driverType, "TAXI");
  assert.equal(result.data.profile.countryCode, "GE");
  assert.equal(result.data.profile.vehicle, null);

  result = await first.request("/api/driver/profile", {
    method: "PUT",
    body: { nickname: "x", driverType: "BOAT" }
  });
  assert.equal(result.response.status, 400);

  const second = new Client();
  await second.csrf();
  result = await second.request("/api/register", {
    method: "POST",
    body: {
      username: names.profileTwo,
      email: names.profileTwoEmail,
      password: "profile-two-password-123",
      confirmPassword: "profile-two-password-123"
    }
  });
  assert.equal(result.response.status, 201);
  result = await second.request("/api/driver/profile", {
    method: "PUT",
    body: { nickname: `kierowca_${runId}`, driverType: "DELIVERY" }
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.data.error, "nickname_exists");
  result = await second.request("/api/driver/profile", {
    method: "PUT", body: { nickname: `Other_${runId}`, driverType: "DELIVERY", countryCode: "PL" }
  });
  assert.equal(result.response.status, 201);

  result = await first.request(`/api/driver/drivers?query=Other_${runId.slice(0, 8)}`);
  assert.equal(result.response.status, 200);
  assert.equal(result.data.drivers.length, 1);
  assert.equal(result.data.drivers[0].relationship, "STRANGER");
  result = await first.request(`/api/driver/drivers/${encodeURIComponent(`Other_${runId}`)}`);
  assert.equal(result.response.status, 200);
  assert.equal(result.data.driver.gps, "OFF");
  result = await first.request(`/api/driver/drivers/${encodeURIComponent(`Other_${runId}`)}/contact`, { method: "POST", body: {} });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.driver.relationship, "REQUEST_SENT");
  result = await first.request("/api/driver/contacts");
  assert.equal(result.response.status, 200);
  assert.equal(result.data.counts.outgoing, 1);
  assert.equal(result.data.groups.outgoing[0].relationship, "REQUEST_SENT");
  result = await second.request("/api/driver/contacts");
  assert.equal(result.response.status, 200);
  assert.equal(result.data.counts.incoming, 1);
  assert.equal(result.data.groups.incoming[0].relationship, "REQUEST_INCOMING");
  result = await second.request(`/api/driver/drivers/${encodeURIComponent(`Kierowca_${runId}`)}/contact`, { method: "POST", body: {} });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.driver.relationship, "CONTACT");
  result = await first.request("/api/driver/contacts");
  assert.equal(result.data.counts.contacts, 1);
  assert.equal(result.data.groups.contacts[0].relationship, "CONTACT");
  result = await first.request(`/api/driver/drivers/${encodeURIComponent(`Other_${runId}`)}/block`, { method: "PUT", body: { enabled: true } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.driver.relationship, "BLOCKED");
  result = await first.request("/api/driver/contacts");
  assert.equal(result.data.counts.blocked, 1);
  assert.equal(result.data.groups.blocked[0].relationship, "BLOCKED");
  result = await second.request("/api/driver/contacts");
  assert.equal(result.data.drivers.length, 0);

  const db = openDb();
  assert.equal(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version, 12);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type IN ('driver_profile_created','driver_profile_updated')").get().n >= 2);
  db.close();
});

test("persistent Driver GPS enforces reciprocal visibility, freshness, radius, validation, and rate limits", async () => {
  async function createDriver(client, username, email, nickname, driverType) {
    await client.csrf();
    let result = await client.request("/api/register", {
      method: "POST",
      body: { username, email, password: "location-password-123", confirmPassword: "location-password-123" }
    });
    assert.equal(result.response.status, 201);
    result = await client.request("/api/driver/profile", {
      method: "PUT",
      body: { nickname, driverType }
    });
    assert.equal(result.response.status, 201);
  }

  const first = new Client();
  const second = new Client();
  await createDriver(first, names.locationOne, names.locationOneEmail, `LocOne_${runId}`, "TAXI");
  await createDriver(second, names.locationTwo, names.locationTwoEmail, `LocTwo_${runId}`, "DELIVERY");

  const anonymous = new Client();
  await anonymous.csrf();
  let result = await anonymous.request("/api/driver/gps", { method: "PUT", body: { enabled: true } });
  assert.equal(result.response.status, 401);
  result = await anonymous.request("/api/driver/nearby", { method: "POST", body: { radius: 25 } });
  assert.equal(result.response.status, 401);

  const firstCsrf = first.csrfToken;
  first.csrfToken = null;
  result = await first.request("/api/driver/gps", { method: "PUT", body: { enabled: true } });
  assert.equal(result.response.status, 403);
  first.csrfToken = firstCsrf;

  result = await first.request("/api/driver/profile");
  assert.equal(result.data.profile.gpsEnabled, false);
  result = await first.request("/api/driver/location", { method: "PUT", body: { latitude: 52.2297, longitude: 21.0122, accuracy: 12 } });
  assert.equal(result.response.status, 409);
  assert.equal(result.data.error, "gps_disabled");
  result = await first.request("/api/driver/nearby", { method: "POST", body: { radius: 25 } });
  assert.equal(result.response.status, 409);
  assert.equal(result.data.error, "gps_disabled");
  result = await first.request("/api/driver/gps", { method: "PUT", body: { enabled: "yes" } });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.error, "invalid_gps_state");

  result = await first.request("/api/driver/nearby", {
    method: "POST",
    body: { radius: 10 }
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.error, "invalid_radius");

  for (const client of [first, second]) {
    result = await client.request("/api/driver/gps", { method: "PUT", body: { enabled: true } });
    assert.equal(result.response.status, 200);
    assert.equal(result.data.gpsEnabled, true);
    result = await client.request("/api/driver/profile");
    assert.equal(result.data.profile.gpsEnabled, true);
  }

  for (const body of [
    { latitude: "52.2297", longitude: 21.0122, accuracy: 12 },
    { latitude: 52.2297, longitude: "21.0122", accuracy: 12 },
    { latitude: 52.2297, longitude: 21.0122, accuracy: "12" },
    { latitude: null, longitude: 21.0122, accuracy: 12 },
    { latitude: 52.2297, longitude: 181, accuracy: 12 },
    { latitude: 52.2297, longitude: 21.0122, accuracy: -1 }
  ]) {
    result = await first.request("/api/driver/location", { method: "PUT", body });
    assert.equal(result.response.status, 400);
    assert.equal(result.data.error, "invalid_location");
  }

  result = await first.request("/api/driver/location", {
    method: "PUT",
    body: { latitude: 52.2297, longitude: 21.0122, accuracy: 12, updatedAt: "1970-01-01T00:00:00.000Z" }
  });
  assert.equal(result.response.status, 200);
  assert.notEqual(result.data.location.updatedAt, "1970-01-01T00:00:00.000Z");
  result = await second.request("/api/driver/location", {
    method: "PUT",
    body: { latitude: 52.25, longitude: 21.02, accuracy: 18 }
  });
  assert.equal(result.response.status, 200);

  result = await first.request("/api/driver/nearby", {
    method: "POST",
    body: { radius: 5, latitude: 0, longitude: 0 }
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.locationReady, true);
  assert.equal(result.data.drivers.length, 1);
  assert.equal(result.data.drivers[0].nickname, `LocTwo_${runId}`);
  assert.ok(result.data.drivers[0].distanceKm > 0 && result.data.drivers[0].distanceKm < 5);
  assert.ok(!("userId" in result.data.drivers[0]));
  assert.deepEqual(Object.keys(result.data.drivers[0]).sort(), [
    "accuracy", "countryCode", "distanceKm", "driverType", "latitude",
    "longitude", "nickname", "updatedAt", "vehicle"
  ]);

  const db = openDb();
  const firstId = db.prepare("SELECT id FROM users WHERE username = ?").get(names.locationOne).id;
  const secondId = db.prepare("SELECT id FROM users WHERE username = ?").get(names.locationTwo).id;
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM driver_locations WHERE user_id = ?").get(firstId).n, 1);
  db.prepare("DELETE FROM rate_limits WHERE key = ?").run(`driver-location:user:${firstId}`);
  result = await first.request("/api/driver/location", {
    method: "PUT",
    body: { latitude: 52.23, longitude: 21.01, accuracy: 9 }
  });
  assert.equal(result.response.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM driver_locations WHERE user_id = ?").get(firstId).n, 1);
  assert.equal(db.prepare("SELECT accuracy_m FROM driver_locations WHERE user_id = ?").get(firstId).accuracy_m, 9);
  db.prepare("UPDATE driver_locations SET latitude = ?, longitude = ?, updated_at = ? WHERE user_id = ?")
    .run(52.32, 21.0122, nowIso(), secondId);
  result = await first.request("/api/driver/nearby", {
    method: "POST",
    body: { radius: 5 }
  });
  assert.equal(result.data.drivers.length, 0);
  result = await first.request("/api/driver/nearby", {
    method: "POST",
    body: { radius: 25 }
  });
  assert.equal(result.data.drivers.length, 1);

  result = await first.request("/api/driver/location", { method: "DELETE", body: {} });
  assert.equal(result.response.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM driver_locations WHERE user_id = ?").get(firstId).n, 0);
  assert.equal(db.prepare("SELECT gps_enabled FROM driver_profiles WHERE user_id = ?").get(firstId).gps_enabled, 1);
  result = await first.request("/api/driver/nearby", {
    method: "POST",
    body: { radius: 25 }
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.locationReady, false);
  assert.equal(result.data.drivers.length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM driver_locations WHERE user_id = ?").get(firstId).n, 0);
  result = await first.request("/api/driver/nearby?radius=25");
  assert.equal(result.response.status, 404);

  db.prepare("DELETE FROM rate_limits WHERE key = ?").run(`driver-location:user:${firstId}`);
  result = await first.request("/api/driver/location", { method: "PUT", body: { latitude: 52.23, longitude: 21.01, accuracy: 10 } });
  assert.equal(result.response.status, 200);

  db.prepare("UPDATE driver_locations SET updated_at = ? WHERE user_id = ?")
    .run(new Date(Date.now() - 2 * 60 * 1000).toISOString(), secondId);
  result = await first.request("/api/driver/nearby", {
    method: "POST",
    body: { radius: 25 }
  });
  assert.equal(result.data.drivers.length, 0);

  db.prepare("UPDATE driver_locations SET updated_at = ? WHERE user_id = ?").run(nowIso(), secondId);
  result = await second.request("/api/driver/gps", { method: "PUT", body: { enabled: false } });
  assert.equal(result.response.status, 200);
  assert.equal(db.prepare("SELECT gps_enabled FROM driver_profiles WHERE user_id = ?").get(secondId).gps_enabled, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM driver_locations WHERE user_id = ?").get(secondId).n, 0);
  result = await first.request("/api/driver/nearby", { method: "POST", body: { radius: 25 } });
  assert.equal(result.data.drivers.length, 0);
  result = await second.request("/api/driver/location", { method: "PUT", body: { latitude: 52.25, longitude: 21.02, accuracy: 18 } });
  assert.equal(result.response.status, 409);
  result = await second.request("/api/driver/nearby", { method: "POST", body: { radius: 25 } });
  assert.equal(result.response.status, 409);

  db.prepare("DELETE FROM rate_limits WHERE key = ?").run(`driver-location:user:${firstId}`);
  result = await first.request("/api/driver/location", { method: "PUT", body: { latitude: 52.23, longitude: 21.01, accuracy: 10 } });
  assert.equal(result.response.status, 200);
  result = await first.request("/api/driver/location", { method: "PUT", body: { latitude: 52.2301, longitude: 21.0101, accuracy: 10 } });
  assert.equal(result.response.status, 429);

  db.close();

  result = await first.request("/api/logout", { method: "POST", body: {} });
  assert.equal(result.response.status, 200);
  const relogin = new Client();
  await relogin.csrf();
  result = await relogin.request("/api/login", { method: "POST", body: { identifier: names.locationOne, password: "location-password-123" } });
  assert.equal(result.response.status, 200);
  result = await relogin.request("/api/driver/profile");
  assert.equal(result.data.profile.gpsEnabled, true);
});

test("direct radio requires an accepted contact and keeps audio private to channel members", async () => {
  async function createRadioDriver(client, username, email, nickname) {
    await client.csrf();
    let result = await client.request("/api/register", {
      method: "POST",
      body: { username, email, password: "radio-password-123", confirmPassword: "radio-password-123" }
    });
    assert.equal(result.response.status, 201);
    result = await client.request("/api/driver/profile", { method: "PUT", body: { nickname, driverType: "TIR", countryCode: "PL" } });
    assert.equal(result.response.status, 201);
  }

  const first = new Client();
  const second = new Client();
  const outsider = new Client();
  const firstNick = `RadioOne_${runId}`;
  const secondNick = `RadioTwo_${runId}`;
  await createRadioDriver(first, names.radioOne, names.radioOneEmail, firstNick);
  await createRadioDriver(second, names.radioTwo, names.radioTwoEmail, secondNick);
  await createRadioDriver(outsider, names.radioThree, names.radioThreeEmail, `RadioThree_${runId}`);

  let result = await first.request("/api/driver/radio/direct", { method: "POST", body: { nickname: secondNick } });
  assert.equal(result.response.status, 403);
  assert.equal(result.data.error, "radio_contact_required");

  result = await first.request(`/api/driver/drivers/${encodeURIComponent(secondNick)}/contact`, { method: "POST", body: {} });
  assert.equal(result.response.status, 200);
  result = await second.request(`/api/driver/drivers/${encodeURIComponent(firstNick)}/contact`, { method: "POST", body: {} });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.driver.relationship, "CONTACT");

  result = await first.request("/api/driver/radio/direct", { method: "POST", body: { nickname: secondNick } });
  assert.equal(result.response.status, 201);
  const channelId = result.data.channel.id;
  assert.equal(result.data.channel.kind, "DIRECT");
  result = await second.request("/api/driver/radio/direct", { method: "POST", body: { nickname: firstNick } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.channel.id, channelId);

  result = await first.request(`/api/driver/radio/channels/${channelId}/ptt`, { method: "POST", body: {} });
  assert.equal(result.response.status, 201);
  const { transmissionId, uploadToken } = result.data;
  result = await second.request(`/api/driver/radio/channels/${channelId}/ptt`, { method: "POST", body: {} });
  assert.equal(result.response.status, 409);
  assert.equal(result.data.error, "radio_channel_busy");

  let response = await first.binaryRequest(`/api/driver/radio/transmissions/${transmissionId}/audio`, {
    body: Buffer.from("not-a-real-webm-but-private-binary"),
    headers: { "Content-Type": "audio/webm", "X-Radio-Upload-Token": "wrong" }
  });
  assert.equal(response.status, 409);
  response = await first.binaryRequest(`/api/driver/radio/transmissions/${transmissionId}/audio`, {
    body: Buffer.from("not-a-real-webm-but-private-binary"),
    headers: { "Content-Type": "audio/webm", "X-Radio-Upload-Token": uploadToken }
  });
  assert.equal(response.status, 201);
  const committed = await response.json();
  assert.equal(committed.transmission.id, transmissionId);
  assert.equal(committed.transmission.byteLength, 34);
  const storageDb = openDb();
  const storageKey = storageDb.prepare("SELECT storage_key FROM radio_transmissions WHERE id = ?").get(transmissionId).storage_key;
  storageDb.close();
  const storedAudioPath = path.join(runDir, "radio", storageKey);
  assert.equal(fs.existsSync(storedAudioPath), true);

  result = await second.request(`/api/driver/radio/channels/${channelId}/transmissions`);
  assert.equal(result.response.status, 200);
  assert.equal(result.data.transmissions.length, 1);
  response = await second.binaryRequest(`/api/driver/radio/transmissions/${transmissionId}/audio`, { method: "GET" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(Buffer.from(await response.arrayBuffer()).toString("utf8"), "not-a-real-webm-but-private-binary");
  response = await outsider.binaryRequest(`/api/driver/radio/transmissions/${transmissionId}/audio`, { method: "GET" });
  assert.equal(response.status, 404);

  result = await second.request(`/api/driver/radio/transmissions/${transmissionId}`, { method: "DELETE", body: {} });
  assert.equal(result.response.status, 404);
  result = await first.request(`/api/driver/radio/transmissions/${transmissionId}`, { method: "DELETE", body: {} });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data.deleted, { id: transmissionId, channelId });
  assert.equal(fs.existsSync(storedAudioPath), false);
  result = await second.request(`/api/driver/radio/channels/${channelId}/transmissions`);
  assert.equal(result.response.status, 200);
  assert.equal(result.data.transmissions.length, 0);
  response = await second.binaryRequest(`/api/driver/radio/transmissions/${transmissionId}/audio`, { method: "GET" });
  assert.equal(response.status, 404);
  result = await first.request("/api/driver/radio/channels");
  assert.equal(result.data.channels.find((item) => item.id === channelId).transmissionCount, 0);

  result = await second.request(`/api/driver/radio/channels/${channelId}/ptt`, { method: "POST", body: {} });
  assert.equal(result.response.status, 201);
  const cancelledTransmission = result.data;
  result = await second.request(`/api/driver/radio/transmissions/${cancelledTransmission.transmissionId}/audio`, {
    method: "DELETE", headers: { "X-Radio-Upload-Token": cancelledTransmission.uploadToken }
  });
  assert.equal(result.response.status, 200);
  result = await first.request(`/api/driver/radio/channels/${channelId}/ptt`, { method: "POST", body: {} });
  assert.equal(result.response.status, 201);
  result = await first.request(`/api/driver/radio/transmissions/${result.data.transmissionId}/audio`, {
    method: "DELETE", headers: { "X-Radio-Upload-Token": result.data.uploadToken }
  });
  assert.equal(result.response.status, 200);

  result = await first.request(`/api/driver/drivers/${encodeURIComponent(secondNick)}/block`, { method: "PUT", body: { enabled: true } });
  assert.equal(result.response.status, 200);
  result = await second.request(`/api/driver/radio/channels/${channelId}/transmissions`);
  assert.equal(result.response.status, 403);
  assert.equal(result.data.error, "driver_blocked");

  const db = openDb();
  assert.equal(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version, 12);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM radio_transmissions WHERE id = ?").get(transmissionId).n, 0);
  db.close();
});

test("general Driver chat is persistent, idempotent, cursor-based, and broadcasts committed messages", async (t) => {
  async function createChatDriver(client, username, email, nickname, countryCode = null) {
    await client.csrf();
    let result = await client.request("/api/register", {
      method: "POST",
      body: { username, email, password: "chat-password-123", confirmPassword: "chat-password-123" }
    });
    assert.equal(result.response.status, 201);
    result = await client.request("/api/driver/profile", {
      method: "PUT", body: { nickname, driverType: "GENERAL", countryCode }
    });
    assert.equal(result.response.status, 201);
  }

  function openSocket(client, origin = "http://127.0.0.1:8090") {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`${baseUrl.replace("http:", "ws:")}/api/driver/chat/socket`, {
        headers: { Cookie: client.cookieHeader(), Origin: origin }
      });
      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
    });
  }

  function nextMessage(socket, expectedType) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${expectedType}`)), 5000);
      function onMessage(raw) {
        const payload = JSON.parse(raw.toString("utf8"));
        if (payload.type !== expectedType) return;
        clearTimeout(timeout);
        socket.off("message", onMessage);
        resolve(payload);
      }
      socket.on("message", onMessage);
    });
  }

  const anonymous = new Client();
  let result = await anonymous.request("/api/driver/chat/rooms");
  assert.equal(result.response.status, 401);

  const first = new Client();
  await first.csrf();
  result = await first.request("/api/register", {
    method: "POST",
    body: { username: names.chatOne, email: names.chatOneEmail, password: "chat-password-123", confirmPassword: "chat-password-123" }
  });
  assert.equal(result.response.status, 201);
  result = await first.request("/api/driver/chat/rooms");
  assert.equal(result.response.status, 409);
  assert.equal(result.data.error, "driver_profile_required");
  result = await first.request("/api/driver/profile", { method: "PUT", body: { nickname: `ChatOne_${runId}`, driverType: "GENERAL", countryCode: "PL" } });
  assert.equal(result.response.status, 201);

  const second = new Client();
  await createChatDriver(second, names.chatTwo, names.chatTwoEmail, `ChatTwo_${runId}`, "DE");

  result = await first.request("/api/driver/chat/rooms");
  assert.equal(result.response.status, 200);
  assert.equal(result.data.rooms.length, 1);
  assert.equal(result.data.rooms[0].key, "general");
  const roomId = result.data.rooms[0].id;

  result = await first.request("/api/driver/chat/countries");
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data, { countryCode: "PL", room: null, joined: false });
  result = await first.request("/api/driver/chat/countries/DE/join", { method: "POST", body: {} });
  assert.equal(result.response.status, 403);
  assert.equal(result.data.error, "country_chat_not_eligible");
  result = await first.request("/api/driver/chat/countries/PL/join", { method: "POST", body: {} });
  assert.equal(result.response.status, 201);
  assert.equal(result.data.created, true);
  assert.equal(result.data.joined, true);
  assert.equal(result.data.room.kind, "COUNTRY");
  assert.equal(result.data.room.countryCode, "PL");
  const countryRoomId = result.data.room.id;
  result = await first.request(`/api/driver/chat/rooms/${countryRoomId}/messages`, {
    method: "POST", body: { clientMessageId: "country_msg_0001", text: "country message" }
  });
  assert.equal(result.response.status, 201);
  result = await second.request(`/api/driver/chat/rooms/${countryRoomId}/messages`);
  assert.equal(result.response.status, 404);
  result = await second.request("/api/driver/chat/rooms");
  assert.equal(result.data.rooms.some((item) => item.id === countryRoomId), false);
  result = await first.request("/api/driver/profile", {
    method: "PUT", body: { nickname: `ChatOne_${runId}`, driverType: "GENERAL", countryCode: "DE" }
  });
  assert.equal(result.response.status, 200);
  result = await first.request(`/api/driver/chat/rooms/${countryRoomId}/messages`);
  assert.equal(result.response.status, 404);
  result = await first.request("/api/driver/profile", {
    method: "PUT", body: { nickname: `ChatOne_${runId}`, driverType: "GENERAL", countryCode: "PL" }
  });
  assert.equal(result.response.status, 200);
  result = await first.request(`/api/driver/chat/rooms/${countryRoomId}/messages`);
  assert.equal(result.response.status, 200);

  result = await first.request(`/api/driver/chat/rooms/${roomId}/messages`);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data.messages, []);

  const savedCsrf = first.csrfToken;
  first.csrfToken = null;
  result = await first.request(`/api/driver/chat/rooms/${roomId}/messages`, {
    method: "POST", body: { clientMessageId: "client_msg_0001", text: "hello" }
  });
  assert.equal(result.response.status, 403);
  first.csrfToken = savedCsrf;

  result = await first.request(`/api/driver/chat/rooms/${roomId}/messages`, {
    method: "POST", body: { clientMessageId: "client_msg_0001", text: "  Привет, дорога!  " }
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.data.duplicate, false);
  assert.equal(result.data.message.text, "Привет, дорога!");
  const firstMessageId = result.data.message.id;

  result = await first.request(`/api/driver/chat/rooms/${roomId}/messages`, {
    method: "POST", body: { clientMessageId: "client_msg_0001", text: "Привет, дорога!" }
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.duplicate, true);
  assert.equal(result.data.message.id, firstMessageId);

  result = await first.request(`/api/driver/chat/rooms/${roomId}/messages`, {
    method: "POST", body: { clientMessageId: "client_msg_0001", text: "другой текст" }
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.data.error, "client_message_id_conflict");

  for (const [clientMessageId, text] of [["client_msg_0002", "Второе"], ["client_msg_0003", "Третье"]]) {
    result = await second.request(`/api/driver/chat/rooms/${roomId}/messages`, { method: "POST", body: { clientMessageId, text } });
    assert.equal(result.response.status, 201);
  }
  result = await first.request(`/api/driver/chat/rooms/${roomId}/messages?after=${firstMessageId}&limit=2`);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data.messages.map((message) => message.text), ["Второе", "Третье"]);
  assert.equal(result.data.messages[0].id < result.data.messages[1].id, true);
  const newestMessageId = result.data.messages[1].id;
  result = await first.request(`/api/driver/chat/rooms/${roomId}/messages?before=${newestMessageId}&limit=2`);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data.messages.map((message) => message.text), ["Привет, дорога!", "Второе"]);
  assert.equal(result.data.hasOlder, false);
  result = await first.request(`/api/driver/chat/rooms/${roomId}/messages?after=${firstMessageId}&before=${newestMessageId}`);
  assert.equal(result.response.status, 400);
  assert.equal(result.data.error, "invalid_chat_cursor");

  result = await first.request("/api/driver/chat/direct", { method: "POST", body: { nickname: `ChatTwo_${runId}` } });
  assert.equal(result.response.status, 201);
  assert.equal(result.data.created, true);
  assert.equal(result.data.room.kind, "DIRECT");
  assert.equal(result.data.room.title, `ChatTwo_${runId}`);
  const directRoomId = result.data.room.id;
  result = await first.request("/api/driver/chat/direct", { method: "POST", body: { nickname: `ChatTwo_${runId}` } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.created, false);
  assert.equal(result.data.room.id, directRoomId);
  result = await second.request("/api/driver/chat/rooms");
  assert.equal(result.response.status, 200);
  assert.equal(result.data.rooms.find((room) => room.id === directRoomId).title, `ChatOne_${runId}`);
  result = await first.request("/api/driver/chat/direct", { method: "POST", body: { nickname: `ChatOne_${runId}` } });
  assert.equal(result.response.status, 400);
  result = await first.request("/api/driver/chat/direct", { method: "POST", body: { nickname: "UnknownDriver" } });
  assert.equal(result.response.status, 404);

  const firstSocket = await openSocket(first);
  const secondSocket = await openSocket(second);
  t.after(() => { firstSocket.close(); secondSocket.close(); });
  let subscribed = nextMessage(firstSocket, "chat.subscribed");
  firstSocket.send(JSON.stringify({ type: "chat.subscribe", roomId }));
  assert.equal((await subscribed).roomId, roomId);
  subscribed = nextMessage(secondSocket, "chat.subscribed");
  secondSocket.send(JSON.stringify({ type: "chat.subscribe", roomId }));
  assert.equal((await subscribed).roomId, roomId);

  let firstCommitted = nextMessage(firstSocket, "chat.message.committed");
  let secondCommitted = nextMessage(secondSocket, "chat.message.committed");
  result = await first.request(`/api/driver/chat/rooms/${roomId}/messages`, {
    method: "POST", body: { clientMessageId: "client_msg_0004", text: "Сообщение через realtime" }
  });
  assert.equal(result.response.status, 201);
  const [eventOne, eventTwo] = await Promise.all([firstCommitted, secondCommitted]);
  assert.equal(eventOne.cursor, result.data.message.id);
  assert.equal(eventTwo.message.text, "Сообщение через realtime");
  const realtimeMessageId = result.data.message.id;

  result = await second.request(`/api/driver/chat/messages/${realtimeMessageId}`, { method: "DELETE", body: {} });
  assert.equal(result.response.status, 404);
  const firstDeleted = nextMessage(firstSocket, "chat.message.deleted");
  const secondDeleted = nextMessage(secondSocket, "chat.message.deleted");
  result = await first.request(`/api/driver/chat/messages/${realtimeMessageId}`, { method: "DELETE", body: {} });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data.deleted, { id: realtimeMessageId, roomId });
  const [deletedOne, deletedTwo] = await Promise.all([firstDeleted, secondDeleted]);
  assert.deepEqual(deletedOne, { type: "chat.message.deleted", roomId, messageId: realtimeMessageId });
  assert.deepEqual(deletedTwo, { type: "chat.message.deleted", roomId, messageId: realtimeMessageId });
  result = await second.request(`/api/driver/chat/rooms/${roomId}/messages`);
  assert.equal(result.data.messages.some((message) => message.id === realtimeMessageId), false);

  subscribed = nextMessage(firstSocket, "chat.subscribed");
  firstSocket.send(JSON.stringify({ type: "chat.subscribe", roomId: directRoomId }));
  assert.equal((await subscribed).roomId, directRoomId);
  subscribed = nextMessage(secondSocket, "chat.subscribed");
  secondSocket.send(JSON.stringify({ type: "chat.subscribe", roomId: directRoomId }));
  assert.equal((await subscribed).roomId, directRoomId);
  firstCommitted = nextMessage(firstSocket, "chat.message.committed");
  secondCommitted = nextMessage(secondSocket, "chat.message.committed");
  result = await first.request(`/api/driver/chat/rooms/${directRoomId}/messages`, {
    method: "POST", body: { clientMessageId: "client_direct_0001", text: "Личное сообщение" }
  });
  assert.equal(result.response.status, 201);
  const [directOne, directTwo] = await Promise.all([firstCommitted, secondCommitted]);
  assert.equal(directOne.roomId, directRoomId);
  assert.equal(directTwo.message.text, "Личное сообщение");

  result = await first.request(`/api/driver/drivers/${encodeURIComponent(`ChatTwo_${runId}`)}/block`, { method: "PUT", body: { enabled: true } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.driver.relationship, "BLOCKED");

  for (const client of [first, second]) {
    result = await client.request("/api/driver/chat/rooms");
    assert.equal(result.response.status, 200);
    assert.equal(result.data.rooms.some((item) => item.id === directRoomId), false);
    result = await client.request(`/api/driver/chat/rooms/${directRoomId}/messages`);
    assert.equal(result.response.status, 403);
    assert.equal(result.data.error, "driver_blocked");
    result = await client.request(`/api/driver/chat/rooms/${directRoomId}/messages`, {
      method: "POST", body: { clientMessageId: `blocked_${client === first ? "first" : "second"}_0001`, text: "blocked" }
    });
    assert.equal(result.response.status, 403);
    assert.equal(result.data.error, "driver_blocked");
  }
  result = await first.request("/api/driver/chat/direct", { method: "POST", body: { nickname: `ChatTwo_${runId}` } });
  assert.equal(result.response.status, 403);
  assert.equal(result.data.error, "driver_blocked");

  const blockedSocket = nextMessage(firstSocket, "chat.error");
  firstSocket.send(JSON.stringify({ type: "chat.typing", roomId: directRoomId }));
  assert.deepEqual(await blockedSocket, { type: "chat.error", roomId: directRoomId, error: "driver_blocked" });

  const db = openDb();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE sender_id = (SELECT id FROM users WHERE username = ?) AND client_message_id = ?").get(names.chatOne, "client_msg_0001").n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chat_direct_pairs WHERE room_id = ?").get(directRoomId).n, 1);
  assert.equal(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version, 12);
  db.close();
});

test("admin authorization, role rules, reset token, disabled user, audit", async () => {
  const user = new Client();
  await user.csrf();
  let result = await user.request("/api/register", {
    method: "POST",
    body: {
      username: names.bob,
      email: names.bobEmail,
      password: "bob-password-123",
      confirmPassword: "bob-password-123"
    }
  });
  assert.equal(result.response.status, 201);
  result = await user.request("/api/admin/users");
  assert.equal(result.response.status, 403);

  const owner = new Client();
  await owner.csrf();
  result = await owner.request("/api/login", {
    method: "POST",
    body: { identifier: names.owner, password: "owner-password-123" }
  });
  assert.equal(result.response.status, 200);

  result = await owner.request("/api/admin/stats");
  assert.equal(result.response.status, 200);
  assert.ok(result.data.stats.totalUsers >= 2);

  const db = openDb();
  const bob = db.prepare("SELECT id FROM users WHERE username = ?").get(names.bob);

  result = await owner.request(`/api/admin/users/${bob.id}/role`, {
    method: "POST",
    body: { role: "Administrator" }
  });
  assert.equal(result.response.status, 200);

  result = await owner.request("/api/admin/users");
  assert.equal(result.response.status, 200);
  assert.equal(result.data.users.find((item) => item.id === bob.id).role, "Administrator");
  assert.ok(!("password_hash" in result.data.users[0]));

  result = await user.request(`/api/admin/users/${bob.id}/role`, {
    method: "POST",
    body: { role: "Owner" }
  });
  assert.equal(result.response.status, 403);

  result = await owner.request(`/api/admin/users/${bob.id}/role`, {
    method: "POST",
    body: { role: "Owner" }
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.data.error, "principal_owner_exists");

  const ownerRow = db.prepare("SELECT id FROM users WHERE username = ?").get(names.owner);
  result = await owner.request(`/api/admin/users/${ownerRow.id}/role`, {
    method: "POST",
    body: { role: "Administrator" }
  });
  assert.equal(result.response.status, 403);
  assert.equal(result.data.error, "principal_owner_protected");

  result = await owner.request(`/api/admin/users/${ownerRow.id}/reset-token`, { method: "POST", body: {} });
  assert.equal(result.response.status, 403);
  result = await owner.request(`/api/admin/users/${ownerRow.id}/disable`, { method: "POST", body: {} });
  assert.equal(result.response.status, 403);
  result = await owner.request(`/api/admin/users/${ownerRow.id}/sessions`, { method: "DELETE", body: {} });
  assert.equal(result.response.status, 403);

  assert.throws(
    () => db.prepare("UPDATE users SET disabled = 1 WHERE id = ?").run(ownerRow.id),
    /principal_owner_protected/
  );

  result = await user.request(`/api/admin/users/${ownerRow.id}/reset-token`, { method: "POST", body: {} });
  assert.equal(result.response.status, 403);
  result = await user.request(`/api/admin/users/${ownerRow.id}/disable`, { method: "POST", body: {} });
  assert.equal(result.response.status, 403);
  result = await user.request(`/api/admin/users/${ownerRow.id}/sessions`, { method: "DELETE", body: {} });
  assert.equal(result.response.status, 403);

  result = await owner.request(`/api/admin/users/${bob.id}/reset-token`, { method: "POST", body: {} });
  assert.equal(result.response.status, 200);
  assert.ok(result.data.token.length > 20);

  const reset = new Client();
  await reset.csrf();
  result = await reset.request("/api/password-reset/complete", {
    method: "POST",
    body: {
      token: result.data.token,
      password: "bob-new-password-123",
      confirmPassword: "bob-new-password-123"
    }
  });
  assert.equal(result.response.status, 200);

  result = await owner.request(`/api/admin/users/${bob.id}/disable`, { method: "POST", body: {} });
  assert.equal(result.response.status, 200);

  const disabled = new Client();
  await disabled.csrf();
  result = await disabled.request("/api/login", {
    method: "POST",
    body: { identifier: names.bob, password: "bob-new-password-123" }
  });
  assert.equal(result.response.status, 401);

  const auditCount = db.prepare("SELECT COUNT(*) AS n FROM audit_events").get().n;
  assert.ok(auditCount > 0);
  db.close();
});

test("password reset requests are rate limited", async () => {
  const client = new Client();
  await client.csrf();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await client.request("/api/password-reset/request", { method: "POST", body: {} });
    assert.equal(result.response.status, 200);
  }
  const limited = await client.request("/api/password-reset/request", { method: "POST", body: {} });
  assert.equal(limited.response.status, 429);
});

test("backup creates restorable database copy", async () => {
  const backup = spawn(process.execPath, [path.join(root, "server", "auth", "backup-db.js")], {
    cwd: root,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let out = "";
  backup.stdout.on("data", (chunk) => { out += chunk; });
  const code = await new Promise((resolve) => backup.on("exit", resolve));
  assert.equal(code, 0);
  const backupPath = out.trim();
  assert.ok(fs.existsSync(backupPath));
  assert.ok(fs.statSync(backupPath).size > 0);
  assert.ok(backupPath.startsWith(path.join(runDir, "backups")));
  const backupDb = new (require("node:sqlite").DatabaseSync)(backupPath, { readOnly: true });
  const integrity = backupDb.prepare("PRAGMA integrity_check").get();
  assert.equal(integrity.integrity_check, "ok");
  assert.ok(backupDb.prepare("SELECT COUNT(*) AS n FROM users").get().n >= 3);
  backupDb.close();

  const restoredPath = path.join(runDir, "restore-check", "restored.sqlite");
  const restore = spawn(process.execPath, [path.join(root, "server", "auth", "restore-db.js"), backupPath], {
    cwd: root,
    env: {
      ...process.env,
      PATAP_DB_PATH: restoredPath,
      PATAP_AUTH_SECRET_PATH: path.join(runDir, "restore-check", "secret.key"),
      PATAP_RESTORE_CONFIRM: "YES"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let restoreError = "";
  restore.stderr.on("data", (chunk) => { restoreError += chunk; });
  const restoreCode = await new Promise((resolve) => restore.on("exit", resolve));
  assert.equal(restoreCode, 0, restoreError);
  const restoredDb = new (require("node:sqlite").DatabaseSync)(restoredPath, { readOnly: true });
  assert.equal(restoredDb.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.ok(restoredDb.prepare("SELECT COUNT(*) AS n FROM users").get().n >= 3);
  restoredDb.close();
});
