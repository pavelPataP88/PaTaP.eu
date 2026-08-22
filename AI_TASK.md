# AI_TASK — новый чат: восстановление контекста

Status: production стабильный, новый функциональный блок ещё не выбран.

Сначала прочитай `docs/AI_NEW_CHAT_START.md`, затем `docs/AI_COLLABORATION_PROTOCOL.md` и актуальную запись `COMMERCIAL_HARDENING_V1` в `AI_HANDOFF.md`.

Источник истины: `codex/local-workspace-snapshot @ 9745b5145bce247d3cce6b3f9a67fbd983a0011c`. Это безопасное зеркало реально установленного кода; runtime и личные данные исключены.

Не менять `main`, Navigation, secrets или runtime-данные. Navigation остаётся заблокированной без настоящего проверенного `NAV_ROUTER_URL`.

Первая задача: после чтения документов предложить один небольшой следующий блок с критериями готовности. Не писать большой код до выбора и фиксации блока.
