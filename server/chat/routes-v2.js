const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createChatRepository } = require("./repository");
const { createChatReactionRepository, normalizeReaction } = require("./reactions");

const CLIENT_MESSAGE_ID = /^[A-Za-z0-9_-]{8,100}$/;
const UPLOAD_ID = /^[A-Za-z0-9_-]{16,100}$/;
const UPLOAD_TOKEN = /^[A-Za-z0-9_-]{20,200}$/;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_KIND_BYTES = Object.freeze({ IMAGE: 12 * 1024 * 1024, VIDEO: 25 * 1024 * 1024, AUDIO: 8 * 1024 * 1024, FILE: 25 * 1024 * 1024 });
const UPLOAD_TTL_SECONDS = 15 * 60;
const MIME_RULES = Object.freeze({
  IMAGE: /^image\/(jpeg|png|webp|gif)$/i,
  VIDEO: /^video\/(mp4|webm|quicktime)$/i,
  AUDIO: /^audio\/(webm|ogg|mp4|mpeg|wav|x-wav)$/i,
  FILE: /^(application\/(pdf|zip|x-7z-compressed|vnd\.openxmlformats-officedocument\.[a-z0-9.]+|msword|vnd\.ms-excel|vnd\.ms-powerpoint)|text\/(plain|csv))$/i
});

function addSeconds(now, seconds) { return new Date(new Date(now).getTime() + seconds * 1000).toISOString(); }
function normalizeMessage(value, { allowEmpty = false } = {}) {
  if (value === undefined || value === null) return allowEmpty ? "" : null;
  if (typeof value !== "string") return null;
  const text = value.normalize("NFKC").trim();
  if ((!text && !allowEmpty) || text.length > 4000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) return null;
  return text;
}
function safeFileName(value) {
  const name = String(value || "file").normalize("NFKC").replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim().slice(0, 180);
  return name || "file";
}
function normalizeUploadKind(value) { const kind = String(value || "").toUpperCase(); return Object.hasOwn(MAX_KIND_BYTES, kind) ? kind : null; }
function normalizeMime(kind, value) {
  const mime = String(value || "").split(";", 1)[0].trim().toLowerCase();
  return kind && MIME_RULES[kind].test(mime) ? mime : null;
}
function parseRange(header, size) {
  const match = String(header || "").match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start === null && end !== null) { const length = Math.min(size, end); start = size - length; end = size - 1; }
  else { start = start ?? 0; end = end ?? size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function createChatRoutes({ db, json, requireSession, requireCsrf, checkRate, audit, nowIso, publish, dataDir, readBinaryBody, hashToken, randomToken }) {
  const chat = createChatRepository(db);
  const reactions = createChatReactionRepository(db);
  const storageDir = path.join(dataDir, "chat");

  function requireChatAccess(req, res, roomId = null) {
    const session = requireSession(req, res);
    if (!session) return null;
    if (!chat.hasProfile(session.user.id)) { json(res, 409, { error: "driver_profile_required" }); return null; }
    if (roomId !== null) {
      const room = chat.getRoom(roomId);
      const accessError = chat.roomAccessError(session.user.id, room);
      if (accessError) { json(res, ["driver_blocked", "chat_room_banned"].includes(accessError) ? 403 : 404, { error: accessError }); return null; }
      session.chatRoom = room;
    }
    return session;
  }
  function requireMutation(req, res, roomId = null) {
    const session = requireChatAccess(req, res, roomId);
    if (!session || !requireCsrf(req, res, session)) return null;
    return session;
  }
  function respond(res, status, payload) { json(res, status, payload); return true; }
  function rate(req, res, session, name, limit, minutes) {
    if (checkRate(`chat-${name}:user:${session.user.id}`, limit, minutes)) return true;
    audit(req, "rate_limited", { userId: session.user.id, success: false, details: { endpoint: `chat_${name}` } });
    json(res, 429, { error: "chat_rate_limited" }); return false;
  }
  function publishRoom(type, roomId, extra = {}) { publish({ type, roomId: Number(roomId), ...extra }); }
  function removeExpiredUploads() {
    for (const item of chat.expiredUploads(nowIso())) { try { fs.rmSync(path.join(storageDir, item.storage_key), { force: true }); } catch {} }
  }

  return async function handleChatRoute(req, res, url, body) {
    if (!url.pathname.startsWith("/api/driver/chat/")) return false;

    const attachmentContent = url.pathname.match(/^\/api\/driver\/chat\/attachments\/(\d+)\/content$/);
    if (req.method === "GET" && attachmentContent) {
      const session = requireChatAccess(req, res); if (!session) return true;
      const attachment = chat.attachmentForUser(session.user.id, Number(attachmentContent[1]), nowIso());
      if (!attachment) return respond(res, 404, { error: "chat_attachment_not_found" });
      const filePath = path.join(storageDir, attachment.storage_key);
      let stat; try { stat = fs.statSync(filePath); } catch { return respond(res, 404, { error: "chat_attachment_not_found" }); }
      if (!stat.isFile() || stat.size !== Number(attachment.byte_length)) return respond(res, 404, { error: "chat_attachment_not_found" });
      const inline = attachment.kind !== "FILE";
      const headers = {
        "Content-Type": attachment.mime_type,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`,
        "Accept-Ranges": "bytes"
      };
      const range = parseRange(req.headers.range, stat.size);
      if (req.headers.range && !range) { res.writeHead(416, { ...headers, "Content-Range": `bytes */${stat.size}` }); res.end(); return true; }
      if (range) {
        const length = range.end - range.start + 1;
        res.writeHead(206, { ...headers, "Content-Length": length, "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}` });
        fs.createReadStream(filePath, { start: range.start, end: range.end }).on("error", () => res.destroy()).pipe(res); return true;
      }
      res.writeHead(200, { ...headers, "Content-Length": stat.size });
      fs.createReadStream(filePath).on("error", () => res.destroy()).pipe(res); return true;
    }

    const uploadContent = url.pathname.match(/^\/api\/driver\/chat\/uploads\/([A-Za-z0-9_-]+)\/content$/);
    if (req.method === "POST" && uploadContent && body === undefined) {
      const session = requireMutation(req, res); if (!session) return true;
      const uploadId = uploadContent[1];
      const rawToken = String(req.headers["x-chat-upload-token"] || "");
      if (!UPLOAD_ID.test(uploadId) || !UPLOAD_TOKEN.test(rawToken)) return respond(res, 400, { error: "invalid_chat_upload" });
      const target = chat.uploadTarget(session.user.id, uploadId, hashToken(rawToken), nowIso());
      if (!target) return respond(res, 409, { error: "chat_upload_not_authorized" });
      let binary;
      try { binary = await readBinaryBody(req, Math.min(MAX_UPLOAD_BYTES, Number(target.byte_length))); }
      catch (error) { return respond(res, error.status || 400, { error: error.message || "invalid_chat_upload" }); }
      if (binary.length !== Number(target.byte_length)) return respond(res, 400, { error: "chat_upload_size_mismatch" });
      fs.mkdirSync(storageDir, { recursive: true, mode: 0o700 });
      const finalPath = path.join(storageDir, target.storage_key);
      const tempPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
      try {
        fs.writeFileSync(tempPath, binary, { flag: "wx", mode: 0o600 });
        fs.renameSync(tempPath, finalPath);
        if (!chat.markUploadReady(uploadId)) throw new Error("chat_upload_conflict");
        return respond(res, 201, { upload: { id: uploadId, state: "READY" } });
      } catch (error) {
        fs.rmSync(tempPath, { force: true }); fs.rmSync(finalPath, { force: true });
        return respond(res, error.message === "chat_upload_conflict" ? 409 : 500, { error: error.message === "chat_upload_conflict" ? error.message : "chat_upload_failed" });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/driver/chat/overview") {
      const session = requireChatAccess(req, res); if (!session) return true;
      return respond(res, 200, { rooms: chat.listRooms(session.user.id, nowIso()), invites: chat.listInvites(session.user.id) });
    }
    if (req.method === "GET" && url.pathname === "/api/driver/chat/rooms") {
      const session = requireChatAccess(req, res); if (session) json(res, 200, { rooms: chat.listRooms(session.user.id, nowIso()) }); return true;
    }
    if (req.method === "GET" && url.pathname === "/api/driver/chat/countries") {
      const session = requireChatAccess(req, res); if (session) json(res, 200, chat.countryChatForUser(session.user.id, nowIso())); return true;
    }
    if (req.method === "GET" && url.pathname === "/api/driver/chat/search") {
      const session = requireChatAccess(req, res); if (!session) return true;
      const roomId = url.searchParams.has("roomId") ? Number(url.searchParams.get("roomId")) : null;
      const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 50;
      if ((roomId !== null && !Number.isSafeInteger(roomId)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return respond(res, 400, { error: "invalid_chat_search" });
      return respond(res, 200, { messages: chat.searchMessages(session.user.id, { query: url.searchParams.get("q") || "", roomId, limit }, nowIso()) });
    }
    if (req.method === "GET" && url.pathname === "/api/driver/chat/groups/discover") {
      const session = requireChatAccess(req, res); if (!session) return true;
      return respond(res, 200, { groups: chat.discoverGroups(session.user.id, url.searchParams.get("q") || "", nowIso()) });
    }

    const roomDetails = url.pathname.match(/^\/api\/driver\/chat\/rooms\/(\d+)$/);
    if (req.method === "GET" && roomDetails) {
      const roomId = Number(roomDetails[1]); const session = requireChatAccess(req, res, roomId); if (!session) return true;
      const room = chat.roomForUser(session.user.id, roomId, nowIso()); const members = chat.listMembers(session.user.id, roomId); const pins = chat.listPins(session.user.id, roomId);
      return respond(res, 200, { room, members: members.members || [], pins: pins.pins || [] });
    }

    const membersMatch = url.pathname.match(/^\/api\/driver\/chat\/rooms\/(\d+)\/members$/);
    if (req.method === "GET" && membersMatch) {
      const roomId = Number(membersMatch[1]); const session = requireChatAccess(req, res, roomId); if (!session) return true;
      const result = chat.listMembers(session.user.id, roomId); return respond(res, result.status || 200, result.error ? { error: result.error } : result);
    }
    const pinsMatch = url.pathname.match(/^\/api\/driver\/chat\/rooms\/(\d+)\/pins$/);
    if (req.method === "GET" && pinsMatch) {
      const roomId = Number(pinsMatch[1]); const session = requireChatAccess(req, res, roomId); if (!session) return true;
      const result = chat.listPins(session.user.id, roomId); return respond(res, result.status || 200, result.error ? { error: result.error } : result);
    }

    const messagesMatch = url.pathname.match(/^\/api\/driver\/chat\/rooms\/(\d+)\/messages$/);
    if (req.method === "GET" && messagesMatch) {
      const roomId = Number(messagesMatch[1]); const session = requireChatAccess(req, res, roomId); if (!session) return true;
      const afterValue = url.searchParams.get("after"), beforeValue = url.searchParams.get("before"), limitValue = url.searchParams.get("limit");
      const after = afterValue === null ? null : Number(afterValue), before = beforeValue === null ? null : Number(beforeValue), limit = limitValue === null ? 50 : Number(limitValue);
      if ((after !== null && (!Number.isSafeInteger(after) || after < 0)) || (before !== null && (!Number.isSafeInteger(before) || before < 0)) || (after !== null && before !== null) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return respond(res, 400, { error: "invalid_chat_cursor" });
      const result = chat.listMessages(session.user.id, roomId, { after, before, limit }, nowIso());
      result.messages = reactions.attachToMessages(result.messages, session.user.id);
      const newest = result.messages.at(-1)?.id; if (newest) chat.markDelivered(session.user.id, roomId, newest, nowIso());
      return respond(res, 200, result);
    }

    if (body === undefined) return false;

    const countryJoin = url.pathname.match(/^\/api\/driver\/chat\/countries\/([A-Za-z]{2})\/join$/);
    if (req.method === "POST" && countryJoin) {
      const session = requireMutation(req, res); if (!session || !rate(req, res, session, "country-join", 10, 1)) return true;
      try { const result = chat.joinCountryChat(session.user.id, countryJoin[1], nowIso()); if (result.joined) audit(req, "chat_country_joined", { userId: session.user.id, success: true, details: { roomId: result.room.id, countryCode: result.room.countryCode } }); return respond(res, result.created ? 201 : 200, result); }
      catch (error) { return respond(res, error.status || 400, { error: ["invalid_country_code", "country_chat_not_eligible"].includes(error.message) ? error.message : "invalid_country_chat" }); }
    }
    if (req.method === "POST" && url.pathname === "/api/driver/chat/direct") {
      const session = requireMutation(req, res); if (!session || !rate(req, res, session, "direct", 20, 1)) return true;
      try { const result = chat.createDirectRoom(session.user.id, body?.nickname, nowIso()); if (result.created) audit(req, "chat_direct_created", { userId: session.user.id, success: true, details: { roomId: result.room.id } }); return respond(res, result.created ? 201 : 200, result); }
      catch (error) { return respond(res, error.status || 400, { error: ["driver_not_found", "driver_blocked", "direct_chat_self_forbidden"].includes(error.message) ? error.message : "invalid_direct_chat" }); }
    }
    if (req.method === "POST" && url.pathname === "/api/driver/chat/groups") {
      const session = requireMutation(req, res); if (!session || !rate(req, res, session, "group-create", 8, 60)) return true;
      const result = chat.createGroupRoom(session.user.id, body, nowIso()); if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, "chat_group_created", { userId: session.user.id, success: true, details: { roomId: result.room.id, visibility: result.room.visibility } });
      return respond(res, 201, result);
    }

    const groupJoin = url.pathname.match(/^\/api\/driver\/chat\/groups\/(\d+)\/join$/);
    if (req.method === "POST" && groupJoin) {
      const session = requireMutation(req, res); if (!session || !rate(req, res, session, "group-join", 30, 60)) return true;
      const result = chat.joinPublicGroup(session.user.id, Number(groupJoin[1]), nowIso()); if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, "chat_group_joined", { userId: session.user.id, success: true, details: { roomId: Number(groupJoin[1]) } }); return respond(res, 200, result);
    }
    const groupInvite = url.pathname.match(/^\/api\/driver\/chat\/groups\/(\d+)\/invites$/);
    if (req.method === "POST" && groupInvite) {
      const roomId = Number(groupInvite[1]); const session = requireMutation(req, res, roomId); if (!session || !rate(req, res, session, "group-invite", 30, 60)) return true;
      const result = chat.inviteToGroup(session.user.id, roomId, body?.nickname, nowIso()); if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, "chat_group_invited", { userId: session.user.id, success: true, details: { roomId } }); return respond(res, 200, result);
    }
    const inviteResponse = url.pathname.match(/^\/api\/driver\/chat\/invites\/(\d+)\/respond$/);
    if (req.method === "POST" && inviteResponse) {
      const session = requireMutation(req, res); if (!session) return true;
      const result = chat.respondToInvite(session.user.id, Number(inviteResponse[1]), body?.action, nowIso()); if (result.error) return respond(res, result.status, { error: result.error });
      return respond(res, 200, result);
    }
    if (req.method === "PATCH" && roomDetails) {
      const roomId = Number(roomDetails[1]); const session = requireMutation(req, res, roomId); if (!session) return true;
      const result = chat.updateGroup(session.user.id, roomId, body, nowIso()); if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, "chat_group_updated", { userId: session.user.id, success: true, details: { roomId } }); publishRoom("chat.room.updated", roomId, { room: result.room }); return respond(res, 200, result);
    }
    if (req.method === "DELETE" && roomDetails) {
      const roomId = Number(roomDetails[1]); const session = requireMutation(req, res, roomId); if (!session) return true;
      const result = chat.deleteGroup(session.user.id, roomId); if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, "chat_group_deleted", { userId: session.user.id, success: true, details: { roomId } }); publishRoom("chat.room.deleted", roomId); return respond(res, 200, result);
    }
    const leaveMatch = url.pathname.match(/^\/api\/driver\/chat\/groups\/(\d+)\/leave$/);
    if (req.method === "POST" && leaveMatch) {
      const roomId = Number(leaveMatch[1]); const session = requireMutation(req, res, roomId); if (!session) return true;
      const result = chat.leaveGroup(session.user.id, roomId); if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, "chat_group_left", { userId: session.user.id, success: true, details: { roomId } }); return respond(res, 200, result);
    }

    const memberAction = url.pathname.match(/^\/api\/driver\/chat\/groups\/(\d+)\/members\/([^/]+)$/);
    if (req.method === "PATCH" && memberAction) {
      const roomId = Number(memberAction[1]); const session = requireMutation(req, res, roomId); if (!session) return true;
      const result = chat.setMemberRole(session.user.id, roomId, decodeURIComponent(memberAction[2]), body?.role); if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, "chat_member_role_changed", { userId: session.user.id, success: true, details: { roomId, role: result.role } }); publishRoom("chat.members.updated", roomId); return respond(res, 200, result);
    }
    if (req.method === "DELETE" && memberAction) {
      const roomId = Number(memberAction[1]); const session = requireMutation(req, res, roomId); if (!session) return true;
      const result = chat.removeMember(session.user.id, roomId, decodeURIComponent(memberAction[2]), { ban: Boolean(body?.ban) }, nowIso()); if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, result.banned ? "chat_member_banned" : "chat_member_removed", { userId: session.user.id, success: true, details: { roomId } }); publishRoom("chat.members.updated", roomId); return respond(res, 200, result);
    }
    const unbanMatch = url.pathname.match(/^\/api\/driver\/chat\/groups\/(\d+)\/bans\/([^/]+)$/);
    if (req.method === "DELETE" && unbanMatch) {
      const roomId = Number(unbanMatch[1]); const session = requireMutation(req, res, roomId); if (!session) return true;
      const result = chat.unbanMember(session.user.id, roomId, decodeURIComponent(unbanMatch[2])); if (result.error) return respond(res, result.status, { error: result.error }); return respond(res, 200, result);
    }

    const preferencesMatch = url.pathname.match(/^\/api\/driver\/chat\/rooms\/(\d+)\/preferences$/);
    if (req.method === "PATCH" && preferencesMatch) {
      const roomId = Number(preferencesMatch[1]); const session = requireMutation(req, res, roomId); if (!session) return true;
      const result = chat.updateRoomPreferences(session.user.id, roomId, body, nowIso()); return respond(res, result.status || 200, result.error ? { error: result.error } : { preferences: result });
    }
    const draftMatch = url.pathname.match(/^\/api\/driver\/chat\/rooms\/(\d+)\/draft$/);
    if (req.method === "PUT" && draftMatch) {
      const roomId = Number(draftMatch[1]); const session = requireMutation(req, res, roomId); if (!session) return true;
      const result = chat.saveDraft(session.user.id, roomId, body?.text, body?.replyToMessageId, nowIso()); return respond(res, result.status || 200, result.error ? { error: result.error } : result);
    }
    const readMatch = url.pathname.match(/^\/api\/driver\/chat\/rooms\/(\d+)\/read$/);
    if (req.method === "POST" && readMatch) {
      const roomId = Number(readMatch[1]); const session = requireMutation(req, res, roomId); if (!session) return true;
      const result = chat.markRead(session.user.id, roomId, body?.messageId, nowIso()); if (result.error) return respond(res, result.status, { error: result.error });
      publishRoom("chat.receipt.updated", roomId, { reader: chat.getNickname(session.user.id), readMessageId: result.readMessageId }); return respond(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/api/driver/chat/uploads") {
      const roomId = Number(body?.roomId); const session = requireMutation(req, res, roomId); if (!session || !rate(req, res, session, "upload", 30, 10)) return true;
      removeExpiredUploads();
      const kind = normalizeUploadKind(body?.kind), mimeType = normalizeMime(kind, body?.mimeType), byteLength = Number(body?.byteLength), durationMs = body?.durationMs === undefined || body?.durationMs === null ? null : Number(body.durationMs);
      if (!kind || !mimeType || !Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_KIND_BYTES[kind] || (durationMs !== null && (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > 60 * 60 * 1000))) return respond(res, 400, { error: "invalid_chat_upload" });
      const id = randomToken(18), token = randomToken(32), storageKey = crypto.randomUUID().replaceAll("-", "");
      const upload = chat.createUpload({ id, roomId, userId: session.user.id, tokenHash: hashToken(token), kind, fileName: safeFileName(body?.fileName), mimeType, byteLength, storageKey, durationMs, createdAt: nowIso(), expiresAt: addSeconds(nowIso(), UPLOAD_TTL_SECONDS) });
      return respond(res, 201, { upload, uploadToken: token, uploadUrl: `/api/driver/chat/uploads/${id}/content` });
    }
    const uploadDelete = url.pathname.match(/^\/api\/driver\/chat\/uploads\/([A-Za-z0-9_-]+)$/);
    if (req.method === "DELETE" && uploadDelete) {
      const session = requireMutation(req, res); if (!session) return true;
      const storageKey = chat.deleteUpload(session.user.id, uploadDelete[1]); if (!storageKey) return respond(res, 404, { error: "chat_upload_not_found" });
      try { fs.rmSync(path.join(storageDir, storageKey), { force: true }); } catch {}
      return respond(res, 200, { deleted: true });
    }

    if (req.method === "POST" && messagesMatch) {
      const roomId = Number(messagesMatch[1]); const session = requireMutation(req, res, roomId); if (!session || !rate(req, res, session, "message", 45, 1)) return true;
      const clientMessageId = String(body?.clientMessageId || ""), text = normalizeMessage(body?.text, { allowEmpty: true });
      if (!CLIENT_MESSAGE_ID.test(clientMessageId) || text === null) return respond(res, 400, { error: "invalid_chat_message" });
      try {
        const stored = chat.insertMessage({ roomId, senderId: session.user.id, clientMessageId, text, replyToMessageId: body?.replyToMessageId ?? null, forwardFromMessageId: body?.forwardFromMessageId ?? null, uploadIds: body?.uploadIds || [], expiresInSeconds: body?.expiresInSeconds || 0, createdAt: nowIso() });
        if (!stored.message) return respond(res, 409, { error: "chat_message_conflict" });
        stored.message.reactions = reactions.listForMessage(stored.message.id, session.user.id);
        if (!stored.duplicate) { audit(req, "chat_message_sent", { userId: session.user.id, success: true, details: { roomId, kind: stored.message.kind } }); publishRoom("chat.message.committed", roomId, { cursor: stored.message.id, message: stored.message }); }
        return respond(res, stored.duplicate ? 200 : 201, stored);
      } catch (error) { return respond(res, error.status || 500, { error: error.status ? error.message : "chat_message_failed" }); }
    }
    const pollsMatch = url.pathname.match(/^\/api\/driver\/chat\/rooms\/(\d+)\/polls$/);
    if (req.method === "POST" && pollsMatch) {
      const roomId = Number(pollsMatch[1]); const session = requireMutation(req, res, roomId); if (!session || !rate(req, res, session, "poll", 10, 10)) return true;
      const clientMessageId = String(body?.clientMessageId || ""); if (!CLIENT_MESSAGE_ID.test(clientMessageId)) return respond(res, 400, { error: "invalid_chat_poll" });
      const stored = chat.insertPoll({ roomId, senderId: session.user.id, clientMessageId, question: body?.question, options: body?.options, multiple: Boolean(body?.multiple), anonymous: Boolean(body?.anonymous), closesAt: body?.closesAt || null, createdAt: nowIso() });
      if (stored.error) return respond(res, stored.status, { error: stored.error }); stored.message.reactions = [];
      if (!stored.duplicate) publishRoom("chat.message.committed", roomId, { cursor: stored.message.id, message: stored.message }); return respond(res, stored.duplicate ? 200 : 201, stored);
    }

    const messageAction = url.pathname.match(/^\/api\/driver\/chat\/messages\/(\d+)$/);
    if (req.method === "PATCH" && messageAction) {
      const session = requireMutation(req, res); if (!session) return true; const text = normalizeMessage(body?.text); if (text === null) return respond(res, 400, { error: "invalid_chat_message" });
      const result = chat.editMessage(session.user.id, Number(messageAction[1]), text, nowIso()); if (result.error) return respond(res, result.status, { error: result.error });
      result.message.reactions = reactions.listForMessage(result.message.id, session.user.id); audit(req, "chat_message_edited", { userId: session.user.id, success: true, details: { roomId: result.message.roomId, messageId: result.message.id } }); publishRoom("chat.message.updated", result.message.roomId, { message: result.message }); return respond(res, 200, result);
    }
    if (req.method === "DELETE" && messageAction) {
      const session = requireMutation(req, res); if (!session || !rate(req, res, session, "delete", 30, 1)) return true;
      const result = chat.deleteMessage(session.user.id, Number(messageAction[1]), { scope: body?.scope === "me" ? "me" : "everyone" }, nowIso()); if (result.error) return respond(res, result.status, { error: result.error });
      audit(req, result.hidden ? "chat_message_hidden" : "chat_message_deleted", { userId: session.user.id, success: true, details: { roomId: result.roomId, messageId: result.id } }); if (!result.hidden) publishRoom("chat.message.deleted", result.roomId, { messageId: result.id }); return respond(res, 200, result);
    }

    const reactionMatch = url.pathname.match(/^\/api\/driver\/chat\/messages\/(\d+)\/reactions$/);
    if (req.method === "POST" && reactionMatch) {
      const messageId = Number(reactionMatch[1]), roomId = reactions.messageRoomId(messageId); if (roomId === null) { const session = requireChatAccess(req, res); if (session) json(res, 404, { error: "chat_message_not_found" }); return true; }
      const session = requireMutation(req, res, roomId); if (!session) return true; const reaction = normalizeReaction(body?.reaction); if (!reaction) return respond(res, 400, { error: "invalid_chat_reaction" }); if (!rate(req, res, session, "reaction", 90, 1)) return true;
      try { const result = reactions.toggleReaction({ messageId, userId: session.user.id, reaction, createdAt: nowIso() }); publishRoom("chat.reaction.updated", result.roomId, { messageId: result.messageId, reactions: result.reactions.map(({ reactedByMe, ...item }) => item) }); return respond(res, 200, result); }
      catch (error) { return respond(res, error.status || 500, { error: error.status ? error.message : "chat_reaction_failed" }); }
    }

    const pinAction = url.pathname.match(/^\/api\/driver\/chat\/rooms\/(\d+)\/pins\/(\d+)$/);
    if (["POST", "DELETE"].includes(req.method) && pinAction) {
      const roomId = Number(pinAction[1]), messageId = Number(pinAction[2]); const session = requireMutation(req, res, roomId); if (!session) return true;
      const result = req.method === "POST" ? chat.pinMessage(session.user.id, roomId, messageId, nowIso()) : chat.unpinMessage(session.user.id, roomId, messageId);
      if (result.error) return respond(res, result.status, { error: result.error }); publishRoom("chat.pins.updated", roomId); return respond(res, 200, result);
    }
    const pollVote = url.pathname.match(/^\/api\/driver\/chat\/polls\/(\d+)\/vote$/);
    if (req.method === "POST" && pollVote) {
      const session = requireMutation(req, res); if (!session || !rate(req, res, session, "poll-vote", 60, 1)) return true;
      const result = chat.votePoll(session.user.id, Number(pollVote[1]), body?.optionIds, nowIso()); if (result.error) return respond(res, result.status, { error: result.error });
      const roomId = reactions.messageRoomId(Number(pollVote[1])); publishRoom("chat.poll.updated", roomId, result); return respond(res, 200, result);
    }
    const pollClose = url.pathname.match(/^\/api\/driver\/chat\/polls\/(\d+)\/close$/);
    if (req.method === "POST" && pollClose) {
      const session = requireMutation(req, res); if (!session) return true; const result = chat.closePoll(session.user.id, Number(pollClose[1]), nowIso()); if (result.error) return respond(res, result.status, { error: result.error });
      const roomId = reactions.messageRoomId(Number(pollClose[1])); publishRoom("chat.poll.updated", roomId, result); return respond(res, 200, result);
    }

    return false;
  };
}

module.exports = { createChatRoutes, normalizeMessage, MAX_UPLOAD_BYTES, MAX_KIND_BYTES, UPLOAD_TTL_SECONDS };
