import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url);
const { DatabaseSync }=require("node:sqlite");
const { createParkingRepository }=require("../../server/parking/repository.js");
const { parseOsmParkingJson }=require("../../server/parking/adapters/osm.js");
const { parseDatexParkingXml }=require("../../server/parking/adapters/datex.js");

const client=await readFile(new URL("../../driver/parking/index.js",import.meta.url),"utf8");
const consoleSource=await readFile(new URL("../../driver/parking/console.mjs",import.meta.url),"utf8");
const routes=await readFile(new URL("../../server/parking/routes.js",import.meta.url),"utf8");
const schema=await readFile(new URL("../../server/parking/schema.js",import.meta.url),"utf8");
const importer=await readFile(new URL("../../server/parking/importer.js",import.meta.url),"utf8");
const navigation=await readFile(new URL("../../driver/core/navigation.js",import.meta.url),"utf8");
const registry=JSON.parse(await readFile(new URL("../../driver/module-registry.json",import.meta.url),"utf8"));
const app=await readFile(new URL("../../driver/app.js",import.meta.url),"utf8");

function testDb(){const db=new DatabaseSync(":memory:");db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);CREATE TABLE driver_profiles(user_id INTEGER PRIMARY KEY,nickname TEXT);CREATE TABLE driver_locations(user_id INTEGER PRIMARY KEY,latitude REAL,longitude REAL,updated_at TEXT);INSERT INTO users(id) VALUES(1);INSERT INTO driver_profiles(user_id,nickname) VALUES(1,'Tester');`);return db;}

test("Parking module is registered and dynamically mounts a full functional old-shell view",()=>{
  const module=registry.modules.find(m=>m.id==="parking");assert.ok(module);assert.equal(module.label,"Паркинги");assert.equal(module.requiresProfile,true);assert.match(module.entry,/parking\/index\.js/);
  assert.match(app,/module-registry\.json\?v=20260819-parking-v1/);
  assert.match(consoleSource,/data-driver-view|dataset\.driverView/);assert.match(consoleSource,/Паркинги/);assert.match(consoleSource,/Parking Network V1/);assert.match(consoleSource,/@media\(max-width:620px\)/);
  assert.match(navigation,/const views = \(\) => Array\.from/);
});

test("Parking client wires search live occupancy vehicle fit reviews media corrections favorites and Plan B",()=>{
  for(const pattern of [/\/api\/driver\/parking\/search/,/\/occupancy/,/\/favorite/,/\/review/,/\/photos/,/\/corrections/,/\/preferences/,/Plan Б/,/fit\.issues/,/occupancy\.predicted/,/booking\.url/])assert.match(client,pattern);
  assert.match(routes,/LIVE_REPORT_MAX_DISTANCE_KM=3/);assert.match(routes,/parking_report_too_far/);assert.match(routes,/parking_location_required/);
});

test("Parking schema is additive and models sources occupancy security booking reviews media and import history",()=>{
  for(const name of ["parking_places","parking_place_sources","parking_occupancy_observations","parking_reviews","parking_favorites","parking_user_preferences","parking_corrections","parking_photos","parking_import_runs"])assert.match(schema,new RegExp(name));
  for(const field of ["certification_level","booking_provider","frigo_power","adr_allowed","capacity_truck","max_height_m","data_confidence"])assert.match(schema,new RegExp(field));
  assert.doesNotMatch(schema,/DROP TABLE|ALTER TABLE/);
});

test("OSM adapter turns HGV parking tags into normalized truck parking data with ODbL attribution",()=>{
  const parsed=parseOsmParkingJson({elements:[{type:"node",id:42,lat:50.2,lon:19.1,tags:{amenity:"parking",hgv:"yes",name:"Truck Stop",operator:"RoadCo","capacity:truck":"44",shower:"yes",lit:"yes","addr:country":"PL"}}]});
  assert.equal(parsed.length,1);assert.equal(parsed[0].place.name,"Truck Stop");assert.equal(parsed[0].place.capacityTruck,44);assert.equal(parsed[0].place.shower,true);assert.equal(parsed[0].place.lighting,true);assert.equal(parsed[0].source.type,"OSM");assert.match(parsed[0].source.licence,/ODbL/);
});

test("DATEX adapter extracts common static parking and dynamic occupancy without claiming one national XML shape",()=>{
  const xml=`<d:publication xmlns:d="urn:datex"><d:parkingRecord id="PL-1"><d:parkingName>MOP Test</d:parkingName><d:latitude>50.10</d:latitude><d:longitude>19.20</d:longitude><d:parkingCapacity>80</d:parkingCapacity><d:securityLevel>gold</d:securityLevel><d:service>shower CCTV restaurant</d:service></d:parkingRecord><d:parkingStatus><d:parkingRecordReference>PL-1</d:parkingRecordReference><d:numberOfVacantParkingSpaces>8</d:numberOfVacantParkingSpaces><d:totalCapacity>80</d:totalCapacity></d:parkingStatus></d:publication>`;
  const parsed=parseDatexParkingXml(xml,{sourceName:"Test NAP",countryCode:"PL"});assert.equal(parsed.records.length,1);assert.equal(parsed.records[0].place.capacityTruck,80);assert.equal(parsed.records[0].place.certificationLevel,"GOLD");assert.equal(parsed.records[0].source.type,"OFFICIAL_DATEX");assert.equal(parsed.occupancy.length,1);assert.equal(parsed.occupancy[0].status,"LIMITED");
});

test("canonical repository conservatively merges OSM and official sources and gives authority to current official occupancy",()=>{
  const db=testDb();try{const parking=createParkingRepository(db,{nowIso:()=>"2026-08-19T16:00:00.000Z"});let r=parking.upsertImportedPlace({name:"MOP Merge",latitude:50.2,longitude:19.1,countryCode:"PL",capacityTruck:40,shower:true},{type:"OSM",externalId:"way/1",name:"OSM",licence:"ODbL"});assert.equal(r.created,true);const id=r.placeId;r=parking.upsertImportedPlace({name:"MOP Merge",latitude:50.2002,longitude:19.1001,countryCode:"PL",capacityTruck:60,cctv:true,certificationLevel:"SILVER"},{type:"OFFICIAL_DATEX",externalId:"NAP-1",authority:95,name:"NAP",sourceUpdatedAt:"2026-08-19T15:55:00.000Z"});assert.equal(r.placeId,id);assert.equal(db.prepare("SELECT COUNT(*) n FROM parking_places").get().n,1);assert.equal(db.prepare("SELECT COUNT(*) n FROM parking_place_sources WHERE place_id=?").get(id).n,2);assert.equal(db.prepare("SELECT capacity_truck FROM parking_places WHERE id=?").get(id).capacity_truck,60);parking.addOfficialOccupancy(id,{status:"AVAILABLE",freeSpots:12,totalSpots:60,sourceKey:"NAP-1",observedAt:"2026-08-19T15:58:00.000Z"},"2026-08-19T16:00:00.000Z");const live=parking.liveOccupancy(id,"2026-08-19T16:00:00.000Z");assert.equal(live.source,"OFFICIAL");assert.equal(live.status,"AVAILABLE");assert.equal(live.freeSpots,12);assert.ok(db.prepare("SELECT data_confidence FROM parking_places WHERE id=?").get(id).data_confidence>=0.95);}finally{db.close();}
});

test("historical fallback is explicitly prediction and never mislabeled as current live data",()=>{
  const db=testDb();try{const now="2026-08-19T16:00:00.000Z";const parking=createParkingRepository(db,{nowIso:()=>now});const id=parking.upsertImportedPlace({name:"History Parking",latitude:50.4,longitude:19.4,countryCode:"PL"},{type:"OSM",externalId:"node/99"},now).placeId;const insert=db.prepare("INSERT INTO parking_occupancy_observations(place_id,source_type,source_key,status,observed_at,expires_at,created_at) VALUES(?,'IMPORT','history','FULL',?,?,?)");for(let i=0;i<5;i++){const t=new Date(Date.parse(now)-7*24*3600_000+i*60_000).toISOString();insert.run(id,t,new Date(Date.parse(t)+30*60_000).toISOString(),t);}const state=parking.liveOccupancy(id,now);assert.equal(state.predicted,true);assert.equal(state.source,"HISTORY");assert.equal(state.status,"FULL");assert.ok(state.sampleCount>=5);}finally{db.close();}
});

test("import pipeline remains a separate process contract rather than fetching datasets inside Driver HTTP requests",()=>{
  assert.match(importer,/batchSize=500/);assert.match(importer,/BEGIN IMMEDIATE/);assert.match(importer,/parseOsmParkingJson/);assert.match(importer,/parseDatexParkingXml/);assert.doesNotMatch(routes,/fetch\(/);
});
