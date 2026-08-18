import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatRecordingTime, isAccidentalRecording, RADIO_PHASES } from "../../driver/radio/experience.mjs";

const radioSource = await readFile(new URL("../../driver/radio/index.js", import.meta.url), "utf8");
const uiSource = await readFile(new URL("../../driver/radio/experience.mjs", import.meta.url), "utf8");
const routesSource = await readFile(new URL("../../server/radio/routes.js", import.meta.url), "utf8");
const repositorySource = await readFile(new URL("../../server/radio/repository.js", import.meta.url), "utf8");

test("radio recording helper rejects accidental taps and formats elapsed time", () => {
  assert.equal(isAccidentalRecording(0), true);
  assert.equal(isAccidentalRecording(549), true);
  assert.equal(isAccidentalRecording(550), false);
  assert.equal(isAccidentalRecording(1_400), false);
  assert.equal(formatRecordingTime(0), "0:00");
  assert.equal(formatRecordingTime(9_900), "0:09");
  assert.equal(formatRecordingTime(60_000), "1:00");
});

test("radio exposes explicit driver-facing phases and large mobile PTT", () => {
  for (const phase of ["ready", "requesting", "recording", "sending", "sent", "listening", "error"]) {
    assert.ok(RADIO_PHASES.includes(phase));
  }
  assert.match(uiSource, /Активный канал/);
  assert.match(uiSource, /Зажмите и говорите/);
  assert.match(uiSource, /уведите палец за пределы кнопки/);
  assert.match(uiSource, /клавиатуры — Esc/);
  assert.match(uiSource, /min-height:104px/);
  assert.match(uiSource, /min-height:112px/);
  assert.match(uiSource, /touch-action:none/);
  assert.match(uiSource, /aria-describedby/);
  assert.match(uiSource, /aria-pressed/);
});

test("PTT hold remains releasable and supports pointer, one-hand cancel and keyboard cancellation", () => {
  assert.match(radioSource, /ptt\.disabled = !profileReady \|\| !channel \|\| Boolean\(busy\) \|\| uploading/);
  assert.doesNotMatch(radioSource, /ptt\.disabled[^\n]+Boolean\(recording\)/);
  assert.match(radioSource, /pointerdown/);
  assert.match(radioSource, /pointermove/);
  assert.match(radioSource, /finishPointerHold/);
  assert.match(radioSource, /pointerCancelOnRelease/);
  assert.match(radioSource, /CANCEL_GESTURE_MARGIN_PX = 12/);
  assert.match(radioSource, /Отпустите палец — передача будет отменена/);
  assert.match(radioSource, /pointercancel/);
  assert.match(radioSource, /lostpointercapture/);
  assert.match(radioSource, /event\.key === "Escape"/);
  assert.match(radioSource, /event\.key === " " \|\| event\.key === "Enter"/);
  assert.match(radioSource, /blur/);
  assert.match(radioSource, /if \(pointerCancelOnRelease\) cancelRecording\(undefined\)/);
});

test("short recordings and explicit cancellation use the existing token-protected cancel path", () => {
  assert.match(radioSource, /MIN_RECORDING_MS = 550/);
  assert.match(radioSource, /isAccidentalRecording\(elapsed, MIN_RECORDING_MS\)/);
  assert.match(radioSource, /Слишком короткая запись\. Передача не отправлена\./);
  assert.match(radioSource, /cancelTransmission\(session\)/);
  assert.match(radioSource, /X-Radio-Upload-Token/);
  assert.match(routesSource, /req\.method === "DELETE" && audioMatch/);
  assert.match(routesSource, /radio\.cancelTransmission/);
  assert.match(repositorySource, /upload_token_hash/);
  assert.match(repositorySource, /DELETE FROM radio_speaker_leases/);
});

test("delivery success is shown only after upload confirmation and ambiguous network outcomes stay explicit", () => {
  const uploadIndex = radioSource.indexOf("await uploadBinary(");
  const successIndex = radioSource.indexOf('setState("Передача доставлена.", "sent"');
  assert.ok(uploadIndex >= 0);
  assert.ok(successIndex > uploadIndex);
  assert.match(radioSource, /Пока нет подтверждения сервера, она не считается доставленной/);
  assert.match(radioSource, /firstCheck = await loadTransmissions\(\{ silent: true \}\)/);
  assert.match(radioSource, /cancelled = await cancelTransmission\(session\)/);
  assert.match(radioSource, /secondCheck = await loadTransmissions\(\{ silent: true \}\)/);
  assert.match(radioSource, /Сервер подтвердил её после повторной проверки канала/);
  assert.match(radioSource, /сервер не подтвердил отмену\. Проверьте канал ещё раз/);
  assert.match(radioSource, /Не удалось подтвердить доставку\. Проверьте канал после восстановления сети\./);
  assert.match(radioSource, /Нет сети\. Передача не отправлена\./);
  assert.match(radioSource, /Ответ загрузки был потерян, но передача уже есть в канале/);
});

test("radio protocol and access model remain the existing general/direct PTT model", () => {
  assert.match(radioSource, /\/api\/driver\/radio\/direct/);
  assert.match(radioSource, /\/api\/driver\/radio\/channels\/\$\{channel\.id\}\/ptt/);
  assert.match(routesSource, /createDirectChannel/);
  assert.match(repositorySource, /c\.kind, c\.created_at/);
  assert.match(repositorySource, /'DIRECT'/);
  assert.match(repositorySource, /radio_contact_required/);
  assert.match(repositorySource, /areContacts/);
});
