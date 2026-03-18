
# Plan: Versioning & CI/CD for Public/Private Repo Split

## Context

The project has been split into a public repo (`akl47/letwinventory-public`) and a private repo (`akl47/letwinventory-private`). The goals are:

1. **Private versioning**: `MAJOR.MINOR.PATCH.PRIVATE` — the 4th segment auto-increments on every PR merge to private master. When public changes are synced, the 4th segment resets to `.0`.
2. **Public repo syncs to private**: When a PR merges to public master (after version bump), automatically push that to private master and reset the private segment.
3. **Deploy moves to private**: The Docker build + VPS deploy workflow moves to the private repo since that's what runs in production.

## Current Flow (public repo only)

```
PR merged → version-bump.yml (bump + tag v1.4.0) → deploy.yml (docker build + VPS deploy)
```

## New Flow

```
PUBLIC:  PR merged → version-bump.yml (bump 1.4.0 → 1.5.0, tag) → sync-to-private.yml (push to private, reset .0)
PRIVATE: PR merged → private-version-bump.yml (1.5.0.0 → 1.5.0.1, tag) → deploy.yml (docker build + VPS deploy)
PRIVATE: Receives sync from public → private-version-bump.yml (set 1.5.0.0, tag) → deploy.yml
```

## Changes to Public Repo (`letwinventory-public`)

### Remove: `deploy.yml`
Delete entirely — deploy moves to private repo.

### Modify: `version-bump.yml`
Keep as-is (bumps `MAJOR.MINOR.PATCH`, commits, tags). No changes needed.

### New: `.github/workflows/sync-to-private.yml`
Triggers after version-bump creates a tag (`push: tags: v*`), or can trigger on push to master.

**Logic:**
1. Checkout public repo
2. Push master branch to private repo remote
3. Trigger the private repo's version reset workflow via `repository_dispatch` or just let the private repo detect the sync

**Simplest approach:** Trigger on push to master (which includes the version bump commit). Push master to private remote using a deploy key or PAT.

```yaml
name: Sync to Private
on:
  push:
    branches: [master]
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Push to private repo
        run: |
          git remote add private https://x-access-token:${{ secrets.PRIVATE_REPO_PAT }}@github.com/akl47/letwinventory-private.git
          git push private master --force
```

### Keep unchanged: `ci.yml`, `require-version-label.yml`, `requirements-check.yml`

## New Files for Private Repo (`letwinventory-private`)

### `.github/workflows/deploy.yml` (moved from public)
Same as current public `deploy.yml` but triggers on private repo tags. Update VPS deploy step to pull from private repo path:

```yaml
script: |
  cd ~/src/letwinventory-private
  git pull origin master
  ./scripts/deploy-update.sh
```

### `.github/workflows/private-version-bump.yml`
Triggers on push to master (catches both PR merges and syncs from public).

**Logic:**
1. Read current version from `frontend/package.json`
2. Read incoming public version (3-segment) from the just-pushed code
3. Compare base versions (first 3 segments):
   - **If base changed** (public sync): Set version to `NEW_BASE.0` (e.g., `1.5.0.0`)
   - **If base same** (private PR merge): Increment 4th segment (e.g., `1.5.0.1` → `1.5.0.2`)
4. Update `frontend/package.json` and `frontend/src/environments/version.ts`
5. Commit, tag `v{VERSION}`, push → triggers deploy

**Version detection approach:**
- Store the "base public version" in a file (e.g., `frontend/.public-version` containing `1.5.0`)
- On push to master, compare `frontend/package.json` version's first 3 segments against `.public-version`
- If they differ → public sync happened → reset to `X.Y.Z.0`, update `.public-version`
- If same → private change → increment 4th segment

### `.github/workflows/ci.yml` (copy from public)
Same CI workflow for PRs to private master. Copy as-is.

## Files Summary

### Public repo — modify/create:
| File | Action |
|------|--------|
| `.github/workflows/deploy.yml` | **Delete** |
| `.github/workflows/sync-to-private.yml` | **Create** |
| `.github/workflows/version-bump.yml` | No change |
| `.github/workflows/ci.yml` | No change |
| `.github/workflows/require-version-label.yml` | No change |
| `.github/workflows/requirements-check.yml` | No change |

### Private repo — create:
| File | Action |
|------|--------|
| `.github/workflows/deploy.yml` | **Create** (moved from public, updated VPS path) |
| `.github/workflows/private-version-bump.yml` | **Create** |
| `.github/workflows/ci.yml` | **Create** (copy from public) |
| `frontend/.public-version` | **Create** (contains `1.4.0`) |

## Secret Requirements

### Public repo needs:
- `PRIVATE_REPO_PAT` — GitHub PAT with `repo` scope for pushing to private repo

### Private repo needs (copy from public):
- `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` — Docker Hub credentials
- `VPS_HOST`, `VPS_SSH_PORT`, `VPS_USER`, `VPS_SSH_KEY` — VPS deploy access
- `PAT_VERSION_BUMP` — PAT for bypassing branch protection on private repo

## VPS Changes

The deploy script on VPS (`scripts/deploy-update.sh`) references `cd ~/src/letwinventory-public`. The private repo's deploy step will `cd ~/src/letwinventory-private` instead, but the deploy script itself doesn't need to change (it uses `$SCRIPT_DIR/..` for relative paths).

On the VPS, clone the private repo:
```bash
cd ~/src
git clone git@github.com:akl47/letwinventory-private.git
```

## Verification

1. Merge a PR to public master → version bumps (e.g., `1.4.1`) → sync pushes to private master → private sets `1.4.1.0` → deploy triggers
2. Merge a PR to private master → private bumps `1.4.1.0` → `1.4.1.1` → deploy triggers
3. Merge another private PR → `1.4.1.1` → `1.4.1.2` → deploy triggers
4. Next public merge → `1.5.0` → sync → private resets to `1.5.0.0` → deploy triggers
5. Docker tags show 4-segment versions: `akl47/letwinventory:1.4.1.1`
