const crypto = require("crypto");
const { normalizeCountryCode } = require("../driver/countries");
const { ensureChatSchema } = require("./schema");

const GROUP_ROLES = new Set(["OWNER", "ADMIN", "MODERATOR", "MEMBER", "READONLY"]);
const GROUP_VISIBILITIES = new Set(["PUBLIC", "PRIVATE"]);
const HISTORY_POLICIES = new Set(["FULL", "JOINED"]);
const NOTIFICATION_LEVELS = new Set(["ALL", "MENTIONS", "NONE"]);
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_PINS = 5;
const MAX_ATTACHMENTS = 10;
const MAX_POLL_OPTIONS = 12;
const MESSAGE_RETENTION_OPTIONS = new Set([0, 3600, 86400, 604800, 2592000]);

function normalizeNickname(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("und");
}

function normalizeGroupTitle(value) {
  const text = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  return text.length >= 3 && text.length <= 64 && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
}

function normalizeDescription(value) {
  const text = String(value || "").normalize("NFKC").trim();
  return text.length <= 500 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ? text : null;
}

function normalizePollText(value, maxLength) {
  const text = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  return text && text.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
}

function addSeconds(now, seconds) {
  return new Date(new Date(now).getTime() + seconds * 1000).toISOString();
}

function createChatRepository(db) {
  ensureChatSchema(db);

  function hasProfile(userId) {
    return Boolean(db.prepare("SELECT 1 FROM driver_profiles WHERE user_id = ?").get(userId));
  }

  function getNickname(userId) {
    return db.prepare("SELECT nickname FROM driver_profiles WHERE user_id = ?").get(userId)?.nickname || null;
  }

  function areBlocked(leftUserId, rightUserId) {
    return Boolean(db.prepare(`SELECT 1 FROM driver_blocks
      WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`)
      .get(leftUserId, rightUserId, rightUserId, leftUserId));
  }

  function areContacts(leftUserId, rightUserId) {
    return Boolean(db.prepare(`SELECT 1 FROM driver_relationships
      WHERE status = 'ACCEPTED' AND ((requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?))`)
      .get(leftUserId, rightUserId, rightUserId, leftUserId));
  }

  function getRoom(roomId) {
    return db.prepare(`
      SELECT r.id, r.room_key,
        CASE WHEN gp.room_id IS NOT NULL THEN 'GROUP' ELSE COALESCE(s.space_kind, r.kind) END AS kind,
        r.title, r.created_at, r.created_by, s.country_code,
        gp.description, gp.visibility, gp.history_policy, gp.created_by AS group_created_by
      FROM chat_rooms r
      LEFT JOIN chat_room_spaces s ON s.room_id = r.id
      LEFT JOIN chat_room_profiles gp ON gp.room_id = r.id
      WHERE r.id = ?
    `).get(roomId) || null;
  }

  function directPeer(userId, roomId) {
    return db.prepare(`SELECT m.user_id, p.nickname, p.driver_type, u.last_seen_at
      FROM chat_room_members m
      JOIN driver_profiles p ON p.user_id = m.user_id
      JOIN users u ON u.id = m.user_id
      WHERE m.room_id = ? AND m.user_id != ? LIMIT 1`).get(roomId, userId) || null;
  }

  function isMember(roomId, userId) {
    return Boolean(db.prepare("SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?").get(roomId, userId));
  }

  function ensureMemberState(roomId, userId, now = new Date().toISOString()) {
    db.prepare(`INSERT OR IGNORE INTO chat_room_member_state(room_id, user_id, updated_at) VALUES(?, ?, ?)`)
      .run(roomId, userId, now);
    return db.prepare("SELECT * FROM chat_room_member_state WHERE room_id = ? AND user_id = ?").get(roomId, userId);
  }

  function groupRole(userId, roomId) {
    return db.prepare("SELECT role FROM chat_room_members WHERE room_id = ? AND user_id = ?").get(roomId, userId)?.role || null;
  }

  function canModerate(userId, roomId) {
    return ["OWNER", "ADMIN", "MODERATOR"].includes(groupRole(userId, roomId));
  }

  function canManage(userId, roomId) {
    return ["OWNER", "ADMIN"].includes(groupRole(userId, roomId));
  }

  function directRoomBlocked(userId, roomId) {
    const peer = directPeer(userId, roomId);
    return Boolean(peer && areBlocked(userId, Number(peer.user_id)));
  }

  function roomAccessError(userId, room) {
    if (!room || !hasProfile(userId)) return "chat_room_not_found";
    if (room.kind === "GENERAL") return null;
    if (room.kind === "COUNTRY") {
      const profile = db.prepare("SELECT country_code FROM driver_profiles WHERE user_id = ?").get(userId);
      return profile?.country_code === room.country_code && isMember(room.id, userId) ? null : "chat_room_not_found";
    }
    if (room.kind === "GROUP") {
      if (db.prepare("SELECT 1 FROM chat_room_bans WHERE room_id = ? AND user_id = ?").get(room.id, userId)) return "chat_room_banned";
      return isMember(room.id, userId) ? null : "chat_room_not_found";
    }
    if (!isMember(room.id, userId)) return "chat_room_not_found";
    return directRoomBlocked(userId, room.id) ? "driver_blocked" : null;
  }

  function cleanupExpiredMessages(now) {
    db.prepare(`UPDATE chat_messages SET body = '' WHERE id IN (
      SELECT message_id FROM chat_message_meta WHERE expires_at IS NOT NULL AND expires_at <= ? AND deleted_at IS NULL
    )`).run(now);
    db.prepare(`UPDATE chat_message_meta SET deleted_at = COALESCE(deleted_at, ?)
      WHERE expires_at IS NOT NULL AND expires_at <= ?`).run(now, now);
  }

  function roomMemberCount(room) {
    if (room.kind === "GENERAL") return Number(db.prepare("SELECT COUNT(*) AS n FROM driver_profiles").get().n || 0);
    return Number(db.prepare("SELECT COUNT(*) AS n FROM chat_room_members WHERE room_id = ?").get(room.id).n || 0);
  }

  function latestMessagePreview(userId, roomId) {
    const row = db.prepare(`SELECT m.id, m.body, m.sender_id, m.created_at, mm.deleted_at, p.nickname,
        EXISTS(SELECT 1 FROM chat_message_attachments a WHERE a.message_id = m.id) AS has_attachment,
        EXISTS(SELECT 1 FROM chat_polls poll WHERE poll.message_id = m.id) AS has_poll
      FROM chat_messages m
      JOIN driver_profiles p ON p.user_id = m.sender_id
      LEFT JOIN chat_message_meta mm ON mm.message_id = m.id
      WHERE m.room_id = ?
        AND NOT EXISTS(SELECT 1 FROM chat_hidden_messages h WHERE h.message_id = m.id AND h.user_id = ?)
      ORDER BY m.id DESC LIMIT 1`).get(roomId, userId);
    if (!row) return null;
    let preview = row.body;
    if (row.deleted_at) preview = "Сообщение удалено";
    else if (!preview && row.has_poll) preview = "Опрос";
    else if (!preview && row.has_attachment) preview = "Вложение";
    return { id: Number(row.id), sender: row.nickname, own: Number(row.sender_id) === Number(userId), text: preview, createdAt: row.created_at };
  }

  function roomForUser(userId, roomId, now = new Date().toISOString()) {
    const room = getRoom(roomId);
    if (roomAccessError(userId, room)) return null;
    const state = ensureMemberState(room.id, userId, now);
    const peer = room.kind === "DIRECT" ? directPeer(userId, room.id) : null;
    const lastCursor = Number(db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM chat_messages WHERE room_id = ?").get(room.id).id || 0);
    const unreadCount = Number(db.prepare(`SELECT COUNT(*) AS n FROM chat_messages m
      LEFT JOIN chat_message_meta mm ON mm.message_id = m.id
      WHERE m.room_id = ? AND m.id > ? AND m.sender_id != ? AND mm.deleted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM chat_hidden_messages h WHERE h.message_id = m.id AND h.user_id = ?)`)
      .get(room.id, Number(state.last_read_message_id || 0), userId, userId).n || 0);
    const mentionCount = Number(db.prepare(`SELECT COUNT(*) AS n FROM chat_message_mentions mention
      JOIN chat_messages m ON m.id = mention.message_id
      LEFT JOIN chat_message_meta mm ON mm.message_id = m.id
      WHERE mention.user_id = ? AND m.room_id = ? AND m.id > ? AND mm.deleted_at IS NULL`)
      .get(userId, room.id, Number(state.last_read_message_id || 0)).n || 0);
    const draft = db.prepare("SELECT body, reply_to_message_id, updated_at FROM chat_drafts WHERE room_id = ? AND user_id = ?").get(room.id, userId);
    const memberCount = roomMemberCount(room);
    const role = room.kind === "GROUP" ? groupRole(userId, room.id) : "MEMBER";
    return {
      id: Number(room.id),
      key: room.room_key,
      kind: room.kind,
      title: room.kind === "DIRECT" ? peer?.nickname || "Личный чат" : room.title,
      description: room.description || "",
      countryCode: room.country_code || null,
      visibility: room.kind === "GROUP" ? room.visibility : null,
      historyPolicy: room.kind === "GROUP" ? room.history_policy : null,
      role,
      canManage: room.kind === "GROUP" && canManage(userId, room.id),
      canModerate: room.kind === "GROUP" && canModerate(userId, room.id),
      memberCount,
      lastCursor: lastCursor || null,
      lastMessage: latestMessagePreview(userId, room.id),
      unreadCount,
      mentionCount,
      muted: Boolean(state.muted),
      favorite: Boolean(state.favorite),
      archived: Boolean(state.archived),
      pinnedRank: state.pinned_rank === null ? null : Number(state.pinned_rank),
      notificationLevel: state.notification_level,
      peer: peer ? { nickname: peer.nickname, driverType: peer.driver_type, lastSeenAt: peer.last_seen_at } : null,
      draft: draft ? { text: draft.body, replyToMessageId: draft.reply_to_message_id === null ? null : Number(draft.reply_to_message_id), updatedAt: draft.updated_at } : null
    };
  }

  function listRooms(userId, now = new Date().toISOString()) {
    cleanupExpiredMessages(now);
    const profile = db.prepare("SELECT country_code FROM driver_profiles WHERE user_id = ?").get(userId);
    const ids = db.prepare(`SELECT DISTINCT r.id
      FROM chat_rooms r
      LEFT JOIN chat_room_spaces s ON s.room_id = r.id
      LEFT JOIN chat_room_profiles gp ON gp.room_id = r.id
      WHERE (gp.room_id IS NULL AND COALESCE(s.space_kind, r.kind) = 'GENERAL')
         OR EXISTS(SELECT 1 FROM chat_room_members m WHERE m.room_id = r.id AND m.user_id = ?)`)
      .all(userId).map((row) => Number(row.id));
    const rooms = ids.map((id) => roomForUser(userId, id, now)).filter(Boolean)
      .filter((room) => room.kind !== "COUNTRY" || room.countryCode === profile?.country_code);
    rooms.sort((a, b) => {
      const ap = a.pinnedRank === null ? 9999 : a.pinnedRank;
      const bp = b.pinnedRank === null ? 9999 : b.pinnedRank;
      if (ap !== bp) return ap - bp;
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      const at = a.lastMessage?.createdAt ? Date.parse(a.lastMessage.createdAt) : 0;
      const bt = b.lastMessage?.createdAt ? Date.parse(b.lastMessage.createdAt) : 0;
      return bt - at || b.id - a.id;
    });
    return rooms;
  }

  function createDirectRoom(userId, nickname, createdAt) {
    const target = db.prepare("SELECT user_id FROM driver_profiles WHERE nickname_key = ?").get(normalizeNickname(nickname));
    if (!target) { const error = new Error("driver_not_found"); error.status = 404; throw error; }
    const targetId = Number(target.user_id);
    if (targetId === Number(userId)) { const error = new Error("direct_chat_self_forbidden"); error.status = 400; throw error; }
    if (areBlocked(userId, targetId)) { const error = new Error("driver_blocked"); error.status = 403; throw error; }
    const [firstUserId, secondUserId] = [Number(userId), targetId].sort((a, b) => a - b);
    db.exec("BEGIN IMMEDIATE");
    try {
      let pair = db.prepare("SELECT room_id FROM chat_direct_pairs WHERE first_user_id = ? AND second_user_id = ?").get(firstUserId, secondUserId);
      let created = false;
      if (!pair) {
        const result = db.prepare("INSERT INTO chat_rooms(room_key, kind, title, created_by, created_at) VALUES(?, 'DIRECT', 'Личный чат', ?, ?)")
          .run(`direct:${firstUserId}:${secondUserId}`, userId, createdAt);
        const roomId = Number(result.lastInsertRowid);
        const addMember = db.prepare("INSERT INTO chat_room_members(room_id, user_id, joined_at) VALUES(?, ?, ?)");
        addMember.run(roomId, firstUserId, createdAt); addMember.run(roomId, secondUserId, createdAt);
        db.prepare("INSERT INTO chat_room_spaces(room_id, space_kind, country_code, created_at) VALUES(?, 'DIRECT', NULL, ?)").run(roomId, createdAt);
        db.prepare("INSERT INTO chat_direct_pairs(first_user_id, second_user_id, room_id, created_at) VALUES(?, ?, ?, ?)")
          .run(firstUserId, secondUserId, roomId, createdAt);
        pair = { room_id: roomId }; created = true;
      }
      ensureMemberState(Number(pair.room_id), firstUserId, createdAt);
      ensureMemberState(Number(pair.room_id), secondUserId, createdAt);
      const room = roomForUser(userId, Number(pair.room_id), createdAt);
      db.exec("COMMIT");
      return { room, created };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function countryChatForUser(userId, now = new Date().toISOString()) {
    const profile = db.prepare("SELECT country_code FROM driver_profiles WHERE user_id = ?").get(userId);
    if (!profile?.country_code) return { countryCode: null, room: null, joined: false };
    const row = db.prepare(`SELECT r.id,
      EXISTS(SELECT 1 FROM chat_room_members member WHERE member.room_id = r.id AND member.user_id = ?) AS joined
      FROM chat_room_spaces s JOIN chat_rooms r ON r.id = s.room_id
      WHERE s.space_kind = 'COUNTRY' AND s.country_code = ?`).get(userId, profile.country_code);
    return { countryCode: profile.country_code, room: row ? roomForUser(userId, Number(row.id), now) : null, joined: Boolean(row?.joined) };
  }

  function joinCountryChat(userId, countryCode, createdAt) {
    const normalized = normalizeCountryCode(countryCode);
    if (!normalized) { const error = new Error("invalid_country_code"); error.status = 400; throw error; }
    const profile = db.prepare("SELECT country_code FROM driver_profiles WHERE user_id = ?").get(userId);
    if (!profile?.country_code || profile.country_code !== normalized) { const error = new Error("country_chat_not_eligible"); error.status = 403; throw error; }
    db.exec("BEGIN IMMEDIATE");
    try {
      let row = db.prepare(`SELECT r.id FROM chat_room_spaces s JOIN chat_rooms r ON r.id = s.room_id WHERE s.space_kind = 'COUNTRY' AND s.country_code = ?`).get(normalized);
      let created = false;
      if (!row) {
        const result = db.prepare("INSERT INTO chat_rooms(room_key, kind, title, created_by, created_at) VALUES(?, 'GENERAL', ?, NULL, ?)")
          .run(`country:${normalized}`, `Country ${normalized}`, createdAt);
        const roomId = Number(result.lastInsertRowid);
        db.prepare("INSERT INTO chat_room_spaces(room_id, space_kind, country_code, created_at) VALUES(?, 'COUNTRY', ?, ?)").run(roomId, normalized, createdAt);
        row = { id: roomId }; created = true;
      }
      const member = isMember(row.id, userId);
      if (!member) db.prepare("INSERT INTO chat_room_members(room_id, user_id, joined_at, role) VALUES(?, ?, ?, 'MEMBER')").run(row.id, userId, createdAt);
      ensureMemberState(Number(row.id), userId, createdAt);
      const room = roomForUser(userId, Number(row.id), createdAt);
      db.exec("COMMIT");
      return { room, created, joined: !member };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function createGroupRoom(userId, input, now) {
    const title = normalizeGroupTitle(input?.title);
    const description = normalizeDescription(input?.description);
    const visibility = String(input?.visibility || "PRIVATE").toUpperCase();
    const historyPolicy = String(input?.historyPolicy || "FULL").toUpperCase();
    if (!title || description === null || !GROUP_VISIBILITIES.has(visibility) || !HISTORY_POLICIES.has(historyPolicy)) {
      return { error: "invalid_chat_group", status: 400 };
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db.prepare("INSERT INTO chat_rooms(room_key, kind, title, created_by, created_at) VALUES(?, 'GENERAL', ?, ?, ?)")
        .run(`group:${crypto.randomUUID()}`, title, userId, now);
      const roomId = Number(result.lastInsertRowid);
      db.prepare(`INSERT INTO chat_room_profiles(room_id, space_kind, description, visibility, history_policy, created_by, created_at, updated_at)
        VALUES(?, 'GROUP', ?, ?, ?, ?, ?, ?)`).run(roomId, description, visibility, historyPolicy, userId, now, now);
      db.prepare("INSERT INTO chat_room_members(room_id, user_id, joined_at, role) VALUES(?, ?, ?, 'OWNER')").run(roomId, userId, now);
      ensureMemberState(roomId, userId, now);
      db.exec("COMMIT");
      return { room: roomForUser(userId, roomId, now), created: true };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function discoverGroups(userId, query, now) {
    const q = String(query || "").normalize("NFKC").trim().slice(0, 64);
    const escaped = `%${q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    return db.prepare(`SELECT r.id, r.title, gp.description, gp.history_policy,
        EXISTS(SELECT 1 FROM chat_room_members m WHERE m.room_id = r.id AND m.user_id = ?) AS joined,
        (SELECT COUNT(*) FROM chat_room_members m WHERE m.room_id = r.id) AS member_count
      FROM chat_room_profiles gp JOIN chat_rooms r ON r.id = gp.room_id
      WHERE gp.visibility = 'PUBLIC' AND r.title LIKE ? ESCAPE '\\'
        AND NOT EXISTS(SELECT 1 FROM chat_room_bans b WHERE b.room_id = r.id AND b.user_id = ?)
      ORDER BY joined DESC, member_count DESC, r.id DESC LIMIT 50`).all(userId, escaped, userId)
      .map((row) => ({ id: Number(row.id), title: row.title, description: row.description, historyPolicy: row.history_policy, joined: Boolean(row.joined), memberCount: Number(row.member_count || 0) }));
  }

  function joinPublicGroup(userId, roomId, now) {
    const room = getRoom(roomId);
    if (!room || room.kind !== "GROUP" || room.visibility !== "PUBLIC") return { error: "chat_room_not_found", status: 404 };
    if (db.prepare("SELECT 1 FROM chat_room_bans WHERE room_id = ? AND user_id = ?").get(roomId, userId)) return { error: "chat_room_banned", status: 403 };
    db.prepare("INSERT OR IGNORE INTO chat_room_members(room_id, user_id, joined_at, role) VALUES(?, ?, ?, 'MEMBER')").run(roomId, userId, now);
    ensureMemberState(roomId, userId, now);
    db.prepare("DELETE FROM chat_room_invites WHERE room_id = ? AND target_user_id = ?").run(roomId, userId);
    return { room: roomForUser(userId, roomId, now) };
  }

  function inviteToGroup(userId, roomId, nickname, now) {
    const room = getRoom(roomId);
    if (!room || room.kind !== "GROUP" || !canModerate(userId, roomId)) return { error: "chat_room_forbidden", status: 403 };
    const target = db.prepare("SELECT user_id FROM driver_profiles WHERE nickname_key = ?").get(normalizeNickname(nickname));
    if (!target) return { error: "driver_not_found", status: 404 };
    const targetId = Number(target.user_id);
    if (targetId === Number(userId)) return { error: "chat_self_forbidden", status: 400 };
    if (!areContacts(userId, targetId)) return { error: "chat_contact_required", status: 403 };
    if (db.prepare("SELECT 1 FROM chat_room_bans WHERE room_id = ? AND user_id = ?").get(roomId, targetId)) return { error: "chat_room_banned", status: 403 };
    if (isMember(roomId, targetId)) return { error: "chat_already_member", status: 409 };
    db.prepare(`INSERT INTO chat_room_invites(room_id, target_user_id, invited_by, created_at) VALUES(?, ?, ?, ?)
      ON CONFLICT(room_id,target_user_id) DO UPDATE SET invited_by = excluded.invited_by, created_at = excluded.created_at`)
      .run(roomId, targetId, userId, now);
    return { ok: true };
  }

  function listInvites(userId) {
    return db.prepare(`SELECT i.room_id, i.created_at, r.title, gp.description, gp.visibility, p.nickname AS invited_by,
        (SELECT COUNT(*) FROM chat_room_members m WHERE m.room_id = i.room_id) AS member_count
      FROM chat_room_invites i
      JOIN chat_rooms r ON r.id = i.room_id
      JOIN chat_room_profiles gp ON gp.room_id = i.room_id
      LEFT JOIN driver_profiles p ON p.user_id = i.invited_by
      WHERE i.target_user_id = ? ORDER BY i.created_at DESC`).all(userId)
      .map((row) => ({ roomId: Number(row.room_id), title: row.title, description: row.description, visibility: row.visibility, invitedBy: row.invited_by || "Driver", memberCount: Number(row.member_count || 0), createdAt: row.created_at }));
  }

  function respondToInvite(userId, roomId, action, now) {
    const invite = db.prepare("SELECT 1 FROM chat_room_invites WHERE room_id = ? AND target_user_id = ?").get(roomId, userId);
    if (!invite) return { error: "chat_invite_not_found", status: 404 };
    const normalized = String(action || "").toUpperCase();
    if (!["ACCEPT", "DECLINE"].includes(normalized)) return { error: "invalid_chat_invite_action", status: 400 };
    if (normalized === "ACCEPT") {
      if (db.prepare("SELECT 1 FROM chat_room_bans WHERE room_id = ? AND user_id = ?").get(roomId, userId)) return { error: "chat_room_banned", status: 403 };
      db.prepare("INSERT OR IGNORE INTO chat_room_members(room_id, user_id, joined_at, role) VALUES(?, ?, ?, 'MEMBER')").run(roomId, userId, now);
      ensureMemberState(roomId, userId, now);
    }
    db.prepare("DELETE FROM chat_room_invites WHERE room_id = ? AND target_user_id = ?").run(roomId, userId);
    return { accepted: normalized === "ACCEPT", room: normalized === "ACCEPT" ? roomForUser(userId, roomId, now) : null };
  }

  function updateGroup(userId, roomId, input, now) {
    const room = getRoom(roomId);
    if (!room || room.kind !== "GROUP") return { error: "chat_room_not_found", status: 404 };
    if (!canManage(userId, roomId)) return { error: "chat_room_forbidden", status: 403 };
    const title = input?.title === undefined ? room.title : normalizeGroupTitle(input.title);
    const description = input?.description === undefined ? room.description : normalizeDescription(input.description);
    const visibility = input?.visibility === undefined ? room.visibility : String(input.visibility).toUpperCase();
    const historyPolicy = input?.historyPolicy === undefined ? room.history_policy : String(input.historyPolicy).toUpperCase();
    if (!title || description === null || !GROUP_VISIBILITIES.has(visibility) || !HISTORY_POLICIES.has(historyPolicy)) return { error: "invalid_chat_group", status: 400 };
    db.prepare("UPDATE chat_rooms SET title = ? WHERE id = ?").run(title, roomId);
    db.prepare("UPDATE chat_room_profiles SET description = ?, visibility = ?, history_policy = ?, updated_at = ? WHERE room_id = ?")
      .run(description, visibility, historyPolicy, now, roomId);
    return { room: roomForUser(userId, roomId, now) };
  }

  function listMembers(userId, roomId) {
    const room = getRoom(roomId);
    const access = roomAccessError(userId, room);
    if (access) return { error: access, status: 404 };
    const rows = db.prepare(`SELECT p.nickname, p.driver_type, m.role, m.joined_at, u.last_seen_at
      FROM chat_room_members m JOIN driver_profiles p ON p.user_id = m.user_id JOIN users u ON u.id = m.user_id
      WHERE m.room_id = ?
      ORDER BY CASE m.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 WHEN 'MODERATOR' THEN 2 WHEN 'MEMBER' THEN 3 ELSE 4 END, p.nickname COLLATE NOCASE`).all(roomId);
    return { members: rows.map((row) => ({ nickname: row.nickname, driverType: row.driver_type, role: row.role, joinedAt: row.joined_at, lastSeenAt: row.last_seen_at })) };
  }

  function setMemberRole(userId, roomId, nickname, nextRole) {
    const room = getRoom(roomId);
    if (!room || room.kind !== "GROUP") return { error: "chat_room_not_found", status: 404 };
    const requesterRole = groupRole(userId, roomId);
    if (!requesterRole || !["OWNER", "ADMIN"].includes(requesterRole)) return { error: "chat_room_forbidden", status: 403 };
    const role = String(nextRole || "").toUpperCase();
    if (!GROUP_ROLES.has(role)) return { error: "invalid_chat_role", status: 400 };
    if (requesterRole === "ADMIN" && ["OWNER", "ADMIN"].includes(role)) return { error: "chat_room_forbidden", status: 403 };
    const target = db.prepare(`SELECT m.user_id, m.role FROM chat_room_members m JOIN driver_profiles p ON p.user_id = m.user_id
      WHERE m.room_id = ? AND p.nickname_key = ?`).get(roomId, normalizeNickname(nickname));
    if (!target) return { error: "chat_member_not_found", status: 404 };
    const targetId = Number(target.user_id);
    if (target.role === "OWNER" && targetId === Number(userId) && role !== "OWNER") return { error: "chat_owner_transfer_required", status: 409 };
    if (role === "OWNER") {
      if (requesterRole !== "OWNER") return { error: "chat_room_forbidden", status: 403 };
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE chat_room_members SET role = 'ADMIN' WHERE room_id = ? AND user_id = ?").run(roomId, userId);
        db.prepare("UPDATE chat_room_members SET role = 'OWNER' WHERE room_id = ? AND user_id = ?").run(roomId, targetId);
        db.exec("COMMIT");
        return { ok: true, role: "OWNER" };
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    }
    if (requesterRole === "ADMIN" && ["OWNER", "ADMIN"].includes(target.role)) return { error: "chat_room_forbidden", status: 403 };
    db.prepare("UPDATE chat_room_members SET role = ? WHERE room_id = ? AND user_id = ?").run(role, roomId, targetId);
    return { ok: true, role };
  }

  function removeMember(userId, roomId, nickname, { ban = false } = {}, now) {
    const room = getRoom(roomId);
    const requesterRole = groupRole(userId, roomId);
    if (!room || room.kind !== "GROUP" || !["OWNER", "ADMIN", "MODERATOR"].includes(requesterRole)) return { error: "chat_room_forbidden", status: 403 };
    const target = db.prepare(`SELECT m.user_id, m.role FROM chat_room_members m JOIN driver_profiles p ON p.user_id = m.user_id
      WHERE m.room_id = ? AND p.nickname_key = ?`).get(roomId, normalizeNickname(nickname));
    if (!target) return { error: "chat_member_not_found", status: 404 };
    if (Number(target.user_id) === Number(userId) || target.role === "OWNER" || (requesterRole !== "OWNER" && ["ADMIN", "MODERATOR"].includes(target.role))) return { error: "chat_room_forbidden", status: 403 };
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM chat_room_members WHERE room_id = ? AND user_id = ?").run(roomId, target.user_id);
      db.prepare("DELETE FROM chat_room_invites WHERE room_id = ? AND target_user_id = ?").run(roomId, target.user_id);
      if (ban) db.prepare("INSERT OR REPLACE INTO chat_room_bans(room_id, user_id, blocked_by, created_at) VALUES(?, ?, ?, ?)").run(roomId, target.user_id, userId, now);
      db.exec("COMMIT");
      return { removed: true, banned: Boolean(ban), userId: Number(target.user_id) };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function unbanMember(userId, roomId, nickname) {
    if (!canModerate(userId, roomId)) return { error: "chat_room_forbidden", status: 403 };
    const target = db.prepare("SELECT user_id FROM driver_profiles WHERE nickname_key = ?").get(normalizeNickname(nickname));
    if (!target) return { error: "driver_not_found", status: 404 };
    return { unbanned: db.prepare("DELETE FROM chat_room_bans WHERE room_id = ? AND user_id = ?").run(roomId, target.user_id).changes === 1 };
  }

  function leaveGroup(userId, roomId) {
    const room = getRoom(roomId);
    if (!room || room.kind !== "GROUP") return { error: "chat_leave_forbidden", status: 400 };
    if (!isMember(roomId, userId)) return { error: "chat_room_not_found", status: 404 };
    if (groupRole(userId, roomId) === "OWNER") return { error: "chat_owner_transfer_required", status: 409 };
    return { left: db.prepare("DELETE FROM chat_room_members WHERE room_id = ? AND user_id = ?").run(roomId, userId).changes === 1 };
  }

  function deleteGroup(userId, roomId) {
    const room = getRoom(roomId);
    if (!room || room.kind !== "GROUP") return { error: "chat_room_not_found", status: 404 };
    if (groupRole(userId, roomId) !== "OWNER") return { error: "chat_room_forbidden", status: 403 };
    return { deleted: db.prepare("DELETE FROM chat_rooms WHERE id = ?").run(roomId).changes === 1 };
  }

  function updateRoomPreferences(userId, roomId, input, now) {
    const room = getRoom(roomId);
    const access = roomAccessError(userId, room);
    if (access) return { error: access, status: 404 };
    const current = ensureMemberState(roomId, userId, now);
    const muted = input?.muted === undefined ? Number(current.muted) : input.muted ? 1 : 0;
    const favorite = input?.favorite === undefined ? Number(current.favorite) : input.favorite ? 1 : 0;
    const archived = input?.archived === undefined ? Number(current.archived) : input.archived ? 1 : 0;
    const pinnedRank = input?.pinnedRank === undefined ? current.pinned_rank : input.pinnedRank === null ? null : Number(input.pinnedRank);
    const notificationLevel = input?.notificationLevel === undefined ? current.notification_level : String(input.notificationLevel).toUpperCase();
    if ((pinnedRank !== null && (!Number.isSafeInteger(pinnedRank) || pinnedRank < 0 || pinnedRank > 99)) || !NOTIFICATION_LEVELS.has(notificationLevel)) return { error: "invalid_chat_preferences", status: 400 };
    db.prepare(`UPDATE chat_room_member_state SET muted = ?, favorite = ?, archived = ?, pinned_rank = ?, notification_level = ?, updated_at = ?
      WHERE room_id = ? AND user_id = ?`).run(muted, favorite, archived, pinnedRank, notificationLevel, now, roomId, userId);
    return { muted: Boolean(muted), favorite: Boolean(favorite), archived: Boolean(archived), pinnedRank, notificationLevel };
  }

  function saveDraft(userId, roomId, text, replyToMessageId, now) {
    const room = getRoom(roomId);
    if (roomAccessError(userId, room)) return { error: "chat_room_not_found", status: 404 };
    const body = String(text || "").normalize("NFKC").slice(0, 4000);
    let replyId = replyToMessageId === null || replyToMessageId === undefined ? null : Number(replyToMessageId);
    if (replyId !== null && !db.prepare("SELECT 1 FROM chat_messages WHERE id = ? AND room_id = ?").get(replyId, roomId)) replyId = null;
    if (!body && replyId === null) {
      db.prepare("DELETE FROM chat_drafts WHERE room_id = ? AND user_id = ?").run(roomId, userId);
      return { draft: null };
    }
    db.prepare(`INSERT INTO chat_drafts(room_id,user_id,body,reply_to_message_id,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(room_id,user_id) DO UPDATE SET body=excluded.body,reply_to_message_id=excluded.reply_to_message_id,updated_at=excluded.updated_at`)
      .run(roomId, userId, body, replyId, now);
    return { draft: { text: body, replyToMessageId: replyId, updatedAt: now } };
  }

  function historyFloor(userId, room) {
    if (room.kind !== "GROUP" || room.history_policy !== "JOINED") return null;
    return db.prepare("SELECT joined_at FROM chat_room_members WHERE room_id = ? AND user_id = ?").get(room.id, userId)?.joined_at || null;
  }

  function baseMessageRows(userId, roomId, { after = null, before = null, limit = 50 } = {}) {
    const room = getRoom(roomId);
    const floor = historyFloor(userId, room);
    const clauses = ["m.room_id = ?", "NOT EXISTS(SELECT 1 FROM chat_hidden_messages h WHERE h.message_id = m.id AND h.user_id = ?)"];
    const args = [roomId, userId];
    if (floor) { clauses.push("m.created_at >= ?"); args.push(floor); }
    if (before !== null) { clauses.push("m.id < ?"); args.push(before); }
    else if (after !== null) { clauses.push("m.id > ?"); args.push(after); }
    const direction = before !== null || after === null ? "DESC" : "ASC";
    args.push(limit + 1);
    let rows = db.prepare(`SELECT m.id,m.room_id,m.sender_id,m.body,m.created_at,p.nickname,p.driver_type,
        mm.reply_to_message_id,mm.forwarded_from_message_id,mm.edited_at,mm.deleted_at,mm.expires_at
      FROM chat_messages m JOIN driver_profiles p ON p.user_id=m.sender_id
      LEFT JOIN chat_message_meta mm ON mm.message_id=m.id
      WHERE ${clauses.join(" AND ")} ORDER BY m.id ${direction} LIMIT ?`).all(...args);
    const overflow = rows.length > limit;
    if (overflow) rows = rows.slice(0, limit);
    if (direction === "DESC") rows.reverse();
    return { rows, overflow };
  }

  function attachmentsForMessages(messageIds) {
    const ids = messageIds.map(Number).filter(Number.isSafeInteger);
    const map = new Map(ids.map((id) => [id, []]));
    if (!ids.length) return map;
    const placeholders = ids.map(() => "?").join(",");
    for (const row of db.prepare(`SELECT id,message_id,kind,file_name,mime_type,byte_length,duration_ms,created_at
      FROM chat_message_attachments WHERE message_id IN (${placeholders}) ORDER BY id`).all(...ids)) {
      map.get(Number(row.message_id))?.push({ id: Number(row.id), kind: row.kind, fileName: row.file_name, mimeType: row.mime_type, byteLength: Number(row.byte_length), durationMs: row.duration_ms === null ? null : Number(row.duration_ms), createdAt: row.created_at });
    }
    return map;
  }

  function pollForMessage(messageId, viewerId) {
    const poll = db.prepare("SELECT * FROM chat_polls WHERE message_id = ?").get(messageId);
    if (!poll) return null;
    const options = db.prepare(`SELECT o.id,o.option_index,o.body,
        (SELECT COUNT(*) FROM chat_poll_votes v WHERE v.option_id=o.id) AS votes,
        EXISTS(SELECT 1 FROM chat_poll_votes v WHERE v.option_id=o.id AND v.user_id=?) AS voted_by_me
      FROM chat_poll_options o WHERE o.message_id=? ORDER BY o.option_index`).all(viewerId, messageId);
    return { question: poll.question, multiple: Boolean(poll.multiple), anonymous: Boolean(poll.anonymous), closesAt: poll.closes_at, closedAt: poll.closed_at, options: options.map((o) => ({ id:Number(o.id), index:Number(o.option_index), text:o.body, votes:Number(o.votes||0), votedByMe:Boolean(o.voted_by_me) })) };
  }

  function receiptSummary(roomId, messageId, senderId) {
    const memberIds = getRoom(roomId)?.kind === "GENERAL"
      ? db.prepare("SELECT user_id FROM driver_profiles WHERE user_id != ?").all(senderId).map((r)=>Number(r.user_id))
      : db.prepare("SELECT user_id FROM chat_room_members WHERE room_id=? AND user_id!=?").all(roomId,senderId).map((r)=>Number(r.user_id));
    if (!memberIds.length) return { delivered: 0, read: 0, total: 0 };
    const placeholders = memberIds.map(()=>"?").join(",");
    const rows = db.prepare(`SELECT last_delivered_message_id,last_read_message_id FROM chat_room_member_state WHERE room_id=? AND user_id IN (${placeholders})`).all(roomId,...memberIds);
    return { delivered: rows.filter((r)=>Number(r.last_delivered_message_id)>=messageId).length, read: rows.filter((r)=>Number(r.last_read_message_id)>=messageId).length, total: memberIds.length };
  }

  function previewForMessage(messageId) {
    if (!messageId) return null;
    const row = db.prepare(`SELECT m.id,m.body,p.nickname,mm.deleted_at FROM chat_messages m JOIN driver_profiles p ON p.user_id=m.sender_id LEFT JOIN chat_message_meta mm ON mm.message_id=m.id WHERE m.id=?`).get(messageId);
    return row ? { id:Number(row.id), sender:row.nickname, text:row.deleted_at ? "Сообщение удалено" : row.body, deleted:Boolean(row.deleted_at) } : null;
  }

  function hydrateRows(rows, viewerId) {
    const attachments = attachmentsForMessages(rows.map((row)=>Number(row.id)));
    return rows.map((row) => {
      const deleted = Boolean(row.deleted_at);
      const item = {
        id:Number(row.id), roomId:Number(row.room_id), sender:{ nickname:row.nickname, driverType:row.driver_type },
        text:deleted ? "" : row.body, createdAt:row.created_at, editedAt:row.edited_at || null, deletedAt:row.deleted_at || null, expiresAt:row.expires_at || null,
        replyTo:previewForMessage(row.reply_to_message_id), forwardedFrom:previewForMessage(row.forwarded_from_message_id),
        attachments:deleted ? [] : (attachments.get(Number(row.id)) || []), poll:deleted ? null : pollForMessage(Number(row.id), viewerId)
      };
      item.kind = item.poll ? "POLL" : item.attachments.length ? (item.text ? "MEDIA" : item.attachments[0].kind) : "TEXT";
      item.receipts = Number(row.sender_id) === Number(viewerId) ? receiptSummary(Number(row.room_id), Number(row.id), Number(row.sender_id)) : null;
      return item;
    });
  }

  function listMessages(userId, roomId, { after = null, before = null, limit = 50 } = {}, now = new Date().toISOString()) {
    cleanupExpiredMessages(now);
    const { rows, overflow } = baseMessageRows(userId, roomId, { after, before, limit });
    const messages = hydrateRows(rows, userId);
    return { messages, nextCursor:messages.length?messages[messages.length-1].id:after, previousCursor:messages.length?messages[0].id:before, hasMore:after!==null?overflow:false, hasOlder:after===null?overflow:false };
  }

  function validateMessageReference(roomId, messageId) {
    if (messageId === null || messageId === undefined) return null;
    const id = Number(messageId);
    return Number.isSafeInteger(id) && db.prepare("SELECT 1 FROM chat_messages WHERE id=? AND room_id=?").get(id,roomId) ? id : null;
  }

  function mentionsForText(roomId, senderId, text) {
    const found = new Map();
    const room = getRoom(roomId);
    const matches = String(text || "").match(/@[\p{L}\p{N}_-]{2,32}/gu) || [];
    const keys = new Set(matches.map((x)=>normalizeNickname(x.slice(1))));
    if (String(text || "").toLowerCase().includes("@all") && room?.kind === "GROUP") {
      const memberCount = roomMemberCount(room);
      const role = groupRole(senderId, roomId);
      if (memberCount <= 32 || ["OWNER","ADMIN","MODERATOR"].includes(role)) {
        for (const row of db.prepare("SELECT user_id FROM chat_room_members WHERE room_id=? AND user_id!=?").all(roomId,senderId)) found.set(Number(row.user_id),"ALL");
      }
    }
    if (keys.size) {
      for (const row of db.prepare(`SELECT m.user_id,p.nickname_key FROM chat_room_members m JOIN driver_profiles p ON p.user_id=m.user_id WHERE m.room_id=?`).all(roomId)) {
        if (keys.has(row.nickname_key) && Number(row.user_id)!==Number(senderId)) found.set(Number(row.user_id),"DIRECT");
      }
    }
    return found;
  }

  function replaceMentions(messageId, roomId, senderId, text) {
    db.prepare("DELETE FROM chat_message_mentions WHERE message_id=?").run(messageId);
    const insert = db.prepare("INSERT OR IGNORE INTO chat_message_mentions(message_id,user_id,kind) VALUES(?,?,?)");
    for (const [userId,kind] of mentionsForText(roomId,senderId,text)) insert.run(messageId,userId,kind);
  }

  function insertMessage({ roomId, senderId, clientMessageId, text = "", replyToMessageId = null, forwardFromMessageId = null, uploadIds = [], expiresInSeconds = 0, createdAt }) {
    const uploads = Array.from(new Set((uploadIds||[]).map(String).filter(Boolean)));
    if (uploads.length > MAX_ATTACHMENTS) { const error=new Error("chat_attachment_limit"); error.status=400; throw error; }
    const retention = Number(expiresInSeconds || 0);
    if (!MESSAGE_RETENTION_OPTIONS.has(retention)) { const error=new Error("invalid_chat_retention"); error.status=400; throw error; }
    const replyId = validateMessageReference(roomId, replyToMessageId);
    if (replyToMessageId!==null && replyToMessageId!==undefined && replyId===null) { const error=new Error("chat_reply_not_found"); error.status=404; throw error; }
    const forwardId = validateMessageReference(roomId, forwardFromMessageId);
    let body = String(text || "");
    let forwardSource = null;
    if (forwardFromMessageId!==null && forwardFromMessageId!==undefined) {
      if (forwardId===null) { const error=new Error("chat_forward_not_found"); error.status=404; throw error; }
      forwardSource = db.prepare(`SELECT m.body,mm.deleted_at FROM chat_messages m LEFT JOIN chat_message_meta mm ON mm.message_id=m.id WHERE m.id=?`).get(forwardId);
      if (!forwardSource || forwardSource.deleted_at) { const error=new Error("chat_forward_not_found"); error.status=404; throw error; }
      body = forwardSource.body;
    }
    const readyUploads = uploads.map((id)=>db.prepare("SELECT * FROM chat_uploads WHERE id=? AND room_id=? AND user_id=? AND state='READY' AND expires_at>?").get(id,roomId,senderId,createdAt));
    if (readyUploads.some((row)=>!row)) { const error=new Error("chat_upload_not_ready"); error.status=409; throw error; }
    const forwardAttachments = forwardId ? db.prepare("SELECT * FROM chat_message_attachments WHERE message_id=? ORDER BY id").all(forwardId) : [];
    if (!body && !readyUploads.length && !forwardAttachments.length) { const error=new Error("invalid_chat_message"); error.status=400; throw error; }
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = db.prepare("SELECT id,room_id,body FROM chat_messages WHERE sender_id=? AND client_message_id=?").get(senderId,clientMessageId);
      if (existing) {
        if (Number(existing.room_id)!==Number(roomId)) { const error=new Error("client_message_id_conflict"); error.status=409; throw error; }
        const row = baseMessageRows(senderId,roomId,{after:Number(existing.id)-1,limit:1}).rows.find((x)=>Number(x.id)===Number(existing.id));
        db.exec("COMMIT");
        return { message:hydrateRows(row?[row]:[],senderId)[0]||null, duplicate:true };
      }
      const result = db.prepare("INSERT INTO chat_messages(room_id,sender_id,client_message_id,body,created_at) VALUES(?,?,?,?,?)").run(roomId,senderId,clientMessageId,body,createdAt);
      const messageId = Number(result.lastInsertRowid);
      const expiresAt = retention ? addSeconds(createdAt,retention) : null;
      if (replyId||forwardId||expiresAt) db.prepare("INSERT INTO chat_message_meta(message_id,reply_to_message_id,forwarded_from_message_id,expires_at) VALUES(?,?,?,?)").run(messageId,replyId,forwardId,expiresAt);
      const addAttachment = db.prepare("INSERT INTO chat_message_attachments(message_id,kind,file_name,mime_type,byte_length,storage_key,duration_ms,created_at) VALUES(?,?,?,?,?,?,?,?)");
      for (const upload of readyUploads) {
        addAttachment.run(messageId,upload.kind,upload.file_name,upload.mime_type,upload.byte_length,upload.storage_key,upload.duration_ms,createdAt);
        db.prepare("UPDATE chat_uploads SET state='ATTACHED' WHERE id=?").run(upload.id);
      }
      for (const attachment of forwardAttachments) addAttachment.run(messageId,attachment.kind,attachment.file_name,attachment.mime_type,attachment.byte_length,attachment.storage_key,attachment.duration_ms,createdAt);
      replaceMentions(messageId,roomId,senderId,body);
      db.prepare("DELETE FROM chat_drafts WHERE room_id=? AND user_id=?").run(roomId,senderId);
      db.exec("COMMIT");
      const row = baseMessageRows(senderId,roomId,{after:messageId-1,limit:1}).rows.find((x)=>Number(x.id)===messageId);
      return { message:hydrateRows(row?[row]:[],senderId)[0]||null, duplicate:false };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function insertPoll({ roomId, senderId, clientMessageId, question, options, multiple=false, anonymous=false, closesAt=null, createdAt }) {
    const q = normalizePollText(question,300);
    const list = Array.isArray(options)?options.map((x)=>normalizePollText(x,100)):[];
    if (!q || list.length<2 || list.length>MAX_POLL_OPTIONS || list.some((x)=>!x) || new Set(list.map((x)=>x.toLocaleLowerCase())).size!==list.length) return { error:"invalid_chat_poll",status:400 };
    if (closesAt && (!Number.isFinite(Date.parse(closesAt)) || Date.parse(closesAt)<=Date.parse(createdAt))) return { error:"invalid_chat_poll",status:400 };
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing=db.prepare("SELECT id FROM chat_messages WHERE sender_id=? AND client_message_id=?").get(senderId,clientMessageId);
      if (existing) { db.exec("COMMIT"); const row=baseMessageRows(senderId,roomId,{after:Number(existing.id)-1,limit:1}).rows.find((x)=>Number(x.id)===Number(existing.id)); return {message:hydrateRows(row?[row]:[],senderId)[0]||null,duplicate:true}; }
      const result=db.prepare("INSERT INTO chat_messages(room_id,sender_id,client_message_id,body,created_at) VALUES(?,?,?,?,?)").run(roomId,senderId,clientMessageId,"",createdAt);
      const messageId=Number(result.lastInsertRowid);
      db.prepare("INSERT INTO chat_polls(message_id,question,multiple,anonymous,closes_at) VALUES(?,?,?,?,?)").run(messageId,q,multiple?1:0,anonymous?1:0,closesAt||null);
      const add=db.prepare("INSERT INTO chat_poll_options(message_id,option_index,body) VALUES(?,?,?)"); list.forEach((text,index)=>add.run(messageId,index,text));
      db.exec("COMMIT");
      const row=baseMessageRows(senderId,roomId,{after:messageId-1,limit:1}).rows.find((x)=>Number(x.id)===messageId);
      return {message:hydrateRows(row?[row]:[],senderId)[0]||null,duplicate:false};
    } catch(error){db.exec("ROLLBACK");throw error;}
  }

  function editMessage(userId,messageId,text,now) {
    const row=db.prepare(`SELECT m.id,m.room_id,m.sender_id,m.created_at,mm.deleted_at FROM chat_messages m LEFT JOIN chat_message_meta mm ON mm.message_id=m.id WHERE m.id=?`).get(messageId);
    if(!row||Number(row.sender_id)!==Number(userId)||row.deleted_at)return {error:"chat_message_not_found",status:404};
    if(Date.parse(now)-Date.parse(row.created_at)>EDIT_WINDOW_MS)return {error:"chat_edit_window_expired",status:409};
    if(db.prepare("SELECT 1 FROM chat_polls WHERE message_id=?").get(messageId))return {error:"chat_poll_edit_forbidden",status:409};
    db.prepare("UPDATE chat_messages SET body=? WHERE id=?").run(text,messageId);
    db.prepare(`INSERT INTO chat_message_meta(message_id,edited_at) VALUES(?,?) ON CONFLICT(message_id) DO UPDATE SET edited_at=excluded.edited_at`).run(messageId,now);
    replaceMentions(messageId,Number(row.room_id),userId,text);
    const hydrated=baseMessageRows(userId,Number(row.room_id),{after:messageId-1,limit:1}).rows.find((x)=>Number(x.id)===Number(messageId));
    return {message:hydrateRows(hydrated?[hydrated]:[],userId)[0]||null};
  }

  function deleteMessage(userId,messageId,{scope="everyone"}={},now) {
    const row=db.prepare("SELECT id,room_id,sender_id FROM chat_messages WHERE id=?").get(messageId);
    if(!row)return {error:"chat_message_not_found",status:404};
    const room=getRoom(Number(row.room_id));
    if(roomAccessError(userId,room))return {error:"chat_message_not_found",status:404};
    if(scope==="me") { db.prepare("INSERT OR REPLACE INTO chat_hidden_messages(user_id,message_id,hidden_at) VALUES(?,?,?)").run(userId,messageId,now); return {hidden:true,id:Number(row.id),roomId:Number(row.room_id)}; }
    const allowed=Number(row.sender_id)===Number(userId)||(room.kind==="GROUP"&&canModerate(userId,room.id));
    if(!allowed)return {error:"chat_delete_forbidden",status:403};
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE chat_messages SET body='' WHERE id=?").run(messageId);
      db.prepare(`INSERT INTO chat_message_meta(message_id,deleted_at) VALUES(?,?) ON CONFLICT(message_id) DO UPDATE SET deleted_at=COALESCE(chat_message_meta.deleted_at,excluded.deleted_at)`).run(messageId,now);
      db.prepare("DELETE FROM chat_message_reactions_v2 WHERE message_id=?").run(messageId);
      db.prepare("DELETE FROM chat_message_mentions WHERE message_id=?").run(messageId);
      db.exec("COMMIT");
      return {deleted:true,id:Number(row.id),roomId:Number(row.room_id)};
    } catch(error){db.exec("ROLLBACK");throw error;}
  }

  function markDelivered(userId,roomId,messageId,now) {
    const room=getRoom(roomId); if(roomAccessError(userId,room))return {error:"chat_room_not_found",status:404};
    const max=Number(db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM chat_messages WHERE room_id=?").get(roomId).id||0);
    const cursor=Math.min(Math.max(0,Number(messageId)||0),max); const state=ensureMemberState(roomId,userId,now);
    const next=Math.max(Number(state.last_delivered_message_id||0),cursor);
    db.prepare("UPDATE chat_room_member_state SET last_delivered_message_id=?,updated_at=? WHERE room_id=? AND user_id=?").run(next,now,roomId,userId);
    return {deliveredMessageId:next};
  }

  function markRead(userId,roomId,messageId,now) {
    const delivered=markDelivered(userId,roomId,messageId,now); if(delivered.error)return delivered;
    const state=ensureMemberState(roomId,userId,now); const next=Math.max(Number(state.last_read_message_id||0),Number(delivered.deliveredMessageId||0));
    db.prepare("UPDATE chat_room_member_state SET last_read_message_id=?,last_delivered_message_id=MAX(last_delivered_message_id,?),updated_at=? WHERE room_id=? AND user_id=?").run(next,next,now,roomId,userId);
    return {readMessageId:next,deliveredMessageId:Math.max(next,Number(state.last_delivered_message_id||0))};
  }

  function searchMessages(userId,{query,roomId=null,limit=50}={},now=new Date().toISOString()) {
    const q=String(query||"").normalize("NFKC").trim().slice(0,100); if(q.length<2)return [];
    const accessible=listRooms(userId,now).map((r)=>r.id); if(roomId!==null){const id=Number(roomId);if(!accessible.includes(id))return [];accessible.splice(0,accessible.length,id);}
    if(!accessible.length)return [];
    const placeholders=accessible.map(()=>"?").join(","); const like=`%${q.replaceAll("\\","\\\\").replaceAll("%","\\%").replaceAll("_","\\_")}%`;
    const rows=db.prepare(`SELECT DISTINCT m.id,m.room_id,m.sender_id,m.body,m.created_at,p.nickname,p.driver_type,mm.reply_to_message_id,mm.forwarded_from_message_id,mm.edited_at,mm.deleted_at,mm.expires_at
      FROM chat_messages m JOIN driver_profiles p ON p.user_id=m.sender_id LEFT JOIN chat_message_meta mm ON mm.message_id=m.id LEFT JOIN chat_message_attachments a ON a.message_id=m.id
      WHERE m.room_id IN (${placeholders}) AND mm.deleted_at IS NULL AND (m.body LIKE ? ESCAPE '\\' OR a.file_name LIKE ? ESCAPE '\\')
        AND NOT EXISTS(SELECT 1 FROM chat_hidden_messages h WHERE h.message_id=m.id AND h.user_id=?)
      ORDER BY m.id DESC LIMIT ?`).all(...accessible,like,like,userId,Math.min(100,Math.max(1,Number(limit)||50)));
    return hydrateRows(rows.reverse(),userId);
  }

  function listPins(userId,roomId) {
    const room=getRoom(roomId);if(roomAccessError(userId,room))return {error:"chat_room_not_found",status:404};
    const ids=db.prepare("SELECT message_id FROM chat_room_pins WHERE room_id=? ORDER BY created_at DESC LIMIT ?").all(roomId,MAX_PINS).map((r)=>Number(r.message_id));
    if(!ids.length)return {pins:[]};
    const placeholders=ids.map(()=>"?").join(","); const rows=db.prepare(`SELECT m.id,m.room_id,m.sender_id,m.body,m.created_at,p.nickname,p.driver_type,mm.reply_to_message_id,mm.forwarded_from_message_id,mm.edited_at,mm.deleted_at,mm.expires_at FROM chat_messages m JOIN driver_profiles p ON p.user_id=m.sender_id LEFT JOIN chat_message_meta mm ON mm.message_id=m.id WHERE m.id IN (${placeholders})`).all(...ids);
    const byId=new Map(hydrateRows(rows,userId).map((m)=>[m.id,m]));return {pins:ids.map((id)=>byId.get(id)).filter(Boolean)};
  }

  function pinMessage(userId,roomId,messageId,now) {
    const room=getRoom(roomId);if(roomAccessError(userId,room))return {error:"chat_room_not_found",status:404};
    let allowed=false;
    if(room.kind==="GROUP")allowed=canModerate(userId,roomId); else if(room.kind==="DIRECT")allowed=true; else allowed=["Owner","Administrator"].includes(db.prepare("SELECT role FROM users WHERE id=?").get(userId)?.role);
    if(!allowed)return {error:"chat_pin_forbidden",status:403};
    if(!db.prepare("SELECT 1 FROM chat_messages WHERE id=? AND room_id=?").get(messageId,roomId))return {error:"chat_message_not_found",status:404};
    const count=Number(db.prepare("SELECT COUNT(*) AS n FROM chat_room_pins WHERE room_id=?").get(roomId).n||0);
    if(count>=MAX_PINS&&!db.prepare("SELECT 1 FROM chat_room_pins WHERE room_id=? AND message_id=?").get(roomId,messageId))return {error:"chat_pin_limit",status:409};
    db.prepare("INSERT OR IGNORE INTO chat_room_pins(room_id,message_id,pinned_by,created_at) VALUES(?,?,?,?)").run(roomId,messageId,userId,now);return {pinned:true};
  }

  function unpinMessage(userId,roomId,messageId) {
    const room=getRoom(roomId);if(roomAccessError(userId,room))return {error:"chat_room_not_found",status:404};
    let allowed=room.kind==="GROUP"?canModerate(userId,roomId):room.kind==="DIRECT"||["Owner","Administrator"].includes(db.prepare("SELECT role FROM users WHERE id=?").get(userId)?.role);
    if(!allowed)return {error:"chat_pin_forbidden",status:403};
    return {unpinned:db.prepare("DELETE FROM chat_room_pins WHERE room_id=? AND message_id=?").run(roomId,messageId).changes===1};
  }

  function votePoll(userId,messageId,optionIds,now) {
    const poll=db.prepare("SELECT p.*,m.room_id FROM chat_polls p JOIN chat_messages m ON m.id=p.message_id WHERE p.message_id=?").get(messageId);
    if(!poll)return {error:"chat_poll_not_found",status:404};
    if(roomAccessError(userId,getRoom(Number(poll.room_id))))return {error:"chat_poll_not_found",status:404};
    if(poll.closed_at||(poll.closes_at&&poll.closes_at<=now))return {error:"chat_poll_closed",status:409};
    const ids=Array.from(new Set((Array.isArray(optionIds)?optionIds:[optionIds]).map(Number).filter(Number.isSafeInteger)));
    if(!ids.length||(!poll.multiple&&ids.length!==1))return {error:"invalid_chat_poll_vote",status:400};
    const valid=new Set(db.prepare("SELECT id FROM chat_poll_options WHERE message_id=?").all(messageId).map((r)=>Number(r.id)));if(ids.some((id)=>!valid.has(id)))return {error:"invalid_chat_poll_vote",status:400};
    db.exec("BEGIN IMMEDIATE");try{db.prepare("DELETE FROM chat_poll_votes WHERE message_id=? AND user_id=?").run(messageId,userId);const add=db.prepare("INSERT INTO chat_poll_votes(message_id,option_id,user_id,created_at) VALUES(?,?,?,?)");ids.forEach((id)=>add.run(messageId,id,userId,now));db.exec("COMMIT");return {messageId:Number(messageId),poll:pollForMessage(Number(messageId),userId)};}catch(error){db.exec("ROLLBACK");throw error;}
  }

  function closePoll(userId,messageId,now) {
    const poll=db.prepare("SELECT p.*,m.room_id,m.sender_id FROM chat_polls p JOIN chat_messages m ON m.id=p.message_id WHERE p.message_id=?").get(messageId);if(!poll)return {error:"chat_poll_not_found",status:404};
    const room=getRoom(Number(poll.room_id));if(roomAccessError(userId,room))return {error:"chat_poll_not_found",status:404};
    if(Number(poll.sender_id)!==Number(userId)&&!(room.kind==="GROUP"&&canModerate(userId,room.id)))return {error:"chat_poll_close_forbidden",status:403};
    db.prepare("UPDATE chat_polls SET closed_at=COALESCE(closed_at,?) WHERE message_id=?").run(now,messageId);return {messageId:Number(messageId),poll:pollForMessage(Number(messageId),userId)};
  }

  function createUpload({id,roomId,userId,tokenHash,kind,fileName,mimeType,byteLength,storageKey,durationMs,createdAt,expiresAt}) {
    db.prepare(`INSERT INTO chat_uploads(id,room_id,user_id,upload_token_hash,kind,file_name,mime_type,byte_length,storage_key,duration_ms,state,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,'PENDING',?,?)`).run(id,roomId,userId,tokenHash,kind,fileName,mimeType,byteLength,storageKey,durationMs??null,createdAt,expiresAt);
    return {id,kind,fileName,mimeType,byteLength,durationMs:durationMs??null,expiresAt};
  }

  function uploadTarget(userId,uploadId,tokenHash,now) {
    return db.prepare("SELECT * FROM chat_uploads WHERE id=? AND user_id=? AND upload_token_hash=? AND state='PENDING' AND expires_at>?").get(uploadId,userId,tokenHash,now)||null;
  }
  function markUploadReady(uploadId){return db.prepare("UPDATE chat_uploads SET state='READY' WHERE id=? AND state='PENDING'").run(uploadId).changes===1;}
  function deleteUpload(userId,uploadId){const row=db.prepare("SELECT storage_key FROM chat_uploads WHERE id=? AND user_id=? AND state!='ATTACHED'").get(uploadId,userId);if(!row)return null;db.prepare("DELETE FROM chat_uploads WHERE id=? AND user_id=? AND state!='ATTACHED'").run(uploadId,userId);return row.storage_key;}
  function expiredUploads(now){const rows=db.prepare("SELECT id,storage_key FROM chat_uploads WHERE state!='ATTACHED' AND expires_at<=?").all(now);if(rows.length){const ids=rows.map(()=>"?").join(",");db.prepare(`DELETE FROM chat_uploads WHERE id IN (${ids})`).run(...rows.map((r)=>r.id));}return rows;}

  function attachmentForUser(userId,attachmentId,now) {
    const row=db.prepare(`SELECT a.*,m.room_id,mm.deleted_at,mm.expires_at FROM chat_message_attachments a JOIN chat_messages m ON m.id=a.message_id LEFT JOIN chat_message_meta mm ON mm.message_id=m.id WHERE a.id=?`).get(attachmentId);
    if(!row||row.deleted_at||(row.expires_at&&row.expires_at<=now)||roomAccessError(userId,getRoom(Number(row.room_id))))return null;return row;
  }

  return {
    hasProfile,getNickname,getRoom,roomAccessError,listRooms,roomForUser,createDirectRoom,countryChatForUser,joinCountryChat,
    createGroupRoom,discoverGroups,joinPublicGroup,inviteToGroup,listInvites,respondToInvite,updateGroup,listMembers,setMemberRole,removeMember,unbanMember,leaveGroup,deleteGroup,
    updateRoomPreferences,saveDraft,listMessages,insertMessage,insertPoll,editMessage,deleteMessage,markDelivered,markRead,searchMessages,listPins,pinMessage,unpinMessage,votePoll,closePoll,
    createUpload,uploadTarget,markUploadReady,deleteUpload,expiredUploads,attachmentForUser,
    constants:{EDIT_WINDOW_MS,MAX_PINS,MAX_ATTACHMENTS,MAX_POLL_OPTIONS,MESSAGE_RETENTION_OPTIONS}
  };
}

module.exports = { createChatRepository, GROUP_ROLES, EDIT_WINDOW_MS, MAX_PINS, MAX_ATTACHMENTS, MAX_POLL_OPTIONS, MESSAGE_RETENTION_OPTIONS };
