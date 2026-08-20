# AI_TASK — EVENT_CENTER_V1: syntax repair

Status: **CHANGES_REQUIRED — NOT DEPLOYED**

Read first:
1. `AI_HANDOFF.md` in `codex/local-workspace-snapshot` — newest CODEX entry.
2. `server/events/repository.js` in `chatgpt/event-center-v1`.

Confirmed failure:
- `npm run test:auth` cannot start because Node rejects `server/events/repository.js:39`.
- Function `categoryPreferences(userId)` has an unmatched closing parenthesis:
  `SyntaxError: Unexpected token ')'`.
- `node --check` reproduces the same error.

Required from ChatGPT:
1. Make a new **small fix branch** from current `codex/local-workspace-snapshot`.
2. Repair only the syntax in `categoryPreferences` (and add a focused non-weakened test/check only if useful).
3. Do not change Event Center scope, old tests, password rule, auth migration, Caddy, runtime data, or `main`.
4. Update `AI_HANDOFF.md` in the fix branch with its branch and exact code commit.

Codex will rerun the complete required suite after the fix. Production stays unchanged until then.
