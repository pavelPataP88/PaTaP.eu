const crypto = require("crypto");
const { ensureRadioSchema, GENERAL_CHANNEL_KEY } = require("./schema");

const LEASE_SECONDS = 75;
const TRANSMISSION_RETENTION_DAYS = 30;
const ALERT_SECONDS = 5 * 60;
const MAX_PINS = 3;
const CHANNEL_ROLES = new Set(["OWNER", "MODERATOR", "TRUSTED", "MEMBER", "LISTENER"]);
const TALK_POLICIES = new Set(["EVERYONE", "TRUSTED", "BROADCAST"]);
const VISIBILITIES = new Set(["PUBLIC", "PRIVATE"]);
const RADIO_STATUSES = new Set(["AVAILABLE", "BUSY", "SOLO"]);
const PLAYBACK_RATES = new Set([1, 1.25, 1.5]);

function addSeconds(now, seconds) {
  return new Date(new Date(now).getTime() + seconds * 1000).toISOString();
}

function addDays(now, days) {
  return new Date(new Date(now).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeNickname(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("und");
}

function normalizeChannelTitle(value) {
  const title = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (title.length < 3 || title.length > 48 || /[\u0000-\u001f\u007f]/.test(title)) return null;
  return title;
}

function normalizeDescription(value) {
  const description = String(value || "").normalize("NFKC").trim();
  if (description.length > 240 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)) return null;
  return description;
}

function publicTransmission(row) {
  return {
    id: Number(row.id),
    channelId: Number(row.channel_id),
    sender: { nickname: row.nickname, driverType: row.driver_type },
    mimeType: row.mime_type,
    byteLength: Number(row.byte_length),
    createdAt: row.created_at,
    committedAt: row.committed_at
  };
}

function createRadioRepository(db, { hashToken, randomToken, nowIso = () => new Date().toISOString() }) {
  const schema = ensureRadioSchema(db, nowIso());

  function hasProfile(userId) {
    return Boolean(db.prepare("SELECT 1 FROM driver_profiles WHERE user_id = ?").get(userId));
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

  function profileRow(channelId) {
    return db.prepare("SELECT * FROM radio_channel_profiles WHERE channel_id = ?").get(channelId) || null;
  }

  function isMember(channelId, userId) {
    return Boolean(db.prepare("SELECT 1 FROM radio_channel_members WHERE channel_id = ? AND user_id = ?").get(channelId, userId));
  }

  function ensureMemberState(channelId, userId, role = "MEMBER") {
    if (!isMember(channelId, userId)) return null;
    db.prepare(`INSERT OR IGNORE INTO radio_channel_member_state(channel_id, user_id, role)
      VALUES(?, ?, ?)`)
      .run(channelId, userId, role);
    return db.prepare("SELECT * FROM radio_channel_member_state WHERE channel_id = ? AND user_id = ?")
      .get(channelId, userId) || null;
  }

  function ensureSettings(userId, now = nowIso()) {
    db.prepare(`INSERT OR IGNORE INTO radio_user_settings(user_id, status, auto_play, playback_rate, updated_at)
      VALUES(?, 'AVAILABLE', 0, 1.0, ?)`)
      .run(userId, now);
    return db.prepare("SELECT * FROM radio_user_settings WHERE user_id = ?").get(userId);
  }

  function ensureGeneralMembership(userId, now = nowIso()) {
    if (!hasProfile(userId)) return false;
    const channelId = schema.generalChannelId;
    db.prepare(`INSERT OR IGNORE INTO radio_channel_members(channel_id, user_id, joined_at) VALUES(?, ?, ?)`)
      .run(channelId, userId, now);
    ensureMemberState(channelId, userId, "MEMBER");
    ensureSettings(userId, now);
    return true;
  }

  function directPeer(userId, channelId) {
    return db.prepare(`SELECT m.user_id, p.nickname, p.driver_type
      FROM radio_channel_members m
      JOIN driver_profiles p ON p.user_id = m.user_id
      WHERE m.channel_id = ? AND m.user_id != ? LIMIT 1`)
      .get(channelId, userId) || null;
  }

  function channelAccessError(userId, channelId) {
    if (!hasProfile(userId)) return "driver_profile_required";
    if (!isMember(channelId, userId)) return "radio_channel_not_found";
    const profile = profileRow(channelId);
    if (!profile) {
      const peer = directPeer(userId, channelId);
      if (peer && areBlocked(userId, Number(peer.user_id))) return "driver_blocked";
    }
    return null;
  }

  function roleFor(userId, channelId) {
    if (!isMember(channelId, userId)) return null;
    return ensureMemberState(channelId, userId)?.role || null;
  }

  function canModerate(userId, channelId) {
    return ["OWNER", "MODERATOR"].includes(roleFor(userId, channelId));
  }

  function talkPermission(userId, channelId) {
    const access = channelAccessError(userId, channelId);
    if (access) return { allowed: false, error: access };
    const profile = profileRow(channelId);
    if (!profile) return { allowed: true };
    const state = ensureMemberState(channelId, userId);
    if (!state || state.role === "LISTENER") return { allowed: false, error: "radio_talk_not_allowed" };
    if (profile.talk_policy === "EVERYONE") return { allowed: true };
    if (profile.talk_policy === "TRUSTED") {
      return ["OWNER", "MODERATOR", "TRUSTED"].includes(state.role)
        ? { allowed: true }
        : { allowed: false, error: "radio_talk_not_allowed" };
    }
    return ["OWNER", "MODERATOR"].includes(state.role)
      ? { allowed: true }
      : { allowed: false, error: "radio_talk_not_allowed" };
  }

  function channelRowForUser(userId, channelId, now) {
    const access = channelAccessError(userId, channelId);
    if (access) return null;
    const profile = profileRow(channelId);
    const state = ensureMemberState(channelId, userId);
    const settings = ensureSettings(userId, now);
    const peer = profile ? null : directPeer(userId, channelId);
    const base = db.prepare("SELECT c.kind, c.created_at, c.channel_key FROM radio_channels c WHERE c.id = ?").get(channelId);
    if (!base) return null;
    const stats = db.prepare(`SELECT
        MAX(CASE WHEN state = 'COMMITTED' THEN id END) AS last_transmission_id,
        MAX(CASE WHEN state = 'COMMITTED' THEN committed_at END) AS last_activity_at,
        SUM(CASE WHEN state = 'COMMITTED' THEN 1 ELSE 0 END) AS transmission_count
      FROM radio_transmissions WHERE channel_id = ?`).get(channelId);
    const lease = db.prepare(`SELECT l.speaker_id, p.nickname, l.expires_at
      FROM radio_speaker_leases l
      JOIN driver_profiles p ON p.user_id = l.speaker_id
      WHERE l.channel_id = ? AND l.expires_at > ?`).get(channelId, now);
    const memberCount = db.prepare("SELECT COUNT(*) AS n FROM radio_channel_members WHERE channel_id = ?").get(channelId).n;
    const lastTransmissionId = stats.last_transmission_id === null ? null : Number(stats.last_transmission_id);
    const unreadCount = lastTransmissionId === null ? 0 : db.prepare(`SELECT COUNT(*) AS n FROM radio_transmissions
      WHERE channel_id = ? AND state = 'COMMITTED' AND id > ?`)
      .get(channelId, Number(state?.last_read_transmission_id || 0)).n;
    const effectiveKind = profile?.space_kind || "DIRECT";
    const permission = talkPermission(userId, channelId);
    return {
      id: Number(channelId),
      key: base.channel_key,
      kind: effectiveKind,
      title: profile?.title || peer?.nickname || "Прямая рация",
      description: profile?.description || "",
      visibility: profile?.visibility || "PRIVATE",
      talkPolicy: profile?.talk_policy || "EVERYONE",
      peer: peer ? { nickname: peer.nickname, driverType: peer.driver_type } : null,
      role: state?.role || "MEMBER",
      muted: Boolean(state?.muted),
      favorite: Boolean(state?.favorite),
      isDefault: Number(settings.default_channel_id) === Number(channelId),
      isSolo: settings.status === "SOLO" && Number(settings.solo_channel_id) === Number(channelId),
      canTalk: permission.allowed,
      canManage: effectiveKind === "GROUP" && state?.role === "OWNER",
      canModerate: effectiveKind === "GROUP" && ["OWNER", "MODERATOR"].includes(state?.role),
      speaker: lease ? { nickname: lease.nickname, isSelf: Number(lease.speaker_id) === Number(userId), expiresAt: lease.expires_at } : null,
      lastTransmissionId,
      transmissionCount: Number(stats.transmission_count || 0),
      unreadCount: Number(unreadCount || 0),
      lastActivityAt: stats.last_activity_at || null,
      memberCount: Number(memberCount || 0),
      createdAt: profile?.created_at || base.created_at
    };
  }

  function publicSettings(row) {
    return {
      status: row.status,
      soloChannelId: row.solo_channel_id === null ? null : Number(row.solo_channel_id),
      defaultChannelId: row.default_channel_id === null ? null : Number(row.default_channel_id),
      autoPlay: Boolean(row.auto_play),
      playbackRate: Number(row.playback_rate)
    };
  }

  function listChannels(userId, now = nowIso()) {
    ensureGeneralMembership(userId, now);
    const settings = ensureSettings(userId, now);
    db.prepare("DELETE FROM radio_speaker_leases WHERE expires_at <= ?").run(now);
    const rows = db.prepare("SELECT channel_id FROM radio_channel_members WHERE user_id = ?").all(userId);
    const channels = rows.map((row) => channelRowForUser(userId, Number(row.channel_id), now)).filter(Boolean);
    channels.sort((a, b) => {
      if (a.id === Number(settings.default_channel_id)) return -1;
      if (b.id === Number(settings.default_channel_id)) return 1;
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      const at = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
      const bt = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
      return bt - at || b.id - a.id;
    });
    return channels;
  }

  function listInvites(userId) {
    return db.prepare(`SELECT i.channel_id, i.created_at, cp.title, cp.description, cp.visibility, cp.talk_policy,
        inviter.nickname AS inviter_nickname,
        (SELECT COUNT(*) FROM radio_channel_members m WHERE m.channel_id = i.channel_id) AS member_count
      FROM radio_channel_invites i
      JOIN radio_channel_profiles cp ON cp.channel_id = i.channel_id
      LEFT JOIN driver_profiles inviter ON inviter.user_id = i.invited_by
      WHERE i.target_user_id = ? ORDER BY i.created_at DESC`).all(userId)
      .map((row) => ({
        channelId: Number(row.channel_id), title: row.title, description: row.description,
        visibility: row.visibility, talkPolicy: row.talk_policy,
        invitedBy: row.inviter_nickname || "Driver", memberCount: Number(row.member_count || 0), createdAt: row.created_at
      }));
  }

  function listActiveAlerts(userId, now = nowIso()) {
    db.prepare("DELETE FROM radio_channel_alerts WHERE expires_at <= ?").run(now);
    return db.prepare(`SELECT a.id, a.channel_id, a.kind, a.created_at, a.expires_at, p.nickname,
        COALESCE(cp.title, peer.nickname, 'Рация') AS channel_title
      FROM radio_channel_alerts a
      JOIN radio_channel_members mine ON mine.channel_id = a.channel_id AND mine.user_id = ?
      JOIN driver_profiles p ON p.user_id = a.sender_id
      LEFT JOIN radio_channel_profiles cp ON cp.channel_id = a.channel_id
      LEFT JOIN radio_channel_members peer_member ON peer_member.channel_id = a.channel_id AND peer_member.user_id != ?
      LEFT JOIN driver_profiles peer ON peer.user_id = peer_member.user_id
      WHERE a.expires_at > ? ORDER BY a.id DESC LIMIT 20`).all(userId, userId, now)
      .map((row) => ({
        id: Number(row.id), channelId: Number(row.channel_id), kind: row.kind,
        sender: { nickname: row.nickname }, channelTitle: row.channel_title,
        createdAt: row.created_at, expiresAt: row.expires_at
      }));
  }

  function overview(userId, now = nowIso()) {
    ensureGeneralMembership(userId, now);
    return { channels: listChannels(userId, now), settings: publicSettings(ensureSettings(userId, now)), invites: listInvites(userId), alerts: listActiveAlerts(userId, now) };
  }

  function createDirectChannel(userId, nickname, now = nowIso()) {
    ensureGeneralMembership(userId, now);
    const target = db.prepare("SELECT user_id FROM driver_profiles WHERE nickname_key = ?").get(normalizeNickname(nickname));
    if (!target) return { error: "driver_not_found", status: 404 };
    const targetId = Number(target.user_id);
    if (targetId === userId) return { error: "radio_self_forbidden", status: 400 };
    if (areBlocked(userId, targetId)) return { error: "driver_blocked", status: 403 };
    if (!areContacts(userId, targetId)) return { error: "radio_contact_required", status: 403 };
    const [firstUserId, secondUserId] = [userId, targetId].sort((a, b) => a - b);
    db.exec("BEGIN IMMEDIATE");
    try {
      let pair = db.prepare("SELECT channel_id FROM radio_direct_pairs WHERE first_user_id = ? AND second_user_id = ?").get(firstUserId, secondUserId);
      let created = false;
      if (!pair) {
        const result = db.prepare("INSERT INTO radio_channels(channel_key, kind, created_at) VALUES(?, 'DIRECT', ?)").run(`direct:${firstUserId}:${secondUserId}`, now);
        const channelId = Number(result.lastInsertRowid);
        const addMember = db.prepare("INSERT INTO radio_channel_members(channel_id, user_id, joined_at) VALUES(?, ?, ?)");
        addMember.run(channelId, firstUserId, now);
        addMember.run(channelId, secondUserId, now);
        ensureMemberState(channelId, firstUserId);
        ensureMemberState(channelId, secondUserId);
        db.prepare("INSERT INTO radio_direct_pairs(first_user_id, second_user_id, channel_id, created_at) VALUES(?, ?, ?, ?)").run(firstUserId, secondUserId, channelId, now);
        pair = { channel_id: channelId };
        created = true;
      } else {
        ensureMemberState(Number(pair.channel_id), firstUserId);
        ensureMemberState(Number(pair.channel_id), secondUserId);
      }
      const channel = channelRowForUser(userId, Number(pair.channel_id), now);
      db.exec("COMMIT");
      return { channel, created };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function createGroupChannel(userId, input, now = nowIso()) {
    if (!hasProfile(userId)) return { error: "driver_profile_required", status: 409 };
    const title = normalizeChannelTitle(input?.title);
    const description = normalizeDescription(input?.description);
    const visibility = String(input?.visibility || "PRIVATE").toUpperCase();
    const talkPolicy = String(input?.talkPolicy || "EVERYONE").toUpperCase();
    if (!title || description === null || !VISIBILITIES.has(visibility) || !TALK_POLICIES.has(talkPolicy)) return { error: "invalid_radio_channel", status: 400 };
    db.exec("BEGIN IMMEDIATE");
    try {
      const key = `group:${crypto.randomUUID()}`;
      const result = db.prepare("INSERT INTO radio_channels(channel_key, kind, created_at) VALUES(?, 'DIRECT', ?)").run(key, now);
      const channelId = Number(result.lastInsertRowid);
      db.prepare(`INSERT INTO radio_channel_profiles(channel_id, space_kind, title, description, visibility, talk_policy, created_by, created_at, updated_at)
        VALUES(?, 'GROUP', ?, ?, ?, ?, ?, ?, ?)`)
        .run(channelId, title, description, visibility, talkPolicy, userId, now, now);
      db.prepare("INSERT INTO radio_channel_members(channel_id, user_id, joined_at) VALUES(?, ?, ?)").run(channelId, userId, now);
      ensureMemberState(channelId, userId, "OWNER");
      db.exec("COMMIT");
      return { channel: channelRowForUser(userId, channelId, now), created: true };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function discoverChannels(userId, query = "") {
    if (!hasProfile(userId)) return [];
    const q = String(query || "").normalize("NFKC").trim().slice(0, 48);
    const like = `%${q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    return db.prepare(`SELECT cp.channel_id, cp.title, cp.description, cp.talk_policy,
        EXISTS(SELECT 1 FROM radio_channel_members m WHERE m.channel_id = cp.channel_id AND m.user_id = ?) AS joined,
        (SELECT COUNT(*) FROM radio_channel_members m WHERE m.channel_id = cp.channel_id) AS member_count
      FROM radio_channel_profiles cp
      WHERE cp.visibility = 'PUBLIC' AND cp.space_kind = 'GROUP'
        AND cp.title LIKE ? ESCAPE '\\'
        AND NOT EXISTS(SELECT 1 FROM radio_channel_bans b WHERE b.channel_id = cp.channel_id AND b.user_id = ?)
      ORDER BY joined DESC, member_count DESC, cp.title COLLATE NOCASE LIMIT 30`).all(userId, like, userId)
      .map((row) => ({ id: Number(row.channel_id), title: row.title, description: row.description, talkPolicy: row.talk_policy, joined: Boolean(row.joined), memberCount: Number(row.member_count || 0) }));
  }

  function joinPublicChannel(userId, channelId, now = nowIso()) {
    const profile = profileRow(channelId);
    if (!profile || profile.space_kind !== "GROUP" || profile.visibility !== "PUBLIC") return { error: "radio_channel_not_found", status: 404 };
    if (db.prepare("SELECT 1 FROM radio_channel_bans WHERE channel_id = ? AND user_id = ?").get(channelId, userId)) return { error: "radio_channel_banned", status: 403 };
    db.prepare("INSERT OR IGNORE INTO radio_channel_members(channel_id, user_id, joined_at) VALUES(?, ?, ?)").run(channelId, userId, now);
    ensureMemberState(channelId, userId, "MEMBER");
    db.prepare("DELETE FROM radio_channel_invites WHERE channel_id = ? AND target_user_id = ?").run(channelId, userId);
    return { channel: channelRowForUser(userId, channelId, now) };
  }

  function inviteToChannel(userId, channelId, nickname, now = nowIso()) {
    const profile = profileRow(channelId);
    if (!profile || profile.space_kind !== "GROUP" || !canModerate(userId, channelId)) return { error: "radio_channel_forbidden", status: 403 };
    const target = db.prepare("SELECT user_id FROM driver_profiles WHERE nickname_key = ?").get(normalizeNickname(nickname));
    if (!target) return { error: "driver_not_found", status: 404 };
    const targetId = Number(target.user_id);
    if (targetId === Number(userId)) return { error: "radio_self_forbidden", status: 400 };
    if (!areContacts(userId, targetId)) return { error: "radio_contact_required", status: 403 };
    if (db.prepare("SELECT 1 FROM radio_channel_bans WHERE channel_id = ? AND user_id = ?").get(channelId, targetId)) return { error: "radio_channel_banned", status: 403 };
    if (isMember(channelId, targetId)) return { error: "radio_already_member", status: 409 };
    db.prepare(`INSERT INTO radio_channel_invites(channel_id, target_user_id, invited_by, created_at)
      VALUES(?, ?, ?, ?) ON CONFLICT(channel_id, target_user_id) DO UPDATE SET invited_by = excluded.invited_by, created_at = excluded.created_at`)
      .run(channelId, targetId, userId, now);
    return { ok: true };
  }

  function respondToInvite(userId, channelId, action, now = nowIso()) {
    const invite = db.prepare("SELECT 1 FROM radio_channel_invites WHERE channel_id = ? AND target_user_id = ?").get(channelId, userId);
    if (!invite) return { error: "radio_invite_not_found", status: 404 };
    const normalized = String(action || "").toUpperCase();
    if (!["ACCEPT", "DECLINE"].includes(normalized)) return { error: "invalid_radio_invite_action", status: 400 };
    if (normalized === "ACCEPT") {
      if (db.prepare("SELECT 1 FROM radio_channel_bans WHERE channel_id = ? AND user_id = ?").get(channelId, userId)) return { error: "radio_channel_banned", status: 403 };
      db.prepare("INSERT OR IGNORE INTO radio_channel_members(channel_id, user_id, joined_at) VALUES(?, ?, ?)").run(channelId, userId, now);
      ensureMemberState(channelId, userId, "MEMBER");
    }
    db.prepare("DELETE FROM radio_channel_invites WHERE channel_id = ? AND target_user_id = ?").run(channelId, userId);
    return { accepted: normalized === "ACCEPT", channel: normalized === "ACCEPT" ? channelRowForUser(userId, channelId, now) : null };
  }

  function updateChannel(userId, channelId, input, now = nowIso()) {
    const profile = profileRow(channelId);
    if (!profile || profile.space_kind !== "GROUP") return { error: "radio_channel_not_found", status: 404 };
    if (roleFor(userId, channelId) !== "OWNER") return { error: "radio_channel_forbidden", status: 403 };
    const title = input?.title === undefined ? profile.title : normalizeChannelTitle(input.title);
    const description = input?.description === undefined ? profile.description : normalizeDescription(input.description);
    const visibility = input?.visibility === undefined ? profile.visibility : String(input.visibility).toUpperCase();
    const talkPolicy = input?.talkPolicy === undefined ? profile.talk_policy : String(input.talkPolicy).toUpperCase();
    if (!title || description === null || !VISIBILITIES.has(visibility) || !TALK_POLICIES.has(talkPolicy)) return { error: "invalid_radio_channel", status: 400 };
    db.prepare("UPDATE radio_channel_profiles SET title = ?, description = ?, visibility = ?, talk_policy = ?, updated_at = ? WHERE channel_id = ?")
      .run(title, description, visibility, talkPolicy, now, channelId);
    return { channel: channelRowForUser(userId, channelId, now) };
  }

  function listMembers(userId, channelId) {
    const access = channelAccessError(userId, channelId);
    if (access) return { error: access, status: access === "driver_blocked" ? 403 : 404 };
    const rows = db.prepare(`SELECT p.nickname, p.driver_type, COALESCE(s.role, 'MEMBER') AS role, m.joined_at
      FROM radio_channel_members m
      JOIN driver_profiles p ON p.user_id = m.user_id
      LEFT JOIN radio_channel_member_state s ON s.channel_id = m.channel_id AND s.user_id = m.user_id
      WHERE m.channel_id = ?
      ORDER BY CASE COALESCE(s.role,'MEMBER') WHEN 'OWNER' THEN 0 WHEN 'MODERATOR' THEN 1 WHEN 'TRUSTED' THEN 2 WHEN 'MEMBER' THEN 3 ELSE 4 END,
        p.nickname COLLATE NOCASE`).all(channelId);
    return { members: rows.map((row) => ({ nickname: row.nickname, driverType: row.driver_type, role: row.role, joinedAt: row.joined_at })) };
  }

  function setMemberRole(userId, channelId, nickname, nextRole) {
    const profile = profileRow(channelId);
    if (!profile || profile.space_kind !== "GROUP") return { error: "radio_channel_not_found", status: 404 };
    if (roleFor(userId, channelId) !== "OWNER") return { error: "radio_channel_forbidden", status: 403 };
    const role = String(nextRole || "").toUpperCase();
    if (!CHANNEL_ROLES.has(role)) return { error: "invalid_radio_role", status: 400 };
    const target = db.prepare(`SELECT m.user_id, COALESCE(s.role,'MEMBER') AS role FROM radio_channel_members m
      JOIN driver_profiles p ON p.user_id = m.user_id
      LEFT JOIN radio_channel_member_state s ON s.channel_id = m.channel_id AND s.user_id = m.user_id
      WHERE m.channel_id = ? AND p.nickname_key = ?`).get(channelId, normalizeNickname(nickname));
    if (!target) return { error: "radio_member_not_found", status: 404 };
    const targetId = Number(target.user_id);
    if (targetId === Number(userId) && role !== "OWNER") return { error: "radio_owner_transfer_required", status: 409 };
    db.exec("BEGIN IMMEDIATE");
    try {
      if (role === "OWNER" && targetId !== Number(userId)) db.prepare("UPDATE radio_channel_member_state SET role = 'MODERATOR' WHERE channel_id = ? AND user_id = ?").run(channelId, userId);
      ensureMemberState(channelId, targetId);
      db.prepare("UPDATE radio_channel_member_state SET role = ? WHERE channel_id = ? AND user_id = ?").run(role, channelId, targetId);
      db.exec("COMMIT");
      return { ok: true, role };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function removeMember(userId, channelId, nickname, { ban = false } = {}, now = nowIso()) {
    const profile = profileRow(channelId);
    const requesterRole = roleFor(userId, channelId);
    if (!profile || profile.space_kind !== "GROUP" || !["OWNER", "MODERATOR"].includes(requesterRole)) return { error: "radio_channel_forbidden", status: 403 };
    const target = db.prepare(`SELECT m.user_id, COALESCE(s.role,'MEMBER') AS role FROM radio_channel_members m
      JOIN driver_profiles p ON p.user_id = m.user_id
      LEFT JOIN radio_channel_member_state s ON s.channel_id = m.channel_id AND s.user_id = m.user_id
      WHERE m.channel_id = ? AND p.nickname_key = ?`).get(channelId, normalizeNickname(nickname));
    if (!target) return { error: "radio_member_not_found", status: 404 };
    const targetId = Number(target.user_id);
    if (targetId === Number(userId) || target.role === "OWNER" || (requesterRole === "MODERATOR" && target.role === "MODERATOR")) return { error: "radio_channel_forbidden", status: 403 };
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM radio_channel_members WHERE channel_id = ? AND user_id = ?").run(channelId, targetId);
      db.prepare("DELETE FROM radio_channel_invites WHERE channel_id = ? AND target_user_id = ?").run(channelId, targetId);
      if (ban) db.prepare("INSERT OR REPLACE INTO radio_channel_bans(channel_id, user_id, blocked_by, created_at) VALUES(?, ?, ?, ?)").run(channelId, targetId, userId, now);
      db.exec("COMMIT");
      return { removed: true, banned: Boolean(ban) };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function unbanMember(userId, channelId, nickname) {
    if (!canModerate(userId, channelId)) return { error: "radio_channel_forbidden", status: 403 };
    const target = db.prepare("SELECT user_id FROM driver_profiles WHERE nickname_key = ?").get(normalizeNickname(nickname));
    if (!target) return { error: "driver_not_found", status: 404 };
    const changes = db.prepare("DELETE FROM radio_channel_bans WHERE channel_id = ? AND user_id = ?").run(channelId, Number(target.user_id)).changes;
    return { unbanned: changes === 1 };
  }

  function leaveChannel(userId, channelId) {
    const profile = profileRow(channelId);
    if (!profile || profile.space_kind !== "GROUP") return { error: "radio_leave_forbidden", status: 400 };
    if (!isMember(channelId, userId)) return { error: "radio_channel_not_found", status: 404 };
    if (roleFor(userId, channelId) === "OWNER") return { error: "radio_owner_transfer_required", status: 409 };
    const changes = db.prepare("DELETE FROM radio_channel_members WHERE channel_id = ? AND user_id = ?").run(channelId, userId).changes;
    return changes ? { left: true } : { error: "radio_channel_not_found", status: 404 };
  }

  function channelDeletionTarget(userId, channelId) {
    const profile = profileRow(channelId);
    if (!profile || profile.space_kind !== "GROUP") return { error: "radio_channel_not_found", status: 404 };
    if (roleFor(userId, channelId) !== "OWNER") return { error: "radio_channel_forbidden", status: 403 };
    const storageKeys = db.prepare("SELECT storage_key FROM radio_transmissions WHERE channel_id = ?").all(channelId).map((row) => row.storage_key);
    return { channelId, storageKeys };
  }

  function deleteGroupChannel(userId, channelId) {
    const target = channelDeletionTarget(userId, channelId);
    if (target.error) return target;
    const changes = db.prepare("DELETE FROM radio_channels WHERE id = ?").run(channelId).changes;
    return { deleted: changes === 1, storageKeys: target.storageKeys };
  }

  function updateChannelPreferences(userId, channelId, input) {
    const access = channelAccessError(userId, channelId);
    if (access) return { error: access, status: access === "driver_blocked" ? 403 : 404 };
    const state = ensureMemberState(channelId, userId);
    const muted = input?.muted === undefined ? state.muted : input.muted ? 1 : 0;
    const favorite = input?.favorite === undefined ? state.favorite : input.favorite ? 1 : 0;
    const lastRead = input?.lastReadTransmissionId === undefined ? Number(state.last_read_transmission_id) : Number(input.lastReadTransmissionId);
    if (!Number.isSafeInteger(lastRead) || lastRead < 0) return { error: "invalid_radio_preferences", status: 400 };
    const maxId = db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM radio_transmissions WHERE channel_id = ? AND state = 'COMMITTED'").get(channelId).id;
    const safeRead = Math.min(lastRead, Number(maxId || 0));
    db.prepare("UPDATE radio_channel_member_state SET muted = ?, favorite = ?, last_read_transmission_id = ? WHERE channel_id = ? AND user_id = ?")
      .run(muted, favorite, safeRead, channelId, userId);
    return { muted: Boolean(muted), favorite: Boolean(favorite), lastReadTransmissionId: safeRead };
  }

  function updateSettings(userId, input, now = nowIso()) {
    const current = ensureSettings(userId, now);
    const status = input?.status === undefined ? current.status : String(input.status).toUpperCase();
    const autoPlay = input?.autoPlay === undefined ? Number(current.auto_play) : input.autoPlay ? 1 : 0;
    const playbackRate = input?.playbackRate === undefined ? Number(current.playback_rate) : Number(input.playbackRate);
    let soloChannelId = input?.soloChannelId === undefined ? current.solo_channel_id : input.soloChannelId === null ? null : Number(input.soloChannelId);
    const defaultChannelId = input?.defaultChannelId === undefined ? current.default_channel_id : input.defaultChannelId === null ? null : Number(input.defaultChannelId);
    if (!RADIO_STATUSES.has(status) || !PLAYBACK_RATES.has(playbackRate)) return { error: "invalid_radio_settings", status: 400 };
    for (const id of [soloChannelId, defaultChannelId]) {
      if (id !== null && (!Number.isSafeInteger(id) || channelAccessError(userId, id))) return { error: "radio_channel_not_found", status: 404 };
    }
    if (status === "SOLO" && soloChannelId === null) return { error: "radio_solo_channel_required", status: 400 };
    if (status !== "SOLO") soloChannelId = null;
    db.prepare("UPDATE radio_user_settings SET status = ?, solo_channel_id = ?, default_channel_id = ?, auto_play = ?, playback_rate = ?, updated_at = ? WHERE user_id = ?")
      .run(status, soloChannelId, defaultChannelId, autoPlay, playbackRate, now, userId);
    return { settings: publicSettings(ensureSettings(userId, now)) };
  }

  function beginTransmission(userId, channelId, now = nowIso()) {
    const permission = talkPermission(userId, channelId);
    if (!permission.allowed) {
      const status = permission.error === "driver_blocked" || permission.error === "radio_talk_not_allowed" ? 403 : 404;
      return { error: permission.error, status };
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM radio_speaker_leases WHERE channel_id = ? AND expires_at <= ?").run(channelId, now);
      const active = db.prepare(`SELECT l.speaker_id, p.nickname FROM radio_speaker_leases l
        JOIN driver_profiles p ON p.user_id = l.speaker_id WHERE l.channel_id = ?`).get(channelId);
      if (active) {
        db.exec("COMMIT");
        return { error: "radio_channel_busy", status: 409, speaker: active.nickname };
      }
      const uploadToken = randomToken(32);
      const storageKey = crypto.randomUUID().replaceAll("-", "");
      const expiresAt = addSeconds(now, LEASE_SECONDS);
      const transmission = db.prepare(`INSERT INTO radio_transmissions(
        channel_id, sender_id, upload_token_hash, storage_key, state, created_at, expires_at
      ) VALUES(?, ?, ?, ?, 'UPLOADING', ?, ?)`)
        .run(channelId, userId, hashToken(uploadToken), storageKey, now, expiresAt);
      db.prepare("INSERT INTO radio_speaker_leases(channel_id, speaker_id, upload_token_hash, expires_at) VALUES(?, ?, ?, ?)")
        .run(channelId, userId, hashToken(uploadToken), expiresAt);
      db.exec("COMMIT");
      return { transmissionId: Number(transmission.lastInsertRowid), uploadToken, expiresAt };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function uploadTarget(userId, transmissionId, uploadToken, now = nowIso()) {
    const row = db.prepare(`SELECT t.*, l.speaker_id, l.expires_at AS lease_expires_at, l.upload_token_hash AS lease_token_hash
      FROM radio_transmissions t LEFT JOIN radio_speaker_leases l ON l.channel_id = t.channel_id
      WHERE t.id = ?`).get(transmissionId);
    if (!row || Number(row.sender_id) !== userId || row.state !== "UPLOADING" || row.expires_at <= now ||
      Number(row.speaker_id) !== Number(userId) || row.lease_expires_at <= now || !uploadToken ||
      hashToken(uploadToken) !== row.upload_token_hash || hashToken(uploadToken) !== row.lease_token_hash) return null;
    if (channelAccessError(userId, Number(row.channel_id))) return null;
    return row;
  }

  function commitUpload(userId, transmissionId, uploadToken, { mimeType, byteLength }, now = nowIso()) {
    const row = uploadTarget(userId, transmissionId, uploadToken, now);
    if (!row) return null;
    db.exec("BEGIN IMMEDIATE");
    try {
      const changed = db.prepare(`UPDATE radio_transmissions SET state = 'COMMITTED', mime_type = ?, byte_length = ?, committed_at = ?, expires_at = ?
        WHERE id = ? AND state = 'UPLOADING' AND upload_token_hash = ?`)
        .run(mimeType, byteLength, now, addDays(now, TRANSMISSION_RETENTION_DAYS), transmissionId, hashToken(uploadToken)).changes;
      if (changed !== 1) throw new Error("radio_transmission_conflict");
      db.prepare("DELETE FROM radio_speaker_leases WHERE channel_id = ? AND upload_token_hash = ?").run(row.channel_id, hashToken(uploadToken));
      const committed = db.prepare(`SELECT t.*, p.nickname, p.driver_type FROM radio_transmissions t
        JOIN driver_profiles p ON p.user_id = t.sender_id WHERE t.id = ?`).get(transmissionId);
      db.exec("COMMIT");
      return publicTransmission(committed);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function cancelTransmission(userId, transmissionId, uploadToken) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT channel_id FROM radio_transmissions WHERE id = ? AND sender_id = ? AND state = 'UPLOADING' AND upload_token_hash = ?")
        .get(transmissionId, userId, hashToken(uploadToken));
      if (!row) {
        db.exec("COMMIT");
        return false;
      }
      db.prepare("DELETE FROM radio_speaker_leases WHERE channel_id = ? AND speaker_id = ? AND upload_token_hash = ?").run(row.channel_id, userId, hashToken(uploadToken));
      const deleted = db.prepare("DELETE FROM radio_transmissions WHERE id = ? AND sender_id = ? AND state = 'UPLOADING' AND upload_token_hash = ?")
        .run(transmissionId, userId, hashToken(uploadToken)).changes;
      db.exec("COMMIT");
      return deleted === 1;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function listTransmissions(userId, channelId, now = nowIso(), limit = 30) {
    const access = channelAccessError(userId, channelId);
    if (access) return { error: access };
    const rows = db.prepare(`SELECT t.*, p.nickname, p.driver_type FROM radio_transmissions t
      JOIN driver_profiles p ON p.user_id = t.sender_id
      WHERE t.channel_id = ? AND t.state = 'COMMITTED' AND t.expires_at > ?
      ORDER BY t.id DESC LIMIT ?`).all(channelId, now, limit);
    return { transmissions: rows.reverse().map(publicTransmission) };
  }

  function audioForUser(userId, transmissionId, now = nowIso()) {
    const row = db.prepare(`SELECT t.*, p.nickname, p.driver_type FROM radio_transmissions t
      JOIN driver_profiles p ON p.user_id = t.sender_id WHERE t.id = ?`).get(transmissionId);
    if (!row || row.state !== "COMMITTED" || row.expires_at <= now || channelAccessError(userId, Number(row.channel_id))) return null;
    return row;
  }

  function committedDeletionTarget(userId, transmissionId) {
    return db.prepare("SELECT id, channel_id, storage_key FROM radio_transmissions WHERE id = ? AND sender_id = ? AND state = 'COMMITTED'")
      .get(transmissionId, userId) || null;
  }

  function deleteCommittedTransmission(userId, transmissionId) {
    return db.prepare("DELETE FROM radio_transmissions WHERE id = ? AND sender_id = ? AND state = 'COMMITTED'").run(transmissionId, userId).changes === 1;
  }

  function listPins(userId, channelId, now = nowIso()) {
    const access = channelAccessError(userId, channelId);
    if (access) return { error: access, status: access === "driver_blocked" ? 403 : 404 };
    const rows = db.prepare(`SELECT t.*, p.nickname, p.driver_type, pin.created_at AS pinned_at
      FROM radio_channel_pins pin
      JOIN radio_transmissions t ON t.id = pin.transmission_id AND t.channel_id = pin.channel_id
      JOIN driver_profiles p ON p.user_id = t.sender_id
      WHERE pin.channel_id = ? AND t.state = 'COMMITTED' AND t.expires_at > ?
      ORDER BY pin.created_at DESC LIMIT ?`).all(channelId, now, MAX_PINS);
    return { pins: rows.map((row) => ({ ...publicTransmission(row), pinnedAt: row.pinned_at })) };
  }

  function pinTransmission(userId, channelId, transmissionId, now = nowIso()) {
    if (!canModerate(userId, channelId)) return { error: "radio_channel_forbidden", status: 403 };
    const transmission = db.prepare("SELECT id FROM radio_transmissions WHERE id = ? AND channel_id = ? AND state = 'COMMITTED'").get(transmissionId, channelId);
    if (!transmission) return { error: "radio_transmission_not_found", status: 404 };
    const count = db.prepare("SELECT COUNT(*) AS n FROM radio_channel_pins WHERE channel_id = ?").get(channelId).n;
    if (count >= MAX_PINS && !db.prepare("SELECT 1 FROM radio_channel_pins WHERE channel_id = ? AND transmission_id = ?").get(channelId, transmissionId)) return { error: "radio_pin_limit", status: 409 };
    db.prepare("INSERT OR IGNORE INTO radio_channel_pins(channel_id, transmission_id, pinned_by, created_at) VALUES(?, ?, ?, ?)").run(channelId, transmissionId, userId, now);
    return { pinned: true };
  }

  function unpinTransmission(userId, channelId, transmissionId) {
    if (!canModerate(userId, channelId)) return { error: "radio_channel_forbidden", status: 403 };
    const changes = db.prepare("DELETE FROM radio_channel_pins WHERE channel_id = ? AND transmission_id = ?").run(channelId, transmissionId).changes;
    return { unpinned: changes === 1 };
  }

  function sendAlert(userId, channelId, now = nowIso()) {
    const access = channelAccessError(userId, channelId);
    if (access) return { error: access, status: access === "driver_blocked" ? 403 : 404 };
    const profile = profileRow(channelId);
    if (profile && profile.space_kind !== "GENERAL" && !canModerate(userId, channelId)) return { error: "radio_alert_forbidden", status: 403 };
    if (profile?.space_kind === "GENERAL") return { error: "radio_alert_forbidden", status: 403 };
    const expiresAt = addSeconds(now, ALERT_SECONDS);
    const result = db.prepare("INSERT INTO radio_channel_alerts(channel_id, sender_id, kind, created_at, expires_at) VALUES(?, ?, 'ATTENTION', ?, ?)")
      .run(channelId, userId, now, expiresAt);
    const sender = db.prepare("SELECT nickname FROM driver_profiles WHERE user_id = ?").get(userId);
    return { alert: { id: Number(result.lastInsertRowid), channelId: Number(channelId), kind: "ATTENTION", sender: { nickname: sender.nickname }, createdAt: now, expiresAt } };
  }

  return {
    hasProfile,
    ensureGeneralMembership,
    channelAccessError,
    overview,
    listChannels,
    listInvites,
    listActiveAlerts,
    createDirectChannel,
    createGroupChannel,
    discoverChannels,
    joinPublicChannel,
    inviteToChannel,
    respondToInvite,
    updateChannel,
    listMembers,
    setMemberRole,
    removeMember,
    unbanMember,
    leaveChannel,
    channelDeletionTarget,
    deleteGroupChannel,
    updateChannelPreferences,
    updateSettings,
    beginTransmission,
    uploadTarget,
    commitUpload,
    cancelTransmission,
    listTransmissions,
    audioForUser,
    committedDeletionTarget,
    deleteCommittedTransmission,
    listPins,
    pinTransmission,
    unpinTransmission,
    sendAlert
  };
}

module.exports = {
  createRadioRepository,
  LEASE_SECONDS,
  TRANSMISSION_RETENTION_DAYS,
  CHANNEL_ROLES,
  TALK_POLICIES,
  VISIBILITIES,
  RADIO_STATUSES,
  PLAYBACK_RATES,
  GENERAL_CHANNEL_KEY
};
