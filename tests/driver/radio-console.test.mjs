import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { RADIO_KIND_LABELS, RADIO_ROLE_LABELS, RADIO_POLICY_LABELS } from "../../driver/radio/console.mjs";

const consoleSource = await readFile(new URL("../../driver/radio/console.mjs", import.meta.url), "utf8");
const radioSource = await readFile(new URL("../../driver/radio/index.js", import.meta.url), "utf8");
const schemaSource = await readFile(new URL("../../server/radio/schema.js", import.meta.url), "utf8");
const repositorySource = await readFile(new URL("../../server/radio/repository.js", import.meta.url), "utf8");
const routesSource = await readFile(new URL("../../server/radio/routes.js", import.meta.url), "utf8");

test("Radio Console has original standalone information architecture for recent, channels and direct radio", () => {
  assert.equal(RADIO_KIND_LABELS.GENERAL, "Общий");
  assert.equal(RADIO_KIND_LABELS.GROUP, "Канал");
  assert.equal(RADIO_KIND_LABELS.DIRECT, "Прямой");
  assert.equal(RADIO_ROLE_LABELS.MODERATOR, "Модератор");
  assert.equal(RADIO_POLICY_LABELS.BROADCAST, "Вещание");
  assert.match(consoleSource, /Недавние/);
  assert.match(consoleSource, /Каналы/);
  assert.match(consoleSource, /Прямые/);
  assert.match(consoleSource, /\+ Канал/);
  assert.match(consoleSource, /Найти канал/);
  assert.match(consoleSource, /Приглашения/);
  assert.match(consoleSource, /radio-live-status/);
});

test("Radio Console exposes driving, audio focus, replay, pins and accessibility without copying external assets", () => {
  assert.match(consoleSource, /Режим вождения/);
  assert.match(consoleSource, /radio-car-mode/);
  assert.match(consoleSource, /min-height:min\(48vh,420px\)/);
  assert.match(consoleSource, /Живой звук/);
  assert.match(consoleSource, /1\.25×/);
  assert.match(consoleSource, /1\.5×/);
  assert.match(consoleSource, /Повтор/);
  assert.match(consoleSource, /radio-pins/);
  assert.match(consoleSource, /aria-label/);
  assert.doesNotMatch(consoleSource, /zello/i);
});

test("client integrates overview, groups, discovery, roles, Solo Busy, alerts, pins and local Echo test", () => {
  assert.match(radioSource, /\/api\/driver\/radio\/overview/);
  assert.match(radioSource, /\/api\/driver\/radio\/channels/);
  assert.match(radioSource, /\/api\/driver\/radio\/discover/);
  assert.match(radioSource, /\/members\//);
  assert.match(radioSource, /\/invites/);
  assert.match(radioSource, /\/preferences/);
  assert.match(radioSource, /\/settings/);
  assert.match(radioSource, /\/alerts/);
  assert.match(radioSource, /\/pins\//);
  assert.match(radioSource, /status === "SOLO"/);
  assert.match(radioSource, /status === "BUSY"/);
  assert.match(radioSource, /runEchoTest/);
  assert.match(radioSource, /На сервер ничего не отправлено/);
});

test("radio uses authenticated SSE refresh push with an independent polling fallback", () => {
  assert.match(radioSource, /new EventSource\("\/api\/driver\/radio\/events"\)/);
  assert.match(radioSource, /payload\.type === "radio\.refresh"/);
  assert.match(radioSource, /const POLL_MS = 12_000/);
  assert.match(radioSource, /EventSource performs its own backoff\/reconnect/);
  assert.match(routesSource, /text\/event-stream/);
  assert.match(routesSource, /eventClients = new Set\(\)/);
  assert.match(routesSource, /signalRefresh/);
  assert.match(routesSource, /type: "radio\.refresh"/);
  assert.match(routesSource, /RADIO_EVENT_HEARTBEAT_MS = 20_000/);
  assert.doesNotMatch(routesSource, /sendRadioEvent\([^\n]*nickname/);
  assert.doesNotMatch(routesSource, /sendRadioEvent\([^\n]*transmission/);
});

test("incoming committed audio is filtered by autoplay, mute, Busy and Solo and history supports sequential playback", () => {
  assert.match(radioSource, /settings\.autoPlay/);
  assert.match(radioSource, /targetChannel\.muted/);
  assert.match(radioSource, /settings\.status === "BUSY"/);
  assert.match(radioSource, /settings\.status === "SOLO"/);
  assert.match(radioSource, /settings\.soloChannelId/);
  assert.match(radioSource, /historyPlayers\[index \+ 1\]\.playHere/);
  assert.match(radioSource, /playbackRate = Number\(settings\.playbackRate/);
  assert.match(radioSource, /latest\.sender\.nickname !== ownNickname/);
});

test("server schema is additive around legacy radio transmission and lease tables", () => {
  assert.match(schemaSource, /radio_schema_meta/);
  assert.match(schemaSource, /radio_channel_profiles/);
  assert.match(schemaSource, /radio_channel_member_state/);
  assert.match(schemaSource, /radio_channel_invites/);
  assert.match(schemaSource, /radio_channel_bans/);
  assert.match(schemaSource, /radio_user_settings/);
  assert.match(schemaSource, /radio_channel_alerts/);
  assert.match(schemaSource, /radio_channel_pins/);
  assert.doesNotMatch(schemaSource, /DROP TABLE|ALTER TABLE radio_transmissions|ALTER TABLE radio_speaker_leases/);
  assert.match(repositorySource, /radio_speaker_leases/);
  assert.match(repositorySource, /upload_token_hash/);
  assert.match(repositorySource, /TRANSMISSION_RETENTION_DAYS = 30/);
});

test("group policy and moderation are enforced server-side rather than trusted to the UI", () => {
  assert.match(repositorySource, /EVERYONE/);
  assert.match(repositorySource, /TRUSTED/);
  assert.match(repositorySource, /BROADCAST/);
  assert.match(repositorySource, /radio_talk_not_allowed/);
  assert.match(repositorySource, /OWNER/);
  assert.match(repositorySource, /MODERATOR/);
  assert.match(repositorySource, /LISTENER/);
  assert.match(repositorySource, /radio_channel_bans/);
  assert.match(repositorySource, /areContacts/);
  assert.match(repositorySource, /if \(!isMember\(channelId, userId\)\) return null/);
  assert.match(routesSource, /checkRate\(`radio-create-channel/);
  assert.match(routesSource, /checkRate\(`radio-alert/);
  assert.match(routesSource, /requireCsrf/);
});
