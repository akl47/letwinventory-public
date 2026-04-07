# Draft Requirements

## Context

Design requirements currently have a binary approval state (approved/unapproved). This makes it difficult to distinguish between requirements that are actively being drafted and those that are ready for review but not yet approved. Adding a "draft" state allows users to work on requirements without them cluttering the default view or blocking CI checks.

## State Machine

```
draft --[Submit]--> unapproved --[Approve]--> approved
                   unapproved <--[Unapprove]-- approved
                   unapproved <--[Edit auto-reset]-- approved
```

- New requirements default to `draft`
- Draft → Unapproved: explicit "Submit for Review" action (requires `requirements.write`)
- Unapproved → Approved: existing "Approve" action (requires `requirements.approve`)
- Approved → Unapproved: "Unapprove" or auto-reset when requirement is edited
- No path from Unapproved back to Draft (one-way out of draft)
- Only `approved` requirements can be marked as implemented

## Requirements

1. **Three-state approval status** — Replace boolean `approved` with `approvalStatus` enum: `'draft'` | `'unapproved'` | `'approved'`
2. **Default to draft** — New requirements created via API or CLI default to `draft`
3. **Submit action** — Explicit endpoint `PUT /:id/submit` transitions draft → unapproved
4. **Approve guard** — Approve endpoint rejects draft requirements (must be unapproved first)
5. **Draft hidden by default** — Requirements list excludes draft from default status filter
6. **CI ignores drafts** — `req.js check` only fails on unapproved requirements, not drafts
7. **Edit auto-reset unchanged** — Editing an approved requirement resets to unapproved (not draft)
8. **Migration** — Existing `approved=true` → `'approved'`, `approved=false` → `'unapproved'`

## API Contracts

### New Endpoint

**PUT /api/design/requirement/:id/submit**
- Permission: `requirements.write`
- Validates: `approvalStatus === 'draft'`
- Sets: `approvalStatus: 'unapproved'`
- Records history: changeType `'submitted'`, changes `{ approvalStatus: { from: 'draft', to: 'unapproved' } }`
- Error 400 if not in draft status

### Modified Endpoints

**PUT /api/design/requirement/:id/approve**
- Added guard: rejects if `approvalStatus !== 'unapproved'` (was unrestricted)

**PUT /api/design/requirement/:id/unapprove**
- Added guard: rejects if `approvalStatus !== 'approved'` (was unrestricted)

**POST /api/design/requirement/** (create)
- Default `approvalStatus: 'draft'` (was `approved: false`)

**PUT /api/design/requirement/:id** (update)
- Auto-reset: `approved` → `unapproved` (was `true` → `false`)

### Response Shape Change

All requirement responses: `approved: boolean` field replaced by `approvalStatus: string`

## UI Design

### Requirements List View
- New "Draft" option in status filter menu (icon: `edit_note`)
- Draft excluded from default selected statuses
- Draft requirements show `edit_note` icon, unapproved show `pending`, approved show `check_circle`

### Requirement Edit Page
- Header buttons: three-state — draft shows "Submit for Review", unapproved shows "Approve", approved shows "Unapprove"
- Approval banner: draft shows "Draft — Not yet submitted for review" with neutral styling
- Save button text unchanged (only shows "Save and Reset Status" for approved requirements)

## Database Changes

### Migration: `20260406000000-add-draft-approval-status.js`
1. Add `approvalStatus` STRING(20) NOT NULL DEFAULT 'draft'
2. Migrate: `approved=true` → `'approved'`, `approved=false` → `'unapproved'`
3. Remove `approved` column

## CLI Changes

- `req.js list` — shows `approvalStatus` column
- `req.js check` — only fails on `unapproved`, reports draft count
- `req.js submit <id>` — new command to submit draft for review
- `req.js tree` — uses `approvalStatus` field

## Test Scenarios

### Backend
- New requirement defaults to `approvalStatus: 'draft'`
- Submit transitions draft → unapproved
- Submit rejects non-draft requirements
- Approve rejects draft requirements (must submit first)
- Approve works on unapproved requirements
- Unapprove rejects non-approved requirements
- Edit auto-resets approved → unapproved
- Implement rejects non-approved requirements

### Frontend
- Draft requirements hidden by default in list
- Selecting "Draft" filter shows draft requirements
- Draft edit page shows "Submit for Review" button
- Unapproved edit page shows "Approve" button
- Approved edit page shows "Unapprove" button

## Implementation Notes

### Files to Create
- `backend/migrations/20260406000000-add-draft-approval-status.js`

### Files to Modify
- `backend/models/design/designRequirement.js`
- `backend/api/design/requirement/controller.js`
- `backend/api/design/requirement/routes.js`
- `scripts/req.js`
- `frontend/src/app/models/design-requirement.model.ts`
- `frontend/src/app/services/design-requirement.service.ts`
- `frontend/src/app/components/design/requirements-list-view/requirements-list-view.ts`
- `frontend/src/app/components/design/requirements-list-view/requirements-list-view.html`
- `frontend/src/app/components/design/requirement-edit-page/requirement-edit-page.ts`
- `frontend/src/app/components/design/requirement-edit-page/requirement-edit-page.html`
- `frontend/src/app/components/design/requirement-edit-page/requirement-edit-page.css`
- Various spec files
