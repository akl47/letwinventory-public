# Tool Outline Generator

## Context

The shop uses CNC routing to create custom foam/wood tool holders. This requires vector outlines (SVG/DXF) of each tool's silhouette. Currently, tools are photographed on a 222x310mm LED backlight plate, and a standalone HTML file (`tool_outline/tool_outline.html`) processes the photo using OpenCV.js to detect tool edges and generate exportable outlines.

This feature integrates that standalone app into the main Angular application as a new "Tools" navigation group, using Angular Material theming for visual consistency. The processing logic remains entirely client-side — no backend API or database changes are needed.

## Requirements

| REQ ID | Name | Description |
|--------|------|-------------|
| 174 | Tools Navigation Group | Sidebar rail + flyout + route for /tools/outline |
| 175 | Image Upload | Drag-and-drop + click-to-browse file picker |
| 176 | OpenCV.js Loading | Dynamic WASM loading with status indicators |
| 177 | Processing Pipeline | Full 15-step image processing pipeline |
| 178 | Controls Panel | Scale method, smoothing, sliders, toggles |
| 179 | Interactive Preview | Canvas preview with overlays, zoom, pan |
| 180 | Centerline Editing | Draggable control points, SVG/DXF regeneration |
| 181 | Per-Part SVG/DXF Output | Part cards, downloads, bulk export |
| 182 | Pipeline Debug Steps | Collapsible panel with 8 intermediate canvases |
| 183 | Info Bar | Processing stats display |

## API Contracts

None — this feature is entirely client-side. No backend endpoints are created or modified.

## UI Design

### Navigation
- **Rail**: New "Tools" group item with `construction` icon between Design and Admin groups
- **Flyout**: Single child "Tool Outline" with `straighten` icon

### Tool Outline Page Layout
Uses Angular Material components for theming consistency:
- **Mat-Card** for upload zone, controls, preview, parts output, and pipeline steps
- **Mat-Select** for scale method and threshold method dropdowns
- **Mat-Slider** for all slider controls
- **Mat-Slide-Toggle** for Fill Reflections and Center Lines toggles
- **Mat-Button** for Generate Outlines, Download All SVG/DXF, and per-part SVG/DXF buttons
- **Mat-Progress-Spinner** for OpenCV loading and processing states
- **Mat-Expansion-Panel** for the Pipeline Steps debug section

### States
- **Initial**: Upload zone + controls visible, sliders hidden, results hidden
- **OpenCV Loading**: Status banner with spinner
- **OpenCV Ready**: Status banner turns green
- **Processing**: Full-screen overlay with spinner + status text
- **Results**: Preview card + parts cards + info bar visible, sliders shown

## Database Changes

None.

## Test Scenarios

### Frontend (Vitest/Karma)
1. Component creates successfully
2. OpenCV status signal updates correctly (loading → ready → error)
3. "Generate Outlines" button disabled when OpenCV not ready or no file selected
4. File selection via drag-and-drop updates state
5. Scale method change updates visible input fields
6. Slider value changes update display labels

### Navigation
1. "Tools" group appears in sidebar for authenticated users
2. Clicking "Tools" opens flyout with "Tool Outline" link
3. Navigating to `/tools/outline` loads the component
4. Route is protected by `authGuard`

## Implementation Notes

### Files to Create
- `frontend/src/app/components/tools/tool-outline/tool-outline.ts` — main component
- `frontend/src/app/components/tools/tool-outline/tool-outline.html` — template
- `frontend/src/app/components/tools/tool-outline/tool-outline.css` — styles
- `frontend/src/app/components/tools/tool-outline/tool-outline.spec.ts` — tests

### Files to Modify
- `frontend/src/app/app.routes.ts` — add `/tools/outline` route
- `frontend/src/app/components/common/nav/nav.component.ts` — add `'tools'` to `NavGroup` type, add prefixes and access signal
- `frontend/src/app/components/common/nav/nav.component.html` — add Tools rail item and flyout section

### Architecture Decisions
- **Single component**: The original app is a single HTML file with tightly coupled state. Porting to Angular as a single standalone component (rather than splitting into sub-components) keeps the processing pipeline logic intact and minimizes refactoring risk.
- **OpenCV.js loaded dynamically**: Script tag injected in `ngOnInit`, cleaned up in `ngOnDestroy`. Uses `NgZone.runOutsideAngular()` for the heavy WASM processing to avoid unnecessary change detection.
- **JSZip loaded dynamically**: Same pattern as OpenCV — loaded on demand via script injection.
- **Canvas rendering**: The preview canvas and pipeline step canvases use native Canvas API (not Angular template binding). This matches the original approach and is necessary for OpenCV's `cv.imshow()`.
- **No permissions**: Since this is an internal tool with no data sensitivity, it uses `authGuard` only (all authenticated users can access it). No new permission resource is added.

### Existing Patterns to Follow
- Standalone component with `ChangeDetectionStrategy.OnPush`
- Lazy-loaded route via `loadComponent`
- Angular signals for reactive state
- Angular Material components for UI consistency
