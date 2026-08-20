import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PEOPLE_FILTERS } from "../../driver/contacts/console.mjs";

const clientSource = await readFile(new URL("../../driver/contacts/index.js", import.meta.url), "utf8");
const uiSource = await readFile(new URL("../../driver/contacts/console.mjs", import.meta.url), "utf8");
const appSource = await readFile(new URL("../../driver/app.js", import.meta.url), "utf8");
const registrySource = await readFile(new URL("../../driver/module-registry.json", import.meta.url), "utf8");
const chatEntrySource = await readFile(new URL("../../driver/chat/index.js", import.meta.url), "utf8");
const peopleRoutesSource = await readFile(new URL("../../server/people/routes.js", import.meta.url), "utf8");
const peopleGuardSource = await readFile(new URL("../../server/people/guard.js", import.meta.url), "utf8");
const peopleRepositorySource = await readFile(new URL("../../server/people/repository.js", import.meta.url), "utf8");
const peoplePrivacySource = await readFile(new URL("../../server/people/privacy.js", import.meta.url), "utf8");
const peopleSchemaSource = await readFile(new URL("../../server/people/schema.js", import.meta.url), "utf8");
const locationSource = await readFile(new URL("../../server/driver/location.js", import.meta.url), "utf8");

test("People Console exposes driver-focused filters and responsive UI", () => {
  assert.deepEqual(PEOPLE_FILTERS.map(([key]) => key), ["ALL","CONTACTS","FAVORITES","TRUSTED","NEARBY","REQUESTS","COMMUNITIES","BLOCKED"]);
  for (const label of ["Люди","Контакты","Избранные","Доверенные","Рядом","Запросы","Сообщества","Блокировки"]) assert.match(uiSource, new RegExp(label));
  assert.match(uiSource, /@media\(max-width:720px\)/);
  assert.match(registrySource, /"label": "Люди"/);
  assert.match(appSource, /module-registry\.json\?v=20260820-navigation-v2/);
});

test("People client wires real directory privacy nearby and community APIs", () => {
  for (const pattern of [
    /\/api\/driver\/people\/overview/,
    /\/api\/driver\/people\/search/,
    /\/api\/driver\/people\/nearby/,
    /\/api\/driver\/people\/settings/,
    /\/api\/driver\/people\/contacts\//,
    /\/api\/driver\/people\/communities/,
    /community-invites/,
    /\/members\//,
    /\/bans\//
  ]) assert.match(clientSource, pattern);
  assert.match(clientSource, /nearbyVisibility/);
  assert.match(clientSource, /privateNote/);
  assert.match(clientSource, /openChatRoom/);
  assert.match(clientSource, /openRadioChannel/);
});

test("community links can open exact Chat room and Radio channel", () => {
  assert.match(appSource, /openChatRoom: async \(roomId\)/);
  assert.match(appSource, /openRadioChannel: async \(channelId\)/);
  assert.match(chatEntrySource, /async function openRoom\(roomId\)/);
  assert.match(chatEntrySource, /patap:open-chat-room/);
  assert.match(appSource, /data-channel-id/);
});

test("People schema is additive and links one community to one chat room and radio channel", () => {
  for (const table of ["people_schema_meta","driver_people_settings","driver_contact_preferences","driver_communities","driver_community_members","driver_community_invites","driver_community_bans"]) assert.match(peopleSchemaSource, new RegExp(table));
  assert.match(peopleSchemaSource, /chat_room_id INTEGER NOT NULL UNIQUE/);
  assert.match(peopleSchemaSource, /radio_channel_id INTEGER NOT NULL UNIQUE/);
  assert.doesNotMatch(peopleSchemaSource, /DROP TABLE|ALTER TABLE/);
});

test("privacy affects old map coordinates and does not only decorate People UI", () => {
  assert.match(peoplePrivacySource, /nearby_visibility/);
  assert.match(peoplePrivacySource, /TRUSTED/);
  assert.match(locationSource, /privacy\.canSeeNearby/);
  assert.match(locationSource, /privacy\.canSeeVehicle/);
});

test("community lifecycle synchronizes People Chat and Radio and guards direct membership drift", () => {
  for (const pattern of [
    /INSERT INTO chat_rooms/,
    /INSERT INTO radio_channels/,
    /INSERT INTO driver_communities/,
    /chat_room_members/,
    /radio_channel_members/,
    /driver_community_members/,
    /radio_speaker_leases/,
    /chat_room_bans/,
    /radio_channel_bans/
  ]) assert.match(peopleRepositorySource, pattern);
  assert.match(peopleRoutesSource, /guardCommunityLinks/);
  assert.match(peopleGuardSource, /community_managed/);
  assert.match(peopleGuardSource, /chatMembershipPatterns/);
  assert.match(peopleGuardSource, /radioMembershipPatterns/);
});

test("People does not claim or implement public followers, likes or exact coordinates in its nearby response", () => {
  assert.doesNotMatch(peopleSchemaSource, /followers|follower_count|public_likes/i);
  const nearbyBody = peopleRepositorySource.slice(peopleRepositorySource.indexOf("function nearbyPeople"), peopleRepositorySource.indexOf("function communityRow"));
  assert.doesNotMatch(nearbyBody, /latitude:/);
  assert.doesNotMatch(nearbyBody, /longitude:/);
  assert.match(nearbyBody, /distanceKm/);
});
