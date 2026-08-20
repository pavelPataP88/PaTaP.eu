const test=require("node:test");
const assert=require("node:assert/strict");

const runId=process.env.PATAP_TEST_RUN_ID;
const baseUrl=process.env.PATAP_AUTH_BASE_URL;
const providerBase=process.env.PATAP_NAV_TEST_BASE_URL;
if(!runId||!baseUrl||!providerBase)throw new Error("Navigation search tests must be started through scripts/run-auth-tests.js");
let seq=0,ip=110;
class Client{
  constructor(){this.cookies={};this.csrfToken=null;this.clientIp=`192.0.2.${++ip}`;}
  cookieHeader(){return Object.entries(this.cookies).map(([k,v])=>`${k}=${v}`).join("; ");}
  storeCookies(headers){for(const value of headers.getSetCookie?headers.getSetCookie():[]){const [pair]=value.split(";");const at=pair.indexOf("=");const key=pair.slice(0,at),raw=pair.slice(at+1);if(raw==="")delete this.cookies[key];else this.cookies[key]=raw;}}
  headers(extra={}){const h={Origin:"http://127.0.0.1:8090","CF-Connecting-IP":this.clientIp,...extra},cookie=this.cookieHeader();if(cookie)h.Cookie=cookie;if(this.csrfToken)h["X-CSRF-Token"]=this.csrfToken;return h;}
  async request(pathname,options={}){const headers=this.headers({Accept:"application/json",...(options.headers||{})});if(options.body!==undefined)headers["Content-Type"]="application/json";const response=await fetch(`${baseUrl}${pathname}`,{...options,headers,body:options.body===undefined?undefined:JSON.stringify(options.body)});this.storeCookies(response.headers);const data=await response.json().catch(()=>({}));if(data.csrfToken)this.csrfToken=data.csrfToken;return {response,data};}
  async csrf(){return this.request("/api/csrf");}
}
async function driver(){const client=new Client(),n=++seq,tag=`${n}_${String(runId).slice(-6)}`,username=`nav_search_${tag}`.slice(0,32),nickname=`NavSearch_${tag}`.slice(0,32);await client.csrf();let r=await client.request("/api/register",{method:"POST",body:{username,email:`${username}@patap.test`,password:"nav-search-123",confirmPassword:"nav-search-123"}});assert.equal(r.response.status,201);r=await client.request("/api/driver/profile",{method:"PUT",body:{nickname,driverType:"TIR",countryCode:"PL",vehicle:"Search TIR"}});assert.ok([200,201].includes(r.response.status));return client;}

test("Navigation search combines PaTaP Parking and configured place provider without fabricating results",async()=>{
  const client=await driver();let r=await client.request("/api/driver/parking/places",{method:"POST",body:{name:"Warehouse Route Stop",latitude:50.2654,longitude:19.0241,countryCode:"PL",kind:"TRUCK_PARKING"}});assert.equal(r.response.status,201);const parkingId=r.data.place.id;
  r=await client.request("/api/driver/navigation/search?q=Warehouse&lat=50.2649&lon=19.0238&limit=8");assert.equal(r.response.status,200);assert.equal(r.data.partial,false);assert.equal(r.data.geocoderConfigured,true);assert.ok(r.data.results.some(item=>item.kind==="PARKING"&&item.parkingId===parkingId&&item.provider==="PATAP_PARKING"));assert.ok(r.data.results.some(item=>item.kind==="PLACE"&&item.provider==="NOMINATIM_COMPAT"));
  const fixture=await (await fetch(`${providerBase}/__test/requests`)).json();const search=fixture.searches.find(item=>item.q==="Warehouse");assert.ok(search);assert.match(search.headers["user-agent"]||"",/PaTaP-Driver-Navigation/);
  r=await client.request("/api/driver/navigation/search?q=x");assert.equal(r.response.status,200);assert.deepEqual(r.data.results,[]);
});

test("Navigation search exposes geocoder failure and malformed responses instead of sample destinations",async()=>{
  const client=await driver();let r=await client.request("/api/driver/navigation/search?q=fail&limit=5");assert.equal(r.response.status,503);assert.equal(r.data.error,"navigation_geocoder_unavailable");
  r=await client.request("/api/driver/navigation/search?q=broken&limit=5");assert.equal(r.response.status,502);assert.equal(r.data.error,"navigation_geocoder_invalid_response");
});
