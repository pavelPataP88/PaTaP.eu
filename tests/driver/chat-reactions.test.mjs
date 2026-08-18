import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "driver", "chat", "index.js"), "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const chat = await import(moduleUrl);

test("chat exposes a compact fixed reaction set", () => {
  assert.deepEqual(chat.CHAT_REACTIONS, [
    { key: "👍", label: "Понял" },
    { key: "✅", label: "Подтверждаю" },
    { key: "👀", label: "Проверяю" },
    { key: "❤️", label: "Поддерживаю" }
  ]);
});

test("reaction display model shows count, own state, and people safely", () => {
  const view = chat.reactionView([
    { key: "👍", count: 2, reactedByMe: true, people: ["Alpha", "Bravo"] }
  ], "👍");
  assert.deepEqual(view, {
    key: "👍",
    label: "Понял",
    count: 2,
    people: ["Alpha", "Bravo"],
    reactedByMe: true,
    title: "Понял: Alpha, Bravo"
  });

  assert.deepEqual(chat.reactionView([], "👀"), {
    key: "👀",
    label: "Проверяю",
    count: 0,
    people: [],
    reactedByMe: false,
    title: "Проверяю"
  });
});

test("client personalizes realtime updates and preserves message text on reaction errors", () => {
  assert.match(source, /payload\.type === "chat\.reaction\.updated"/);
  assert.match(source, /item\.people\.includes\(ownNickname\)/);
  assert.match(source, /messages\.set\(payload\.messageId, \{ \.\.\.current, reactions: personalized \}\)/);
  assert.match(source, /Не удалось изменить реакцию\. Сообщение осталось без изменений\./);
  assert.match(source, /body\.textContent = message\.text/);
});
