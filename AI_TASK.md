# AI_TASK — AUD-022/AUD-027 FINAL_AUDIT_CLOSE_V1

Status: `READY_FOR_CODEX_REVIEW` — documentation/policy close only, NOT DEPLOYED.

Authoritative production base:
`codex/local-workspace-snapshot @ 0e73e8a1972bfd573b312eb4c87af9ada6d2db0c`.

Working branch:
`chatgpt/aud-022-027-final-audit-close-v1`.

## Goal

Formally close the final two items of the 30-point technical audit without changing product runtime:

- `AUD-022 PASSWORD_POLICY_V2`;
- `AUD-027 DEFAULT_BRANCH_SOURCE_OF_TRUTH_V1`.

After this documentation/policy block is safely mirrored to production and recorded in `AI_HANDOFF.md`, the 30-point audit is closed 30/30. This does not mean every future product feature or real-device field test is complete.

## AUD-022 — owner password-policy decision

The owner explicitly keeps the minimum registration password length at **6 characters** for Driver V1.

This is an accepted product/security trade-off and must not be silently changed by an engineer or AI agent.

Important boundary:

- do not describe six characters as a universally strong password guarantee;
- continue to encourage users to choose a longer, unique password where product copy permits;
- current asynchronous scrypt hashing/verification remains unchanged;
- existing auth/session/CSRF/rate-limit/admin controls remain unchanged;
- no forced reset or migration of existing users is authorized;
- raising the minimum later requires a new explicit owner decision.

Therefore `AUD-022` is closed by explicit owner risk acceptance, not by changing runtime behavior.

## AUD-027 — Git source-of-truth decision

On 2026-08-22 GitHub `main` was safely fast-forwarded, without force/rewrite, from its stale ancestor to the exact verified production snapshot:

`0e73e8a1972bfd573b312eb4c87af9ada6d2db0c`.

Immediately after that operation GitHub compare reported:

- `main` vs production snapshot: `identical`;
- ahead: 0;
- behind: 0.

The permanent policy is:

1. `codex/local-workspace-snapshot` is the evidence branch representing the last clean source copied from actually running production after a successful release.
2. `main` is the normal stable/default GitHub branch and must track the latest verified production snapshot.
3. After a successful production deployment and creation/verification of a new clean snapshot, `main` may be advanced only by a non-force fast-forward to that verified snapshot.
4. Never force-push/rewrite `main` to resolve divergence.
5. If `main` and the snapshot ever diverge, stop and investigate before changing either ref.
6. New engineering branches must start from the latest verified production source; when `main` is identical to the snapshot, either ref points to the same source, but the snapshot remains the deployment evidence.
7. GitHub is an engineering mirror; the Windows production working tree remains the actual running system.

Therefore `AUD-027` is closed.

## Intentionally unchanged

This block must not change:

- Driver/server/runtime code;
- password minimum in code (it remains 6);
- password hashing parameters/format;
- SQLite/schema/users/sessions;
- Navigation/Valhalla/`NAV_ROUTER_URL`;
- interface;
- Caddy/tunnel/services;
- runtime/private data.

## Mandatory Codex gate

1. Confirm exact base `0e73e8a1972bfd573b312eb4c87af9ada6d2db0c`.
2. Confirm the candidate changes Markdown documentation only.
3. Confirm `main` currently resolves to that same base snapshot before applying this docs block; if it does not, report the exact difference rather than force-changing refs.
4. `git diff --check` must PASS.
5. Apply only the documentation files using the normal recoverable docs-only workflow.
6. No backend restart, dependency install, SQLite operation or DR cycle is required solely for this docs-only policy block.
7. Confirm the running stack remains `HEALTHY` and both public domains remain HTTP 200 without disturbing services.
8. Create a new clean `codex/local-workspace-snapshot` from the actual production working tree.
9. Append `AI_HANDOFF.md` evidence:
   - `BLOCK: AUD-022/AUD-027 FINAL_AUDIT_CLOSE_V1`
   - `STATUS: DEPLOYED`
   - `AUDIT: 30/30 CLOSED`
   - password minimum 6 retained by explicit owner decision;
   - scrypt unchanged;
   - main/source-of-truth policy recorded;
   - no runtime/interface/Navigation change.
10. Return the new clean production snapshot SHA.

After Codex produces and verifies the new snapshot, ChatGPT will fast-forward `main` to that new snapshot as the final GitHub synchronization step. No force push is allowed.

If any runtime/code/config/private-data change appears, return `CHANGES_REQUIRED` and do not expand the block.
