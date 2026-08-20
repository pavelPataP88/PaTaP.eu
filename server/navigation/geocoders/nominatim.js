const DEFAULT_TIMEOUT_MS=6_000;
const FORBIDDEN_PUBLIC_HOSTS=new Set(["nominatim.openstreetmap.org"]);
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function cleanBaseUrl(value){return String(value||"").trim().replace(/\/+$/,"");}
function configuredUrl(value){const raw=cleanBaseUrl(value);if(!raw)return null;let parsed;try{parsed=new URL(raw);}catch{return null;}if(!["http:","https:"].includes(parsed.protocol))return null;if(FORBIDDEN_PUBLIC_HOSTS.has(parsed.hostname.toLowerCase()))return null;return raw;}
function normalizeItem(row,index){const latitude=Number(row?.lat),longitude=Number(row?.lon);if(!Number.isFinite(latitude)||latitude<-90||latitude>90||!Number.isFinite(longitude)||longitude<-180||longitude>180)return null;const address=row?.address||{};return {id:String(row?.place_id??row?.osm_id??index).slice(0,100),label:String(row?.display_name||row?.name||"").normalize("NFKC").replace(/\s+/g," ").trim().slice(0,300),latitude,longitude,countryCode:String(address.country_code||"").toUpperCase().slice(0,2)||null,category:String(row?.category||row?.class||"").slice(0,80),type:String(row?.type||row?.addresstype||"").slice(0,80),provider:"NOMINATIM_COMPAT",licence:String(row?.licence||"").slice(0,300)};}
function createNominatimGeocoder({baseUrl=process.env.NAV_GEOCODER_URL,timeoutMs=process.env.NAV_GEOCODER_TIMEOUT_MS,fetchImpl=globalThis.fetch}={}){
  const url=configuredUrl(baseUrl),timeout=clamp(Number(timeoutMs)||DEFAULT_TIMEOUT_MS,1000,30_000);
  function status(){return {name:"NOMINATIM_COMPAT",configured:Boolean(url),interactiveSearch:Boolean(url),publicOsmEndpointAllowed:false};}
  async function search(query,{limit=8,language="ru",near=null}={}){
    const q=String(query||"").normalize("NFKC").replace(/\s+/g," ").trim().slice(0,180);if(q.length<2)return[];
    if(!url||typeof fetchImpl!=="function"){const error=new Error("navigation_geocoder_unavailable");error.status=503;throw error;}
    const endpoint=new URL(`${url}/search`);endpoint.searchParams.set("q",q);endpoint.searchParams.set("format","jsonv2");endpoint.searchParams.set("addressdetails","1");endpoint.searchParams.set("limit",String(clamp(Number(limit)||8,1,10)));endpoint.searchParams.set("accept-language",String(language||"ru").slice(0,40));
    if(near&&Number.isFinite(Number(near.latitude))&&Number.isFinite(Number(near.longitude))){const lat=Number(near.latitude),lon=Number(near.longitude),latDelta=.8,lonDelta=.8/Math.max(.25,Math.cos(lat*Math.PI/180));endpoint.searchParams.set("viewbox",`${lon-lonDelta},${lat+latDelta},${lon+lonDelta},${lat-latDelta}`);}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);let response;
    try{response=await fetchImpl(endpoint,{headers:{Accept:"application/json","Accept-Language":String(language||"ru").slice(0,40),"User-Agent":"PaTaP-Driver-Navigation/1.0"},signal:controller.signal});}
    catch(error){const out=new Error(error?.name==="AbortError"?"navigation_geocoder_timeout":"navigation_geocoder_unavailable");out.status=error?.name==="AbortError"?504:503;throw out;}finally{clearTimeout(timer);}
    if(!response.ok){const error=new Error("navigation_geocoder_unavailable");error.status=503;throw error;}
    let data;try{data=await response.json();}catch{const error=new Error("navigation_geocoder_invalid_response");error.status=502;throw error;}
    if(!Array.isArray(data)){const error=new Error("navigation_geocoder_invalid_response");error.status=502;throw error;}
    return data.map(normalizeItem).filter((item)=>item&&item.label).slice(0,10);
  }
  return {status,search};
}
module.exports={createNominatimGeocoder,normalizeItem,configuredUrl,FORBIDDEN_PUBLIC_HOSTS};
