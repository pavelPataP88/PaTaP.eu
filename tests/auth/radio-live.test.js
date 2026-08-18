const test = require("node:test");
const assert = require("node:assert/strict");

const runId = process.env.PATAP_TEST_RUN_ID;
const baseUrl = process.env.PATAP_AUTH_BASE_URL;
if (!runId || !baseUrl) throw new Error("Radio live test must run through scripts/run-radio-live-test.js");

let clientSequence = 210;
let identitySequence = 0;

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

  async binaryRequest(pathname, body, headers = {}) {
    const requestHeaders = {
      Origin: "http://127.0.0.1:8090",
      "CF-Connecting-IP": this.clientIp,
      "Content-Type": "application/octet-stream",
      ...headers
    };
    if (this.csrfToken) requestHeaders["X-CSRF-Token"] = this.csrfToken;
    const cookie = this.cookieHeader();
    if (cookie) requestHeaders.Cookie = cookie;
    return fetch(`${baseUrl}${pathname}`, { method: "POST", headers: requestHeaders, body });
  }

  async openEventStream(pathname, eventName) {
    const controller = new AbortController();
    const headers = {
      Accept: "text/event-stream",
      Origin: "http://127.0.0.1:8090",
      "CF-Connecting-IP": this.clientIp
    };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${baseUrl}${pathname}`, { headers, signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    async function nextPayload(timeoutMs = 4_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const blockEnd = buffer.indexOf("\n\n");
        if (blockEnd >= 0) {
          const block = buffer.slice(0, blockEnd);
          buffer = buffer.slice(blockEnd + 2);
          const lines = block.split("\n");
          const eventLine = lines.find((line) => line.startsWith("event: "));
          const dataLine = lines.find((line) => line.startsWith("data: "));
          if (dataLine && (!eventName || eventLine?.slice(7) === eventName)) return JSON.parse(dataLine.slice(6));
          continue;
        }
        const remaining = Math.max(1, deadline - Date.now());
        const result = await Promise.race([
          reader.read(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("radio_live_sse_timeout")), remaining))
        ]);
        if (result.done) throw new Error("radio_live_sse_closed");
        buffer += decoder.decode(result.value, { stream: true }).replaceAll("\r\n", "\n");
      }
      throw new Error("radio_live_sse_timeout");
    }

    return {
      nextPayload,
      async close() {
        controller.abort();
        await reader.cancel().catch(() => {});
      }
    };
  }
}

async function createDriver(label) {
  identitySequence += 1;
  const client = new Client();
  const tag = `${label}_${identitySequence}_${runId}`;
  const nickname = `RadioLive_${label}_${identitySequence}_${String(runId).slice(-6)}`.slice(0, 32);
  await client.csrf();
  let result = await client.request("/api/register", {
    method: "POST",
    body: {
      username: `rl_${tag}`.slice(0, 32),
      email: `rl_${tag}@patap.test`,
      password: "radio-live-123",
      confirmPassword: "radio-live-123"
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

test("live PCM reaches an authorized listener before commit and the same PTT session is then saved to history", async () => {
  const speaker = await createDriver("speaker");
  const listener = await createDriver("listener");

  let result = await speaker.client.request("/api/driver/radio/overview");
  assert.equal(result.response.status, 200);
  const general = result.data.channels.find((item) => item.kind === "GENERAL");
  assert.ok(general);

  result = await listener.client.request("/api/driver/radio/overview");
  assert.equal(result.response.status, 200);
  assert.equal(result.data.channels.some((item) => item.id === general.id), true);

  const liveEvents = await listener.client.openEventStream("/api/driver/radio/live-events", "radio-live");
  try {
    const ready = await liveEvents.nextPayload();
    assert.equal(ready.type, "radio.live.ready");

    result = await speaker.client.request(`/api/driver/radio/channels/${general.id}/ptt`, { method: "POST", body: {} });
    assert.equal(result.response.status, 201);
    const lease = result.data;

    const pcm = Buffer.alloc(8_000);
    for (let offset = 0; offset < pcm.length; offset += 2) pcm.writeInt16LE((offset * 13) % 30_000, offset);

    let response = await speaker.client.binaryRequest(
      `/api/driver/radio/live/${lease.transmissionId}`,
      pcm,
      {
        "X-Radio-Upload-Token": "wrong-token",
        "X-Radio-Live-Sequence": "0",
        "X-Radio-Live-Sample-Rate": "16000"
      }
    );
    assert.equal(response.status, 409);

    response = await speaker.client.binaryRequest(
      `/api/driver/radio/live/${lease.transmissionId}`,
      pcm,
      {
        "X-Radio-Upload-Token": lease.uploadToken,
        "X-Radio-Live-Sequence": "0",
        "X-Radio-Live-Sample-Rate": "16000"
      }
    );
    assert.equal(response.status, 202);
    assert.equal((await response.json()).sequence, 0);

    const live = await liveEvents.nextPayload();
    assert.equal(live.type, "radio.live");
    assert.equal(live.end, undefined);
    assert.equal(live.channelId, general.id);
    assert.equal(live.transmissionId, lease.transmissionId);
    assert.equal(live.sequence, 0);
    assert.equal(live.sampleRate, 16_000);
    assert.equal(Buffer.from(live.audio, "base64").length, pcm.length);

    response = await speaker.client.binaryRequest(
      `/api/driver/radio/live/${lease.transmissionId}`,
      Buffer.alloc(0),
      {
        "X-Radio-Upload-Token": lease.uploadToken,
        "X-Radio-Live-End": "1",
        "X-Radio-Live-Sequence": "0"
      }
    );
    assert.equal(response.status, 202);
    assert.equal((await response.json()).finalSequence, 0);

    const end = await liveEvents.nextPayload();
    assert.equal(end.type, "radio.live");
    assert.equal(end.end, true);
    assert.equal(end.transmissionId, lease.transmissionId);
    assert.equal(end.finalSequence, 0);

    response = await speaker.client.binaryRequest(
      `/api/driver/radio/transmissions/${lease.transmissionId}/audio`,
      Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
      {
        "Content-Type": "audio/webm",
        "X-Radio-Upload-Token": lease.uploadToken
      }
    );
    assert.equal(response.status, 201);
    const committed = await response.json();
    assert.equal(committed.transmission.id, lease.transmissionId);

    result = await listener.client.request(`/api/driver/radio/channels/${general.id}/transmissions?limit=10`);
    assert.equal(result.response.status, 200);
    const saved = result.data.transmissions.find((item) => item.id === lease.transmissionId);
    assert.ok(saved);
    assert.equal(saved.sender.nickname, speaker.nickname);
  } finally {
    await liveEvents.close();
  }
});
