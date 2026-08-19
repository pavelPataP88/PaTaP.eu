const crypto = require("crypto");
const { ensureParkingSchema } = require("./schema");

const BOOL_FIELDS = [
  "access_24h","extra_long_allowed","adr_allowed","trailer_decoupling","toilet","shower","restaurant","shop","wifi","laundry","water","accommodation","vending",
  "diesel","adblue","lng","hydrogen","ev_charging","frigo_power","truck_wash","truck_repair","restricted_access","cctv","guard","fence","gate","lighting","personal_access_control","reservable"
];
const AMENITY_QUERY_FIELDS = new Set(["toilet","shower","restaurant","shop","wifi","laundry","water","accommodation","vending","diesel","adblue","lng","hydrogen","ev_charging","frigo_power","truck_wash","truck_repair"]);
const SECURITY_QUERY_FIELDS = new Set(["restricted_access","cctv","guard","fence","gate","lighting","personal_access_control"]);
const OCCUPANCY_SCORE = Object.freeze({ AVAILABLE: 0.15, LIMITED: 0.65, FULL: 1, CLOSED: 1.2, UNKNOWN: 0.5 });
const SOURCE_AUTHORITY = Object.freeze({ OFFICIAL_DATEX: 95, OPERATOR: 90, MANUAL_ADMIN: 85, OSM: 65, PATAP_COMMUNITY: 55, OTHER: 45 });
const CERT_ORDER = Object.freeze({ NONE: 0, BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4 });

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function num(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function bool(value) { return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "yes"; }
function text(value, max = 300) { return String(value ?? "").normalize("NFKC").replace(/\s+/g," ").trim().slice(0,max); }
function country(value) { const v = text(value,2).toUpperCase(); return /^[A-Z]{2}$/.test(v) ? v : null; }
function normalizedKey(value) { return text(value,160).toLocaleLowerCase("und").replace(/[^\p{L}\p{N}]+/gu," ").trim(); }
function nowMs(value) { const ms = Date.parse(value || ""); return Number.isFinite(ms) ? ms : 0; }
function addMinutes(iso, minutes) { return new Date(Date.parse(iso) + minutes * 60_000).toISOString(); }
function haversineKm(aLat,aLon,bLat,bLon) {
  const r = 6371.0088, rad = (v) => v * Math.PI / 180;
  const dLat = rad(bLat-aLat), dLon = rad(bLon-aLon);
  const x = Math.sin(dLat/2)**2 + Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLon/2)**2;
  return r * 2 * Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
function canonicalKey(input) {
  if (input.canonicalKey) return text(input.canonicalKey,180);
  const lat = Number(input.latitude).toFixed(5), lon = Number(input.longitude).toFixed(5);
  const key = normalizedKey(input.name || input.operator || "parking").slice(0,60).replaceAll(" ","-") || "parking";
  return `${country(input.countryCode) || "XX"}:${lat}:${lon}:${key}`;
}

function createParkingRepository(db, { nowIso = () => new Date().toISOString() } = {}) {
  ensureParkingSchema(db, nowIso());

  function hasDriver(userId) { return Boolean(db.prepare("SELECT 1 FROM driver_profiles WHERE user_id=?").get(userId)); }
  function placeRow(placeId) { return db.prepare("SELECT * FROM parking_places WHERE id=? AND status!='REMOVED'").get(Number(placeId)) || null; }

  function normalizePlace(input, { community = false } = {}) {
    const latitude = num(input?.latitude), longitude = num(input?.longitude);
    const name = text(input?.name,120);
    if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || !name) return null;
    const kind = ["TRUCK_PARKING","REST_AREA","SERVICE_AREA","MOP","SECURE_PARKING","YARD","OTHER"].includes(String(input.kind||"").toUpperCase()) ? String(input.kind).toUpperCase() : "TRUCK_PARKING";
    const feeMode = ["FREE","PAID","MIXED","UNKNOWN"].includes(String(input.feeMode||"").toUpperCase()) ? String(input.feeMode).toUpperCase() : "UNKNOWN";
    const certificationLevel = Object.hasOwn(CERT_ORDER,String(input.certificationLevel||"").toUpperCase()) ? String(input.certificationLevel).toUpperCase() : "NONE";
    const out = {
      canonical_key: canonicalKey({ ...input, latitude, longitude, name }), status: community ? "COMMUNITY_UNVERIFIED" : (input.status || "ACTIVE"), kind, name, latitude, longitude,
      country_code: country(input.countryCode), address: text(input.address,300), road: text(input.road,80), direction: text(input.direction,80), operator: text(input.operator,120), phone: text(input.phone,80), website: text(input.website,400), opening_hours: text(input.openingHours,200),
      capacity_truck: Number.isSafeInteger(Number(input.capacityTruck)) && Number(input.capacityTruck)>=0 ? Number(input.capacityTruck) : null,
      capacity_total: Number.isSafeInteger(Number(input.capacityTotal)) && Number(input.capacityTotal)>=0 ? Number(input.capacityTotal) : null,
      fee_mode: feeMode, price_text: text(input.priceText,160), currency: text(input.currency,3).toUpperCase(),
      max_length_m: num(input.maxLengthM), max_height_m: num(input.maxHeightM), max_weight_t: num(input.maxWeightT),
      certification_level: certificationLevel, certification_source: text(input.certificationSource,160), certification_valid_until: input.certificationValidUntil || null,
      booking_provider: text(input.bookingProvider,100), booking_url: text(input.bookingUrl,500), booking_phone: text(input.bookingPhone,80), booking_instructions: text(input.bookingInstructions,500),
      data_confidence: clamp(num(input.dataConfidence) ?? (community ? 0.4 : 0.65),0,1)
    };
    for (const field of BOOL_FIELDS) {
      const camel = field.replace(/_([a-z])/g,(_,c)=>c.toUpperCase());
      out[field] = bool(input[camel] ?? input[field]) ? 1 : 0;
    }
    return out;
  }

  function ensurePreferences(userId, now = nowIso()) {
    db.prepare(`INSERT OR IGNORE INTO parking_user_preferences(user_id,vehicle_class,max_detour_km,updated_at) VALUES(?, 'TIR', 10, ?)`)
      .run(userId,now);
    return db.prepare("SELECT * FROM parking_user_preferences WHERE user_id=?").get(userId);
  }

  function publicPreferences(row) {
    return { vehicleClass:row.vehicle_class,lengthM:row.length_m,heightM:row.height_m,weightT:row.weight_t,adrRequired:Boolean(row.adr_required),refrigerated:Boolean(row.refrigerated),secureOnly:Boolean(row.secure_only),maxDetourKm:Number(row.max_detour_km) };
  }

  function updatePreferences(userId,input,now=nowIso()) {
    const current=ensurePreferences(userId,now);
    const vehicleClass=input.vehicleClass===undefined?current.vehicle_class:String(input.vehicleClass).toUpperCase();
    if(!["TIR","VAN","CAR","OTHER"].includes(vehicleClass)) return {error:"invalid_parking_preferences",status:400};
    const dimension=(key,currentValue,min,max)=>input[key]===undefined?currentValue:(input[key]===null||input[key]===""?null:num(input[key]));
    const lengthM=dimension("lengthM",current.length_m,1,40),heightM=dimension("heightM",current.height_m,1,8),weightT=dimension("weightT",current.weight_t,0.5,100);
    if((lengthM!==null&&(lengthM<1||lengthM>40))||(heightM!==null&&(heightM<1||heightM>8))||(weightT!==null&&(weightT<0.5||weightT>100))) return {error:"invalid_parking_preferences",status:400};
    const maxDetour=input.maxDetourKm===undefined?Number(current.max_detour_km):num(input.maxDetourKm);
    if(maxDetour===null||maxDetour<0.5||maxDetour>100) return {error:"invalid_parking_preferences",status:400};
    db.prepare(`UPDATE parking_user_preferences SET vehicle_class=?,length_m=?,height_m=?,weight_t=?,adr_required=?,refrigerated=?,secure_only=?,max_detour_km=?,updated_at=? WHERE user_id=?`)
      .run(vehicleClass,lengthM,heightM,weightT,input.adrRequired===undefined?current.adr_required:(input.adrRequired?1:0),input.refrigerated===undefined?current.refrigerated:(input.refrigerated?1:0),input.secureOnly===undefined?current.secure_only:(input.secureOnly?1:0),maxDetour,now,userId);
    return { preferences:publicPreferences(ensurePreferences(userId,now)) };
  }

  function sourceSummary(placeId) {
    return db.prepare("SELECT source_type,source_name,source_url,licence_text,source_updated_at,imported_at,authority FROM parking_place_sources WHERE place_id=? ORDER BY authority DESC,id ASC")
      .all(placeId).map(r=>({type:r.source_type,name:r.source_name,url:r.source_url,licence:r.licence_text,sourceUpdatedAt:r.source_updated_at,importedAt:r.imported_at,authority:Number(r.authority)}));
  }

  function reviewSummary(placeId) {
    const row=db.prepare(`SELECT COUNT(*) n,AVG(overall) overall,AVG(security) security,AVG(cleanliness) cleanliness,AVG(access_rating) access_rating,AVG(quietness) quietness FROM parking_reviews WHERE place_id=?`).get(placeId);
    return { count:Number(row.n||0),overall:row.overall===null?null:Number(Number(row.overall).toFixed(2)),security:row.security===null?null:Number(Number(row.security).toFixed(2)),cleanliness:row.cleanliness===null?null:Number(Number(row.cleanliness).toFixed(2)),access:row.access_rating===null?null:Number(Number(row.access_rating).toFixed(2)),quietness:row.quietness===null?null:Number(Number(row.quietness).toFixed(2)) };
  }

  function liveOccupancy(placeId, now=nowIso()) {
    const nowTime=Date.parse(now);
    const rows=db.prepare(`SELECT * FROM parking_occupancy_observations WHERE place_id=? AND observed_at>=? ORDER BY observed_at DESC LIMIT 80`)
      .all(placeId,new Date(nowTime-7*24*3600_000).toISOString());
    const active=rows.filter(r=>{
      const age=(nowTime-nowMs(r.observed_at))/60000;
      if(r.expires_at&&Date.parse(r.expires_at)<=nowTime)return false;
      return r.source_type==="OFFICIAL"||r.source_type==="OPERATOR"?age<=30:age<=120;
    });
    const authoritative=active.find(r=>["OFFICIAL","OPERATOR"].includes(r.source_type)&&((nowTime-nowMs(r.observed_at))/60000)<=30);
    if(authoritative) return {status:authoritative.status,freeSpots:authoritative.free_spots===null?null:Number(authoritative.free_spots),totalSpots:authoritative.total_spots===null?null:Number(authoritative.total_spots),source:authoritative.source_type,updatedAt:authoritative.observed_at,confidence:0.96,predicted:false,sampleCount:1};
    const drivers=active.filter(r=>r.source_type==="DRIVER");
    if(drivers.length){
      const latestByUser=new Map();for(const r of drivers){const k=String(r.user_id||r.source_key||r.id);if(!latestByUser.has(k))latestByUser.set(k,r);}
      const unique=[...latestByUser.values()];let totalWeight=0,score=0;const counts={AVAILABLE:0,LIMITED:0,FULL:0,CLOSED:0,UNKNOWN:0};
      for(const r of unique){const age=Math.max(0,(nowTime-nowMs(r.observed_at))/60000);const w=Math.exp(-age/65);totalWeight+=w;score+=(OCCUPANCY_SCORE[r.status]??0.5)*w;counts[r.status]=(counts[r.status]||0)+1;}
      const avg=score/Math.max(totalWeight,0.001);const status=avg>=1.05?"CLOSED":avg>=0.82?"FULL":avg>=0.45?"LIMITED":"AVAILABLE";
      const agreement=(Math.max(...Object.values(counts))/unique.length);const confidence=clamp(0.45+Math.min(unique.length,5)*0.08+agreement*0.15,0,0.92);
      const latest=unique.reduce((a,b)=>nowMs(a.observed_at)>nowMs(b.observed_at)?a:b);
      return {status,freeSpots:null,totalSpots:null,source:"DRIVER",updatedAt:latest.observed_at,confidence:Number(confidence.toFixed(2)),predicted:false,sampleCount:unique.length};
    }
    return prediction(placeId,now,rows);
  }

  function prediction(placeId,now=nowIso(),prefetched=null) {
    const target=new Date(now),weekday=target.getUTCDay(),hour=target.getUTCHours();
    const rows=prefetched||db.prepare("SELECT status,observed_at FROM parking_occupancy_observations WHERE place_id=? AND observed_at>=? ORDER BY observed_at DESC LIMIT 500")
      .all(placeId,new Date(Date.parse(now)-180*24*3600_000).toISOString());
    const samples=rows.filter(r=>{const d=new Date(r.observed_at);const hourDiff=Math.min(24-Math.abs(d.getUTCHours()-hour),Math.abs(d.getUTCHours()-hour));return d.getUTCDay()===weekday&&hourDiff<=2&&Object.hasOwn(OCCUPANCY_SCORE,r.status);});
    if(samples.length<5)return {status:"UNKNOWN",freeSpots:null,totalSpots:null,source:"NONE",updatedAt:null,confidence:0,predicted:false,sampleCount:samples.length};
    let sum=0,wSum=0;for(const r of samples){const ageDays=Math.max(0,(Date.parse(now)-nowMs(r.observed_at))/86400000);const w=Math.exp(-ageDays/90);sum+=OCCUPANCY_SCORE[r.status]*w;wSum+=w;}
    const avg=sum/Math.max(wSum,0.001);const status=avg>=1.05?"CLOSED":avg>=0.82?"FULL":avg>=0.45?"LIMITED":"AVAILABLE";const confidence=clamp(0.35+Math.min(samples.length,30)/60,0,0.82);
    return {status,freeSpots:null,totalSpots:null,source:"HISTORY",updatedAt:null,confidence:Number(confidence.toFixed(2)),predicted:true,sampleCount:samples.length};
  }

  function vehicleFit(row,prefs) {
    const issues=[];let score=100;
    if(prefs.length_m&&row.max_length_m&&prefs.length_m>row.max_length_m){issues.push("length_limit");score-=55;}
    if(prefs.height_m&&row.max_height_m&&prefs.height_m>row.max_height_m){issues.push("height_limit");score-=70;}
    if(prefs.weight_t&&row.max_weight_t&&prefs.weight_t>row.max_weight_t){issues.push("weight_limit");score-=70;}
    if(prefs.adr_required&&!row.adr_allowed){issues.push("adr_not_supported");score-=45;}
    if(prefs.refrigerated&&!row.frigo_power){issues.push("frigo_power_missing");score-=15;}
    const secure=Number(row.restricted_access)+Number(row.cctv)+Number(row.guard)+Number(row.fence)+Number(row.gate)+CERT_ORDER[row.certification_level];
    if(prefs.secure_only&&secure<2){issues.push("security_required");score-=50;}
    return {score:clamp(score,0,100),issues,compatible:!issues.some(x=>["length_limit","height_limit","weight_limit"].includes(x))};
  }

  function publicPlace(row,userId,{origin=null,prefs=null,includeSources=false}={}) {
    if(!row)return null;const preferences=prefs||ensurePreferences(userId);const occupancy=liveOccupancy(Number(row.id));const reviews=reviewSummary(Number(row.id));const fit=vehicleFit(row,preferences);
    const favorite=Boolean(db.prepare("SELECT 1 FROM parking_favorites WHERE user_id=? AND place_id=?").get(userId,row.id));
    const distanceKm=origin?haversineKm(origin.latitude,origin.longitude,row.latitude,row.longitude):null;
    const securityScore=Number(row.restricted_access)+Number(row.cctv)+Number(row.guard)+Number(row.fence)+Number(row.gate)+Number(row.lighting)+Number(row.personal_access_control)+CERT_ORDER[row.certification_level]*2;
    const result={id:Number(row.id),status:row.status,kind:row.kind,name:row.name,latitude:Number(row.latitude),longitude:Number(row.longitude),countryCode:row.country_code,address:row.address,road:row.road,direction:row.direction,operator:row.operator,phone:row.phone,website:row.website,openingHours:row.opening_hours,capacity:{truck:row.capacity_truck===null?null:Number(row.capacity_truck),total:row.capacity_total===null?null:Number(row.capacity_total)},access24h:Boolean(row.access_24h),fee:{mode:row.fee_mode,priceText:row.price_text,currency:row.currency},restrictions:{maxLengthM:row.max_length_m,maxHeightM:row.max_height_m,maxWeightT:row.max_weight_t,extraLongAllowed:Boolean(row.extra_long_allowed),adrAllowed:Boolean(row.adr_allowed),trailerDecoupling:Boolean(row.trailer_decoupling)},amenities:{toilet:Boolean(row.toilet),shower:Boolean(row.shower),restaurant:Boolean(row.restaurant),shop:Boolean(row.shop),wifi:Boolean(row.wifi),laundry:Boolean(row.laundry),water:Boolean(row.water),accommodation:Boolean(row.accommodation),vending:Boolean(row.vending),diesel:Boolean(row.diesel),adblue:Boolean(row.adblue),lng:Boolean(row.lng),hydrogen:Boolean(row.hydrogen),evCharging:Boolean(row.ev_charging),frigoPower:Boolean(row.frigo_power),truckWash:Boolean(row.truck_wash),truckRepair:Boolean(row.truck_repair)},security:{restrictedAccess:Boolean(row.restricted_access),cctv:Boolean(row.cctv),guard:Boolean(row.guard),fence:Boolean(row.fence),gate:Boolean(row.gate),lighting:Boolean(row.lighting),personalAccessControl:Boolean(row.personal_access_control),certificationLevel:row.certification_level,certificationSource:row.certification_source,certificationValidUntil:row.certification_valid_until,score:securityScore},booking:{reservable:Boolean(row.reservable),provider:row.booking_provider,url:row.booking_url,phone:row.booking_phone,instructions:row.booking_instructions},occupancy,reviews,fit,favorite,distanceKm:distanceKm===null?null:Number(distanceKm.toFixed(3)),dataConfidence:Number(row.data_confidence),lastVerifiedAt:row.last_verified_at,updatedAt:row.updated_at};
    if(includeSources)result.sources=sourceSummary(Number(row.id));
    return result;
  }

  function parseFilters(input={}) {
    const amenities=String(input.amenities||"").split(",").map(v=>v.trim()).filter(v=>AMENITY_QUERY_FIELDS.has(v));
    const security=String(input.security||"").split(",").map(v=>v.trim()).filter(v=>SECURITY_QUERY_FIELDS.has(v));
    const certification=String(input.certification||"NONE").toUpperCase();
    return {amenities,security,certification:Object.hasOwn(CERT_ORDER,certification)?certification:"NONE",reservable:input.reservable===true||input.reservable==="1",availableOnly:input.availableOnly===true||input.availableOnly==="1",countryCode:country(input.countryCode||input.country),kind:text(input.kind,40).toUpperCase(),query:text(input.query||input.q,80).toLocaleLowerCase("und")};
  }

  function filterAndRank(rows,userId,{origin=null,filters={},limit=50,routeDistance=null}={}) {
    const prefs=ensurePreferences(userId);const parsed=parseFilters(filters);const out=[];
    for(const row of rows){
      if(parsed.countryCode&&row.country_code!==parsed.countryCode)continue;
      if(parsed.kind&&row.kind!==parsed.kind)continue;
      if(parsed.query&&!`${row.name} ${row.operator} ${row.address} ${row.road}`.toLocaleLowerCase("und").includes(parsed.query))continue;
      if(parsed.amenities.some(k=>!row[k]))continue;if(parsed.security.some(k=>!row[k]))continue;
      if(CERT_ORDER[row.certification_level]<CERT_ORDER[parsed.certification])continue;if(parsed.reservable&&!row.reservable)continue;
      const card=publicPlace(row,userId,{origin,prefs});if(parsed.availableOnly&&!["AVAILABLE","LIMITED"].includes(card.occupancy.status))continue;
      const routeKm=routeDistance?routeDistance(row):null;let rank=0;
      rank+=card.fit.compatible?0:1000;rank+=(100-card.fit.score)*1.8;
      rank+=card.occupancy.status==="CLOSED"?700:card.occupancy.status==="FULL"?450:card.occupancy.status==="LIMITED"?80:card.occupancy.status==="UNKNOWN"?35:0;
      rank+=(card.distanceKm??routeKm??0)*8;if(routeKm!==null)rank+=routeKm*15;
      if(prefs.secure_only)rank-=Math.min(card.security.score,12)*6;
      rank-=Math.min(card.reviews.overall||0,5)*8;rank-=card.dataConfidence*30;if(card.favorite)rank-=25;if(card.booking.reservable)rank-=4;
      out.push({...card,routeDistanceKm:routeKm===null?null:Number(routeKm.toFixed(3)),_rank:rank});
    }
    out.sort((a,b)=>a._rank-b._rank||((a.distanceKm??99999)-(b.distanceKm??99999))||a.id-b.id);
    return out.slice(0,Math.min(Math.max(Number(limit)||50,1),100)).map(({_rank,...item})=>item);
  }

  function search(userId,input={}) {
    const lat=num(input.latitude??input.lat),lon=num(input.longitude??input.lon),radius=clamp(num(input.radiusKm)??25,1,300);let rows;
    if(lat!==null&&lon!==null){const latDelta=radius/111.2,lonDelta=radius/(111.2*Math.max(0.2,Math.cos(lat*Math.PI/180)));rows=db.prepare(`SELECT * FROM parking_places WHERE status!='REMOVED' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?`).all(lat-latDelta,lat+latDelta,lon-lonDelta,lon+lonDelta).filter(r=>haversineKm(lat,lon,r.latitude,r.longitude)<=radius);}
    else rows=db.prepare("SELECT * FROM parking_places WHERE status!='REMOVED' ORDER BY updated_at DESC LIMIT 500").all();
    return filterAndRank(rows,userId,{origin:lat!==null&&lon!==null?{latitude:lat,longitude:lon}:null,filters:input,limit:input.limit||50});
  }

  function placeDetails(userId,placeId,{origin=null}={}) {
    const row=placeRow(placeId);if(!row)return null;const place=publicPlace(row,userId,{origin,includeSources:true});
    const reviews=db.prepare(`SELECT r.*,p.nickname FROM parking_reviews r JOIN driver_profiles p ON p.user_id=r.user_id WHERE r.place_id=? ORDER BY r.updated_at DESC LIMIT 100`).all(placeId).map(r=>({author:r.nickname,overall:Number(r.overall),security:r.security,cleanliness:r.cleanliness,access:r.access_rating,quietness:r.quietness,text:r.text,visitedAt:r.visited_at,createdAt:r.created_at,updatedAt:r.updated_at,isMine:Number(r.user_id)===Number(userId)}));
    const photos=db.prepare(`SELECT ph.id,ph.mime_type,ph.byte_length,ph.file_name,ph.created_at,p.nickname FROM parking_photos ph LEFT JOIN driver_profiles p ON p.user_id=ph.uploader_id WHERE ph.place_id=? AND ph.state='VISIBLE' ORDER BY ph.created_at DESC LIMIT 40`).all(placeId).map(r=>({id:Number(r.id),mimeType:r.mime_type,byteLength:Number(r.byte_length),fileName:r.file_name,createdAt:r.created_at,uploader:r.nickname||null,url:`/api/driver/parking/photos/${r.id}/content`}));
    const alternatives=search(userId,{latitude:row.latitude,longitude:row.longitude,radiusKm:50,limit:5}).filter(p=>p.id!==Number(placeId)).slice(0,3);
    return {place,reviews,photos,alternatives};
  }

  function setFavorite(userId,placeId,enabled,now=nowIso()) {if(!placeRow(placeId))return {error:"parking_not_found",status:404};if(enabled)db.prepare("INSERT OR IGNORE INTO parking_favorites(user_id,place_id,created_at) VALUES(?,?,?)").run(userId,placeId,now);else db.prepare("DELETE FROM parking_favorites WHERE user_id=? AND place_id=?").run(userId,placeId);return {favorite:Boolean(enabled)};}
  function favorites(userId){const rows=db.prepare(`SELECT p.* FROM parking_favorites f JOIN parking_places p ON p.id=f.place_id WHERE f.user_id=? AND p.status!='REMOVED' ORDER BY f.created_at DESC`).all(userId);return filterAndRank(rows,userId,{limit:100});}

  function reportOccupancy(userId,placeId,input,now=nowIso()) {
    if(!placeRow(placeId))return {error:"parking_not_found",status:404};const status=String(input?.status||"").toUpperCase();if(!Object.hasOwn(OCCUPANCY_SCORE,status))return {error:"invalid_parking_occupancy",status:400};
    const free=input.freeSpots===undefined||input.freeSpots===null?null:Number(input.freeSpots),total=input.totalSpots===undefined||input.totalSpots===null?null:Number(input.totalSpots);if((free!==null&&(!Number.isSafeInteger(free)||free<0))||(total!==null&&(!Number.isSafeInteger(total)||total<0))||(free!==null&&total!==null&&free>total))return {error:"invalid_parking_occupancy",status:400};
    db.prepare(`INSERT INTO parking_occupancy_observations(place_id,source_type,source_key,user_id,status,free_spots,total_spots,note,observed_at,expires_at,created_at) VALUES(?,'DRIVER','',?,?,?,?,?,?,?,?)`)
      .run(placeId,userId,status,free,total,text(input.note,160),now,addMinutes(now,120),now);
    return {occupancy:liveOccupancy(placeId,now)};
  }

  function addOfficialOccupancy(placeId,input,now=nowIso()) {
    const status=String(input.status||"UNKNOWN").toUpperCase();if(!Object.hasOwn(OCCUPANCY_SCORE,status)||!placeRow(placeId))return false;
    db.prepare(`INSERT INTO parking_occupancy_observations(place_id,source_type,source_key,user_id,status,free_spots,total_spots,note,observed_at,expires_at,created_at) VALUES(?,?,?,NULL,?,?,?,?,?,?,?)`)
      .run(placeId,input.sourceType||"OFFICIAL",text(input.sourceKey,120),status,input.freeSpots??null,input.totalSpots??null,text(input.note,160),input.observedAt||now,input.expiresAt||addMinutes(input.observedAt||now,30),now);return true;
  }

  function upsertReview(userId,placeId,input,now=nowIso()) {
    if(!placeRow(placeId))return {error:"parking_not_found",status:404};const rating=(v,required=false)=>v===undefined||v===null?(required?NaN:null):Number(v);const overall=rating(input.overall,true),security=rating(input.security),cleanliness=rating(input.cleanliness),access=rating(input.access),quietness=rating(input.quietness);if(![overall,security,cleanliness,access,quietness].every(v=>v===null||(Number.isInteger(v)&&v>=1&&v<=5)))return {error:"invalid_parking_review",status:400};
    const existing=db.prepare("SELECT created_at FROM parking_reviews WHERE place_id=? AND user_id=?").get(placeId,userId);db.prepare(`INSERT INTO parking_reviews(place_id,user_id,overall,security,cleanliness,access_rating,quietness,text,visited_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(place_id,user_id) DO UPDATE SET overall=excluded.overall,security=excluded.security,cleanliness=excluded.cleanliness,access_rating=excluded.access_rating,quietness=excluded.quietness,text=excluded.text,visited_at=excluded.visited_at,updated_at=excluded.updated_at`)
      .run(placeId,userId,overall,security,cleanliness,access,quietness,text(input.text,1200),input.visitedAt||null,existing?.created_at||now,now);return {reviews:reviewSummary(placeId)};
  }
  function deleteReview(userId,placeId){const changes=db.prepare("DELETE FROM parking_reviews WHERE place_id=? AND user_id=?").run(placeId,userId).changes;return changes?{deleted:true}:{error:"parking_review_not_found",status:404};}

  function addCorrection(userId,placeId,input,now=nowIso()) {if(!placeRow(placeId))return {error:"parking_not_found",status:404};const kind=String(input?.kind||"OTHER").toUpperCase();if(!["WRONG_INFO","CLOSED","ACCESS","AMENITY","SECURITY","CAPACITY","LOCATION","OTHER"].includes(kind)||!text(input.message,800))return {error:"invalid_parking_correction",status:400};const info=db.prepare("INSERT INTO parking_corrections(place_id,user_id,kind,message,proposed_json,created_at) VALUES(?,?,?,?,?,?)").run(placeId,userId,kind,text(input.message,800),JSON.stringify(input.proposed||{}),now);return {correction:{id:Number(info.lastInsertRowid),state:"OPEN"}};}

  function createCommunityPlace(userId,input,now=nowIso()) {
    const normalized=normalizePlace(input,{community:true});if(!normalized)return {error:"invalid_parking_place",status:400};
    const nearby=db.prepare("SELECT * FROM parking_places WHERE status!='REMOVED' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?").all(normalized.latitude-0.002,normalized.latitude+0.002,normalized.longitude-0.003,normalized.longitude+0.003).find(r=>haversineKm(normalized.latitude,normalized.longitude,r.latitude,r.longitude)<=0.15&&normalizedKey(r.name)===normalizedKey(normalized.name));if(nearby)return {error:"parking_possible_duplicate",status:409,existingId:Number(nearby.id)};
    const cols=Object.keys(normalized),values=Object.values(normalized);const result=db.prepare(`INSERT INTO parking_places(${cols.join(",")},created_by,created_at,updated_at,last_verified_at) VALUES(${cols.map(()=>"?").join(",")},?,?,?,?)`).run(...values,userId,now,now,null);const placeId=Number(result.lastInsertRowid);
    db.prepare(`INSERT INTO parking_place_sources(place_id,source_type,external_id,authority,source_name,source_url,licence_text,source_updated_at,imported_at,raw_json,raw_hash) VALUES(?,'PATAP_COMMUNITY',?,?,?,?,?,?,?,?,?)`)
      .run(placeId,`driver:${userId}:${placeId}`,SOURCE_AUTHORITY.PATAP_COMMUNITY,"PaTaP Driver","","PaTaP community contribution",now,now,JSON.stringify(input),crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex"));
    return {place:publicPlace(placeRow(placeId),userId,{includeSources:true}),created:true};
  }

  function routeDistanceToPlace(points,row) {let best=Infinity;for(const p of points){const lat=num(p.latitude??p.lat),lon=num(p.longitude??p.lon);if(lat===null||lon===null)continue;best=Math.min(best,haversineKm(lat,lon,row.latitude,row.longitude));}return best;}
  function alongRoute(userId,input={}) {const points=Array.isArray(input.points)?input.points.slice(0,400):[];if(points.length<2)return {error:"invalid_parking_route",status:400};const corridor=clamp(num(input.corridorKm)??10,1,50);const lats=points.map(p=>num(p.latitude??p.lat)).filter(v=>v!==null),lons=points.map(p=>num(p.longitude??p.lon)).filter(v=>v!==null);if(lats.length<2||lons.length<2)return {error:"invalid_parking_route",status:400};const latDelta=corridor/111.2,meanLat=lats.reduce((a,b)=>a+b,0)/lats.length,lonDelta=corridor/(111.2*Math.max(0.2,Math.cos(meanLat*Math.PI/180)));const rows=db.prepare("SELECT * FROM parking_places WHERE status!='REMOVED' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?").all(Math.min(...lats)-latDelta,Math.max(...lats)+latDelta,Math.min(...lons)-lonDelta,Math.max(...lons)+lonDelta).filter(r=>routeDistanceToPlace(points,r)<=corridor);return {places:filterAndRank(rows,userId,{filters:input,limit:input.limit||60,routeDistance:r=>routeDistanceToPlace(points,r)}),corridorKm:corridor};}

  function registerPhoto(userId,placeId,{storageKey,mimeType,byteLength,fileName},now=nowIso()){if(!placeRow(placeId))return {error:"parking_not_found",status:404};const info=db.prepare("INSERT INTO parking_photos(place_id,uploader_id,storage_key,mime_type,byte_length,file_name,created_at) VALUES(?,?,?,?,?,?,?)").run(placeId,userId,storageKey,mimeType,byteLength,text(fileName,160)||"parking-photo",now);return {photo:{id:Number(info.lastInsertRowid),url:`/api/driver/parking/photos/${info.lastInsertRowid}/content`}};}
  function photoForUser(userId,photoId){if(!hasDriver(userId))return null;return db.prepare("SELECT * FROM parking_photos WHERE id=? AND state='VISIBLE'").get(photoId)||null;}
  function deletePhoto(userId,photoId){const row=db.prepare("SELECT * FROM parking_photos WHERE id=? AND state!='REMOVED'").get(photoId);if(!row)return {error:"parking_photo_not_found",status:404};if(Number(row.uploader_id)!==Number(userId))return {error:"parking_photo_forbidden",status:403};db.prepare("UPDATE parking_photos SET state='REMOVED' WHERE id=?").run(photoId);return {deleted:true,storageKey:row.storage_key};}

  function upsertImportedPlace(input,source,now=nowIso()) {
    const normalized=normalizePlace(input);if(!normalized)return {error:"invalid_import_record"};const sourceType=String(source.type||"OTHER").toUpperCase();const externalId=text(source.externalId,180);if(!externalId)return {error:"invalid_import_source"};
    const existingSource=db.prepare("SELECT place_id FROM parking_place_sources WHERE source_type=? AND external_id=?").get(sourceType,externalId);let row=existingSource?placeRow(existingSource.place_id):null;let created=false;
    if(!row){const latDelta=0.003,lonDelta=0.004,candidates=db.prepare("SELECT * FROM parking_places WHERE status!='REMOVED' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?").all(normalized.latitude-latDelta,normalized.latitude+latDelta,normalized.longitude-lonDelta,normalized.longitude+lonDelta);row=candidates.find(r=>haversineKm(normalized.latitude,normalized.longitude,r.latitude,r.longitude)<=0.18&&(normalizedKey(r.name)===normalizedKey(normalized.name)||(normalized.operator&&normalizedKey(r.operator)===normalizedKey(normalized.operator))))||null;}
    if(!row){const cols=Object.keys(normalized),result=db.prepare(`INSERT INTO parking_places(${cols.join(",")},created_at,updated_at,last_verified_at) VALUES(${cols.map(()=>"?").join(",")},?,?,?)`).run(...Object.values(normalized),now,now,source.sourceUpdatedAt||now);row=placeRow(Number(result.lastInsertRowid));created=true;}
    const authority=clamp(Number(source.authority??SOURCE_AUTHORITY[sourceType]??45),0,100);const top=db.prepare("SELECT MAX(authority) a FROM parking_place_sources WHERE place_id=?").get(row.id).a??-1;
    if(authority>=top){const cols=Object.keys(normalized).filter(k=>k!=="canonical_key");db.prepare(`UPDATE parking_places SET ${cols.map(k=>`${k}=?`).join(",")},updated_at=?,last_verified_at=? WHERE id=?`).run(...cols.map(k=>normalized[k]),now,source.sourceUpdatedAt||now,row.id);}
    const raw=JSON.stringify(source.raw??input),hash=crypto.createHash("sha256").update(raw).digest("hex");db.prepare(`INSERT INTO parking_place_sources(place_id,source_type,external_id,authority,source_name,source_url,licence_text,source_updated_at,imported_at,raw_json,raw_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_type,external_id) DO UPDATE SET place_id=excluded.place_id,authority=excluded.authority,source_name=excluded.source_name,source_url=excluded.source_url,licence_text=excluded.licence_text,source_updated_at=excluded.source_updated_at,imported_at=excluded.imported_at,raw_json=excluded.raw_json,raw_hash=excluded.raw_hash`)
      .run(row.id,sourceType,externalId,authority,text(source.name,160),text(source.url,500),text(source.licence,300),source.sourceUpdatedAt||null,now,raw,hash);
    const authorities=db.prepare("SELECT authority FROM parking_place_sources WHERE place_id=?").all(row.id).map(r=>Number(r.authority));const confidence=clamp((Math.max(...authorities,40)/100)+(authorities.length>1?0.05:0),0,0.99);db.prepare("UPDATE parking_places SET data_confidence=? WHERE id=?").run(confidence,row.id);
    return {placeId:Number(row.id),created};
  }

  function startImport(sourceType,sourceName,now=nowIso()){const result=db.prepare("INSERT INTO parking_import_runs(source_type,source_name,started_at) VALUES(?,?,?)").run(sourceType,text(sourceName,160),now);return Number(result.lastInsertRowid);}
  function finishImport(runId,stats,{failed=false,details=""}={},now=nowIso()){db.prepare(`UPDATE parking_import_runs SET finished_at=?,records_seen=?,places_created=?,places_updated=?,observations_added=?,errors=?,state=?,details=? WHERE id=?`).run(now,stats.recordsSeen||0,stats.placesCreated||0,stats.placesUpdated||0,stats.observationsAdded||0,stats.errors||0,failed?"FAILED":"COMPLETED",text(details,1000),runId);}
  function importStatus(){return db.prepare("SELECT * FROM parking_import_runs ORDER BY id DESC LIMIT 20").all().map(r=>({id:Number(r.id),sourceType:r.source_type,sourceName:r.source_name,startedAt:r.started_at,finishedAt:r.finished_at,recordsSeen:Number(r.records_seen),placesCreated:Number(r.places_created),placesUpdated:Number(r.places_updated),observationsAdded:Number(r.observations_added),errors:Number(r.errors),state:r.state,details:r.details}));}

  return {hasDriver,placeRow,ensurePreferences,publicPreferences,updatePreferences,search,placeDetails,setFavorite,favorites,reportOccupancy,addOfficialOccupancy,upsertReview,deleteReview,addCorrection,createCommunityPlace,alongRoute,registerPhoto,photoForUser,deletePhoto,upsertImportedPlace,startImport,finishImport,importStatus,liveOccupancy,normalizePlace,haversineKm};
}

module.exports={createParkingRepository,SOURCE_AUTHORITY,haversineKm};
