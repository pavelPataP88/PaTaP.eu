const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createRadioRepository } = require("./repository");
const { createRadioLiveHttp } = require("./live-http");
const { createRadioRetentionCleaner, startRadioRetentionCleanup } = require("./retention");
const { createMediaQuota } = require("../storage/quota");

const AUDIO_TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4"]);
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const RADIO_EVENT_HEARTBEAT_MS = 20_000;

function audioMimeType(header) {
  const value = String(header || "").split(";", 1)[0].trim().toLowerCase();
  return AUDIO_TYPES.has(value) ? value : null;
}

function createRadioRoutes({ db, json, requireSession, requireCsrf, checkRate, audit, nowIso, hashToken, randomToken, dataDir, readBinaryBody }) {
  const radio = createRadioRepository(db, { hashToken, randomToken, nowIso });
  const storageDir = path.join(dataDir, "radio");
  const mediaQuota = createMediaQuota({ db, dataDir });
  const eventClients = new Set();
  const live = createRadioLiveHttp({ radio, requireSession, requireCsrf, json, nowIso, readBinaryBody });
  startRadioRetentionCleanup({ cleaner: createRadioRetentionCleaner({ db, storageDir, nowIso }) });

  function sendRadioEvent(res, payload) {
    try {
      res.write(`event: radio\ndata: ${JSON.stringify(payload)}\n\n`);
      return true;
    } catch {
      eventClients.delete(res);
      return false;
    }
  }

  function signalRefresh(reason = "state") {
    const payload = { type: "radio.refresh", reason };
    for (const res of [...eventClients]) sendRadioEvent(res, payload);
  }

  const heartbeat = setInterval(() => {
    for (const res of [...eventClients]) {
      try { res.write(`: keepalive ${Date.now()}\n\n`); }
      catch { eventClients.delete(res); }
    }
  }, RADIO_EVENT_HEARTBEAT_MS);
  heartbeat.unref?.();

  function requireRadioUser(req, res) {
    const session = requireSession(req, res);
    if (!session) return null;
    if (!radio.hasProfile(session.user.id)) {
      json(res, 409, { error: "driver_profile_required" });
      return null;
    }
    radio.ensureGeneralMembership(session.user.id, nowIso());
    return session;
  }

  function inaccessible(res, error) {
    const status = ["driver_blocked", "radio_talk_not_allowed", "radio_channel_banned", "radio_channel_forbidden"].includes(error) ? 403 : 404;
    json(res, status, { error });
  }

  function respond(res, status, payload) {
    json(res, status, payload);
    return true;
  }

  function releaseFailedUpload(userId, transmissionId, uploadToken) {
    try {
      const released = radio.cancelTransmission(userId, transmissionId, uploadToken);
      live.clearTransmission(transmissionId);
      if (released) signalRefresh("speaker_released");
      return released;
    } catch {
      live.clearTransmission(transmissionId);
      return false;
    }
  }

  function requireMutation(req, res) {
    const session = requireRadioUser(req, res);
    if (!session || !requireCsrf(req, res, session)) return null;
    return session;
  }

  return async function handleRadioRoute(req, res, url, body) {
    if (!url.pathname.startsWith("/api/driver/radio/")) return false;
    if (await live.handle(req, res, url, body)) return true;

    if (req.method === "GET" && url.pathname === "/api/driver/radio/events") {
      const session = requireRadioUser(req, res);
      if (!session) return true;
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "Connection": "keep-alive",
        "X-Content-Type-Options": "nosniff",
        "X-Accel-Buffering": "no"
      });
      res.write("retry: 3000\n\n");
      eventClients.add(res);
      sendRadioEvent(res, { type: "radio.ready" });
      const close = () => eventClients.delete(res);
      req.once("close", close);
      req.once("aborted", close);
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/driver/radio/overview") {
      const session = requireRadioUser(req, res);
      if (session) json(res, 200, radio.overview(session.user.id, nowIso()));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/driver/radio/channels") {
      const session = requireRadioUser(req, res);
      if (session) json(res, 200, { channels: radio.listChannels(session.user.id, nowIso()) });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/driver/radio/discover") {
      const session = requireRadioUser(req, res);
      if (!session) return true;
      return respond(res, 200, { channels: radio.discoverChannels(session.user.id, url.searchParams.get("q") || "", nowIso()) });
    }

    const channelDetailsMatch = url.pathname.match(/^\/api\/driver\/radio\/channels\/(\d+)$/);
    if (req.method === "GET" && channelDetailsMatch) {
      const session = requireRadioUser(req, res);
      if (!session) return true;
      const channelId = Number(channelDetailsMatch[1]);
      const channel = radio.listChannels(session.user.id, nowIso()).find((item) => item.id === channelId);
      if (!channel) return respond(res, 404, { error: "radio_channel_not_found" });
      const members = radio.listMembers(session.user.id, channelId);
      const pins = radio.listPins(session.user.id, channelId, nowIso());
      return respond(res, 200, { channel, members: members.members || [], pins: pins.pins || [] });
    }

    const membersMatch = url.pathname.match(/^\/api\/driver\/radio\/channels\/(\d+)\/members$/);
    if (req.method === "GET" && membersMatch) {
      const session = requireRadioUser(req, res);
      if (!session) return true;
      const result = radio.listMembers(session.user.id, Number(membersMatch[1]));
      if (result.error) return respond(res, result.status || 404, { error: result.error });
      return respond(res, 200, result);
    }

    const pinsMatch = url.pathname.match(/^\/api\/driver\/radio\/channels\/(\d+)\/pins$/);
    if (req.method === "GET" && pinsMatch) {
      const session = requireRadioUser(req, res);
      if (!session) return true;
      const result = radio.listPins(session.user.id, Number(pinsMatch[1]), nowIso());
      if (result.error) return respond(res, result.status || 404, { error: result.error });
      return respond(res, 200, result);
    }

    const messagesMatch = url.pathname.match(/^\/api\/driver\/radio\/channels\/(\d+)\/transmissions$/);
    if (req.method === "GET" && messagesMatch) {
      const session = requireRadioUser(req, res);
      if (!session) return true;
      const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 30;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return respond(res, 400, { error: "invalid_radio_limit" });
      const result = radio.listTransmissions(session.user.id, Number(messagesMatch[1]), nowIso(), limit);
      if (result.error) inaccessible(res, result.error); else json(res, 200, result);
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
      const session = requireMutation(req, res);
      if (!session) return true;
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
      if (!audio.length) {
        releaseFailedUpload(session.user.id, transmissionId, uploadToken);
        return respond(res, 400, { error: "empty_radio_audio" });
      }
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
        live.clearTransmission(transmissionId);
        audit(req, "radio_transmission_committed", { userId: session.user.id, success: true, details: { channelId: committed.channelId, transmissionId: committed.id } });
        signalRefresh("transmission_committed");
        json(res, 201, { transmission: committed });
      } catch (error) {
        live.clearTransmission(transmissionId);
        fs.rmSync(temporaryPath, { force: true });
        fs.rmSync(finalPath, { force: true });
        json(res, error.message === "radio_upload_not_authorized" ? 409 : 500, { error: error.message === "radio_upload_not_authorized" ? error.message : "radio_upload_failed" });
      }
      return true;
    }

    if (req.method === "DELETE" && audioMatch) {
      const session = requireMutation(req, res);
      if (!session) return true;
      const transmissionId = Number(audioMatch[1]);
      const uploadToken = String(req.headers["x-radio-upload-token"] || "");
      const cancelled = radio.cancelTransmission(session.user.id, transmissionId, uploadToken);
      live.clearTransmission(transmissionId);
      if (!cancelled) return respond(res, 409, { error: "radio_upload_not_authorized" });
      audit(req, "radio_transmission_cancelled", { userId: session.user.id, success: true, details: { transmissionId } });
      signalRefresh("speaker_released");
      return respond(res, 200, { ok: true });
    }

    const deleteTransmissionMatch = url.pathname.match(/^\/api\/driver\/radio\/transmissions\/(\d+)$/);
    if (req.method === "DELETE" && deleteTransmissionMatch) {
      const session = requireMutation(req, res);
      if (!session) return true;
      if (!checkRate(`radio-delete:user:${session.user.id}`, 30, 1)) return respond(res, 429, { error: "radio_rate_limited" });
      const transmissionId = Number(deleteTransmissionMatch[1]);
      const target = radio.committedDeletionTarget(session.user.id, transmissionId);
      if (!target) return respond(res, 404, { error: "radio_transmission_not_found" });
      try { fs.rmSync(path.join(storageDir, target.storage_key), { force: true }); }
      catch { return respond(res, 500, { error: "radio_delete_failed" }); }
      if (!radio.deleteCommittedTransmission(session.user.id, transmissionId)) return respond(res, 409, { error: "radio_delete_conflict" });
      live.clearTransmission(transmissionId);
      audit(req, "radio_transmission_deleted", { userId: session.user.id, success: true, details: { channelId: Number(target.channel_id), transmissionId } });
      signalRefresh("transmission_deleted");
      return respond(res, 200, { deleted: { id: transmissionId, channelId: Number(target.channel_id) } });
    }

    if (body === undefined) return false;

    if (req.method === "POST" && url.pathname === "/api/driver/radio/direct") {
      const session = requireMutation(req, res);
      if (!session) return true;
      if (!checkRate(`radio-direct:user:${session.user.id}`, 20, 1)) return respond(res, 429, { error: "radio_rate_limited" });
      const result = radio.createDirectChannel(session.user.id, body?.nickname, nowIso());
      if (result.error) return respond(res, result.status, { error: result.error });
      if (result.created) {
        audit(req, "radio_direct_created", { userId: session.user.id, success: true, details: { channelId: result.channel.id } });
        signalRefresh("direct_created");
      }
      return respond(res, result.created ? 201 : 200, result);
    }

    if (req.method === "POST" && url.pathname === "/api/driver/radio/channels") {
      const session = requireMutation(req, res);
      if (!session) return true;
      if (!checkRate(`radio-create-channel:user:${session.user.id}`, 8, 60)) return respond(res, 429, { error: "radio_rate_limited" });
      const result = radio.createGroupChannel(session.user.id, body, nowIso());
      if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, "radio_channel_created", { userId: session.user.id, success: true, details: { channelId: result.channel.id, visibility: result.channel.visibility, talkPolicy: result.channel.talkPolicy } });
      signalRefresh("channel_created");
      return respond(res, 201, result);
    }

    if (req.method === "PATCH" && channelDetailsMatch) {
      const session = requireMutation(req, res);
      if (!session) return true;
      const result = radio.updateChannel(session.user.id, Number(channelDetailsMatch[1]), body, nowIso());
      if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, "radio_channel_updated", { userId: session.user.id, success: true, details: { channelId: Number(channelDetailsMatch[1]) } });
      signalRefresh("channel_updated");
      return respond(res, 200, result);
    }

    if (req.method === "DELETE" && channelDetailsMatch) {
      const session = requireMutation(req, res);
      if (!session) return true;
      const channelId = Number(channelDetailsMatch[1]);
      const target = radio.channelDeletionTarget(session.user.id, channelId);
      if (target.error) return respond(res, target.status, { error: target.error });
      try { for (const storageKey of target.storageKeys) fs.rmSync(path.join(storageDir, storageKey), { force: true }); }
      catch { return respond(res, 500, { error: "radio_delete_failed" });
      }
      const result = radio.deleteGroupChannel(session.user.id, channelId);
      if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, "radio_channel_deleted", { userId: session.user.id, success: true, details: { channelId } });
      signalRefresh("channel_deleted");
      return respond(res, 200, { deleted: true, channelId });
    }

    const joinMatch = url.pathname.match(/^\/api\/driver\/radio\/channels\/(\d+)\/join$/);
    if (req.method === "POST" && joinMatch) {
      const session = requireMutation(req, res);
      if (!session) return true;
      if (!checkRate(`radio-join:user:${session.user.id}`, 30, 60)) return respond(res, 429, { error: "radio_rate_limited" });
      const result = radio.joinPublicChannel(session.user.id, Number(joinMatch[1]), nowIso());
      if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, "radio_channel_joined", { userId: session.user.id, success: true, details: { channelId: Number(joinMatch[1]) } });
      signalRefresh("member_joined");
      return respond(res, 200, result);
    }

    const leaveMatch = url.pathname.match(/^\/api\/driver\/radio\/channels\/(\d+)\/leave$/);
    if (req.method === "POST" && leaveMatch) {
      const session = requireMutation(req, res);
      if (!session) return true;
      const result = radio.leaveChannel(session.user.id, Number(leaveMatch[1]));
      if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, "radio_channel_left", { userId: session.user.id, success: true, details: { channelId: Number(leaveMatch[1]) } });
      signalRefresh("member_left");
      return respond(res, 200, result);
    }

    const inviteMatch = url.pathname.match(/^\/api\/driver\/radio\/channels\/(\d+)\/invites$/);
    if (req.method === "POST" && inviteMatch) {
      const session = requireMutation(req, res);
      if (!session) return true;
      if (!checkRate(`radio-invite:user:${session.user.id}`, 30, 60)) return respond(res, 429, { error: "radio_rate_limited" });
      const result = radio.inviteToChannel(session.user.id, Number(inviteMatch[1]), body?.nickname, nowIso());
      if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, "radio_channel_invited", { userId: session.user.id, success: true, details: { channelId: Number(inviteMatch[1]) } });
      signalRefresh("invite_created");
      return respond(res, 200, result);
    }

    const inviteResponseMatch = url.pathname.match(/^\/api\/driver\/radio\/invites\/(\d+)\/respond$/);
    if (req.method === "POST" && inviteResponseMatch) {
      const session = requireMutation(req, res);
      if (!session) return true;
      const result = radio.respondToInvite(session.user.id, Number(inviteResponseMatch[1]), body?.action, nowIso());
      if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, result.accepted ? "radio_channel_invite_accepted" : "radio_channel_invite_declined", { userId: session.user.id, success: true, details: { channelId: Number(inviteResponseMatch[1]) } });
      signalRefresh("invite_resolved");
      return respond(res, 200, result);
    }

    const preferencesMatch = url.pathname.match(/^\/api\/driver\/radio\/channels\/(\d+)\/preferences$/);
    if (req.method === "PATCH" && preferencesMatch) {
      const session = requireMutation(req, res);
      if (!session) return true;
      const result = radio.updateChannelPreferences(session.user.id, Number(preferencesMatch[1]), body);
      if (result.error) return respond(res, result.status, { error: result.error });
      return respond(res, 200, { preferences: result });
    }

    if (req.method === "PATCH" && url.pathname === "/api/driver/radio/settings") {
      const session = requireMutation(req, res);
      if (!session) return true;
      const result = radio.updateSettings(session.user.id, body, nowIso());
      if (result.error) return respond(res, result.status, { error: result.error });
      return respond(res, 200, result);
    }

    const memberActionMatch = url.pathname.match(/^\/api\/driver\/radio\/channels\/(\d+)\/members\/([^/]+)$/);
    if (req.method === "PATCH" && memberActionMatch) {
      const session = requireMutation(req, res);
      if (!session) return true;
      const result = radio.setMemberRole(session.user.id, Number(memberActionMatch[1]), decodeURIComponent(memberActionMatch[2]), body?.role);
      if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, "radio_member_role_changed", { userId: session.user.id, success: true, details: { channelId: Number(memberActionMatch[1]), role: result.role } });
      signalRefresh("member_role_changed");
      return respond(res, 200, result);
    }

    if (req.method === "DELETE" && memberActionMatch) {
      const session = requireMutation(req, res);
      if (!session) return true;
      const result = radio.removeMember(session.user.id, Number(memberActionMatch[1]), decodeURIComponent(memberActionMatch[2]), { ban: Boolean(body?.ban) }, nowIso());
      if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, result.banned ? "radio_member_banned" : "radio_member_removed", { userId: session.user.id, success: true, details: { channelId: Number(memberActionMatch[1]) } });
      signalRefresh(result.banned ? "member_banned" : "member_removed");
      return respond(res, 200, result);
    }

    const banMatch = url.pathname.match(/^\/api\/driver\/radio\/channels\/(\d+)\/bans\/([^/]+)$/);
    if (req.method === "DELETE" && banMatch) {
      const session = requireMutation(req, res);
      if (!session) return true;
      const result = radio.unbanMember(session.user.id, Number(banMatch[1]), decodeURIComponent(banMatch[2]));
      if (result.error) return respond(res, result.status, { error: result.error });
      signalRefresh("member_unbanned");
      return respond(res, 200, result);
    }

    const alertMatch = url.pathname.match(/^\/api\/driver\/radio\/channels\/(\d+)\/alerts$/);
    if (req.method === "POST" && alertMatch) {
      const session = requireMutation(req, res);
      if (!session) return true;
      if (!checkRate(`radio-alert:user:${session.user.id}`, 6, 10)) return respond(res, 429, { error: "radio_rate_limited" });
      const result = radio.sendAlert(session.user.id, Number(alertMatch[1]), nowIso());
      if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, "radio_channel_alert", { userId: session.user.id, success: true, details: { channelId: Number(alertMatch[1]), alertId: result.alert.id } });
      signalRefresh("alert_created");
      return respond(res, 201, result);
    }

    const pinActionMatch = url.pathname.match(/^\/api\/driver\/radio\/channels\/(\d+)\/pins\/(\d+)$/);
    if (req.method === "POST" && pinActionMatch) {
      const session = requireMutation(req, res);
      if (!session) return true;
      const result = radio.pinTransmission(session.user.id, Number(pinActionMatch[1]), Number(pinActionMatch[2]), nowIso());
      if (result.error) return respond(res, result.status, { error: result.error });
      signalRefresh("pin_changed");
      return respond(res, 200, result);
    }
    if (req.method === "DELETE" && pinActionMatch) {
      const session = requireMutation(req, res);
      if (!session) return true;
      const result = radio.unpinTransmission(session.user.id, Number(pinActionMatch[1]), Number(pinActionMatch[2]));
      if (result.error) return respond(res, result.status, { error: result.error });
      signalRefresh("pin_changed");
      return respond(res, 200, result);
    }

    const pttMatch = url.pathname.match(/^\/api\/driver\/radio\/channels\/(\d+)\/ptt$/);
    if (req.method === "POST" && pttMatch) {
      const session = requireMutation(req, res);
      if (!session) return true;
      if (!checkRate(`radio-ptt:user:${session.user.id}`, 30, 1)) return respond(res, 429, { error: "radio_rate_limited" });
      const gate = mediaQuota.checkUpload(session.user.id, "radio", MAX_AUDIO_BYTES);
      if (!gate.ok) {
        audit(req, "media_quota_rejected", { userId: session.user.id, success: false, details: { domain: "radio", error: gate.error, scope: gate.scope, requestedBytes: MAX_AUDIO_BYTES } });
        return respond(res, gate.status || 507, { error: gate.error });
      }
      const result = radio.beginTransmission(session.user.id, Number(pttMatch[1]), nowIso());
      if (result.error) return respond(res, result.status, { error: result.error, speaker: result.speaker });
      audit(req, "radio_ptt_granted", { userId: session.user.id, success: true, details: { channelId: Number(pttMatch[1]), transmissionId: result.transmissionId } });
      signalRefresh("speaker_acquired");
      return respond(res, 201, result);
    }

    return false;
  };
}

module.exports = { createRadioRoutes, MAX_AUDIO_BYTES, RADIO_EVENT_HEARTBEAT_MS };
