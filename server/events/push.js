const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const webpush=require("web-push");

const DEFAULT_PUSH_HOSTS=Object.freeze(["fcm.googleapis.com","updates.push.services.mozilla.com","web.push.apple.com"]);
const PRIORITIES=new Set(["URGENT","IMPORTANT","NORMAL","SILENT"]);
const CATEGORIES=new Set(["CHAT","PEOPLE","COMMUNITY","RADIO","ROAD","PARKING","SYSTEM"]);

function b64url(input){return Buffer.from(input).toString("base64url");}
function publicRawFromJwk(jwk){return Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,"base64url"),Buffer.from(jwk.y,"base64url")]);}
function configuredHosts(value=process.env.PATAP_WEB_PUSH_HOSTS||""){return String(value).split(/[;,\s]+/).map(v=>v.trim().toLowerCase()).filter(Boolean);}
function allowedPushHost(hostname,extraHosts=[]){const host=String(hostname||"").toLowerCase();return [...DEFAULT_PUSH_HOSTS,...extraHosts].some(allowed=>host===allowed||(allowed.startsWith(".")&&host.endsWith(allowed)));}
function validatePushEndpoint(endpoint,{extraHosts=configuredHosts()}={}){
  try{const url=new URL(endpoint);if(url.protocol!=="https:"||url.username||url.password||(url.port&&url.port!=="443"))return false;return allowedPushHost(url.hostname,extraHosts);}catch{return false;}
}
function decodeBase64Url(value){try{return Buffer.from(String(value||""),"base64url");}catch{return null;}}
function validatePushSubscription(input){
  const p256dh=decodeBase64Url(input?.keys?.p256dh),auth=decodeBase64Url(input?.keys?.auth);
  return Boolean(p256dh&&p256dh.length===65&&p256dh[0]===4&&auth&&auth.length===16);
}
function cleanText(value,max){return String(value??"").normalize("NFKC").replace(/\s+/g," ").trim().slice(0,max);}
function normalizePriority(value){const key=String(value||"").toUpperCase();return PRIORITIES.has(key)?key:"NORMAL";}
function normalizeCategory(value){const key=String(value||"").toUpperCase();return CATEGORIES.has(key)?key:"SYSTEM";}

function ensureVapidKeys(dataDir){
  const dir=path.join(dataDir,"events"),file=path.join(dir,"vapid.json");fs.mkdirSync(dir,{recursive:true,mode:0o700});
  try{
    const stored=JSON.parse(fs.readFileSync(file,"utf8"));
    if(stored?.privateJwk?.d&&stored?.privateJwk?.x&&stored?.privateJwk?.y&&stored?.publicKey)return stored;
  }catch{}
  const {privateKey}=crypto.generateKeyPairSync("ec",{namedCurve:"prime256v1"});
  const privateJwk=privateKey.export({format:"jwk"});const publicKey=b64url(publicRawFromJwk(privateJwk));
  const stored={privateJwk,publicKey,createdAt:new Date().toISOString()};
  fs.writeFileSync(file,JSON.stringify(stored,null,2),{mode:0o600,flag:"wx"});return stored;
}

function vapidDetails(keys,subject="mailto:admin@patap.eu"){
  if(!keys?.publicKey||!keys?.privateJwk?.d)throw new Error("invalid_vapid_key_material");
  return {subject,publicKey:keys.publicKey,privateKey:keys.privateJwk.d};
}

function eventPushPayload(event,{showPreviews=false}={}){
  const eventId=Number(event?.id);if(!Number.isSafeInteger(eventId)||eventId<=0)throw new Error("invalid_push_event_id");
  const priority=normalizePriority(event?.priority),category=normalizeCategory(event?.category);
  const title=showPreviews?(cleanText(event?.title,160)||"PaTaP Driver"):"PaTaP Driver";
  const body=showPreviews?(cleanText(event?.preview,240)||"Новое событие в Driver"):"Новое событие в Driver";
  return JSON.stringify({v:1,eventId,category,priority,title,body});
}
function urgencyFor(priority){return priority==="URGENT"?"high":priority==="IMPORTANT"?"normal":priority==="NORMAL"?"low":"very-low";}
function ttlFor(priority){return priority==="URGENT"?120:3600;}

function createPushSender({dataDir,repo,subject="mailto:admin@patap.eu",sendNotificationImpl=webpush.sendNotification,now=()=>Date.now(),extraHosts=configuredHosts()}={}){
  let keys=null;
  function config(){try{keys ||= ensureVapidKeys(dataDir);return {supported:true,publicKey:keys.publicKey};}catch{return {supported:false,publicKey:null};}}
  function validateEndpoint(endpoint){return validatePushEndpoint(endpoint,{extraHosts});}
  function showPreviewsFor(userId){try{return repo.publicPreferences(repo.ensurePreferences(userId,new Date(now()).toISOString())).showPreviews!==false;}catch{return false;}}
  async function sendOne(subscription,event,{showPreviews=false}={}){
    if(!validateEndpoint(subscription?.endpoint))return {ok:false,revoke:true,status:0,error:"unsupported_push_endpoint"};
    if(!validatePushSubscription(subscription))return {ok:false,revoke:true,status:0,error:"invalid_push_subscription"};
    keys ||= ensureVapidKeys(dataDir);
    const priority=normalizePriority(event?.priority),payload=eventPushPayload(event,{showPreviews});
    const pushSubscription={endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh||subscription.keys?.p256dh,auth:subscription.auth||subscription.keys?.auth}};
    const options={vapidDetails:vapidDetails(keys,subject),TTL:ttlFor(priority),urgency:urgencyFor(priority),contentEncoding:"aes128gcm",topic:`evt-${Number(event.id)}`.slice(0,32),timeout:10000};
    try{
      const response=await sendNotificationImpl(pushSubscription,payload,options);const status=Number(response?.statusCode||201);
      return {ok:status>=200&&status<300,revoke:[404,410].includes(status),status};
    }catch(error){const status=Number(error?.statusCode||0);return {ok:false,revoke:[404,410].includes(status),status,error:"push_send_failed"};}
  }
  async function send(userId,event){
    const cfg=config();if(!cfg.supported)return {sent:0,failed:0,unsupported:true};let sent=0,failed=0;
    const showPreviews=showPreviewsFor(userId);
    for(const subscription of repo.activePushSubscriptions(userId)){
      const result=await sendOne(subscription,event,{showPreviews});
      if(result.ok){sent++;repo.pushSuccess(subscription.id);}else{failed++;repo.pushFailure(subscription.id,{revoke:result.revoke});}
    }
    return {sent,failed,unsupported:false};
  }
  return {config,send,sendOne,validateEndpoint,validateSubscription:validatePushSubscription,ensureVapidKeys:()=>ensureVapidKeys(dataDir)};
}

module.exports={createPushSender,ensureVapidKeys,vapidDetails,eventPushPayload,publicRawFromJwk,validatePushEndpoint,validatePushSubscription,DEFAULT_PUSH_HOSTS};
