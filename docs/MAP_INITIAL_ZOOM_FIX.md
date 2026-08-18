# MAP_INITIAL_ZOOM_FIX

STATUS: READY_FOR_CODEX_REVIEW
BRANCH: `chatgpt/map-initial-zoom-fix-01`
SOURCE_CODE_COMMIT: `90f20926562b9998ff0b01dde8f4ff575b90f86f`
BASE_MAP_CANDIDATE: `chatgpt/map-enhancements-v1 @ 88157649a76ac0332f84dd6c615ecee402219765`

Эта ветка является самодостаточной заменой предыдущей комбинации MAP_ENHANCEMENTS + test-only fix: в ней уже есть большой MAP_ENHANCEMENTS кандидат, исправление stale `upsertMarker` test и новый initial zoom fix.

## Что изменено по zoom

- Авторизованная карта стартует минимум с `zoom 11`, даже если старый HTML config содержит `zoom: 5`.
- При первом свежем GPS карта один раз центрируется на водителе и приближается минимум до `zoom 14`.
- Если пользователь до прихода GPS уже приблизил карту сильнее 14, масштаб не уменьшается.
- Последующие GPS updates не меняют zoom автоматически.
- При выключении/очистке GPS флаг первого focus сбрасывается; после следующего включения GPS выполняется один новый initial focus.
- Кнопка `⌖` включает FOLLOW и возвращает к водителю с zoom не меньше 14.
- Существующие FREE/FOLLOW/HEADING режимы, accuracy circle, layers, Road Reports, guest lazy map и server API не менялись этим fix.

## Тесты

`tests/driver/map-enhancements.test.mjs` дополнен проверками:
- `INITIAL_MAP_ZOOM = 11`;
- `GPS_FOCUS_ZOOM = 14`;
- initial map zoom использует минимум 11;
- первый GPS focus выполняется ровно через guarded `initialGpsFocused`;
- clearOwn сбрасывает guard;
- focus zoom не опускает уже более крупный пользовательский zoom.

`tests/driver/road-reports-redesign.test.mjs` уже содержит предыдущий test-only fix: `upsertReport(data.report)` + `renderMarkers()` вместо устаревшего `upsertMarker(data.report)`.

## Codex проверить

1. Использовать эту ветку как единый MAP candidate вместо наложения трёх веток.
2. Сохранить актуальный `AI_HANDOFF.md` из `codex/local-workspace-snapshot`; не заменять его старой копией из ancestry ветки.
3. Прогнать:
   - `node --test tests/driver/map-enhancements.test.mjs tests/driver/road-reports.test.mjs tests/driver/road-reports-redesign.test.mjs`
   - `npm run test:driver-modules`
   - `npm run build`
   - `npm run verify`
   - `npm run test:browser`
4. На планшете проверить: до GPS карта не показывает всю страну; после первого GPS — район/улицы вокруг водителя; новые GPS updates не дёргают zoom; `⌖` возвращает к водителю.
5. Только после PASS применять на рабочий сайт.

Production, main, SQLite, Caddy, auth, chat, radio и runtime data этим zoom fix не менялись.
