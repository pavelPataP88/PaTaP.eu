const policy = require("./routes-policy");
const { createChatRepository } = require("./repository");
const { createChatReactionRepository } = require("./reactions");

function isReadOnlyGroup(chat, userId, roomId) {
  const room = chat.getRoom(roomId);
  return room?.kind === "GROUP" && chat.roomForUser(userId, roomId)?.role === "READONLY";
}

function createChatRoutes(options) {
  const inner = policy.createChatRoutes(options);
  const chat = createChatRepository(options.db);
  const reactions = createChatReactionRepository(options.db);

  return async function handleChatRoute(req, res, url, body) {
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

    return inner(req, res, url, body);
  };
}

module.exports = { ...policy, createChatRoutes };
