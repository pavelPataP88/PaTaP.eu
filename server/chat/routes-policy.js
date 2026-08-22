const { createChatRoutes: createInnerChatRoutes, normalizeMessage, MAX_UPLOAD_BYTES, MAX_KIND_BYTES, UPLOAD_TTL_SECONDS } = require("./routes-v2");
const { createChatRepository } = require("./repository");
const { createChatReactionRepository } = require("./reactions");
const { DATA_DIR, hashToken: defaultHashToken, randomToken: defaultRandomToken } = require("../auth/db");
const { createMediaQuota } = require("../storage/quota");

const CLIENT_MESSAGE_ID = /^[A-Za-z0-9_-]{8,100}$/;

async function defaultReadBinaryBody(req, maxBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("payload_too_large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function isReadOnlyGroup(chat, userId, roomId) {
  const room = chat.getRoom(roomId);
  return room?.kind === "GROUP" && chat.roomForUser(userId, roomId)?.role === "READONLY";
}

function crossRoomForward({ db, chat, reactions, session, targetRoomId, sourceMessageId, clientMessageId, createdAt, publish, audit, req }) {
  if (!CLIENT_MESSAGE_ID.test(clientMessageId)) return { status: 400, payload: { error: "invalid_chat_message" } };
  const targetRoom = chat.getRoom(targetRoomId);
  const targetError = chat.roomAccessError(session.user.id, targetRoom);
  if (targetError) return { status: ["driver_blocked", "chat_room_banned"].includes(targetError) ? 403 : 404, payload: { error: targetError } };
  if (isReadOnlyGroup(chat, session.user.id, targetRoomId)) return { status: 403, payload: { error: "chat_readonly" } };

  const source = db.prepare(`SELECT m.id,m.room_id,m.sender_id,m.body,m.created_at,mm.deleted_at,mm.expires_at
    FROM chat_messages m LEFT JOIN chat_message_meta mm ON mm.message_id=m.id WHERE m.id=?`).get(sourceMessageId);
  if (!source) return { status: 404, payload: { error: "chat_forward_not_found" } };
  const sourceRoom = chat.getRoom(Number(source.room_id));
  const sourceError = chat.roomAccessError(session.user.id, sourceRoom);
  if (sourceError || source.deleted_at || (source.expires_at && source.expires_at <= createdAt) ||
      db.prepare("SELECT 1 FROM chat_hidden_messages WHERE user_id=? AND message_id=?").get(session.user.id, sourceMessageId)) {
    return { status: 404, payload: { error: "chat_forward_not_found" } };
  }

  const existing = db.prepare("SELECT id,room_id FROM chat_messages WHERE sender_id=? AND client_message_id=?")
    .get(session.user.id, clientMessageId);
  if (existing) {
    if (Number(existing.room_id) !== Number(targetRoomId)) return { status: 409, payload: { error: "client_message_id_conflict" } };
    const list = chat.listMessages(session.user.id, targetRoomId, { after: Math.max(0, Number(existing.id) - 1), limit: 2 }, createdAt);
    const message = list.messages.find((item) => Number(item.id) === Number(existing.id));
    if (message) message.reactions = reactions.listForMessage(message.id, session.user.id);
    return { status: 200, payload: { message, duplicate: true } };
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const inserted = db.prepare("INSERT INTO chat_messages(room_id,sender_id,client_message_id,body,created_at) VALUES(?,?,?,?,?)")
      .run(targetRoomId, session.user.id, clientMessageId, source.body || "", createdAt);
    const messageId = Number(inserted.lastInsertRowid);
    db.prepare("INSERT INTO chat_message_meta(message_id,forwarded_from_message_id) VALUES(?,?)").run(messageId, sourceMessageId);

    const attachments = db.prepare("SELECT kind,file_name,mime_type,byte_length,storage_key,duration_ms FROM chat_message_attachments WHERE message_id=? ORDER BY id")
      .all(sourceMessageId);
    const addAttachment = db.prepare(`INSERT INTO chat_message_attachments(message_id,kind,file_name,mime_type,byte_length,storage_key,duration_ms,created_at)
      VALUES(?,?,?,?,?,?,?,?)`);
    for (const item of attachments) addAttachment.run(messageId, item.kind, item.file_name, item.mime_type, item.byte_length, item.storage_key, item.duration_ms, createdAt);

    const poll = db.prepare("SELECT question,multiple,anonymous,closes_at,closed_at FROM chat_polls WHERE message_id=?").get(sourceMessageId);
    if (poll) {
      db.prepare("INSERT INTO chat_polls(message_id,question,multiple,anonymous,closes_at,closed_at) VALUES(?,?,?,?,?,?)")
        .run(messageId, poll.question, poll.multiple, poll.anonymous, poll.closes_at, poll.closed_at ? createdAt : null);
      const addOption = db.prepare("INSERT INTO chat_poll_options(message_id,option_index,body) VALUES(?,?,?)");
      for (const option of db.prepare("SELECT option_index,body FROM chat_poll_options WHERE message_id=? ORDER BY option_index").all(sourceMessageId)) {
        addOption.run(messageId, option.option_index, option.body);
      }
    }
    db.exec("COMMIT");

    const list = chat.listMessages(session.user.id, targetRoomId, { after: Math.max(0, messageId - 1), limit: 2 }, createdAt);
    const message = list.messages.find((item) => Number(item.id) === messageId);
    if (message) message.reactions = [];
    audit(req, "chat_message_forwarded", { userId: session.user.id, success: true, details: { roomId: targetRoomId, sourceRoomId: Number(source.room_id), messageId } });
    publish({ type: "chat.message.committed", roomId: Number(targetRoomId), cursor: messageId, message });
    return { status: 201, payload: { message, duplicate: false } };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function createChatRoutes(options) {
  const dependencies = {
    ...options,
    dataDir: options.dataDir || DATA_DIR,
    readBinaryBody: options.readBinaryBody || defaultReadBinaryBody,
    hashToken: options.hashToken || defaultHashToken,
    randomToken: options.randomToken || defaultRandomToken
  };
  const inner = createInnerChatRoutes(dependencies);
  const chat = createChatRepository(options.db);
  const reactions = createChatReactionRepository(options.db);
  const mediaQuota = options.mediaQuota || createMediaQuota({ db: options.db, dataDir: dependencies.dataDir });

  return async function handleChatRoute(req, res, url, body) {
    if (!url.pathname.startsWith("/api/driver/chat/")) return false;

    if (body !== undefined) {
      const postMessage = url.pathname.match(/^\/api\/driver\/chat\/rooms\/(\d+)\/messages$/);
      const postPoll = url.pathname.match(/^\/api\/driver\/chat\/rooms\/(\d+)\/polls$/);
      const prepareUpload = req.method === "POST" && url.pathname === "/api/driver/chat/uploads" ? Number(body?.roomId) : null;
      const guardedRoomId = req.method === "POST" && postMessage ? Number(postMessage[1])
        : req.method === "POST" && postPoll ? Number(postPoll[1])
        : Number.isSafeInteger(prepareUpload) ? prepareUpload : null;

      if (guardedRoomId !== null) {
        const session = options.requireSession(req, res);
        if (!session) return true;
        if (!chat.hasProfile(session.user.id)) { options.json(res, 409, { error: "driver_profile_required" }); return true; }
        const target = chat.getRoom(guardedRoomId);
        const accessError = chat.roomAccessError(session.user.id, target);
        if (accessError) { options.json(res, ["driver_blocked", "chat_room_banned"].includes(accessError) ? 403 : 404, { error: accessError }); return true; }
        if (isReadOnlyGroup(chat, session.user.id, guardedRoomId)) { options.json(res, 403, { error: "chat_readonly" }); return true; }

        if (Number.isSafeInteger(prepareUpload)) {
          const kind = String(body?.kind || "").toUpperCase();
          const byteLength = Number(body?.byteLength);
          if (Object.hasOwn(MAX_KIND_BYTES, kind) && Number.isSafeInteger(byteLength) && byteLength >= 1 && byteLength <= MAX_KIND_BYTES[kind]) {
            if (!options.requireCsrf(req, res, session)) return true;
            const gate = mediaQuota.checkUpload(session.user.id, "chat", byteLength);
            if (!gate.ok) {
              options.audit(req, "media_quota_rejected", { userId: session.user.id, success: false, details: { domain: "chat", error: gate.error, scope: gate.scope, requestedBytes: byteLength } });
              options.json(res, gate.status || 507, { error: gate.error });
              return true;
            }
          }
        }

        if (req.method === "POST" && postMessage && body?.forwardFromMessageId !== undefined && body?.forwardFromMessageId !== null) {
          const sourceMessageId = Number(body.forwardFromMessageId);
          const sourceRoomId = Number(options.db.prepare("SELECT room_id FROM chat_messages WHERE id=?").get(sourceMessageId)?.room_id);
          if (Number.isSafeInteger(sourceRoomId) && sourceRoomId !== guardedRoomId) {
            if (!options.requireCsrf(req, res, session)) return true;
            if (!options.checkRate(`chat-message:user:${session.user.id}`, 45, 1)) { options.json(res, 429, { error: "chat_rate_limited" }); return true; }
            try {
              const result = crossRoomForward({ db: options.db, chat, reactions, session, targetRoomId: guardedRoomId, sourceMessageId, clientMessageId: String(body.clientMessageId || ""), createdAt: options.nowIso(), publish: options.publish, audit: options.audit, req });
              options.json(res, result.status, result.payload);
            } catch (error) {
              options.json(res, 500, { error: "chat_forward_failed" });
            }
            return true;
          }
        }
      }
    }

    return inner(req, res, url, body);
  };
}

module.exports = { createChatRoutes, normalizeMessage, MAX_UPLOAD_BYTES, MAX_KIND_BYTES, UPLOAD_TTL_SECONDS };
