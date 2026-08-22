const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("../auth/db");
const { createPeopleRepository } = require("./repository");
const { createCommunityLinkGuard } = require("./guard");
const { LOCATION_PRECISION } = require("./location-disclosure");

function coarsenDistance(distanceKm, precision) {
  const distance = Number(distanceKm);
  if (!Number.isFinite(distance)) return null;
  if (precision === LOCATION_PRECISION.PRECISE) return Number(distance.toFixed(1));
  if (precision === LOCATION_PRECISION.CONTACT_APPROXIMATE) return Math.max(0.5, Math.round(distance * 2) / 2);
  if (precision === LOCATION_PRECISION.PUBLIC_APPROXIMATE) return Math.max(1, Math.round(distance / 2) * 2);
  return null;
}

function createPeopleRoutes(options) {
  const people = createPeopleRepository(options.db, { nowIso: options.nowIso, addMinutes: options.addMinutes });
  const guardCommunityLinks = createCommunityLinkGuard(options);
  const dataDir = options.dataDir || DATA_DIR;

  function respond(res, status, payload) {
    options.json(res, status, payload);
    return true;
  }

  function requireUser(req, res) {
    const session = options.requireSession(req, res);
    if (!session) return null;
    if (!options.db.prepare("SELECT 1 FROM driver_profiles WHERE user_id=?").get(session.user.id)) {
      respond(res, 409, { error:"driver_profile_required" });
      return null;
    }
    people.privacy.ensureSettings(session.user.id, options.nowIso());
    return session;
  }

  function requireMutation(req, res, rateKey = null, limit = 30, windowMinutes = 1) {
    const session = requireUser(req, res);
    if (!session || !options.requireCsrf(req, res, session)) return null;
    if (rateKey && !options.checkRate(`people:${rateKey}:user:${session.user.id}`, limit, windowMinutes)) {
      respond(res, 429, { error:"people_rate_limited" });
      return null;
    }
    return session;
  }

  function result(res, value, successStatus = 200) {
    if (!value) return respond(res, 500, { error:"people_action_failed" });
    if (value.error) return respond(res, value.status || 400, { error:value.error });
    return respond(res, successStatus, value);
  }

  function sanitizeNearby(userId, value) {
    if (!value || value.error || !Array.isArray(value.people) || value.people.length === 0) return value;
    const nicknames = [...new Set(value.people.map((item) => item.nickname).filter(Boolean))];
    if (!nicknames.length) return { ...value, people: [] };
    const placeholders = nicknames.map(() => "?").join(",");
    const ids = new Map(options.db.prepare(`SELECT user_id,nickname FROM driver_profiles WHERE nickname IN (${placeholders})`)
      .all(...nicknames).map((row) => [row.nickname, Number(row.user_id)]));
    return {
      ...value,
      people: value.people.map((person) => {
        const targetId = ids.get(person.nickname);
        if (!targetId) return null;
        const precision = people.privacy.nearbyPrecision(userId, targetId);
        if (precision === LOCATION_PRECISION.NONE) return null;
        return {
          ...person,
          locationPrecision: precision,
          distanceKm: coarsenDistance(person.distanceKm, precision)
        };
      }).filter(Boolean)
    };
  }

  function removeStorage(keys, folder) {
    for (const key of new Set((keys || []).filter(Boolean))) {
      try { fs.rmSync(path.join(dataDir, folder, key), { force:true }); } catch {}
    }
  }

  return async function handlePeopleRoute(req, res, url, body) {
    if (await guardCommunityLinks(req, res, url, body)) return true;
    if (!url.pathname.startsWith("/api/driver/people")) return false;

    if (req.method === "GET" && url.pathname === "/api/driver/people/overview") {
      const session = requireUser(req,res); if (!session) return true;
      return respond(res,200,people.overview(session.user.id));
    }

    if (req.method === "GET" && url.pathname === "/api/driver/people/search") {
      const session = requireUser(req,res); if (!session) return true;
      const drivers = people.searchPeople(session.user.id, {
        query:url.searchParams.get("q") || "",
        driverType:url.searchParams.get("type") || "",
        countryCode:url.searchParams.get("country") || "",
        limit:Number(url.searchParams.get("limit") || 30)
      });
      return respond(res,200,{ drivers });
    }

    if (req.method === "GET" && url.pathname === "/api/driver/people/nearby") {
      const session = requireUser(req,res); if (!session) return true;
      return result(res,sanitizeNearby(session.user.id,people.nearbyPeople(session.user.id,Number(url.searchParams.get("radius") || 25))));
    }

    if (req.method === "GET" && url.pathname === "/api/driver/people/communities/discover") {
      const session = requireUser(req,res); if (!session) return true;
      const communities = people.discoverCommunities(session.user.id, {
        query:url.searchParams.get("q") || "",
        category:url.searchParams.get("category") || "",
        countryCode:url.searchParams.get("country") || ""
      });
      return respond(res,200,{ communities });
    }

    const personMatch = url.pathname.match(/^\/api\/driver\/people\/drivers\/([^/]+)$/);
    if (req.method === "GET" && personMatch) {
      const session = requireUser(req,res); if (!session) return true;
      const person = people.getPerson(session.user.id,decodeURIComponent(personMatch[1]));
      return person ? respond(res,200,{ person }) : respond(res,404,{ error:"driver_not_found" });
    }

    const communityMatch = url.pathname.match(/^\/api\/driver\/people\/communities\/(\d+)$/);
    if (req.method === "GET" && communityMatch) {
      const session = requireUser(req,res); if (!session) return true;
      const id = Number(communityMatch[1]);
      const row = people.communityRow(id);
      if (!row) return respond(res,404,{ error:"community_not_found" });
      const community = people.communityForUser(session.user.id,row);
      if (!community || (!community.joined && community.visibility !== "PUBLIC")) return respond(res,404,{ error:"community_not_found" });
      if (!community.joined) return respond(res,200,{ community,members:[],bans:[] });
      return result(res,people.listCommunityMembers(session.user.id,id));
    }

    if (body === undefined) return false;

    if (req.method === "PATCH" && url.pathname === "/api/driver/people/settings") {
      const session = requireMutation(req,res,"settings",20,1); if (!session) return true;
      const settings = people.privacy.updateSettings(session.user.id,body,options.nowIso());
      if (!settings.error) options.audit(req,"people_settings_updated",{userId:session.user.id,success:true});
      return result(res,settings);
    }

    const prefMatch = url.pathname.match(/^\/api\/driver\/people\/contacts\/([^/]+)\/preferences$/);
    if (req.method === "PATCH" && prefMatch) {
      const session = requireMutation(req,res,"contact-pref",60,1); if (!session) return true;
      const value = people.setContactPreferences(session.user.id,decodeURIComponent(prefMatch[1]),body,options.nowIso());
      if (!value.error) options.audit(req,"people_contact_preferences_updated",{userId:session.user.id,success:true});
      return result(res,value);
    }

    if (req.method === "POST" && url.pathname === "/api/driver/people/communities") {
      const session = requireMutation(req,res,"community-create",8,60); if (!session) return true;
      const value = people.createCommunity(session.user.id,body,options.nowIso());
      if (!value.error) options.audit(req,"community_created",{userId:session.user.id,success:true,details:{communityId:value.community.id,visibility:value.community.visibility,category:value.community.category}});
      return result(res,value,201);
    }

    if (req.method === "PATCH" && communityMatch) {
      const session = requireMutation(req,res,"community-update",30,5); if (!session) return true;
      const value = people.updateCommunity(session.user.id,Number(communityMatch[1]),body,options.nowIso());
      if (!value.error) options.audit(req,"community_updated",{userId:session.user.id,success:true,details:{communityId:Number(communityMatch[1])}});
      return result(res,value);
    }

    if (req.method === "DELETE" && communityMatch) {
      const session = requireMutation(req,res,"community-delete",5,60); if (!session) return true;
      const id = Number(communityMatch[1]);
      const value = people.deleteCommunity(session.user.id,id);
      if (value.error) return result(res,value);
      removeStorage(value.chatStorageKeys,"chat");
      removeStorage(value.radioStorageKeys,"radio");
      options.audit(req,"community_deleted",{userId:session.user.id,success:true,details:{communityId:id}});
      return respond(res,200,{ deleted:true });
    }

    const joinMatch = url.pathname.match(/^\/api\/driver\/people\/communities\/(\d+)\/join$/);
    if (req.method === "POST" && joinMatch) {
      const session = requireMutation(req,res,"community-join",30,10); if (!session) return true;
      const value = people.joinCommunity(session.user.id,Number(joinMatch[1]),options.nowIso());
      if (!value.error) options.audit(req,"community_joined",{userId:session.user.id,success:true,details:{communityId:Number(joinMatch[1])}});
      return result(res,value);
    }

    const inviteMatch = url.pathname.match(/^\/api\/driver\/people\/communities\/(\d+)\/invites$/);
    if (req.method === "POST" && inviteMatch) {
      const session = requireMutation(req,res,"community-invite",40,10); if (!session) return true;
      const value = people.inviteToCommunity(session.user.id,Number(inviteMatch[1]),body?.nickname,options.nowIso());
      if (!value.error) options.audit(req,"community_invited",{userId:session.user.id,success:true,details:{communityId:Number(inviteMatch[1])}});
      return result(res,value);
    }

    const inviteResponseMatch = url.pathname.match(/^\/api\/driver\/people\/community-invites\/(\d+)\/respond$/);
    if (req.method === "POST" && inviteResponseMatch) {
      const session = requireMutation(req,res,"community-invite-response",50,10); if (!session) return true;
      const value = people.respondToCommunityInvite(session.user.id,Number(inviteResponseMatch[1]),body?.action,options.nowIso());
      if (!value.error) options.audit(req,value.accepted?"community_invite_accepted":"community_invite_declined",{userId:session.user.id,success:true,details:{communityId:Number(inviteResponseMatch[1])}});
      return result(res,value);
    }

    const roleMatch = url.pathname.match(/^\/api\/driver\/people\/communities\/(\d+)\/members\/([^/]+)$/);
    if (req.method === "PATCH" && roleMatch) {
      const session = requireMutation(req,res,"community-role",30,5); if (!session) return true;
      const value = people.setCommunityRole(session.user.id,Number(roleMatch[1]),decodeURIComponent(roleMatch[2]),body?.role);
      if (!value.error) options.audit(req,"community_member_role_changed",{userId:session.user.id,success:true,details:{communityId:Number(roleMatch[1]),role:value.role}});
      return result(res,value);
    }

    if (req.method === "DELETE" && roleMatch) {
      const session = requireMutation(req,res,"community-remove",30,5); if (!session) return true;
      const value = people.removeCommunityMember(session.user.id,Number(roleMatch[1]),decodeURIComponent(roleMatch[2]),{ban:Boolean(body?.ban)},options.nowIso());
      if (!value.error) options.audit(req,value.banned?"community_member_banned":"community_member_removed",{userId:session.user.id,success:true,details:{communityId:Number(roleMatch[1])}});
      return result(res,value);
    }

    const unbanMatch = url.pathname.match(/^\/api\/driver\/people\/communities\/(\d+)\/bans\/([^/]+)$/);
    if (req.method === "DELETE" && unbanMatch) {
      const session = requireMutation(req,res,"community-unban",30,5); if (!session) return true;
      return result(res,people.unbanCommunityMember(session.user.id,Number(unbanMatch[1]),decodeURIComponent(unbanMatch[2])));
    }

    const leaveMatch = url.pathname.match(/^\/api\/driver\/people\/communities\/(\d+)\/leave$/);
    if (req.method === "POST" && leaveMatch) {
      const session = requireMutation(req,res,"community-leave",20,5); if (!session) return true;
      const value = people.leaveCommunity(session.user.id,Number(leaveMatch[1]));
      if (!value.error) options.audit(req,"community_left",{userId:session.user.id,success:true,details:{communityId:Number(leaveMatch[1])}});
      return result(res,value);
    }

    const favoriteMatch = url.pathname.match(/^\/api\/driver\/people\/communities\/(\d+)\/preferences$/);
    if (req.method === "PATCH" && favoriteMatch && typeof body?.favorite === "boolean") {
      const session = requireMutation(req,res,"community-pref",60,1); if (!session) return true;
      return result(res,people.setCommunityFavorite(session.user.id,Number(favoriteMatch[1]),body.favorite));
    }

    return false;
  };
}

module.exports = { createPeopleRoutes, coarsenDistance };