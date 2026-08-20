const { ensureEventSchema } = require("./schema");

const CATEGORIES = new Set(["CHAT","PEOPLE","COMMUNITY","RADIO","ROAD","PARKING","SYSTEM"]);
const PRIORITIES = Object.freeze({ SILENT:0, NORMAL:1, IMPORTANT:2, URGENT:3 });
const SOURCE_MODES = new Set(["ALL","IMPORTANT","MUTED"]);
const RETENTION_DAYS = 30;

function cleanText(value,max=400){return String(value??"").normalize("NFKC").replace(/\s+/g," ").trim().slice(0,max);}
function safeJson(value){try{return JSON.stringify(value??{});}catch{return "{}";}}
function parseJson(value){try{return JSON.parse(value||"{}");}catch{return {};}}
function priority(value){const key=String(value||"").toUpperCase();return Object.hasOwn(PRIORITIES,key)?key:null;}
function higherPriority(left,right){return PRIORITIES[left]>=PRIORITIES[right]?left:right;}
function validTime(value){return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value||""));}
function validTimezone(value){try{new Intl.DateTimeFormat("en",{timeZone:value}).format(new Date());return true;}catch{return false;}}
function addDays(iso,days){return new Date(Date.parse(iso)+days*86400000).toISOString();}

function createEventRepository(db,{nowIso=()=>new Date().toISOString()}={}){
  ensureEventSchema(db,nowIso());

  function hasDriver(userId){return Boolean(db.prepare("SELECT 1 FROM driver_profiles WHERE user_id=?").get(Number(userId)));}
  function ensurePreferences(userId,now=nowIso()){
    db.prepare(`INSERT OR IGNORE INTO driver_event_preferences(user_id,updated_at) VALUES(?,?)`).run(userId,now);
    const add=db.prepare(`INSERT OR IGNORE INTO driver_event_category_preferences(user_id,category,min_priority,updated_at) VALUES(?,?,?,?)`);
    for(const category of CATEGORIES){
      const min=category==="ROAD"?"IMPORTANT":category==="SYSTEM"?"IMPORTANT":"NORMAL";
      add.run(userId,category,min,now);
    }
    return db.prepare("SELECT * FROM driver_event_preferences WHERE user_id=?").get(userId);
  }
  function categoryPreference(userId,category,now=nowIso()){
    ensurePreferences(userId,now);
    return db.prepare("SELECT * FROM driver_event_category_preferences WHERE user_id=? AND category=?").get(userId,category);
  }
  function sourceOverride(userId,sourceKind,sourceId){
    return db.prepare("SELECT mode FROM driver_event_source_overrides WHERE user_id=? AND source_kind=? AND source_id=?")
      .get(userId,String(sourceKind),String(sourceId))?.mode||"ALL";
  }
  function publicPreferences(row){return {enabled:Boolean(row.enabled),drivingMode:Boolean(row.driving_mode),quietEnabled:Boolean(row.quiet_enabled),quietStart:row.quiet_start,quietEnd:row.quiet_end,timezone:row.timezone,showPreviews:Boolean(row.show_previews),inAppPopups:Boolean(row.in_app_popups)};}
  function categoryPreferences(userId){ensurePreferences(userId);return Object.fromEntries(db.prepare("SELECT * FROM driver_event_category_preferences WHERE user_id=? ORDER BY category").all(userId).map(row=>[row.category,{inboxEnabled:Boolean(row.inbox_enabled),pushEnabled:Boolean(row.push_enabled),minPriority:row.min_priority}])));}

  function updatePreferences(userId,input,now=nowIso()){
    const current=ensurePreferences(userId,now);
    const bool=(key,column)=>input[key]===undefined?Number(current[column]):input[key]?1:0;
    const quietStart=input.quietStart===undefined?current.quiet_start:String(input.quietStart);
    const quietEnd=input.quietEnd===undefined?current.quiet_end:String(input.quietEnd);
    const timezone=input.timezone===undefined?current.timezone:cleanText(input.timezone,80);
    if(!validTime(quietStart)||!validTime(quietEnd)||!validTimezone(timezone))return {error:"invalid_event_preferences",status:400};
    db.prepare(`UPDATE driver_event_preferences SET enabled=?,driving_mode=?,quiet_enabled=?,quiet_start=?,quiet_end=?,timezone=?,show_previews=?,in_app_popups=?,updated_at=? WHERE user_id=?`)
      .run(bool("enabled","enabled"),bool("drivingMode","driving_mode"),bool("quietEnabled","quiet_enabled"),quietStart,quietEnd,timezone,bool("showPreviews","show_previews"),bool("inAppPopups","in_app_popups"),now,userId);
    return {preferences:publicPreferences(ensurePreferences(userId,now))};
  }
  function updateCategoryPreference(userId,category,input,now=nowIso()){
    const key=String(category||"").toUpperCase();if(!CATEGORIES.has(key))return {error:"invalid_event_category",status:400};
    const current=categoryPreference(userId,key,now);const min=input.minPriority===undefined?current.min_priority:priority(input.minPriority);
    if(!min)return {error:"invalid_event_priority",status:400};
    const inbox=input.inboxEnabled===undefined?Number(current.inbox_enabled):input.inboxEnabled?1:0;
    const push=input.pushEnabled===undefined?Number(current.push_enabled):input.pushEnabled?1:0;
    db.prepare("UPDATE driver_event_category_preferences SET inbox_enabled=?,push_enabled=?,min_priority=?,updated_at=? WHERE user_id=? AND category=?")
      .run(inbox,push,min,now,userId,key);
    return {category:key,preference:{inboxEnabled:Boolean(inbox),pushEnabled:Boolean(push),minPriority:min}};
  }
  function setSourceOverride(userId,sourceKind,sourceId,mode,now=nowIso()){
    const kind=cleanText(sourceKind,48),id=cleanText(sourceId,120),next=String(mode||"").toUpperCase();
    if(!kind||!id||!SOURCE_MODES.has(next))return {error:"invalid_event_source_override",status:400};
    if(next==="ALL")db.prepare("DELETE FROM driver_event_source_overrides WHERE user_id=? AND source_kind=? AND source_id=?").run(userId,kind,id);
    else db.prepare(`INSERT INTO driver_event_source_overrides(user_id,source_kind,source_id,mode,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,source_kind,source_id) DO UPDATE SET mode=excluded.mode,updated_at=excluded.updated_at`).run(userId,kind,id,next,now);
    return {sourceKind:kind,sourceId:id,mode:next};
  }

  function cleanup(now=nowIso()){
    db.prepare("DELETE FROM driver_events WHERE updated_at < ?").run(addDays(now,-RETENTION_DAYS));
    db.prepare("DELETE FROM driver_push_subscriptions WHERE revoked_at IS NOT NULL AND revoked_at < ?").run(addDays(now,-7));
  }
  function actorNickname(actorUserId){return actorUserId?db.prepare("SELECT nickname FROM driver_profiles WHERE user_id=?").get(actorUserId)?.nickname||null:null;}
  function publicEvent(row,now=nowIso()){
    if(!row)return null;const route=parseJson(row.route_json),data=parseJson(row.data_json);
    return {id:Number(row.id),type:row.event_type,category:row.category,priority:row.priority,actor:row.actor_user_id?{userId:Number(row.actor_user_id),nickname:actorNickname(Number(row.actor_user_id))}:null,source:{kind:row.source_kind,id:row.source_id,mode:sourceOverride(Number(row.user_id),row.source_kind,row.source_id)},title:row.title,preview:row.preview,route,data,occurrenceCount:Number(row.occurrence_count),createdAt:row.created_at,updatedAt:row.updated_at,readAt:row.read_at||null,archivedAt:row.archived_at||null,snoozedUntil:row.snoozed_until||null,expiresAt:row.expires_at||null,read:Boolean(row.read_at),archived:Boolean(row.archived_at),snoozed:Boolean(row.snoozed_until&&row.snoozed_until>now),expired:Boolean(row.expires_at&&row.expires_at<=now)};
  }
  function rowById(userId,eventId){return db.prepare("SELECT * FROM driver_events WHERE id=? AND user_id=?").get(Number(eventId),userId)||null;}
  function get(userId,eventId,now=nowIso()){return publicEvent(rowById(userId,eventId),now);}

  function emit(userId,input,now=nowIso()){
    const target=Number(userId);if(!Number.isSafeInteger(target)||!hasDriver(target))return null;
    const category=String(input?.category||"").toUpperCase(),p=priority(input?.priority);
    const eventType=cleanText(input?.type,80),sourceKind=cleanText(input?.sourceKind,48),sourceId=cleanText(input?.sourceId,120),title=cleanText(input?.title,160);
    if(!CATEGORIES.has(category)||!p||!eventType||!sourceKind||!sourceId||!title)return null;
    const cat=categoryPreference(target,category,now);if(!cat.inbox_enabled)return null;
    const actor=input.actorUserId===null||input.actorUserId===undefined?null:Number(input.actorUserId);
    const actorId=Number.isSafeInteger(actor)&&actor!==target?actor:null;
    const preview=cleanText(input.preview,500),dedupe=cleanText(input.dedupeKey,180)||null,expires=input.expiresAt&&Number.isFinite(Date.parse(input.expiresAt))?new Date(input.expiresAt).toISOString():null;
    let row=dedupe?db.prepare("SELECT * FROM driver_events WHERE user_id=? AND dedupe_key=? AND read_at IS NULL AND archived_at IS NULL").get(target,dedupe):null;
    if(row&&(!row.expires_at||row.expires_at>now)){
      const nextPriority=higherPriority(row.priority,p);
      db.prepare(`UPDATE driver_events SET event_type=?,category=?,priority=?,actor_user_id=?,source_kind=?,source_id=?,title=?,preview=?,route_json=?,data_json=?,occurrence_count=occurrence_count+1,updated_at=?,snoozed_until=NULL,expires_at=? WHERE id=?`)
        .run(eventType,category,nextPriority,actorId,sourceKind,sourceId,title,preview,safeJson(input.route),safeJson(input.data),now,expires,row.id);
      return publicEvent(rowById(target,row.id),now);
    }
    const result=db.prepare(`INSERT INTO driver_events(user_id,event_type,category,priority,actor_user_id,source_kind,source_id,title,preview,route_json,data_json,dedupe_key,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(target,eventType,category,p,actorId,sourceKind,sourceId,title,preview,safeJson(input.route),safeJson(input.data),dedupe,now,now,expires);
    return publicEvent(rowById(target,Number(result.lastInsertRowid)),now);
  }

  function list(userId,input={},now=nowIso()){
    cleanup(now);ensurePreferences(userId,now);
    const clauses=["user_id=?","archived_at IS NULL","(expires_at IS NULL OR expires_at>?)"];
    const args=[userId,now];
    if(input.unread===true||input.unread==="1")clauses.push("read_at IS NULL");
    if(input.category&&CATEGORIES.has(String(input.category).toUpperCase())){clauses.push("category=?");args.push(String(input.category).toUpperCase());}
    if(input.priority&&priority(input.priority)){clauses.push("priority=?");args.push(priority(input.priority));}
    if(input.includeSnoozed!==true&&input.includeSnoozed!=="1")clauses.push("(snoozed_until IS NULL OR snoozed_until<=?)"),args.push(now);
    if(input.before){const before=Number(input.before);if(Number.isSafeInteger(before)){clauses.push("id<?");args.push(before);}}
    const limit=Math.min(100,Math.max(1,Number(input.limit)||50));args.push(limit+1);
    let rows=db.prepare(`SELECT * FROM driver_events WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC,id DESC LIMIT ?`).all(...args);
    const hasMore=rows.length>limit;if(hasMore)rows=rows.slice(0,limit);
    return {events:rows.map(row=>publicEvent(row,now)),nextCursor:hasMore?Number(rows.at(-1)?.id||0):null,hasMore};
  }
  function counts(userId,now=nowIso()){
    const rows=db.prepare(`SELECT priority,COUNT(*) n FROM driver_events WHERE user_id=? AND read_at IS NULL AND archived_at IS NULL AND (expires_at IS NULL OR expires_at>?) AND (snoozed_until IS NULL OR snoozed_until<=?) GROUP BY priority`).all(userId,now,now);
    const out={unread:0,urgent:0,important:0};for(const row of rows){const n=Number(row.n);out.unread+=n;if(row.priority==="URGENT")out.urgent+=n;if(row.priority==="IMPORTANT")out.important+=n;}return out;
  }
  function overview(userId,now=nowIso()){
    cleanup(now);const pref=ensurePreferences(userId,now);return {counts:counts(userId,now),preferences:publicPreferences(pref),categories:categoryPreferences(userId),events:list(userId,{limit:20},now).events,push:{subscriptions:Number(db.prepare("SELECT COUNT(*) n FROM driver_push_subscriptions WHERE user_id=? AND revoked_at IS NULL").get(userId).n||0)}};
  }

  function markRead(userId,eventId,read=true,now=nowIso()){
    if(!rowById(userId,eventId))return {error:"event_not_found",status:404};db.prepare("UPDATE driver_events SET read_at=?,updated_at=? WHERE id=? AND user_id=?").run(read?now:null,now,eventId,userId);return {event:get(userId,eventId,now),counts:counts(userId,now)};
  }
  function markAllRead(userId,now=nowIso()){const changes=db.prepare("UPDATE driver_events SET read_at=?,updated_at=? WHERE user_id=? AND read_at IS NULL AND archived_at IS NULL AND (expires_at IS NULL OR expires_at>?)").run(now,now,userId,now).changes;return {updated:Number(changes),counts:counts(userId,now)};}
  function archive(userId,eventId,now=nowIso()){if(!rowById(userId,eventId))return {error:"event_not_found",status:404};db.prepare("UPDATE driver_events SET archived_at=?,read_at=COALESCE(read_at,?),updated_at=? WHERE id=? AND user_id=?").run(now,now,now,eventId,userId);return {archived:true,counts:counts(userId,now)};}
  function snooze(userId,eventId,minutes,now=nowIso()){
    const value=Number(minutes);if(![15,60,180,480,1440].includes(value))return {error:"invalid_event_snooze",status:400};if(!rowById(userId,eventId))return {error:"event_not_found",status:404};const until=new Date(Date.parse(now)+value*60000).toISOString();db.prepare("UPDATE driver_events SET snoozed_until=?,updated_at=? WHERE id=? AND user_id=?").run(until,now,eventId,userId);return {event:get(userId,eventId,now),counts:counts(userId,now)};
  }

  function localClock(now,timezone){const parts=new Intl.DateTimeFormat("en-GB",{timeZone:timezone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(now));const hour=Number(parts.find(p=>p.type==="hour")?.value||0),minute=Number(parts.find(p=>p.type==="minute")?.value||0);return hour*60+minute;}
  function quietActive(pref,now){if(!pref.quiet_enabled)return false;const minute=localClock(now,pref.timezone),[sh,sm]=pref.quiet_start.split(":").map(Number),[eh,em]=pref.quiet_end.split(":").map(Number),start=sh*60+sm,end=eh*60+em;if(start===end)return true;return start<end?minute>=start&&minute<end:minute>=start||minute<end;}
  function deliveryPolicy(userId,event,now=nowIso()){
    const pref=ensurePreferences(userId,now),cat=categoryPreference(userId,event.category,now),mode=sourceOverride(userId,event.source.kind,event.source.id),rank=PRIORITIES[event.priority];
    if(!pref.enabled||mode==="MUTED")return {interrupt:false,push:false,reason:!pref.enabled?"disabled":"source_muted"};
    const meets=rank>=PRIORITIES[cat.min_priority];
    if(!meets)return {interrupt:false,push:false,reason:"below_threshold"};
    if(pref.driving_mode&&event.priority!=="URGENT")return {interrupt:false,push:false,reason:"driving_mode"};
    if(quietActive(pref,now)&&event.priority!=="URGENT")return {interrupt:false,push:false,reason:"quiet_hours"};
    const interrupt=Boolean(pref.in_app_popups)&&event.priority!=="SILENT";
    return {interrupt,push:Boolean(cat.push_enabled)&&event.priority!=="SILENT",reason:interrupt?"attention_allowed":"inbox_only"};
  }

  function upsertPushSubscription(userId,input,userAgent="",now=nowIso()){
    const endpoint=cleanText(input?.endpoint,1600),p256dh=cleanText(input?.keys?.p256dh,300),auth=cleanText(input?.keys?.auth,200);
    if(!endpoint.startsWith("https://")||!p256dh||!auth)return {error:"invalid_push_subscription",status:400};
    db.prepare(`INSERT INTO driver_push_subscriptions(user_id,endpoint,p256dh,auth,user_agent,created_at,updated_at,revoked_at,failure_count) VALUES(?,?,?,?,?,?,?,NULL,0) ON CONFLICT(user_id,endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,user_agent=excluded.user_agent,updated_at=excluded.updated_at,revoked_at=NULL,failure_count=0`)
      .run(userId,endpoint,p256dh,auth,cleanText(userAgent,300),now,now);
    return {subscribed:true};
  }
  function revokePushSubscription(userId,endpoint,now=nowIso()){const changes=db.prepare("UPDATE driver_push_subscriptions SET revoked_at=?,updated_at=? WHERE user_id=? AND endpoint=? AND revoked_at IS NULL").run(now,now,userId,String(endpoint||"")).changes;return {unsubscribed:Boolean(changes)};}
  function activePushSubscriptions(userId){return db.prepare("SELECT id,endpoint,p256dh,auth FROM driver_push_subscriptions WHERE user_id=? AND revoked_at IS NULL ORDER BY id").all(userId);}
  function pushSuccess(id,now=nowIso()){db.prepare("UPDATE driver_push_subscriptions SET last_success_at=?,failure_count=0,updated_at=? WHERE id=?").run(now,now,id);}
  function pushFailure(id,{revoke=false}={},now=nowIso()){db.prepare(`UPDATE driver_push_subscriptions SET failure_count=failure_count+1,revoked_at=CASE WHEN ? THEN ? ELSE revoked_at END,updated_at=? WHERE id=?`).run(revoke?1:0,now,now,id);}

  return {hasDriver,ensurePreferences,publicPreferences,categoryPreferences,updatePreferences,updateCategoryPreference,setSourceOverride,sourceOverride,emit,list,get,counts,overview,markRead,markAllRead,archive,snooze,deliveryPolicy,upsertPushSubscription,revokePushSubscription,activePushSubscriptions,pushSuccess,pushFailure,cleanup,constants:{CATEGORIES,PRIORITIES,SOURCE_MODES,RETENTION_DAYS}};
}

module.exports={createEventRepository,CATEGORIES,PRIORITIES,SOURCE_MODES,RETENTION_DAYS};
