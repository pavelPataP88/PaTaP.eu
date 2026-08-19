const crypto = require("crypto");
const { ensureChatSchema } = require("../chat/schema");
const { ensureRadioSchema } = require("../radio/schema");
const { ensurePeopleSchema } = require("./schema");
const { createPeoplePrivacy } = require("./privacy");

const COMMUNITY_ROLES = new Set(["OWNER", "MODERATOR", "MEMBER"]);
const COMMUNITY_VISIBILITIES = new Set(["PUBLIC", "PRIVATE"]);
const COMMUNITY_CATEGORIES = new Set(["GENERAL", "TIR", "TAXI", "DELIVERY", "LOCAL"]);
const NEARBY_RADII_KM = new Set([5, 25, 50, 100]);

function normalizeNickname(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("und");
}

function normalizeCommunityTitle(value) {
  const text = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  return text.length >= 3 && text.length <= 48 && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
}

function normalizeDescription(value) {
  const text = String(value || "").normalize("NFKC").trim();
  return text.length <= 240 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ? text : null;
}

function normalizePrivateNote(value) {
  const text = String(value || "").normalize("NFKC").trim();
  return text.length <= 120 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ? text : null;
}

function normalizeCountryCode(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const code = String(value).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : undefined;
}

function haversineKm(fromLat, fromLon, toLat, toLon) {
  const rad = (degrees) => degrees * Math.PI / 180;
  const earthKm = 6371.0088;
  const dLat = rad(toLat - fromLat);
  const dLon = rad(toLon - fromLon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(fromLat)) * Math.cos(rad(toLat)) * Math.sin(dLon / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function createPeopleRepository(db, { nowIso = () => new Date().toISOString(), addMinutes = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString() } = {}) {
  ensureChatSchema(db, nowIso());
  ensureRadioSchema(db, nowIso());
  ensurePeopleSchema(db, nowIso());
  const privacy = createPeoplePrivacy(db, { nowIso });

  function hasProfile(userId) {
    return Boolean(db.prepare("SELECT 1 FROM driver_profiles WHERE user_id = ?").get(userId));
  }

  function targetId(nickname) {
    const key = normalizeNickname(nickname);
    return key ? Number(db.prepare("SELECT user_id FROM driver_profiles WHERE nickname_key = ?").get(key)?.user_id || 0) || null : null;
  }

  function relationship(viewerId, driverId) {
    if (Number(viewerId) === Number(driverId)) return "SELF";
    if (db.prepare("SELECT 1 FROM driver_blocks WHERE blocker_id = ? AND blocked_id = ?").get(viewerId, driverId)) return "BLOCKED";
    const outgoing = db.prepare("SELECT status FROM driver_relationships WHERE requester_id = ? AND target_id = ?").get(viewerId, driverId);
    if (outgoing?.status === "ACCEPTED" || db.prepare("SELECT 1 FROM driver_relationships WHERE requester_id = ? AND target_id = ? AND status = 'ACCEPTED'").get(driverId, viewerId)) return "CONTACT";
    if (outgoing?.status === "PENDING") return "REQUEST_SENT";
    if (db.prepare("SELECT 1 FROM driver_relationships WHERE requester_id = ? AND target_id = ? AND status = 'PENDING'").get(driverId, viewerId)) return "REQUEST_INCOMING";
    return "STRANGER";
  }

  function mutualCommunityCount(viewerId, targetId) {
    return Number(db.prepare(`SELECT COUNT(*) AS n FROM driver_community_members mine
      JOIN driver_community_members theirs ON theirs.community_id = mine.community_id
      WHERE mine.user_id = ? AND theirs.user_id = ?`).get(viewerId, targetId).n || 0);
  }

  function personRow(userId) {
    return db.prepare(`SELECT p.user_id,p.nickname,p.driver_type,p.vehicle,p.country_code,p.gps_enabled,
        l.updated_at AS location_updated_at
      FROM driver_profiles p LEFT JOIN driver_locations l ON l.user_id=p.user_id WHERE p.user_id=?`).get(userId) || null;
  }

  function publicPerson(row, viewerId, { distanceKm = null } = {}) {
    if (!row) return null;
    const driverId = Number(row.user_id);
    const relation = relationship(viewerId, driverId);
    const pref = relation === "CONTACT" ? privacy.preference(viewerId, driverId) : { favorite: false, trusted: false, privateNote: "" };
    const nearbyVisible = privacy.canSeeNearby(viewerId, driverId);
    const fresh = Boolean(row.location_updated_at && row.location_updated_at >= addMinutes(-1));
    return {
      nickname: row.nickname,
      driverType: row.driver_type,
      vehicle: privacy.canSeeVehicle(viewerId, driverId) ? row.vehicle || null : null,
      countryCode: row.country_code || null,
      relationship: relation,
      favorite: Boolean(pref.favorite),
      trusted: Boolean(pref.trusted),
      privateNote: pref.privateNote || "",
      mutualCommunities: mutualCommunityCount(viewerId, driverId),
      gps: nearbyVisible && row.gps_enabled === 1 ? (fresh ? "ACTIVE" : "STALE") : nearbyVisible ? "OFF" : "HIDDEN",
      locationUpdatedAt: nearbyVisible ? row.location_updated_at || null : null,
      distanceKm: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(1)) : null,
      canRequestContact: relation === "STRANGER" && privacy.canRequestContact(viewerId, driverId),
      canChat: relation !== "BLOCKED",
      canRadio: relation === "CONTACT"
    };
  }

  function getPerson(viewerId, nickname) {
    const driverId = targetId(nickname);
    if (!driverId) return null;
    if (!privacy.canOpenCard(viewerId, driverId)) return null;
    return publicPerson(personRow(driverId), viewerId);
  }

  function searchPeople(viewerId, { query = "", driverType = "", countryCode = "", limit = 30 } = {}) {
    const q = normalizeNickname(query).slice(0, 32);
    const type = String(driverType || "").toUpperCase();
    const country = normalizeCountryCode(countryCode);
    if (country === undefined || (type && !["TIR", "TAXI", "DELIVERY", "GENERAL"].includes(type))) return [];
    const clauses = ["p.user_id != ?", "u.disabled = 0"];
    const args = [viewerId];
    if (q) { clauses.push("p.nickname_key LIKE ?"); args.push(`${q}%`); }
    if (type) { clauses.push("p.driver_type = ?"); args.push(type); }
    if (country) { clauses.push("p.country_code = ?"); args.push(country); }
    args.push(Math.min(50, Math.max(1, Number(limit) || 30)));
    return db.prepare(`SELECT p.user_id,p.nickname,p.driver_type,p.vehicle,p.country_code,p.gps_enabled,l.updated_at AS location_updated_at
      FROM driver_profiles p JOIN users u ON u.id=p.user_id LEFT JOIN driver_locations l ON l.user_id=p.user_id
      WHERE ${clauses.join(" AND ")} ORDER BY p.nickname_key LIMIT ?`).all(...args)
      .filter((row) => privacy.canDiscover(viewerId, Number(row.user_id)))
      .map((row) => publicPerson(row, viewerId));
  }

  function listRelationships(viewerId) {
    const ids = db.prepare(`SELECT target_id AS user_id FROM driver_relationships WHERE requester_id=?
      UNION SELECT requester_id FROM driver_relationships WHERE target_id=?
      UNION SELECT blocked_id FROM driver_blocks WHERE blocker_id=?`).all(viewerId, viewerId, viewerId);
    const drivers = ids.map((row) => publicPerson(personRow(Number(row.user_id)), viewerId)).filter(Boolean)
      .sort((a, b) => a.nickname.localeCompare(b.nickname, "und"));
    const groups = { incoming: [], outgoing: [], contacts: [], favorites: [], trusted: [], blocked: [] };
    for (const person of drivers) {
      if (person.relationship === "REQUEST_INCOMING") groups.incoming.push(person);
      else if (person.relationship === "REQUEST_SENT") groups.outgoing.push(person);
      else if (person.relationship === "CONTACT") groups.contacts.push(person);
      else if (person.relationship === "BLOCKED") groups.blocked.push(person);
      if (person.relationship === "CONTACT" && person.favorite) groups.favorites.push(person);
      if (person.relationship === "CONTACT" && person.trusted) groups.trusted.push(person);
    }
    return { drivers, groups };
  }

  function setContactPreferences(userId, nickname, input, now = nowIso()) {
    const driverId = targetId(nickname);
    if (!driverId) return { error: "driver_not_found", status: 404 };
    if (!privacy.isContact(userId, driverId)) return { error: "people_contact_required", status: 403 };
    const current = privacy.preference(userId, driverId);
    const favorite = input?.favorite === undefined ? current.favorite : Boolean(input.favorite);
    const trusted = input?.trusted === undefined ? current.trusted : Boolean(input.trusted);
    const note = input?.privateNote === undefined ? current.privateNote : normalizePrivateNote(input.privateNote);
    if (note === null) return { error: "invalid_people_preferences", status: 400 };
    if (!favorite && !trusted && !note) db.prepare("DELETE FROM driver_contact_preferences WHERE user_id=? AND target_user_id=?").run(userId, driverId);
    else db.prepare(`INSERT INTO driver_contact_preferences(user_id,target_user_id,favorite,trusted,private_note,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,target_user_id) DO UPDATE SET
      favorite=excluded.favorite,trusted=excluded.trusted,private_note=excluded.private_note,updated_at=excluded.updated_at`)
      .run(userId, driverId, favorite ? 1 : 0, trusted ? 1 : 0, note, now);
    return { person: publicPerson(personRow(driverId), userId) };
  }

  function cleanupContactPreferences(leftUserId, rightUserId) {
    return db.prepare(`DELETE FROM driver_contact_preferences
      WHERE (user_id=? AND target_user_id=?) OR (user_id=? AND target_user_id=?)`)
      .run(leftUserId, rightUserId, rightUserId, leftUserId).changes;
  }

  function nearbyPeople(userId, radiusKm = 25) {
    const radius = Number(radiusKm);
    if (!NEARBY_RADII_KM.has(radius)) return { error: "invalid_radius", status: 400 };
    const profile = db.prepare("SELECT gps_enabled FROM driver_profiles WHERE user_id=?").get(userId);
    if (!profile) return { error: "driver_profile_required", status: 409 };
    if (profile.gps_enabled !== 1) return { radiusKm: radius, locationReady: false, people: [] };
    const origin = db.prepare("SELECT latitude,longitude,updated_at FROM driver_locations WHERE user_id=? AND updated_at>=?")
      .get(userId, addMinutes(-1));
    if (!origin) return { radiusKm: radius, locationReady: false, people: [] };
    const rows = db.prepare(`SELECT p.user_id,p.nickname,p.driver_type,p.vehicle,p.country_code,p.gps_enabled,
        l.latitude,l.longitude,l.updated_at AS location_updated_at
      FROM driver_locations l JOIN driver_profiles p ON p.user_id=l.user_id JOIN users u ON u.id=l.user_id
      WHERE l.user_id!=? AND l.updated_at>=? AND p.gps_enabled=1 AND u.disabled=0`).all(userId, addMinutes(-1));
    const people = rows.filter((row) => privacy.canSeeNearby(userId, Number(row.user_id)))
      .map((row) => ({ row, distance: haversineKm(origin.latitude, origin.longitude, row.latitude, row.longitude) }))
      .filter((item) => item.distance <= radius)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 100)
      .map((item) => publicPerson(item.row, userId, { distanceKm: item.distance }));
    return { radiusKm: radius, locationReady: true, people };
  }

  function communityRow(communityId) {
    return db.prepare("SELECT * FROM driver_communities WHERE id=?").get(Number(communityId)) || null;
  }

  function communityRole(userId, communityId) {
    return db.prepare("SELECT role FROM driver_community_members WHERE community_id=? AND user_id=?").get(Number(communityId), userId)?.role || null;
  }

  function communityForUser(userId, row) {
    if (!row) return null;
    const member = db.prepare("SELECT role,favorite,joined_at FROM driver_community_members WHERE community_id=? AND user_id=?").get(row.id, userId);
    const banned = Boolean(db.prepare("SELECT 1 FROM driver_community_bans WHERE community_id=? AND user_id=?").get(row.id, userId));
    if (banned && !member) return null;
    const memberCount = Number(db.prepare("SELECT COUNT(*) AS n FROM driver_community_members WHERE community_id=?").get(row.id).n || 0);
    return {
      id: Number(row.id), key: row.community_key, title: row.title, description: row.description,
      visibility: row.visibility, category: row.category, countryCode: row.country_code || null,
      memberCount, joined: Boolean(member), role: member?.role || null, favorite: Boolean(member?.favorite),
      canManage: member?.role === "OWNER", canModerate: ["OWNER", "MODERATOR"].includes(member?.role),
      chatRoomId: member ? Number(row.chat_room_id) : null,
      radioChannelId: member ? Number(row.radio_channel_id) : null,
      createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  function listCommunities(userId) {
    return db.prepare(`SELECT c.* FROM driver_communities c JOIN driver_community_members m ON m.community_id=c.id
      WHERE m.user_id=? ORDER BY m.favorite DESC,c.updated_at DESC,c.id DESC`).all(userId)
      .map((row) => communityForUser(userId, row)).filter(Boolean);
  }

  function discoverCommunities(userId, { query = "", category = "", countryCode = "" } = {}) {
    const q = String(query || "").normalize("NFKC").trim().slice(0, 48);
    const categoryValue = String(category || "").toUpperCase();
    const country = normalizeCountryCode(countryCode);
    if (country === undefined || (categoryValue && !COMMUNITY_CATEGORIES.has(categoryValue))) return [];
    const clauses = ["c.visibility='PUBLIC'", "NOT EXISTS(SELECT 1 FROM driver_community_bans b WHERE b.community_id=c.id AND b.user_id=?)"];
    const args = [userId];
    if (q) { clauses.push("(c.title LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\')"); const like = `%${q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`; args.push(like, like); }
    if (categoryValue) { clauses.push("c.category=?"); args.push(categoryValue); }
    if (country) { clauses.push("c.country_code=?"); args.push(country); }
    return db.prepare(`SELECT c.* FROM driver_communities c WHERE ${clauses.join(" AND ")}
      ORDER BY (SELECT COUNT(*) FROM driver_community_members m WHERE m.community_id=c.id) DESC,c.updated_at DESC LIMIT 50`).all(...args)
      .map((row) => communityForUser(userId, row)).filter(Boolean);
  }

  function listCommunityInvites(userId) {
    return db.prepare(`SELECT i.community_id,i.created_at,c.title,c.description,c.category,c.country_code,p.nickname AS invited_by,
        (SELECT COUNT(*) FROM driver_community_members m WHERE m.community_id=i.community_id) AS member_count
      FROM driver_community_invites i JOIN driver_communities c ON c.id=i.community_id
      LEFT JOIN driver_profiles p ON p.user_id=i.invited_by WHERE i.target_user_id=? ORDER BY i.created_at DESC`).all(userId)
      .map((row) => ({ communityId:Number(row.community_id), title:row.title, description:row.description, category:row.category,
        countryCode:row.country_code || null, invitedBy:row.invited_by || "Driver", memberCount:Number(row.member_count || 0), createdAt:row.created_at }));
  }

  function createCommunity(userId, input, now = nowIso()) {
    if (!hasProfile(userId)) return { error: "driver_profile_required", status: 409 };
    const title = normalizeCommunityTitle(input?.title);
    const description = normalizeDescription(input?.description);
    const visibility = String(input?.visibility || "PRIVATE").toUpperCase();
    const category = String(input?.category || "GENERAL").toUpperCase();
    const countryCode = normalizeCountryCode(input?.countryCode);
    if (!title || description === null || !COMMUNITY_VISIBILITIES.has(visibility) || !COMMUNITY_CATEGORIES.has(category) || countryCode === undefined) {
      return { error: "invalid_community", status: 400 };
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const chatResult = db.prepare("INSERT INTO chat_rooms(room_key,kind,title,created_by,created_at) VALUES(?, 'GENERAL', ?, ?, ?)")
        .run(`group:${crypto.randomUUID()}`, title, userId, now);
      const chatRoomId = Number(chatResult.lastInsertRowid);
      db.prepare(`INSERT INTO chat_room_profiles(room_id,space_kind,description,visibility,history_policy,created_by,created_at,updated_at)
        VALUES(?, 'GROUP', ?, ?, 'FULL', ?, ?, ?)`).run(chatRoomId, description, visibility, userId, now, now);
      db.prepare("INSERT INTO chat_room_members(room_id,user_id,joined_at,role) VALUES(?,?,?,'OWNER')").run(chatRoomId, userId, now);
      db.prepare("INSERT OR IGNORE INTO chat_room_member_state(room_id,user_id,updated_at) VALUES(?,?,?)").run(chatRoomId, userId, now);

      const radioResult = db.prepare("INSERT INTO radio_channels(channel_key,kind,created_at) VALUES(?, 'DIRECT', ?)")
        .run(`group:${crypto.randomUUID()}`, now);
      const radioChannelId = Number(radioResult.lastInsertRowid);
      db.prepare(`INSERT INTO radio_channel_profiles(channel_id,space_kind,title,description,visibility,talk_policy,created_by,created_at,updated_at)
        VALUES(?, 'GROUP', ?, ?, ?, 'EVERYONE', ?, ?, ?)`).run(radioChannelId, title, description, visibility, userId, now, now);
      db.prepare("INSERT INTO radio_channel_members(channel_id,user_id,joined_at) VALUES(?,?,?)").run(radioChannelId, userId, now);
      db.prepare("INSERT OR IGNORE INTO radio_channel_member_state(channel_id,user_id,role) VALUES(?,?,'OWNER')").run(radioChannelId, userId);

      const result = db.prepare(`INSERT INTO driver_communities(community_key,title,description,visibility,category,country_code,created_by,chat_room_id,radio_channel_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(`community:${crypto.randomUUID()}`, title, description, visibility, category, countryCode, userId, chatRoomId, radioChannelId, now, now);
      const communityId = Number(result.lastInsertRowid);
      db.prepare("INSERT INTO driver_community_members(community_id,user_id,role,joined_at) VALUES(?,?,'OWNER',?)").run(communityId, userId, now);
      db.exec("COMMIT");
      return { community: communityForUser(userId, communityRow(communityId)), created: true };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function updateCommunity(userId, communityId, input, now = nowIso()) {
    const row = communityRow(communityId);
    if (!row) return { error:"community_not_found", status:404 };
    if (communityRole(userId, communityId) !== "OWNER") return { error:"community_forbidden", status:403 };
    const title = input?.title === undefined ? row.title : normalizeCommunityTitle(input.title);
    const description = input?.description === undefined ? row.description : normalizeDescription(input.description);
    const visibility = input?.visibility === undefined ? row.visibility : String(input.visibility).toUpperCase();
    const category = input?.category === undefined ? row.category : String(input.category).toUpperCase();
    const countryCode = input?.countryCode === undefined ? row.country_code : normalizeCountryCode(input.countryCode);
    if (!title || description === null || !COMMUNITY_VISIBILITIES.has(visibility) || !COMMUNITY_CATEGORIES.has(category) || countryCode === undefined) return { error:"invalid_community", status:400 };
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE driver_communities SET title=?,description=?,visibility=?,category=?,country_code=?,updated_at=? WHERE id=?")
        .run(title,description,visibility,category,countryCode,now,communityId);
      db.prepare("UPDATE chat_rooms SET title=? WHERE id=?").run(title,row.chat_room_id);
      db.prepare("UPDATE chat_room_profiles SET description=?,visibility=?,updated_at=? WHERE room_id=?").run(description,visibility,now,row.chat_room_id);
      db.prepare("UPDATE radio_channel_profiles SET title=?,description=?,visibility=?,updated_at=? WHERE channel_id=?").run(title,description,visibility,now,row.radio_channel_id);
      db.exec("COMMIT");
      return { community:communityForUser(userId,communityRow(communityId)) };
    } catch(error){db.exec("ROLLBACK");throw error;}
  }

  function joinCommunity(userId, communityId, now = nowIso()) {
    const row = communityRow(communityId);
    if (!row || row.visibility !== "PUBLIC") return { error:"community_not_found",status:404 };
    if (db.prepare("SELECT 1 FROM driver_community_bans WHERE community_id=? AND user_id=?").get(communityId,userId)) return { error:"community_banned",status:403 };
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT OR IGNORE INTO driver_community_members(community_id,user_id,role,joined_at) VALUES(?,?,'MEMBER',?)").run(communityId,userId,now);
      db.prepare("INSERT OR IGNORE INTO chat_room_members(room_id,user_id,joined_at,role) VALUES(?,? ,?,'MEMBER')").run(row.chat_room_id,userId,now);
      db.prepare("INSERT OR IGNORE INTO chat_room_member_state(room_id,user_id,updated_at) VALUES(?,?,?)").run(row.chat_room_id,userId,now);
      db.prepare("INSERT OR IGNORE INTO radio_channel_members(channel_id,user_id,joined_at) VALUES(?,?,?)").run(row.radio_channel_id,userId,now);
      db.prepare("INSERT OR IGNORE INTO radio_channel_member_state(channel_id,user_id,role) VALUES(?,?,'MEMBER')").run(row.radio_channel_id,userId);
      db.prepare("DELETE FROM driver_community_invites WHERE community_id=? AND target_user_id=?").run(communityId,userId);
      db.prepare("DELETE FROM chat_room_invites WHERE room_id=? AND target_user_id=?").run(row.chat_room_id,userId);
      db.prepare("DELETE FROM radio_channel_invites WHERE channel_id=? AND target_user_id=?").run(row.radio_channel_id,userId);
      db.exec("COMMIT");
      return { community:communityForUser(userId,row) };
    } catch(error){db.exec("ROLLBACK");throw error;}
  }

  function inviteToCommunity(userId, communityId, nickname, now = nowIso()) {
    const row = communityRow(communityId);
    const requesterRole = communityRole(userId,communityId);
    if (!row || !["OWNER","MODERATOR"].includes(requesterRole)) return { error:"community_forbidden",status:403 };
    const driverId = targetId(nickname);
    if (!driverId) return { error:"driver_not_found",status:404 };
    if (!privacy.canInviteToCommunity(userId,driverId)) return { error:"community_invite_not_allowed",status:403 };
    if (db.prepare("SELECT 1 FROM driver_community_members WHERE community_id=? AND user_id=?").get(communityId,driverId)) return { error:"community_already_member",status:409 };
    if (db.prepare("SELECT 1 FROM driver_community_bans WHERE community_id=? AND user_id=?").get(communityId,driverId)) return { error:"community_banned",status:403 };
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`INSERT INTO driver_community_invites(community_id,target_user_id,invited_by,created_at) VALUES(?,?,?,?)
        ON CONFLICT(community_id,target_user_id) DO UPDATE SET invited_by=excluded.invited_by,created_at=excluded.created_at`).run(communityId,driverId,userId,now);
      db.prepare(`INSERT INTO chat_room_invites(room_id,target_user_id,invited_by,created_at) VALUES(?,?,?,?)
        ON CONFLICT(room_id,target_user_id) DO UPDATE SET invited_by=excluded.invited_by,created_at=excluded.created_at`).run(row.chat_room_id,driverId,userId,now);
      db.prepare(`INSERT INTO radio_channel_invites(channel_id,target_user_id,invited_by,created_at) VALUES(?,?,?,?)
        ON CONFLICT(channel_id,target_user_id) DO UPDATE SET invited_by=excluded.invited_by,created_at=excluded.created_at`).run(row.radio_channel_id,driverId,userId,now);
      db.exec("COMMIT"); return { invited:true };
    } catch(error){db.exec("ROLLBACK");throw error;}
  }

  function respondToCommunityInvite(userId, communityId, action, now = nowIso()) {
    const row = communityRow(communityId);
    const invite = row && db.prepare("SELECT 1 FROM driver_community_invites WHERE community_id=? AND target_user_id=?").get(communityId,userId);
    if (!invite) return { error:"community_invite_not_found",status:404 };
    const normalized = String(action || "").toUpperCase();
    if (!["ACCEPT","DECLINE"].includes(normalized)) return { error:"invalid_community_invite_action",status:400 };
    if (normalized === "ACCEPT" && db.prepare("SELECT 1 FROM driver_community_bans WHERE community_id=? AND user_id=?").get(communityId,userId)) return { error:"community_banned",status:403 };
    db.exec("BEGIN IMMEDIATE");
    try {
      if (normalized === "ACCEPT") {
        db.prepare("INSERT OR IGNORE INTO driver_community_members(community_id,user_id,role,joined_at) VALUES(?,?,'MEMBER',?)").run(communityId,userId,now);
        db.prepare("INSERT OR IGNORE INTO chat_room_members(room_id,user_id,joined_at,role) VALUES(?,? ,?,'MEMBER')").run(row.chat_room_id,userId,now);
        db.prepare("INSERT OR IGNORE INTO chat_room_member_state(room_id,user_id,updated_at) VALUES(?,?,?)").run(row.chat_room_id,userId,now);
        db.prepare("INSERT OR IGNORE INTO radio_channel_members(channel_id,user_id,joined_at) VALUES(?,?,?)").run(row.radio_channel_id,userId,now);
        db.prepare("INSERT OR IGNORE INTO radio_channel_member_state(channel_id,user_id,role) VALUES(?,?,'MEMBER')").run(row.radio_channel_id,userId);
      }
      db.prepare("DELETE FROM driver_community_invites WHERE community_id=? AND target_user_id=?").run(communityId,userId);
      db.prepare("DELETE FROM chat_room_invites WHERE room_id=? AND target_user_id=?").run(row.chat_room_id,userId);
      db.prepare("DELETE FROM radio_channel_invites WHERE channel_id=? AND target_user_id=?").run(row.radio_channel_id,userId);
      db.exec("COMMIT");
      return { accepted:normalized === "ACCEPT", community:normalized === "ACCEPT" ? communityForUser(userId,row) : null };
    } catch(error){db.exec("ROLLBACK");throw error;}
  }

  function setCommunityRole(userId, communityId, nickname, nextRole) {
    const row = communityRow(communityId);
    if (!row || communityRole(userId,communityId) !== "OWNER") return { error:"community_forbidden",status:403 };
    const role = String(nextRole || "").toUpperCase();
    if (!COMMUNITY_ROLES.has(role)) return { error:"invalid_community_role",status:400 };
    const target = db.prepare(`SELECT m.user_id,m.role,p.nickname FROM driver_community_members m JOIN driver_profiles p ON p.user_id=m.user_id
      WHERE m.community_id=? AND p.nickname_key=?`).get(communityId,normalizeNickname(nickname));
    if (!target) return { error:"community_member_not_found",status:404 };
    const targetUserId = Number(target.user_id);
    if (targetUserId === Number(userId) && role !== "OWNER") return { error:"community_owner_transfer_required",status:409 };
    db.exec("BEGIN IMMEDIATE");
    try {
      if (role === "OWNER" && targetUserId !== Number(userId)) {
        db.prepare("UPDATE driver_community_members SET role='MODERATOR' WHERE community_id=? AND user_id=?").run(communityId,userId);
        db.prepare("UPDATE chat_room_members SET role='MODERATOR' WHERE room_id=? AND user_id=?").run(row.chat_room_id,userId);
        db.prepare("UPDATE radio_channel_member_state SET role='MODERATOR' WHERE channel_id=? AND user_id=?").run(row.radio_channel_id,userId);
      }
      db.prepare("UPDATE driver_community_members SET role=? WHERE community_id=? AND user_id=?").run(role,communityId,targetUserId);
      db.prepare("UPDATE chat_room_members SET role=? WHERE room_id=? AND user_id=?").run(role, row.chat_room_id,targetUserId);
      db.prepare("UPDATE radio_channel_member_state SET role=? WHERE channel_id=? AND user_id=?").run(role,row.radio_channel_id,targetUserId);
      db.exec("COMMIT"); return { ok:true,role };
    } catch(error){db.exec("ROLLBACK");throw error;}
  }

  function removeCommunityMember(userId, communityId, nickname, { ban=false } = {}, now = nowIso()) {
    const row = communityRow(communityId);
    const requesterRole = communityRole(userId,communityId);
    if (!row || !["OWNER","MODERATOR"].includes(requesterRole)) return { error:"community_forbidden",status:403 };
    const target = db.prepare(`SELECT m.user_id,m.role FROM driver_community_members m JOIN driver_profiles p ON p.user_id=m.user_id
      WHERE m.community_id=? AND p.nickname_key=?`).get(communityId,normalizeNickname(nickname));
    if (!target) return { error:"community_member_not_found",status:404 };
    const targetUserId = Number(target.user_id);
    if (targetUserId === Number(userId) || target.role === "OWNER" || (requesterRole === "MODERATOR" && target.role === "MODERATOR")) return { error:"community_forbidden",status:403 };
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM radio_speaker_leases WHERE channel_id=? AND speaker_id=?").run(row.radio_channel_id,targetUserId);
      db.prepare("DELETE FROM radio_transmissions WHERE channel_id=? AND sender_id=? AND state='UPLOADING'").run(row.radio_channel_id,targetUserId);
      db.prepare("DELETE FROM driver_community_members WHERE community_id=? AND user_id=?").run(communityId,targetUserId);
      db.prepare("DELETE FROM driver_community_invites WHERE community_id=? AND target_user_id=?").run(communityId,targetUserId);
      db.prepare("DELETE FROM chat_room_members WHERE room_id=? AND user_id=?").run(row.chat_room_id,targetUserId);
      db.prepare("DELETE FROM chat_room_member_state WHERE room_id=? AND user_id=?").run(row.chat_room_id,targetUserId);
      db.prepare("DELETE FROM chat_drafts WHERE room_id=? AND user_id=?").run(row.chat_room_id,targetUserId);
      db.prepare("DELETE FROM chat_room_invites WHERE room_id=? AND target_user_id=?").run(row.chat_room_id,targetUserId);
      db.prepare("DELETE FROM radio_channel_members WHERE channel_id=? AND user_id=?").run(row.radio_channel_id,targetUserId);
      db.prepare("DELETE FROM radio_channel_member_state WHERE channel_id=? AND user_id=?").run(row.radio_channel_id,targetUserId);
      db.prepare("DELETE FROM radio_channel_invites WHERE channel_id=? AND target_user_id=?").run(row.radio_channel_id,targetUserId);
      if (ban) {
        db.prepare("INSERT OR REPLACE INTO driver_community_bans(community_id,user_id,blocked_by,created_at) VALUES(?,?,?,?)").run(communityId,targetUserId,userId,now);
        db.prepare("INSERT OR REPLACE INTO chat_room_bans(room_id,user_id,blocked_by,created_at) VALUES(?,?,?,?)").run(row.chat_room_id,targetUserId,userId,now);
        db.prepare("INSERT OR REPLACE INTO radio_channel_bans(channel_id,user_id,blocked_by,created_at) VALUES(?,?,?,?)").run(row.radio_channel_id,targetUserId,userId,now);
      }
      db.exec("COMMIT"); return { removed:true,banned:Boolean(ban) };
    } catch(error){db.exec("ROLLBACK");throw error;}
  }

  function unbanCommunityMember(userId, communityId, nickname) {
    const row = communityRow(communityId);
    if (!row || !["OWNER","MODERATOR"].includes(communityRole(userId,communityId))) return { error:"community_forbidden",status:403 };
    const driverId = targetId(nickname); if (!driverId) return { error:"driver_not_found",status:404 };
    db.exec("BEGIN IMMEDIATE");
    try {
      const changes = db.prepare("DELETE FROM driver_community_bans WHERE community_id=? AND user_id=?").run(communityId,driverId).changes;
      db.prepare("DELETE FROM chat_room_bans WHERE room_id=? AND user_id=?").run(row.chat_room_id,driverId);
      db.prepare("DELETE FROM radio_channel_bans WHERE channel_id=? AND user_id=?").run(row.radio_channel_id,driverId);
      db.exec("COMMIT"); return { unbanned:changes === 1 };
    } catch(error){db.exec("ROLLBACK");throw error;}
  }

  function leaveCommunity(userId, communityId) {
    const row = communityRow(communityId);
    if (!row || !communityRole(userId,communityId)) return { error:"community_not_found",status:404 };
    if (communityRole(userId,communityId) === "OWNER") return { error:"community_owner_transfer_required",status:409 };
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM radio_speaker_leases WHERE channel_id=? AND speaker_id=?").run(row.radio_channel_id,userId);
      db.prepare("DELETE FROM radio_transmissions WHERE channel_id=? AND sender_id=? AND state='UPLOADING'").run(row.radio_channel_id,userId);
      db.prepare("DELETE FROM driver_community_members WHERE community_id=? AND user_id=?").run(communityId,userId);
      db.prepare("DELETE FROM chat_room_members WHERE room_id=? AND user_id=?").run(row.chat_room_id,userId);
      db.prepare("DELETE FROM chat_room_member_state WHERE room_id=? AND user_id=?").run(row.chat_room_id,userId);
      db.prepare("DELETE FROM chat_drafts WHERE room_id=? AND user_id=?").run(row.chat_room_id,userId);
      db.prepare("DELETE FROM radio_channel_members WHERE channel_id=? AND user_id=?").run(row.radio_channel_id,userId);
      db.prepare("DELETE FROM radio_channel_member_state WHERE channel_id=? AND user_id=?").run(row.radio_channel_id,userId);
      db.exec("COMMIT"); return { left:true };
    } catch(error){db.exec("ROLLBACK");throw error;}
  }

  function setCommunityFavorite(userId, communityId, favorite) {
    if (!communityRole(userId,communityId)) return { error:"community_not_found",status:404 };
    db.prepare("UPDATE driver_community_members SET favorite=? WHERE community_id=? AND user_id=?").run(favorite ? 1 : 0,communityId,userId);
    return { favorite:Boolean(favorite) };
  }

  function listCommunityMembers(userId, communityId) {
    const row = communityRow(communityId);
    if (!row || !communityRole(userId,communityId)) return { error:"community_not_found",status:404 };
    const members = db.prepare(`SELECT m.user_id,m.role,m.joined_at,p.nickname,p.driver_type,p.vehicle,p.country_code,p.gps_enabled,l.updated_at AS location_updated_at
      FROM driver_community_members m JOIN driver_profiles p ON p.user_id=m.user_id LEFT JOIN driver_locations l ON l.user_id=p.user_id
      WHERE m.community_id=? ORDER BY CASE m.role WHEN 'OWNER' THEN 0 WHEN 'MODERATOR' THEN 1 ELSE 2 END,p.nickname COLLATE NOCASE`).all(communityId)
      .map((member) => ({ ...publicPerson(member,userId), role:member.role, joinedAt:member.joined_at }));
    const bans = ["OWNER","MODERATOR"].includes(communityRole(userId,communityId)) ? db.prepare(`SELECT p.nickname,p.driver_type,b.created_at
      FROM driver_community_bans b JOIN driver_profiles p ON p.user_id=b.user_id WHERE b.community_id=? ORDER BY b.created_at DESC`).all(communityId)
      .map((item) => ({ nickname:item.nickname,driverType:item.driver_type,createdAt:item.created_at })) : [];
    return { community:communityForUser(userId,row),members,bans };
  }

  function deleteCommunity(userId, communityId) {
    const row = communityRow(communityId);
    if (!row || communityRole(userId,communityId) !== "OWNER") return { error:"community_forbidden",status:403 };
    const chatStorageKeys = db.prepare(`SELECT DISTINCT a.storage_key FROM chat_message_attachments a JOIN chat_messages m ON m.id=a.message_id WHERE m.room_id=?`).all(row.chat_room_id).map((x)=>x.storage_key);
    const radioStorageKeys = db.prepare("SELECT DISTINCT storage_key FROM radio_transmissions WHERE channel_id=?").all(row.radio_channel_id).map((x)=>x.storage_key);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM driver_communities WHERE id=?").run(communityId);
      db.prepare("DELETE FROM chat_rooms WHERE id=?").run(row.chat_room_id);
      db.prepare("DELETE FROM radio_channels WHERE id=?").run(row.radio_channel_id);
      db.exec("COMMIT"); return { deleted:true,chatStorageKeys,radioStorageKeys };
    } catch(error){db.exec("ROLLBACK");throw error;}
  }

  function overview(userId) {
    const relationships = listRelationships(userId);
    const communities = listCommunities(userId);
    const invites = listCommunityInvites(userId);
    return {
      settings:privacy.ensureSettings(userId),
      groups:relationships.groups,
      drivers:relationships.drivers,
      communities,
      communityInvites:invites,
      counts:{
        contacts:relationships.groups.contacts.length,
        incoming:relationships.groups.incoming.length,
        favorites:relationships.groups.favorites.length,
        trusted:relationships.groups.trusted.length,
        blocked:relationships.groups.blocked.length,
        communities:communities.length,
        communityInvites:invites.length
      }
    };
  }

  return {
    privacy,
    overview,
    getPerson,
    searchPeople,
    listRelationships,
    setContactPreferences,
    cleanupContactPreferences,
    nearbyPeople,
    listCommunities,
    discoverCommunities,
    listCommunityInvites,
    createCommunity,
    updateCommunity,
    joinCommunity,
    inviteToCommunity,
    respondToCommunityInvite,
    setCommunityRole,
    removeCommunityMember,
    unbanCommunityMember,
    leaveCommunity,
    setCommunityFavorite,
    listCommunityMembers,
    deleteCommunity,
    communityForUser,
    communityRow,
    constants:{ COMMUNITY_ROLES, COMMUNITY_VISIBILITIES, COMMUNITY_CATEGORIES, NEARBY_RADII_KM }
  };
}

module.exports = {
  createPeopleRepository,
  COMMUNITY_ROLES,
  COMMUNITY_VISIBILITIES,
  COMMUNITY_CATEGORIES,
  NEARBY_RADII_KM,
  normalizeCommunityTitle,
  normalizeDescription
};
