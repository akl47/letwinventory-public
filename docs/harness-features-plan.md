# Implementation Plan: Harness Sub-Assemblies & Revision Control

## Overview

Two features for the wire harness system:
1. **Sub-Assemblies**: Reference-based child harnesses with collapsed/expanded view
2. **Revision Control**: Draft → Review → Released workflow with immutable releases

---

## Feature 1: Harness Sub-Assemblies

### Database Changes

**New migration**: `backend/migrations/YYYYMMDD-create-harness-sub-assemblies.js`

```sql
CREATE TABLE HarnessSubAssemblies (
  id              INTEGER PRIMARY KEY AUTO_INCREMENT,
  parentHarnessID INTEGER NOT NULL REFERENCES WireHarnesses(id) ON DELETE CASCADE,
  childHarnessID  INTEGER NOT NULL REFERENCES WireHarnesses(id) ON DELETE RESTRICT,
  instanceId      STRING(50) NOT NULL,
  activeFlag      BOOLEAN DEFAULT true,
  createdAt, updatedAt,
  UNIQUE(parentHarnessID, instanceId)
);
```

### Backend Files

**Create**: `backend/models/parts/HarnessSubAssembly.js`
- Junction model with belongsTo Parent and Child

**Modify**: `backend/models/parts/WireHarness.js`
- Add hasMany SubAssemblies and UsedByParents associations

**Modify**: `backend/api/parts/harness/routes.js`
```
GET  /:id/sub-assemblies     - Get child harness data for rendering
GET  /:id/parents            - Get harnesses using this as sub-assembly
POST /:id/sub-assembly       - Add sub-assembly reference
DELETE /:id/sub-assembly/:instanceId - Remove sub-assembly
POST /extract-sub-assembly   - Create sub-assembly from selected elements
```

**Modify**: `backend/api/parts/harness/controller.js`
- Implement above endpoints
- Add cycle detection (prevent A containing A or ancestors)
- Update delete to prevent deleting harnesses used as sub-assemblies

### Frontend Files

**Modify**: `frontend/src/app/models/harness.model.ts`
```typescript
interface HarnessSubAssemblyRef {
  id: string;                    // Instance ID
  childHarnessId: number;        // DB ID of child harness
  label: string;
  position: { x: number; y: number };
  rotation?: 0 | 90 | 180 | 270;
  expanded: boolean;             // Collapsed vs expanded view
  pinMappings: { subAssemblyPinId: string; externalPinId: string }[];
}

// Add to HarnessData:
subAssemblies: HarnessSubAssemblyRef[];
```

**Modify**: `frontend/src/app/services/harness.service.ts`
- Add getSubAssemblyData(), getParentHarnesses(), addSubAssembly(), removeSubAssembly(), extractToSubAssembly()

**Create**: `frontend/src/app/utils/harness/elements/sub-assembly.ts`
- drawSubAssembly() - collapsed box or expanded internal structure
- getSubAssemblyPinPositions() - for wire connections
- hitTestSubAssembly(), hitTestSubAssemblyPin()

**Modify**: `frontend/src/app/components/harness/harness-canvas/harness-canvas.ts`
- Add subAssemblyData input for expanded rendering
- Include sub-assemblies in render loop and zIndex sorting
- Add expand/collapse toggle, pin connections

**Create**: `frontend/src/app/components/harness/harness-select-dialog/`
- Dialog to select harness to add as sub-assembly

**Create**: `frontend/src/app/components/harness/extract-sub-assembly-dialog/`
- Dialog to name and confirm extraction

---

## Feature 2: Revision Control & Release Cycle

### Database Changes

**New migration**: `backend/migrations/YYYYMMDD-add-harness-release-state.js`

```sql
ALTER TABLE WireHarnesses
ADD COLUMN releaseState ENUM('draft', 'review', 'released') DEFAULT 'draft',
ADD COLUMN releasedAt TIMESTAMP NULL,
ADD COLUMN releasedBy STRING(100) NULL,
ADD COLUMN previousRevisionID INTEGER NULL REFERENCES WireHarnesses(id);
```

**New migration**: `backend/migrations/YYYYMMDD-create-harness-revision-history.js`

```sql
CREATE TABLE HarnessRevisionHistory (
  id              INTEGER PRIMARY KEY AUTO_INCREMENT,
  harnessID       INTEGER NOT NULL REFERENCES WireHarnesses(id) ON DELETE CASCADE,
  revision        STRING(10) NOT NULL,
  releaseState    STRING(20) NOT NULL,
  changedBy       STRING(100),
  changeType      STRING(50) NOT NULL,  -- 'created', 'submitted_review', 'rejected', 'released', 'new_revision'
  changeNotes     TEXT,
  snapshotData    JSONB,
  createdAt       TIMESTAMP
);
```

### Backend Files

**Create**: `backend/models/parts/HarnessRevisionHistory.js`

**Modify**: `backend/models/parts/WireHarness.js`
- Add releaseState, releasedAt, releasedBy, previousRevisionID fields
- Add self-referential PreviousRevision/NextRevisions associations

**Modify**: `backend/api/parts/harness/routes.js`
```
POST /:id/submit-review  - Draft → Review
POST /:id/reject         - Review → Draft (with notes)
POST /:id/release        - Review → Released
GET  /:id/history        - Get revision history
GET  /:id/revisions      - Get all revisions (A, B, C...)
POST /:id/revert/:historyId - Revert to snapshot
```

**Modify**: `backend/api/parts/harness/controller.js`
- Implement state transition endpoints
- **updateHarness**: If released, auto-create new revision (A→B), copy data, set previousRevisionID
- Log all changes to HarnessRevisionHistory with snapshots

### Frontend Files

**Modify**: `frontend/src/app/models/harness.model.ts`
```typescript
type ReleaseState = 'draft' | 'review' | 'released';

// Add to WireHarness:
releaseState: ReleaseState;
releasedAt: string | null;
releasedBy: string | null;
previousRevisionID: number | null;
```

**Modify**: `frontend/src/app/services/harness.service.ts`
- Add submitForReview(), rejectToEdit(), releaseHarness()
- Add getRevisionHistory(), getAllRevisions(), revertToSnapshot()

**Modify**: `frontend/src/app/components/harness/harness-page/harness-page.ts`
- Add releaseState tracking
- Disable editing when released
- Show "edit creates new revision" dialog when editing released
- Add workflow buttons per state

**Modify**: `frontend/src/app/components/harness/harness-toolbar/harness-toolbar.ts`
- Add release state badge (Draft/Review/Released)
- Add workflow action buttons
- Add History button

**Create**: `frontend/src/app/components/harness/harness-history-dialog/`
- Timeline of changes
- Links to all revisions
- Revert to snapshot option

---

## Implementation Order

1. **Revision Control DB** - Migrations for releaseState and history
2. **Revision Control Backend** - Models and state transition APIs
3. **Revision Control Frontend** - Service, toolbar state, basic UI
4. **Revision Control UI** - Dialogs, history panel, edit-released flow
5. **Sub-Assembly DB** - Migration for junction table
6. **Sub-Assembly Backend** - Models and APIs
7. **Sub-Assembly Frontend** - Service, model updates
8. **Sub-Assembly Canvas** - Collapsed rendering, hit testing
9. **Sub-Assembly Features** - Expanded view, extract workflow, dialogs

---

## Verification

### Sub-Assemblies
1. Create harness A with connectors/wires
2. Add harness A as sub-assembly to harness B - verify collapsed view
3. Toggle expanded - verify internal structure renders
4. Connect parent elements to sub-assembly pins
5. Edit child A - verify parent B reflects changes
6. Extract selection to new sub-assembly
7. Verify cannot delete harness used as sub-assembly
8. Verify cannot create circular reference

### Revision Control
1. New harness defaults to 'draft'
2. Submit for review - state changes to 'review'
3. Reject - returns to 'draft' with notes in history
4. Submit + release - state is 'released', timestamps set
5. Attempt edit on released - new revision created (A→B)
6. View history - all state changes logged
7. Revert to snapshot - data restored