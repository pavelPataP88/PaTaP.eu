const { createChatRepository } = require("./repository");
const { createChatReactionRepository, normalizeReaction } = require("./reactions");

const CLIENT_MESSAGE_ID = /^[A-Za-z0-9_-]{8,100}$/;

function normalizeMessage(value) {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFKC").trim();
  if (!text || text.length > 2000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) return null;
  return text;
}

function createChatRoutes({ db, json, requireSession, requireCsrf, checkRate, audit, nowIso, publish }) {
  const chat = createChatRepository(db);
  const reactions = createChatReactionRepository(db);

  function requireChatAccess(req, res, roomId = null) {
    const session = requireSession(req, res);
    if (!session) return null;
    if (!chat.hasProfile(session.user.id)) {
      json(res, 409, { error: "driver_profile_required" });
      return null;
    }
    if (roomId !== null) {
      const room = chat.getRoom(roomId);
      const accessError = chat.roomAccessError(session.user.id, room);
      if (accessError) {
        json(res, accessError === "driver_blocked" ? 403 : 404, { error: accessError });
        return null;
      }
      session.chatRoom = room;
    }
    return session;
  }

  return async function handleChatRoute(req, res, url, body) {
    if (!url.pathname.startsWith("/api/driver/chat/")) return false;

    if (req.method === "GET" && url.pathname === "/api/driver/chat/rooms") {
      const session = requireChatAccess(req, res);
      if (session) json(res, 200, { rooms: chat.listRooms(session.user.id) });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/driver/chat/countries") {
      const session = requireChatAccess(req, res);
      if (session) json(res, 200, chat.countryChatForUser(session.user.id));
      return true;
    }

    const countryJoin = url.pathname.match(/^\/api\/driver\/chat\/countries\/([A-Za-z]{2})\/join$/);
    if (req.method === "POST" && countryJoin) {
      if (body === undefined) return false;
      const session = requireChatAccess(req, res);
      if (!session || !requireCsrf(req, res, session)) return true;
      if (!checkRate(`chat-country-join:user:${session.user.id}`, 10, 1)) {
        json(res, 429, { error: "chat_rate_limited" });
        return true;
      }
      try {
        const result = chat.joinCountryChat(session.user.id, countryJoin[1], nowIso());
        if (result.joined) audit(req, "chat_country_joined", {
          userId: session.user.id,
          success: true,
          details: { roomId: result.room.id, countryCode: result.room.countryCode }
        });
        json(res, result.created ? 201 : 200, result);
      } catch (error) {
        const known = ["invalid_country_code", "country_chat_not_eligible"].includes(error.message);
        json(res, error.status || 400, { error: known ? error.message : "invalid_country_chat" });
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/driver/chat/direct") {
      if (body === undefined) return false;
      const session = requireChatAccess(req, res);
      if (!session || !requireCsrf(req, res, session)) return true;
      if (!checkRate(`chat-direct:user:${session.user.id}`, 20, 1)) {
        json(res, 429, { error: "chat_rate_limited" });
        return true;
      }
      try {
        const result = chat.createDirectRoom(session.user.id, body?.nickname, nowIso());
        if (result.created) audit(req, "chat_direct_created", { userId: session.user.id, success: true, details: { roomId: result.room.id } });
        json(res, result.created ? 201 : 200, result);
      } catch (error) {
        const knownError = ["driver_not_found", "driver_blocked", "direct_chat_self_forbidden"].includes(error.message);
        json(res, error.status || 400, { error: knownError ? error.message : "invalid_direct_chat" });
      }
      return true;
    }

    const reactionMatch = url.pathname.match(/^\/api\/driver\/chat\/messages\/(\d+)\/reactions$/);
    if (req.method === "POST" && reactionMatch) {
      if (body === undefined) return false;
      const messageId = Number(reactionMatch[1]);
      const roomId = reactions.messageRoomId(messageId);
      if (roomId === null) {
        const session = requireChatAccess(req, res);
        if (session) json(res, 404, { error: "chat_message_not_found" });
        return true;
      }
      const session = requireChatAccess(req, res, roomId);
      if (!session || !requireCsrf(req, res, session)) return true;
      const reaction = normalizeReaction(body?.reaction);
      if (!reaction) {
        json(res, 400, { error: "invalid_chat_reaction" });
        return true;
      }
      if (!checkRate(`chat-reaction:user:${session.user.id}`, 60, 1)) {
        json(res, 429, { error: "chat_rate_limited" });
        return true;
      }
      try {
        const result = reactions.toggleReaction({
          messageId,
          userId: session.user.id,
          reaction,
          createdAt: nowIso()
        });
        audit(req, result.added ? "chat_reaction_added" : "chat_reaction_removed", {
          userId: session.user.id,
          success: true,
          details: { roomId: result.roomId, messageId: result.messageId, reaction }
        });
        publish({
          type: "chat.reaction.updated",
          roomId: result.roomId,
          messageId: result.messageId,
          reactions: result.reactions
        });
        json(res, 200, result);
      } catch (error) {
        json(res, error.status || 500, { error: error.status ? error.message : "chat_reaction_failed" });
      }
      return true;
    }

    const deleteMatch = url.pathname.match(/^\/api\/driver\/chat\/messages\/(\d+)$/);
    if (req.method === "DELETE" && deleteMatch) {
      const session = requireChatAccess(req, res);
      if (!session || !requireCsrf(req, res, session)) return true;
      if (!checkRate(`chat-delete:user:${session.user.id}`, 30, 1)) {
        json(res, 429, { error: "chat_rate_limited" });
        return true;
      }
      const deleted = chat.deleteOwnMessage(session.user.id, Number(deleteMatch[1]));
      if (!deleted) {
        json(res, 404, { error: "chat_message_not_found" });
        return true;
      }
      audit(req, "chat_message_deleted", {
        userId: session.user.id,
        success: true,
        details: { roomId: deleted.roomId, messageId: deleted.id }
      });
      publish({ type: "chat.message.deleted", roomId: deleted.roomId, messageId: deleted.id });
      json(res, 200, { deleted });
      return true;
    }

    const match = url.pathname.match(/^\/api\/driver\/chat\/rooms\/(\d+)\/messages$/);
    if (!match) return false;
    const roomId = Number(match[1]);

    if (req.method === "GET") {
      const session = requireChatAccess(req, res, roomId);
      if (!session) return true;
      const afterValue = url.searchParams.get("after");
      const beforeValue = url.searchParams.get("before");
      const limitValue = url.searchParams.get("limit");
      const after = afterValue === null ? null : Number(afterValue);
      const before = beforeValue === null ? null : Number(beforeValue);
      const limit = limitValue === null ? 50 : Number(limitValue);
      if ((after !== null && (!Number.isSafeInteger(after) || after < 0)) || (before !== null && (!Number.isSafeInteger(before) || before < 0)) || (after !== null && before !== null) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        json(res, 400, { error: "invalid_chat_cursor" });
        return true;
      }
      const result = chat.listMessages(roomId, { after, before, limit });
      result.messages = reactions.attachToMessages(result.messages, session.user.id);
      json(res, 200, result);
      return true;
    }

    if (body === undefined) return false;
    if (req.method === "POST") {
      const session = requireChatAccess(req, res, roomId);
      if (!session || !requireCsrf(req, res, session)) return true;
      const clientMessageId = String(body.clientMessageId || "");
      const text = normalizeMessage(body.text);
      if (!CLIENT_MESSAGE_ID.test(clientMessageId) || text === null) {
        json(res, 400, { error: "invalid_chat_message" });
        return true;
      }
      if (!checkRate(`chat-message:user:${session.user.id}`, 30, 1)) {
        json(res, 429, { error: "chat_rate_limited" });
        return true;
      }
      const stored = chat.insertMessage({ roomId, senderId: session.user.id, clientMessageId, text, createdAt: nowIso() });
      stored.message.reactions = reactions.listForMessage(stored.message.id, session.user.id);
      if (!stored.duplicate) {
        audit(req, "chat_message_sent", { userId: session.user.id, success: true, details: { roomId } });
        publish({
          type: "chat.message.committed",
          roomId: stored.message.roomId,
          cursor: stored.message.id,
          message: stored.message
        });
      }
      json(res, stored.duplicate ? 200 : 201, stored);
      return true;
    }
    return false;
  };
}

module.exports = { createChatRoutes, normalizeMessage };
