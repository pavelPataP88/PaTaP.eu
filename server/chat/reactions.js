const REACTION_OPTIONS = Object.freeze([
  { key: "👍", label: "Понял" },
  { key: "✅", label: "Подтверждаю" },
  { key: "👀", label: "Проверяю" },
  { key: "❤️", label: "Поддерживаю" }
]);
const REACTION_KEYS = new Set(REACTION_OPTIONS.map((item) => item.key));

function normalizeReaction(value) {
  const reaction = typeof value === "string" ? value.normalize("NFKC").trim() : "";
  return REACTION_KEYS.has(reaction) ? reaction : null;
}

function createChatReactionRepository(db) {
  function messageRoomId(messageId) {
    const row = db.prepare("SELECT room_id FROM chat_messages WHERE id = ?").get(messageId);
    return row ? Number(row.room_id) : null;
  }

  function reactionsForMessageIds(messageIds, viewerId) {
    const ids = Array.from(new Set((messageIds || []).map(Number).filter(Number.isSafeInteger)));
    const byMessage = new Map(ids.map((id) => [id, []]));
    if (!ids.length) return byMessage;

    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT r.message_id, r.reaction, r.user_id, r.created_at, p.nickname
      FROM chat_message_reactions r
      JOIN driver_profiles p ON p.user_id = r.user_id
      WHERE r.message_id IN (${placeholders})
      ORDER BY r.message_id, r.created_at, r.user_id
    `).all(...ids);

    const grouped = new Map();
    for (const row of rows) {
      const messageId = Number(row.message_id);
      const key = `${messageId}:${row.reaction}`;
      let reaction = grouped.get(key);
      if (!reaction) {
        reaction = {
          key: row.reaction,
          count: 0,
          reactedByMe: false,
          people: []
        };
        grouped.set(key, reaction);
        byMessage.get(messageId)?.push(reaction);
      }
      reaction.count += 1;
      reaction.people.push(row.nickname);
      if (Number(row.user_id) === Number(viewerId)) reaction.reactedByMe = true;
    }

    const order = new Map(REACTION_OPTIONS.map((item, index) => [item.key, index]));
    for (const reactions of byMessage.values()) {
      reactions.sort((left, right) => (order.get(left.key) ?? 99) - (order.get(right.key) ?? 99));
    }
    return byMessage;
  }

  function attachToMessages(messages, viewerId) {
    const items = Array.isArray(messages) ? messages : [];
    const byMessage = reactionsForMessageIds(items.map((message) => message.id), viewerId);
    return items.map((message) => ({
      ...message,
      reactions: byMessage.get(Number(message.id)) || []
    }));
  }

  function listForMessage(messageId, viewerId) {
    return reactionsForMessageIds([messageId], viewerId).get(Number(messageId)) || [];
  }

  function toggleReaction({ messageId, userId, reaction, createdAt }) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const message = db.prepare("SELECT id, room_id FROM chat_messages WHERE id = ?").get(messageId);
      if (!message) {
        const error = new Error("chat_message_not_found");
        error.status = 404;
        throw error;
      }
      const existing = db.prepare(`
        SELECT 1 FROM chat_message_reactions
        WHERE message_id = ? AND user_id = ? AND reaction = ?
      `).get(messageId, userId, reaction);
      let added;
      if (existing) {
        db.prepare(`
          DELETE FROM chat_message_reactions
          WHERE message_id = ? AND user_id = ? AND reaction = ?
        `).run(messageId, userId, reaction);
        added = false;
      } else {
        db.prepare(`
          INSERT INTO chat_message_reactions(message_id, user_id, reaction, created_at)
          VALUES(?, ?, ?, ?)
        `).run(messageId, userId, reaction, createdAt);
        added = true;
      }
      const reactions = listForMessage(messageId, userId);
      db.exec("COMMIT");
      return {
        added,
        messageId: Number(message.id),
        roomId: Number(message.room_id),
        reactions
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return { messageRoomId, attachToMessages, listForMessage, toggleReaction };
}

module.exports = {
  REACTION_OPTIONS,
  normalizeReaction,
  createChatReactionRepository
};
