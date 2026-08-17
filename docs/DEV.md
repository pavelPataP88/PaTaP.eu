# Local development

## Supported runtime

Use Node.js 22. The backend uses the built-in `node:sqlite` API, so Node 20 is not supported.

Recommended versions:

- Node.js: 22.x, minimum 22.5;
- npm: 10 or newer.

The repository includes `.nvmrc` and `package.json#engines`. `npm` is configured with `engine-strict=true` so an unsupported runtime fails early instead of producing confusing test errors later.

## Clean engineering checkout

```powershell
git clone https://github.com/pavelPataP88/PaTaP.eu.git
cd PaTaP.eu
npm ci
npm run build
npm run verify
npm run test:browser
```

The large production background image is intentionally absent from the public engineering checkout. Its absence must not prevent build or verification.

## Production workspace

The live installation currently runs from:

```text
D:\WWW.PATAP.EU
```

Do not replace that directory with a GitHub checkout blindly. Before deployment compare local work with the selected GitHub branch and preserve any local changes that have not been committed.

A safe deployment sequence is:

1. verify the local working tree and current branch;
2. fetch GitHub changes;
3. compare local HEAD with the candidate branch;
4. resolve differences without deleting production-only data;
5. run `npm ci` if dependencies changed;
6. run `npm run build`;
7. run `npm run verify`;
8. run `npm run test:browser`;
9. restart only the affected processes;
10. verify `patap.eu`, `driver.patap.eu`, API health and authenticated Driver behavior.

Never copy GitHub over `data/`, `var/`, local secret files or Cloudflare credentials.

## Development data

Use disposable test data and a non-production SQLite path when running destructive authentication tests. Do not use real messages, real GPS coordinates or real users in repository fixtures.

## Password policy

The six-character minimum is intentional for the current small controlled user base. Do not raise it as part of unrelated cleanup. Any later change to password policy should be a separate product decision with matching UI, backend validation and tests.
