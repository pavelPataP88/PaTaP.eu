function createCommunityLinkGuard({ db, json, requireSession, requireCsrf }) {
  function linkedChatRoom(roomId) {
    return db.prepare("SELECT id,title FROM driver_communities WHERE chat_room_id=?").get(Number(roomId)) || null;
  }
  function linkedRadioChannel(channelId) {
    return db.prepare("SELECT id,title FROM driver_communities WHERE radio_channel_id=?").get(Number(channelId)) || null;
  }
  function deny(req, res, link) {
    const session = requireSession(req, res);
    if (!session) return true;
    if (["POST","PUT","PATCH","DELETE"].includes(req.method) && !requireCsrf(req, res, session)) return true;
    json(res, 409, { error:"community_managed", communityId:Number(link.id), communityTitle:link.title });
    return true;
  }

  return async function handleCommunityLinkGuard(req, res, url, body) {
    const chatPatterns = [
      /^\/api\/driver\/chat\/groups\/(\d+)\/(?:join|leave|invites)$/,
      /^\/api\/driver\/chat\/groups\/(\d+)\/members\/[^/]+$/,
      /^\/api\/driver\/chat\/groups\/(\d+)\/bans\/[^/]+$/,
      /^\/api\/driver\/chat\/invites\/(\d+)\/respond$/,
      /^\/api\/driver\/chat\/rooms\/(\d+)$/
    ];
    for (const pattern of chatPatterns) {
      const match = url.pathname.match(pattern);
      if (!match) continue;
      const link = linkedChatRoom(match[1]);
      if (!link) return false;
      return deny(req, res, link);
    }

    const radioPatterns = [
      /^\/api\/driver\/radio\/channels\/(\d+)\/(?:join|leave|invites)$/,
      /^\/api\/driver\/radio\/channels\/(\d+)\/members\/[^/]+$/,
      /^\/api\/driver\/radio\/channels\/(\d+)\/bans\/[^/]+$/,
      /^\/api\/driver\/radio\/invites\/(\d+)\/respond$/,
      /^\/api\/driver\/radio\/channels\/(\d+)$/
    ];
    for (const pattern of radioPatterns) {
      const match = url.pathname.match(pattern);
      if (!match) continue;
      const link = linkedRadioChannel(match[1]);
      if (!link) return false;
      return deny(req, res, link);
    }
    return false;
  };
}

module.exports = { createCommunityLinkGuard };
