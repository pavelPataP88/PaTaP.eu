function radians(value){return value*Math.PI/180;}
function haversineKm(aLat,aLon,bLat,bLon){const r=6371.0088,dLat=radians(bLat-aLat),dLon=radians(bLon-aLon),a=Math.sin(dLat/2)**2+Math.cos(radians(aLat))*Math.cos(radians(bLat))*Math.sin(dLon/2)**2;return r*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}
function cumulative(geometry){let total=0;const distances=[0];for(let i=1;i<geometry.length;i++){total+=haversineKm(geometry[i-1][1],geometry[i-1][0],geometry[i][1],geometry[i][0]);distances.push(total);}return {distances,total};}
export function projectGuidance(alternative,location,{offRouteKm=0.12}={}){
  const geometry=alternative?.geometry||[];if(geometry.length<2||!location)return null;const {distances,total}=cumulative(geometry);let best=null;
  for(let i=0;i<geometry.length;i++){const [lon,lat]=geometry[i],distance=haversineKm(location.latitude,location.longitude,lat,lon);if(!best||distance<best.distanceKm)best={index:i,distanceKm:distance,routeKm:distances[i]};}
  const progress=total?Math.min(1,best.routeKm/total):0,remainingKm=Math.max(0,total-best.routeKm),duration=Number(alternative.durationSec)||0,remainingSec=duration?Math.round(duration*(1-progress)):null;
  const maneuvers=Array.isArray(alternative.maneuvers)?alternative.maneuvers:[];const next=maneuvers.find((m)=>Number(m.endShapeIndex)>=best.index)||maneuvers.at(-1)||null;
  let distanceToManeuverKm=null;if(next&&Number.isSafeInteger(Number(next.beginShapeIndex))){const target=Math.min(Math.max(Number(next.beginShapeIndex),best.index),distances.length-1);distanceToManeuverKm=Math.max(0,distances[target]-best.routeKm);}
  return {routeIndex:best.index,progress:Number(progress.toFixed(4)),remainingKm:Number(remainingKm.toFixed(2)),remainingSec,offRoute:best.distanceKm>offRouteKm,distanceFromRouteKm:Number(best.distanceKm.toFixed(3)),nextManeuver:next?{...next,distanceToManeuverKm:distanceToManeuverKm===null?null:Number(distanceToManeuverKm.toFixed(2))}:null};
}
export function isMoving(location,thresholdMps=2.8){return Number.isFinite(Number(location?.speed))&&Number(location.speed)>=thresholdMps;}
