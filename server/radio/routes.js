const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createRadioRepository } = require("./repository");

const AUDIO_TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4"]);
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;

function audioMimeType(header) {
  const value = String(header || "").split(";", 1)[0].trim().toLowerCase();
  return AUDIO_TYPES.has(value) ? value : null;
}

function createRadioRoutes({ db, json, requireSession, requireCsrf, checkRate, audit, nowIso, hashToken, randomToken, dataDir, readBinaryBody }) {
  const radio = createRadioRepository(db, { hashToken, randomToken });
  const storageDir = path.join(dataDir, "radio");

  function requireRadioUser(req, res) {
    const session = requireSession(req, res);
    if (!session) return null;
    if (!radio.hasProfile(session.user.id)) {
      json(res, 409, { error: "driver_profile_required" });
      return null;
    }
    return session;
  }

  function inaccessible(res, error) {
    json(res, error === "driver_blocked" ? 403 : 404, { error });
  }

  function respond(res, status, payload) {
    json(res, status, payload);
    return true;
  }

  function releaseFailedUpload(userId, transmissionId, uploadToken) {
    try {
      return radio.cancelTransmission(userId, transmissionId, uploadToken);
    } catch {
      return false;
    }
  }

  return async function handleRadioRoute(req, res, url, body) {
    if (!url.pathname.startsWith("/api/driver/radio/")) return false;

    if (req.method === "GET" && url.pathname === "/api/driver/radio/channels") {
      const session = requireRadioUser(req, res);
      if (session) json(res, 200, { channels: radio.listChannels(session.user.id, nowIso()) });
      return true;
    }

    const messagesMatch = url.pathname.match(/^\/api\/driver\/radio\/channels\/(\d+)\/transmissions$/);
    if (req.method === "GET" && messagesMatch) {
      const session = requireRadioUser(req, res);
      if (!session) return true;
      const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 30;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        json(res, 400, { error: "invalid_radio_limit" });
        return true;
      }
      const result = radio.listTransmissions(session.user.id, Number(messagesMatch[1]), nowIso(), limit);
      if (result.error) inaccessible(res, result.error);
      else json(res, 200, result);
      return true;
    }

    const audioMatch = url.pathname.match(/^\/api\/driver\/radio\/transmissions\/(\d+)\/audio$/);
    if (req.method === "GET" && audioMatch) {
      const session = requireRadioUser(req, res);
      if (!session) return true;
      const record = radio.audioForUser(session.user.id, Number(audioMatch[1]), nowIso());
      if (!record) return respond(res, 404, { error: "radio_transmission_not_found" });
      const file = path.join(storageDir, record.storage_key);
      try {
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size !== Number(record.byte_length)) throw new Error("radio_file_invalid");
        res.writeHead(200, {
          "Content-Type": record.mime_type,
          "Content-Length": stat.size,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        });
        fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
      } catch {
        json(res, 404, { error: "radio_transmission_not_found" });
      }
      return true;
    }

    if (req.method === "POST" && audioMatch && body === undefined) {
      const session = requireRadioUser(req, res);
      if (!session || !requireCsrf(req, res, session)) return true;
      const mimeType = audioMimeType(req.headers["content-type"]);
      if (!mimeType) return respond(res, 415, { error: "unsupported_radio_audio" });
      const uploadToken = String(req.headers["x-radio-upload-token"] || "");
      const transmissionId = Number(audioMatch[1]);
      let audio;
      try {
        audio = await readBinaryBody(req, MAX_AUDIO_BYTES);
      } catch (error) {
        releaseFailedUpload(session.user.id, transmissionId, uploadToken);
        json(res, error.status || 400, { error: error.message || "invalid_radio_audio" });
        return true;
      }
      if (!audio.length) return respond(res, 400, { error: "empty_radio_audio" });
      const target = radio.uploadTarget(session.user.id, transmissionId, uploadToken, nowIso());
      if (!target) return respond(res, 409, { error: "radio_upload_not_authorized" });
      fs.mkdirSync(storageDir, { recursive: true, mode: 0o700 });
      const finalPath = path.join(storageDir, target.storage_key);
      const temporaryPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporaryPath, audio, { flag: "wx", mode: 0o600 });
        fs.renameSync(temporaryPath, finalPath);
        const committed = radio.commitUpload(session.user.id, transmissionId, uploadToken, { mimeType, byteLength: audio.length }, nowIso());
        if (!committed) throw new Error("radio_upload_not_authorized");
        audit(req, "radio_transmission_committed", { userId: session.user.id, success: true, details: { channelId: committed.channelId, transmissionId: committed.id } });
        json(res, 201, { transmission: committed });
      } catch (error) {
        fs.rmSync(temporaryPath, { force: true });
        fs.rmSync(finalPath, { force: true });
        json(res, error.message === "radio_upload_not_authorized" ? 409 : 500, { error: error.message === "radio_upload_not_authorized" ? error.message : "radio_upload_failed" });
      }
      return true;
    }

    if (req.method === "DELETE" && audioMatch) {
      const session = requireRadioUser(req, res);
      if (!session || !requireCsrf(req, res, session)) return true;
      const uploadToken = String(req.headers["x-radio-upload-token"] || "");
      const cancelled = radio.cancelTransmission(session.user.id, Number(audioMatch[1]), uploadToken);
      if (!cancelled) return respond(res, 409, { error: "radio_upload_not_authorized" });
      audit(req, "radio_transmission_cancelled", { userId: session.user.id, success: true, details: { transmissionId: Number(audioMatch[1]) } });
      return respond(res, 200, { ok: true });
    }

    const deleteTransmissionMatch = url.pathname.match(/^\/api\/driver\/radio\/transmissions\/(\d+)$/);
    if (req.method === "DELETE" && deleteTransmissionMatch) {
      const session = requireRadioUser(req, res);
      if (!session || !requireCsrf(req, res, session)) return true;
      if (!checkRate(`radio-delete:user:${session.user.id}`, 30, 1)) {
        return respond(res, 429, { error: "radio_rate_limited" });
      }
      const transmissionId = Number(deleteTransmissionMatch[1]);
      const target = radio.committedDeletionTarget(session.user.id, transmissionId);
      if (!target) return respond(res, 404, { error: "radio_transmission_not_found" });
      try {
        fs.rmSync(path.join(storageDir, target.storage_key), { force: true });
      } catch {
        return respond(res, 500, { error: "radio_delete_failed" });
      }
      if (!radio.deleteCommittedTransmission(session.user.id, transmissionId)) {
        return respond(res, 409, { error: "radio_delete_conflict" });
      }
      audit(req, "radio_transmission_deleted", {
        userId: session.user.id,
        success: true,
        details: { channelId: Number(target.channel_id), transmissionId }
      });
      return respond(res, 200, {
        deleted: { id: transmissionId, channelId: Number(target.channel_id) }
      });
    }

    if (body === undefined) return false;
    if (req.method === "POST" && url.pathname === "/api/driver/radio/direct") {
      const session = requireRadioUser(req, res);
      if (!session || !requireCsrf(req, res, session)) return true;
      if (!checkRate(`radio-direct:user:${session.user.id}`, 20, 1)) return respond(res, 429, { error: "radio_rate_limited" });
      const result = radio.createDirectChannel(session.user.id, body?.nickname, nowIso());
      if (result.error) return respond(res, result.status, { error: result.error });
      if (result.created) audit(req, "radio_direct_created", { userId: session.user.id, success: true, details: { channelId: result.channel.id } });
      return respond(res, result.created ? 201 : 200, result);
    }

    const pttMatch = url.pathname.match(/^\/api\/driver\/radio\/channels\/(\d+)\/ptt$/);
    if (req.method === "POST" && pttMatch) {
      const session = requireRadioUser(req, res);
      if (!session || !requireCsrf(req, res, session)) return true;
      if (!checkRate(`radio-ptt:user:${session.user.id}`, 30, 1)) return respond(res, 429, { error: "radio_rate_limited" });
      const result = radio.beginTransmission(session.user.id, Number(pttMatch[1]), nowIso());
      if (result.error) return respond(res, result.status, { error: result.error, speaker: result.speaker });
      audit(req, "radio_ptt_granted", { userId: session.user.id, success: true, details: { channelId: Number(pttMatch[1]), transmissionId: result.transmissionId } });
      return respond(res, 201, result);
    }
    return false;
  };
}

module.exports = { createRadioRoutes, MAX_AUDIO_BYTES };
