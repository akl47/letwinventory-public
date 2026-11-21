# MCP server for the CAD modeler and Harness designer — plan

Goal: let an agent **author** harnesses and CAD parts/assemblies, not just read them.
Read access is already covered by the REST API and is out of scope, except for the
few query tools an agent needs in order to edit (geometry listing, rendering).

## The core problem

The backend stores documents and regenerates geometry. It does not know how to edit.

| Concern | Where it lives today |
|---|---|
| Sketch entities, constraints, solving (PlaneGCS WASM) | `frontend/src/app/cad/lib` — 68 modules, no Angular imports, already runs under Node |
| Building a feature (extrude, fillet, hole …) from user input | inline in `cad-editor.component.ts` — **not reusable** |
| Harness element creation, pin positions, wire routing | split between `frontend/src/app/utils/harness` (pure) and `harness-canvas.ts` (component, **not reusable**) |
| Persistence, checkout/lock, branches, release, regen, export | REST API |

So the server cannot be a thin API wrapper. It has to run the editing libraries itself,
and the logic that is trapped in components has to be extracted first.

## Architecture

```
agent ──MCP (stdio)──> mcp-server/ (Node, TypeScript)
                          ├─ @letwin/cad-lib      ← frontend/src/app/cad/lib, shared
                          ├─ @letwin/harness-lib  ← frontend/src/app/utils/harness + extracted ops
                          └─ REST client (API key → JWT)  ──> backend ──> kernel
```

- **Location:** new top-level `mcp-server/`. The two libraries stay where they are and are
  consumed by path (tsconfig path alias + esbuild bundle), so the frontend build does not change.
- **Transport:** stdio. Prod is internal-only, so a hosted connector cannot reach it; a local
  server launched by Claude Code / Desktop on the LAN is the only workable option and the simplest.
- **Auth:** existing scoped API keys (`cad.*`, `harness.*`), **one key per person**. Each user
  configures the server with their own key, so the agent acts as them: they author the commits and
  hold the checkout lock, and the agent can never do more than that person's permissions allow.
- **Edit session model:** every edit tool does *load working copy → apply op in memory →
  solve/validate → save with the conflict token*. The server is stateless between calls except
  for a per-document cache; the working copy in the database is the source of truth, so the
  user can watch edits appear in the browser.
- **Guard rails the tools enforce:** must be checked out; never on `main` (create a draft branch);
  reject an op whose solve fails or whose result violates `dimensionalViolations()`. The agent
  **may check in** (with a commit message describing what it did); it never releases — release
  stays a human action.

## Phase 2 — Harness editing

**Extraction first.** Move element creation / connection / deletion out of `harness-canvas.ts`
into pure functions over `HarnessData` (`addConnector`, `addCable`, `addComponent`,
`connect(fromPin, toPin, wireSpec)`, `setTermination`, `remove…`, `autoLayout`). The canvas then
calls the same functions. This overlaps with the structural findings of the earlier harness
editor review.

**Tools**

| Tool | Does |
|---|---|
| `harness_create`, `harness_checkout`, `harness_checkin` | lifecycle (thin API calls) |
| `harness_library_search` | connectors / cables / components / wire ends from the parts DB |
| `harness_add_connector` / `_cable` / `_component` / `_sub_harness` | place an element from a library part |
| `harness_connect` | wire pin → pin with gauge, colour, label, terminations |
| `harness_update` / `harness_remove` | edit or delete an element or connection |
| `harness_auto_layout` | place elements and route wires so the result is legible without manual positions |
| `harness_validate` | existing `/validate` endpoint; run automatically after every edit |
| `harness_render` | PNG of the sheet (see Rendering) |

`harness_auto_layout` is the one genuinely new piece: an agent should describe connectivity, not
pixel coordinates. How much it may move is the **user's choice**, passed as a `mode` argument
(with a per-user default in the server config):
- `new-only` — place and route only what the agent just added; hand-placed elements and manual
  wire routing are left untouched.
- `full` — re-lay the whole sheet.

**Effort:** 5–8 days (extraction 2–3, tools 2, auto-layout 1–2, tests 1).

## Phase 3 — CAD sketches and basic features

**Extraction first.** Pull feature construction out of `cad-editor.component.ts` into
`cad/lib/featureBuilders.ts` — one function per feature kind that turns plain parameters into a
valid `Feature` (ids, defaults, equation wiring). The editor's sidebars then call the builders.
Start with extrude / cut / revolve / hole / datum plane; add the rest in phase 4.

**Tools**

| Tool | Does |
|---|---|
| `cad_create_part_model`, `cad_new_branch`, `cad_checkout`, `cad_checkin` | lifecycle |
| `cad_sketch_create` | new sketch on a datum plane or planar face |
| `cad_sketch_add` | batch of entities: line, rectangle, circle, arc, slot, polygon, spline, text |
| `cad_sketch_constrain` | geometric constraints and dimensions (values or `=expr`) |
| `cad_sketch_status` | DOF, fully-defined?, conflicts / redundancies, closed profiles found |
| `cad_sketch_edit` | move, trim, mirror, offset, fillet, delete |
| `cad_feature_add` | extrude, cut, revolve, hole, datum plane/axis/point |
| `cad_feature_update` / `_delete` / `_reorder` / `_suppress` | tree edits |
| `cad_equations_set` | global variables |
| `cad_regenerate` | regen and return per-feature errors, bodies, volume, bounding box |
| `cad_render` | image of the model or a sketch |

Design rules for these tools:
- Sketch tools take **batches** and return the solved state, so an agent can build a profile in
  one or two calls rather than twenty.
- Entities get agent-supplied labels that the tool maps to ids, so later calls can refer to
  "the top edge" without round-tripping ids.
- Every sketch mutation goes through `solveWithRecovery`; a failed solve rejects the whole batch
  and returns the conflict diagnosis.
- `cad_sketch_status` should push the agent toward fully-defined sketches (the Fully Define
  helper already exists).

**Effort:** 2–3 weeks (feature-builder extraction 4–5 days, sketch tools 4, feature tools 3,
rendering 2–3, tests 3).

## Phase 4 — Geometry-referencing features and assemblies

**Geometry query tool.** `cad_list_geometry` returns faces, edges and vertices of a regen with
id, type (plane / cylinder / …), centroid, normal or axis, area or length, owning body and feature.
Supports filters ("planar faces with normal +Z", "circular edges of radius 3"). This is how the
agent picks; it replaces the mouse.

**Blocker: persistent edge naming.** Edge ids are a positional index that reshuffles on merges, so
fillet / chamfer references made by an agent would break on the next upstream edit — the same
weakness the UI has, but an agent hits it constantly. Options, in order of preference:
1. Kernel-side persistent edge names (derived from the two adjacent face names). Kernel work,
   `NAMING_VERSION` bump.
2. Store a geometric fallback (endpoints + adjacent face ids) with every agent-made reference and
   re-resolve on regen. Partially exists for cross-part refs.

Ship (2) with phase 4 and schedule (1) separately; do not block on it.

**Tools**

| Tool | Does |
|---|---|
| `cad_list_geometry` | above |
| `cad_feature_add` (extended) | fillet, chamfer, shell, draft, patterns, mirror, combine, move/copy, sketch-on-face |
| `asm_insert` / `asm_remove` / `asm_replace` | components (part, branch, configuration) |
| `asm_mate` | coincident, distance, angle, lock — only the four reliably creatable today; the other four declared types need UI/solver work first |
| `asm_pattern`, `asm_skeleton_*` | patterns, skeleton sketches and planes |
| `asm_check` | regenerate + interference + constraint state |
| `asm_bom_sync` | existing endpoint |

**Effort:** open-ended; 3–4 weeks for the list above with fallback references, plus the kernel
naming work (separately scoped).

## Rendering (needed from phase 2 on)

An agent that cannot see its result produces confidently wrong geometry.

- **Harness:** the canvas renderer is plain 2D-context code; run it under `node-canvas` → PNG.
- **Sketches:** SVG from the analytic entities + dimensions (cheap, exact).
- **3D:** v1 drives the real editor with Playwright (logged in with the user's key) and screenshots
  it from standard views plus an optional custom camera — slower, but zero new rendering code and
  pixel-identical to what the user sees. A headless three.js renderer is a later optimisation if
  screenshot latency becomes the bottleneck.

## Testing

- Unit: every extracted builder / harness op gets vitest coverage (they are pure functions).
- Contract: each MCP tool has a test that runs it against the test backend and asserts the saved
  document passes the existing invariants (`dimensionalViolations`, harness `/validate`).
- Scenario: scripted end-to-end builds ("bracket with two holes", "3-connector harness") run in CI.
- Evaluation: a small set of natural-language design tasks run through a real agent, scored by
  regen success and measured dimensions — this is what tells us which tools are missing or confusing.

## Risks

| Risk | Mitigation |
|---|---|
| Extraction destabilises the 18k-line CAD editor / 5.7k-line harness canvas | extract one feature kind at a time behind the existing e2e suite; no behaviour change per step |
| Agent and human edit the same document | existing checkout lock + conflict token; the agent's key is just another user |
| Agent produces under-defined or degenerate sketches | reject on failed solve / invariant violation; status tool reports DOF |
| Fragile edge references | geometric fallback now, kernel naming later |
| Tool surface too large for an agent to use well | batch-oriented tools, ~25 total, evaluation-driven pruning |

## Order of work

1. `mcp-server/` skeleton: stdio transport, API-key auth, REST client, shared-lib bundling, render pipeline for harness.
2. Phase 2 (harness) — smallest extraction, proves the session model and the render loop.
3. Phase 3 feature-builder extraction, then sketch tools, then feature tools, 3D rendering.
4. Phase 4 geometry query + fallback references, then referencing features, then assemblies.
5. Kernel persistent edge naming (parallel track).

Total for phases 2–4 excluding kernel naming: roughly 7–9 weeks of focused work.

## Decisions

- The agent may check in; it never releases.
- 3D rendering in v1 is Playwright screenshots of the real editor.
- Harness auto-layout scope (`new-only` vs `full`) is chosen by the user.
- One API key per person; the agent acts as the invoking user.
