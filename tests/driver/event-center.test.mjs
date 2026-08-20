import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import {readFile} from "node:fs/promises";
const require=createRequire(import.meta.url);
const {createPushSender,ensureVapidKeys,vapidJwt,validatePushEndpoint}=require("../../server/events/push.js");

const registry=JSON.parse(await readFile(new URL("../../driver/module-registry.json",import.meta.url),"utf8"));
const client=await readFile(new URL("../../driver/events/index.js",import.meta.url),"utf8");
const consoleSource=await readFile(new URL("../../driver/events/console.mjs",import.meta.url),"utf8");
const worker=await readFile(new URL("../../driver/event-worker.js",import.meta.url),"utf8");
const schema=await readFile(new URL("../../server/events/schema.js",import.meta.url),"utf8");
const service=await readFile(new URL("../../server/events/service.js",import.meta.url),"utf8");
const routes=await readFile(new URL("../../server/events/routes.js",import.meta.url),"utf8");
const build=await readFile(new URL("../../scripts/build.js",import.meta.url),"utf8");

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

test("VAPID key material stays local and JWT verifies as ES256 P-256",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"patap-events-"));try{
    const keys=ensureVapidKeys(dir);assert.ok(keys.privateJwk.d);assert.ok(keys.publicKey.length>80);assert.ok(fs.existsSync(path.join(dir,"events","vapid.json")));
    const now=Date.parse("2026-08-20T12:00:00.000Z");const token=vapidJwt(keys.privateJwk,"https://fcm.googleapis.com",{now});const [header,payload,signature]=token.split(".");const decodedHeader=JSON.parse(Buffer.from(header,"base64url"));const decodedPayload=JSON.parse(Buffer.from(payload,"base64url"));assert.equal(decodedHeader.alg,"ES256");assert.equal(decodedPayload.aud,"https://fcm.googleapis.com");assert.ok(decodedPayload.exp>Math.floor(now/1000));assert.ok(decodedPayload.exp<=Math.floor(now/1000)+24*60*60);
    const publicJwk={...keys.privateJwk};delete publicJwk.d;const publicKey=crypto.createPublicKey({key:publicJwk,format:"jwk"});assert.equal(crypto.verify("sha256",Buffer.from(`${header}.${payload}`),{key:publicKey,dsaEncoding:"ieee-p1363"},Buffer.from(signature,"base64url")),true);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("privacy push sends wake-only VAPID request and rejects arbitrary HTTPS SSRF targets",async()=>{
  assert.equal(validatePushEndpoint("https://fcm.googleapis.com/fcm/send/test"),true);assert.equal(validatePushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/test"),true);assert.equal(validatePushEndpoint("https://web.push.apple.com/test"),true);assert.equal(validatePushEndpoint("https://example.com/push"),false);assert.equal(validatePushEndpoint("https://127.0.0.1/push"),false);assert.equal(validatePushEndpoint("http://fcm.googleapis.com/test"),false);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"patap-push-"));let captured=null,success=0;try{
    const repo={activePushSubscriptions(){return[{id:7,endpoint:"https://fcm.googleapis.com/fcm/send/test"}]},pushSuccess(){success++},pushFailure(){assert.fail("push should not fail")}};
    const sender=createPushSender({dataDir:dir,repo,now:()=>Date.parse("2026-08-20T12:00:00.000Z"),fetchImpl:async(url,options)=>{captured={url,options};return{ok:true,status:201}}});const result=await sender.send(1,{priority:"URGENT"});assert.equal(result.sent,1);assert.equal(success,1);assert.equal(captured.url,"https://fcm.googleapis.com/fcm/send/test");assert.match(captured.options.headers.Authorization,/^vapid t=.+, k=.+$/);assert.equal(captured.options.headers.TTL,"120");assert.equal(captured.options.body,undefined);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("service worker fetches event content from authenticated PaTaP after empty push wakeup",()=>{
  assert.match(worker,/addEventListener\('push'/);assert.match(worker,/\/api\/driver\/events\/overview/);assert.match(worker,/credentials:'include'/);assert.match(worker,/showNotification/);assert.doesNotMatch(worker,/event\.data\.(json|text|arrayBuffer)/);
  assert.match(worker,/patap\.event\.open/);assert.match(client,/Notification\.requestPermission\(\)/);assert.match(client,/pushManager\.subscribe/);assert.match(routes,/unsupported_push_endpoint/);assert.match(build,/event-worker\.js/);
});


