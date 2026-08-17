# Module System

PlatformOS modules are independent units.

## Rules

- A module must be removable.
- A module must be replaceable.
- A module must not require core changes when added.
- A module must be registered in `system/registry.json`.
- A module must not depend on another business module unless this dependency is explicitly declared later.

## Required Module Shape

```text
modules/<module-id>/
  manifest.json
  index.html
  styles.css
  app.js
  assets/
  config/
  README.md
```

## Registry Loading

All module discovery goes through:

```text
system/registry.json
```

The runtime implementation is `core/runtime.js`.

The launcher is generated from enabled registry entries only. Disabled modules are validated but not shown in the launcher and cannot be opened.

If one module has a missing file or broken manifest, the runtime records a module error and continues loading the remaining valid modules.

Adding a module:

1. Create `modules/<module-id>/`.
2. Add all required module files.
3. Add one registry entry.
4. Run `npm run verify`.

Done. No core modification.

## Current Modules

`lab`:

Current live site. Status: `active-legacy`. Runtime still uses root files while migration proceeds.

`transport`:

Architecture only. Independent from `lab`.

`library`:

Architecture only.

`research`:

Architecture only.

## Transport

Prepared internal areas:

```text
truck/
taxi/
cargo/
parking/
maps/
radio/
chat/
drivers/
```

Future routes:

```text
/transport
/truck
/taxi
```

No transport implementation exists yet.

## Tests

Runtime tests are in:

```text
scripts/test-platformos-runtime.js
```

Covered cases:

- current modules: `lab`, `transport`, `library`, `research`
- registry loading
- manifest loading
- module loading
- module opening
- disabled module handling
- missing module handling
- broken manifest handling
- duplicate id handling
