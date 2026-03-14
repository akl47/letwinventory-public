---
name: tool_outline_app_structure
description: Tool Outline Generator - browser app using OpenCV.js to detect tools on LED backlight plate and generate SVG/DXF outlines for CNC routing
type: project
---

## Tool Outline Generator (tool_outline.html)

Single-file browser app that processes photos of tools on a 222×310mm backlit LED plate into per-part SVG/DXF vector outlines. Runs entirely in the browser.

**Stack:** HTML/CSS/JS + OpenCV.js (WASM) + JSZip (CDN)

### Pipeline (runPipeline) — 15 steps
1. Load image → grayscale
2. Gaussian blur (blurSlider)
3. Rough Otsu → morph close → `detectPlate()` to find bright rectangular plate
4. Threshold: Adaptive (default) / Otsu / Combined / Manual — plate-local ROI re-threshold
5. Morph close/open (closeSlider, openSlider)
6. Fill holes (optional, fillHolesCheck) — inverts binary, fills enclosed dark regions
7. Find contours (RETR_CCOMP), filter by area + plate mask + hierarchy
8. Scale computation via `computeScale()` — default: plate reference 222×310mm
9. Douglas-Peucker simplification → greenPaths (raw detected edges)
10. Margin dilation → re-find contours → bluePaths (expanded outlines)
11. `applyMinRadius()` iteratively on bluePaths — ext radius (convex) + int radius (concave) with reduce-to-fit
12. `computeCenterLine()` — principal axis via second-order moments, cp1/cp2 at 1/3 and 2/3
13. Draw preview: red=plate, green=edges, purple=output, yellow/red dots=vertices, cyan=centerlines+control points, yellow/red/purple/green=perpendicular lines at control points
14. Per-part rotated SVG + DXF generation (centerline aligned to vertical)
15. Build part cards with rename, individual SVG/DXF download buttons

### Key Functions
- `detectPlate(binary, w, h)` → {contour, rect, dims} or null
- `applyMinRadius(pts, extRadius, intRadius)` → {pts, arcs} — iterative (up to 20 passes), reduce-to-fit
- `applyMinRadiusPass()` — single pass of corner rounding with concavity detection via signed area + cross product
- `hasRadiusViolations()` — checks if any corners violate min radii
- `douglasPeucker(pts, epsilonFactor)` → simplified points via cv.approxPolyDP
- `drawBezierOnCanvas(ctx, pts)` / `pointsToBezierPath(pts)` → Catmull-Rom with clamped control points (clampCP) + sharp corner detection (CORNER_ANGLE_THRESHOLD=140°)
- `computeScale(plateInfo, method, value, plateHeightMm)` → mm/px
- `computeCenterLine(pts)` → {cp1x, cp1y, cp2x, cp2y, x1, y1, x2, y2}
- `extendLineToPart(cp1x, cp1y, cp2x, cp2y, pts)` → line-polygon intersection for full-length centerline
- `perpLineAtPoint(px, py, dirX, dirY, contourPts)` → perpendicular cross-section at control point
- `drawCenterLinesOverlay()` — draws centerlines, control points, perp lines, scale indicator; uses cachedPreviewData for fast redraw during drag
- `buildPartCardHtml()` — per-part card with editable name, dimensions, SVG/DXF buttons
- `generateDxf(polylinePoints, centerLine)` → DXF string with LWPOLYLINE + optional LINE on CENTERLINE layer
- `rotatePoints(pts, angle)` / `rotateLine(cl, angle)` — rotation for vertical centerline export
- `contourToPolylineMm(pts, mmPerPx, offsetX, offsetY)` → direct mm conversion (no bezier sampling)

### Interactive Features
- **Centerline editing:** drag cyan control points → line extends to contour boundary, perpendicular cross-sections shown, SVG/DXF regenerated on release
- **Zoom:** scroll wheel (0.1x–5x), Fit/1:1/+/- toolbar buttons
- **Pan:** middle-click drag, container scrollbars
- **Part rename:** inline editable text field on each part card, used for download filenames

### Export
- **SVG:** per-part, rotated (centerline vertical), bezier curves, centerline as red dashed line
- **DXF:** per-part, rotated (centerline vertical), LWPOLYLINE on layer 0, LINE on CENTERLINE layer, mm units
- **Bulk:** "Download All SVG" / "Download All DXF" buttons (DXF uses JSZip for multi-file ZIP)

### UI Controls
- Scale: method dropdown (Plate Size default, DPI, Manual), plate width (222mm), plate height (310mm)
- Threshold: method (Adaptive/Otsu/Combined), manual slider, block size (53), sensitivity C (8)
- Morphology: blur (5), close (2), open (1)
- Output: margin (mm), ext radius (mm), int radius (mm), min area (0.1%), smoothing (0.0008)
- Toggles: fill holes (on), center lines (on)
- Debug: collapsible pipeline steps panel with 8 intermediate canvases
- Preview toolbar: zoom controls, usage hints

**Why:** Understanding the full app structure speeds up future modifications and debugging.
**How to apply:** Reference when modifying pipeline stages, adding features, or debugging image processing issues.
