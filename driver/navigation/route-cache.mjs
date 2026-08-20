const KEY="patap.driver.navigation.active.v1";
const MAX_AGE_MS=7*24*60*60_000;

function cleanPoint(point){if(!Array.isArray(point)||point.length<2)return null;const lon=Number(point[0]),lat=Number(point[1]);return Number.isFinite(lon)&&lon>=-180&&lon<=180&&Number.isFinite(lat)&&lat>=-90&&lat<=90?[lon,lat]:null;}
function safeAlternative(alternative){
  if(!alternative)return null;const geometry=(alternative.geometry||[]).slice(0,50000).map(cleanPoint).filter(Boolean);if(geometry.length<2)return null;
  return {id:String(alternative.id||"alt-1").slice(0,80),distanceKm:Number.isFinite(Number(alternative.distanceKm))?Number(alternative.distanceKm):null,durationSec:Number.isFinite(Number(alternative.durationSec))?Number(alternative.durationSec):null,eta:alternative.eta||null,geometry,maneuvers:(alternative.maneuvers||[]).slice(0,5000).map((m)=>({index:Number(m.index)||0,type:String(m.type||"UNKNOWN").slice(0,40),instruction:String(m.instruction||"").slice(0,500),street:String(m.street||"").slice(0,160),distanceKm:Number.isFinite(Number(m.distanceKm))?Number(m.distanceKm):null,timeSec:Number.isFinite(Number(m.timeSec))?Number(m.timeSec):null,beginShapeIndex:Number.isSafeInteger(Number(m.beginShapeIndex))?Number(m.beginShapeIndex):0,endShapeIndex:Number.isSafeInteger(Number(m.endShapeIndex))?Number(m.endShapeIndex):0})),difficulty:alternative.difficulty||null,toll:alternative.toll||null,trafficDelaySec:alternative.trafficDelaySec??null,providerWarnings:Array.isArray(alternative.providerWarnings)?alternative.providerWarnings.slice(0,20):[]};
}
function safeRoute(route){
  const selected=safeAlternative(route?.selectedAlternative||route?.alternatives?.find((a)=>a.id===route?.selectedAlternativeId)||route?.alternatives?.[0]);if(!selected)return null;
  return {id:String(route.id||"").slice(0,80),status:String(route.status||"ACTIVE").slice(0,20),provider:String(route.provider||"").slice(0,80),strategy:String(route.strategy||"").slice(0,40),selectedAlternativeId:selected.id,selectedAlternative:selected,routeGuard:route.routeGuard||{},enrichment:route.enrichment?.[selected.id]||route.enrichment||{},request:{destination:route.request?.destination||null,break:route.request?.break||null},updatedAt:route.updatedAt||new Date().toISOString(),expiresAt:route.expiresAt||new Date(Date.now()+MAX_AGE_MS).toISOString()};
}
export function saveActiveRoute(route,storage=globalThis.localStorage){try{const safe=safeRoute(route);if(!safe)return false;storage?.setItem(KEY,JSON.stringify(safe));return true;}catch{return false;}}
export function loadActiveRoute(storage=globalThis.localStorage,{now=Date.now()}={}){try{const raw=storage?.getItem(KEY);if(!raw)return null;const parsed=JSON.parse(raw),expires=Date.parse(parsed?.expiresAt||"");if(!Number.isFinite(expires)||expires<=now||now-Date.parse(parsed.updatedAt||0)>MAX_AGE_MS){storage?.removeItem(KEY);return null;}return safeRoute(parsed);}catch{return null;}}
export function clearActiveRoute(storage=globalThis.localStorage){try{storage?.removeItem(KEY);}catch{}}
export const ACTIVE_ROUTE_CACHE_KEY=KEY;
