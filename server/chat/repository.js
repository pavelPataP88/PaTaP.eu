const { normalizeCountryCode } = require("../driver/countries");

function publicMessage(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    roomId: Number(row.room_id),
    sender: { nickname: row.nickname, driverType: row.driver_type },
    text: row.body,
    createdAt: row.created_at
  };
}

function createChatRepository(db) {
  const messageSelect = `
    SELECT m.id, m.room_id, m.body, m.created_at, p.nickname, p.driver_type
    FROM chat_messages m
    JOIN driver_profiles p ON p.user_id = m.sender_id
  `;

  function hasProfile(userId) {
    return Boolean(db.prepare("SELECT 1 FROM driver_profiles WHERE user_id = ?").get(userId));
  }

  function getNickname(userId) {
    return db.prepare("SELECT nickname FROM driver_profiles WHERE user_id = ?").get(userId)?.nickname || null;
  }

  function getRoom(roomId) {
    return db.prepare(`
      SELECT r.id, r.room_key, COALESCE(s.space_kind, r.kind) AS kind,
        r.title, r.created_at, s.country_code
      FROM chat_rooms r LEFT JOIN chat_room_spaces s ON s.room_id = r.id
      WHERE r.id = ?
    `).get(roomId);
  }

  function roomForUser(userId, roomId) {
    return db.prepare(`
      SELECT r.id, r.room_key, COALESCE(s.space_kind, r.kind) AS kind,
        r.title, r.created_at, s.country_code,
        CASE WHEN COALESCE(s.space_kind, r.kind) = 'DIRECT' THEN (
          SELECT p.nickname
          FROM chat_room_members m
          JOIN driver_profiles p ON p.user_id = m.user_id
          WHERE m.room_id = r.id AND m.user_id != ?
          LIMIT 1
        ) ELSE r.title END AS display_title,
        (SELECT MAX(m.id) FROM chat_messages m WHERE m.room_id = r.id) AS last_cursor
      FROM chat_rooms r LEFT JOIN chat_room_spaces s ON s.room_id = r.id WHERE r.id = ?
    `).get(userId, roomId);
  }

  function publicRoom(row) {
    if (!row) return null;
    return {
      id: Number(row.id), key: row.room_key, kind: row.kind, title: row.display_title || row.title,
      countryCode: row.country_code || null,
      lastCursor: row.last_cursor === null ? null : Number(row.last_cursor)
    };
  }

  function directRoomBlocked(userId, roomId) {
    return Boolean(db.prepare(`
      SELECT 1
      FROM chat_room_members peer
      JOIN driver_blocks block ON (
        (block.blocker_id = ? AND block.blocked_id = peer.user_id)
        OR (block.blocker_id = peer.user_id AND block.blocked_id = ?)
      )
      WHERE peer.room_id = ? AND peer.user_id != ?
      LIMIT 1
    `).get(userId, userId, roomId, userId));
  }

  function roomAccessError(userId, room) {
    if (!room || !hasProfile(userId)) return "chat_room_not_found";
    if (room.kind === "GENERAL") return null;
    if (room.kind === "COUNTRY") {
      const profile = db.prepare("SELECT country_code FROM driver_profiles WHERE user_id = ?").get(userId);
      if (!profile || profile.country_code !== room.country_code) return "chat_room_not_found";
      return db.prepare("SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?").get(room.id, userId)
        ? null : "chat_room_not_found";
    }
    if (!db.prepare("SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?").get(room.id, userId)) return "chat_room_not_found";
    return directRoomBlocked(userId, room.id) ? "driver_blocked" : null;
  }

  function listRooms(userId) {
    return db.prepare(`
      SELECT r.id, r.room_key, COALESCE(s.space_kind, r.kind) AS kind,
        r.title, r.created_at, s.country_code,
        CASE WHEN COALESCE(s.space_kind, r.kind) = 'DIRECT' THEN (
          SELECT p.nickname
          FROM chat_room_members member
          JOIN driver_profiles p ON p.user_id = member.user_id
          WHERE member.room_id = r.id AND member.user_id != ?
          LIMIT 1
        ) ELSE r.title END AS display_title,
        (SELECT MAX(m.id) FROM chat_messages m WHERE m.room_id = r.id) AS last_cursor
      FROM chat_rooms r
      LEFT JOIN chat_room_spaces s ON s.room_id = r.id
      WHERE COALESCE(s.space_kind, r.kind) = 'GENERAL'
         OR (
           EXISTS (SELECT 1 FROM chat_room_members x WHERE x.room_id = r.id AND x.user_id = ?)
           AND (COALESCE(s.space_kind, r.kind) <> 'COUNTRY'
             OR s.country_code = (SELECT country_code FROM driver_profiles WHERE user_id = ?))
         )
      ORDER BY r.id
    `).all(userId, userId, userId)
      .filter((row) => row.kind !== "DIRECT" || !directRoomBlocked(userId, Number(row.id)))
      .map(publicRoom);
  }

  function createDirectRoom(userId, nickname, createdAt) {
    const nicknameKey = String(nickname || "").normalize("NFKC").trim().toLocaleLowerCase("und");
    const target = db.prepare("SELECT user_id, nickname FROM driver_profiles WHERE nickname_key = ?").get(nicknameKey);
    if (!target) {
      const error = new Error("driver_not_found");
      error.status = 404;
      throw error;
    }
    if (Number(target.user_id) === userId) {
      const error = new Error("direct_chat_self_forbidden");
      error.status = 400;
      throw error;
    }
    if (db.prepare(`SELECT 1 FROM driver_blocks
      WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`)
      .get(userId, target.user_id, target.user_id, userId)) {
      const error = new Error("driver_blocked");
      error.status = 403;
      throw error;
    }
    const [firstUserId, secondUserId] = [userId, Number(target.user_id)].sort((left, right) => left - right);
    db.exec("BEGIN IMMEDIATE");
    try {
      let pair = db.prepare(`
        SELECT room_id FROM chat_direct_pairs WHERE first_user_id = ? AND second_user_id = ?
      `).get(firstUserId, secondUserId);
      let created = false;
      if (!pair) {
        const room = db.prepare(`
          INSERT INTO chat_rooms(room_key, kind, title, created_by, created_at)
          VALUES(?, 'DIRECT', 'Личный чат', ?, ?)
        `).run(`direct:${firstUserId}:${secondUserId}`, userId, createdAt);
        const roomId = Number(room.lastInsertRowid);
        const addMember = db.prepare("INSERT INTO chat_room_members(room_id, user_id, joined_at) VALUES(?, ?, ?)");
        addMember.run(roomId, firstUserId, createdAt);
        addMember.run(roomId, secondUserId, createdAt);
        db.prepare(`
          INSERT INTO chat_room_spaces(room_id, space_kind, country_code, created_at)
          VALUES(?, 'DIRECT', NULL, ?)
        `).run(roomId, createdAt);
        db.prepare(`
          INSERT INTO chat_direct_pairs(first_user_id, second_user_id, room_id, created_at)
          VALUES(?, ?, ?, ?)
        `).run(firstUserId, secondUserId, roomId, createdAt);
        pair = { room_id: roomId };
        created = true;
      }
      const room = roomForUser(userId, Number(pair.room_id));
      db.exec("COMMIT");
      return { room: publicRoom(room), created };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function countryChatForUser(userId) {
    const profile = db.prepare("SELECT country_code FROM driver_profiles WHERE user_id = ?").get(userId);
    if (!profile?.country_code) return { countryCode: null, room: null, joined: false };
    const row = db.prepare(`
      SELECT r.id, r.room_key, 'COUNTRY' AS kind, r.title, r.created_at,
        s.country_code, r.title AS display_title,
        (SELECT MAX(m.id) FROM chat_messages m WHERE m.room_id = r.id) AS last_cursor,
        EXISTS(SELECT 1 FROM chat_room_members member WHERE member.room_id = r.id AND member.user_id = ?) AS joined
      FROM chat_room_spaces s JOIN chat_rooms r ON r.id = s.room_id
      WHERE s.space_kind = 'COUNTRY' AND s.country_code = ?
    `).get(userId, profile.country_code);
    return { countryCode: profile.country_code, room: publicRoom(row), joined: Boolean(row?.joined) };
  }

  function joinCountryChat(userId, countryCode, createdAt) {
    const normalized = normalizeCountryCode(countryCode);
    if (!normalized) {
      const error = new Error("invalid_country_code");
      error.status = 400;
      throw error;
    }
    const profile = db.prepare("SELECT country_code FROM driver_profiles WHERE user_id = ?").get(userId);
    if (!profile?.country_code || profile.country_code !== normalized) {
      const error = new Error("country_chat_not_eligible");
      error.status = 403;
      throw error;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      let row = db.prepare(`
        SELECT r.id FROM chat_room_spaces s JOIN chat_rooms r ON r.id = s.room_id
        WHERE s.space_kind = 'COUNTRY' AND s.country_code = ?
      `).get(normalized);
      let created = false;
      if (!row) {
        const result = db.prepare(`
          INSERT INTO chat_rooms(room_key, kind, title, created_by, created_at)
          VALUES(?, 'GENERAL', ?, NULL, ?)
        `).run(`country:${normalized}`, `Country ${normalized}`, createdAt);
        const roomId = Number(result.lastInsertRowid);
        db.prepare(`INSERT INTO chat_room_spaces(room_id, space_kind, country_code, created_at)
          VALUES(?, 'COUNTRY', ?, ?)`
        ).run(roomId, normalized, createdAt);
        row = { id: roomId };
        created = true;
      }
      const member = db.prepare("SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?").get(row.id, userId);
      if (!member) db.prepare(`
        INSERT INTO chat_room_members(room_id, user_id, joined_at, role) VALUES(?, ?, ?, 'MEMBER')
      `).run(row.id, userId, createdAt);
      const room = roomForUser(userId, Number(row.id));
      db.exec("COMMIT");
      return { room: publicRoom(room), created, joined: !member };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function listMessages(roomId, { after = null, before = null, limit = 50 } = {}) {
    let rows;
    let hasOlder = false;
    if (before !== null) {
      rows = db.prepare(`${messageSelect} WHERE m.room_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`).all(roomId, before, limit + 1);
      hasOlder = rows.length > limit;
      if (hasOlder) rows = rows.slice(0, limit);
      rows.reverse();
    } else if (after === null) {
      rows = db.prepare(`${messageSelect} WHERE m.room_id = ? ORDER BY m.id DESC LIMIT ?`).all(roomId, limit + 1);
      hasOlder = rows.length > limit;
      if (hasOlder) rows = rows.slice(0, limit);
      rows.reverse();
    } else {
      rows = db.prepare(`${messageSelect} WHERE m.room_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`).all(roomId, after, limit + 1);
    }
    const hasMore = rows.length > limit;
    if (hasMore) rows = rows.slice(0, limit);
    const messages = rows.map(publicMessage);
    return {
      messages,
      nextCursor: messages.length ? messages[messages.length - 1].id : after,
      previousCursor: messages.length ? messages[0].id : before,
      hasMore,
      hasOlder
    };
  }

  function insertMessage({ roomId, senderId, clientMessageId, text, createdAt }) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = db.prepare(`
        SELECT id, room_id, sender_id, client_message_id, body
        FROM chat_messages WHERE sender_id = ? AND client_message_id = ?
      `).get(senderId, clientMessageId);
      if (existing) {
        if (Number(existing.room_id) !== roomId || existing.body !== text) {
          const error = new Error("client_message_id_conflict");
          error.status = 409;
          throw error;
        }
        const row = db.prepare(`${messageSelect} WHERE m.id = ?`).get(existing.id);
        db.exec("COMMIT");
        return { message: publicMessage(row), duplicate: true };
      }
      const result = db.prepare(`
        INSERT INTO chat_messages(room_id, sender_id, client_message_id, body, created_at)
        VALUES(?, ?, ?, ?, ?)
      `).run(roomId, senderId, clientMessageId, text, createdAt);
      const row = db.prepare(`${messageSelect} WHERE m.id = ?`).get(result.lastInsertRowid);
      db.exec("COMMIT");
      return { message: publicMessage(row), duplicate: false };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function deleteOwnMessage(userId, messageId) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT id, room_id FROM chat_messages WHERE id = ? AND sender_id = ?")
        .get(messageId, userId);
      if (!row) {
        db.exec("COMMIT");
        return null;
      }
      const deleted = db.prepare("DELETE FROM chat_messages WHERE id = ? AND sender_id = ?")
        .run(messageId, userId).changes;
      if (deleted !== 1) throw new Error("chat_message_delete_conflict");
      db.exec("COMMIT");
      return { id: Number(row.id), roomId: Number(row.room_id) };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    hasProfile, getNickname, getRoom, roomAccessError, listRooms, createDirectRoom,
    countryChatForUser, joinCountryChat, listMessages, insertMessage, deleteOwnMessage
  };
}

module.exports = { createChatRepository };
