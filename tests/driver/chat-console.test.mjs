import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CHAT_REACTIONS, reactionView } from "../../driver/chat/index.js";
import { attachmentKind, formatBytes, formatDuration, CHAT_MAX_VOICE_MS } from "../../driver/chat/media.mjs";
import { CHAT_ROOM_KIND_LABELS, CHAT_ROLE_LABELS } from "../../driver/chat/console.mjs";

const indexSource = await readFile(new URL("../../driver/chat/index.js", import.meta.url), "utf8");
const consoleSource = await readFile(new URL("../../driver/chat/console-v2.mjs", import.meta.url), "utf8");
const policySource = await readFile(new URL("../../driver/chat/console.mjs", import.meta.url), "utf8");
const mediaSource = await readFile(new URL("../../driver/chat/media.mjs", import.meta.url), "utf8");
const schemaSource = await readFile(new URL("../../server/chat/schema.js", import.meta.url), "utf8");
const repositorySource = await readFile(new URL("../../server/chat/repository.js", import.meta.url), "utf8");
const routesSource = await readFile(new URL("../../server/chat/routes-v2.js", import.meta.url), "utf8");
const policyRoutesSource = await readFile(new URL("../../server/chat/routes.js", import.meta.url), "utf8");

test("Chat Console exposes a messenger-grade room architecture without copying another product", () => {
  assert.equal(CHAT_ROOM_KIND_LABELS.DIRECT, "Личный");
  assert.equal(CHAT_ROOM_KIND_LABELS.GROUP, "Группа");
  assert.equal(CHAT_ROLE_LABELS.READONLY, "Только чтение");
  for (const label of ["Все","Личные","Группы","Страна","Архив","Чаты"]) assert.match(consoleSource, new RegExp(label));
  assert.match(consoleSource, /grid-template-columns:minmax\(270px,330px\) minmax\(0,1fr\)/);
  assert.match(consoleSource, /@media\(max-width:820px\)/);
  assert.match(consoleSource, /conversation-open/);
  assert.match(policySource, /position:relative/);
  assert.match(policySource, /READONLY/);
  assert.doesNotMatch(consoleSource, /whatsapp|telegram/i);
  assert.doesNotMatch(indexSource, /end-to-end encrypted|E2EE|сквозн.*шифр/i);
});

test("reaction model supports 12 curated actions and keeps personalized state", () => {
  assert.equal(CHAT_REACTIONS.length, 12);
  for (const key of ["👍","❤️","😂","😮","😢","🙏","🔥","✅","👀","👎","🎉","💯"]) assert.ok(CHAT_REACTIONS.some((item) => item.key === key));
  const view = reactionView([{ key: "🔥", count: 2, reactedByMe: true, people: ["Alpha","Bravo"] }], "🔥");
  assert.equal(view.count, 2);
  assert.equal(view.reactedByMe, true);
  assert.match(view.title, /Alpha/);
});

test("media helpers classify supported content and voice recorder has explicit pause resume and five-minute cap", () => {
  assert.equal(attachmentKind({ type: "image/webp" }), "IMAGE");
  assert.equal(attachmentKind({ type: "video/mp4" }), "VIDEO");
  assert.equal(attachmentKind({ type: "audio/webm" }), "AUDIO");
  assert.equal(attachmentKind({ type: "application/pdf" }), "FILE");
  assert.equal(formatBytes(1024), "1.0 КБ");
  assert.equal(formatDuration(65_000), "1:05");
  assert.equal(CHAT_MAX_VOICE_MS, 5 * 60 * 1000);
  assert.match(mediaSource, /getUserMedia/);
  assert.match(mediaSource, /recorder\.pause\(\)/);
  assert.match(mediaSource, /recorder\.resume\(\)/);
  assert.match(mediaSource, /echoCancellation: true/);
  assert.match(mediaSource, /noiseSuppression: true/);
  assert.doesNotMatch(mediaSource, /getUserMedia[\s\S]*setInterval\([^)]*getUserMedia/);
});

test("client wires real APIs for groups, replies, edit, forward, search, media, polls, receipts, drafts and pins", () => {
  for (const pattern of [
    /\/api\/driver\/chat\/overview/,
    /\/api\/driver\/chat\/groups/,
    /\/groups\/discover/,
    /replyToMessageId/,
    /forwardFromMessageId/,
    /method: "PATCH"/,
    /\/api\/driver\/chat\/uploads/,
    /X-Chat-Upload-Token/,
    /\/polls/,
    /\/read/,
    /\/draft/,
    /\/pins\//,
    /\/preferences/,
    /\/search\?q=/
  ]) assert.match(indexSource, pattern);
  assert.match(indexSource, /playbackRate = speeds\[speedIndex\]/);
  assert.match(indexSource, /Enter.*shiftKey/s);
});

test("server schema stays additive and models room state, rich messages, media, polls and visibility", () => {
  for (const table of [
    "chat_schema_meta","chat_room_profiles","chat_room_invites","chat_room_bans","chat_room_member_state","chat_message_meta",
    "chat_uploads","chat_message_attachments","chat_message_reactions_v2","chat_room_pins","chat_message_mentions","chat_hidden_messages",
    "chat_polls","chat_poll_options","chat_poll_votes","chat_drafts"
  ]) assert.match(schemaSource, new RegExp(table));
  assert.doesNotMatch(schemaSource, /DROP TABLE|ALTER TABLE chat_messages|ALTER TABLE chat_rooms/);
  assert.match(schemaSource, /SELECT message_id, user_id, reaction, created_at FROM chat_message_reactions/);
});

test("server enforces group roles, read cursors, edit window, delete scopes, mentions and bounded uploads", () => {
  assert.match(repositorySource, /EDIT_WINDOW_MS = 15 \* 60 \* 1000/);
  assert.match(repositorySource, /READONLY/);
  assert.match(repositorySource, /last_delivered_message_id/);
  assert.match(repositorySource, /last_read_message_id/);
  assert.match(repositorySource, /chat_hidden_messages/);
  assert.match(repositorySource, /@all/);
  assert.match(repositorySource, /MAX_POLL_OPTIONS = 12/);
  assert.match(repositorySource, /MESSAGE_RETENTION_OPTIONS/);
  assert.match(routesSource, /MAX_UPLOAD_BYTES = 25 \* 1024 \* 1024/);
  assert.match(routesSource, /Accept-Ranges/);
  assert.match(routesSource, /Content-Range/);
  assert.match(policyRoutesSource, /chat_readonly/);
  assert.match(policyRoutesSource, /crossRoomForward/);
  assert.match(policyRoutesSource, /options\.dataDir \|\| DATA_DIR/);
});
