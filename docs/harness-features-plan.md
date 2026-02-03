# Implementation Plan: Harness Sub-Assemblies & Revision Control

## Overview

Three features for the wire harness system:
1. **Sub-Harnesses**: Insert existing harnesses as referenced components (stored in harnessData JSON, no new DB table)
2. **Connector Mating Points**: Each pin has two connection points - wire side and mating side for direct connector-to-connector connections
3. **Revision Control**: Draft → Review → Released workflow with immutable releases (requires DB migrations)

---

## Feature 1: Harness Sub-Assemblies

### Approach

Sub-harness references are stored in the `harnessData` JSON field (like connectors, cables, components). No new database table needed.

- Each sub-harness reference contains a `harnessId` pointing to an existing harness in the WireHarnesses table
- Multiple instances of the same harness can be inserted (each with unique instance ID)
- When rendering, the referenced harness data is fetched and drawn at the specified position
- Editing the child harness automatically reflects in all parents (it's a reference, not a copy)

### Database Changes

**None** - sub-harness references are stored in `harnessData.subHarnesses[]`

### Backend Files

**Modify**: `backend/api/parts/harness/controller.js`
- **validateHarness**: Validate that referenced harnessIds exist
- **validateHarness**: Add cycle detection (prevent A containing B if B contains A)
- **deleteHarness**: Check if harness is referenced as sub-harness in any other harness's harnessData

**Modify**: `backend/api/parts/harness/routes.js`
```
GET /sub-harness-data?ids=1,2,3  - Batch fetch harness data for rendering sub-harnesses
```

### Frontend Files

**Modify**: `frontend/src/app/models/harness.model.ts`
```typescript
interface SubHarnessRef {
  id: string;                    // Instance ID (unique within parent, e.g., 'sub-1')
  harnessId: number;             // DB ID of the referenced harness
  position: { x: number; y: number };
  rotation?: 0 | 90 | 180 | 270;
  flipped?: boolean;
  zIndex?: number;
  expanded: boolean;             // Collapsed box vs expanded internal view
}

// Add to HarnessData:
subHarnesses: SubHarnessRef[];
```

**Modify**: `frontend/src/app/services/harness.service.ts`
- Add `getSubHarnessData(ids: number[]): Observable<WireHarness[]>` - batch fetch referenced harnesses

**Create**: `frontend/src/app/utils/harness/elements/sub-harness.ts`
- `drawSubHarnessCollapsed()` - labeled box showing harness name, exposed connector pins on edges
- `drawSubHarnessExpanded()` - render child's connectors/wires at offset position
- `getSubHarnessPinPositions()` - for wire connections to sub-harness pins
- `hitTestSubHarness()`, `hitTestSubHarnessPin()`

**Modify**: `frontend/src/app/components/harness/harness-canvas/harness-canvas.ts`
- Load sub-harness data on init (fetch referenced harnesses)
- Include sub-harnesses in render loop and zIndex sorting
- Handle expand/collapse toggle (double-click or button)
- Handle wire connections to sub-harness pins
- Handle drag to reposition

**Modify**: `frontend/src/app/components/harness/harness-page/harness-page.ts`
- Add "Insert Sub-Harness" toolbar button
- Open harness selection dialog

**Create**: `frontend/src/app/components/harness/harness-select-dialog/`
- Dialog to browse/search harnesses
- Filter out current harness and any that would create cycles
- Returns selected harness ID

---

## Feature 2: Connector Mating Points

### Concept

Each connector pin has two connection points:
1. **Wire Point** (existing) - where wires attach, on the "back" side of the connector
2. **Mating Point** (new) - on the "front" side, for direct connector-to-connector mating

This models real-world connector behavior where:
- A male connector plugs into a female connector
- Corresponding pins on each connector become electrically connected
- No explicit wire is drawn between mated connectors - the connection is implicit

### Database Changes

**None** - mating connections are stored in `harnessData.connections[]` with a new connection type

### Backend Files

**Modify**: `backend/api/parts/harness/controller.js`
- **validateHarness**: Validate mating connections (both endpoints must be mating points, pin counts must match or be explicitly mapped)

### Frontend Files

**Modify**: `frontend/src/app/models/harness.model.ts`
```typescript
// Update HarnessConnection to support mating connections:
interface HarnessConnection {
  // ... existing fields ...

  // Connection type (new field)
  connectionType?: 'wire' | 'mating';  // Defaults to 'wire' for backward compatibility

  // For mating connections, both endpoints use mating points:
  // fromConnector + fromPin (mating point) → toConnector + toPin (mating point)
}

// Update HarnessConnector to track mating state:
interface HarnessConnector {
  // ... existing fields ...

  matedTo?: string;  // ID of connector this one is mated to (derived from connections, not stored)
}
```

**Modify**: `frontend/src/app/utils/harness/elements/connector.ts`
- `getConnectorPinPosition()` - add `side: 'wire' | 'mating'` parameter
- `drawConnector()` - render mating points on opposite side from wire points
- `hitTestConnectorPin()` - return which side was hit (wire or mating)

**Modify**: `frontend/src/app/utils/harness/wire.ts`
- Handle mating connections differently from wire connections
- Mating connections draw as a short "docked" indicator rather than a wire path
- Or optionally: draw no line, just show connectors positioned together

**Modify**: `frontend/src/app/components/harness/harness-canvas/harness-canvas.ts`
- When dragging from a mating point, only allow connection to another mating point
- When connectors are mated, optionally snap them together visually
- Show mating indicator (e.g., bracket or highlight) when connectors are mated

**Modify**: `frontend/src/app/components/harness/harness-property-panel/harness-property-panel.ts`
- When connector is selected, show "Mated to: [connector name]" if mated
- Show list of pin-to-pin mappings for the mating connection
- Allow creating/removing mating connections from the panel

### Visual Design

**Wire Points** (existing):
- Small circles on back/wire side of connector
- Connect via wire paths with waypoints

**Mating Points** (new):
- Small squares or diamonds on front/mating side of connector
- When mated, show visual indicator:
  - Option A: Draw bracket/bridge between mated connectors
  - Option B: Highlight both connectors with matching color
  - Option C: Show small "plug" icon between them

**Mated Connector Behavior**:
- Mated connectors can be moved independently or as a group
- Optional: "Dock" mode that snaps mated connectors together

---

## Feature 3: Revision Control & Release Cycle

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

### Phase 1: Sub-Harnesses (no DB changes)
1. **Frontend Model** - Add SubHarnessRef interface and subHarnesses to HarnessData
2. **Backend Validation** - Add cycle detection and reference validation to validateHarness
3. **Backend Endpoint** - Add batch fetch endpoint for sub-harness data
4. **Canvas Rendering** - Collapsed view with exposed pins
5. **Canvas Interaction** - Drag, expand/collapse, wire connections
6. **Selection Dialog** - Browse and select harness to insert

### Phase 2: Connector Mating Points (no DB changes)
1. **Frontend Model** - Update HarnessConnection with connectionType field
2. **Connector Rendering** - Add mating point rendering to connector drawing
3. **Hit Testing** - Update hit testing to distinguish wire vs mating points
4. **Connection Handling** - Create mating connections when dragging from mating point
5. **Visual Indicators** - Show mated connector state (bracket/highlight)
6. **Property Panel** - Display and manage mating connections

### Phase 3: Revision Control (DB changes)
1. **DB Migrations** - releaseState field and history table
2. **Backend Models** - Update WireHarness, create HarnessRevisionHistory
3. **Backend APIs** - State transition endpoints
4. **Frontend Service** - Add revision control methods
5. **Frontend UI** - Toolbar badges, workflow buttons, history dialog

---

## Verification

### Sub-Harnesses
1. Create harness A with connectors/wires
2. Insert harness A into harness B - verify collapsed box appears with name
3. Insert harness A again - verify second instance with unique ID
4. Drag sub-harness to reposition
5. Toggle expanded - verify internal structure renders at offset
6. Connect wire from parent connector to sub-harness pin
7. Edit child harness A directly - verify changes appear in parent B
8. Try to insert harness B into harness A - verify cycle prevention error
9. Try to delete harness A - verify prevented (used as sub-harness)
10. Remove sub-harness from B - verify A can now be deleted

### Connector Mating Points
1. Create two connectors (male and female) with matching pin counts
2. Hover over connector - verify both wire points and mating points are visible
3. Drag from wire point - verify only wire points highlight as valid targets
4. Drag from mating point - verify only mating points highlight as valid targets
5. Connect mating point to mating point - verify mating connection created
6. Verify visual indicator shows connectors are mated
7. Select mated connector - verify property panel shows mating info
8. Delete mating connection - verify connectors are no longer mated
9. Create wire from wire point while connectors are mated - both connection types coexist

### Revision Control
1. New harness defaults to 'draft'
2. Submit for review - state changes to 'review'
3. Reject - returns to 'draft' with notes in history
4. Submit + release - state is 'released', timestamps set
5. Attempt edit on released - new revision created (A→B)
6. View history - all state changes logged
7. Revert to snapshot - data restored