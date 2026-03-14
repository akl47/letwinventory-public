import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { ToolOutlineComponent } from './tool-outline';

describe('ToolOutlineComponent', () => {
    let component: ToolOutlineComponent;
    let fixture: ComponentFixture<ToolOutlineComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ToolOutlineComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                provideAnimationsAsync(),
                provideRouter([]),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ToolOutlineComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    // ── REQ 176: OpenCV.js Loading ──────────────────────────────────────────

    describe('OpenCV loading (REQ 176)', () => {
        it('should have cvStatus signal starting as loading', () => {
            expect((component as any).cvStatus).toBeDefined();
            expect((component as any).cvStatus()).toBe('loading');
        });

        it('should have cvReady signal starting as false', () => {
            expect((component as any).cvReady).toBeDefined();
            expect((component as any).cvReady()).toBe(false);
        });

        it('should have processDisabled computed that is true when no file or cv not ready', () => {
            expect((component as any).processDisabled).toBeDefined();
            expect((component as any).processDisabled()).toBe(true);
        });
    });

    // ── REQ 175: Image Upload ───────────────────────────────────────────────

    describe('Image upload (REQ 175)', () => {
        it('should have selectedFile signal starting as null', () => {
            expect((component as any).selectedFile).toBeDefined();
            expect((component as any).selectedFile()).toBeNull();
        });

        it('should have selectFile method', () => {
            expect((component as any).selectFile).toBeDefined();
            expect(typeof (component as any).selectFile).toBe('function');
        });

        it('should update selectedFile when selectFile is called', () => {
            const mockFile = new File([''], 'test.jpg', { type: 'image/jpeg' });
            (component as any).selectFile(mockFile);
            expect((component as any).selectedFile()).toBe(mockFile);
        });

        it('should have fileName computed from selectedFile', () => {
            expect((component as any).fileName).toBeDefined();
            const mockFile = new File(['test'], 'photo.jpg', { type: 'image/jpeg' });
            (component as any).selectFile(mockFile);
            expect((component as any).fileName()).toBe('photo.jpg');
        });

        it('should have fileSizeMB computed from selectedFile', () => {
            expect((component as any).fileSizeMB).toBeDefined();
        });
    });

    // ── REQ 178: Controls Panel ─────────────────────────────────────────────

    describe('Controls panel (REQ 178)', () => {
        it('should have scaleMethod signal defaulting to reference', () => {
            expect((component as any).scaleMethod).toBeDefined();
            expect((component as any).scaleMethod()).toBe('reference');
        });

        it('should have scaleValue signal defaulting to 222', () => {
            expect((component as any).scaleValue).toBeDefined();
            expect((component as any).scaleValue()).toBe(222);
        });

        it('should have plateHeight signal defaulting to 310', () => {
            expect((component as any).plateHeight).toBeDefined();
            expect((component as any).plateHeight()).toBe(310);
        });

        it('should have smoothing signal defaulting to 0.0008', () => {
            expect((component as any).smoothing).toBeDefined();
            expect((component as any).smoothing()).toBe(0.0008);
        });

        it('should have blurRadius signal defaulting to 5', () => {
            expect((component as any).blurRadius).toBeDefined();
            expect((component as any).blurRadius()).toBe(5);
        });

        it('should have threshMethod signal defaulting to adaptive', () => {
            expect((component as any).threshMethod).toBeDefined();
            expect((component as any).threshMethod()).toBe('adaptive');
        });

        it('should have showSliders signal starting as false', () => {
            expect((component as any).showSliders).toBeDefined();
            expect((component as any).showSliders()).toBe(false);
        });

        it('should have fillHoles signal defaulting to true', () => {
            expect((component as any).fillHoles).toBeDefined();
            expect((component as any).fillHoles()).toBe(true);
        });

        it('should have centerLines signal defaulting to true', () => {
            expect((component as any).centerLinesEnabled).toBeDefined();
            expect((component as any).centerLinesEnabled()).toBe(true);
        });

        it('should have marginMm signal defaulting to 0', () => {
            expect((component as any).marginMm).toBeDefined();
            expect((component as any).marginMm()).toBe(0);
        });

        it('should have extRadiusMm signal defaulting to 0', () => {
            expect((component as any).extRadiusMm).toBeDefined();
            expect((component as any).extRadiusMm()).toBe(0);
        });

        it('should have intRadiusMm signal defaulting to 0', () => {
            expect((component as any).intRadiusMm).toBeDefined();
            expect((component as any).intRadiusMm()).toBe(0);
        });

        it('should show plateHeight input only when scaleMethod is reference', () => {
            expect((component as any).showPlateHeight).toBeDefined();
            expect((component as any).showPlateHeight()).toBe(true);
            (component as any).scaleMethod.set('dpi');
            expect((component as any).showPlateHeight()).toBe(false);
        });
    });

    // ── REQ 179: Interactive Preview ────────────────────────────────────────

    describe('Preview (REQ 179)', () => {
        it('should have previewZoom signal defaulting to 0.5', () => {
            expect((component as any).previewZoom).toBeDefined();
            expect((component as any).previewZoom()).toBe(0.5);
        });

        it('should have zoomIn method that increases zoom', () => {
            expect((component as any).zoomIn).toBeDefined();
            (component as any).previewZoom.set(1.0);
            (component as any).zoomIn();
            expect((component as any).previewZoom()).toBeGreaterThan(1.0);
        });

        it('should have zoomOut method that decreases zoom', () => {
            expect((component as any).zoomOut).toBeDefined();
            (component as any).previewZoom.set(1.0);
            (component as any).zoomOut();
            expect((component as any).previewZoom()).toBeLessThan(1.0);
        });

        it('should clamp zoom to minimum 0.1', () => {
            (component as any).previewZoom.set(0.1);
            (component as any).zoomOut();
            expect((component as any).previewZoom()).toBeGreaterThanOrEqual(0.1);
        });

        it('should clamp zoom to maximum 5', () => {
            (component as any).previewZoom.set(5);
            (component as any).zoomIn();
            expect((component as any).previewZoom()).toBeLessThanOrEqual(5);
        });

        it('should have zoom100 method that sets zoom to 1', () => {
            (component as any).zoom100();
            expect((component as any).previewZoom()).toBe(1);
        });

        it('should have zoomDisplayText computed', () => {
            expect((component as any).zoomDisplayText).toBeDefined();
            (component as any).previewZoom.set(0.5);
            expect((component as any).zoomDisplayText()).toBe('50%');
        });
    });

    // ── REQ 177: Processing Pipeline ────────────────────────────────────────

    describe('Processing pipeline (REQ 177)', () => {
        it('should have isProcessing signal starting as false', () => {
            expect((component as any).isProcessing).toBeDefined();
            expect((component as any).isProcessing()).toBe(false);
        });

        it('should have processingText signal', () => {
            expect((component as any).processingText).toBeDefined();
        });

        it('should have showResults signal starting as false', () => {
            expect((component as any).showResults).toBeDefined();
            expect((component as any).showResults()).toBe(false);
        });
    });

    // ── REQ 180: Centerline Editing ─────────────────────────────────────────

    describe('Centerline editing (REQ 180)', () => {
        it('should have centerLines array signal', () => {
            expect((component as any).centerLines).toBeDefined();
            expect((component as any).centerLines()).toEqual([]);
        });

        it('should have draggingCL signal starting as null', () => {
            expect((component as any).draggingCL).toBeDefined();
            expect((component as any).draggingCL()).toBeNull();
        });
    });

    // ── REQ 181: Per-Part SVG/DXF Output ────────────────────────────────────

    describe('Part output (REQ 181)', () => {
        it('should have partNames signal as empty array', () => {
            expect((component as any).partNames).toBeDefined();
            expect((component as any).partNames()).toEqual([]);
        });

        it('should have partSvgs signal as empty array', () => {
            expect((component as any).partSvgs).toBeDefined();
            expect((component as any).partSvgs()).toEqual([]);
        });

        it('should have dxfParts signal as empty array', () => {
            expect((component as any).dxfParts).toBeDefined();
            expect((component as any).dxfParts()).toEqual([]);
        });
    });

    // ── REQ 182: Pipeline Debug Steps ───────────────────────────────────────

    describe('Pipeline debug steps (REQ 182)', () => {
        it('should have stepsExpanded signal starting as false', () => {
            expect((component as any).stepsExpanded).toBeDefined();
            expect((component as any).stepsExpanded()).toBe(false);
        });
    });

    // ── REQ 183: Info Bar ───────────────────────────────────────────────────

    describe('Info bar (REQ 183)', () => {
        it('should have infoBarData signal starting as null', () => {
            expect((component as any).infoBarData).toBeDefined();
            expect((component as any).infoBarData()).toBeNull();
        });
    });

    // ── REQ 181: Pure function tests ────────────────────────────────────────

    describe('DXF generation (REQ 181)', () => {
        it('should have generateDxf as a callable method', () => {
            expect((component as any).generateDxf).toBeDefined();
            expect(typeof (component as any).generateDxf).toBe('function');
        });

        it('should generate valid DXF with LWPOLYLINE entity', () => {
            const points = [[0, 0], [10, 0], [10, 10], [0, 10]];
            const dxf = (component as any).generateDxf(points, null);
            expect(dxf).toContain('LWPOLYLINE');
            expect(dxf).toContain('EOF');
            expect(dxf).toContain('$INSUNITS');
        });

        it('should include centerline as LINE entity in DXF', () => {
            const points = [[0, 0], [10, 0], [10, 10], [0, 10]];
            const cl = { x1: 5, y1: 0, x2: 5, y2: 10 };
            const dxf = (component as any).generateDxf(points, cl);
            expect(dxf).toContain('LINE');
            expect(dxf).toContain('CENTERLINE');
        });
    });

    describe('Bezier path generation (REQ 181)', () => {
        it('should have pointsToBezierPath method', () => {
            expect((component as any).pointsToBezierPath).toBeDefined();
        });

        it('should generate closed SVG path (ending with Z)', () => {
            const pts = [[0, 0], [10, 0], [10, 10], [0, 10]];
            const d = (component as any).pointsToBezierPath(pts);
            expect(d).toMatch(/^M /);
            expect(d).toMatch(/ Z$/);
        });
    });

    describe('Vertex angle computation (REQ 179)', () => {
        it('should have vertexAngle method', () => {
            expect((component as any).vertexAngle).toBeDefined();
        });

        it('should return 90 for a right angle', () => {
            const angle = (component as any).vertexAngle([0, 0], [0, 10], [10, 10]);
            expect(Math.round(angle)).toBe(90);
        });

        it('should return 180 for collinear points', () => {
            const angle = (component as any).vertexAngle([0, 0], [5, 0], [10, 0]);
            expect(Math.round(angle)).toBe(180);
        });
    });

    describe('Scale computation (REQ 178)', () => {
        it('should have computeScale method', () => {
            expect((component as any).computeScale).toBeDefined();
        });

        it('should return value directly for manual mode', () => {
            const scale = (component as any).computeScale(null, 'manual', 0.15, 310);
            expect(scale).toBe(0.15);
        });

        it('should compute mm/px from DPI', () => {
            const scale = (component as any).computeScale(null, 'dpi', 96, 310);
            expect(scale).toBeCloseTo(25.4 / 96, 4);
        });
    });

    describe('Rotation helpers (REQ 181)', () => {
        it('should have rotatePoints method', () => {
            expect((component as any).rotatePoints).toBeDefined();
        });

        it('should rotate points by 90 degrees', () => {
            const pts = [[10, 0]];
            const rotated = (component as any).rotatePoints(pts, Math.PI / 2);
            expect(rotated[0][0]).toBeCloseTo(0, 1);
            expect(rotated[0][1]).toBeCloseTo(10, 1);
        });
    });

    // ── REQ 177: Cleanup ────────────────────────────────────────────────────

    describe('Cleanup', () => {
        it('should clean up OpenCV script on destroy', () => {
            expect(() => component.ngOnDestroy()).not.toThrow();
        });
    });
});
