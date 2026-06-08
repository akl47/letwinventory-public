# NotebookLM Source Pack — CAD / Assembly / VCS

Twelve clean, self-contained **source documents** for [Google NotebookLM](https://notebooklm.google.com), one per podcast episode. These are written *as source material*, not as scripts: NotebookLM ingests them and generates its **own** two-host Audio Overview — it does not read a script aloud. Dialogue, speaker labels, and stage directions have been stripped; what remains is focused, declarative, well-structured knowledge, which is what produces the best Audio Overviews.

The content mirrors the [podcast scripts](../podcast-scripts.md) but optimized for NotebookLM ingestion.

## How to use

1. Go to [notebooklm.google.com](https://notebooklm.google.com) and create a new notebook.
2. **Add sources.** Upload the `.md` files (NotebookLM accepts Markdown). Two strategies:
   - **One audio per episode (recommended):** put a *single* episode file in a notebook (or select just that source) and generate the Audio Overview. One focused source → one tight, on-topic episode. Repeat per episode.
   - **One broad audio for the whole system:** add all 12 files to one notebook and generate a single Audio Overview for a sweeping tour. (More sources = broader, less deep.)
3. Click **Audio Overview** → the **Customize** box → paste the episode's **focus prompt** below to steer the two hosts (topic emphasis, depth, audience, length).
4. Generate. Optionally also use NotebookLM's chat/study tools against the same sources.

### Tips for the best results
- **One source ≈ one episode.** NotebookLM's Audio Overview gets vaguer as you add more sources; keep a notebook focused if you want a focused episode.
- **Use the Customize box every time** — without a steer, NotebookLM picks its own angle. The focus prompts below set topic, depth, and audience.
- **Audience matters.** Episodes 1–4 are written to be accessible; 5–12 are technical. Tell NotebookLM which in the prompt (the prompts below already do).
- **Length.** NotebookLM Audio Overviews are typically ~10–25 min regardless of source length; ask for "a longer, in-depth conversation" in the prompt if you want more.
- The `## Key points` block at the end of each file gives NotebookLM strong anchors — leave it in.

## The episodes

| # | Source file | Topic | Tier |
|---|-------------|-------|------|
| 1 | [01-the-big-picture.md](./01-the-big-picture.md) | What the system is, the four subsystems, parametric "recipe not file" | Broad |
| 2 | [02-the-geometry-kernel.md](./02-the-geometry-kernel.md) | The Rust/OCCT kernel, accessibly | Broad |
| 3 | [03-version-control.md](./03-version-control.md) | Git-for-parts, accessibly | Broad |
| 4 | [04-assemblies-and-the-big-idea.md](./04-assemblies-and-the-big-idea.md) | Assemblies + the unified architecture, accessibly | Broad |
| 5 | [05-first-principles.md](./05-first-principles.md) | How it all fits, technically | Deep |
| 6 | [06-sketching-and-the-solver.md](./06-sketching-and-the-solver.md) | Sketching + the 2D constraint solver | Deep |
| 7 | [07-features.md](./07-features.md) | Features: 2D → 3D solids | Deep |
| 8 | [08-inside-the-kernel.md](./08-inside-the-kernel.md) | Kernel internals | Deep |
| 9 | [09-content-addressed-vcs.md](./09-content-addressed-vcs.md) | Content-addressed VCS internals | Deep |
| 10 | [10-freeze-and-release.md](./10-freeze-and-release.md) | Freeze + release/revisions | Deep |
| 11 | [11-assemblies-and-the-mate-solver.md](./11-assemblies-and-the-mate-solver.md) | The 3D mate solver | Deep |
| 12 | [12-architecture-written-once.md](./12-architecture-written-once.md) | "Written once" architecture | Deep |

## Suggested Audio Overview focus prompts

Paste one into NotebookLM's **Customize** box when generating the Audio Overview for that source.

**Ep 1 — The Big Picture**
> Give an accessible, big-picture overview for a smart non-specialist: what this browser-based CAD system is, why it lives inside a manufacturing/inventory app, its four subsystems, and the idea that a part's shape is a replayable recipe rather than a saved file. Keep it intuitive; avoid code and jargon.

**Ep 2 — The Geometry Kernel (accessible)**
> Explain, for a curious non-engineer, what the geometry kernel is and why it's a separate Rust program built on OpenCASCADE. Cover the modeling operations as a vocabulary (extrude, boolean, revolve, sweep, shell, fillet) using analogies, and the two clever bits: persistent face names and surface classification. Keep it conceptual.

**Ep 3 — Version Control (accessible)**
> Explain "git for 3D parts" to a general audience: content-addressed snapshots, check-in/branch/compare, a protected main branch, and what releasing a part does (freeze geometry, stamp a revision, lock it). Cover why this matters for a regulated manufacturing shop. Keep the cryptographic plumbing light.

**Ep 4 — Assemblies + the Big Idea (accessible)**
> Explain assemblies for a general audience: instances and "mates" (relationships, not coordinates), what the mate solver does intuitively, and the assembly toolbox (patterns, mirror, subassemblies, exploded/section views, interference, BOM). Then land the big architectural idea: parts and assemblies are the same app, with version control written once.

**Ep 5 — First Principles (technical)**
> A technical deep-dive for software engineers on how the whole system fits together: the four subsystems and where they live in the codebase, the two regeneration cycles (CAD vs assembly), versioning as the spine (working copy vs durable content-addressed history, the lineage-root repo), and the "written once" binding pattern. Use real component and file names.

**Ep 6 — Sketching + the Solver (technical)**
> A technical deep-dive on 2D sketching: the tagged-union sketch entity model, the vendored PlaneGCS Newton-Raphson constraint solver and how constraints translate (including synthesized primitives), degrees-of-freedom/determinacy, the render-vs-solve-vs-pick split, and profile extraction via a planar-graph loop walk. Engineer audience; keep the honest limitations.

**Ep 7 — Features (technical)**
> A technical deep-dive on the feature pipeline: the immutable feature tree, regeneration (equation resolve → profile extraction → content-addressed BRep cache → kernel → cumulative bodies), the additive/finishing features, datums, the hole wizard, equations, and multi-body/combine. Engineer audience; include the cache and naming footguns.

**Ep 8 — Inside the Kernel (technical)**
> A deep technical conversation about the Rust/OCCT geometry kernel: the JSON-RPC-over-TCP process model and supervisor, each operation's OpenCASCADE calls, tessellation, persistent naming (schema version, body-scoping), the surface-classification FFI that feeds the mate solver, and export. Engineer audience; keep the build footguns and the IGES-not-wired caveat.

**Ep 9 — Content-Addressed VCS (technical)**
> A deep technical conversation about the version-control internals: the SHA-256 content-addressed object store and canonical JSON, the tree serialization, the checkout-lock/check-in working-copy protocol, branches and protected main, the structural and 3D diff, and the deliberate no-auto-merge / feature-level reconcile design. Engineer audience; include the release-ordering footgun.

**Ep 10 — Freeze + Release (technical)**
> A deep technical conversation about freezing geometry and releasing revisions: storing BReps + a mesh snapshot on the release commit so checkout needs zero kernel calls, the declarative per-branch review workflow, the two-tier release (self-service numeric onto main, approval-gated production letter tagging the same frozen commit), and the three distinct locks. Engineer audience.

**Ep 11 — Assemblies + the Mate Solver (technical)**
> A deep technical conversation centered on the 3D mate solver: the assembly document, the regeneration pipeline, and the Levenberg-Marquardt solver in detail — the global twist parameterization, the numerically-differentiated Jacobian, the eight mate types and their residuals, and how rank gives under/fully/over-constrained. Then patterns/mirror/subassemblies, visualization, interference, mass properties, and BOM. Engineer audience; keep the mirror-export approximation honest.

**Ep 12 — Architecture: Written Once (technical)**
> A reflective technical deep-dive and series finale on the architecture: the binding/factory pattern that lets CAD and assemblies share one version-control and editor stack written once, the document-agnostic machinery, the data model, the API/permission surface, the hard-won lessons and footguns, and an honest reflection on when "write it once" pays off versus premature abstraction. Engineer audience.
