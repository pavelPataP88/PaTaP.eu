import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import {readFile} from "node:fs/promises";
const require=createRequire(import.meta.url);
const webpush=require("web-push");
const {createPushSender,ensureVapidKeys,vapidDetails,eventPushPayload,validatePushEndpoint,validatePushSubscription}=require("../../server/events/push.js");

const registry=JSON.parse(await readFile(new URL("../../driver/module-registry.json",import.meta.url),"utf8"));
const client=await readFile(new URL("../../driver/events/index.js",import.meta.url),"utf8");
const consoleSource=await readFile(new URL("../../driver/events/console.mjs",import.meta.url),"utf8");
const worker=await readFile(new URL("../../driver/event-worker.js",import.meta.url),"utf8");
const schema=await readFile(new URL("../../server/events/schema.js",import.meta.url),"utf8");
const service=await readFile(new URL("../../server/events/service.js",import.meta.url),"utf8");
const routes=await readFile(new URL("../../server/events/routes.js",import.meta.url),"utf8");
const build=await readFile(new URL("../../scripts/build.js",import.meta.url),"utf8");

function browserSubscription(endpoint="https://fcm.googleapis.com/fcm/send/test"){
  const ecdh=crypto.createECDH("prime256v1");ecdh.generateKeys();
  return {endpoint,keys:{p256dh:ecdh.getPublicKey().toString("base64url"),auth:crypto.randomBytes(16).toString("base64url")}};
}
function headerValue(headers,name){const key=Object.keys(headers||{}).find(item=>item.toLowerCase()===name.toLowerCase());return key?headers[key]:undefined;}

test("Event Center is a global bell module and does not add a seventh bottom-navigation view",()=>{
  const eventModule=registry.modules.find(module=>module.id==="events");assert.ok(eventModule);assert.equal(eventModule.view,undefined);assert.equal(eventModule.requiresProfile,true);assert.match(eventModule.entry,/events\/index\.js/);
  assert.equal(registry.modules.filter(module=>module.enabled&&module.view).length,6);
  assert.match(consoleSource,/event-bell/);assert.match(consoleSource,/event-drawer/);assert.match(client,/data-driver-target=\"contacts\"|data-driver-target/);assert.match(client,/openChatRoom/);assert.match(client,/openRadioChannel/);assert.match(client,/showParkingPlace/);
});

test("Event schema is additive durable outbox projection for committed domain state",()=>{
  for(const table of ["driver_events","driver_event_preferences","driver_event_category_preferences","driver_event_source_overrides","driver_event_outbox","driver_push_subscriptions"])assert.match(schema,new RegExp(table));
  for(const trigger of ["trg_event_chat_message_insert","trg_event_relationship_update","trg_event_community_invite_insert","trg_event_radio_committed","trg_event_parking_occupancy_insert"])assert.match(schema,new RegExp(trigger));
  assert.match(schema,/AFTER UPDATE OF state ON radio_transmissions WHEN NEW\.state='COMMITTED'/);
  assert.doesNotMatch(schema,/DROP TABLE|ALTER TABLE/);
  assert.match(service,/source_important_only/);assert.match(service,/driving_mode|roadReport/);
  assert.match(service,/require\("\.\.\/road-reports\/repository"\)/);assert.doesNotMatch(service,/require\("\.\.\/driver\/location"\)/);
});

test("stored PaTaP VAPID keys remain stable and web-push encrypts the event payload",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"patap-events-"));try{
    const keys=ensureVapidKeys(dir),again=ensureVapidKeys(dir);assert.deepEqual(again,keys);assert.ok(keys.privateJwk.d);assert.ok(keys.publicKey.length>80);assert.ok(fs.existsSync(path.join(dir,"events","vapid.json")));
    const details=vapidDetails(keys);assert.equal(details.privateKey,keys.privateJwk.d);assert.equal(details.publicKey,keys.publicKey);
    const subscription=browserSubscription();const plaintext=eventPushPayload({id:41,category:"CHAT",priority:"IMPORTANT",title:"Private title",preview:"secret-preview"},{showPreviews:true});
    const request=webpush.generateRequestDetails(subscription,plaintext,{vapidDetails:details,TTL:120,urgency:"high",contentEncoding:"aes128gcm"});
    assert.equal(request.method,"POST");assert.ok(Buffer.isBuffer(request.body));assert.ok(request.body.length>0);assert.equal(request.body.includes(Buffer.from("secret-preview")),false);assert.equal(headerValue(request.headers,"Content-Encoding"),"aes128gcm");assert.ok(headerValue(request.headers,"Authorization"));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("push sender carries the exact event id, validates subscription keys and hides private content when previews are off",async()=>{
  assert.equal(validatePushEndpoint("https://fcm.googleapis.com/fcm/send/test"),true);assert.equal(validatePushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/test"),true);assert.equal(validatePushEndpoint("https://web.push.apple.com/test"),true);assert.equal(validatePushEndpoint("https://example.com/push"),false);assert.equal(validatePushEndpoint("https://127.0.0.1/push"),false);assert.equal(validatePushEndpoint("http://fcm.googleapis.com/test"),false);
  const browser=browserSubscription();assert.equal(validatePushSubscription(browser),true);assert.equal(validatePushSubscription({endpoint:browser.endpoint,keys:{p256dh:"bad",auth:"bad"}}),false);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"patap-push-"));let captured=null,success=0,failure=0;try{
    const stored={id:7,endpoint:browser.endpoint,p256dh:browser.keys.p256dh,auth:browser.keys.auth};
    const repo={ensurePreferences(){return{show_previews:0}},publicPreferences(row){return{showPreviews:Boolean(row.show_previews)}},activePushSubscriptions(){return[stored]},pushSuccess(){success++},pushFailure(){failure++}};
    const sender=createPushSender({dataDir:dir,repo,now:()=>Date.parse("2026-08-20T12:00:00.000Z"),sendNotificationImpl:async(subscription,payload,options)=>{captured={subscription,payload,options};return{statusCode:201}}});
    const result=await sender.send(1,{id:71,category:"ROAD",priority:"URGENT",title:"ДТП в 200 метрах",preview:"Секретный preview",route:{kind:"ROAD_REPORT",latitude:50.2,longitude:19.0},data:{secret:"must-not-leak"}});
    assert.equal(result.sent,1);assert.equal(result.failed,0);assert.equal(success,1);assert.equal(failure,0);assert.deepEqual(captured.subscription,browser);
    const payload=JSON.parse(captured.payload);assert.deepEqual(payload,{v:1,eventId:71,category:"ROAD",priority:"URGENT",title:"PaTaP Driver",body:"Новое событие в Driver"});assert.equal("route" in payload,false);assert.equal("data" in payload,false);assert.doesNotMatch(captured.payload,/Секретный|50\.2|must-not-leak/);
    assert.equal(captured.options.contentEncoding,"aes128gcm");assert.equal(captured.options.urgency,"high");assert.equal(captured.options.TTL,120);assert.equal(captured.options.topic,"evt-71");assert.equal(captured.options.vapidDetails.privateKey,ensureVapidKeys(dir).privateJwk.d);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("service worker renders the pushed event itself and no longer fetches whichever event is latest",()=>{
  assert.match(worker,/addEventListener\('push'/);assert.match(worker,/event\.data\.json\(\)/);assert.match(worker,/showNotification/);assert.match(worker,/patap-event-\$\{item\.eventId\}/);assert.match(worker,/patap\.event\.open/);
  assert.doesNotMatch(worker,/\/api\/driver\/events\/overview/);assert.doesNotMatch(worker,/credentials\s*:\s*['"]include['"]/);assert.doesNotMatch(worker,/route\s*:/);
  assert.match(client,/Notification\.requestPermission\(\)/);assert.match(client,/pushManager\.subscribe/);assert.match(routes,/unsupported_push_endpoint/);assert.match(routes,/invalid_push_subscription/);assert.match(build,/event-worker\.js/);
});
