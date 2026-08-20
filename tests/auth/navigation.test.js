const test=require("node:test");
const assert=require("node:assert/strict");
const {DatabaseSync}=require("node:sqlite");

const runId=process.env.PATAP_TEST_RUN_ID;
const baseUrl=process.env.PATAP_AUTH_BASE_URL;
const providerBase=process.env.PATAP_NAV_TEST_BASE_URL;
if(!runId||!baseUrl||!providerBase||!process.env.PATAP_DB_PATH||!process.env.PATAP_AUTH_SECRET_PATH)throw new Error("Navigation auth tests must be started through scripts/run-auth-tests.js");

let seq=0,ip=230;
class Client{
  constructor(){this.cookies={};this.csrfToken=null;this.clientIp=`198.51.100.${++ip}`;}
  cookieHeader(){return Object.entries(this.cookies).map(([k,v])=>`${k}=${v}`).join("; ");}
  storeCookies(headers){for(const value of headers.getSetCookie?headers.getSetCookie():[]){const [pair]=value.split(";");const at=pair.indexOf("=");const k=pair.slice(0,at),v=pair.slice(at+1);if(v==="")delete this.cookies[k];else this.cookies[k]=v;}}
  headers(extra={}){const headers={Origin:"http://127.0.0.1:8090","CF-Connecting-IP":this.clientIp,...extra};const cookie=this.cookieHeader();if(cookie)headers.Cookie=cookie;if(this.csrfToken)headers["X-CSRF-Token"]=this.csrfToken;return headers;}
  async request(pathname,options={}){const headers=this.headers({Accept:"application/json",...(options.headers||{})});if(options.body!==undefined)headers["Content-Type"]="application/json";const response=await fetch(`${baseUrl}${pathname}`,{...options,headers,body:options.body===undefined?undefined:JSON.stringify(options.body)});this.storeCookies(response.headers);const data=await response.json().catch(()=>({}));if(data.csrfToken)this.csrfToken=data.csrfToken;return {response,data};}
  async csrf(){return this.request("/api/csrf");}
}
function unique(prefix){return `${prefix}_${++seq}_${String(runId).slice(-6)}`.toLowerCase().replace(/[^a-z0-9_-]/g,"_").slice(0,32);}
async function createDriver(label="nav"){
  const client=new Client(),username=unique(`nav_${label}`),nickname=`Nav_${label}_${seq}_${String(runId).slice(-4)}`.slice(0,32);
  await client.csrf();
  let r=await client.request("/api/register",{method:"POST",body:{username,email:`${username}@patap.test`,password:"navigation-test-123",confirmPassword:"navigation-test-123"}});assert.equal(r.response.status,201);
  r=await client.request("/api/driver/profile",{method:"PUT",body:{nickname,driverType:"TIR",countryCode:"PL",vehicle:"Test TIR"}});assert.ok([200,201].includes(r.response.status));
  return {client,nickname};
}
async function setLocation(driver,latitude,longitude){let r=await driver.client.request("/api/driver/gps",{method:"PUT",body:{enabled:true}});assert.equal(r.response.status,200);r=await driver.client.request("/api/driver/location",{method:"PUT",body:{latitude,longitude,accuracy:7,heading:70,speed:18}});assert.equal(r.response.status,200);}
async function providerRequests(){const response=await fetch(`${providerBase}/__test/requests`);assert.equal(response.status,200);return (await response.json()).requests;}
async function resetProvider(){const response=await fetch(`${providerBase}/__test/reset`,{method:"POST"});assert.equal(response.status,200);}

const ORIGIN={latitude:50.2649,longitude:19.0238};
const DESTINATION={latitude:50.5,longitude:19.5,label:"Navigation destination"};

let primary=null;
let primaryRoute=null;

test("Navigation seeds truck profile from Parking, refuses incomplete TIR constraints, and builds a strict enriched route",async()=>{
  const driver=await createDriver("core");primary=driver;await setLocation(driver,ORIGIN.latitude,ORIGIN.longitude);

  let r=await driver.client.request("/api/driver/parking/preferences",{method:"PATCH",body:{vehicleClass:"TIR",lengthM:16.5,heightM:4.0,weightT:40,adrRequired:true,refrigerated:true,maxDetourKm:20}});assert.equal(r.response.status,200);
  r=await driver.client.request("/api/driver/navigation/profile");assert.equal(r.response.status,200);assert.equal(r.data.profile.vehicleClass,"TRUCK");assert.equal(r.data.profile.lengthM,16.5);assert.equal(r.data.profile.heightM,4);assert.equal(r.data.profile.grossWeightT,40);assert.equal(r.data.profile.widthM,null);assert.equal(r.data.profile.hazardousGoods,true);assert.equal(r.data.profile.refrigerated,true);assert.equal(r.data.profile.adrTunnelCode,"NONE");

  r=await driver.client.request("/api/driver/navigation/routes",{method:"POST",body:{destination:DESTINATION,strategy:"PRACTICAL_TRUCK",alternatives:3}});assert.equal(r.response.status,409);assert.equal(r.data.error,"navigation_vehicle_profile_incomplete");assert.ok(r.data.missing.includes("widthM"));

  r=await driver.client.request("/api/driver/navigation/profile",{method:"PATCH",body:{widthM:2.55,axleLoadT:11.5,axleCount:5,maxSpeedKph:90,trailer:true,hazardousGoods:true,adrTunnelCode:"NONE",preferredStrategy:"PRACTICAL_TRUCK",avoidUnpaved:true}});assert.equal(r.response.status,200);assert.equal(r.data.profile.widthM,2.55);assert.equal(r.data.profile.adrTunnelCode,"NONE");
  r=await driver.client.request("/api/driver/navigation/profile",{method:"PATCH",body:{widthM:7}});assert.equal(r.response.status,400);assert.equal(r.data.error,"invalid_navigation_profile");

  const middle={latitude:(ORIGIN.latitude+DESTINATION.latitude)/2,longitude:(ORIGIN.longitude+DESTINATION.longitude)/2};
  r=await driver.client.request("/api/driver/parking/places",{method:"POST",body:{name:"Navigation Route Parking",latitude:middle.latitude,longitude:middle.longitude,kind:"TRUCK_PARKING",capacityTruck:80,toilet:true,shower:true,lighting:true,cctv:true,maxHeightM:4.5,maxLengthM:20,maxWeightT:50,adrAllowed:true}});assert.equal(r.response.status,201);const parkingId=r.data.place.id;
  r=await driver.client.request("/api/driver/road-reports",{method:"POST",body:{type:"ACCIDENT",lane:"RIGHT",latitude:ORIGIN.latitude+0.001,longitude:ORIGIN.longitude+0.001}});assert.equal(r.response.status,201);const reportId=r.data.report.id;

  await resetProvider();
  const csrf=driver.client.csrfToken;driver.client.csrfToken=null;r=await driver.client.request("/api/driver/navigation/routes",{method:"POST",body:{destination:DESTINATION}});assert.equal(r.response.status,403);driver.client.csrfToken=csrf;

  r=await driver.client.request("/api/driver/navigation/routes",{method:"POST",body:{destination:DESTINATION,strategy:"PARKING_AWARE",alternatives:3,break:{enabled:true,remainingDriveMinutes:120,desiredBreakMinutes:45}}});assert.equal(r.response.status,201);primaryRoute=r.data.route;
  assert.equal(primaryRoute.provider,"VALHALLA");assert.equal(primaryRoute.strategy,"PARKING_AWARE");assert.equal(primaryRoute.alternatives.length,3);assert.equal(primaryRoute.routeGuard.strictVehicleProfile,true);assert.ok(primaryRoute.routeGuard.confidence>0.5);assert.ok(primaryRoute.routeGuard.unknowns.includes("live_traffic_unavailable"));assert.ok(primaryRoute.routeGuard.unknowns.includes("toll_cost_unavailable"));assert.equal(primaryRoute.routeGuard.unknowns.includes("axle_count_not_provider_enforced"),false);
  for(const alt of primaryRoute.alternatives){assert.ok(Array.isArray(alt.geometry)&&alt.geometry.length>=2);assert.ok(Array.isArray(alt.maneuvers)&&alt.maneuvers.length>=1);assert.equal(alt.trafficDelaySec,null);assert.equal(alt.toll.available,false);}
  const enrichment=primaryRoute.enrichment[primaryRoute.selectedAlternativeId];assert.ok(enrichment);assert.ok(enrichment.roadEvents.some(item=>item.id===reportId));const road=enrichment.roadEvents.find(item=>item.id===reportId);assert.equal(Object.hasOwn(road,"authorId"),false);assert.equal(Object.hasOwn(road,"userId"),false);assert.ok(enrichment.parking.places.some(place=>place.id===parkingId));assert.ok(enrichment.parking.recommendedStops.some(place=>place.id===parkingId));assert.equal(enrichment.parking.breakAdvisory.kind,"ADVISORY_NOT_TACHOGRAPH");

  const requests=await providerRequests();assert.equal(requests.length,1);const request=requests[0];assert.equal(request.costing,"truck");const options=request.costing_options.truck;assert.equal(options.height,4);assert.equal(options.width,2.55);assert.equal(options.length,16.5);assert.equal(options.weight,40);assert.equal(options.axle_load,11.5);assert.equal(options.axle_count,5);assert.equal(options.hazmat,true);assert.equal(request.alternates,2);
});

test("Navigation route ownership, selection and reroute preserve the original strict vehicle snapshot",async()=>{
  assert.ok(primary&&primaryRoute);
  const stranger=await createDriver("other");let r=await stranger.client.request(`/api/driver/navigation/routes/${primaryRoute.id}`);assert.equal(r.response.status,404);

  const alternative=primaryRoute.alternatives[1];r=await primary.client.request(`/api/driver/navigation/routes/${primaryRoute.id}/select`,{method:"POST",body:{alternativeId:alternative.id}});assert.equal(r.response.status,200);assert.equal(r.data.route.selectedAlternativeId,alternative.id);

  await resetProvider();
  r=await primary.client.request(`/api/driver/navigation/routes/${primaryRoute.id}/refresh`,{method:"POST",body:{}});assert.equal(r.response.status,200);primaryRoute=r.data.route;assert.equal(primaryRoute.vehicleSnapshot.widthM,2.55);assert.equal(primaryRoute.vehicleSnapshot.heightM,4);assert.equal(primaryRoute.vehicleSnapshot.grossWeightT,40);assert.equal(primaryRoute.vehicleSnapshot.axleCount,5);assert.equal(primaryRoute.routeGuard.strictVehicleProfile,true);
  const requests=await providerRequests();assert.equal(requests.length,1);assert.equal(requests[0].costing,"truck");assert.equal(requests[0].costing_options.truck.width,2.55);assert.equal(requests[0].costing_options.truck.height,4);assert.equal(requests[0].costing_options.truck.weight,40);assert.equal(requests[0].costing_options.truck.axle_count,5);

  r=await primary.client.request(`/api/driver/navigation/routes/${primaryRoute.id}/finish`,{method:"POST",body:{state:"COMPLETED"}});assert.equal(r.response.status,200);assert.equal(r.data.route.status,"COMPLETED");
});

test("Navigation blocks an ADR tunnel profile that the router cannot enforce and does not fall back",async()=>{
  assert.ok(primary);
  let r=await primary.client.request("/api/driver/navigation/profile",{method:"PATCH",body:{adrTunnelCode:"D",hazardousGoods:true}});assert.equal(r.response.status,200);assert.equal(r.data.profile.adrTunnelCode,"D");
  await resetProvider();
  r=await primary.client.request("/api/driver/navigation/routes",{method:"POST",body:{destination:DESTINATION,strategy:"PRACTICAL_TRUCK",alternatives:2}});assert.equal(r.response.status,422);assert.equal(r.data.error,"navigation_hard_constraints_unenforced");assert.equal(r.data.guard.strictVehicleProfile,false);assert.ok(r.data.guard.warnings.includes("adr_tunnel_code_not_provider_enforced"));
  const requests=await providerRequests();assert.equal(requests.length,1);assert.equal(requests[0].costing,"truck");
  r=await primary.client.request("/api/driver/navigation/profile",{method:"PATCH",body:{adrTunnelCode:"NONE"}});assert.equal(r.response.status,200);assert.equal(r.data.profile.adrTunnelCode,"NONE");
});

test("Navigation provider failures are explicit and a failed truck route makes exactly one truck request with no car fallback",async()=>{
  assert.ok(primary);
  const cases=[
    [{latitude:52.222222,longitude:21.0},422,"navigation_no_route"],
    [{latitude:52.333333,longitude:21.0},502,"navigation_provider_invalid_response"],
    [{latitude:52.444444,longitude:21.0},504,"navigation_provider_timeout"]
  ];
  for(const [destination,status,error] of cases){
    await resetProvider();const r=await primary.client.request("/api/driver/navigation/routes",{method:"POST",body:{destination,strategy:"PRACTICAL_TRUCK",alternatives:2}});assert.equal(r.response.status,status);assert.equal(r.data.error,error);const requests=await providerRequests();assert.equal(requests.length,1,`${error} must not retry with a relaxed/car request`);assert.equal(requests[0].costing,"truck");
  }
});

test("Navigation schema is additive and global auth migration stays unchanged",()=>{
  const db=new DatabaseSync(process.env.PATAP_DB_PATH,{readOnly:true});try{
    assert.equal(Number(db.prepare("SELECT MAX(version) version FROM schema_migrations").get().version),12);
    assert.equal(Number(db.prepare("SELECT version FROM navigation_schema_meta WHERE singleton=1").get().version),1);
    for(const table of ["navigation_vehicle_profiles","navigation_routes"])assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
  }finally{db.close();}
});