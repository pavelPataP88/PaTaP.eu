const DEFAULT_TIMEOUT_MS = 12_000;

function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function finite(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function cleanBaseUrl(value){return String(value||"").trim().replace(/\/+$/,"");}

function decodePolyline6(encoded) {
  if (typeof encoded !== "string" || !encoded) return [];
  let index=0,lat=0,lon=0;const coordinates=[];
  while(index<encoded.length){
    let result=0,shift=0,b;
    do { if(index>=encoded.length)return [];b=encoded.charCodeAt(index++)-63;result|=(b&0x1f)<<shift;shift+=5; } while(b>=0x20);
    lat += (result&1)?~(result>>1):(result>>1);
    result=0;shift=0;
    do { if(index>=encoded.length)return [];b=encoded.charCodeAt(index++)-63;result|=(b&0x1f)<<shift;shift+=5; } while(b>=0x20);
    lon += (result&1)?~(result>>1):(result>>1);
    coordinates.push([lon/1e6,lat/1e6]);
  }
  return coordinates;
}

function costingFor(vehicleClass){if(vehicleClass==="TRUCK")return "truck";if(vehicleClass==="TAXI")return "taxi";return "auto";}
function physicalOptions(vehicle){
  const out={};
  for(const [field,key] of [["heightM","height"],["widthM","width"],["lengthM","length"],["grossWeightT","weight"]]){
    const value=finite(vehicle[field]);if(value!==null)out[key]=value;
  }
  return out;
}
function commonOptions(vehicle){
  const out=physicalOptions(vehicle);
  if(finite(vehicle.maxSpeedKph)!==null)out.top_speed=clamp(Number(vehicle.maxSpeedKph),20,180);
  out.use_tolls=vehicle.avoidTolls?0.05:0.6;
  out.use_ferry=vehicle.avoidFerries?0:0.5;
  if(vehicle.avoidUnpaved)out.exclude_unpaved=true;
  return out;
}
function truckOptions(vehicle,strategy){
  const out=commonOptions(vehicle);
  if(finite(vehicle.axleLoadT)!==null)out.axle_load=Number(vehicle.axleLoadT);
  if(finite(vehicle.axleCount)!==null)out.axle_count=Number(vehicle.axleCount);
  if(vehicle.hazardousGoods)out.hazmat=true;
  // HGV access is enforced by Valhalla's truck costing and routing graph. Do not
  // invent a magic penalty and treat it as proof of a hard legal exclusion.
  if(strategy==="PRACTICAL_TRUCK"||strategy==="PARKING_AWARE"){
    out.use_highways=0.92;out.use_tracks=0.05;out.use_living_streets=0.08;out.use_truck_route=0.85;out.maneuver_penalty=8;
  } else if(strategy==="EASY_TRUCK") {
    out.use_highways=1;out.use_tracks=0;out.use_living_streets=0;out.use_truck_route=1;out.maneuver_penalty=15;
  } else {out.use_highways=1;out.use_truck_route=0.65;}
  return out;
}
function autoOptions(vehicle,strategy){
  const out=commonOptions(vehicle);
  if(strategy==="ECONOMY")out.use_highways=0.55;
  return out;
}

function requestPayload({origin,destination,waypoints=[],vehicle,strategy,language="ru-RU",alternatives=3,departureAt=null}){
  const locations=[origin,...waypoints,destination].map((point,index,array)=>({lat:Number(point.latitude),lon:Number(point.longitude),type:index===0||index===array.length-1?"break":"through"}));
  const costing=costingFor(vehicle.vehicleClass);
  const options=costing==="truck"?truckOptions(vehicle,strategy):autoOptions(vehicle,strategy);
  const desired=clamp(Number(alternatives)||1,1,3);
  const payload={locations,costing,costing_options:{[costing]:options},units:"kilometers",alternates:desired-1,directions_options:{units:"kilometers",language}};
  if(departureAt)payload.date_time={type:1,value:String(departureAt).slice(0,16)};
  return payload;
}

function normalizeManeuver(row,shapeOffset=0,index=0){
  return {
    index,
    type:String(row?.type??"UNKNOWN"),
    instruction:String(row?.instruction||row?.verbal_transition_alert_instruction||"").slice(0,500),
    street:Array.isArray(row?.street_names)?String(row.street_names[0]||"").slice(0,160):"",
    distanceKm:finite(row?.length),
    timeSec:finite(row?.time),
    beginShapeIndex:(Number.isSafeInteger(Number(row?.begin_shape_index))?Number(row.begin_shape_index):0)+shapeOffset,
    endShapeIndex:(Number.isSafeInteger(Number(row?.end_shape_index))?Number(row.end_shape_index):0)+shapeOffset
  };
}

function normalizeTrip(trip,index=0){
  if(!trip||!Array.isArray(trip.legs)||!trip.legs.length)return null;
  const geometry=[];const maneuvers=[];let maneuverIndex=0;
  for(const leg of trip.legs){
    const decoded=decodePolyline6(leg?.shape);if(decoded.length<2)continue;
    const offset=geometry.length?geometry.length-1:0;
    if(geometry.length&&decoded.length&&geometry[geometry.length-1][0]===decoded[0][0]&&geometry[geometry.length-1][1]===decoded[0][1])geometry.push(...decoded.slice(1));else geometry.push(...decoded);
    for(const maneuver of leg?.maneuvers||[])maneuvers.push(normalizeManeuver(maneuver,offset,maneuverIndex++));
  }
  if(geometry.length<2||geometry.length>50_000)return null;
  const summary=trip.summary||{};
  const warnings=Array.isArray(trip.warnings)?trip.warnings.map((w)=>String(w?.description||w?.text||w).slice(0,300)):[];
  return {
    id:`alt-${index+1}`,
    distanceKm:finite(summary.length),
    durationSec:finite(summary.time),
    trafficDelaySec:null,
    eta:null,
    geometry,
    maneuvers:maneuvers.slice(0,5000),
    providerWarnings:warnings,
    toll:{available:false,amount:null,currency:null,source:null,asOf:null},
    difficulty:{score:null,confidence:0,reasons:[]}
  };
}

function normalizeResponse(data){
  const trips=[];
  if(data?.trip)trips.push(data.trip);
  for(const item of Array.isArray(data?.alternates)?data.alternates:[])trips.push(item?.trip||item);
  const alternatives=trips.map((trip,index)=>normalizeTrip(trip,index)).filter(Boolean).slice(0,3);
  if(!alternatives.length){const error=new Error("navigation_provider_invalid_response");error.status=502;throw error;}
  const rawWarnings=[];
  for(const warning of Array.isArray(data?.warnings)?data.warnings:[])rawWarnings.push(warning);
  for(const trip of trips)for(const warning of Array.isArray(trip?.warnings)?trip.warnings:[])rawWarnings.push(warning);
  return {provider:"VALHALLA",providerVersion:String(data?.version||data?.trip?.version||"").slice(0,80),alternatives,rawWarnings};
}

function createValhallaProvider({baseUrl=process.env.NAV_ROUTER_URL,timeoutMs=process.env.NAV_ROUTER_TIMEOUT_MS,fetchImpl=globalThis.fetch}={}){
  const url=cleanBaseUrl(baseUrl);const timeout=clamp(Number(timeoutMs)||DEFAULT_TIMEOUT_MS,1000,60_000);
  function status(){return {name:"VALHALLA",configured:Boolean(url),capabilities:{truck:true,physicalDimensions:true,alternatives:true,maneuvers:true,traffic:false,tolls:false,mapMatching:false,adrTunnelCode:false,axleCount:true,hgvAccess:true,designatedTruckRoutes:true,emissionZones:false,hazmatCategories:false}};}
  async function route(input){
    if(!url||typeof fetchImpl!=="function"){const error=new Error("navigation_provider_unavailable");error.status=503;throw error;}
    const payload=requestPayload(input);const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
    let response;
    try{response=await fetchImpl(`${url}/route`,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(payload),signal:controller.signal});}
    catch(error){const out=new Error(error?.name==="AbortError"?"navigation_provider_timeout":"navigation_provider_unavailable");out.status=error?.name==="AbortError"?504:503;throw out;}
    finally{clearTimeout(timer);}
    let data=null;try{data=await response.json();}catch{}
    if(!response.ok){
      const message=String(data?.error||data?.error_message||"").toLowerCase();const noRoute=response.status===400||response.status===404||/no path|no route|route not found/.test(message);
      const error=new Error(noRoute?"navigation_no_route":"navigation_provider_unavailable");error.status=noRoute?422:503;error.providerStatus=response.status;throw error;
    }
    return {...normalizeResponse(data),requestMeta:{costing:payload.costing,costingOptions:payload.costing_options[payload.costing]}};
  }
  return {status,route,requestPayload:(input)=>requestPayload(input)};
}

module.exports={createValhallaProvider,decodePolyline6,requestPayload,normalizeResponse};
