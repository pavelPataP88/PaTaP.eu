const crypto=require("crypto");
const {ensureNavigationSchema}=require("./schema");
const {createVehicleProfileRepository,STRATEGIES}=require("./vehicle-profile");
const {createParkingRepository}=require("../parking/repository");
const {createRouteGuard,applyDifficulty}=require("./route-guard");
const {sampleGeometry,closestGeometryPoint,corridorItems}=require("./geometry");

const ROUTE_TTL_MS=7*24*60*60_000;
const ROAD_CORRIDOR_KM=2.5;
function text(value,max=160){return String(value??"").normalize("NFKC").replace(/\s+/g," ").trim().slice(0,max);}
function point(value){const latitude=Number(value?.latitude??value?.lat),longitude=Number(value?.longitude??value?.lon);if(!Number.isFinite(latitude)||latitude<-90||latitude>90||!Number.isFinite(longitude)||longitude<-180||longitude>180)return null;return {latitude,longitude,label:text(value?.label,160)};}
function json(value,fallback){try{return JSON.parse(value);}catch{return fallback;}}
function addMs(iso,ms){return new Date(Date.parse(iso)+ms).toISOString();}
function routeError(message,status,extra={}){const error=new Error(message);error.status=status;Object.assign(error,extra);return error;}

function createNavigationService({db,provider,roadReports=null,nowIso=()=>new Date().toISOString()}={}){
  if(!db||!provider)throw new Error("navigation_service_configuration_required");
  ensureNavigationSchema(db,nowIso());
  const profiles=createVehicleProfileRepository(db,{nowIso});
  const parking=createParkingRepository(db,{nowIso});

  function expire(now=nowIso()){db.prepare("UPDATE navigation_routes SET status='EXPIRED',updated_at=? WHERE status='ACTIVE' AND expires_at<=?").run(now,now);}
  function providerStatus(){return provider.status();}
  function status(){const router=providerStatus();return {router,geocoder:{configured:false,name:null},traffic:{configured:Boolean(router.capabilities?.traffic),source:router.capabilities?.traffic?router.name:null},tolls:{configured:Boolean(router.capabilities?.tolls),source:router.capabilities?.tolls?router.name:null},offline:{activeRouteCache:true,offlineRerouting:false},truth:{carFallbackForTruck:false,fakeTraffic:false,fakeTolls:false}};}

  function requireCompleteVehicle(vehicle){
    if(vehicle.vehicleClass!=="TRUCK")return;
    const missing=[];for(const [key,label] of [["heightM","heightM"],["widthM","widthM"],["lengthM","lengthM"],["grossWeightT","grossWeightT"]])if(vehicle[key]===null||vehicle[key]===undefined)missing.push(label);
    if(missing.length)throw routeError("navigation_vehicle_profile_incomplete",409,{missing});
  }
  function freshOrigin(userId,now=nowIso()){
    const profile=db.prepare("SELECT gps_enabled FROM driver_profiles WHERE user_id=?").get(Number(userId));if(!profile?.gps_enabled)return null;
    const row=db.prepare("SELECT latitude,longitude,updated_at FROM driver_locations WHERE user_id=?").get(Number(userId));if(!row)return null;const age=Date.parse(now)-Date.parse(row.updated_at);if(!Number.isFinite(age)||age>5*60_000)return null;return point(row);
  }
  function normalizeInput(userId,input,vehicle){
    const origin=point(input?.origin)||freshOrigin(userId);const destination=point(input?.destination);if(!origin)throw routeError("navigation_origin_required",409);if(!destination)throw routeError("navigation_destination_required",400);
    const waypoints=Array.isArray(input?.waypoints)?input.waypoints.slice(0,20).map(point):[];if(waypoints.some((p)=>!p))throw routeError("invalid_navigation_waypoint",400);
    const strategy=String(input?.strategy||vehicle.preferredStrategy||"FASTEST_LEGAL").toUpperCase();if(!STRATEGIES.has(strategy))throw routeError("invalid_navigation_strategy",400);
    const alternatives=Math.max(1,Math.min(3,Number(input?.alternatives)||3));
    let departureAt=null;if(input?.departureAt){const ms=Date.parse(input.departureAt);if(!Number.isFinite(ms))throw routeError("invalid_navigation_departure",400);departureAt=new Date(ms).toISOString();}
    let breakPlan={enabled:false,remainingDriveMinutes:null,desiredBreakMinutes:45};
    if(input?.break?.enabled){const remaining=Number(input.break.remainingDriveMinutes),desired=Number(input.break.desiredBreakMinutes??45);if(!Number.isFinite(remaining)||remaining<0||remaining>600||!Number.isFinite(desired)||desired<15||desired>180)throw routeError("invalid_navigation_break_plan",400);breakPlan={enabled:true,remainingDriveMinutes:remaining,desiredBreakMinutes:desired};}
    return {origin,destination,waypoints,strategy,alternatives,departureAt,break:breakPlan};
  }

  function decorateTimes(alternatives,departureAt){const base=departureAt&&Number.isFinite(Date.parse(departureAt))?Date.parse(departureAt):Date.parse(nowIso());return alternatives.map((alternative)=>({...alternative,eta:Number.isFinite(Number(alternative.durationSec))?new Date(base+Number(alternative.durationSec)*1000).toISOString():null}));}
  function routeRoadEvents(alternative){
    if(!roadReports?.list||!alternative?.geometry?.length)return[];const duration=Number(alternative.durationSec)||0;
    return corridorItems(alternative.geometry,roadReports.list(),{maxDistanceKm:ROAD_CORRIDOR_KM}).map((report)=>({...report,route:{...report.route,etaMinutes:duration?Number((duration*report.route.progress/60).toFixed(1)):null}})).slice(0,60);
  }
  function parkingAlong(userId,alternative,input){
    if(!alternative?.geometry?.length)return {places:[],corridorKm:null,recommendedStops:[],planB:[],breakAdvisory:null};
    const points=sampleGeometry(alternative.geometry,400).map((p)=>({lat:p.latitude,lon:p.longitude}));const result=parking.alongRoute(userId,{points,limit:60});if(result.error)return {places:[],corridorKm:null,recommendedStops:[],planB:[],breakAdvisory:null};
    const duration=Number(alternative.durationSec)||0;
    const places=(result.places||[]).map((place)=>{const position=closestGeometryPoint(alternative.geometry,place.latitude,place.longitude);return {...place,routeProgress:position?Number(position.progress.toFixed(4)):null,routeDistanceFromStartKm:position?Number(position.routeKm.toFixed(2)):null,routeEtaMinutes:position&&duration?Number((duration*position.progress/60).toFixed(1)):null};});
    const usable=places.filter((place)=>place.fit?.compatible&&place.occupancy?.status!=="CLOSED");
    let recommendedStops=usable.slice(0,5),planB=usable.slice(1,4),breakAdvisory=null;
    if(input.break?.enabled&&duration){const target=input.break.remainingDriveMinutes;const scored=usable.filter((p)=>p.routeEtaMinutes!==null).map((p)=>{const late=Math.max(0,p.routeEtaMinutes-target),early=Math.max(0,target-p.routeEtaMinutes);const occupancy=p.occupancy?.status==="FULL"?180:p.occupancy?.status==="LIMITED"?35:p.occupancy?.status==="UNKNOWN"?20:0;const confidence=(1-Number(p.occupancy?.confidence||0))*20;return {p,score:late*6+early*0.7+occupancy+confidence+(p.routeDistanceKm||0)*5};}).sort((a,b)=>a.score-b.score);
      recommendedStops=scored.slice(0,5).map((x)=>x.p);planB=scored.slice(1,4).map((x)=>x.p);breakAdvisory={kind:"ADVISORY_NOT_TACHOGRAPH",remainingDriveMinutes:target,desiredBreakMinutes:input.break.desiredBreakMinutes,recommendedPlaceId:recommendedStops[0]?.id||null,warning:"Планирование перерыва справочное. PaTaP не читает тахограф и не подтверждает юридическое соблюдение режима труда и отдыха."};}
    return {places:places.slice(0,30),corridorKm:result.corridorKm,recommendedStops,planB,breakAdvisory};
  }
  function enrich(userId,alternative,input){return {roadEvents:routeRoadEvents(alternative),parking:parkingAlong(userId,alternative,input)};}

  function storeRoute(userId,{providerResult,input,vehicle,alternatives,guard,enrichment},now=nowIso()){
    const id=crypto.randomUUID(),selected=alternatives[0]?.id;if(!selected)throw routeError("navigation_provider_invalid_response",502);
    db.prepare(`INSERT INTO navigation_routes(id,user_id,status,provider,provider_version,strategy,vehicle_snapshot_json,request_json,alternatives_json,selected_alternative_id,route_guard_json,enrichment_json,created_at,updated_at,expires_at) VALUES(?,?,'ACTIVE',?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id,Number(userId),providerResult.provider,providerResult.providerVersion||"",input.strategy,JSON.stringify(vehicle),JSON.stringify(input),JSON.stringify(alternatives),selected,JSON.stringify(guard),JSON.stringify(enrichment),now,now,addMs(now,ROUTE_TTL_MS));
    return publicRoute(db.prepare("SELECT * FROM navigation_routes WHERE id=?").get(id));
  }
  function publicRoute(row){if(!row)return null;const alternatives=json(row.alternatives_json,[]),selected=alternatives.find((a)=>a.id===row.selected_alternative_id)||alternatives[0]||null;return {id:row.id,status:row.status,provider:row.provider,providerVersion:row.provider_version,strategy:row.strategy,vehicleSnapshot:json(row.vehicle_snapshot_json,{}),request:json(row.request_json,{}),alternatives,selectedAlternativeId:row.selected_alternative_id,selectedAlternative:selected,routeGuard:json(row.route_guard_json,{}),enrichment:json(row.enrichment_json,{}),createdAt:row.created_at,updatedAt:row.updated_at,expiresAt:row.expires_at};}
  function ownedRow(userId,routeId){expire();return db.prepare("SELECT * FROM navigation_routes WHERE id=? AND user_id=?").get(String(routeId),Number(userId))||null;}

  async function calculate(userId,input={}){
    const vehicle=profiles.get(userId);if(!vehicle)throw routeError("driver_profile_required",409);requireCompleteVehicle(vehicle);const normalized=normalizeInput(userId,input,vehicle);const providerResult=await provider.route({...normalized,vehicle,language:"ru-RU"});
    let alternatives=applyDifficulty(decorateTimes(providerResult.alternatives,normalized.departureAt));const guard=createRouteGuard({providerStatus:providerStatus(),vehicle,providerResult});
    const enrichment={};for(const alternative of alternatives)enrichment[alternative.id]=enrich(userId,alternative,normalized);
    return storeRoute(userId,{providerResult,input:normalized,vehicle,alternatives,guard,enrichment});
  }
  function get(userId,routeId){return publicRoute(ownedRow(userId,routeId));}
  function select(userId,routeId,alternativeId,now=nowIso()){
    const row=ownedRow(userId,routeId);if(!row)return {error:"navigation_route_not_found",status:404};const alternatives=json(row.alternatives_json,[]);if(!alternatives.some((a)=>a.id===alternativeId))return {error:"navigation_alternative_not_found",status:404};db.prepare("UPDATE navigation_routes SET selected_alternative_id=?,updated_at=? WHERE id=? AND user_id=?").run(String(alternativeId),now,row.id,Number(userId));return {route:publicRoute(ownedRow(userId,row.id))};
  }
  async function refresh(userId,routeId,input={},now=nowIso()){
    const row=ownedRow(userId,routeId);if(!row)return {error:"navigation_route_not_found",status:404};const previous=publicRoute(row),vehicle=previous.vehicleSnapshot;requireCompleteVehicle(vehicle);const normalized={...previous.request};if(input.origin){const next=point(input.origin);if(!next)return {error:"navigation_origin_required",status:400};normalized.origin=next;}else normalized.origin=freshOrigin(userId,now)||normalized.origin;
    const providerResult=await provider.route({...normalized,vehicle,language:"ru-RU"});const alternatives=applyDifficulty(decorateTimes(providerResult.alternatives,normalized.departureAt)),guard=createRouteGuard({providerStatus:providerStatus(),vehicle,providerResult});const enrichment={};for(const alternative of alternatives)enrichment[alternative.id]=enrich(userId,alternative,normalized);const selected=alternatives[0]?.id;if(!selected)return {error:"navigation_provider_invalid_response",status:502};db.prepare("UPDATE navigation_routes SET status='ACTIVE',provider=?,provider_version=?,request_json=?,alternatives_json=?,selected_alternative_id=?,route_guard_json=?,enrichment_json=?,updated_at=?,expires_at=? WHERE id=? AND user_id=?").run(providerResult.provider,providerResult.providerVersion||"",JSON.stringify(normalized),JSON.stringify(alternatives),selected,JSON.stringify(guard),JSON.stringify(enrichment),now,addMs(now,ROUTE_TTL_MS),row.id,Number(userId));return {route:publicRoute(ownedRow(userId,row.id))};
  }
  function finish(userId,routeId,state="COMPLETED",now=nowIso()){const row=ownedRow(userId,routeId);if(!row)return {error:"navigation_route_not_found",status:404};const status=state==="CANCELLED"?"CANCELLED":"COMPLETED";db.prepare("UPDATE navigation_routes SET status=?,updated_at=? WHERE id=? AND user_id=?").run(status,now,row.id,Number(userId));return {route:publicRoute(db.prepare("SELECT * FROM navigation_routes WHERE id=? AND user_id=?").get(row.id,Number(userId)))};}

  return {status,profiles,calculate,get,select,refresh,finish};
}

module.exports={createNavigationService,ROUTE_TTL_MS,ROAD_CORRIDOR_KM};
