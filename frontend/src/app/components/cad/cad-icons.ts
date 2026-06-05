/**
 * Custom CAD-tool icon library. Each entry is a complete SVG body
 * (no outer <svg> wrapper — the wrapper is added by the registration
 * helper) keyed by a stable `cad-*` name. Icons depict the geometry
 * the tool creates wherever possible (SolidWorks / Onshape style),
 * rather than abstract Material symbols.
 *
 * Style conventions:
 *   - viewBox 0 0 24 24
 *   - stroke="currentColor" → inherits text color so selected /
 *     disabled states from the toolbar buttons take effect
 *   - stroke-width 1.6, round caps + joins for a friendly feel
 *   - fill="none" by default; fill="currentColor" only for solid bits
 *     (dots, arrow heads, dimension text)
 *   - keep everything inside the 24×24 box with ~2px padding so the
 *     icon doesn't crash into the button's edge
 *
 * To register them: call `registerCadIcons(iconRegistry, sanitizer)`
 * exactly once at app / component init. Then reference an icon as
 * `<mat-icon svgIcon="cad-line"></mat-icon>` (NOT the ligature form).
 */

import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';

// ─── shared SVG fragments ────────────────────────────────────────────────

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">';
const SVG_CLOSE = '</svg>';

/** A small filled dot — used everywhere geometry icons need a vertex
 * marker (line endpoints, arc centers, sketch points). */
function dot(cx: number, cy: number, r = 1.6): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;
}

// ─── icon body definitions ───────────────────────────────────────────────
//
// Each value is the INNER svg markup (everything between <svg> and
// </svg>). registerCadIcons wraps it in the standard svg shell.

// A bold minus in the top-right corner — the "subtract" badge that turns a
// boss feature icon into its Cut variant.
const MINUS = '<line x1="15" y1="4" x2="22" y2="4" stroke-width="2.4"/>';
// Boss-feature bodies, reused (with MINUS appended) for the Cut variants.
const EXTRUDE = `<rect x="7" y="13" width="10" height="7"/><line x1="7" y1="13" x2="7" y2="6"/><line x1="17" y1="13" x2="17" y2="6"/><polyline points="9,9 12,6 15,9"/>`;
const REVOLVE = `<line x1="5" y1="3" x2="5" y2="21" stroke-dasharray="3 2"/><path d="M9 6 A 8 8 0 0 1 9 18"/><polyline points="7,16 9,18 11,16"/><rect x="9" y="10" width="4" height="4"/>`;
const SWEEP = `<path d="M4 19 C 9 9, 15 15, 20 5"/><polyline points="16,5 20,5 19,8"/><rect x="3.5" y="16" width="5" height="4"/>`;

const ICONS: Record<string, string> = {
  // ─── 3D feature tools ──────────────────────────────────────────────────
  'cad-extrude': EXTRUDE,
  'cad-cut-extrude': EXTRUDE + MINUS,
  'cad-revolve': REVOLVE,
  'cad-cut-revolve': REVOLVE + MINUS,
  'cad-sweep': SWEEP,
  'cad-cut-sweep': SWEEP + MINUS,
  // Loft: blend between two unlike profiles.
  'cad-loft': `<ellipse cx="8" cy="17" rx="4" ry="1.7"/><rect x="9.5" y="5" width="7" height="4"/><line x1="4" y1="17" x2="9.5" y2="7"/><line x1="12" y1="17" x2="16.5" y2="5"/>`,
  // Hole: counterbored hole (concentric circles).
  'cad-hole': `<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3.2"/>`,
  // Shell: hollowed box (outer + inner wall, open top).
  'cad-shell': `<rect x="4" y="6" width="16" height="14"/><polyline points="7,6 7,17 17,17 17,6"/>`,
  // Combine: two overlapping solids fused (boolean).
  'cad-combine': `<rect x="3.5" y="8" width="10" height="10"/><circle cx="15" cy="13" r="5"/>`,
  // New sketch: a pencil drawing on a plane.
  'cad-new-sketch': `<path d="M3 9 L 13 9 L 17 17 L 7 17 Z"/><line x1="9" y1="11" x2="17" y2="3"/><polyline points="15,3 17,3 17,5"/>`,

  // ─── datums ─────────────────────────────────────────────────────────────
  'cad-datum-plane': `<path d="M4 8 L 16 8 L 20 16 L 8 16 Z"/>`,
  'cad-datum-axis': `<line x1="4" y1="20" x2="20" y2="4" stroke-dasharray="6 2 1 2"/>`,
  'cad-datum-point': `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>${dot(12, 12, 2.4)}`,

  // ─── inspect / parametric ───────────────────────────────────────────────
  // Measure: a ruler with tick marks.
  'cad-measure': `<rect x="3" y="13" width="18" height="5"/><line x1="6" y1="13" x2="6" y2="16"/><line x1="9" y1="13" x2="9" y2="15"/><line x1="12" y1="13" x2="12" y2="16"/><line x1="15" y1="13" x2="15" y2="15"/><line x1="18" y1="13" x2="18" y2="16"/>`,
  // Equations: an italic "fx".
  'cad-equations': `<text x="11" y="16" fill="currentColor" stroke="none" font-size="13" text-anchor="middle" font-family="serif" font-style="italic">fx</text>`,

  // ─── version control / file ─────────────────────────────────────────────
  // Checkout: open padlock.
  'cad-checkout': `<rect x="5" y="11" width="13" height="9" rx="1.5"/><path d="M8.5 11 V 8 A 3.2 3.2 0 0 1 14.5 6.2"/>`,
  // Locked (held by another): closed padlock.
  'cad-lock': `<rect x="5.5" y="11" width="13" height="9" rx="1.5"/><path d="M8.5 11 V 8 A 3.5 3.5 0 0 1 15.5 8 V 11"/>`,
  // Check in (commit): a commit node on a branch line.
  'cad-checkin': `<line x1="12" y1="3" x2="12" y2="21"/>${dot(12, 12, 3)}`,
  // History: a clock.
  'cad-history': `<circle cx="12" cy="12" r="8"/><polyline points="12,7 12,12 16,14"/>`,
  // Branch: a fork off the main line.
  'cad-branch': `<line x1="7" y1="4" x2="7" y2="20"/>${dot(7, 4, 2.2)}${dot(7, 20, 2.2)}<path d="M7 8 C 13 8, 17 9, 17 13"/>${dot(17, 15, 2.2)}`,
  // Cherry-pick: pull a single commit forward.
  'cad-cherry-pick': `${dot(6, 12, 2.6)}<line x1="9" y1="12" x2="18" y2="12"/><polyline points="15,9 18,12 15,15"/>`,
  // Compare (diff): two panels with − / +.
  'cad-compare': `<rect x="3" y="5" width="7" height="14"/><rect x="14" y="5" width="7" height="14"/><line x1="5" y1="9" x2="8" y2="9"/><line x1="16" y1="9" x2="19" y2="9"/><line x1="17.5" y1="7.5" x2="17.5" y2="10.5"/>`,
  // Release: a tag.
  'cad-release': `<path d="M3 11 L 11 3 L 21 3 L 21 13 L 13 21 Z"/>${dot(17, 7, 1.6)}`,
  // Workflow: submit (up), approve (check), reject (x), reopen (undo).
  'cad-submit': `<line x1="12" y1="20" x2="12" y2="6"/><polyline points="7,11 12,6 17,11"/>`,
  'cad-approve': `<polyline points="5,13 10,18 19,6"/>`,
  'cad-reject': `<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>`,
  'cad-reopen': `<path d="M6 10 H 14 A 5 5 0 0 1 14 20 H 9"/><polyline points="9,7 6,10 9,13"/>`,


  // ─── selection / construction ──────────────────────────────────────────
  'cad-select': `<path d="M5 4 L 5 18 L 9.5 14.5 L 12 19.5 L 14 18.5 L 11.5 13.5 L 17 13.5 Z" fill="currentColor" stroke="none"/>`,
  'cad-construction': `<line x1="3" y1="12" x2="21" y2="12" stroke-dasharray="3 2"/>`,

  // ─── primitives ────────────────────────────────────────────────────────
  'cad-point': dot(12, 12, 2.8),
  'cad-line': `<line x1="4" y1="20" x2="20" y2="4"/>${dot(4, 20)}${dot(20, 4)}`,
  'cad-centerline': `<line x1="4" y1="20" x2="20" y2="4" stroke-dasharray="3 2"/>`,
  'cad-midpoint-line': `<line x1="3" y1="12" x2="21" y2="12"/>${dot(3, 12)}${dot(21, 12)}${dot(12, 12, 2.2)}`,
  'cad-spline': `<path d="M4 19 C 8 4, 16 20, 20 5"/>`,
  'cad-style-spline': `<path d="M4 19 C 8 4, 16 20, 20 5"/>${dot(4, 19, 1.4)}${dot(20, 5, 1.4)}<line x1="4" y1="19" x2="10" y2="6" stroke-dasharray="2 2"/><line x1="14" y1="18" x2="20" y2="5" stroke-dasharray="2 2"/>`,

  // ─── circles / arcs / ellipses ─────────────────────────────────────────
  'cad-circle': `<circle cx="12" cy="12" r="8"/>${dot(12, 12, 1.2)}`,
  'cad-circle-perimeter': `<circle cx="12" cy="12" r="8"/>${dot(6, 9)}${dot(18, 15)}`,
  'cad-arc': `<path d="M4 17 A 9 9 0 0 1 20 17"/>${dot(12, 17, 1.4)}${dot(4, 17)}${dot(20, 17)}`,
  'cad-circle-3pt': `<circle cx="12" cy="12" r="8"/>${dot(12, 4)}${dot(5, 16)}${dot(19, 16)}`,
  'cad-arc-3pt': `<path d="M4 17 A 9 9 0 0 1 20 17"/>${dot(4, 17)}${dot(12, 8)}${dot(20, 17)}`,
  'cad-tangent-arc': `<line x1="2" y1="18" x2="10" y2="18"/><path d="M10 18 A 7 7 0 0 1 17 11"/>${dot(10, 18)}${dot(17, 11)}`,
  'cad-ellipse': `<ellipse cx="12" cy="12" rx="9" ry="5"/>${dot(12, 12, 1.2)}`,
  'cad-partial-ellipse': `<path d="M3 12 A 9 5 0 0 1 21 12"/>${dot(3, 12)}${dot(21, 12)}${dot(12, 12, 1.2)}`,

  // ─── composite shapes ──────────────────────────────────────────────────
  'cad-rect-corner': `<rect x="4" y="6" width="16" height="12"/>${dot(4, 18, 2)}`,
  'cad-rect-center': `<rect x="4" y="6" width="16" height="12"/>${dot(12, 12, 1.8)}`,
  // Rounded-corner variants — rect with rx/ry to hint the fillet, plus
  // the corresponding anchor dot (corner for the corner variant, center
  // for the center variant).
  'cad-rect-rounded-corner': `<rect x="4" y="6" width="16" height="12" rx="3" ry="3"/>${dot(4, 18, 2)}`,
  'cad-rect-rounded-center': `<rect x="4" y="6" width="16" height="12" rx="3" ry="3"/>${dot(12, 12, 1.8)}`,
  'cad-rect-3pt-corner': `<path d="M3 16 L 9 4 L 21 10 L 15 22 Z"/>${dot(3, 16, 2)}${dot(9, 4, 2)}`,
  'cad-rect-3pt-center': `<path d="M3 16 L 9 4 L 21 10 L 15 22 Z"/>${dot(12, 13, 1.8)}`,
  'cad-parallelogram': `<path d="M3 19 L 9 5 L 21 5 L 15 19 Z"/>`,
  'cad-polygon': `<path d="M12 3 L 20.66 8 L 20.66 16 L 12 21 L 3.34 16 L 3.34 8 Z"/>`,
  // Slot = pill: two horizontal lines + semicircular caps.
  'cad-slot': `<path d="M7 9 L 17 9 A 3 3 0 0 1 17 15 L 7 15 A 3 3 0 0 1 7 9 Z"/>`,
  'cad-slot-centerpoint': `<path d="M7 9 L 17 9 A 3 3 0 0 1 17 15 L 7 15 A 3 3 0 0 1 7 9 Z"/>${dot(12, 12, 1.6)}`,
  // Arc slot = curved pill (two concentric arcs + cap arcs at each end).
  'cad-slot-arc-3pt': `<path d="M5 19 A 11 11 0 0 1 19 19"/><path d="M9 19 A 7 7 0 0 1 15 19"/><path d="M5 19 A 2 2 0 0 1 9 19"/><path d="M15 19 A 2 2 0 0 1 19 19"/>`,
  'cad-slot-arc-centerpoint': `<path d="M5 19 A 11 11 0 0 1 19 19"/><path d="M9 19 A 7 7 0 0 1 15 19"/><path d="M5 19 A 2 2 0 0 1 9 19"/><path d="M15 19 A 2 2 0 0 1 19 19"/>${dot(12, 19, 1.6)}`,

  // ─── edit / modify ─────────────────────────────────────────────────────
  // Trim: line with a scissor-style break.
  'cad-trim': `<line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="9" y1="15" x2="15" y2="9"/>`,
  // Extend: line with an arrowhead at one end pointing into a boundary.
  'cad-extend': `<line x1="3" y1="12" x2="17" y2="12"/><polyline points="14,9 17,12 14,15"/><line x1="20" y1="6" x2="20" y2="18" stroke-dasharray="2 2"/>`,
  // Fillet: two lines meeting at a quarter-circle.
  'cad-fillet': `<path d="M3 19 L 3 13 A 6 6 0 0 1 9 7 L 21 7"/>`,
  // Chamfer: two lines connected by a diagonal cut.
  'cad-chamfer': `<path d="M3 19 L 3 11 L 11 3 L 21 3"/>`,
  // Split: line with a vertical break tick.
  'cad-split': `<line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/><line x1="11" y1="6" x2="13" y2="18"/>`,
  // Jog: Z-shape.
  'cad-jog': `<polyline points="3,17 9,17 12,7 15,7"/><polyline points="15,7 21,7"/>`,
  // Offset: two parallel curves.
  'cad-offset': `<path d="M4 19 C 8 4, 16 4, 20 19"/><path d="M2 21 C 6 6, 18 6, 22 21"/>`,
  // Mirror: shape + dashed axis + mirror copy.
  'cad-mirror': `<path d="M3 6 L 3 18 L 9 12 Z"/><line x1="12" y1="3" x2="12" y2="21" stroke-dasharray="3 2"/><path d="M21 6 L 21 18 L 15 12 Z"/>`,
  // Dynamic mirror: mirror + an arrow indicating "live".
  'cad-dynamic-mirror': `<path d="M3 6 L 3 18 L 9 12 Z"/><line x1="12" y1="3" x2="12" y2="21" stroke-dasharray="3 2"/><path d="M21 6 L 21 18 L 15 12 Z"/><polyline points="13,5 14,4 13,3"/>`,
  // Convert entities: arrow projecting one shape onto another plane.
  'cad-convert': `<rect x="3" y="14" width="8" height="6"/><line x1="11" y1="14" x2="17" y2="8"/><polyline points="15,7 17,8 16,10"/><line x1="14" y1="4" x2="20" y2="4" stroke-dasharray="2 2"/>`,

  // ─── transforms ────────────────────────────────────────────────────────
  // Move: 4-direction arrow cross.
  'cad-move': `<line x1="12" y1="3" x2="12" y2="21"/><line x1="3" y1="12" x2="21" y2="12"/><polyline points="9,6 12,3 15,6"/><polyline points="9,18 12,21 15,18"/><polyline points="6,9 3,12 6,15"/><polyline points="18,9 21,12 18,15"/>`,
  // Copy: two stacked rectangles.
  'cad-copy': `<rect x="7" y="7" width="11" height="11"/><rect x="3" y="3" width="11" height="11" fill="none"/>`,
  // Rotate: circular arrow.
  'cad-rotate': `<path d="M5 12 A 7 7 0 1 1 12 19"/><polyline points="9,17 12,19 14,16"/>`,
  // Scale: small shape inside larger one with arrows.
  'cad-scale': `<rect x="3" y="3" width="18" height="18"/><rect x="8" y="8" width="8" height="8"/><polyline points="5,8 5,5 8,5"/><polyline points="16,5 19,5 19,8"/>`,
  // Stretch: horizontal line with arrows pulling both ends apart.
  'cad-stretch': `<line x1="6" y1="12" x2="18" y2="12"/><polyline points="3,9 0.5,12 3,15" transform="translate(3 0)"/><polyline points="21,9 23.5,12 21,15" transform="translate(-3 0)"/>`,
  // Linear pattern: 3 small squares in a row.
  'cad-pattern-linear': `<rect x="2" y="9" width="5" height="6"/><rect x="9.5" y="9" width="5" height="6"/><rect x="17" y="9" width="5" height="6"/>`,
  // Circular pattern: 4 small squares around a center.
  'cad-pattern-circular': `<rect x="10" y="2" width="4" height="4"/><rect x="18" y="10" width="4" height="4"/><rect x="10" y="18" width="4" height="4"/><rect x="2" y="10" width="4" height="4"/>${dot(12, 12, 1.2)}`,

  // ─── smart dimension ───────────────────────────────────────────────────
  // Dimension line with arrows + extension ticks, label "D" above.
  'cad-smart-dim': `<line x1="3" y1="15" x2="3" y2="20"/><line x1="21" y1="15" x2="21" y2="20"/><line x1="3" y1="18" x2="21" y2="18"/><polyline points="6,15 3,18 6,21"/><polyline points="18,15 21,18 18,21"/><text x="12" y="11" fill="currentColor" stroke="none" font-size="9" text-anchor="middle" font-family="serif" font-style="italic">D</text>`,

  // ─── miscellaneous CAD ribbon buttons ──────────────────────────────────
  // Break Link: chain link with a break through it.
  'cad-break-link': `<path d="M7 12 A 4 4 0 0 1 11 8 L 13 8"/><path d="M17 12 A 4 4 0 0 1 13 16 L 11 16"/><line x1="3" y1="3" x2="21" y2="21" stroke-width="2"/>`,

  // ─── geometric constraints ─────────────────────────────────────────────
  'cad-fixed': `<rect x="9" y="10" width="6" height="9" rx="1"/><line x1="12" y1="10" x2="12" y2="6"/><circle cx="12" cy="4.5" r="2"/>`,
  // Coincident: two overlapping circles.
  'cad-coincident': `<circle cx="10" cy="12" r="6"/><circle cx="14" cy="12" r="6"/>`,
  // Horizontal: short bold horizontal line.
  'cad-horizontal': `<line x1="4" y1="12" x2="20" y2="12" stroke-width="2.4"/>`,
  // Vertical: short bold vertical line.
  'cad-vertical': `<line x1="12" y1="4" x2="12" y2="20" stroke-width="2.4"/>`,
  // Perpendicular: T shape.
  'cad-perpendicular': `<line x1="4" y1="20" x2="20" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>`,
  // Parallel: two parallel slashes.
  'cad-parallel': `<line x1="7" y1="4" x2="7" y2="20"/><line x1="14" y1="4" x2="14" y2="20"/>`,
  // Tangent: circle touching a line.
  'cad-tangent': `<line x1="3" y1="18" x2="21" y2="18"/><circle cx="12" cy="12" r="6"/>`,
  // Equal: =
  'cad-equal': `<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/>`,
  // Midpoint: line with a center dot.
  'cad-midpoint': `<line x1="3" y1="12" x2="21" y2="12"/>${dot(12, 12, 2.4)}`,
  // Symmetric: triangle reflected across a vertical dashed axis.
  'cad-symmetric': `<path d="M3 6 L 3 18 L 10 12 Z"/><path d="M21 6 L 21 18 L 14 12 Z"/><line x1="12" y1="3" x2="12" y2="21" stroke-dasharray="3 2"/>`,
  // Concentric: nested circles.
  'cad-concentric': `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/>`,
  // Coradial: nested + center dot + equality vibe.
  'cad-coradial': `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12" stroke-dasharray="2 2"/>${dot(12, 12, 1.4)}`,
  // Collinear: three dots on a line.
  'cad-collinear': `<line x1="3" y1="12" x2="21" y2="12"/>${dot(4, 12)}${dot(12, 12)}${dot(20, 12)}`,
  // Merge Points: two dots merging via an arrow.
  'cad-merge-points': `${dot(5, 12, 2.4)}${dot(19, 12, 2.4)}<line x1="8" y1="12" x2="16" y2="12" stroke-dasharray="2 2"/><polyline points="13,10 16,12 13,14"/>`,

  // ─── dimensional constraints ───────────────────────────────────────────
  // Radius: R with radial arrow.
  'cad-radius': `<path d="M3 18 A 14 14 0 0 1 17 4"/><line x1="3" y1="18" x2="13" y2="11"/><polyline points="11,9 13,11 11,13"/><text x="18" y="18" fill="currentColor" stroke="none" font-size="9" font-family="serif" font-style="italic">R</text>`,
  // Diameter: ⌀ slashed circle.
  'cad-diameter': `<circle cx="12" cy="12" r="8"/><line x1="6" y1="18" x2="18" y2="6"/>`,
  // Angle: angle arc between two lines.
  'cad-angle': `<line x1="4" y1="20" x2="20" y2="20"/><line x1="4" y1="20" x2="18" y2="6"/><path d="M14 20 A 10 10 0 0 0 11.2 13"/>`,
  // Horizontal distance: horizontal dim with arrows.
  'cad-horizontal-distance': `<line x1="3" y1="6" x2="3" y2="18"/><line x1="21" y1="6" x2="21" y2="18"/><line x1="3" y1="12" x2="21" y2="12"/><polyline points="6,9 3,12 6,15"/><polyline points="18,9 21,12 18,15"/>`,
  // Vertical distance.
  'cad-vertical-distance': `<line x1="6" y1="3" x2="18" y2="3"/><line x1="6" y1="21" x2="18" y2="21"/><line x1="12" y1="3" x2="12" y2="21"/><polyline points="9,6 12,3 15,6"/><polyline points="9,18 12,21 15,18"/>`,
  // Equal X: two points stacked vertically (same x).
  'cad-equal-x': `<line x1="12" y1="3" x2="12" y2="21" stroke-dasharray="2 2"/>${dot(12, 7, 2.4)}${dot(12, 17, 2.4)}`,
  // Equal Y: two points across (same y).
  'cad-equal-y': `<line x1="3" y1="12" x2="21" y2="12" stroke-dasharray="2 2"/>${dot(7, 12, 2.4)}${dot(17, 12, 2.4)}`,
  // Point-line distance: dot + perp dotted line down to a horizontal.
  'cad-point-line-distance': `<line x1="3" y1="18" x2="21" y2="18"/>${dot(12, 6, 2.4)}<line x1="12" y1="8" x2="12" y2="16" stroke-dasharray="2 2"/><polyline points="9,9 12,6 15,9"/><polyline points="9,15 12,18 15,15"/>`,
  // Arc length: arc with curved arrow along it.
  'cad-arc-length': `<path d="M4 18 A 9 9 0 0 1 20 18"/><polyline points="17,15 20,18 17,21"/>`,
  // Chord distance: arc with a straight chord highlighted.
  'cad-chord-distance': `<path d="M4 18 A 9 9 0 0 1 20 18"/><line x1="4" y1="18" x2="20" y2="18" stroke-dasharray="2 2"/>${dot(4, 18, 1.6)}${dot(20, 18, 1.6)}`,
};

/** Idempotent — safe to call multiple times. Tracks registration so
 * a second call is a cheap no-op (avoids hitting the icon registry's
 * internal cache repeatedly during HMR / test setup). */
let registered = false;

export function registerCadIcons(iconRegistry: MatIconRegistry, sanitizer: DomSanitizer): void {
  if (registered) return;
  for (const [name, body] of Object.entries(ICONS)) {
    iconRegistry.addSvgIconLiteral(name, sanitizer.bypassSecurityTrustHtml(SVG_OPEN + body + SVG_CLOSE));
  }
  registered = true;
}

/** Names of every registered CAD icon — exported for tests that want
 * to verify the spec arrays only reference real icons. */
export const CAD_ICON_NAMES: readonly string[] = Object.keys(ICONS);
