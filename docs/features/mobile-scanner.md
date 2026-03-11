# Feature: Mobile Scanner

## Context
The mobile scanner provides a camera-based barcode scanning interface for warehouse operations. It uses the BarcodeDetector API (Chrome) with a full-screen camera feed and supports four actions: Move (scan item then destination), Merge (scan target then source), Split (enter quantity), and Trash (optional partial quantity). The scanner follows a state machine pattern through scanning, loading, display, and action states.

## Requirements

### Requirements Coverage

| DB ID | Description | Status |
|-------|-------------|--------|
| 81 | Mobile camera-based barcode scanner | Met |
| 82 | Move action (scan item, scan destination) | Met |
| 83 | Merge action (scan target, scan source) | Met |
| 84 | Split action with quantity input | Met |
| 85 | Trash action with optional partial quantity | Met |
| 86 | Back button for navigation | Met |

### State Machine (Req #81)
- States: scanning → loading → display → action states
- `scanning`: camera active, detecting barcodes
- `loading`: barcode detected, fetching tag data
- `display`: item info shown, action buttons available
- `scanning_second`: two-scan actions (move, merge) awaiting second barcode
- `confirming_action`: single-scan actions (split, trash) awaiting confirmation

### Two-Scan Actions (Req #82, Req #83)
- **Move:** scan source item → display → "Move" → scan destination location → confirm → execute
- **Merge:** scan target trace → display → "Merge" → scan source trace → confirm → execute (validates same part)

### Single-Scan Actions (Req #84, Req #85)
- **Split:** scan trace → display → "Split" → enter quantity → confirm → execute
- **Trash:** scan trace → display → "Trash" → optionally enter quantity → toggle "Trash All" → confirm → execute

## API Contracts

The mobile scanner uses existing barcode and inventory APIs:
- `GET /api/inventory/barcode/lookup/:barcode` — resolve scanned barcode
- `GET /api/inventory/barcode/tag/:id` — get item details
- `GET /api/inventory/barcode/tag/chain/:id` — get location chain
- `POST /api/inventory/barcode/move/:id` — execute move
- `POST /api/inventory/trace/merge/:barcodeId` — execute merge
- `POST /api/inventory/trace/split/:barcodeId` — execute split
- `DELETE /api/inventory/trace/barcode/:barcodeId` — execute trash

## UI Design

### Mobile Scanner Page (`/mobile`)
- **Full-screen camera feed** with BarcodeDetector API
- **Back button:** circular semi-transparent (arrow_back icon), top-left, z-index 10
- **Type badge:** colored badge showing barcode type (LOC, BOX, AKL, EQP)
- **Item info display:** name, description, quantity (for traces), location chain
- **Action buttons:** Move, Merge, Split, Trash (shown for traces)
- **Second scan prompt:** instruction text for two-scan actions
- **Quantity input:** for split and partial trash
- **Trash All toggle:** sets quantity to full tag quantity
- **Confirmation:** displays action summary before execution
- **Error/success feedback:** inline status messages

### Layout
- Mobile-optimized (designed for phone use in warehouse)
- Camera takes full viewport
- UI overlays on camera feed
- Protected by `authGuard` + `permissionGuard` (requires `inventory` resource)

## Database Changes

No dedicated database tables — uses existing Barcode, Trace, BarcodeHistory tables.

## Test Scenarios

### Backend (Jest)
No dedicated backend tests — uses existing barcode/trace API tests.

### Frontend (Karma)
- `frontend/src/app/components/mobile/mobile-scanner/mobile-scanner.spec.ts` — initial state, isTrace computed, locationChain reversal, state transitions (startMove, startMerge, startSplit, startTrash), toggleTrashAll, cancel actions, scanAgain/tryAgain reset, goBack, getTypeBadgeClass, BarcodeDetector absence handling, ngOnDestroy

### E2E (Playwright)
- `frontend/e2e/mobile.spec.ts` — mobile scanner flows

## Implementation Notes

### Key Files
- `frontend/src/app/components/mobile/mobile-scanner/mobile-scanner.ts` — scanner component with state machine
- `frontend/src/app/services/inventory.service.ts` — barcode lookup, move, split, merge, delete APIs

### Patterns Followed
- State machine pattern for multi-step workflows
- BarcodeDetector API (Chrome-specific, no polyfill)
- `Location.back()` for navigation
- Reuses barcode movement dialog logic for action execution
- Camera stream stopped on component destroy

### Edge Cases
- BarcodeDetector API not available in all browsers — graceful handling
- Self-move prevention (cannot move to own location)
- Merge validates same partID between source and target
- Split quantity must be positive and less than current quantity
- Trash confirmation requires typing barcode string (full delete) or entering quantity (partial)
