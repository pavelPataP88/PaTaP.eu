import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { CHAT_REACTIONS, reactionView } from "../../driver/chat/index.js";

const root = path.resolve(import.meta.dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "driver", "chat", "index.js"), "utf8");

test("chat exposes the expanded curated reaction set", () => {
  assert.equal(CHAT_REACTIONS.length, 12);
  assert.deepEqual(CHAT_REACTIONS.map((item) => item.key), ["👍","❤️","😂","😮","😢","🙏","🔥","✅","👀","👎","🎉","💯"]);
});

test("reaction display model shows count, own state, and people safely", () => {
  const view = reactionView([{ key: "👍", count: 2, reactedByMe: true, people: ["Alpha", "Bravo"] }], "👍");
  assert.deepEqual(view, { key: "👍", label: "Понял", count: 2, people: ["Alpha", "Bravo"], reactedByMe: true, title: "Понял: Alpha, Bravo" });
  assert.deepEqual(reactionView([], "👀"), { key: "👀", label: "Проверяю", count: 0, people: [], reactedByMe: false, title: "Проверяю" });
});

test("client personalizes realtime reaction updates without rewriting message content", () => {
  assert.match(source, /payload\.type === "chat\.reaction\.updated"/);
  assert.match(source, /item\.people\.includes\(ownNickname\)/);
  assert.match(source, /reactions: personalized/);
  assert.match(source, /Не удалось изменить реакцию/);
  assert.match(source, /appendTextWithMentions/);
});
