const { createParkingImportRepository } = require("./source-fusion");
const { parseOsmParkingJson } = require("./adapters/osm");
const { parseDatexParkingXml } = require("./adapters/datex");

function normalizedRecords(payload,source={}){
  const places=Array.isArray(payload?.places)?payload.places:[];
  const records=places.map((item,index)=>({place:item.place||item,source:{type:item.source?.type||source.type||"OTHER",externalId:item.source?.externalId||item.externalId||`record:${index}`,authority:item.source?.authority??source.authority,name:item.source?.name||source.name||"Normalized import",url:item.source?.url||source.url||"",licence:item.source?.licence||source.licence||"",sourceUpdatedAt:item.source?.sourceUpdatedAt||item.sourceUpdatedAt||source.sourceUpdatedAt||null,raw:item.source?.raw||item}}));
  return {records,occupancy:Array.isArray(payload?.occupancy)?payload.occupancy:[]};
}

function parsePayload(format,payload,source={}){
  const key=String(format||"").toLowerCase();
  if(key==="osm"||key==="osm-json"||key==="overpass-json")return {records:parseOsmParkingJson(payload,{sourceName:source.name||"OpenStreetMap",sourceUrl:source.url||"",countryCode:source.countryCode||null}),occupancy:[]};
  if(key==="datex"||key==="datex-xml")return parseDatexParkingXml(String(payload),{sourceName:source.name||"DATEX II",sourceUrl:source.url||"",countryCode:source.countryCode||null,sourceUpdatedAt:source.sourceUpdatedAt||null});
  if(key==="normalized"||key==="normalized-json")return normalizedRecords(payload,source);
  throw new Error("unsupported_parking_import_format");
}

function importParkingPayload(db,{format,payload,source={},nowIso=()=>new Date().toISOString(),batchSize=500}={}){
  const parking=createParkingImportRepository(db,{nowIso});
  const parsed=parsePayload(format,payload,source);
  const sourceType=String(source.type||parsed.records[0]?.source?.type||"OTHER").toUpperCase();
  const runId=parking.startImport(sourceType,source.name||format||"parking import",nowIso());
  const stats={recordsSeen:0,placesCreated:0,placesUpdated:0,observationsAdded:0,errors:0};
  const sourceToPlace=new Map();
  try{
    for(let start=0;start<parsed.records.length;start+=Math.max(1,batchSize)){
      const batch=parsed.records.slice(start,start+Math.max(1,batchSize));
      db.exec("BEGIN IMMEDIATE");
      try{
        for(const record of batch){
          stats.recordsSeen++;
          try{
            const result=parking.upsertImportedPlace(record.place,record.source,nowIso());
            if(result.error){stats.errors++;continue;}
            if(result.created)stats.placesCreated++;else stats.placesUpdated++;
            sourceToPlace.set(`${String(record.source.type||sourceType).toUpperCase()}:${record.source.externalId}`,result.placeId);
          }catch{stats.errors++;}
        }
        db.exec("COMMIT");
      }catch(error){db.exec("ROLLBACK");throw error;}
    }

    db.exec("BEGIN IMMEDIATE");
    try{
      for(const observation of parsed.occupancy||[]){
        const obsType=String(observation.sourceType||sourceType||"OFFICIAL_DATEX").toUpperCase();
        const externalId=String(observation.externalId||observation.sourceKey||"");
        let placeId=observation.placeId?Number(observation.placeId):sourceToPlace.get(`${obsType}:${externalId}`);
        if(!placeId&&externalId){placeId=db.prepare("SELECT place_id FROM parking_place_sources WHERE source_type=? AND external_id=?").get(obsType,externalId)?.place_id||null;}
        if(!placeId){stats.errors++;continue;}
        const ok=parking.addOfficialOccupancy(Number(placeId),{sourceType:observation.sourceClass||(["OPERATOR"].includes(obsType)?"OPERATOR":"OFFICIAL"),sourceKey:`${obsType}:${externalId}`,status:observation.status,freeSpots:observation.freeSpots,totalSpots:observation.totalSpots,note:observation.note||"",observedAt:observation.observedAt||nowIso(),expiresAt:observation.expiresAt||null},nowIso());
        if(ok)stats.observationsAdded++;else stats.errors++;
      }
      db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error;}
    parking.finishImport(runId,stats,{failed:false},nowIso());
    return {runId,stats};
  }catch(error){parking.finishImport(runId,stats,{failed:true,details:error.message||"import_failed"},nowIso());throw error;}
}

module.exports={parsePayload,importParkingPayload};
