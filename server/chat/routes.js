const fs = require("fs");
const path = require("path");
const policy = require("./routes-policy");
const { createChatRepository } = require("./repository");
const { createChatReactionRepository } = require("./reactions");
const { DATA_DIR } = require("../auth/db");

function isReadOnlyGroup(chat, userId, roomId) {
  const room = chat.getRoom(roomId);
  return room?.kind === "GROUP" && chat.roomForUser(userId, roomId)?.role === "READONLY";
}

function sanitizeRealtimeEvent(event) {
  if (!event || !Number.isSafeInteger(Number(event.roomId))) return event;
  const roomId = Number(event.roomId);
  if (["chat.message.updated", "chat.poll.updated"].includes(event.type)) {
    return { type: "chat.receipt.updated", roomId, readMessageId: 0, reason: event.type };
  }
  if (event.type === "chat.receipt.updated") {
    return { type: "chat.receipt.updated", roomId, readMessageId: Number(event.readMessageId || 0) };
  }
  if (event.type === "chat.room.updated") return { type: "chat.room.updated", roomId };
  if (event.type === "chat.message.committed" && event.message) {
    const message = {
      ...event.message,
      receipts: null,
      reactions: (event.message.reactions || []).map(({ reactedByMe, ...reaction }) => reaction),
      poll: event.message.poll ? {
        ...event.message.poll,
        options: (event.message.poll.options || []).map(({ votedByMe, ...option }) => option)
      } : null
    };
    return { type: event.type, roomId, cursor: Number(event.cursor || message.id), message };
  }
  return event;
}

function createChatRoutes(options) {
  const innerOptions = {
    ...options,
    publish(event) { options.publish(sanitizeRealtimeEvent(event)); },
    json(res, status, payload) {
      if (res.__chatLegacyDelete === true) {
        if (status === 403 && payload?.error === "chat_delete_forbidden") {
          return options.json(res, 404, { error: "chat_message_not_found" });
        }
        if (status === 200 && payload?.deleted === true && Number.isSafeInteger(payload.id) && Number.isSafeInteger(payload.roomId)) {
          return options.json(res, 200, { deleted: { id: payload.id, roomId: payload.roomId } });
        }
      }
      if (res.__chatHideDeleted === true && status === 200 && Array.isArray(payload?.messages)) {
        return options.json(res, status, { ...payload, messages: payload.messages.filter((message) => !message.deletedAt) });
      }
      return options.json(res, status, payload);
    }
  };
  const inner = policy.createChatRoutes(innerOptions);
  const chat = createChatRepository(options.db);
  const reactions = createChatReactionRepository(options.db);
  const storageDir = path.join(options.dataDir || DATA_DIR, "chat");
  let lastHousekeepingAt = 0;

  function responseStatus(res) { return Number(res.statusCode || res.status || 0); }
  function storageKeysForMessage(messageId) {
    return options.db.prepare("SELECT DISTINCT storage_key FROM chat_message_attachments WHERE message_id=?").all(messageId).map((row) => row.storage_key);
  }
  function storageKeysForRoom(roomId) {
    return options.db.prepare(`SELECT DISTINCT a.storage_key FROM chat_message_attachments a JOIN chat_messages m ON m.id=a.message_id WHERE m.room_id=?`)
      .all(roomId).map((row) => row.storage_key);
  }
  function removeUnreferencedFiles(storageKeys) {
    for (const storageKey of new Set(storageKeys.filter(Boolean))) {
      const references = Number(options.db.prepare("SELECT COUNT(*) AS n FROM chat_message_attachments WHERE storage_key=?").get(storageKey).n || 0);
      if (references) continue;
      options.db.prepare("DELETE FROM chat_uploads WHERE storage_key=? AND state='ATTACHED'").run(storageKey);
      try { fs.rmSync(path.join(storageDir, storageKey), { force: true }); } catch {}
    }
  }
  function cleanupMessageRichContent(messageId) {
    const storageKeys = storageKeysForMessage(messageId);
    options.db.exec("BEGIN IMMEDIATE");
    try {
      options.db.prepare("DELETE FROM chat_message_attachments WHERE message_id=?").run(messageId);
      options.db.prepare("DELETE FROM chat_polls WHERE message_id=?").run(messageId);
      options.db.prepare("DELETE FROM chat_message_reactions_v2 WHERE message_id=?").run(messageId);
      options.db.prepare("DELETE FROM chat_message_mentions WHERE message_id=?").run(messageId);
      options.db.exec("COMMIT");
    } catch (error) {
      options.db.exec("ROLLBACK");
      throw error;
    }
    removeUnreferencedFiles(storageKeys);
  }
  function housekeeping() {
    const nowMs = Date.now();
    if (nowMs - lastHousekeepingAt < 60_000) return;
    lastHousekeepingAt = nowMs;
    const now = options.nowIso();
    const expired = options.db.prepare(`SELECT mm.message_id FROM chat_message_meta mm
      WHERE (mm.deleted_at IS NOT NULL OR (mm.expires_at IS NOT NULL AND mm.expires_at<=?))
        AND (EXISTS(SELECT 1 FROM chat_message_attachments a WHERE a.message_id=mm.message_id)
          OR EXISTS(SELECT 1 FROM chat_polls p WHERE p.message_id=mm.message_id)
          OR EXISTS(SELECT 1 FROM chat_message_reactions_v2 r WHERE r.message_id=mm.message_id)
          OR EXISTS(SELECT 1 FROM chat_message_mentions mention WHERE mention.message_id=mm.message_id))
      LIMIT 200`).all(now);
    for (const row of expired) cleanupMessageRichContent(Number(row.message_id));
    for (const upload of chat.expiredUploads(now)) {
      try { fs.rmSync(path.join(storageDir, upload.storage_key), { force: true }); } catch {}
    }
  }

  return async function handleChatRoute(req, res, url, body) {
    if (url.pathname.startsWith("/api/driver/chat/")) housekeeping();

    const getMessagesMatch = req.method === "GET"
      ? url.pathname.match(/^\/api\/driver\/chat\/rooms\/(\d+)\/messages$/)
      : null;
    if (getMessagesMatch && url.searchParams.get("includeDeleted") !== "1") res.__chatHideDeleted = true;

    const editMatch = req.method === "PATCH" && body !== undefined
      ? url.pathname.match(/^\/api\/driver\/chat\/messages\/(\d+)$/)
      : null;
    if (editMatch) {
      const session = options.requireSession(req, res);
      if (!session) return true;
      const message = options.db.prepare("SELECT room_id FROM chat_messages WHERE id=?").get(Number(editMatch[1]));
      if (message && isReadOnlyGroup(chat, session.user.id, Number(message.room_id))) {
        if (!options.requireCsrf(req, res, session)) return true;
        options.json(res, 403, { error: "chat_readonly" });
        return true;
      }
    }

    const match = req.method === "POST" && body !== undefined
      ? url.pathname.match(/^\/api\/driver\/chat\/rooms\/(\d+)\/messages$/)
      : null;

    if (match && body?.clientMessageId) {
      const session = options.requireSession(req, res);
      if (!session) return true;
      const existing = options.db.prepare(`SELECT m.id,m.room_id,m.body,mm.reply_to_message_id,mm.forwarded_from_message_id
        FROM chat_messages m LEFT JOIN chat_message_meta mm ON mm.message_id=m.id
        WHERE m.sender_id=? AND m.client_message_id=?`).get(session.user.id, String(body.clientMessageId));
      if (existing) {
        if (!options.requireCsrf(req, res, session)) return true;
        const targetRoomId = Number(match[1]);
        const requestedReply = body.replyToMessageId === undefined || body.replyToMessageId === null ? null : Number(body.replyToMessageId);
        const requestedForward = body.forwardFromMessageId === undefined || body.forwardFromMessageId === null ? null : Number(body.forwardFromMessageId);
        let requestedText = policy.normalizeMessage(body.text, { allowEmpty: true });
        if (requestedForward !== null) {
          const source = options.db.prepare("SELECT body FROM chat_messages WHERE id=?").get(requestedForward);
          if (source) requestedText = source.body;
        }
        const same = Number(existing.room_id) === targetRoomId
          && requestedText !== null
          && String(existing.body) === String(requestedText)
          && (existing.reply_to_message_id === null ? null : Number(existing.reply_to_message_id)) === requestedReply
          && (existing.forwarded_from_message_id === null ? null : Number(existing.forwarded_from_message_id)) === requestedForward;
        if (!same) {
          options.json(res, 409, { error: "client_message_id_conflict" });
          return true;
        }
        const listed = chat.listMessages(session.user.id, targetRoomId, { after: Math.max(0, Number(existing.id) - 1), limit: 2 }, options.nowIso());
        const message = listed.messages.find((item) => Number(item.id) === Number(existing.id));
        if (message) message.reactions = reactions.listForMessage(message.id, session.user.id);
        options.json(res, 200, { message, duplicate: true });
        return true;
      }
    }

    const deleteMessageMatch = req.method === "DELETE" && body !== undefined && body?.scope !== "me"
      ? url.pathname.match(/^\/api\/driver\/chat\/messages\/(\d+)$/)
      : null;
    const deleteRoomMatch = req.method === "DELETE" && body !== undefined
      ? url.pathname.match(/^\/api\/driver\/chat\/rooms\/(\d+)$/)
      : null;
    const messageStorage = deleteMessageMatch ? storageKeysForMessage(Number(deleteMessageMatch[1])) : [];
    const roomStorage = deleteRoomMatch ? storageKeysForRoom(Number(deleteRoomMatch[1])) : [];
    if (deleteMessageMatch) res.__chatLegacyDelete = true;

    try {
      const handled = await inner(req, res, url, body);
      if (handled && responseStatus(res) >= 200 && responseStatus(res) < 300) {
        if (deleteMessageMatch) cleanupMessageRichContent(Number(deleteMessageMatch[1]));
        if (deleteRoomMatch) removeUnreferencedFiles(roomStorage);
        if (deleteMessageMatch) removeUnreferencedFiles(messageStorage);
      }
      return handled;
    } finally {
      delete res.__chatLegacyDelete;
      delete res.__chatHideDeleted;
    }
  };
}

module.exports = { ...policy, createChatRoutes, sanitizeRealtimeEvent };
