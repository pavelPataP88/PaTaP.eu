const { haversineKm } = require("../road-reports/repository");

function coordinate(point){
  if(Array.isArray(point)&&point.length>=2){const longitude=Number(point[0]),latitude=Number(point[1]);return Number.isFinite(latitude)&&Number.isFinite(longitude)?{latitude,longitude}:null;}
  const latitude=Number(point?.latitude??point?.lat),longitude=Number(point?.longitude??point?.lon);return Number.isFinite(latitude)&&Number.isFinite(longitude)?{latitude,longitude}:null;
}
function sampleGeometry(geometry,maxPoints=400){
  const points=(geometry||[]).map(coordinate).filter(Boolean);if(points.length<=maxPoints)return points;
  const out=[];const last=points.length-1;for(let i=0;i<maxPoints;i++){const index=Math.round(i*last/(maxPoints-1));out.push(points[index]);}return out;
}
function cumulativeGeometry(geometry){
  const points=(geometry||[]).map(coordinate).filter(Boolean);const cumulative=[];let total=0;
  for(let i=0;i<points.length;i++){if(i)total+=haversineKm(points[i-1].latitude,points[i-1].longitude,points[i].latitude,points[i].longitude);cumulative.push(total);}return {points,cumulative,totalKm:total};
}
function closestGeometryPoint(geometry,latitude,longitude){
  const model=cumulativeGeometry(geometry);if(!model.points.length)return null;let best=null;
  for(let i=0;i<model.points.length;i++){const point=model.points[i],distanceKm=haversineKm(Number(latitude),Number(longitude),point.latitude,point.longitude);if(!best||distanceKm<best.distanceKm)best={index:i,distanceKm,routeKm:model.cumulative[i],progress:model.totalKm>0?model.cumulative[i]/model.totalKm:0};}
  return best?{...best,totalKm:model.totalKm}:null;
}
function corridorItems(geometry,items,{maxDistanceKm=2.5,latitudeKey="latitude",longitudeKey="longitude"}={}){
  const model=cumulativeGeometry(geometry);if(model.points.length<2)return[];const out=[];
  for(const item of items||[]){const latitude=Number(item?.[latitudeKey]),longitude=Number(item?.[longitudeKey]);if(!Number.isFinite(latitude)||!Number.isFinite(longitude))continue;let best=null;for(let i=0;i<model.points.length;i++){const p=model.points[i],d=haversineKm(latitude,longitude,p.latitude,p.longitude);if(!best||d<best.distanceKm)best={index:i,distanceKm:d,routeKm:model.cumulative[i],progress:model.totalKm?model.cumulative[i]/model.totalKm:0};}if(best&&best.distanceKm<=maxDistanceKm)out.push({...item,route:{distanceFromRouteKm:Number(best.distanceKm.toFixed(3)),distanceFromStartKm:Number(best.routeKm.toFixed(3)),progress:Number(best.progress.toFixed(4))}});}
  return out.sort((a,b)=>a.route.distanceFromStartKm-b.route.distanceFromStartKm);
}
module.exports={coordinate,sampleGeometry,cumulativeGeometry,closestGeometryPoint,corridorItems};
