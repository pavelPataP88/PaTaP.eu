function yes(value){return ["yes","designated","permissive","true","1"].includes(String(value||"").toLowerCase());}
function no(value){return ["no","private"].includes(String(value||"").toLowerCase());}
function number(value){const n=Number(String(value??"").replace(",","."));return Number.isFinite(n)?n:null;}
function first(...values){return values.find(v=>v!==undefined&&v!==null&&String(v).trim()!=="")||"";}
function latLon(element){if(Number.isFinite(element.lat)&&Number.isFinite(element.lon))return {latitude:element.lat,longitude:element.lon};if(Number.isFinite(element.center?.lat)&&Number.isFinite(element.center?.lon))return {latitude:element.center.lat,longitude:element.center.lon};return null;}
function isTruckParking(tags={}){
  if(tags.amenity==="parking"&&(yes(tags.hgv)||yes(tags["parking:hgv"])||number(tags["capacity:truck"])!==null))return true;
  if(["services","rest_area"].includes(tags.highway)&&(yes(tags.hgv)||number(tags["capacity:truck"])!==null||!no(tags.hgv)))return true;
  return false;
}
function kind(tags={}){if(tags.highway==="services")return "SERVICE_AREA";if(tags.highway==="rest_area")return "REST_AREA";if(String(tags.name||"").toUpperCase().includes("MOP"))return "MOP";if(yes(tags.secure)||yes(tags["parking:secure"]))return "SECURE_PARKING";return "TRUCK_PARKING";}
function osmBoolean(tags,keys){return keys.some(k=>yes(tags[k]));}

function parseOsmParkingJson(payload,{sourceName="OpenStreetMap",sourceUrl="",countryCode=null}={}){
  const records=[];
  for(const element of payload?.elements||[]){
    const tags=element.tags||{};const point=latLon(element);if(!point||!isTruckParking(tags))continue;
    const externalId=`${element.type||"element"}/${element.id}`;
    const address=[tags["addr:street"],tags["addr:housenumber"],tags["addr:city"],tags["addr:postcode"]].filter(Boolean).join(" ");
    const access=String(tags.access||tags.hgv||"").toLowerCase();
    const fee=String(tags.fee||"").toLowerCase();
    records.push({
      place:{
        name:first(tags.name,tags.operator,tags.ref,`Truck parking ${element.id}`),...point,countryCode:first(tags["addr:country"],countryCode)||null,address,road:first(tags.ref,tags["destination:ref"]),direction:first(tags.direction,tags["destination:forward"]),operator:tags.operator||"",phone:first(tags.phone,tags["contact:phone"]),website:first(tags.website,tags["contact:website"]),openingHours:tags.opening_hours||"",kind:kind(tags),capacityTruck:number(tags["capacity:truck"]),capacityTotal:number(tags.capacity),access24h:tags.opening_hours==="24/7",feeMode:fee==="no"?"FREE":fee==="yes"?"PAID":"UNKNOWN",maxHeightM:number(tags.maxheight),maxWeightT:number(tags.maxweight),maxLengthM:number(tags.maxlength),extraLongAllowed:yes(tags["hgv:long"]),adrAllowed:yes(tags.hazmat)||yes(tags["hazmat:parking"]),trailerDecoupling:yes(tags["trailer:decoupling"]),
        toilet:osmBoolean(tags,["toilets","toilets:yes"]),shower:osmBoolean(tags,["shower","showers"]),restaurant:tags.amenity==="restaurant"||osmBoolean(tags,["restaurant"]),shop:Boolean(tags.shop)||osmBoolean(tags,["shop"]),wifi:osmBoolean(tags,["internet_access","wifi"]),laundry:osmBoolean(tags,["laundry"]),water:osmBoolean(tags,["drinking_water","water_point"]),accommodation:Boolean(tags.tourism==="hotel"||tags.motel),vending:Boolean(tags.vending),diesel:osmBoolean(tags,["fuel:diesel","diesel"]),adblue:osmBoolean(tags,["fuel:adblue","adblue"]),lng:osmBoolean(tags,["fuel:lng"]),hydrogen:osmBoolean(tags,["fuel:h2"]),evCharging:osmBoolean(tags,["amenity:charging_station","charging_station"]),frigoPower:osmBoolean(tags,["power_supply:fridge","frigo_power"]),truckWash:osmBoolean(tags,["truck_wash","car_wash:hgv"]),truckRepair:osmBoolean(tags,["truck_repair","repair:hgv"]),restrictedAccess:["customers","delivery","private","permit"].includes(access),cctv:osmBoolean(tags,["surveillance","cctv"]),guard:osmBoolean(tags,["guarded","security_guard"]),fence:Boolean(tags.barrier==="fence"||tags.fence_type),gate:Boolean(tags.barrier==="gate"||tags.barrier==="lift_gate"),lighting:osmBoolean(tags,["lit"]),personalAccessControl:osmBoolean(tags,["access_control"]),reservable:osmBoolean(tags,["reservation","reservable"]),bookingUrl:first(tags["reservation:website"],tags.booking),dataConfidence:0.65
      },
      source:{type:"OSM",externalId,authority:65,name:sourceName,url:sourceUrl,licence:"OpenStreetMap contributors · ODbL",sourceUpdatedAt:null,raw:element}
    });
  }
  return records;
}

module.exports={parseOsmParkingJson,isTruckParking};
