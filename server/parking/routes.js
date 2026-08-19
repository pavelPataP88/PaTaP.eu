const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const { DATA_DIR }=require("../auth/db");
const { createParkingRepository,haversineKm }=require("./repository");

const PHOTO_TYPES=new Set(["image/jpeg","image/png","image/webp"]);
const MAX_PHOTO_BYTES=5*1024*1024;
const LIVE_REPORT_MAX_DISTANCE_KM=3;
const LIVE_REPORT_LOCATION_MAX_AGE_MS=5*60_000;
function mime(header){const value=String(header||"").split(";",1)[0].trim().toLowerCase();return PHOTO_TYPES.has(value)?value:null;}
function safeName(value){return String(value||"parking-photo").normalize("NFKC").replace(/[\\/\u0000-\u001f\u007f]+/g,"-").trim().slice(0,160)||"parking-photo";}
async function readBinary(req,maxBytes){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>maxBytes){const error=new Error("payload_too_large");error.status=413;throw error;}chunks.push(chunk);}return Buffer.concat(chunks);}

function createParkingRoutes(options){
  const parking=createParkingRepository(options.db,{nowIso:options.nowIso});
  const storageDir=path.join(DATA_DIR,"parking");
  function respond(res,status,payload,headers){options.json(res,status,payload,headers);return true;}
  function requireUser(req,res){const session=options.requireSession(req,res);if(!session)return null;if(!parking.hasDriver(session.user.id)){respond(res,409,{error:"driver_profile_required"});return null;}parking.ensurePreferences(session.user.id,options.nowIso());return session;}
  function requireMutation(req,res,key,limit=40,minutes=1){const session=requireUser(req,res);if(!session||!options.requireCsrf(req,res,session))return null;if(key&&!options.checkRate(`parking:${key}:user:${session.user.id}`,limit,minutes)){respond(res,429,{error:"parking_rate_limited"});return null;}return session;}
  function result(res,value,success=200){if(value?.error)return respond(res,value.status||400,value);return respond(res,success,value);}
  function liveReportAccess(userId,placeId,now=options.nowIso()){
    const place=parking.placeRow(placeId);if(!place)return {error:"parking_not_found",status:404};
    const profile=options.db.prepare("SELECT gps_enabled FROM driver_profiles WHERE user_id=?").get(userId);if(!profile?.gps_enabled)return {error:"parking_location_required",status:409};
    const location=options.db.prepare("SELECT latitude,longitude,updated_at FROM driver_locations WHERE user_id=?").get(userId);if(!location||Date.parse(now)-Date.parse(location.updated_at)>LIVE_REPORT_LOCATION_MAX_AGE_MS)return {error:"parking_location_required",status:409};
    const distanceKm=haversineKm(Number(location.latitude),Number(location.longitude),Number(place.latitude),Number(place.longitude));if(distanceKm>LIVE_REPORT_MAX_DISTANCE_KM)return {error:"parking_report_too_far",status:400,distanceKm:Number(distanceKm.toFixed(3)),maxDistanceKm:LIVE_REPORT_MAX_DISTANCE_KM};
    return {ok:true,distanceKm};
  }

  return async function handleParkingRoute(req,res,url,body){
    if(!url.pathname.startsWith("/api/driver/parking"))return false;

    const photoContent=url.pathname.match(/^\/api\/driver\/parking\/photos\/(\d+)\/content$/);
    if(req.method==="GET"&&photoContent){const session=requireUser(req,res);if(!session)return true;const record=parking.photoForUser(session.user.id,Number(photoContent[1]));if(!record)return respond(res,404,{error:"parking_photo_not_found"});const file=path.join(storageDir,record.storage_key);try{const stat=fs.statSync(file);if(!stat.isFile()||stat.size!==Number(record.byte_length))throw new Error("invalid");res.writeHead(200,{"Content-Type":record.mime_type,"Content-Length":stat.size,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Disposition":`inline; filename*=UTF-8''${encodeURIComponent(record.file_name)}`});fs.createReadStream(file).on("error",()=>res.destroy()).pipe(res);}catch{return respond(res,404,{error:"parking_photo_not_found"});}return true;}

    const photoUpload=url.pathname.match(/^\/api\/driver\/parking\/places\/(\d+)\/photos$/);
    if(req.method==="POST"&&photoUpload&&body===undefined){const session=requireMutation(req,res,"photo",12,10);if(!session)return true;const type=mime(req.headers["content-type"]);if(!type)return respond(res,415,{error:"unsupported_parking_photo"});let binary;try{binary=await readBinary(req,MAX_PHOTO_BYTES);}catch(error){return respond(res,error.status||400,{error:error.message||"invalid_parking_photo"});}if(!binary.length)return respond(res,400,{error:"empty_parking_photo"});const ext=type==="image/png"?"png":type==="image/webp"?"webp":"jpg";const storageKey=`${crypto.randomUUID()}.${ext}`;fs.mkdirSync(storageDir,{recursive:true,mode:0o700});const finalPath=path.join(storageDir,storageKey),temp=`${finalPath}.${crypto.randomUUID()}.tmp`;try{fs.writeFileSync(temp,binary,{flag:"wx",mode:0o600});fs.renameSync(temp,finalPath);const value=parking.registerPhoto(session.user.id,Number(photoUpload[1]),{storageKey,mimeType:type,byteLength:binary.length,fileName:safeName(req.headers["x-file-name"])},options.nowIso());if(value.error){fs.rmSync(finalPath,{force:true});return result(res,value);}options.audit(req,"parking_photo_added",{userId:session.user.id,success:true,details:{placeId:Number(photoUpload[1]),photoId:value.photo.id}});return respond(res,201,value);}catch{fs.rmSync(temp,{force:true});fs.rmSync(finalPath,{force:true});return respond(res,500,{error:"parking_photo_upload_failed"});}}

    if(req.method==="GET"&&url.pathname==="/api/driver/parking/overview"){const session=requireUser(req,res);if(!session)return true;const input=Object.fromEntries(url.searchParams.entries());return respond(res,200,{preferences:parking.publicPreferences(parking.ensurePreferences(session.user.id)),places:parking.search(session.user.id,input),favorites:parking.favorites(session.user.id).slice(0,12)});}
    if(req.method==="GET"&&url.pathname==="/api/driver/parking/search"){const session=requireUser(req,res);if(!session)return true;return respond(res,200,{places:parking.search(session.user.id,Object.fromEntries(url.searchParams.entries()))});}
    if(req.method==="GET"&&url.pathname==="/api/driver/parking/favorites"){const session=requireUser(req,res);if(!session)return true;return respond(res,200,{places:parking.favorites(session.user.id)});}
    const placeMatch=url.pathname.match(/^\/api\/driver\/parking\/places\/(\d+)$/);
    if(req.method==="GET"&&placeMatch){const session=requireUser(req,res);if(!session)return true;const lat=Number(url.searchParams.get("lat")),lon=Number(url.searchParams.get("lon"));const origin=Number.isFinite(lat)&&Number.isFinite(lon)?{latitude:lat,longitude:lon}:null;const details=parking.placeDetails(session.user.id,Number(placeMatch[1]),{origin});return details?respond(res,200,details):respond(res,404,{error:"parking_not_found"});}

    if(body===undefined)return false;

    if(req.method==="PATCH"&&url.pathname==="/api/driver/parking/preferences"){const session=requireMutation(req,res,"preferences",20,1);if(!session)return true;return result(res,parking.updatePreferences(session.user.id,body,options.nowIso()));}
    if(req.method==="POST"&&url.pathname==="/api/driver/parking/along-route"){const session=requireMutation(req,res,"route-search",30,1);if(!session)return true;return result(res,parking.alongRoute(session.user.id,body));}
    if(req.method==="POST"&&url.pathname==="/api/driver/parking/places"){const session=requireMutation(req,res,"create",10,60);if(!session)return true;const value=parking.createCommunityPlace(session.user.id,body,options.nowIso());if(!value.error)options.audit(req,"parking_place_created",{userId:session.user.id,success:true,details:{placeId:value.place.id}});return result(res,value,201);}

    const occupancy=url.pathname.match(/^\/api\/driver\/parking\/places\/(\d+)\/occupancy$/);
    if(req.method==="POST"&&occupancy){const session=requireMutation(req,res,"occupancy",30,10);if(!session)return true;const placeId=Number(occupancy[1]);const access=liveReportAccess(session.user.id,placeId);if(access.error)return result(res,access);const value=parking.reportOccupancy(session.user.id,placeId,body,options.nowIso());if(!value.error)options.audit(req,"parking_occupancy_reported",{userId:session.user.id,success:true,details:{placeId,status:value.occupancy.status,distanceKm:Number(access.distanceKm.toFixed(3))}});return result(res,value);}
    const favorite=url.pathname.match(/^\/api\/driver\/parking\/places\/(\d+)\/favorite$/);
    if(req.method==="PUT"&&favorite&&typeof body.enabled==="boolean"){const session=requireMutation(req,res,"favorite",60,1);if(!session)return true;return result(res,parking.setFavorite(session.user.id,Number(favorite[1]),body.enabled,options.nowIso()));}
    const review=url.pathname.match(/^\/api\/driver\/parking\/places\/(\d+)\/review$/);
    if(req.method==="PUT"&&review){const session=requireMutation(req,res,"review",20,10);if(!session)return true;const value=parking.upsertReview(session.user.id,Number(review[1]),body,options.nowIso());if(!value.error)options.audit(req,"parking_review_saved",{userId:session.user.id,success:true,details:{placeId:Number(review[1])}});return result(res,value);}
    if(req.method==="DELETE"&&review){const session=requireMutation(req,res,"review-delete",20,10);if(!session)return true;return result(res,parking.deleteReview(session.user.id,Number(review[1])));}
    const correction=url.pathname.match(/^\/api\/driver\/parking\/places\/(\d+)\/corrections$/);
    if(req.method==="POST"&&correction){const session=requireMutation(req,res,"correction",20,10);if(!session)return true;const value=parking.addCorrection(session.user.id,Number(correction[1]),body,options.nowIso());if(!value.error)options.audit(req,"parking_correction_submitted",{userId:session.user.id,success:true,details:{placeId:Number(correction[1]),correctionId:value.correction.id}});return result(res,value,201);}
    const photoDelete=url.pathname.match(/^\/api\/driver\/parking\/photos\/(\d+)$/);
    if(req.method==="DELETE"&&photoDelete){const session=requireMutation(req,res,"photo-delete",20,10);if(!session)return true;const value=parking.deletePhoto(session.user.id,Number(photoDelete[1]));if(value.error)return result(res,value);try{fs.rmSync(path.join(storageDir,value.storageKey),{force:true});}catch{}return respond(res,200,{deleted:true});}
    return false;
  };
}

module.exports={createParkingRoutes,PHOTO_TYPES,MAX_PHOTO_BYTES,LIVE_REPORT_MAX_DISTANCE_KM};
