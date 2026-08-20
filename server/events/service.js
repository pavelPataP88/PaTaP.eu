const { createEventRepository } = require("./repository");
const { haversineKm } = require("../road-reports/repository");

const ROAD_LABELS=Object.freeze({ACCIDENT:"ДТП рядом",ROADWORK:"Дорожные работы рядом",OBSTACLE:"Препятствие на дороге",ROAD_CONTROL:"Дорожный контроль рядом",TRANSPORT_INSPECTION:"Транспортная инспекция рядом"});
const PARKING_LABELS=Object.freeze({AVAILABLE:"появились места",LIMITED:"осталось мало мест",FULL:"паркинг заполнен",CLOSED:"паркинг закрыт",UNKNOWN:"статус изменился"});

function text(value,max=260){return String(value??"").normalize("NFKC").replace(/\s+/g," ").trim().slice(0,max);}
function isoMinus(now,minutes){return new Date(Date.parse(now)-minutes*60000).toISOString();}

function createEventService({db,nowIso=()=>new Date().toISOString(),sendPush=async()=>{}}={}){
  const repo=createEventRepository(db,{nowIso});
  const listeners=new Map();

  function addListener(userId,res){const id=Number(userId);const set=listeners.get(id)||new Set();set.add(res);listeners.set(id,set);}
  function removeListener(userId,res){const set=listeners.get(Number(userId));if(!set)return;set.delete(res);if(!set.size)listeners.delete(Number(userId));}
  function sendSse(res,payload){try{res.write(`event: driver-event\ndata: ${JSON.stringify(payload)}\n\n`);return true;}catch{return false;}}
  function publish(userId,event){
    if(!event)return;let policy=repo.deliveryPolicy(userId,event,nowIso());
    if(repo.sourceOverride(userId,event.source.kind,event.source.id)==="IMPORTANT"&&!(["URGENT","IMPORTANT"].includes(event.priority)))policy={interrupt:false,push:false,reason:"source_important_only"};
    for(const res of [...(listeners.get(Number(userId))||[])])if(!sendSse(res,{type:"event.committed",event,policy}))removeListener(userId,res);
    if(policy.push)Promise.resolve(sendPush(Number(userId),event,policy)).catch(()=>{});
  }
  function emit(userId,input){const event=repo.emit(userId,input,nowIso());if(event)publish(userId,event);return event;}
  function publishCounts(userId){const counts=repo.counts(userId,nowIso());for(const res of [...(listeners.get(Number(userId))||[])])if(!sendSse(res,{type:"event.counts",counts}))removeListener(userId,res);}
  function blocked(left,right){return Boolean(db.prepare(`SELECT 1 FROM driver_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)`).get(left,right,right,left));}
  function userIdByNickname(nickname){return db.prepare("SELECT user_id FROM driver_profiles WHERE nickname_key=?").get(String(nickname||"").normalize("NFKC").trim().toLocaleLowerCase("und"))?.user_id||null;}
  function nickname(userId){return db.prepare("SELECT nickname FROM driver_profiles WHERE user_id=?").get(userId)?.nickname||"Водитель";}

  function chatRoom(roomId){return db.prepare(`SELECT r.id,r.title,CASE WHEN gp.room_id IS NOT NULL THEN 'GROUP' ELSE COALESCE(s.space_kind,r.kind) END kind FROM chat_rooms r LEFT JOIN chat_room_spaces s ON s.room_id=r.id LEFT JOIN chat_room_profiles gp ON gp.room_id=r.id WHERE r.id=?`).get(roomId)||null;}
  function chatRecipients(room){
    if(!room)return[];
    if(room.kind==="GENERAL")return db.prepare("SELECT user_id FROM driver_profiles").all().map(r=>Number(r.user_id));
    return db.prepare("SELECT user_id FROM chat_room_members WHERE room_id=?").all(room.id).map(r=>Number(r.user_id));
  }
  function consumeChatEvent(event){
    if(event?.type!=="chat.message.committed"||!event.message)return 0;
    const roomId=Number(event.roomId),messageId=Number(event.message.id);if(!Number.isSafeInteger(roomId)||!Number.isSafeInteger(messageId))return 0;
    const row=db.prepare("SELECT sender_id,body FROM chat_messages WHERE id=? AND room_id=?").get(messageId,roomId);if(!row)return 0;
    const senderId=Number(row.sender_id),senderName=nickname(senderId),room=chatRoom(roomId);if(!room)return 0;
    const mentions=new Set(db.prepare("SELECT user_id FROM chat_message_mentions WHERE message_id=?").all(messageId).map(r=>Number(r.user_id)));
    const replyTarget=db.prepare(`SELECT original.sender_id FROM chat_message_meta meta JOIN chat_messages original ON original.id=meta.reply_to_message_id WHERE meta.message_id=?`).get(messageId)?.sender_id;
    let emitted=0;
    for(const targetId of chatRecipients(room)){
      if(targetId===senderId||blocked(senderId,targetId))continue;
      const state=db.prepare("SELECT muted,notification_level FROM chat_room_member_state WHERE room_id=? AND user_id=?").get(roomId,targetId)||{muted:0,notification_level:"ALL"};
      const mentioned=mentions.has(targetId),replied=Number(replyTarget)===targetId,isDirect=room.kind==="DIRECT";
      if(state.muted||state.notification_level==="NONE")continue;
      if(state.notification_level==="MENTIONS"&&!mentioned&&!replied&&!isDirect)continue;
      const important=isDirect||mentioned||replied;
      const kind=mentioned?"chat.mention":replied?"chat.reply":isDirect?"chat.direct":"chat.message";
      const title=mentioned?`${senderName} упомянул вас`:replied?`${senderName} ответил вам`:isDirect?`Сообщение от ${senderName}`:`${senderName} · ${room.title}`;
      let preview=text(row.body,220);if(!preview)preview=event.message.poll?"Опрос":event.message.attachments?.length?"Вложение":"Новое сообщение";
      if(emit(targetId,{type:kind,category:"CHAT",priority:important?"IMPORTANT":"NORMAL",actorUserId:senderId,sourceKind:"CHAT_ROOM",sourceId:String(roomId),title,preview,route:{kind:"CHAT_ROOM",roomId,messageId},data:{messageId,roomKind:room.kind},dedupeKey:`chat:room:${roomId}`}))emitted++;
    }
    return emitted;
  }

  function contactRequest(actorId,targetNickname){const targetId=Number(userIdByNickname(targetNickname));if(!targetId||targetId===Number(actorId)||blocked(actorId,targetId))return null;return emit(targetId,{type:"people.contact_request",category:"PEOPLE",priority:"IMPORTANT",actorUserId:actorId,sourceKind:"DRIVER",sourceId:String(actorId),title:`${nickname(actorId)} хочет добавить вас в контакты`,preview:"Откройте «Люди», чтобы принять или отклонить заявку.",route:{kind:"PEOPLE_FILTER",filter:"REQUESTS"},dedupeKey:`contact-request:${actorId}`});}
  function contactAccepted(actorId,targetId){if(!targetId||targetId===Number(actorId)||blocked(actorId,targetId))return null;return emit(targetId,{type:"people.contact_accepted",category:"PEOPLE",priority:"NORMAL",actorUserId:actorId,sourceKind:"DRIVER",sourceId:String(actorId),title:`${nickname(actorId)} теперь в ваших контактах`,preview:"Можно открыть чат или рацию.",route:{kind:"DRIVER",nickname:nickname(actorId)},dedupeKey:`contact-accepted:${actorId}`});}
  function communityRow(communityId){return db.prepare("SELECT id,title,created_by FROM driver_communities WHERE id=?").get(Number(communityId))||null;}
  function communityInvite(actorId,communityId,targetNickname){const row=communityRow(communityId),targetId=Number(userIdByNickname(targetNickname));if(!row||!targetId||targetId===Number(actorId))return null;return emit(targetId,{type:"community.invite",category:"COMMUNITY",priority:"IMPORTANT",actorUserId:actorId,sourceKind:"COMMUNITY",sourceId:String(row.id),title:`Приглашение: ${row.title}`,preview:`${nickname(actorId)} приглашает вас в сообщество.`,route:{kind:"COMMUNITY",communityId:row.id},dedupeKey:`community-invite:${row.id}`});}
  function communityRole(actorId,communityId,targetNickname,role){const row=communityRow(communityId),targetId=Number(userIdByNickname(targetNickname));if(!row||!targetId||targetId===Number(actorId))return null;return emit(targetId,{type:"community.role_changed",category:"COMMUNITY",priority:"IMPORTANT",actorUserId:actorId,sourceKind:"COMMUNITY",sourceId:String(row.id),title:`Роль изменена · ${row.title}`,preview:`Новая роль: ${String(role||"").toUpperCase()}.`,route:{kind:"COMMUNITY",communityId:row.id},dedupeKey:`community-role:${row.id}`});}
  function communityRemoved(actorId,communityId,targetNickname,{banned=false}={}){const row=communityRow(communityId),targetId=Number(userIdByNickname(targetNickname));if(!row||!targetId)return null;return emit(targetId,{type:banned?"community.banned":"community.removed",category:"COMMUNITY",priority:"IMPORTANT",actorUserId:actorId,sourceKind:"COMMUNITY",sourceId:String(row.id),title:banned?`Доступ закрыт · ${row.title}`:`Вы удалены · ${row.title}`,preview:banned?"Вы заблокированы в этом сообществе.":"Вы больше не участник сообщества.",route:{kind:"PEOPLE_FILTER",filter:"COMMUNITIES"},dedupeKey:`community-membership:${row.id}`});}

  function radioCommitted(actorId,transmission){
    const channelId=Number(transmission?.channelId);if(!channelId)return 0;
    const profile=db.prepare("SELECT title,space_kind FROM radio_channel_profiles WHERE channel_id=?").get(channelId);
    const raw=db.prepare("SELECT kind FROM radio_channels WHERE id=?").get(channelId);const kind=profile?.space_kind||raw?.kind||"DIRECT",title=profile?.title||"Прямая рация";
    const recipients=db.prepare("SELECT m.user_id,COALESCE(s.muted,0) muted,COALESCE(s.favorite,0) favorite FROM radio_channel_members m LEFT JOIN radio_channel_member_state s ON s.channel_id=m.channel_id AND s.user_id=m.user_id WHERE m.channel_id=? AND m.user_id!=?").all(channelId,actorId);
    let count=0;for(const r of recipients){const targetId=Number(r.user_id);if(r.muted||blocked(actorId,targetId))continue;const direct=kind==="DIRECT";if(!direct&&!r.favorite)continue;const event=emit(targetId,{type:direct?"radio.direct":"radio.transmission",category:"RADIO",priority:direct?"IMPORTANT":"NORMAL",actorUserId:actorId,sourceKind:"RADIO_CHANNEL",sourceId:String(channelId),title:direct?`Рация · ${nickname(actorId)}`:`Рация · ${title}`,preview:"Новая голосовая передача",route:{kind:"RADIO_CHANNEL",channelId,transmissionId:Number(transmission.id)},dedupeKey:`radio:channel:${channelId}`});if(event)count++;}return count;
  }

  function roadReport(actorId,report){
    if(!report)return 0;const now=nowIso();const candidates=db.prepare(`SELECT l.user_id,l.latitude,l.longitude FROM driver_locations l JOIN driver_profiles p ON p.user_id=l.user_id JOIN users u ON u.id=l.user_id WHERE l.user_id!=? AND p.gps_enabled=1 AND u.disabled=0 AND l.updated_at>=?`).all(actorId,isoMinus(now,2));let count=0;
    for(const row of candidates){const distance=haversineKm(report.latitude,report.longitude,row.latitude,row.longitude);if(distance>5)continue;const urgent=["ACCIDENT","OBSTACLE"].includes(report.type)&&distance<=3;const event=emit(Number(row.user_id),{type:`road.${String(report.type).toLowerCase()}`,category:"ROAD",priority:urgent?"URGENT":"IMPORTANT",sourceKind:"ROAD_REPORT",sourceId:String(report.id),title:ROAD_LABELS[report.type]||"Событие на дороге",preview:`Примерно ${distance<1?Math.round(distance*1000)+" м":distance.toFixed(1)+" км"} от вашей свежей позиции.`,route:{kind:"ROAD_REPORT",reportId:report.id,latitude:report.latitude,longitude:report.longitude},data:{roadType:report.type,distanceKm:Number(distance.toFixed(3))},dedupeKey:`road:${report.id}`,expiresAt:report.expiresAt});if(event)count++;}return count;
  }

  function parkingChanged(actorId,placeId,previousStatus,nextStatus){
    const before=String(previousStatus||"UNKNOWN").toUpperCase(),after=String(nextStatus||"UNKNOWN").toUpperCase();if(before===after)return 0;const place=db.prepare("SELECT id,name FROM parking_places WHERE id=? AND status!='REMOVED'").get(Number(placeId));if(!place)return 0;const users=db.prepare("SELECT user_id FROM parking_favorites WHERE place_id=? AND user_id!=?").all(place.id,Number(actorId)||-1);let count=0;
    for(const row of users){const targetId=Number(row.user_id),critical=["FULL","CLOSED","AVAILABLE"].includes(after);const event=emit(targetId,{type:"parking.status_changed",category:"PARKING",priority:critical?"IMPORTANT":"NORMAL",actorUserId:actorId||null,sourceKind:"PARKING",sourceId:String(place.id),title:`${place.name}: ${PARKING_LABELS[after]||"статус изменился"}`,preview:`Было: ${before}. Сейчас: ${after}.`,route:{kind:"PARKING",placeId:Number(place.id)},data:{previousStatus:before,status:after},dedupeKey:`parking:${place.id}:status`});if(event)count++;}return count;
  }

  return {repo,addListener,removeListener,sendSse,emit,publish,publishCounts,consumeChatEvent,contactRequest,contactAccepted,communityInvite,communityRole,communityRemoved,radioCommitted,roadReport,parkingChanged,userIdByNickname};
}

module.exports={createEventService};


