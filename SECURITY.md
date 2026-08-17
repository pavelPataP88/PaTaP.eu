# Security policy

## Scope

This repository intentionally contains source code and operational configuration, but must not contain production secrets or private user data.

Never commit:

- Cloudflare tunnel tokens or API keys;
- authentication secrets;
- SQLite production databases or backups;
- real user messages;
- GPS coordinates or location history;
- runtime logs that may contain IP addresses or personal data;
- password reset tokens;
- files from `data/` or `var/`.

## Reporting a vulnerability

Do not publish an exploitable security issue together with working credentials, private data or a production token in a public GitHub issue.

When reviewing a suspected vulnerability:

1. reproduce it without production user data where possible;
2. identify the affected file and route;
3. state the expected and actual behavior;
4. add a regression test before or together with the fix;
5. verify `npm run verify` and the browser test before deployment.

## Authentication decisions

The current project intentionally accepts passwords from 6 characters for the small controlled user base. This is a product decision and must not be changed automatically during security cleanup. Passwords are still hashed with `scrypt`; rate limiting, lockout, secure cookies and CSRF protection remain required.

## Production deployment

GitHub is a source repository, not the production host. Production runs from the local workspace and is exposed through Caddy and Cloudflare Tunnel. Changes from GitHub must be compared with the live local workspace before they are applied so that newer local changes are not overwritten.
