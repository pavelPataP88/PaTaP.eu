const test=require("node:test");
const assert=require("node:assert/strict");
const { DatabaseSync }=require("node:sqlite");

const runId=process.env.PATAP_TEST_RUN_ID;
const baseUrl=process.env.PATAP_AUTH_BASE_URL;
if(!runId||!baseUrl||!process.env.PATAP_DB_PATH||!process.env.PATAP_AUTH_SECRET_PATH)throw new Error("Auth tests must be started through scripts/run-auth-tests.js");
let seq=0,ip=200;
class Client{
  constructor(){this.cookies={};this.csrfToken=null;this.clientIp=`198.51.100.${++ip}`;}
  cookieHeader(){return Object.entries(this.cookies).map(([k,v])=>`${k}=${v}`).join("; ");}
  storeCookies(headers){for(const value of headers.getSetCookie?headers.getSetCookie():[]){const [pair]=value.split(";");const at=pair.indexOf("=");const k=pair.slice(0,at),v=pair.slice(at+1);if(v==="")delete this.cookies[k];else this.cookies[k]=v;}}
  headers(extra={}){const h={Origin:"http://127.0.0.1:8090","CF-Connecting-IP":this.clientIp,...extra};const cookie=this.cookieHeader();if(cookie)h.Cookie=cookie;if(this.csrfToken)h["X-CSRF-Token"]=this.csrfToken;return h;}
  async request(pathname,options={}){const headers=this.headers({Accept:"application/json",...(options.headers||{})});if(options.body!==undefined)headers["Content-Type"]="application/json";const response=await fetch(`${baseUrl}${pathname}`,{...options,headers,body:options.body===undefined?undefined:JSON.stringify(options.body)});this.storeCookies(response.headers);const data=await response.json().catch(()=>({}));if(data.csrfToken)this.csrfToken=data.csrfToken;return {response,data};}
  async csrf(){return this.request("/api/csrf");}
  async binary(pathname,bytes,type="image/jpeg",name="parking.jpg"){const response=await fetch(`${baseUrl}${pathname}`,{method:"POST",headers:this.headers({Accept:"application/json","Content-Type":type,"X-File-Name":name}),body:bytes});this.storeCookies(response.headers);const data=await response.json().catch(()=>({}));return {response,data};}
}
async function createDriver(label){const client=new Client(),id=++seq,suffix=`${label}_${id}_${String(runId).slice(-6)}`;const username=`park_${suffix}`.toLowerCase().replace(/[^a-z0-9_-]/g,"_").slice(0,32),nickname=`Park_${label}_${id}_${String(runId).slice(-5)}`.slice(0,32);await client.csrf();let r=await client.request("/api/register",{method:"POST",body:{username,email:`${username}@patap.test`,password:"parking-test-123",confirmPassword:"parking-test-123"}});assert.equal(r.response.status,201);r=await client.request("/api/driver/profile",{method:"PUT",body:{nickname,driverType:"TIR",countryCode:"PL",vehicle:"Test Truck"}});assert.ok([200,201].includes(r.response.status));return {client,nickname};}
async function setLocation(driver,latitude,longitude){let r=await driver.client.request("/api/driver/gps",{method:"PUT",body:{enabled:true}});assert.equal(r.response.status,200);r=await driver.client.request("/api/driver/location",{method:"PUT",body:{latitude,longitude,accuracy:8}});assert.equal(r.response.status,200);}

async function createPlace(driver,name,latitude,longitude,extra={}){const r=await driver.client.request("/api/driver/parking/places",{method:"POST",body:{name,latitude,longitude,kind:"TRUCK_PARKING",capacityTruck:50,toilet:true,shower:true,cctv:true,lighting:true,...extra}});assert.equal(r.response.status,201);return r.data.place;}

test("Parking Network supports canonical place search vehicle fit favorites reviews and corrections",async()=>{
  const driver=await createDriver("core");await setLocation(driver,50.2649,19.0238);
  const place=await createPlace(driver,"PaTaP Test Parking",50.2660,19.0250,{maxHeightM:4.1,adrAllowed:false,frigoPower:true});
  let r=await driver.client.request("/api/driver/parking/preferences",{method:"PATCH",body:{vehicleClass:"TIR",lengthM:16.5,heightM:4.2,weightT:40,adrRequired:true,refrigerated:true,secureOnly:false,maxDetourKm:20}});assert.equal(r.response.status,200);assert.equal(r.data.preferences.heightM,4.2);
  r=await driver.client.request("/api/driver/parking/search?lat=50.2649&lon=19.0238&radiusKm=10&amenities=shower&security=cctv");assert.equal(r.response.status,200);const found=r.data.places.find(p=>p.id===place.id);assert.ok(found);assert.equal(found.fit.compatible,false);assert.ok(found.fit.issues.includes("height_limit"));assert.ok(found.fit.issues.includes("adr_not_supported"));
  r=await driver.client.request(`/api/driver/parking/places/${place.id}/favorite`,{method:"PUT",body:{enabled:true}});assert.equal(r.response.status,200);assert.equal(r.data.favorite,true);
  r=await driver.client.request(`/api/driver/parking/places/${place.id}/review`,{method:"PUT",body:{overall:5,security:4,cleanliness:4,access:5,quietness:3,text:"Тестовый отзыв"}});assert.equal(r.response.status,200);assert.equal(r.data.reviews.overall,5);
  r=await driver.client.request(`/api/driver/parking/places/${place.id}/corrections`,{method:"POST",body:{kind:"CAPACITY",message:"Проверить количество мест"}});assert.equal(r.response.status,201);assert.equal(r.data.correction.state,"OPEN");
  r=await driver.client.request(`/api/driver/parking/places/${place.id}?lat=50.2649&lon=19.0238`);assert.equal(r.response.status,200);assert.equal(r.data.place.favorite,true);assert.equal(r.data.place.status,"COMMUNITY_UNVERIFIED");assert.equal(r.data.place.reviews.count,1);assert.ok(r.data.place.sources.some(s=>s.type==="PATAP_COMMUNITY"));
});

test("Parking live occupancy requires a fresh nearby Driver GPS position and returns consensus metadata",async()=>{
  const near=await createDriver("near");const far=await createDriver("far");await setLocation(near,50.2649,19.0238);await setLocation(far,50.5000,19.5000);const place=await createPlace(near,"Live Parking",50.2652,19.0243);
  let r=await far.client.request(`/api/driver/parking/places/${place.id}/occupancy`,{method:"POST",body:{status:"FULL"}});assert.equal(r.response.status,400);assert.equal(r.data.error,"parking_report_too_far");
  r=await near.client.request(`/api/driver/parking/places/${place.id}/occupancy`,{method:"POST",body:{status:"AVAILABLE",freeSpots:20,totalSpots:50}});assert.equal(r.response.status,200);assert.equal(r.data.occupancy.status,"AVAILABLE");assert.equal(r.data.occupancy.source,"DRIVER");assert.equal(r.data.occupancy.predicted,false);assert.ok(r.data.occupancy.confidence>0);
  r=await near.client.request(`/api/driver/parking/places/${place.id}`);assert.equal(r.response.status,200);assert.equal(r.data.place.occupancy.status,"AVAILABLE");assert.equal(r.data.place.occupancy.sampleCount,1);
});

test("Parking along-route search and Plan B keep FULL parking visible but rank usable alternatives",async()=>{
  const driver=await createDriver("route");await setLocation(driver,50.2700,19.0300);const full=await createPlace(driver,"Full Near",50.2705,19.0305),open=await createPlace(driver,"Open Alternative",50.2800,19.0400);
  let r=await driver.client.request(`/api/driver/parking/places/${full.id}/occupancy`,{method:"POST",body:{status:"FULL"}});assert.equal(r.response.status,200);
  r=await driver.client.request(`/api/driver/parking/places/${open.id}/occupancy`,{method:"POST",body:{status:"AVAILABLE"}});assert.equal(r.response.status,200);
  r=await driver.client.request("/api/driver/parking/along-route",{method:"POST",body:{points:[{lat:50.269,lon:19.029},{lat:50.29,lon:19.05}],corridorKm:5,limit:20}});assert.equal(r.response.status,200);const ids=r.data.places.map(p=>p.id);assert.ok(ids.includes(full.id));assert.ok(ids.includes(open.id));assert.ok(ids.indexOf(open.id)<ids.indexOf(full.id),"AVAILABLE alternative should rank above FULL parking despite small distance difference");
  r=await driver.client.request(`/api/driver/parking/places/${full.id}`);assert.equal(r.response.status,200);assert.ok(r.data.alternatives.some(p=>p.id===open.id));
});

test("Parking photo upload validates bytes, serves authenticated private media and uploader can remove it",async()=>{
  const driver=await createDriver("photo");const place=await createPlace(driver,"Photo Parking",50.32,19.11);
  let r=await driver.client.binary(`/api/driver/parking/places/${place.id}/photos`,Buffer.from("not-an-image"),"image/jpeg","fake.jpg");assert.equal(r.response.status,415);assert.equal(r.data.error,"invalid_parking_photo_signature");
  const bytes=Buffer.from([0xff,0xd8,0xff,0xdb,0x00,0x43,0x00,0x01,0x02,0x03]);r=await driver.client.binary(`/api/driver/parking/places/${place.id}/photos`,bytes,"image/jpeg","test.jpg");assert.equal(r.response.status,201);const photoId=r.data.photo.id;assert.ok(photoId);
  const get=await fetch(`${baseUrl}/api/driver/parking/photos/${photoId}/content`,{headers:driver.client.headers()});assert.equal(get.status,200);assert.equal(get.headers.get("x-content-type-options"),"nosniff");assert.match(get.headers.get("cache-control")||"",/no-store/);assert.deepEqual(Buffer.from(await get.arrayBuffer()),bytes);
  r=await driver.client.request(`/api/driver/parking/photos/${photoId}`,{method:"DELETE",body:{}});assert.equal(r.response.status,200);const gone=await fetch(`${baseUrl}/api/driver/parking/photos/${photoId}/content`,{headers:driver.client.headers()});assert.equal(gone.status,404);
});

test("Parking schema is additive and global auth migration remains 12",()=>{const db=new DatabaseSync(process.env.PATAP_DB_PATH,{readOnly:true});try{assert.equal(Number(db.prepare("SELECT MAX(version) version FROM schema_migrations").get().version),12);assert.equal(Number(db.prepare("SELECT version FROM parking_schema_meta WHERE singleton=1").get().version),1);for(const table of ["parking_places","parking_place_sources","parking_occupancy_observations","parking_reviews","parking_favorites","parking_user_preferences","parking_corrections","parking_photos","parking_import_runs"])assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));}finally{db.close();}});
