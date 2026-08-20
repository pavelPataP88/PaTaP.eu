const fs=require("fs");
const path=require("path");
const crypto=require("crypto");

const DEFAULT_PUSH_HOSTS=Object.freeze(["fcm.googleapis.com","updates.push.services.mozilla.com","web.push.apple.com"]);
function b64url(input){return Buffer.from(input).toString("base64url");}
function publicRawFromJwk(jwk){return Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,"base64url"),Buffer.from(jwk.y,"base64url")]);}
function configuredHosts(value=process.env.PATAP_WEB_PUSH_HOSTS||""){return String(value).split(/[;,\s]+/).map(v=>v.trim().toLowerCase()).filter(Boolean);}
function allowedPushHost(hostname,extraHosts=[]){const host=String(hostname||"").toLowerCase();return [...DEFAULT_PUSH_HOSTS,...extraHosts].some(allowed=>host===allowed||(allowed.startsWith(".")&&host.endsWith(allowed)));}
function validatePushEndpoint(endpoint,{extraHosts=configuredHosts()}={}){
  try{const url=new URL(endpoint);if(url.protocol!=="https:"||url.username||url.password||(url.port&&url.port!=="443"))return false;return allowedPushHost(url.hostname,extraHosts);}catch{return false;}
}
function safeOrigin(endpoint){try{const u=new URL(endpoint);return u.protocol==="https:"?u.origin:null;}catch{return null;}}

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

function vapidJwt(privateJwk,audience,{subject="mailto:admin@patap.eu",now=Date.now()}={}){
  const header=b64url(JSON.stringify({typ:"JWT",alg:"ES256"}));
  const payload=b64url(JSON.stringify({aud:audience,exp:Math.floor(now/1000)+12*60*60,sub:subject}));
  const unsigned=`${header}.${payload}`;
  const key=crypto.createPrivateKey({key:privateJwk,format:"jwk"});
  const signature=crypto.sign("sha256",Buffer.from(unsigned),{key,dsaEncoding:"ieee-p1363"});
  return `${unsigned}.${b64url(signature)}`;
}

function createPushSender({dataDir,repo,subject="mailto:admin@patap.eu",fetchImpl=globalThis.fetch,now=()=>Date.now(),extraHosts=configuredHosts()}={}){
  let keys=null;
  function config(){try{keys ||= ensureVapidKeys(dataDir);return {supported:true,publicKey:keys.publicKey};}catch{return {supported:false,publicKey:null};}}
  function validateEndpoint(endpoint){return validatePushEndpoint(endpoint,{extraHosts});}
  async function sendOne(subscription,event){
    if(!validateEndpoint(subscription.endpoint))return {ok:false,revoke:true,status:0};
    const origin=safeOrigin(subscription.endpoint);if(!origin)return {ok:false,revoke:true,status:0};
    keys ||= ensureVapidKeys(dataDir);const token=vapidJwt(keys.privateJwk,origin,{subject,now:now()});
    let response;
    try{response=await fetchImpl(subscription.endpoint,{method:"POST",headers:{TTL:event.priority==="URGENT"?"120":"3600",Urgency:event.priority==="URGENT"?"high":event.priority==="IMPORTANT"?"normal":"low",Authorization:`vapid t=${token}, k=${keys.publicKey}`}});}catch{return {ok:false,revoke:false,status:0};}
    return {ok:response.ok,revoke:[404,410].includes(response.status),status:response.status};
  }
  async function send(userId,event){
    const cfg=config();if(!cfg.supported)return {sent:0,failed:0,unsupported:true};let sent=0,failed=0;
    for(const subscription of repo.activePushSubscriptions(userId)){
      const result=await sendOne(subscription,event);
      if(result.ok){sent++;repo.pushSuccess(subscription.id);}else{failed++;repo.pushFailure(subscription.id,{revoke:result.revoke});}
    }
    return {sent,failed,unsupported:false};
  }
  return {config,send,validateEndpoint,ensureVapidKeys:()=>ensureVapidKeys(dataDir),vapidJwt};
}

module.exports={createPushSender,ensureVapidKeys,vapidJwt,publicRawFromJwk,validatePushEndpoint,DEFAULT_PUSH_HOSTS};
