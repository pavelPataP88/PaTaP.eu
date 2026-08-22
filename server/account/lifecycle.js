const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { ensureAccountSchema } = require("./schema");

const DELETED_LABEL = "Удалённый пользователь";
const FORWARDED_DELETED_LABEL = "Исходное сообщение удалено";
const QUARANTINE_SUFFIX = /\.account-delete-[0-9a-f-]+\.pending$/i;

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
}

function plain(row) { return row ? { ...row } : null; }
function plainRows(rows) { return rows.map((row) => ({ ...row })); }
function rowsIf(db, table, sql, ...params) { return tableExists(db, table) ? plainRows(db.prepare(sql).all(...params)) : []; }
function oneIf(db, table, sql, ...params) { return tableExists(db, table) ? plain(db.prepare(sql).get(...params)) : null; }
function runIf(db, table, sql, ...params) { return tableExists(db, table) ? Number(db.prepare(sql).run(...params).changes || 0) : 0; }
function parseJson(value) { if (!value) return null; try { return JSON.parse(value); } catch { return null; } }
function endpointHost(endpoint) { try { return new URL(String(endpoint || "")).host || null; } catch { return null; } }

function safeStorageFile(root, storageKey) {
  const key = String(storageKey || "");
  if (!key || key === "." || key === ".." || path.basename(key) !== key || /[\\/\u0000-\u001f\u007f]/.test(key)) return null;
  const base = path.resolve(root);
  const target = path.resolve(base, key);
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return target;
}

function cleanupDeletionQuarantine(dataDir) {
  let removed = 0;
  let failed = 0;
  for (const kind of ["chat", "radio", "parking"]) {
    const root = path.join(dataDir, kind);
    if (!fs.existsSync(root)) continue;
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { failed += 1; continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !QUARANTINE_SUFFIX.test(entry.name)) continue;
      try { fs.rmSync(path.join(root, entry.name), { force: true }); removed += 1; } catch { failed += 1; }
    }
  }
  return { removed, failed };
}

function accountOwnershipBlockers(db, userId) {
  const blockers = { principalOwner: false, chatGroups: 0, communities: 0, radioGroups: 0 };
  if (tableExists(db, "principal_owner")) blockers.principalOwner = Boolean(db.prepare("SELECT 1 FROM principal_owner WHERE singleton=1 AND user_id=?").get(userId));
  if (tableExists(db, "chat_room_members") && tableExists(db, "chat_room_profiles")) {
    blockers.chatGroups = Number(db.prepare(`SELECT COUNT(*) AS n FROM chat_room_members m JOIN chat_room_profiles p ON p.room_id=m.room_id WHERE m.user_id=? AND m.role='OWNER'`).get(userId).n || 0);
  }
  if (tableExists(db, "driver_community_members")) blockers.communities = Number(db.prepare("SELECT COUNT(*) AS n FROM driver_community_members WHERE user_id=? AND role='OWNER'").get(userId).n || 0);
  if (tableExists(db, "radio_channel_member_state") && tableExists(db, "radio_channel_profiles")) {
    blockers.radioGroups = Number(db.prepare(`SELECT COUNT(*) AS n FROM radio_channel_member_state s JOIN radio_channel_profiles p ON p.channel_id=s.channel_id WHERE s.user_id=? AND s.role='OWNER' AND p.space_kind='GROUP'`).get(userId).n || 0);
  }
  return blockers;
}

function exportAccountData(db, userId, { nowIso = () => new Date().toISOString() } = {}) {
  ensureAccountSchema(db, nowIso());
  if (db.prepare("SELECT 1 FROM account_tombstones WHERE user_id=?").get(userId)) return null;
  const account = plain(db.prepare(`SELECT id,username,email,role,disabled,created_at,updated_at,last_login_at,last_seen_at FROM users WHERE id=?`).get(userId));
  if (!account) return null;
  const profile = oneIf(db, "driver_profiles", `SELECT nickname,driver_type,real_name,vehicle,language,country,city,country_code,gps_enabled,created_at,updated_at FROM driver_profiles WHERE user_id=?`, userId);
  const location = oneIf(db, "driver_locations", `SELECT latitude,longitude,accuracy_m,updated_at FROM driver_locations WHERE user_id=?`, userId);
  const sessions = rowsIf(db, "sessions", `SELECT created_at,expires_at,last_seen_at,revoked_at,ip,user_agent FROM sessions WHERE user_id=? ORDER BY created_at`, userId);
  const relationships = rowsIf(db, "driver_relationships", `SELECT r.status,r.created_at,r.updated_at,CASE WHEN r.requester_id=? THEN 'OUTGOING' ELSE 'INCOMING' END AS direction,COALESCE(p.nickname,'${DELETED_LABEL}') AS peer_nickname FROM driver_relationships r LEFT JOIN driver_profiles p ON p.user_id=CASE WHEN r.requester_id=? THEN r.target_id ELSE r.requester_id END WHERE r.requester_id=? OR r.target_id=? ORDER BY r.updated_at`, userId, userId, userId, userId);
  const blocks = rowsIf(db, "driver_blocks", `SELECT b.created_at,CASE WHEN b.blocker_id=? THEN 'BLOCKED_BY_ME' ELSE 'BLOCKED_ME' END AS direction,COALESCE(p.nickname,'${DELETED_LABEL}') AS peer_nickname FROM driver_blocks b LEFT JOIN driver_profiles p ON p.user_id=CASE WHEN b.blocker_id=? THEN b.blocked_id ELSE b.blocker_id END WHERE b.blocker_id=? OR b.blocked_id=? ORDER BY b.created_at`, userId, userId, userId, userId);
  const peopleSettings = oneIf(db, "driver_people_settings", "SELECT discoverability,nearby_visibility,contact_requests,community_invites,vehicle_visibility,updated_at FROM driver_people_settings WHERE user_id=?", userId);
  const contactPreferences = rowsIf(db, "driver_contact_preferences", `SELECT c.favorite,c.trusted,c.private_note,c.updated_at,COALESCE(p.nickname,'${DELETED_LABEL}') AS peer_nickname FROM driver_contact_preferences c LEFT JOIN driver_profiles p ON p.user_id=c.target_user_id WHERE c.user_id=? ORDER BY c.updated_at`, userId);
  const communities = rowsIf(db, "driver_community_members", `SELECT c.community_key,c.title,c.visibility,c.category,c.country_code,m.role,m.favorite,m.joined_at FROM driver_community_members m JOIN driver_communities c ON c.id=m.community_id WHERE m.user_id=? ORDER BY m.joined_at`, userId);
  const chatMessages = rowsIf(db, "chat_messages", `SELECT m.id,m.room_id,m.body,m.created_at,mm.edited_at,mm.deleted_at,mm.expires_at,mm.reply_to_message_id,mm.forwarded_from_message_id FROM chat_messages m LEFT JOIN chat_message_meta mm ON mm.message_id=m.id WHERE m.sender_id=? ORDER BY m.id`, userId);
  const chatAttachments = rowsIf(db, "chat_message_attachments", `SELECT a.message_id,a.kind,a.file_name,a.mime_type,a.byte_length,a.duration_ms,a.created_at FROM chat_message_attachments a JOIN chat_messages m ON m.id=a.message_id WHERE m.sender_id=? ORDER BY a.id`, userId);
  const chatUploads = rowsIf(db, "chat_uploads", `SELECT id,room_id,kind,file_name,mime_type,byte_length,duration_ms,state,created_at,expires_at FROM chat_uploads WHERE user_id=? ORDER BY created_at`, userId);
  const chatDrafts = rowsIf(db, "chat_drafts", "SELECT room_id,body,reply_to_message_id,updated_at FROM chat_drafts WHERE user_id=? ORDER BY room_id", userId);
  const chatReactions = rowsIf(db, "chat_message_reactions_v2", "SELECT message_id,reaction,created_at FROM chat_message_reactions_v2 WHERE user_id=? ORDER BY message_id,reaction", userId);
  const radioTransmissions = rowsIf(db, "radio_transmissions", `SELECT id,channel_id,state,mime_type,byte_length,created_at,committed_at,expires_at FROM radio_transmissions WHERE sender_id=? ORDER BY id`, userId);
  const radioSettings = oneIf(db, "radio_user_settings", "SELECT status,solo_channel_id,default_channel_id,auto_play,playback_rate,updated_at FROM radio_user_settings WHERE user_id=?", userId);
  const roadReports = rowsIf(db, "road_reports", "SELECT id,type,lane,latitude,longitude,created_at,expires_at,closed_at FROM road_reports WHERE author_id=? ORDER BY id", userId);
  const roadVotes = rowsIf(db, "road_report_votes", "SELECT report_id,status,updated_at FROM road_report_votes WHERE user_id=? ORDER BY report_id", userId);
  const parkingReviews = rowsIf(db, "parking_reviews", "SELECT place_id,overall,security,cleanliness,access_rating,quietness,text,visited_at,created_at,updated_at FROM parking_reviews WHERE user_id=? ORDER BY place_id", userId);
  const parkingFavorites = rowsIf(db, "parking_favorites", "SELECT place_id,created_at FROM parking_favorites WHERE user_id=? ORDER BY place_id", userId);
  const parkingPreferences = oneIf(db, "parking_user_preferences", `SELECT vehicle_class,length_m,height_m,weight_t,adr_required,refrigerated,secure_only,max_detour_km,updated_at FROM parking_user_preferences WHERE user_id=?`, userId);
  const parkingOccupancy = rowsIf(db, "parking_occupancy_observations", `SELECT place_id,status,free_spots,total_spots,note,observed_at,expires_at,created_at FROM parking_occupancy_observations WHERE user_id=? ORDER BY id`, userId);
  const parkingCorrections = rowsIf(db, "parking_corrections", "SELECT place_id,kind,message,proposed_json,state,created_at,resolved_at FROM parking_corrections WHERE user_id=? ORDER BY id", userId).map((row) => ({ ...row, proposed_json: parseJson(row.proposed_json) }));
  const parkingPhotos = rowsIf(db, "parking_photos", "SELECT id,place_id,mime_type,byte_length,file_name,state,created_at FROM parking_photos WHERE uploader_id=? ORDER BY id", userId);
  const eventPreferences = oneIf(db, "driver_event_preferences", `SELECT enabled,driving_mode,quiet_enabled,quiet_start,quiet_end,timezone,show_previews,in_app_popups,updated_at FROM driver_event_preferences WHERE user_id=?`, userId);
  const eventCategoryPreferences = rowsIf(db, "driver_event_category_preferences", `SELECT category,inbox_enabled,push_enabled,min_priority,updated_at FROM driver_event_category_preferences WHERE user_id=? ORDER BY category`, userId);
  const eventSourceOverrides = rowsIf(db, "driver_event_source_overrides", `SELECT source_kind,source_id,mode,updated_at FROM driver_event_source_overrides WHERE user_id=? ORDER BY source_kind,source_id`, userId);
  const events = rowsIf(db, "driver_events", `SELECT id,event_type,category,priority,source_kind,source_id,title,preview,route_json,data_json,dedupe_key,occurrence_count,created_at,updated_at,read_at,archived_at,snoozed_until,expires_at FROM driver_events WHERE user_id=? ORDER BY id`, userId).map((row) => ({ ...row, route_json: parseJson(row.route_json), data_json: parseJson(row.data_json) }));
  const pushSubscriptions = rowsIf(db, "driver_push_subscriptions", `SELECT endpoint,user_agent,created_at,updated_at,last_success_at,failure_count,revoked_at FROM driver_push_subscriptions WHERE user_id=? ORDER BY id`, userId).map((row) => ({ endpointHost: endpointHost(row.endpoint), userAgent: row.user_agent, createdAt: row.created_at, updatedAt: row.updated_at, lastSuccessAt: row.last_success_at, failureCount: Number(row.failure_count || 0), revokedAt: row.revoked_at }));
  const auditEvents = rowsIf(db, "audit_events", `SELECT created_at,event_type,success,source_ip,user_agent,CASE WHEN target_user_id IS NULL THEN 0 ELSE 1 END AS has_target FROM audit_events WHERE user_id=? OR target_user_id=? ORDER BY id`, userId, userId);
  return {
    format: "PATAP-ACCOUNT-EXPORT-1", generatedAt: nowIso(), account,
    driver: { profile, location, relationships, blocks }, people: { settings: peopleSettings, contactPreferences, communities },
    chat: { messages: chatMessages, attachments: chatAttachments, uploads: chatUploads, drafts: chatDrafts, reactions: chatReactions },
    radio: { settings: radioSettings, transmissions: radioTransmissions }, roadReports: { reports: roadReports, votes: roadVotes },
    parking: { preferences: parkingPreferences, reviews: parkingReviews, favorites: parkingFavorites, occupancy: parkingOccupancy, corrections: parkingCorrections, photos: parkingPhotos },
    events: { preferences: eventPreferences, categories: eventCategoryPreferences, sourceOverrides: eventSourceOverrides, inbox: events, pushSubscriptions },
    securityHistory: { sessions, auditEvents },
    exportPolicy: { binaryMediaEmbedded: false, excludedSecrets: ["password_hash", "session_id", "csrf_token", "password_reset_token", "push_p256dh", "push_auth", "upload_token", "storage_key"] }
  };
}

function collectMedia(db, userId, dataDir) {
  const items = [];
  const seen = new Set();
  function add(kind, root, key) { const file = safeStorageFile(root, key); if (!file) return; const identity = `${kind}:${file}`; if (seen.has(identity)) return; seen.add(identity); items.push({ kind, file }); }
  if (tableExists(db, "chat_uploads")) for (const row of db.prepare("SELECT storage_key FROM chat_uploads WHERE user_id=?").all(userId)) add("chat", path.join(dataDir, "chat"), row.storage_key);
  if (tableExists(db, "radio_transmissions")) for (const row of db.prepare("SELECT storage_key FROM radio_transmissions WHERE sender_id=? AND storage_key IS NOT NULL AND storage_key!=''").all(userId)) add("radio", path.join(dataDir, "radio"), row.storage_key);
  if (tableExists(db, "parking_photos")) for (const row of db.prepare("SELECT storage_key FROM parking_photos WHERE uploader_id=?").all(userId)) add("parking", path.join(dataDir, "parking"), row.storage_key);
  return items;
}

function quarantineMedia(items) {
  const quarantined = [];
  try {
    for (const item of items) { if (!fs.existsSync(item.file)) continue; const stat = fs.lstatSync(item.file); if (!stat.isFile()) throw new Error(`account_media_not_regular_file:${item.kind}`); const pending = `${item.file}.account-delete-${crypto.randomUUID()}.pending`; fs.renameSync(item.file, pending); quarantined.push({ ...item, pending }); }
    return quarantined;
  } catch (error) { for (const item of quarantined.reverse()) { try { if (fs.existsSync(item.pending) && !fs.existsSync(item.file)) fs.renameSync(item.pending, item.file); } catch {} } throw error; }
}
function restoreQuarantine(items) { for (const item of [...items].reverse()) { try { if (fs.existsSync(item.pending) && !fs.existsSync(item.file)) fs.renameSync(item.pending, item.file); } catch {} } }
function removeQuarantine(items) { let removed = 0; let pending = 0; for (const item of items) { try { fs.rmSync(item.pending, { force: true }); removed += 1; } catch { pending += 1; } } return { removed, pending }; }

function deleteAccountData(db, userId, { nowIso = () => new Date().toISOString(), dataDir } = {}) {
  ensureAccountSchema(db, nowIso());
  const user = plain(db.prepare("SELECT * FROM users WHERE id=?").get(userId));
  if (!user || db.prepare("SELECT 1 FROM account_tombstones WHERE user_id=?").get(userId)) return { error: "account_not_found", status: 404 };
  const ownership = accountOwnershipBlockers(db, userId);
  if (ownership.principalOwner) return { error: "principal_owner_protected", status: 403, ownership };
  if (ownership.chatGroups || ownership.communities || ownership.radioGroups) return { error: "account_ownership_transfer_required", status: 409, ownership };
  if (!dataDir) throw new Error("account_data_dir_required");
  const media = collectMedia(db, userId, dataDir);
  let quarantined;
  try { quarantined = quarantineMedia(media); } catch (error) { return { error: "account_media_cleanup_failed", status: 500, detail: String(error.message || error) }; }
  const now = nowIso();
  const token = crypto.randomBytes(12).toString("hex");
  const tombstoneUsername = `deleted_${token}`;
  const tombstoneEmail = `deleted+${token}@deleted.invalid`;
  const tombstonePassword = `deleted$${crypto.randomBytes(32).toString("hex")}`;
  const tombstoneNickname = `${DELETED_LABEL} ${token.slice(0, 8)}`;
  const tombstoneNicknameKey = tombstoneNickname.toLocaleLowerCase("und");
  const hadProfile = tableExists(db, "driver_profiles") && Boolean(db.prepare("SELECT 1 FROM driver_profiles WHERE user_id=?").get(userId));
  db.exec("BEGIN IMMEDIATE");
  try {
    const messageIds = tableExists(db, "chat_messages") ? db.prepare("SELECT id FROM chat_messages WHERE sender_id=? ORDER BY id").all(userId).map((row) => Number(row.id)) : [];
    const radioIds = tableExists(db, "radio_transmissions") ? db.prepare("SELECT id FROM radio_transmissions WHERE sender_id=?").all(userId).map((row) => Number(row.id)) : [];
    if (tableExists(db, "driver_event_outbox")) {
      const idText = String(userId);
      db.prepare(`DELETE FROM driver_event_outbox WHERE (event_kind='RELATIONSHIP' AND (source_ref LIKE ? OR source_ref LIKE ?)) OR (event_kind IN ('COMMUNITY_INVITE','COMMUNITY_ROLE','COMMUNITY_BAN') AND source_ref LIKE ?)`).run(`${idText}:%`, `%:${idText}`, `%:${idText}`);
      if (messageIds.length) { const placeholders = messageIds.map(() => "?").join(","); db.prepare(`DELETE FROM driver_event_outbox WHERE event_kind='CHAT_MESSAGE' AND source_ref IN (${placeholders})`).run(...messageIds.map(String)); }
      if (radioIds.length) { const placeholders = radioIds.map(() => "?").join(","); db.prepare(`DELETE FROM driver_event_outbox WHERE event_kind='RADIO_TRANSMISSION' AND source_ref IN (${placeholders})`).run(...radioIds.map(String)); }
    }
    if (tableExists(db, "driver_events")) { db.prepare("DELETE FROM driver_events WHERE user_id=?").run(userId); db.prepare(`UPDATE driver_events SET actor_user_id=NULL,source_id='deleted',title='Событие пользователя',preview='',route_json='{}',data_json='{}',dedupe_key=NULL WHERE actor_user_id=?`).run(userId); }
    runIf(db, "driver_event_preferences", "DELETE FROM driver_event_preferences WHERE user_id=?", userId);
    runIf(db, "driver_event_category_preferences", "DELETE FROM driver_event_category_preferences WHERE user_id=?", userId);
    runIf(db, "driver_event_source_overrides", "DELETE FROM driver_event_source_overrides WHERE user_id=?", userId);
    runIf(db, "driver_push_subscriptions", "DELETE FROM driver_push_subscriptions WHERE user_id=?", userId);
    if (tableExists(db, "chat_uploads")) { if (tableExists(db, "chat_message_attachments")) db.prepare("DELETE FROM chat_message_attachments WHERE storage_key IN (SELECT storage_key FROM chat_uploads WHERE user_id=?)").run(userId); db.prepare("DELETE FROM chat_uploads WHERE user_id=?").run(userId); }
    if (messageIds.length) {
      const placeholders = messageIds.map(() => "?").join(",");
      if (tableExists(db, "chat_message_meta")) { const tombstoneMessage = db.prepare(`INSERT INTO chat_message_meta(message_id,deleted_at) VALUES(?,?) ON CONFLICT(message_id) DO UPDATE SET deleted_at=COALESCE(chat_message_meta.deleted_at,excluded.deleted_at)`); for (const messageId of messageIds) tombstoneMessage.run(messageId, now); db.prepare(`UPDATE chat_messages SET body=? WHERE id IN (SELECT mm.message_id FROM chat_message_meta mm WHERE mm.forwarded_from_message_id IN (${placeholders})) AND sender_id<>?`).run(FORWARDED_DELETED_LABEL, ...messageIds, userId); }
      runIf(db, "chat_message_attachments", `DELETE FROM chat_message_attachments WHERE message_id IN (${placeholders})`, ...messageIds);
      runIf(db, "chat_polls", `DELETE FROM chat_polls WHERE message_id IN (${placeholders})`, ...messageIds);
      runIf(db, "chat_message_reactions_v2", `DELETE FROM chat_message_reactions_v2 WHERE message_id IN (${placeholders}) OR user_id=?`, ...messageIds, userId);
      runIf(db, "chat_message_reactions", `DELETE FROM chat_message_reactions WHERE message_id IN (${placeholders}) OR user_id=?`, ...messageIds, userId);
      runIf(db, "chat_message_mentions", `DELETE FROM chat_message_mentions WHERE message_id IN (${placeholders}) OR user_id=?`, ...messageIds, userId);
      runIf(db, "chat_room_pins", `DELETE FROM chat_room_pins WHERE message_id IN (${placeholders}) OR pinned_by=?`, ...messageIds, userId);
      db.prepare(`UPDATE chat_messages SET body='' WHERE id IN (${placeholders})`).run(...messageIds);
    } else {
      runIf(db, "chat_message_reactions_v2", "DELETE FROM chat_message_reactions_v2 WHERE user_id=?", userId); runIf(db, "chat_message_reactions", "DELETE FROM chat_message_reactions WHERE user_id=?", userId); runIf(db, "chat_message_mentions", "DELETE FROM chat_message_mentions WHERE user_id=?", userId); runIf(db, "chat_room_pins", "DELETE FROM chat_room_pins WHERE pinned_by=?", userId);
    }
    runIf(db, "chat_poll_votes", "DELETE FROM chat_poll_votes WHERE user_id=?", userId); runIf(db, "chat_hidden_messages", "DELETE FROM chat_hidden_messages WHERE user_id=?", userId); runIf(db, "chat_drafts", "DELETE FROM chat_drafts WHERE user_id=?", userId); runIf(db, "chat_room_member_state", "DELETE FROM chat_room_member_state WHERE user_id=?", userId); runIf(db, "chat_room_members", "DELETE FROM chat_room_members WHERE user_id=?", userId);
    if (tableExists(db, "chat_direct_pairs")) db.prepare("DELETE FROM chat_direct_pairs WHERE first_user_id=? OR second_user_id=?").run(userId, userId);
    runIf(db, "chat_room_invites", "DELETE FROM chat_room_invites WHERE target_user_id=?", userId); runIf(db, "chat_room_invites", "UPDATE chat_room_invites SET invited_by=NULL WHERE invited_by=?", userId); runIf(db, "chat_room_bans", "DELETE FROM chat_room_bans WHERE user_id=?", userId); runIf(db, "chat_room_bans", "UPDATE chat_room_bans SET blocked_by=NULL WHERE blocked_by=?", userId); runIf(db, "chat_rooms", "UPDATE chat_rooms SET created_by=NULL WHERE created_by=?", userId); runIf(db, "chat_room_profiles", "UPDATE chat_room_profiles SET created_by=NULL WHERE created_by=?", userId);
    runIf(db, "radio_channel_pins", "UPDATE radio_channel_pins SET pinned_by=NULL WHERE pinned_by=?", userId); runIf(db, "radio_channel_profiles", "UPDATE radio_channel_profiles SET created_by=NULL WHERE created_by=?", userId); runIf(db, "radio_channel_invites", "DELETE FROM radio_channel_invites WHERE target_user_id=?", userId); runIf(db, "radio_channel_invites", "UPDATE radio_channel_invites SET invited_by=NULL WHERE invited_by=?", userId); runIf(db, "radio_channel_bans", "DELETE FROM radio_channel_bans WHERE user_id=?", userId); runIf(db, "radio_channel_bans", "UPDATE radio_channel_bans SET blocked_by=NULL WHERE blocked_by=?", userId); runIf(db, "radio_channel_alerts", "DELETE FROM radio_channel_alerts WHERE sender_id=?", userId); runIf(db, "radio_user_settings", "DELETE FROM radio_user_settings WHERE user_id=?", userId); runIf(db, "radio_speaker_leases", "DELETE FROM radio_speaker_leases WHERE speaker_id=?", userId); runIf(db, "radio_transmissions", "DELETE FROM radio_transmissions WHERE sender_id=?", userId); runIf(db, "radio_channel_member_state", "DELETE FROM radio_channel_member_state WHERE user_id=?", userId); runIf(db, "radio_channel_members", "DELETE FROM radio_channel_members WHERE user_id=?", userId);
    if (tableExists(db, "radio_direct_pairs")) db.prepare("DELETE FROM radio_direct_pairs WHERE first_user_id=? OR second_user_id=?").run(userId, userId);
    if (tableExists(db, "driver_contact_preferences")) db.prepare("DELETE FROM driver_contact_preferences WHERE user_id=? OR target_user_id=?").run(userId, userId);
    runIf(db, "driver_community_members", "DELETE FROM driver_community_members WHERE user_id=?", userId); runIf(db, "driver_community_invites", "DELETE FROM driver_community_invites WHERE target_user_id=?", userId); runIf(db, "driver_community_invites", "UPDATE driver_community_invites SET invited_by=NULL WHERE invited_by=?", userId); runIf(db, "driver_community_bans", "DELETE FROM driver_community_bans WHERE user_id=?", userId); runIf(db, "driver_community_bans", "UPDATE driver_community_bans SET blocked_by=NULL WHERE blocked_by=?", userId); runIf(db, "driver_communities", "UPDATE driver_communities SET created_by=NULL WHERE created_by=?", userId);
    runIf(db, "parking_places", "UPDATE parking_places SET created_by=NULL WHERE created_by=?", userId); runIf(db, "parking_occupancy_observations", "UPDATE parking_occupancy_observations SET user_id=NULL,note='' WHERE user_id=?", userId); runIf(db, "parking_reviews", "DELETE FROM parking_reviews WHERE user_id=?", userId); runIf(db, "parking_favorites", "DELETE FROM parking_favorites WHERE user_id=?", userId); runIf(db, "parking_user_preferences", "DELETE FROM parking_user_preferences WHERE user_id=?", userId); runIf(db, "parking_corrections", "UPDATE parking_corrections SET user_id=NULL,message='',proposed_json='{}' WHERE user_id=?", userId); runIf(db, "parking_photos", "DELETE FROM parking_photos WHERE uploader_id=?", userId);
    runIf(db, "road_reports", "UPDATE road_reports SET author_id=NULL WHERE author_id=?", userId); runIf(db, "road_report_votes", "DELETE FROM road_report_votes WHERE user_id=?", userId);
    if (tableExists(db, "driver_relationships")) db.prepare("DELETE FROM driver_relationships WHERE requester_id=? OR target_id=?").run(userId, userId);
    if (tableExists(db, "driver_blocks")) db.prepare("DELETE FROM driver_blocks WHERE blocker_id=? OR blocked_id=?").run(userId, userId);
    runIf(db, "driver_locations", "DELETE FROM driver_locations WHERE user_id=?", userId);
    if (tableExists(db, "driver_profiles") && (hadProfile || messageIds.length)) {
      db.prepare(`INSERT INTO driver_profiles(user_id,nickname,nickname_key,driver_type,real_name,vehicle,language,country,city,created_at,updated_at,gps_enabled,country_code) VALUES(?,?,?,'GENERAL',NULL,NULL,NULL,NULL,NULL,?,?,0,NULL) ON CONFLICT(user_id) DO UPDATE SET nickname=excluded.nickname,nickname_key=excluded.nickname_key,driver_type='GENERAL',real_name=NULL,vehicle=NULL,language=NULL,country=NULL,city=NULL,created_at=excluded.created_at,updated_at=excluded.updated_at,gps_enabled=0,country_code=NULL`).run(userId, tombstoneNickname, tombstoneNicknameKey, now, now);
      if (tableExists(db, "driver_people_settings")) db.prepare(`INSERT INTO driver_people_settings(user_id,discoverability,nearby_visibility,contact_requests,community_invites,vehicle_visibility,updated_at) VALUES(?,'HIDDEN','NOBODY','NOBODY','NOBODY','NOBODY',?) ON CONFLICT(user_id) DO UPDATE SET discoverability='HIDDEN',nearby_visibility='NOBODY',contact_requests='NOBODY',community_invites='NOBODY',vehicle_visibility='NOBODY',updated_at=excluded.updated_at`).run(userId, now);
    } else { runIf(db, "driver_people_settings", "DELETE FROM driver_people_settings WHERE user_id=?", userId); runIf(db, "driver_profiles", "DELETE FROM driver_profiles WHERE user_id=?", userId); }
    runIf(db, "password_reset_tokens", "DELETE FROM password_reset_tokens WHERE user_id=?", userId); runIf(db, "sessions", "DELETE FROM sessions WHERE user_id=?", userId);
    if (tableExists(db, "rate_limits")) db.prepare("DELETE FROM rate_limits WHERE key LIKE ? OR key=? OR key=?").run(`%:user:${userId}`, `login:id:${user.username}`, `login:id:${user.email}`);
    if (tableExists(db, "audit_events")) db.prepare("DELETE FROM audit_events WHERE user_id=? OR target_user_id=? OR details LIKE ? OR details LIKE ?").run(userId, userId, `%${user.username}%`, `%${user.email}%`);
    db.prepare("INSERT INTO account_tombstones(user_id,deleted_at) VALUES(?,?)").run(userId, now);
    db.prepare(`UPDATE users SET username=?,email=?,password_hash=?,role='User',disabled=1,failed_login_count=0,locked_until=NULL,created_at=?,updated_at=?,last_login_at=NULL,last_seen_at=NULL WHERE id=?`).run(tombstoneUsername, tombstoneEmail, tombstonePassword, now, now, userId);
    const fkProblems = db.prepare("PRAGMA foreign_key_check").all(); if (fkProblems.length) throw new Error(`account_delete_foreign_key_check_failed:${fkProblems.length}`);
    db.exec("COMMIT");
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} restoreQuarantine(quarantined); throw error; }
  const mediaCleanup = removeQuarantine(quarantined);
  return { deleted: true, deletedAt: now, mediaCleanup, ownership };
}

module.exports = { DELETED_LABEL, FORWARDED_DELETED_LABEL, tableExists, safeStorageFile, cleanupDeletionQuarantine, accountOwnershipBlockers, exportAccountData, deleteAccountData };
