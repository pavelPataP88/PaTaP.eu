const { DATA_DIR }=require("../auth/db");
const { createEventService }=require("./service");
const { createPushSender }=require("./push");
const { createEventDispatcher }=require("./dispatcher");

function createEventRuntime({db,nowIso=()=>new Date().toISOString(),dataDir=DATA_DIR}={}){
  let push=null;
  const events=createEventService({db,nowIso,sendPush:(userId,event)=>push?push.send(userId,event):Promise.resolve({sent:0,failed:0})});
  push=createPushSender({dataDir,repo:events.repo});
  const dispatcher=createEventDispatcher({db,events,nowIso});
  events.dispatcher=dispatcher;
  return {events,push,dispatcher};
}

module.exports={createEventRuntime};
