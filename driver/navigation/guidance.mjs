function radians(value){return value*Math.PI/180;}
function haversineKm(aLat,aLon,bLat,bLon){const r=6371.0088,dLat=radians(bLat-aLat),dLon=radians(bLon-aLon),a=Math.sin(dLat/2)**2+Math.cos(radians(aLat))*Math.cos(radians(bLat))*Math.sin(dLon/2)**2;return r*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}
function cumulative(geometry){let total=0;const distances=[0];for(let i=1;i<geometry.length;i++){total+=haversineKm(geometry[i-1][1],geometry[i-1][0],geometry[i][1],geometry[i][0]);distances.push(total);}return {distances,total};}
function projectSegment(a,b,location){const meanLat=(a[1]+b[1]+Number(location.latitude))/3*Math.PI/180,kx=111.320*Math.max(.15,Math.cos(meanLat)),ky=110.574,bx=(b[0]-a[0])*kx,by=(b[1]-a[1])*ky,px=(Number(location.longitude)-a[0])*kx,py=(Number(location.latitude)-a[1])*ky,len2=bx*bx+by*by,t=len2>0?Math.max(0,Math.min(1,(px*bx+py*by)/len2)):0,lon=a[0]+(b[0]-a[0])*t,lat=a[1]+(b[1]-a[1])*t;return {t,lon,lat,distanceKm:haversineKm(location.latitude,location.longitude,lat,lon)};}
function nowMs(value){if(value instanceof Date)return value.getTime();const numeric=Number(value);if(Number.isFinite(numeric))return numeric;const parsed=Date.parse(value||"");return Number.isFinite(parsed)?parsed:Date.now();}
export function projectGuidance(alternative,location,{offRouteKm=0.12,now=Date.now()}={}){
  const geometry=alternative?.geometry||[];if(geometry.length<2||!location)return null;const {distances,total}=cumulative(geometry);let best=null;
  for(let i=0;i<geometry.length-1;i++){const projected=projectSegment(geometry[i],geometry[i+1],location),segmentKm=distances[i+1]-distances[i],routeKm=distances[i]+segmentKm*projected.t;if(!best||projected.distanceKm<best.distanceKm)best={segmentIndex:i,index:projected.t>=.5?i+1:i,distanceKm:projected.distanceKm,routeKm,projectedLatitude:projected.lat,projectedLongitude:projected.lon};}
  const progress=total?Math.min(1,best.routeKm/total):0,remainingKm=Math.max(0,total-best.routeKm),duration=Number(alternative.durationSec)||0,remainingSec=duration?Math.round(duration*(1-progress)):null;
  const maneuvers=Array.isArray(alternative.maneuvers)?alternative.maneuvers:[];const next=maneuvers.find((m)=>Number(m.endShapeIndex)>=best.index)||maneuvers.at(-1)||null;
  let distanceToManeuverKm=null;if(next&&Number.isSafeInteger(Number(next.beginShapeIndex))){const target=Math.min(Math.max(Number(next.beginShapeIndex),best.index),distances.length-1);distanceToManeuverKm=Math.max(0,distances[target]-best.routeKm);}
  const eta=remainingSec===null?null:new Date(nowMs(now)+remainingSec*1000).toISOString();
  return {routeIndex:best.index,segmentIndex:best.segmentIndex,progress:Number(progress.toFixed(4)),totalKm:Number(total.toFixed(2)),remainingKm:Number(remainingKm.toFixed(2)),remainingSec,eta,offRoute:best.distanceKm>offRouteKm,distanceFromRouteKm:Number(best.distanceKm.toFixed(3)),projected:{latitude:best.projectedLatitude,longitude:best.projectedLongitude},nextManeuver:next?{...next,distanceToManeuverKm:distanceToManeuverKm===null?null:Number(distanceToManeuverKm.toFixed(2))}:null};
}
export function isMoving(location,thresholdMps=2.8){return Number.isFinite(Number(location?.speed))&&Number(location.speed)>=thresholdMps;}
export function isFreshLocation(location,{now=Date.now(),maxAgeMs=30_000}={}){const timestamp=Number(location?.timestamp),current=nowMs(now),age=current-timestamp;return Number.isFinite(timestamp)&&Number.isFinite(age)&&age>=-5_000&&age<=Math.max(1_000,Number(maxAgeMs)||30_000);}
export function routeItemMetrics(itemProgress,model,{pastToleranceKm=.15}={}){
  const item=Number(itemProgress),current=Number(model?.progress),totalKm=Number(model?.totalKm),pastTolerance=Number.isFinite(totalKm)&&totalKm>0?Math.max(0,Number(pastToleranceKm)||0)/totalKm:.002;if(!Number.isFinite(item)||!Number.isFinite(current)||item+pastTolerance<current)return null;
  const boundedCurrent=Math.max(0,Math.min(1,current)),boundedItem=Math.max(boundedCurrent,Math.min(1,item)),remainingFraction=Math.max(0,1-boundedCurrent),aheadFraction=Math.max(0,boundedItem-boundedCurrent),ratio=remainingFraction>0?aheadFraction/remainingFraction:0;
  const distanceAheadKm=Number.isFinite(Number(model?.remainingKm))?Number((Number(model.remainingKm)*ratio).toFixed(2)):null;
  const etaMinutes=Number.isFinite(Number(model?.remainingSec))?Number((Number(model.remainingSec)*ratio/60).toFixed(1)):null;
  return {distanceAheadKm,etaMinutes,progress:boundedItem};
}
