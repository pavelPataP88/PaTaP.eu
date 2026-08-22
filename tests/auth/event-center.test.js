const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {DatabaseSync}=require("node:sqlite");

const runId=process.env.PATAP_TEST_RUN_ID;
const baseUrl=process.env.PATAP_AUTH_BASE_URL;
if(!runId||!baseUrl||!process.env.PATAP_DB_PATH||!process.env.PATAP_AUTH_SECRET_PATH)throw new Error("Auth tests must be started through scripts/run-auth-tests.js");
let seq=0,ip=230;

class Client{
  constructor(){this.cookies={};this.csrfToken=null;this.clientIp=`198.51.100.${++ip}`;}
  cookieHeader(){return Object.entries(this.cookies).map(([key,value])=>`${key}=${value}`).join("; ");}
  storeCookies(headers){for(const value of headers.getSetCookie?headers.getSetCookie():[]){const [pair]=value.split(";");const at=pair.indexOf("=");const key=pair.slice(0,at),raw=pair.slice(at+1);if(raw==="")delete this.cookies[key];else this.cookies[key]=raw;}}
  headers(extra={}){const headers={Origin:"http://127.0.0.1:8090","CF-Connecting-IP":this.clientIp,...extra};const cookie=this.cookieHeader();if(cookie)headers.Cookie=cookie;if(this.csrfToken)headers["X-CSRF-Token"]=this.csrfToken;return headers;}
  async request(pathname,options={}){const headers=this.headers({Accept:"application/json",...(options.headers||{})});if(options.body!==undefined)headers["Content-Type"]="application/json";const response=await fetch(`${baseUrl}${pathname}`,{...options,headers,body:options.body===undefined?undefined:JSON.stringify(options.body)});this.storeCookies(response.headers);const data=await response.json().catch(()=>({}));if(data.csrfToken)this.csrfToken=data.csrfToken;return {response,data};}
  async csrf(){return this.request("/api/csrf");}
}

async function createDriver(label){const client=new Client(),n=++seq,suffix=`${label}_${n}_${String(runId).slice(-6)}`;const username=`evt_${suffix}`.toLowerCase().replace(/[^a-z0-9_-]/g,"_").slice(0,32),nickname=`Event_${label}_${n}_${String(runId).slice(-5)}`.slice(0,32);await client.csrf();let r=await client.request("/api/register",{method:"POST",body:{username,email:`${username}@patap.test`,password:"event-center-123",confirmPassword:"event-center-123"}});assert.equal(r.response.status,201);r=await client.request("/api/driver/profile",{method:"PUT",body:{nickname,driverType:"TIR",countryCode:"PL",vehicle:"Event Truck"}});assert.ok([200,201].includes(r.response.status));return {client,nickname,username};}
async function setLocation(driver,latitude,longitude){let r=await driver.client.request("/api/driver/gps",{method:"PUT",body:{enabled:true}});assert.equal(r.response.status,200);r=await driver.client.request("/api/driver/location",{method:"PUT",body:{latitude,longitude,accuracy:8}});assert.equal(r.response.status,200);}
async function waitForEvent(driver,predicate,timeoutMs=5000){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){const r=await driver.client.request("/api/driver/events?includeSnoozed=1&limit=100");assert.equal(r.response.status,200);const event=(r.data.events||[]).find(predicate);if(event)return event;await new Promise(resolve=>setTimeout(resolve,100));}assert.fail("Timed out waiting for Event Center projection");}
async function waitOutbox(){const deadline=Date.now()+5000;while(Date.now()<deadline){const db=new DatabaseSync(process.env.PATAP_DB_PATH,{readOnly:true});let pending;try{pending=Number(db.prepare("SELECT COUNT(*) n FROM driver_event_outbox WHERE processed_at IS NULL").get().n||0);}finally{db.close();}if(!pending)return;await new Promise(resolve=>setTimeout(resolve,100));}assert.fail("Event outbox did not drain");}
async function readStreamUntil(reader,pattern,timeoutMs=3000){let text="";const deadline=Date.now()+timeoutMs;while(Date.now()<deadline&&text.length<16384){const remaining=Math.max(1,deadline-Date.now());const result=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(new Error("sse_read_timeout")),remaining))]);if(result.done)break;text+=Buffer.from(result.value||[]).toString("utf8");if(pattern.test(text))return text;}assert.match(text,pattern);return text;}
function messageId(){return `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;}
function pushKeys(){const ecdh=crypto.createECDH("prime256v1");ecdh.generateKeys();return {p256dh:ecdh.getPublicKey().toString("base64url"),auth:crypto.randomBytes(16).toString("base64url")};}

test("Event Center projects contact and direct-chat actions into durable actionable inbox events",async()=>{
  const sender=await createDriver("sender"),recipient=await createDriver("recipient");
  let r=await sender.client.request(`/api/driver/drivers/${encodeURIComponent(recipient.nickname)}/contact`,{method:"POST",body:{}});assert.equal(r.response.status,200);
  const requestEvent=await waitForEvent(recipient,event=>event.type==="people.contact_request"&&event.actor?.nickname===sender.nickname);
  assert.equal(requestEvent.priority,"IMPORTANT");assert.equal(requestEvent.route.kind,"PEOPLE_FILTER");assert.equal(requestEvent.route.filter,"REQUESTS");assert.equal(requestEvent.read,false);

  r=await recipient.client.request(`/api/driver/drivers/${encodeURIComponent(sender.nickname)}/contact`,{method:"POST",body:{}});assert.equal(r.response.status,200);assert.equal(r.data.driver.relationship,"CONTACT");
  const accepted=await waitForEvent(sender,event=>event.type==="people.contact_accepted"&&event.actor?.nickname===recipient.nickname);assert.equal(accepted.category,"PEOPLE");

  r=await sender.client.request("/api/driver/chat/direct",{method:"POST",body:{nickname:recipient.nickname}});assert.ok([200,201].includes(r.response.status));const roomId=r.data.room.id;
  r=await sender.client.request(`/api/driver/chat/rooms/${roomId}/messages`,{method:"POST",body:{clientMessageId:messageId(),text:"Нужна связь на следующей стоянке"}});assert.equal(r.response.status,201);
  const chatEvent=await waitForEvent(recipient,event=>event.type==="chat.direct"&&Number(event.route?.roomId)===Number(roomId));
  assert.equal(chatEvent.priority,"IMPORTANT");assert.equal(chatEvent.category,"CHAT");assert.equal(chatEvent.route.kind,"CHAT_ROOM");assert.match(chatEvent.preview,/стоянке/);

  r=await recipient.client.request(`/api/driver/events/${chatEvent.id}/snooze`,{method:"POST",body:{minutes:60}});assert.equal(r.response.status,200);assert.equal(r.data.event.snoozed,true);
  r=await recipient.client.request("/api/driver/events?unread=1&limit=100");assert.equal(r.response.status,200);assert.equal(r.data.events.some(event=>event.id===chatEvent.id),false);
  r=await recipient.client.request("/api/driver/events?unread=1&includeSnoozed=1&limit=100");assert.equal(r.response.status,200);assert.equal(r.data.events.some(event=>event.id===chatEvent.id),true);
  r=await recipient.client.request(`/api/driver/events/${chatEvent.id}`,{method:"PATCH",body:{read:true}});assert.equal(r.response.status,200);assert.equal(r.data.event.read,true);
  r=await recipient.client.request(`/api/driver/events/${chatEvent.id}/archive`,{method:"POST",body:{}});assert.equal(r.response.status,200);assert.equal(r.data.archived,true);
});

test("Event Center creates URGENT nearby road events and exposes SSE readiness",async()=>{
  const reporter=await createDriver("road_reporter"),nearby=await createDriver("road_nearby");await setLocation(reporter,50.2649,19.0238);await setLocation(nearby,50.2660,19.0250);
  const controller=new AbortController();const response=await fetch(`${baseUrl}/api/driver/events/stream`,{headers:nearby.client.headers({Accept:"text/event-stream"}),signal:controller.signal});assert.equal(response.status,200);assert.match(response.headers.get("content-type")||"",/text\/event-stream/);const reader=response.body.getReader();try{await readStreamUntil(reader,/event\.ready/);}finally{controller.abort();}

  let r=await reporter.client.request("/api/driver/road-reports",{method:"POST",body:{type:"ACCIDENT",latitude:50.2649,longitude:19.0238,lane:"ALL"}});assert.equal(r.response.status,201);
  const event=await waitForEvent(nearby,item=>item.type==="road.accident"&&item.source.kind==="ROAD_REPORT");assert.equal(event.priority,"URGENT");assert.equal(event.route.kind,"ROAD_REPORT");assert.ok(event.data.distanceKm<3);
});

test("Event Center preferences schema and Web Push boundary are enforced",async()=>{
  const driver=await createDriver("settings");let r=await driver.client.request("/api/driver/events/overview");assert.equal(r.response.status,200);assert.equal(r.data.preferences.enabled,true);assert.ok(r.data.categories.CHAT);assert.equal(typeof r.data.counts.unread,"number");
  r=await driver.client.request("/api/driver/events/preferences",{method:"PATCH",body:{drivingMode:true,quietEnabled:true,quietStart:"21:30",quietEnd:"06:15",timezone:"Europe/Warsaw",showPreviews:false,inAppPopups:false}});assert.equal(r.response.status,200);assert.equal(r.data.preferences.drivingMode,true);assert.equal(r.data.preferences.showPreviews,false);
  r=await driver.client.request("/api/driver/events/categories/CHAT",{method:"PATCH",body:{inboxEnabled:true,pushEnabled:false,minPriority:"IMPORTANT"}});assert.equal(r.response.status,200);assert.equal(r.data.preference.minPriority,"IMPORTANT");assert.equal(r.data.preference.pushEnabled,false);
  r=await driver.client.request("/api/driver/events/push-config");assert.equal(r.response.status,200);assert.equal(r.data.supported,true);assert.ok(typeof r.data.publicKey==="string"&&r.data.publicKey.length>80);
  r=await driver.client.request("/api/driver/events/push-subscriptions",{method:"POST",body:{endpoint:"https://example.test/push",keys:{p256dh:"x",auth:"y"}}});assert.equal(r.response.status,400);assert.equal(r.data.error,"unsupported_push_endpoint");
  await waitOutbox();
  const endpoint="https://fcm.googleapis.com/fcm/send/patap-test-subscription";
  r=await driver.client.request("/api/driver/events/push-subscriptions",{method:"POST",body:{endpoint,keys:{p256dh:"test-p256dh",auth:"test-auth"}}});assert.equal(r.response.status,400);assert.equal(r.data.error,"invalid_push_subscription");
  r=await driver.client.request("/api/driver/events/push-subscriptions",{method:"POST",body:{endpoint,keys:pushKeys()}});assert.equal(r.response.status,201);assert.equal(r.data.subscribed,true);
  r=await driver.client.request("/api/driver/events/overview");assert.equal(r.data.push.subscriptions,1);
  r=await driver.client.request("/api/driver/events/push-subscriptions",{method:"DELETE",body:{endpoint}});assert.equal(r.response.status,200);assert.equal(r.data.unsubscribed,true);

  const db=new DatabaseSync(process.env.PATAP_DB_PATH,{readOnly:true});try{assert.equal(Number(db.prepare("SELECT MAX(version) version FROM schema_migrations").get().version),12);assert.equal(Number(db.prepare("SELECT version FROM driver_event_schema_meta WHERE singleton=1").get().version),2);for(const table of ["driver_events","driver_event_preferences","driver_event_category_preferences","driver_event_source_overrides","driver_event_outbox","driver_push_subscriptions"])assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));const columns=new Set(db.prepare("PRAGMA table_info(driver_event_outbox)").all().map(row=>row.name));assert.ok(columns.has("status"));assert.ok(columns.has("failed_at"));}finally{db.close();}
});
