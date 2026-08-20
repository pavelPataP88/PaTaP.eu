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
function projectToSegment(a,b,latitude,longitude){
  const meanLat=(a.latitude+b.latitude+Number(latitude))/3*Math.PI/180;
  const kx=111.320*Math.max(0.15,Math.cos(meanLat)),ky=110.574;
  const bx=(b.longitude-a.longitude)*kx,by=(b.latitude-a.latitude)*ky;
  const px=(Number(longitude)-a.longitude)*kx,py=(Number(latitude)-a.latitude)*ky;
  const len2=bx*bx+by*by;
  const t=len2>0?Math.max(0,Math.min(1,(px*bx+py*by)/len2)):0;
  const projected={latitude:a.latitude+(b.latitude-a.latitude)*t,longitude:a.longitude+(b.longitude-a.longitude)*t};
  return {t,projected,distanceKm:haversineKm(Number(latitude),Number(longitude),projected.latitude,projected.longitude)};
}
function closestGeometryPoint(geometry,latitude,longitude){
  const model=cumulativeGeometry(geometry);if(!model.points.length)return null;
  if(model.points.length===1){const p=model.points[0];return {index:0,segmentIndex:0,segmentProgress:0,distanceKm:haversineKm(Number(latitude),Number(longitude),p.latitude,p.longitude),routeKm:0,progress:0,totalKm:0,latitude:p.latitude,longitude:p.longitude};}
  let best=null;
  for(let i=0;i<model.points.length-1;i++){
    const a=model.points[i],b=model.points[i+1],projected=projectToSegment(a,b,latitude,longitude);
    const segmentKm=model.cumulative[i+1]-model.cumulative[i];
    const routeKm=model.cumulative[i]+segmentKm*projected.t;
    if(!best||projected.distanceKm<best.distanceKm)best={index:projected.t>=0.5?i+1:i,segmentIndex:i,segmentProgress:projected.t,distanceKm:projected.distanceKm,routeKm,progress:model.totalKm>0?routeKm/model.totalKm:0,totalKm:model.totalKm,latitude:projected.projected.latitude,longitude:projected.projected.longitude};
  }
  return best;
}
function corridorItems(geometry,items,{maxDistanceKm=2.5,latitudeKey="latitude",longitudeKey="longitude"}={}){
  const model=cumulativeGeometry(geometry);if(model.points.length<2)return[];const out=[];
  for(const item of items||[]){
    const latitude=Number(item?.[latitudeKey]),longitude=Number(item?.[longitudeKey]);if(!Number.isFinite(latitude)||!Number.isFinite(longitude))continue;
    const best=closestGeometryPoint(model.points,latitude,longitude);
    if(best&&best.distanceKm<=maxDistanceKm)out.push({...item,route:{distanceFromRouteKm:Number(best.distanceKm.toFixed(3)),distanceFromStartKm:Number(best.routeKm.toFixed(3)),progress:Number(best.progress.toFixed(4))}});
  }
  return out.sort((a,b)=>a.route.distanceFromStartKm-b.route.distanceFromStartKm);
}
module.exports={coordinate,sampleGeometry,cumulativeGeometry,closestGeometryPoint,corridorItems,projectToSegment};
