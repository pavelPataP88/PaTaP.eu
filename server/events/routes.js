function createEventRoutes({events,push,json,requireSession,requireCsrf,checkRate,nowIso}){
  function respond(res,status,payload){json(res,status,payload);return true;}
  function requireUser(req,res){const session=requireSession(req,res);if(!session)return null;if(!events.repo.hasDriver(session.user.id)){respond(res,409,{error:"driver_profile_required"});return null;}events.repo.ensurePreferences(session.user.id,nowIso());return session;}
  function mutation(req,res,key,limit=60,windowMinutes=1){const session=requireUser(req,res);if(!session||!requireCsrf(req,res,session))return null;if(key&&!checkRate(`events:${key}:user:${session.user.id}`,limit,windowMinutes)){respond(res,429,{error:"event_rate_limited"});return null;}return session;}
  function result(res,value,status=200){if(value?.error)return respond(res,value.status||400,{error:value.error});return respond(res,status,value);}

  return async function handleEventRoute(req,res,url,body){
    if(!url.pathname.startsWith("/api/driver/events"))return false;

    if(req.method==="GET"&&url.pathname==="/api/driver/events/overview"){
      const session=requireUser(req,res);if(!session)return true;return respond(res,200,events.repo.overview(session.user.id,nowIso()));
    }
    if(req.method==="GET"&&url.pathname==="/api/driver/events"){
      const session=requireUser(req,res);if(!session)return true;return respond(res,200,events.repo.list(session.user.id,{unread:url.searchParams.get("unread"),category:url.searchParams.get("category"),priority:url.searchParams.get("priority"),includeSnoozed:url.searchParams.get("includeSnoozed"),before:url.searchParams.get("before"),limit:url.searchParams.get("limit")},nowIso()));
    }
    if(req.method==="GET"&&url.pathname==="/api/driver/events/stream"){
      const session=requireUser(req,res);if(!session)return true;
      res.writeHead(200,{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-store, no-transform","Connection":"keep-alive","X-Content-Type-Options":"nosniff","X-Accel-Buffering":"no"});
      res.write("retry: 3000\n\n");events.addListener(session.user.id,res);events.sendSse(res,{type:"event.ready",counts:events.repo.counts(session.user.id,nowIso())});
      const heartbeat=setInterval(()=>{try{res.write(`: keepalive ${Date.now()}\n\n`);}catch{clearInterval(heartbeat);events.removeListener(session.user.id,res);}},20000);heartbeat.unref?.();
      const close=()=>{clearInterval(heartbeat);events.removeListener(session.user.id,res);};req.once("close",close);req.once("aborted",close);return true;
    }
    if(req.method==="GET"&&url.pathname==="/api/driver/events/push-config"){
      const session=requireUser(req,res);if(!session)return true;return respond(res,200,push.config());
    }
    const eventMatch=url.pathname.match(/^\/api\/driver\/events\/(\d+)$/);
    if(req.method==="GET"&&eventMatch){const session=requireUser(req,res);if(!session)return true;const event=events.repo.get(session.user.id,Number(eventMatch[1]),nowIso());return event?respond(res,200,{event}):respond(res,404,{error:"event_not_found"});}

    if(body===undefined)return false;

    if(req.method==="PATCH"&&url.pathname==="/api/driver/events/preferences"){
      const session=mutation(req,res,"preferences",30,1);if(!session)return true;const value=events.repo.updatePreferences(session.user.id,body,nowIso());events.publishCounts(session.user.id);return result(res,value);
    }
    const categoryMatch=url.pathname.match(/^\/api\/driver\/events\/categories\/([A-Za-z]+)$/);
    if(req.method==="PATCH"&&categoryMatch){const session=mutation(req,res,"category",60,1);if(!session)return true;return result(res,events.repo.updateCategoryPreference(session.user.id,categoryMatch[1],body,nowIso()));}
    const sourceMatch=url.pathname.match(/^\/api\/driver\/events\/sources\/([^/]+)\/([^/]+)$/);
    if(req.method==="PUT"&&sourceMatch){const session=mutation(req,res,"source",60,1);if(!session)return true;return result(res,events.repo.setSourceOverride(session.user.id,decodeURIComponent(sourceMatch[1]),decodeURIComponent(sourceMatch[2]),body?.mode,nowIso()));}
    if(req.method==="PATCH"&&eventMatch){const session=mutation(req,res,"read",120,1);if(!session)return true;if(typeof body?.read!=="boolean")return respond(res,400,{error:"invalid_event_read_state"});const value=events.repo.markRead(session.user.id,Number(eventMatch[1]),body.read,nowIso());events.publishCounts(session.user.id);return result(res,value);}
    const archiveMatch=url.pathname.match(/^\/api\/driver\/events\/(\d+)\/archive$/);
    if(req.method==="POST"&&archiveMatch){const session=mutation(req,res,"archive",120,1);if(!session)return true;const value=events.repo.archive(session.user.id,Number(archiveMatch[1]),nowIso());events.publishCounts(session.user.id);return result(res,value);}
    const snoozeMatch=url.pathname.match(/^\/api\/driver\/events\/(\d+)\/snooze$/);
    if(req.method==="POST"&&snoozeMatch){const session=mutation(req,res,"snooze",120,1);if(!session)return true;const value=events.repo.snooze(session.user.id,Number(snoozeMatch[1]),body?.minutes,nowIso());events.publishCounts(session.user.id);return result(res,value);}
    if(req.method==="POST"&&url.pathname==="/api/driver/events/mark-all-read"){
      const session=mutation(req,res,"mark-all",20,1);if(!session)return true;const value=events.repo.markAllRead(session.user.id,nowIso());events.publishCounts(session.user.id);return respond(res,200,value);
    }
    if(req.method==="POST"&&url.pathname==="/api/driver/events/push-subscriptions"){
      const session=mutation(req,res,"push-subscribe",20,10);if(!session)return true;return result(res,events.repo.upsertPushSubscription(session.user.id,body,req.headers["user-agent"]||"",nowIso()),201);
    }
    if(req.method==="DELETE"&&url.pathname==="/api/driver/events/push-subscriptions"){
      const session=mutation(req,res,"push-unsubscribe",30,10);if(!session)return true;return result(res,events.repo.revokePushSubscription(session.user.id,body?.endpoint,nowIso()));
    }
    return false;
  };
}

module.exports={createEventRoutes};
