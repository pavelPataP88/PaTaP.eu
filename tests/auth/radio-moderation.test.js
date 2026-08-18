const test = require("node:test");
const assert = require("node:assert/strict");

const runId = process.env.PATAP_TEST_RUN_ID;
const baseUrl = process.env.PATAP_AUTH_BASE_URL;
if (!runId || !baseUrl || !process.env.PATAP_DB_PATH) {
  throw new Error("Radio moderation test must run through scripts/run-auth-tests.js");
}

let sequence = 0;
let ipSequence = 80;

class Client {
  constructor() {
    this.cookies = {};
    this.csrfToken = null;
    ipSequence += 1;
    this.clientIp = `198.51.100.${ipSequence}`;
  }

  cookieHeader() {
    return Object.entries(this.cookies).map(([key, value]) => `${key}=${value}`).join("; ");
  }

  storeCookies(headers) {
    for (const value of headers.getSetCookie ? headers.getSetCookie() : []) {
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

  async csrf() {
    return this.request("/api/csrf");
  }
}

async function createDriver(label) {
  sequence += 1;
  const client = new Client();
  const suffix = `${label}_${sequence}_${String(runId).slice(-7)}`;
  const username = `rm_${suffix}`.slice(0, 32);
  const nickname = `RadioMod_${suffix}`.slice(0, 32);
  await client.csrf();
  let result = await client.request("/api/register", {
    method: "POST",
    body: {
      username,
      email: `${username}_${sequence}@patap.test`,
      password: "radio-moderation-123",
      confirmPassword: "radio-moderation-123"
    }
  });
  assert.equal(result.response.status, 201);
  result = await client.request("/api/driver/profile", {
    method: "PUT",
    body: { nickname, driverType: "TIR", countryCode: "PL" }
  });
  assert.equal(result.response.status, 201);
  return { client, nickname };
}

async function makeContacts(left, right) {
  let result = await left.client.request(`/api/driver/drivers/${encodeURIComponent(right.nickname)}/contact`, {
    method: "POST",
    body: {}
  });
  assert.equal(result.response.status, 200);
  result = await right.client.request(`/api/driver/drivers/${encodeURIComponent(left.nickname)}/contact`, {
    method: "POST",
    body: {}
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.driver.relationship, "CONTACT");
}

async function expectOldLeaseGone(driver, lease) {
  const result = await driver.client.request(`/api/driver/radio/transmissions/${lease.transmissionId}/audio`, {
    method: "DELETE",
    headers: { "X-Radio-Upload-Token": lease.uploadToken },
    body: {}
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.data.error, "radio_upload_not_authorized");
}

test("role, talk-policy and membership changes revoke an active PTT lease immediately", async () => {
  const owner = await createDriver("owner");
  const member = await createDriver("member");
  await makeContacts(owner, member);

  let result = await owner.client.request("/api/driver/radio/channels", {
    method: "POST",
    body: {
      title: "Moderation Live Test",
      description: "PTT permission revocation test",
      visibility: "PRIVATE",
      talkPolicy: "EVERYONE"
    }
  });
  assert.equal(result.response.status, 201);
  const channelId = result.data.channel.id;

  result = await owner.client.request(`/api/driver/radio/channels/${channelId}/invites`, {
    method: "POST",
    body: { nickname: member.nickname }
  });
  assert.equal(result.response.status, 200);
  result = await member.client.request(`/api/driver/radio/invites/${channelId}/respond`, {
    method: "POST",
    body: { action: "ACCEPT" }
  });
  assert.equal(result.response.status, 200);

  result = await member.client.request(`/api/driver/radio/channels/${channelId}/ptt`, { method: "POST", body: {} });
  assert.equal(result.response.status, 201);
  const roleLease = result.data;

  result = await owner.client.request(`/api/driver/radio/channels/${channelId}/members/${encodeURIComponent(member.nickname)}`, {
    method: "PATCH",
    body: { role: "LISTENER" }
  });
  assert.equal(result.response.status, 200);
  await expectOldLeaseGone(member, roleLease);
  result = await member.client.request(`/api/driver/radio/channels/${channelId}/ptt`, { method: "POST", body: {} });
  assert.equal(result.response.status, 403);
  assert.equal(result.data.error, "radio_talk_not_allowed");

  result = await owner.client.request(`/api/driver/radio/channels/${channelId}/members/${encodeURIComponent(member.nickname)}`, {
    method: "PATCH",
    body: { role: "MEMBER" }
  });
  assert.equal(result.response.status, 200);
  result = await member.client.request(`/api/driver/radio/channels/${channelId}/ptt`, { method: "POST", body: {} });
  assert.equal(result.response.status, 201);
  const policyLease = result.data;

  result = await owner.client.request(`/api/driver/radio/channels/${channelId}`, {
    method: "PATCH",
    body: { talkPolicy: "BROADCAST" }
  });
  assert.equal(result.response.status, 200);
  await expectOldLeaseGone(member, policyLease);
  result = await member.client.request(`/api/driver/radio/channels/${channelId}/ptt`, { method: "POST", body: {} });
  assert.equal(result.response.status, 403);

  result = await owner.client.request(`/api/driver/radio/channels/${channelId}`, {
    method: "PATCH",
    body: { talkPolicy: "EVERYONE" }
  });
  assert.equal(result.response.status, 200);
  result = await member.client.request(`/api/driver/radio/channels/${channelId}/ptt`, { method: "POST", body: {} });
  assert.equal(result.response.status, 201);
  const removalLease = result.data;

  result = await owner.client.request(`/api/driver/radio/channels/${channelId}/members/${encodeURIComponent(member.nickname)}`, {
    method: "DELETE",
    body: { ban: false }
  });
  assert.equal(result.response.status, 200);
  await expectOldLeaseGone(member, removalLease);

  result = await member.client.request("/api/driver/radio/overview");
  assert.equal(result.response.status, 200);
  assert.equal(result.data.channels.some((item) => item.id === channelId), false);
});
