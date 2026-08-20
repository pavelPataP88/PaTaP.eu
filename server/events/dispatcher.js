function createEventDispatcher({db,events,nowIso=()=>new Date().toISOString()}={}){
  let timer=null,running=false,lastCleanupAt=0;
  const ids=(ref)=>String(ref||"").split(":").map(Number);
  const nick=(userId)=>db.prepare("SELECT nickname FROM driver_profiles WHERE user_id=?").get(Number(userId))?.nickname||null;
  const OUTBOX_RETENTION_MS=7*24*60*60*1000;
  const CLEANUP_INTERVAL_MS=60*60*1000;
  const PARKING_EVENT_MAX_AGE_MS=3*60*60*1000;

  function processRow(row){
    if(row.event_kind==="CHAT_MESSAGE"){
      const messageId=Number(row.source_ref);const message=db.prepare("SELECT id,room_id FROM chat_messages WHERE id=?").get(messageId);
      if(message){const poll=Boolean(db.prepare("SELECT 1 FROM chat_polls WHERE message_id=?").get(messageId));const attachments=Number(db.prepare("SELECT COUNT(*) n FROM chat_message_attachments WHERE message_id=?").get(messageId).n||0);events.consumeChatEvent({type:"chat.message.committed",roomId:Number(message.room_id),message:{id:messageId,poll:poll?{}:null,attachments:attachments?Array.from({length:attachments},()=>({})):[]}});}return;
    }
    if(row.event_kind==="RELATIONSHIP"){
      const [requesterId,targetId]=ids(row.source_ref);const relation=db.prepare("SELECT status FROM driver_relationships WHERE requester_id=? AND target_id=?").get(requesterId,targetId);
      if(!relation)return;
      if(relation.status==="PENDING"){const target=nick(targetId);if(target)events.contactRequest(requesterId,target);}
      else if(relation.status==="ACCEPTED")events.contactAccepted(targetId,requesterId);
      return;
    }
    if(row.event_kind==="COMMUNITY_INVITE"){
      const [communityId,targetId]=ids(row.source_ref);const invite=db.prepare("SELECT invited_by FROM driver_community_invites WHERE community_id=? AND target_user_id=?").get(communityId,targetId);const target=nick(targetId);
      if(invite&&target)events.communityInvite(Number(invite.invited_by),communityId,target);return;
    }
    if(row.event_kind==="COMMUNITY_ROLE"){
      const [communityId,targetId]=ids(row.source_ref);const member=db.prepare("SELECT role FROM driver_community_members WHERE community_id=? AND user_id=?").get(communityId,targetId);const community=db.prepare("SELECT title FROM driver_communities WHERE id=?").get(communityId);
      if(member&&community)events.emit(targetId,{type:"community.role_changed",category:"COMMUNITY",priority:"IMPORTANT",sourceKind:"COMMUNITY",sourceId:String(communityId),title:`Роль изменена · ${community.title}`,preview:`Новая роль: ${member.role}.`,route:{kind:"COMMUNITY",communityId},dedupeKey:`community-role:${communityId}`});return;
    }
    if(row.event_kind==="COMMUNITY_BAN"){
      const [communityId,targetId]=ids(row.source_ref);const ban=db.prepare("SELECT blocked_by FROM driver_community_bans WHERE community_id=? AND user_id=?").get(communityId,targetId);const target=nick(targetId);
      if(ban&&target)events.communityRemoved(Number(ban.blocked_by),communityId,target,{banned:true});return;
    }
    if(row.event_kind==="RADIO_TRANSMISSION"){
      const transmission=db.prepare("SELECT id,channel_id,sender_id FROM radio_transmissions WHERE id=? AND state='COMMITTED'").get(Number(row.source_ref));
      if(transmission)events.radioCommitted(Number(transmission.sender_id),{id:Number(transmission.id),channelId:Number(transmission.channel_id)});return;
    }
    if(row.event_kind==="PARKING_OCCUPANCY"){
      const observation=db.prepare("SELECT id,place_id,user_id,status,source_type,observed_at,expires_at FROM parking_occupancy_observations WHERE id=?").get(Number(row.source_ref));if(!observation)return;
      const now=Date.parse(nowIso()),observed=Date.parse(observation.observed_at||""),expires=Date.parse(observation.expires_at||"");
      if(!Number.isFinite(observed)||!Number.isFinite(now)||now-observed>PARKING_EVENT_MAX_AGE_MS||(Number.isFinite(expires)&&expires<=now))return;
      const previous=db.prepare("SELECT status FROM parking_occupancy_observations WHERE place_id=? AND id<? AND observed_at<=? ORDER BY observed_at DESC,id DESC LIMIT 1").get(observation.place_id,observation.id,observation.observed_at);
      events.parkingChanged(observation.user_id===null?null:Number(observation.user_id),Number(observation.place_id),previous?.status||"UNKNOWN",observation.status);return;
    }
  }

  function cleanupProcessed(now=nowIso()){
    const nowMs=Date.parse(now);if(!Number.isFinite(nowMs))return 0;
    if(lastCleanupAt&&nowMs-lastCleanupAt<CLEANUP_INTERVAL_MS)return 0;
    lastCleanupAt=nowMs;
    const cutoff=new Date(nowMs-OUTBOX_RETENTION_MS).toISOString();
    return Number(db.prepare("DELETE FROM driver_event_outbox WHERE processed_at IS NOT NULL AND processed_at < ?").run(cutoff).changes||0);
  }

  function processBatch(limit=100){if(running)return {processed:0,cleaned:0};running=true;let processed=0;try{
    const rows=db.prepare("SELECT * FROM driver_event_outbox WHERE processed_at IS NULL ORDER BY id LIMIT ?").all(Math.min(500,Math.max(1,Number(limit)||100)));
    for(const row of rows){const now=nowIso();try{processRow(row);db.prepare("UPDATE driver_event_outbox SET processed_at=?,attempts=attempts+1,last_error=NULL WHERE id=?").run(now,row.id);processed++;}catch(error){const attempts=Number(row.attempts||0)+1;db.prepare("UPDATE driver_event_outbox SET attempts=?,last_error=?,processed_at=CASE WHEN ?>=5 THEN ? ELSE NULL END WHERE id=?").run(attempts,String(error?.message||"event_dispatch_failed").slice(0,500),attempts,now,row.id);}}
    return {processed,cleaned:cleanupProcessed(nowIso())};
  }finally{running=false;}}
  function start(intervalMs=1000){if(timer)return;processBatch();timer=setInterval(()=>processBatch(),Math.max(500,intervalMs));timer.unref?.();}
  function stop(){if(timer){clearInterval(timer);timer=null;}}
  return {processBatch,cleanupProcessed,start,stop};
}

module.exports={createEventDispatcher};


