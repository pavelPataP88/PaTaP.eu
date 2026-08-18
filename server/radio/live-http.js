const LIVE_SAMPLE_RATE = 16_000;
const MAX_LIVE_CHUNK_BYTES = 12 * 1024;
const MAX_LIVE_CHUNKS = 320;
const MAX_LIVE_TOTAL_BYTES = 2_400_000;
const LIVE_HEARTBEAT_MS = 20_000;

function createRadioLiveHttp({ radio, requireSession, requireCsrf, json, nowIso, readBinaryBody }) {
  const listeners = new Set();
  const counters = new Map();

  function requireLiveUser(req, res, { mutation = false } = {}) {
    const session = requireSession(req, res);
    if (!session) return null;
    if (!radio.hasProfile(session.user.id)) {
      json(res, 409, { error: "driver_profile_required" });
      return null;
    }
    radio.ensureGeneralMembership(session.user.id, nowIso());
    if (mutation && !requireCsrf(req, res, session)) return null;
    return session;
  }

  function sendEvent(client, payload) {
    try {
      client.res.write(`event: radio-live\ndata: ${JSON.stringify(payload)}\n\n`);
      return true;
    } catch {
      listeners.delete(client);
      return false;
    }
  }

  const heartbeat = setInterval(() => {
    for (const client of [...listeners]) {
      try { client.res.write(`: live-keepalive ${Date.now()}\n\n`); }
      catch { listeners.delete(client); }
    }
  }, LIVE_HEARTBEAT_MS);
  heartbeat.unref?.();

  function canReceive(userId, channelId) {
    return !radio.channelAccessError(userId, channelId);
  }

  function broadcast(senderUserId, target, sequence, audio) {
    const channelId = Number(target.channel_id);
    const payload = {
      type: "radio.live",
      channelId,
      transmissionId: Number(target.id),
      sequence,
      sampleRate: LIVE_SAMPLE_RATE,
      audio: Buffer.from(audio).toString("base64")
    };
    for (const client of [...listeners]) {
      if (Number(client.userId) === Number(senderUserId)) continue;
      if (!canReceive(client.userId, channelId)) continue;
      sendEvent(client, payload);
    }
  }

  function acceptCounter(transmissionId, byteLength) {
    const id = Number(transmissionId);
    const current = counters.get(id) || { chunks: 0, bytes: 0, lastSequence: -1 };
    const nextChunks = current.chunks + 1;
    const nextBytes = current.bytes + Number(byteLength || 0);
    if (nextChunks > MAX_LIVE_CHUNKS || nextBytes > MAX_LIVE_TOTAL_BYTES) return null;
    current.chunks = nextChunks;
    current.bytes = nextBytes;
    counters.set(id, current);
    return current;
  }

  function clearTransmission(transmissionId) {
    counters.delete(Number(transmissionId));
  }

  async function handle(req, res, url, body) {
    if (req.method === "GET" && url.pathname === "/api/driver/radio/live-events") {
      const session = requireLiveUser(req, res);
      if (!session) return true;
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "Connection": "keep-alive",
        "X-Content-Type-Options": "nosniff",
        "X-Accel-Buffering": "no"
      });
      res.write("retry: 3000\n\n");
      const client = { res, userId: session.user.id };
      listeners.add(client);
      sendEvent(client, { type: "radio.live.ready" });
      const close = () => listeners.delete(client);
      req.once("close", close);
      req.once("aborted", close);
      return true;
    }

    const liveMatch = url.pathname.match(/^\/api\/driver\/radio\/live\/(\d+)$/);
    if (req.method === "POST" && liveMatch && body === undefined) {
      const session = requireLiveUser(req, res, { mutation: true });
      if (!session) return true;
      const transmissionId = Number(liveMatch[1]);
      const uploadToken = String(req.headers["x-radio-upload-token"] || "");
      const sequence = Number(req.headers["x-radio-live-sequence"]);
      const sampleRate = Number(req.headers["x-radio-live-sample-rate"]);
      if (!Number.isSafeInteger(transmissionId) || !Number.isSafeInteger(sequence) || sequence < 0 || sampleRate !== LIVE_SAMPLE_RATE) {
        json(res, 400, { error: "invalid_radio_live_chunk" });
        return true;
      }
      const target = radio.uploadTarget(session.user.id, transmissionId, uploadToken, nowIso());
      if (!target) {
        json(res, 409, { error: "radio_upload_not_authorized" });
        return true;
      }
      let audio;
      try {
        audio = await readBinaryBody(req, MAX_LIVE_CHUNK_BYTES);
      } catch (error) {
        json(res, error.status || 400, { error: error.message || "invalid_radio_live_chunk" });
        return true;
      }
      if (!audio.length || audio.length % 2 !== 0) {
        json(res, 400, { error: "invalid_radio_live_chunk" });
        return true;
      }
      const counter = acceptCounter(transmissionId, audio.length);
      if (!counter) {
        json(res, 429, { error: "radio_live_rate_limited" });
        return true;
      }
      if (sequence <= counter.lastSequence) {
        json(res, 409, { error: "radio_live_sequence_conflict" });
        return true;
      }
      counter.lastSequence = sequence;
      broadcast(session.user.id, target, sequence, audio);
      json(res, 202, { ok: true, sequence });
      return true;
    }

    return false;
  }

  return {
    handle,
    clearTransmission,
    close() {
      clearInterval(heartbeat);
      for (const client of [...listeners]) {
        try { client.res.end(); } catch {}
      }
      listeners.clear();
      counters.clear();
    }
  };
}

module.exports = {
  createRadioLiveHttp,
  LIVE_SAMPLE_RATE,
  MAX_LIVE_CHUNK_BYTES,
  MAX_LIVE_CHUNKS,
  MAX_LIVE_TOTAL_BYTES,
  LIVE_HEARTBEAT_MS
};
