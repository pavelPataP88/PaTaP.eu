const { ensurePeopleSchema } = require("./schema");
const { LOCATION_PRECISION } = require("./location-disclosure");

const DEFAULT_SETTINGS = Object.freeze({
  discoverability: "EVERYONE",
  nearbyVisibility: "EVERYONE",
  contactRequests: "EVERYONE",
  communityInvites: "CONTACTS",
  vehicleVisibility: "EVERYONE"
});

const DISCOVERY = new Set(["EVERYONE", "CONTACTS", "HIDDEN"]);
const NEARBY = new Set(["EVERYONE", "CONTACTS", "TRUSTED", "NOBODY"]);
const CONTACT_REQUESTS = new Set(["EVERYONE", "NOBODY"]);
const COMMUNITY_INVITES = new Set(["CONTACTS", "NOBODY"]);
const VEHICLE = new Set(["EVERYONE", "CONTACTS", "NOBODY"]);

function createPeoplePrivacy(db, { nowIso = () => new Date().toISOString() } = {}) {
  ensurePeopleSchema(db, nowIso());

  function isBlocked(leftUserId, rightUserId) {
    return Boolean(db.prepare(`SELECT 1 FROM driver_blocks
      WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`)
      .get(leftUserId, rightUserId, rightUserId, leftUserId));
  }

  function isContact(leftUserId, rightUserId) {
    return Boolean(db.prepare(`SELECT 1 FROM driver_relationships
      WHERE status = 'ACCEPTED' AND ((requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?))`)
      .get(leftUserId, rightUserId, rightUserId, leftUserId));
  }

  function preference(userId, targetUserId) {
    const row = db.prepare("SELECT favorite, trusted, private_note, updated_at FROM driver_contact_preferences WHERE user_id = ? AND target_user_id = ?")
      .get(userId, targetUserId);
    return row ? {
      favorite: Boolean(row.favorite), trusted: Boolean(row.trusted), privateNote: row.private_note || "", updatedAt: row.updated_at
    } : { favorite: false, trusted: false, privateNote: "", updatedAt: null };
  }

  function ensureSettings(userId, now = nowIso()) {
    db.prepare(`INSERT OR IGNORE INTO driver_people_settings(user_id, updated_at) VALUES(?, ?)`)
      .run(userId, now);
    const row = db.prepare("SELECT * FROM driver_people_settings WHERE user_id = ?").get(userId);
    return {
      discoverability: row?.discoverability || DEFAULT_SETTINGS.discoverability,
      nearbyVisibility: row?.nearby_visibility || DEFAULT_SETTINGS.nearbyVisibility,
      contactRequests: row?.contact_requests || DEFAULT_SETTINGS.contactRequests,
      communityInvites: row?.community_invites || DEFAULT_SETTINGS.communityInvites,
      vehicleVisibility: row?.vehicle_visibility || DEFAULT_SETTINGS.vehicleVisibility,
      updatedAt: row?.updated_at || now
    };
  }

  function updateSettings(userId, input, now = nowIso()) {
    const current = ensureSettings(userId, now);
    const next = {
      discoverability: input?.discoverability === undefined ? current.discoverability : String(input.discoverability).toUpperCase(),
      nearbyVisibility: input?.nearbyVisibility === undefined ? current.nearbyVisibility : String(input.nearbyVisibility).toUpperCase(),
      contactRequests: input?.contactRequests === undefined ? current.contactRequests : String(input.contactRequests).toUpperCase(),
      communityInvites: input?.communityInvites === undefined ? current.communityInvites : String(input.communityInvites).toUpperCase(),
      vehicleVisibility: input?.vehicleVisibility === undefined ? current.vehicleVisibility : String(input.vehicleVisibility).toUpperCase()
    };
    if (!DISCOVERY.has(next.discoverability) || !NEARBY.has(next.nearbyVisibility) ||
        !CONTACT_REQUESTS.has(next.contactRequests) || !COMMUNITY_INVITES.has(next.communityInvites) || !VEHICLE.has(next.vehicleVisibility)) {
      return { error: "invalid_people_settings", status: 400 };
    }
    db.prepare(`UPDATE driver_people_settings
      SET discoverability = ?, nearby_visibility = ?, contact_requests = ?, community_invites = ?, vehicle_visibility = ?, updated_at = ?
      WHERE user_id = ?`)
      .run(next.discoverability, next.nearbyVisibility, next.contactRequests, next.communityInvites, next.vehicleVisibility, now, userId);
    return { ...next, updatedAt: now };
  }

  function canDiscover(viewerId, targetId) {
    if (Number(viewerId) === Number(targetId)) return true;
    if (isBlocked(viewerId, targetId)) return false;
    if (isContact(viewerId, targetId)) return true;
    const mode = ensureSettings(targetId).discoverability;
    return mode === "EVERYONE";
  }

  function nearbyPrecision(viewerId, targetId) {
    if (Number(viewerId) === Number(targetId) || isBlocked(viewerId, targetId)) return LOCATION_PRECISION.NONE;
    const mode = ensureSettings(targetId).nearbyVisibility;
    if (mode === "NOBODY") return LOCATION_PRECISION.NONE;

    const contact = isContact(viewerId, targetId);
    const trustedByTarget = contact && preference(targetId, viewerId).trusted;
    if (mode === "TRUSTED") return trustedByTarget ? LOCATION_PRECISION.PRECISE : LOCATION_PRECISION.NONE;
    if (mode === "CONTACTS") {
      if (!contact) return LOCATION_PRECISION.NONE;
      return trustedByTarget ? LOCATION_PRECISION.PRECISE : LOCATION_PRECISION.CONTACT_APPROXIMATE;
    }
    if (mode === "EVERYONE") {
      if (trustedByTarget) return LOCATION_PRECISION.PRECISE;
      return contact ? LOCATION_PRECISION.CONTACT_APPROXIMATE : LOCATION_PRECISION.PUBLIC_APPROXIMATE;
    }
    return LOCATION_PRECISION.NONE;
  }

  function canSeeNearby(viewerId, targetId) {
    return nearbyPrecision(viewerId, targetId) !== LOCATION_PRECISION.NONE;
  }

  function canOpenCard(viewerId, targetId) {
    if (Number(viewerId) === Number(targetId)) return true;
    if (isBlocked(viewerId, targetId)) {
      return Boolean(db.prepare("SELECT 1 FROM driver_blocks WHERE blocker_id = ? AND blocked_id = ?").get(viewerId, targetId));
    }
    return isContact(viewerId, targetId) || canDiscover(viewerId, targetId) || canSeeNearby(viewerId, targetId);
  }

  function canSeeVehicle(viewerId, targetId) {
    if (Number(viewerId) === Number(targetId)) return true;
    if (isBlocked(viewerId, targetId)) return false;
    const mode = ensureSettings(targetId).vehicleVisibility;
    return mode === "EVERYONE" || (mode === "CONTACTS" && isContact(viewerId, targetId));
  }

  function canRequestContact(viewerId, targetId) {
    if (Number(viewerId) === Number(targetId) || isBlocked(viewerId, targetId)) return false;
    if (isContact(viewerId, targetId)) return true;
    return ensureSettings(targetId).contactRequests === "EVERYONE";
  }

  function canInviteToCommunity(inviterId, targetId) {
    if (Number(inviterId) === Number(targetId) || isBlocked(inviterId, targetId)) return false;
    const mode = ensureSettings(targetId).communityInvites;
    return mode === "CONTACTS" && isContact(inviterId, targetId);
  }

  return {
    ensureSettings,
    updateSettings,
    preference,
    isBlocked,
    isContact,
    canDiscover,
    canOpenCard,
    nearbyPrecision,
    canSeeNearby,
    canSeeVehicle,
    canRequestContact,
    canInviteToCommunity
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  createPeoplePrivacy,
  DISCOVERY,
  NEARBY,
  CONTACT_REQUESTS,
  COMMUNITY_INVITES,
  VEHICLE,
  LOCATION_PRECISION
};
