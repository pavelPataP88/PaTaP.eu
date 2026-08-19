const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");

const runId = process.env.PATAP_TEST_RUN_ID;
const baseUrl = process.env.PATAP_AUTH_BASE_URL;
if (!runId || !baseUrl || !process.env.PATAP_DB_PATH || !process.env.PATAP_AUTH_SECRET_PATH) {
  throw new Error("Auth tests must be started through scripts/run-auth-tests.js");
}

let sequence = 0;
let ipSequence = 150;

class Client {
  constructor() { this.cookies = {}; this.csrfToken = null; this.clientIp = `198.51.100.${++ipSequence}`; }
  cookieHeader() { return Object.entries(this.cookies).map(([key,value]) => `${key}=${value}`).join("; "); }
  storeCookies(headers) {
    for (const value of headers.getSetCookie ? headers.getSetCookie() : []) {
      const [pair] = value.split(";"); const index = pair.indexOf("="); const key = pair.slice(0,index); const raw = pair.slice(index+1);
      if (raw === "") delete this.cookies[key]; else this.cookies[key] = raw;
    }
  }
  headers(extra={}) { const headers={Origin:"http://127.0.0.1:8090","CF-Connecting-IP":this.clientIp,...extra};const cookie=this.cookieHeader();if(cookie)headers.Cookie=cookie;if(this.csrfToken)headers["X-CSRF-Token"]=this.csrfToken;return headers; }
  async request(pathname, options={}) { const headers=this.headers({Accept:"application/json",...(options.headers||{})});if(options.body!==undefined)headers["Content-Type"]="application/json";const response=await fetch(`${baseUrl}${pathname}`,{...options,headers,body:options.body===undefined?undefined:JSON.stringify(options.body)});this.storeCookies(response.headers);const data=await response.json().catch(()=>({}));if(data.csrfToken)this.csrfToken=data.csrfToken;return {response,data}; }
  async csrf(){ return this.request("/api/csrf"); }
}

async function createDriver(label) {
  const client = new Client(); const id=++sequence; const suffix=`${label}_${id}_${String(runId).slice(-6)}`;
  const username=`people_${suffix}`.toLowerCase().replace(/[^a-z0-9_-]/g,"_").slice(0,32);
  const nickname=`People_${label}_${id}_${String(runId).slice(-5)}`.slice(0,32);
  await client.csrf();
  let result=await client.request("/api/register",{method:"POST",body:{username,email:`${username}@patap.test`,password:"people-test-123",confirmPassword:"people-test-123"}});
  assert.equal(result.response.status,201);
  result=await client.request("/api/driver/profile",{method:"PUT",body:{nickname,driverType:"TIR",countryCode:"PL",vehicle:`Truck ${id}`}});
  assert.ok([200,201].includes(result.response.status));
  return {client,nickname};
}

async function makeContacts(left,right) {
  let result=await left.client.request(`/api/driver/drivers/${encodeURIComponent(right.nickname)}/contact`,{method:"POST",body:{}});assert.equal(result.response.status,200);
  result=await right.client.request(`/api/driver/drivers/${encodeURIComponent(left.nickname)}/contact`,{method:"POST",body:{}});assert.equal(result.response.status,200);assert.equal(result.data.driver.relationship,"CONTACT");
}

async function enableLocation(driver, latitude, longitude) {
  let result=await driver.client.request("/api/driver/gps",{method:"PUT",body:{enabled:true}});assert.equal(result.response.status,200);
  result=await driver.client.request("/api/driver/location",{method:"PUT",body:{latitude,longitude,accuracy:8}});assert.equal(result.response.status,200);
}

test("People privacy controls discovery and exact map visibility without weakening contacts", async()=>{
  const owner=await createDriver("privacy_owner"); const trusted=await createDriver("privacy_target"); const outsider=await createDriver("privacy_outsider");
  await makeContacts(owner,trusted);
  await enableLocation(owner,50.2649,19.0238); await enableLocation(trusted,50.2660,19.0260);

  let result=await trusted.client.request("/api/driver/people/settings",{method:"PATCH",body:{discoverability:"HIDDEN",nearbyVisibility:"TRUSTED",vehicleVisibility:"CONTACTS"}});
  assert.equal(result.response.status,200);

  result=await outsider.client.request(`/api/driver/people/search?q=${encodeURIComponent(trusted.nickname)}`);
  assert.equal(result.response.status,200);assert.equal(result.data.drivers.some((item)=>item.nickname===trusted.nickname),false);
  result=await owner.client.request(`/api/driver/people/search?q=${encodeURIComponent(trusted.nickname)}`);
  assert.equal(result.response.status,200);assert.equal(result.data.drivers.some((item)=>item.nickname===trusted.nickname),true,"accepted contacts remain discoverable");

  result=await owner.client.request("/api/driver/people/nearby?radius=5");
  assert.equal(result.response.status,200);assert.equal(result.data.people.some((item)=>item.nickname===trusted.nickname),false,"TRUSTED is directional and target has not trusted viewer yet");
  result=await owner.client.request("/api/driver/nearby",{method:"POST",body:{radius:5}});
  assert.equal(result.response.status,200);assert.equal(result.data.drivers.some((item)=>item.nickname===trusted.nickname),false,"legacy map endpoint must honor People privacy too");

  result=await trusted.client.request(`/api/driver/people/contacts/${encodeURIComponent(owner.nickname)}/preferences`,{method:"PATCH",body:{trusted:true,favorite:true,privateNote:"Проверенный водитель"}});
  assert.equal(result.response.status,200);assert.equal(result.data.person.trusted,true);

  result=await owner.client.request("/api/driver/people/nearby?radius=5");
  assert.equal(result.response.status,200);const nearby=result.data.people.find((item)=>item.nickname===trusted.nickname);assert.ok(nearby);assert.equal(typeof nearby.distanceKm,"number");assert.equal("latitude" in nearby,false);assert.equal("longitude" in nearby,false);
  result=await owner.client.request("/api/driver/nearby",{method:"POST",body:{radius:5}});
  assert.equal(result.response.status,200);const mapDriver=result.data.drivers.find((item)=>item.nickname===trusted.nickname);assert.ok(mapDriver);assert.equal(typeof mapDriver.latitude,"number");assert.equal(typeof mapDriver.longitude,"number");
});

test("Community synchronizes membership roles bans and links across People Chat and Radio", async()=>{
  const owner=await createDriver("community_owner");const member=await createDriver("community_member");const outsider=await createDriver("community_outsider");
  await makeContacts(owner,member);

  let result=await owner.client.request("/api/driver/people/communities",{method:"POST",body:{title:"Silesia TIR Test",description:"Синхронное сообщество",visibility:"PRIVATE",category:"TIR",countryCode:"PL"}});
  assert.equal(result.response.status,201);const community=result.data.community;assert.ok(community.id);assert.ok(community.chatRoomId);assert.ok(community.radioChannelId);assert.equal(community.role,"OWNER");

  result=await owner.client.request(`/api/driver/chat/groups/${community.chatRoomId}/invites`,{method:"POST",body:{nickname:member.nickname}});
  assert.equal(result.response.status,409);assert.equal(result.data.error,"community_managed");
  result=await owner.client.request(`/api/driver/radio/channels/${community.radioChannelId}/invites`,{method:"POST",body:{nickname:member.nickname}});
  assert.equal(result.response.status,409);assert.equal(result.data.error,"community_managed");

  result=await owner.client.request(`/api/driver/people/communities/${community.id}/invites`,{method:"POST",body:{nickname:member.nickname}});
  assert.equal(result.response.status,200);
  result=await member.client.request("/api/driver/people/overview");assert.equal(result.response.status,200);assert.ok(result.data.communityInvites.some((item)=>item.communityId===community.id));
  result=await member.client.request(`/api/driver/people/community-invites/${community.id}/respond`,{method:"POST",body:{action:"ACCEPT"}});assert.equal(result.response.status,200);assert.equal(result.data.accepted,true);

  result=await member.client.request("/api/driver/chat/overview");assert.ok(result.data.rooms.some((room)=>room.id===community.chatRoomId));
  result=await member.client.request("/api/driver/radio/overview");assert.ok(result.data.channels.some((channel)=>channel.id===community.radioChannelId));

  result=await owner.client.request(`/api/driver/people/communities/${community.id}/members/${encodeURIComponent(member.nickname)}`,{method:"PATCH",body:{role:"MODERATOR"}});assert.equal(result.response.status,200);
  result=await owner.client.request(`/api/driver/chat/rooms/${community.chatRoomId}`);assert.equal(result.response.status,200);assert.equal(result.data.members.find((item)=>item.nickname===member.nickname)?.role,"MODERATOR");
  result=await owner.client.request(`/api/driver/radio/channels/${community.radioChannelId}/members`);assert.equal(result.response.status,200);assert.equal(result.data.members.find((item)=>item.nickname===member.nickname)?.role,"MODERATOR");

  result=await owner.client.request(`/api/driver/people/communities/${community.id}/members/${encodeURIComponent(member.nickname)}`,{method:"DELETE",body:{ban:true}});assert.equal(result.response.status,200);assert.equal(result.data.banned,true);
  result=await member.client.request("/api/driver/chat/overview");assert.equal(result.data.rooms.some((room)=>room.id===community.chatRoomId),false);
  result=await member.client.request("/api/driver/radio/overview");assert.equal(result.data.channels.some((channel)=>channel.id===community.radioChannelId),false);
  result=await owner.client.request(`/api/driver/people/communities/${community.id}`);assert.ok(result.data.bans.some((item)=>item.nickname===member.nickname));

  result=await owner.client.request(`/api/driver/people/communities/${community.id}/bans/${encodeURIComponent(member.nickname)}`,{method:"DELETE",body:{}});assert.equal(result.response.status,200);

  result=await owner.client.request("/api/driver/people/communities",{method:"POST",body:{title:"Open Driver Test",description:"Открытое сообщество",visibility:"PUBLIC",category:"GENERAL",countryCode:""}});assert.equal(result.response.status,201);const publicCommunity=result.data.community;
  result=await outsider.client.request(`/api/driver/radio/channels/${publicCommunity.radioChannelId}/join`,{method:"POST",body:{}});assert.equal(result.response.status,409);assert.equal(result.data.error,"community_managed");
  result=await outsider.client.request(`/api/driver/people/communities/${publicCommunity.id}/join`,{method:"POST",body:{}});assert.equal(result.response.status,200);assert.equal(result.data.community.joined,true);
});

test("People schema stays module-local and global auth migration remains 12",()=>{
  const db=new DatabaseSync(process.env.PATAP_DB_PATH,{readOnly:true});
  try { assert.equal(Number(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version),12);assert.equal(Number(db.prepare("SELECT version FROM people_schema_meta WHERE singleton=1").get().version),1); }
  finally { db.close(); }
});
