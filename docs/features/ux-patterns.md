# Feature: UX Patterns

## Context
This spec documents cross-cutting UX patterns shared across the application. These include consistent list view behavior (search, sort, pagination, URL persistence), sidebar navigation, error notifications, keyboard shortcuts, barcode preview/print independence, and middle-click support for power users. These patterns ensure a consistent user experience across all feature areas.

## Requirements

### Requirements Coverage

| DB ID | Description | Status |
|-------|-------------|--------|
| 87 | List views: search/sort/pagination/URL sync | Met |
| 88 | Collapsible sidebar, auto-collapse on mobile | Met |
| 89 | Error notifications via Material snackbar | Met |
| 90 | Harness editor keyboard shortcuts | Met |
| 26 | Independent barcode preview and print sizes | Met |
| 66 | Middle-click opens in new tab | Met |
| 152 | Sidebar navigation structure | Met |

### List View Pattern (Req #87)
Applied to 6 list views: Parts, Orders, Equipment, Harness, Projects, Scheduled Tasks.

Each list view supports:
- **Search:** filters across relevant fields with debounce
- **Sorting:** clickable column headers, ascending/descending toggle
- **Pagination:** configurable page size, page navigation
- **URL query parameter persistence:** all filter/sort/page state synced to URL
  - Parameters: `search`, `inactive`, `sort`, `dir`, `page`, `pageSize`
  - View-specific: `statuses` (orders), `categories` (parts)
- **"Show Inactive" toggle:** includes soft-deleted items

### Sidebar Navigation (Req #88)
- Rail-style navigation with icon + label
- Flyout panels for grouped items
- Collapsible: `width: 0; min-width: 0; overflow: hidden` when collapsed
- Auto-collapse on mobile (`window.innerWidth <= 768`)
- Toggle button always accessible
- Navigation groups:
  - Planning: Tasks, Projects, Scheduled Tasks
  - Inventory: Inventory, Parts, Equipment
  - Orders: Orders
  - Harness: Wire Harnesses
  - Design: Requirements
  - Admin: User Groups, User Permissions (conditional on `admin.read`)
  - Settings, Mobile Scanner

### Error Notifications (Req #89)
- `ErrorNotificationService` wrapping Material snackbar
- Methods: error (red), success (green), warning (yellow)
- Auto-dismiss with configurable duration
- Consistent across all API error handling

### Keyboard Shortcuts (Req #90)
Harness editor shortcuts:
| Key | Action |
|-----|--------|
| V | Select tool |
| H | Pan tool |
| C | Copy selected |
| Ctrl+V | Paste |
| Delete | Delete selected |
| Arrow keys | Nudge selected |
| Ctrl+Z | Undo |
| Ctrl+Y / Ctrl+Shift+Z | Redo |

Task board shortcuts:
| Key | Action |
|-----|--------|
| 1-9 | Assign project by keyboard shortcut (on hover) |
| 0 | Clear project (on hover) |
| C | Toggle task complete (on hover) |

### Middle-Click (Req #66)
- `(auxclick)` handler on table rows (button === 1)
- `(mousedown)` handler prevents default scroll behavior
- Opens item edit/detail page in new tab via `window.open()`
- Applied to: Parts, Orders, Harness list views

## API Contracts

No dedicated API endpoints — UX patterns are frontend-only, consuming existing APIs.

## UI Design

### List View Template
All list views follow this structure:
```
┌──────────────────────────────────────────┐
│ [Title]                    [+ Create]    │
│ ┌──────────────────────────────────────┐ │
│ │ Search: [__________]  Filters: [...] │ │
│ │ □ Show Inactive                      │ │
│ └──────────────────────────────────────┘ │
│ ┌──────────────────────────────────────┐ │
│ │ Col1 ↕ │ Col2 ↕ │ Col3 ↕ │ Actions │ │
│ ├────────┼────────┼────────┼──────────┤ │
│ │ data   │ data   │ data   │ [...]    │ │
│ │ data   │ data   │ data   │ [...]    │ │
│ └──────────────────────────────────────┘ │
│ ◄ 1 2 3 ... ►  [10 ▼] per page         │
└──────────────────────────────────────────┘
```

### Sidebar Template
```
┌──┬─────────────────────────┐
│  │                         │
│🏠│     Main Content        │
│📋│                         │
│📦│                         │
│🛒│                         │
│🔌│                         │
│📐│                         │
│⚙️│                         │
│  │                         │
└──┴─────────────────────────┘
```

### Snackbar Notifications
- Position: bottom-center
- Duration: 3-5 seconds (configurable)
- Types: error (red), success (green), warning (yellow)
- Dismiss: auto or manual click

## Database Changes

No dedicated database tables — UX patterns are frontend-only.

## Test Scenarios

### Frontend (Karma)

**List View Tests (per list view):**
- `parts-table-view.spec.ts` — search, category filter, type filter, inactive toggle, pagination, sorting, URL sync, middle-click
- `orders-list-view.spec.ts` — status filter, search, pagination, sorting, URL sync, middle-click
- `equipment-table-view.spec.ts` — loading, filtering, pagination, sorting
- `harness-list-view.spec.ts` — search, sorting, pagination, middle-click
- `projects-list-view.spec.ts` — search, sorting, pagination
- `scheduled-tasks-list-view.spec.ts` — search, cron translation, pagination

**Navigation:**
- `nav.component.spec.ts` — toggleSidenav, collapsed state

**Error Notifications:**
- `error-notification.service.spec.ts` — error, success, warning methods

**Keyboard Shortcuts:**
- `harness-toolbar.spec.ts` — tool selection via setTool
- `harness-page.spec.ts` — onToolChanged, canvas tool change request
- `task-card.spec.ts` — keyboard shortcut project assignment, toggle complete

### E2E (Playwright)
- `frontend/e2e/navigation.spec.ts` — sidebar navigation, route access

## Implementation Notes

### Key Files
- `frontend/src/app/components/common/nav/nav.component.ts` — sidebar navigation
- `frontend/src/app/services/error-notification.service.ts` — snackbar notifications
- `frontend/src/app/services/auth.service.ts` — `hasPermission()` for conditional nav items

### Patterns Followed
- URL query parameter synchronization via Angular Router `queryParams`
- Search with page reset (search change resets to page 1)
- Computed total count respects active filters
- `getTotalCount()` method on each list view accounts for all filters
- `tagColorHex` stored without `#` — frontend adds `#` for display
- Contrast text color computed from background hex for readability
- `(auxclick)` + `(mousedown)` for middle-click (not `(click)`)
- Cookie-based view defaults via `TaskViewPreferencesService` (tasks only)

### Edge Cases
- URL sync must handle initial load from URL params (restore state)
- Pagination resets to page 1 on search or filter change
- Middle-click uses `window.open()` with hash routing URL format
- Sidebar auto-collapse checks `window.innerWidth` on init only (no resize listener)
- Snackbar may overlap with bottom navigation on mobile
- Admin nav group conditionally rendered via `hasAdminAccess()` signal
