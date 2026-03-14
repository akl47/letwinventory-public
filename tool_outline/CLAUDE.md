# Tool Outline Generator

## Project Overview
Single-file browser app (`tool_outline.html`) that processes photos of tools placed on a 222×310mm LED backlight plate and generates per-part SVG and DXF vector outlines for CNC routing. Runs entirely client-side using OpenCV.js.

## Tech Stack
- **Frontend:** Single HTML file with inline CSS/JS
- **Computer Vision:** OpenCV.js (WASM, loaded from CDN)
- **ZIP Export:** JSZip (CDN)
- **No build step** — open `tool_outline.html` directly in a browser

## Architecture
The app is a single `tool_outline.html` file containing all HTML, CSS, and JavaScript. The main processing happens in `runPipeline()` which runs a 15-step image processing pipeline:

1. Grayscale → blur → plate detection → threshold (adaptive/otsu/manual)
2. Morphological cleanup → hole filling → contour detection + filtering
3. Douglas-Peucker simplification → margin expansion → minimum radius enforcement
4. Centerline computation → interactive preview with zoom/pan/drag editing
5. Per-part rotated SVG/DXF generation with individual download buttons

## Key Conventions
- All measurements in mm (converted from pixels via plate-based scale calibration)
- Default plate size: 222mm × 310mm (scale method: "Plate Size")
- Contour points are `[[x,y], ...]` arrays in pixel coordinates
- Bezier rendering uses Catmull-Rom interpolation with clamped control points
- Sharp corners (angle < 140°) are preserved as straight line segments
- Min radius uses iterative geometric approach (up to 20 passes, reduce-to-fit)
- Export rotation aligns centerline to vertical Y-axis

## Preview Color Coding
- **Red:** Plate outline
- **Green:** Raw detected tool edges (greenPaths)
- **Purple:** Output contours with margin/radius (bluePaths)
- **Cyan:** Centerlines + draggable control points
- **Yellow dots:** Smooth bezier vertices
- **Red dots:** Sharp corner vertices
- **Cyan dots:** Bezier control points
- **Perpendicular lines at control points:** Red (longer side), Purple (shorter side), Green (equal within 5%)

## Testing
1. Open `tool_outline.html` in a browser (Chrome recommended for best OpenCV.js support)
2. Upload a photo of tools on the LED backlight plate
3. Adjust sliders and re-click "Generate Outlines" to reprocess
4. Drag cyan centerline control points to adjust centerlines
5. Download individual part SVGs/DXFs or bulk export
6. Verify scale accuracy using the 25mm scale indicator in the preview corner
