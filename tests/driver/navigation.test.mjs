import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {saveActiveRoute,loadActiveRoute,clearActiveRoute,activeRouteCacheKey,ACTIVE_ROUTE_CACHE_KEY} from "../../driver/navigation/route-cache.mjs";
import {projectGuidance,isMoving,isFreshLocation,routeItemMetrics} from "../../driver/navigation/guidance.mjs";

const require=createRequire(import.meta.url);
const {requestPayload,createValhallaProvider}=require("../../server/navigation/providers/valhalla.js");
const {createRouteGuard}=require("../../server/navigation/route-guard.js");

const registry=JSON.parse(await readFile(new URL("../../driver/module-registry.json",import.meta.url),"utf8"));
const navigationSource=await readFile(new URL("../../driver/navigation/index.js",import.meta.url),"utf8");
const panelSource=await readFile(new URL("../../driver/navigation/panel.mjs",import.meta.url),"utf8");
const mapSource=await readFile(new URL("../../driver/map/index.js",import.meta.url),"utf8");
const appSource=await readFile(new URL("../../driver/app.js",import.meta.url),"utf8");
const serviceSource=await readFile(new URL("../../server/navigation/service.js",import.meta.url),"utf8");

function storage(){const values=new Map();return {setItem(key,value){values.set(key,String(value));},getItem(key){return values.has(key)?values.get(key):null;},removeItem(key){values.delete(key);},raw(key){return values.get(key)||null;}};}

const vehicle={vehicleClass:"TRUCK",heightM:4,widthM:2.55,lengthM:16.5,grossWeightT:40,axleLoadT:11.5,axleCount:5,maxSpeedKph:90,hazardousGoods:true,adrTunnelCode:"D",avoidTolls:false,avoidFerries:true,avoidUnpaved:true};
const routeInput={origin:{latitude:50.26,longitude:19.02},destination:{latitude:52.23,longitude:21.01},waypoints:[],vehicle,strategy:"PRACTICAL_TRUCK",language:"ru-RU",alternatives:3};

test("Navigation is a Map-owned global layer and bottom navigation stays exactly six views",()=>{
  const module=registry.modules.find(item=>item.id==="navigation");assert.ok(module);assert.equal(module.view,undefined);assert.equal(module.enabled,true);assert.equal(module.requiresProfile,true);assert.deepEqual(module.dependsOn,["map"]);
  assert.equal(registry.modules.filter(item=>item.enabled&&item.view).length,6);
  assert.match(appSource,/module-registry\.json\?v=20260820-navigation-v2/);
  assert.match(panelSource,/navigation-launch/);assert.match(panelSource,/Маршрут/);assert.match(panelSource,/data-moving/);assert.match(panelSource,/@media\(max-width:700px\)/);
});

test("Valhalla truck request carries supported vehicle constraints without invented HGV hard-penalty fields",()=>{
  const payload=requestPayload(routeInput);assert.equal(payload.costing,"truck");assert.equal(payload.alternates,2);const options=payload.costing_options.truck;
  assert.equal(options.height,4);assert.equal(options.width,2.55);assert.equal(options.length,16.5);assert.equal(options.weight,40);assert.equal(options.axle_load,11.5);assert.equal(options.axle_count,5);assert.equal(options.hazmat,true);assert.equal(options.top_speed,90);assert.equal(options.use_ferry,0);assert.equal(options.exclude_unpaved,true);assert.equal(options.use_truck_route,0.85);assert.equal(Object.hasOwn(options,"hgv_no_access_penalty"),false);
  const easy=requestPayload({...routeInput,strategy:"EASY_TRUCK"});assert.equal(easy.costing_options.truck.use_truck_route,1);assert.equal(Object.hasOwn(easy.costing_options.truck,"hgv_no_access_penalty"),false);
  const taxi=requestPayload({...routeInput,vehicle:{...vehicle,vehicleClass:"TAXI",hazardousGoods:false},strategy:"FASTEST_LEGAL"});assert.equal(taxi.costing,"taxi");assert.equal(Object.hasOwn(taxi.costing_options.taxi,"hazmat"),false);
  const car=requestPayload({...routeInput,vehicle:{...vehicle,vehicleClass:"CAR",hazardousGoods:false},strategy:"FASTEST_LEGAL"});assert.equal(car.costing,"auto");assert.equal(Object.hasOwn(car.costing_options.auto,"hazmat"),false);
});

test("Unconfigured routing provider is an honest unavailable state, never a synthetic route",async()=>{
  const provider=createValhallaProvider({baseUrl:"",fetchImpl:async()=>{assert.fail("fetch must not run when provider is unconfigured");}});const status=provider.status();assert.equal(status.configured,false);assert.equal(status.capabilities.truck,true);assert.equal(status.capabilities.axleCount,true);assert.equal(status.capabilities.hgvAccess,true);await assert.rejects(()=>provider.route(routeInput),error=>error?.message==="navigation_provider_unavailable"&&error?.status===503);
});

test("Route Guard is strict only when every configured hard vehicle constraint is actually expressible",()=>{
  const providerStatus={name:"VALHALLA",capabilities:{truck:true,physicalDimensions:true,hgvAccess:true,axleCount:true,adrTunnelCode:false,hazmatCategories:false,emissionZones:false,traffic:false,tolls:false}};
  const strictVehicle={...vehicle,adrTunnelCode:"NONE",hazmatCategories:[],emissionClass:""};
  const providerResult={provider:"VALHALLA",requestMeta:{costing:"truck",costingOptions:{height:4,width:2.55,length:16.5,weight:40,axle_load:11.5,axle_count:5,hazmat:true}},rawWarnings:[]};
  const guard=createRouteGuard({providerStatus,vehicle:strictVehicle,providerResult});assert.equal(guard.strictVehicleProfile,true);assert.ok(guard.unknowns.includes("live_traffic_unavailable"));assert.ok(guard.unknowns.includes("toll_cost_unavailable"));assert.equal(guard.unknowns.includes("axle_count_not_provider_enforced"),false);assert.equal(guard.warnings.includes("adr_tunnel_code_not_provider_enforced"),false);
  const adrBlocked=createRouteGuard({providerStatus,vehicle,providerResult});assert.equal(adrBlocked.strictVehicleProfile,false);assert.ok(adrBlocked.warnings.includes("adr_tunnel_code_not_provider_enforced"));
  const missingAxle=createRouteGuard({providerStatus,vehicle:strictVehicle,providerResult:{...providerResult,requestMeta:{costing:"truck",costingOptions:{height:4,width:2.55,length:16.5,weight:40,axle_load:11.5,hazmat:true}}}});assert.equal(missingAxle.strictVehicleProfile,false);assert.ok(missingAxle.warnings.includes("constraint_not_sent:axle_count"));
  const brokenHazmat=createRouteGuard({providerStatus,vehicle:strictVehicle,providerResult:{...providerResult,requestMeta:{costing:"truck",costingOptions:{height:4,width:2.55,length:16.5,weight:40,axle_load:11.5,axle_count:5,hazmat:false}}}});assert.equal(brokenHazmat.strictVehicleProfile,false);assert.ok(brokenHazmat.warnings.includes("hazmat_not_sent_to_provider"));
  const carFallback=createRouteGuard({providerStatus,vehicle:strictVehicle,providerResult:{...providerResult,requestMeta:{costing:"auto",costingOptions:{...providerResult.requestMeta.costingOptions}}}});assert.equal(carFallback.strictVehicleProfile,false);assert.ok(carFallback.warnings.includes("truck_costing_not_used"));
  const emissionBlocked=createRouteGuard({providerStatus,vehicle:{...strictVehicle,emissionClass:"EURO6"},providerResult});assert.equal(emissionBlocked.strictVehicleProfile,false);assert.ok(emissionBlocked.warnings.includes("emission_class_not_provider_enforced"));
  const van={...strictVehicle,vehicleClass:"VAN",hazardousGoods:false,axleLoadT:null,axleCount:null},vanResult={provider:"VALHALLA",requestMeta:{costing:"auto",costingOptions:{height:4,width:2.55,length:16.5,weight:40}},rawWarnings:[]};const strictVan=createRouteGuard({providerStatus,vehicle:van,providerResult:vanResult});assert.equal(strictVan.strictVehicleProfile,true);
  const unsafeVan=createRouteGuard({providerStatus,vehicle:{...van,hazardousGoods:true},providerResult:vanResult});assert.equal(unsafeVan.strictVehicleProfile,false);assert.ok(unsafeVan.warnings.includes("hazmat_not_provider_enforced_for_vehicle_class"));
});

test("Active-route cache is bounded, strips unrelated data and is isolated per signed-in driver",()=>{
  const store=storage(),now=Date.now();const route={id:"12345678-1234-1234-1234-123456789abc",status:"ACTIVE",provider:"VALHALLA",strategy:"PRACTICAL_TRUCK",selectedAlternativeId:"alt-1",selectedAlternative:{id:"alt-1",distanceKm:100,durationSec:3600,eta:new Date(now+3600000).toISOString(),geometry:[[19,50],[20,51]],maneuvers:[{index:0,type:"1",instruction:"Прямо",beginShapeIndex:0,endShapeIndex:1}]},routeGuard:{level:"HIGH"},enrichment:{"alt-1":{parking:{planB:[]}}},request:{origin:{latitude:50,longitude:19},destination:{latitude:51,longitude:20,label:"Точка"},break:{enabled:false}},updatedAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString(),token:"SECRET",messages:["PRIVATE"],otherUserGps:{latitude:1,longitude:2}};
  store.setItem(ACTIVE_ROUTE_CACHE_KEY,"legacy-private-route");assert.equal(saveActiveRoute(route,"driver-A",store),true);assert.equal(store.getItem(ACTIVE_ROUTE_CACHE_KEY),null);const keyA=activeRouteCacheKey("driver-A"),keyB=activeRouteCacheKey("driver-B");const raw=store.raw(keyA);assert.ok(raw);assert.notEqual(keyA,keyB);assert.doesNotMatch(raw,/SECRET|PRIVATE|otherUserGps|"origin"/);const restored=loadActiveRoute("driver-A",store,{now});assert.equal(restored.id,route.id);assert.deepEqual(restored.request.destination,route.request.destination);assert.equal(loadActiveRoute("driver-B",store,{now}),null);clearActiveRoute("driver-A",store);assert.equal(store.getItem(keyA),null);
});

test("Guidance projects remaining route, next maneuver and explicit off-route state",()=>{
  const alternative={distanceKm:30,durationSec:1800,geometry:[[19,50],[19.1,50.1],[19.2,50.2]],maneuvers:[{index:0,type:"1",instruction:"Прямо",beginShapeIndex:0,endShapeIndex:1},{index:1,type:"10",instruction:"Направо",beginShapeIndex:1,endShapeIndex:2}]};
  const now=Date.parse("2026-08-20T12:00:00.000Z"),onRoute=projectGuidance(alternative,{latitude:50.1,longitude:19.1,speed:12,timestamp:now},{now});assert.ok(onRoute);assert.equal(onRoute.offRoute,false);assert.ok(onRoute.progress>0&&onRoute.progress<1);assert.ok(onRoute.remainingKm>0);assert.ok(onRoute.nextManeuver);assert.equal(onRoute.eta,new Date(now+onRoute.remainingSec*1000).toISOString());assert.equal(isMoving({speed:12}),true);assert.equal(isMoving({speed:1}),false);assert.equal(isFreshLocation({timestamp:now},{now}),true);assert.equal(isFreshLocation({timestamp:now-31_000},{now}),false);
  assert.equal(routeItemMetrics(onRoute.progress-.01,onRoute),null);const ahead=routeItemMetrics(Math.min(1,onRoute.progress+.1),onRoute);assert.ok(ahead);assert.ok(ahead.distanceAheadKm>=0);assert.ok(ahead.etaMinutes>=0);
  const offRoute=projectGuidance(alternative,{latitude:51,longitude:20,speed:0});assert.equal(offRoute.offRoute,true);assert.ok(offRoute.distanceFromRouteKm>0.12);
});

test("Map exposes one route source with draw, clear, fit and map-point selection seams",()=>{
  assert.match(mapSource,/driver-navigation-route/);assert.match(mapSource,/driver-navigation-progress/);assert.match(mapSource,/function showRoute/);assert.match(mapSource,/function clearRoute/);assert.match(mapSource,/function setRouteProgress/);assert.match(mapSource,/function fitRoute/);assert.match(mapSource,/function pickPoint/);assert.match(mapSource,/function getOwnLocation/);assert.match(mapSource,/LineString/);assert.doesNotMatch(mapSource,/new window\.maplibregl\.Map[\s\S]*new window\.maplibregl\.Map/);
});

test("Navigation UI does not hard-code public Nominatim, fake traffic/tolls or automatic car fallback",()=>{
  const all=`${navigationSource}\n${panelSource}\n${serviceSource}`;assert.doesNotMatch(all,/nominatim\.openstreetmap\.org/i);assert.match(serviceSource,/carFallbackForTruck:false/);assert.match(navigationSource,/не будет подменять его приблизительным маршрутом/);assert.match(navigationSource,/Маршрут легкового автомобиля автоматически не подставляется/);assert.match(panelSource,/Трафик:.*источник не подключён/);assert.match(panelSource,/Стоимость платных дорог:.*источник не подключён/);assert.match(panelSource,/Точка старта/);assert.match(panelSource,/Для TRUCK и VAN/);assert.match(panelSource,/Показан сохранённый маршрут/);assert.match(serviceSource,/navigation_hard_constraints_unenforced/);
});
