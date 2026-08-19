function createCommunityLinkGuard({ db, json, requireSession, requireCsrf }) {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS people_community_link_private_ai
    AFTER INSERT ON driver_communities
    BEGIN
      UPDATE chat_room_profiles SET visibility='PRIVATE' WHERE room_id=NEW.chat_room_id;
      UPDATE radio_channel_profiles SET visibility='PRIVATE' WHERE channel_id=NEW.radio_channel_id;
    END;

    CREATE TRIGGER IF NOT EXISTS people_community_chat_private_au
    AFTER UPDATE OF visibility ON chat_room_profiles
    WHEN NEW.visibility!='PRIVATE' AND EXISTS(SELECT 1 FROM driver_communities c WHERE c.chat_room_id=NEW.room_id)
    BEGIN
      UPDATE chat_room_profiles SET visibility='PRIVATE' WHERE room_id=NEW.room_id;
    END;

    CREATE TRIGGER IF NOT EXISTS people_community_radio_private_au
    AFTER UPDATE OF visibility ON radio_channel_profiles
    WHEN NEW.visibility!='PRIVATE' AND EXISTS(SELECT 1 FROM driver_communities c WHERE c.radio_channel_id=NEW.channel_id)
    BEGIN
      UPDATE radio_channel_profiles SET visibility='PRIVATE' WHERE channel_id=NEW.channel_id;
    END;

    CREATE TRIGGER IF NOT EXISTS people_community_chat_invite_ai
    AFTER INSERT ON chat_room_invites
    WHEN EXISTS(SELECT 1 FROM driver_communities c WHERE c.chat_room_id=NEW.room_id)
    BEGIN
      DELETE FROM chat_room_invites WHERE room_id=NEW.room_id AND target_user_id=NEW.target_user_id;
    END;

    CREATE TRIGGER IF NOT EXISTS people_community_radio_invite_ai
    AFTER INSERT ON radio_channel_invites
    WHEN EXISTS(SELECT 1 FROM driver_communities c WHERE c.radio_channel_id=NEW.channel_id)
    BEGIN
      DELETE FROM radio_channel_invites WHERE channel_id=NEW.channel_id AND target_user_id=NEW.target_user_id;
    END;
  `);

  function linkedChatRoom(roomId) {
    return db.prepare("SELECT id,title FROM driver_communities WHERE chat_room_id=?").get(Number(roomId)) || null;
  }
  function linkedRadioChannel(channelId) {
    return db.prepare("SELECT id,title FROM driver_communities WHERE radio_channel_id=?").get(Number(channelId)) || null;
  }
  function requireDriver(req, res) {
    const session = requireSession(req, res);
    if (!session) return null;
    if (!db.prepare("SELECT 1 FROM driver_profiles WHERE user_id=?").get(session.user.id)) {
      json(res, 409, { error:"driver_profile_required" });
      return null;
    }
    return session;
  }
  function deny(req, res, link) {
    const session = requireDriver(req, res);
    if (!session) return true;
    if (!requireCsrf(req, res, session)) return true;
    json(res, 409, { error:"community_managed", communityId:Number(link.id), communityTitle:link.title });
    return true;
  }
  function escapeLike(value, maxLength) {
    const text = String(value || "").normalize("NFKC").trim().slice(0,maxLength);
    return `%${text.replaceAll("\\","\\\\").replaceAll("%","\\%").replaceAll("_","\\_")}%`;
  }

  function discoverStandaloneChat(req, res, url) {
    const session = requireDriver(req,res); if (!session) return true;
    const like=escapeLike(url.searchParams.get("q")||"",64);
    const groups=db.prepare(`SELECT r.id,r.title,gp.description,gp.history_policy,
        EXISTS(SELECT 1 FROM chat_room_members m WHERE m.room_id=r.id AND m.user_id=?) AS joined,
        (SELECT COUNT(*) FROM chat_room_members m WHERE m.room_id=r.id) AS member_count
      FROM chat_room_profiles gp JOIN chat_rooms r ON r.id=gp.room_id
      WHERE gp.visibility='PUBLIC' AND r.title LIKE ? ESCAPE '\\'
        AND NOT EXISTS(SELECT 1 FROM chat_room_bans b WHERE b.room_id=r.id AND b.user_id=?)
        AND NOT EXISTS(SELECT 1 FROM driver_communities c WHERE c.chat_room_id=r.id)
      ORDER BY joined DESC,member_count DESC,r.id DESC LIMIT 50`).all(session.user.id,like,session.user.id)
      .map((row)=>({id:Number(row.id),title:row.title,description:row.description,historyPolicy:row.history_policy,joined:Boolean(row.joined),memberCount:Number(row.member_count||0)}));
    json(res,200,{groups});return true;
  }

  function discoverStandaloneRadio(req,res,url) {
    const session=requireDriver(req,res);if(!session)return true;
    const like=escapeLike(url.searchParams.get("q")||"",48);
    const channels=db.prepare(`SELECT cp.channel_id,cp.title,cp.description,cp.talk_policy,
        EXISTS(SELECT 1 FROM radio_channel_members m WHERE m.channel_id=cp.channel_id AND m.user_id=?) AS joined,
        (SELECT COUNT(*) FROM radio_channel_members m WHERE m.channel_id=cp.channel_id) AS member_count
      FROM radio_channel_profiles cp
      WHERE cp.visibility='PUBLIC' AND cp.space_kind='GROUP' AND cp.title LIKE ? ESCAPE '\\'
        AND NOT EXISTS(SELECT 1 FROM radio_channel_bans b WHERE b.channel_id=cp.channel_id AND b.user_id=?)
        AND NOT EXISTS(SELECT 1 FROM driver_communities c WHERE c.radio_channel_id=cp.channel_id)
      ORDER BY joined DESC,member_count DESC,cp.title COLLATE NOCASE LIMIT 30`).all(session.user.id,like,session.user.id)
      .map((row)=>({id:Number(row.channel_id),title:row.title,description:row.description,talkPolicy:row.talk_policy,joined:Boolean(row.joined),memberCount:Number(row.member_count||0)}));
    json(res,200,{channels});return true;
  }

  return async function handleCommunityLinkGuard(req, res, url) {
    if(req.method==="GET"&&url.pathname==="/api/driver/chat/groups/discover")return discoverStandaloneChat(req,res,url);
    if(req.method==="GET"&&url.pathname==="/api/driver/radio/discover")return discoverStandaloneRadio(req,res,url);

    const chatMembershipPatterns = [
      /^\/api\/driver\/chat\/groups\/(\d+)\/(?:join|leave|invites)$/,
      /^\/api\/driver\/chat\/groups\/(\d+)\/members\/[^/]+$/,
      /^\/api\/driver\/chat\/groups\/(\d+)\/bans\/[^/]+$/,
      /^\/api\/driver\/chat\/invites\/(\d+)\/respond$/
    ];
    if (["POST","PUT","PATCH","DELETE"].includes(req.method)) {
      for (const pattern of chatMembershipPatterns) {
        const match = url.pathname.match(pattern);
        if (!match) continue;
        const link = linkedChatRoom(match[1]);
        if (!link) return false;
        return deny(req, res, link);
      }
      if (["PATCH","DELETE"].includes(req.method)) {
        const roomMatch = url.pathname.match(/^\/api\/driver\/chat\/rooms\/(\d+)$/);
        if (roomMatch) {
          const link = linkedChatRoom(roomMatch[1]);
          if (link) return deny(req, res, link);
        }
      }
    }

    const radioMembershipPatterns = [
      /^\/api\/driver\/radio\/channels\/(\d+)\/(?:join|leave|invites)$/,
      /^\/api\/driver\/radio\/channels\/(\d+)\/members\/[^/]+$/,
      /^\/api\/driver\/radio\/channels\/(\d+)\/bans\/[^/]+$/,
      /^\/api\/driver\/radio\/invites\/(\d+)\/respond$/
    ];
    if (["POST","PUT","PATCH","DELETE"].includes(req.method)) {
      for (const pattern of radioMembershipPatterns) {
        const match = url.pathname.match(pattern);
        if (!match) continue;
        const link = linkedRadioChannel(match[1]);
        if (!link) return false;
        return deny(req, res, link);
      }
      if (["PATCH","DELETE"].includes(req.method)) {
        const channelMatch = url.pathname.match(/^\/api\/driver\/radio\/channels\/(\d+)$/);
        if (channelMatch) {
          const link = linkedRadioChannel(channelMatch[1]);
          if (link) return deny(req, res, link);
        }
      }
    }
    return false;
  };
}

module.exports = { createCommunityLinkGuard };
