# Vendored: @salusoft89/planegcs

Source: https://github.com/Salusoft89/planegcs
Upstream npm: https://www.npmjs.com/package/@salusoft89/planegcs
License: LGPL-2.0-or-later
Version pinned: **1.1.7** (published 2025-04-25)

## Why this is vendored

`@salusoft89/planegcs` is the only viable JS-side 2D geometric constraint solver
on npm — it wraps FreeCAD's PlaneGCS C++ source compiled to WebAssembly. The
upstream package has a slow release cadence (every 3–6 months), so the dist
tree is checked in here as insurance against:

- npm registry takedown / unpublish
- Upstream maintainer going dark
- Auto-resolution drift (we are NOT subscribed to upstream changes)

The npm dependency has been removed from `package.json` in favour of importing
directly from this directory. `solver.ts` is the only import site.

## Updating

To pull a newer upstream version:

1. `npm install @salusoft89/planegcs@<version>` (temporary)
2. `rm -rf frontend/src/app/cad/vendor/planegcs && cp -r node_modules/@salusoft89/planegcs/dist frontend/src/app/cad/vendor/planegcs`
3. Re-add `PROVENANCE.md` (this file) and update the version line above
4. `npm uninstall @salusoft89/planegcs`
5. Run `npx vitest run src/app/cad/lib/solver.spec.ts` — must pass
6. Manually test the CAD editor in the browser (WASM loader takes a different path in the bundled build)

## License compliance

LGPL-2.0-or-later requires that consumers can replace the library at runtime.
Because PlaneGCS runs as WebAssembly behind a JS wrapper, the LGPL "system
library" replacement requirement is satisfied by the dynamic WASM load — users
can substitute their own `planegcs.wasm` build. Source for PlaneGCS itself
lives in FreeCAD: https://github.com/FreeCAD/FreeCAD/tree/main/src/Mod/Sketcher/App/planegcs
