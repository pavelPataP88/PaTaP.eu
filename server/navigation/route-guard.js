function clamp(value,min,max){return Math.max(min,Math.min(max,value));}

function difficultyFor(alternative){
  const distance=Number(alternative?.distanceKm);const maneuvers=Array.isArray(alternative?.maneuvers)?alternative.maneuvers:[];
  if(!Number.isFinite(distance)||distance<=0)return {score:null,confidence:0,reasons:["route_distance_unknown"]};
  const maneuverDensity=maneuvers.length/Math.max(distance,1)*100;
  let score=clamp(Math.round(20+Math.min(maneuverDensity,80)*0.7),0,100);const reasons=[];
  if(maneuverDensity>=35)reasons.push("many_maneuvers");
  else if(maneuverDensity<=10)reasons.push("simple_maneuver_profile");
  if(Array.isArray(alternative.providerWarnings)&&alternative.providerWarnings.length){score=clamp(score+10,0,100);reasons.push("provider_warnings");}
  return {score,confidence:0.35,reasons};
}

function createRouteGuard({providerStatus,vehicle,providerResult}={}){
  const capabilities=providerStatus?.capabilities||{};const warnings=[];const unknowns=[];let confidence=0.72,strict=true;
  const vehicleClass=String(vehicle?.vehicleClass||"OTHER"),isTruck=vehicleClass==="TRUCK",strictClass=isTruck||vehicleClass==="VAN",expectedCosting=isTruck?"truck":vehicleClass==="TAXI"?"taxi":"auto",requestMeta=providerResult?.requestMeta||{},costingOptions=requestMeta.costingOptions||{};
  if(String(requestMeta.costing||"")!==expectedCosting){warnings.push(isTruck?"truck_costing_not_used":`${vehicleClass.toLowerCase()}_costing_not_used`);strict=false;confidence-=(strictClass ? .5 : .2);}
  if(isTruck&&!capabilities.truck){warnings.push("provider_has_no_truck_routing");strict=false;confidence-=0.5;}
  if(isTruck&&!capabilities.hgvAccess){warnings.push("hgv_access_not_provider_enforced");strict=false;confidence-=0.35;}
  const physical=[["heightM","height","vehicle_height_unknown"],["widthM","width","vehicle_width_unknown"],["lengthM","length","vehicle_length_unknown"],["grossWeightT","weight","vehicle_weight_unknown"]];
  for(const [field,key,label] of physical){if(vehicle?.[field]===null||vehicle?.[field]===undefined){if(strictClass){unknowns.push(label);strict=false;confidence-=.07;}continue;}if(!capabilities.physicalDimensions||Number(costingOptions[key])!==Number(vehicle[field])){warnings.push(`constraint_not_sent:${key}`);strict=false;confidence-=.2;}}
  if(isTruck){
    if(vehicle?.axleCount!=null&&!capabilities.axleCount){unknowns.push("axle_count_not_provider_enforced");strict=false;confidence-=0.1;}
    for(const [field,key] of [["axleLoadT","axle_load"],["axleCount","axle_count"]])if(vehicle?.[field]!=null&&Number(costingOptions[key])!==Number(vehicle[field])){warnings.push(`constraint_not_sent:${key}`);strict=false;confidence-=0.2;}
    if(vehicle?.hazardousGoods&&costingOptions.hazmat!==true){warnings.push("hazmat_not_sent_to_provider");strict=false;confidence-=0.25;}
  }else if(vehicle?.axleLoadT!=null||vehicle?.axleCount!=null){warnings.push("axle_constraints_not_provider_enforced");strict=false;confidence-=.12;}
  if(vehicle?.hazardousGoods&&!isTruck){warnings.push("hazmat_not_provider_enforced_for_vehicle_class");strict=false;confidence-=.25;}
  if(vehicle?.adrTunnelCode&&vehicle.adrTunnelCode!=="NONE"&&!capabilities.adrTunnelCode){warnings.push("adr_tunnel_code_not_provider_enforced");strict=false;confidence-=0.2;}
  if(Array.isArray(vehicle?.hazmatCategories)&&vehicle.hazmatCategories.length&&!capabilities.hazmatCategories){warnings.push("hazmat_categories_not_provider_enforced");strict=false;confidence-=0.12;}
  if(vehicle?.emissionClass&&!capabilities.emissionZones){warnings.push("emission_class_not_provider_enforced");strict=false;confidence-=0.12;}
  if(vehicle?.co2Class){unknowns.push("co2_class_not_used_for_toll_calculation");confidence-=0.04;}
  for(const item of providerResult?.rawWarnings||[])warnings.push(`provider:${String(item?.description||item?.text||item).slice(0,220)}`);
  if(!capabilities.traffic)unknowns.push("live_traffic_unavailable");
  if(!capabilities.tolls)unknowns.push("toll_cost_unavailable");
  confidence=clamp(confidence,0,0.9);
  const level=confidence>=0.72?"HIGH":confidence>=0.52?"MEDIUM":confidence>=0.3?"LOW":"UNKNOWN";
  return {strictVehicleProfile:strict,confidence:Number(confidence.toFixed(2)),level,provider:String(providerStatus?.name||providerResult?.provider||"UNKNOWN"),warnings:[...new Set(warnings)],unknowns:[...new Set(unknowns)],dataSources:[{type:"ROUTER",name:String(providerStatus?.name||providerResult?.provider||"UNKNOWN")},{type:"ROAD_GRAPH",name:"provider routing graph",freshness:"provider-managed"}],diagnosticOnly:false};
}

function applyDifficulty(alternatives){return (alternatives||[]).map((alternative)=>({...alternative,difficulty:difficultyFor(alternative)}));}

module.exports={createRouteGuard,applyDifficulty,difficultyFor};
