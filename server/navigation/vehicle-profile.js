const { ensureNavigationSchema } = require("./schema");

const VEHICLE_CLASSES = new Set(["TRUCK","VAN","CAR","TAXI","OTHER"]);
const STRATEGIES = new Set(["FASTEST_LEGAL","PRACTICAL_TRUCK","EASY_TRUCK","ECONOMY","PARKING_AWARE"]);
const TRUCK_ONLY_STRATEGIES = new Set(["PRACTICAL_TRUCK","EASY_TRUCK"]);
const ADR_CODES = new Set(["NONE","A","B","C","D","E"]);

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function intOrNull(value) {
  const n = numberOrNull(value);
  return n !== null && Number.isSafeInteger(n) ? n : null;
}
function text(value, max = 40) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g," ").trim().slice(0,max);
}
function safeJsonArray(raw) {
  try { const value = JSON.parse(raw || "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
}
function cleanHazmatCategories(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((value) => text(value,32).toUpperCase()).filter(Boolean))].slice(0,20);
}
function driverClass(driverType) {
  switch (String(driverType || "").toUpperCase()) {
    case "TIR": return "TRUCK";
    case "DELIVERY": return "VAN";
    case "TAXI": return "TAXI";
    default: return "OTHER";
  }
}
function parkingClass(value, fallback) {
  switch (String(value || "").toUpperCase()) {
    case "TIR": return "TRUCK";
    case "VAN": return "VAN";
    case "CAR": return fallback === "TAXI" ? "TAXI" : "CAR";
    case "OTHER": return fallback;
    default: return fallback;
  }
}
function bool(value) { return value === true || value === 1 || value === "1"; }
function strategyAllowed(vehicleClass,strategy){return STRATEGIES.has(strategy)&&(!TRUCK_ONLY_STRATEGIES.has(strategy)||vehicleClass==="TRUCK");}

function createVehicleProfileRepository(db,{nowIso=()=>new Date().toISOString()}={}) {
  ensureNavigationSchema(db,nowIso());

  function row(userId) {
    return db.prepare("SELECT * FROM navigation_vehicle_profiles WHERE user_id=?").get(Number(userId)) || null;
  }

  function seed(userId, now = nowIso()) {
    const existing = row(userId);
    if (existing) return existing;
    const driver = db.prepare("SELECT driver_type FROM driver_profiles WHERE user_id=?").get(Number(userId));
    if (!driver) return null;
    const fallbackClass = driverClass(driver.driver_type);
    let parking = null;
    try { parking = db.prepare("SELECT * FROM parking_user_preferences WHERE user_id=?").get(Number(userId)) || null; } catch {}
    const vehicleClass = parkingClass(parking?.vehicle_class,fallbackClass);
    const strategy = vehicleClass === "TRUCK" ? "PRACTICAL_TRUCK" : "FASTEST_LEGAL";
    db.prepare(`INSERT INTO navigation_vehicle_profiles(
      user_id,vehicle_class,length_m,width_m,height_m,gross_weight_t,axle_load_t,axle_count,max_speed_kph,
      trailer,hazardous_goods,hazmat_categories_json,adr_tunnel_code,refrigerated,emission_class,co2_class,
      preferred_strategy,avoid_tolls,avoid_ferries,avoid_unpaved,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(Number(userId),vehicleClass,parking?.length_m??null,null,parking?.height_m??null,parking?.weight_t??null,null,null,null,
        vehicleClass==="TRUCK"?1:0,parking?.adr_required?1:0,"[]","NONE",parking?.refrigerated?1:0,"","",strategy,0,0,1,now,now);
    return row(userId);
  }

  function publicProfile(record) {
    if (!record) return null;
    return {
      vehicleClass:record.vehicle_class,
      lengthM:record.length_m===null?null:Number(record.length_m),
      widthM:record.width_m===null?null:Number(record.width_m),
      heightM:record.height_m===null?null:Number(record.height_m),
      grossWeightT:record.gross_weight_t===null?null:Number(record.gross_weight_t),
      axleLoadT:record.axle_load_t===null?null:Number(record.axle_load_t),
      axleCount:record.axle_count===null?null:Number(record.axle_count),
      maxSpeedKph:record.max_speed_kph===null?null:Number(record.max_speed_kph),
      trailer:Boolean(record.trailer),
      hazardousGoods:Boolean(record.hazardous_goods),
      hazmatCategories:safeJsonArray(record.hazmat_categories_json),
      adrTunnelCode:record.adr_tunnel_code,
      refrigerated:Boolean(record.refrigerated),
      emissionClass:record.emission_class,
      co2Class:record.co2_class,
      preferredStrategy:record.preferred_strategy,
      avoidTolls:Boolean(record.avoid_tolls),
      avoidFerries:Boolean(record.avoid_ferries),
      avoidUnpaved:Boolean(record.avoid_unpaved),
      updatedAt:record.updated_at
    };
  }

  function dimension(input,key,current,min,max) {
    if (!Object.prototype.hasOwnProperty.call(input,key)) return current;
    const n=numberOrNull(input[key]);
    if (input[key]!==null&&input[key]!==""&&(n===null||n<min||n>max)) throw new Error("invalid_navigation_profile");
    return n;
  }
  function integer(input,key,current,min,max) {
    if (!Object.prototype.hasOwnProperty.call(input,key)) return current;
    if (input[key]===null||input[key]==="") return null;
    const n=intOrNull(input[key]);if(n===null||n<min||n>max)throw new Error("invalid_navigation_profile");return n;
  }

  function update(userId,input={},now=nowIso()) {
    const current=seed(userId,now);if(!current)return {error:"driver_profile_required",status:409};
    try {
      const vehicleClass=input.vehicleClass===undefined?current.vehicle_class:String(input.vehicleClass).toUpperCase();
      let strategy=input.preferredStrategy===undefined?current.preferred_strategy:String(input.preferredStrategy).toUpperCase();
      const adr=input.adrTunnelCode===undefined?current.adr_tunnel_code:String(input.adrTunnelCode).toUpperCase();
      if(!VEHICLE_CLASSES.has(vehicleClass)||!STRATEGIES.has(strategy)||!ADR_CODES.has(adr))throw new Error("invalid_navigation_profile");
      if(!strategyAllowed(vehicleClass,strategy)){
        if(input.preferredStrategy===undefined&&vehicleClass!==current.vehicle_class)strategy="FASTEST_LEGAL";
        else throw new Error("invalid_navigation_profile");
      }
      const values={
        vehicleClass,
        lengthM:dimension(input,"lengthM",current.length_m,1,40),
        widthM:dimension(input,"widthM",current.width_m,1,6),
        heightM:dimension(input,"heightM",current.height_m,1,8),
        grossWeightT:dimension(input,"grossWeightT",current.gross_weight_t,0.5,100),
        axleLoadT:dimension(input,"axleLoadT",current.axle_load_t,0.5,40),
        axleCount:integer(input,"axleCount",current.axle_count,1,20),
        maxSpeedKph:integer(input,"maxSpeedKph",current.max_speed_kph,20,180),
        trailer:input.trailer===undefined?Boolean(current.trailer):bool(input.trailer),
        hazardousGoods:input.hazardousGoods===undefined?Boolean(current.hazardous_goods):bool(input.hazardousGoods),
        hazmatCategories:input.hazmatCategories===undefined?safeJsonArray(current.hazmat_categories_json):cleanHazmatCategories(input.hazmatCategories),
        adrTunnelCode:adr,
        refrigerated:input.refrigerated===undefined?Boolean(current.refrigerated):bool(input.refrigerated),
        emissionClass:input.emissionClass===undefined?current.emission_class:text(input.emissionClass,40),
        co2Class:input.co2Class===undefined?current.co2_class:text(input.co2Class,40),
        preferredStrategy:strategy,
        avoidTolls:input.avoidTolls===undefined?Boolean(current.avoid_tolls):bool(input.avoidTolls),
        avoidFerries:input.avoidFerries===undefined?Boolean(current.avoid_ferries):bool(input.avoidFerries),
        avoidUnpaved:input.avoidUnpaved===undefined?Boolean(current.avoid_unpaved):bool(input.avoidUnpaved)
      };
      if(values.axleLoadT!==null&&values.grossWeightT!==null&&values.axleLoadT>values.grossWeightT)throw new Error("invalid_navigation_profile");
      if(values.adrTunnelCode!=="NONE"&&!values.hazardousGoods)values.hazardousGoods=true;
      db.prepare(`UPDATE navigation_vehicle_profiles SET vehicle_class=?,length_m=?,width_m=?,height_m=?,gross_weight_t=?,axle_load_t=?,axle_count=?,max_speed_kph=?,trailer=?,hazardous_goods=?,hazmat_categories_json=?,adr_tunnel_code=?,refrigerated=?,emission_class=?,co2_class=?,preferred_strategy=?,avoid_tolls=?,avoid_ferries=?,avoid_unpaved=?,updated_at=? WHERE user_id=?`)
        .run(values.vehicleClass,values.lengthM,values.widthM,values.heightM,values.grossWeightT,values.axleLoadT,values.axleCount,values.maxSpeedKph,values.trailer?1:0,values.hazardousGoods?1:0,JSON.stringify(values.hazmatCategories),values.adrTunnelCode,values.refrigerated?1:0,values.emissionClass,values.co2Class,values.preferredStrategy,values.avoidTolls?1:0,values.avoidFerries?1:0,values.avoidUnpaved?1:0,now,Number(userId));
      return {profile:publicProfile(row(userId))};
    } catch(error) { return {error:error.message==="invalid_navigation_profile"?error.message:"invalid_navigation_profile",status:400}; }
  }

  return { seed, row, publicProfile, get(userId){return publicProfile(seed(userId));}, update };
}

module.exports={createVehicleProfileRepository,VEHICLE_CLASSES,STRATEGIES,TRUCK_ONLY_STRATEGIES,ADR_CODES,strategyAllowed};
