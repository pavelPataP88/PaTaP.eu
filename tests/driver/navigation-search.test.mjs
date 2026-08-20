import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {projectGuidance} from "../../driver/navigation/guidance.mjs";

const require=createRequire(import.meta.url);
const {configuredUrl,normalizeItem}=require("../../server/navigation/geocoders/nominatim.js");
const {closestGeometryPoint,corridorItems}=require("../../server/navigation/geometry.js");
const indexSource=await readFile(new URL("../../driver/navigation/index.js",import.meta.url),"utf8");
const searchSource=await readFile(new URL("../../driver/navigation/destination-search.mjs",import.meta.url),"utf8");
const routeSource=await readFile(new URL("../../server/navigation/routes.js",import.meta.url),"utf8");

test("Navigation never treats the public OSM Nominatim endpoint as an approved autocomplete backend",()=>{
  assert.equal(configuredUrl("https://nominatim.openstreetmap.org"),null);
  assert.equal(configuredUrl("https://nominatim.openstreetmap.org/"),null);
  assert.equal(configuredUrl("ftp://geo.example.test"),null);
  assert.equal(configuredUrl("https://geo.patap.test/nominatim"),"https://geo.patap.test/nominatim");
  const item=normalizeItem({place_id:7,display_name:"Katowice, Polska",lat:"50.2649",lon:"19.0238",type:"city",address:{country_code:"pl"},licence:"fixture"},0);assert.equal(item.countryCode,"PL");assert.equal(item.provider,"NOMINATIM_COMPAT");assert.equal(item.latitude,50.2649);
});

test("Route corridor projects to line segments instead of only sparse polyline vertices",()=>{
  const geometry=[[19,50],[21,50]];const point=closestGeometryPoint(geometry,50.01,20);assert.ok(point);assert.ok(point.distanceKm<1.2);assert.ok(point.progress>0.49&&point.progress<0.51);assert.ok(point.routeKm>60);
  const items=corridorItems(geometry,[{id:1,latitude:50.01,longitude:20},{id:2,latitude:51,longitude:20}],{maxDistanceKm:2});assert.equal(items.length,1);assert.equal(items[0].id,1);assert.ok(items[0].route.progress>0.49&&items[0].route.progress<0.51);
});

test("Guidance does not falsely report off-route between distant route vertices",()=>{
  const alternative={durationSec:3600,geometry:[[19,50],[21,50]],maneuvers:[{index:0,type:"1",instruction:"Прямо",beginShapeIndex:0,endShapeIndex:1}]};const model=projectGuidance(alternative,{latitude:50.0005,longitude:20,speed:20});assert.ok(model);assert.equal(model.offRoute,false);assert.ok(model.distanceFromRouteKm<0.12);assert.ok(model.progress>0.49&&model.progress<0.51);assert.ok(model.projected);
});

test("Destination autocomplete is server-side, accessible and retains map/coordinate fallback",()=>{
  assert.match(routeSource,/\/api\/driver\/navigation\/search/);assert.match(searchSource,/aria-autocomplete/);assert.match(searchSource,/role","listbox/);assert.match(searchSource,/Адрес, город, объект или парковка/);assert.match(searchSource,/Точные координаты/);assert.match(searchSource,/Выбрать точку на карте/);assert.doesNotMatch(searchSource,/nominatim\.openstreetmap\.org/);
});

test("Automatic reroute requires sustained moving off-route state and has a cooldown",()=>{
  assert.match(indexSource,/AUTO_REROUTE_HOLD_MS=8_000/);assert.match(indexSource,/AUTO_REROUTE_COOLDOWN_MS=60_000/);assert.match(indexSource,/AUTO_REROUTE_DISTANCE_KM=0\.15/);assert.match(indexSource,/model\.offRoute&&moving/);assert.match(indexSource,/now-offRouteSince>=AUTO_REROUTE_HOLD_MS/);assert.match(indexSource,/now-lastAutoRerouteAt>=AUTO_REROUTE_COOLDOWN_MS/);assert.match(indexSource,/reroute\(\{automatic:true\}\)/);
});
