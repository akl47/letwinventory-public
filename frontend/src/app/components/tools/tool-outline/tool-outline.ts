import {
    ChangeDetectionStrategy, Component, signal, computed,
    OnInit, OnDestroy, ElementRef, ViewChild, NgZone, inject
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSliderModule } from '@angular/material/slider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { SvgSanitizePipe } from './svg-sanitize.pipe';

declare const cv: any;
declare const JSZip: any;

interface CenterLine {
    cp1x: number; cp1y: number;
    cp2x: number; cp2y: number;
    x1: number; y1: number;
    x2: number; y2: number;
    lengthMm: number;
    maxWidthMm: number;
}

interface SvgParams {
    wMm: number; hMm: number;
    mmPerPx: number;
    offsetX: number; offsetY: number;
}

interface DxfPart {
    name: string;
    dxf: string;
}

interface InfoBarData {
    imageW: number; imageH: number;
    plateW: number; plateH: number;
    svgW: number; svgH: number;
    contourCount: number;
    scale: number;
}

const CORNER_ANGLE_THRESHOLD = 140;
const CL_HIT_RADIUS = 15;

@Component({
    selector: 'app-tool-outline',
    templateUrl: './tool-outline.html',
    styleUrl: './tool-outline.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatCardModule, MatButtonModule, MatIconModule, MatSelectModule,
        MatSliderModule, MatSlideToggleModule, MatProgressSpinnerModule,
        MatExpansionModule, MatFormFieldModule, MatInputModule, MatTooltipModule, MatDividerModule,
        FormsModule,
        DecimalPipe,
        SvgSanitizePipe,
    ],
})
export class ToolOutlineComponent implements OnInit, OnDestroy {
    private readonly ngZone = inject(NgZone);

    // ── OpenCV / JSZip loading ──────────────────────────────────────────────
    readonly cvStatus = signal<'loading' | 'ready' | 'error'>('loading');
    readonly cvReady = signal(false);
    private cvScript: HTMLScriptElement | null = null;
    private zipScript: HTMLScriptElement | null = null;

    // ── File selection ──────────────────────────────────────────────────────
    readonly selectedFile = signal<File | null>(null);
    readonly fileName = computed(() => this.selectedFile()?.name ?? '');
    readonly fileSizeMB = computed(() => {
        const f = this.selectedFile();
        return f ? (f.size / 1024 / 1024).toFixed(1) : '';
    });

    // ── Controls ────────────────────────────────────────────────────────────
    readonly scaleMethod = signal<'reference' | 'dpi' | 'manual'>('reference');
    readonly scaleValue = signal(222);
    readonly plateHeight = signal(310);
    readonly smoothing = signal(0.0008);
    readonly showPlateHeight = computed(() => this.scaleMethod() === 'reference');
    readonly scaleValueLabel = computed(() => {
        const m = this.scaleMethod();
        if (m === 'dpi') return 'DPI';
        if (m === 'manual') return 'mm per pixel';
        return 'Plate Width (mm)';
    });

    // Sliders

    readonly blurRadius = signal(5);
    readonly threshMethod = signal<'adaptive' | 'otsu' | 'combined'>('combined');
    readonly threshValue = signal(180);
    readonly blockSize = signal(53);
    readonly adaptiveC = signal(8);
    readonly morphClose = signal(2);
    readonly morphOpen = signal(1);
    readonly minAreaRatio = signal(0.001);
    readonly marginMm = signal(0);
    readonly extRadiusMm = signal(0);
    readonly intRadiusMm = signal(0);
    readonly fillHoles = signal(true);
    readonly centerLinesEnabled = signal(true);

    // ── Processing state ────────────────────────────────────────────────────
    readonly processDisabled = computed(() => !this.cvReady() || !this.selectedFile());
    readonly isProcessing = signal(false);
    readonly processingText = signal('Processing image...');
    readonly showResults = signal(false);
    readonly errorMessage = signal<string | null>(null);

    // ── Preview ─────────────────────────────────────────────────────────────
    readonly previewZoom = signal(0.5);
    readonly zoomDisplayText = computed(() => Math.round(this.previewZoom() * 100) + '%');
    private isPanning = false;
    private panStart = { x: 0, y: 0, scrollLeft: 0, scrollTop: 0 };

    // ── Centerlines ─────────────────────────────────────────────────────────
    readonly centerLines = signal<CenterLine[]>([]);
    readonly draggingCL = signal<{ index: number; endpoint: 1 | 2 } | null>(null);

    // ── Output ──────────────────────────────────────────────────────────────
    readonly partNames = signal<string[]>([]);
    readonly partSvgs = signal<string[]>([]);
    readonly dxfParts = signal<DxfPart[]>([]);
    readonly partDimensions = signal<{ length: number; width: number }[]>([]);

    // ── Info bar ────────────────────────────────────────────────────────────
    readonly infoBarData = signal<InfoBarData | null>(null);

    // ── Panel expansion state ────────────────────────────────────────────────
    readonly settingsExpanded = signal(true);
    readonly stepsExpanded = signal(false);
    readonly previewExpanded = signal(true);
    readonly partsExpanded = signal(true);

    // ── Delete state ────────────────────────────────────────────────────────
    readonly deletedParts = signal<Set<number>>(new Set());

    // ── Internal state (not signals — used by canvas rendering) ─────────────
    private lastLoadedImage: HTMLImageElement | null = null;
    private lastBluePaths: number[][][] | null = null;
    private lastGreenPaths: number[][][] | null = null;
    private lastHasMargin = false;
    private lastSvgParams: SvgParams | null = null;
    private cachedBaseData: ImageData | null = null;

    @ViewChild('previewCanvas', { static: false }) private previewCanvasRef!: ElementRef<HTMLCanvasElement>;
    @ViewChild('hiddenCanvas', { static: false }) private hiddenCanvasRef!: ElementRef<HTMLCanvasElement>;
    @ViewChild('previewBody', { static: false }) private previewBodyRef!: ElementRef<HTMLDivElement>;

    // Step canvas refs
    private stepCanvasIds = ['stepGray', 'stepBlurred', 'stepRoughOtsu', 'stepRoughClosed', 'stepThreshold', 'stepMorph', 'stepFillHoles', 'stepPlateMask'];

    ngOnInit() {
        this.loadOpenCV();
        this.loadJSZip();
    }

    ngOnDestroy() {
        if (this.cvScript) {
            this.cvScript.remove();
            this.cvScript = null;
        }
        if (this.zipScript) {
            this.zipScript.remove();
            this.zipScript = null;
        }
    }

    // ── OpenCV / JSZip Loading ──────────────────────────────────────────────

    private loadOpenCV() {
        const script = document.createElement('script');
        script.src = 'https://docs.opencv.org/4.x/opencv.js';
        script.async = true;

        (window as any).Module = {
            onRuntimeInitialized: () => {
                this.ngZone.run(() => {
                    this.cvStatus.set('ready');
                    this.cvReady.set(true);
                });
            }
        };

        script.onload = () => {
            if (typeof cv !== 'undefined' && cv.Mat) {
                this.ngZone.run(() => {
                    this.cvStatus.set('ready');
                    this.cvReady.set(true);
                });
            }
        };
        script.onerror = () => {
            this.ngZone.run(() => {
                this.cvStatus.set('error');
            });
        };

        this.cvScript = script;
        document.head.appendChild(script);
    }

    private loadJSZip() {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.async = true;
        this.zipScript = script;
        document.head.appendChild(script);
    }

    // ── File Upload ─────────────────────────────────────────────────────────

    selectFile(file: File) {
        this.selectedFile.set(file);
    }

    onDragOver(event: DragEvent) {
        event.preventDefault();
        event.stopPropagation();
    }

    onDrop(event: DragEvent) {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer?.files.length) {
            this.selectFile(event.dataTransfer.files[0]);
        }
    }

    onFileSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files?.length) {
            this.selectFile(input.files[0]);
        }
    }

    // ── Scale Method ────────────────────────────────────────────────────────

    onScaleMethodChange(value: string) {
        this.scaleMethod.set(value as any);
        const defaults: Record<string, number> = { dpi: 96, reference: 222, manual: 0.15 };
        this.scaleValue.set(defaults[value]);
    }

    // ── Zoom Controls ───────────────────────────────────────────────────────

    zoomIn() {
        this.previewZoom.update(z => Math.min(5, z * 1.25));
    }

    zoomOut() {
        this.previewZoom.update(z => Math.max(0.1, z / 1.25));
    }

    zoom100() {
        this.previewZoom.set(1);
    }

    zoomToFit() {
        const canvas = this.previewCanvasRef?.nativeElement;
        const body = this.previewBodyRef?.nativeElement;
        if (!canvas || !body || !canvas.width) return;
        const bodyW = body.clientWidth - 32;
        const bodyH = body.clientHeight || 500;
        this.previewZoom.set(Math.min(bodyW / canvas.width, bodyH / canvas.height, 1));
    }

    onPreviewWheel(event: WheelEvent) {
        if (!this.cachedBaseData) return;
        event.preventDefault();
        const body = this.previewBodyRef?.nativeElement;
        if (!body) return;
        const oldZoom = this.previewZoom();
        const delta = event.deltaY > 0 ? 0.9 : 1.1;
        this.previewZoom.set(Math.max(0.1, Math.min(5, oldZoom * delta)));

        const rect = body.getBoundingClientRect();
        const mx = event.clientX - rect.left + body.scrollLeft;
        const my = event.clientY - rect.top + body.scrollTop;
        const ratio = this.previewZoom() / oldZoom;
        body.scrollLeft = mx * ratio - (event.clientX - rect.left);
        body.scrollTop = my * ratio - (event.clientY - rect.top);
    }

    // ── Pan ─────────────────────────────────────────────────────────────────

    onPreviewMouseDown(event: MouseEvent) {
        if (event.button === 1) {
            event.preventDefault();
            this.isPanning = true;
            const body = this.previewBodyRef?.nativeElement;
            if (body) {
                this.panStart = { x: event.clientX, y: event.clientY, scrollLeft: body.scrollLeft, scrollTop: body.scrollTop };
                body.classList.add('panning');
            }
        }
    }

    onWindowMouseMove(event: MouseEvent) {
        if (!this.isPanning) return;
        event.preventDefault();
        const body = this.previewBodyRef?.nativeElement;
        if (body) {
            body.scrollLeft = this.panStart.scrollLeft - (event.clientX - this.panStart.x);
            body.scrollTop = this.panStart.scrollTop - (event.clientY - this.panStart.y);
        }
    }

    onWindowMouseUp() {
        if (this.isPanning) {
            this.isPanning = false;
            const body = this.previewBodyRef?.nativeElement;
            if (body) body.classList.remove('panning');
        }
    }

    // ── Centerline Dragging ─────────────────────────────────────────────────

    private canvasCoords(event: MouseEvent): { x: number; y: number } {
        const canvas = this.previewCanvasRef?.nativeElement;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY
        };
    }

    onCanvasMouseDown(event: MouseEvent) {
        if (event.button !== 0) return;
        const cls = this.centerLines();
        if (cls.length === 0 || !this.cachedBaseData) return;
        const { x, y } = this.canvasCoords(event);

        let bestDist = CL_HIT_RADIUS;
        let bestIdx = -1, bestEp: 1 | 2 = 1;
        for (let i = 0; i < cls.length; i++) {
            const cl = cls[i];
            const d1 = Math.sqrt((x - cl.cp1x) ** 2 + (y - cl.cp1y) ** 2);
            const d2 = Math.sqrt((x - cl.cp2x) ** 2 + (y - cl.cp2y) ** 2);
            if (d1 < bestDist) { bestDist = d1; bestIdx = i; bestEp = 1; }
            if (d2 < bestDist) { bestDist = d2; bestIdx = i; bestEp = 2; }
        }

        if (bestIdx >= 0) {
            event.preventDefault();
            event.stopPropagation();
            this.draggingCL.set({ index: bestIdx, endpoint: bestEp });
        }
    }

    onCanvasMouseMove(event: MouseEvent) {
        const drag = this.draggingCL();
        const canvas = this.previewCanvasRef?.nativeElement;
        if (!drag) {
            const cls = this.centerLines();
            if (cls.length > 0 && this.cachedBaseData && canvas) {
                const { x, y } = this.canvasCoords(event);
                let near = false;
                for (const cl of cls) {
                    if (Math.sqrt((x - cl.cp1x) ** 2 + (y - cl.cp1y) ** 2) < CL_HIT_RADIUS ||
                        Math.sqrt((x - cl.cp2x) ** 2 + (y - cl.cp2y) ** 2) < CL_HIT_RADIUS) {
                        near = true; break;
                    }
                }
                canvas.style.cursor = near ? 'pointer' : '';
            }
            return;
        }

        event.preventDefault();
        const { x, y } = this.canvasCoords(event);
        const cls = [...this.centerLines()];
        const cl = { ...cls[drag.index] };
        if (drag.endpoint === 1) { cl.cp1x = x; cl.cp1y = y; }
        else { cl.cp2x = x; cl.cp2y = y; }
        cls[drag.index] = cl;
        this.centerLines.set(cls);
        this.drawPreviewOverlay();
    }

    onCanvasMouseUp(event: MouseEvent) {
        if (!this.draggingCL()) return;
        event.preventDefault();
        event.stopPropagation();
        const canvas = this.previewCanvasRef?.nativeElement;
        if (canvas) canvas.style.cursor = '';
        this.draggingCL.set(null);
        this.updateOutputsAfterCLEdit();
    }

    onCanvasMouseLeave() {
        if (this.draggingCL()) {
            this.draggingCL.set(null);
            const canvas = this.previewCanvasRef?.nativeElement;
            if (canvas) canvas.style.cursor = '';
            this.updateOutputsAfterCLEdit();
        }
    }

    // ── Process Image ───────────────────────────────────────────────────────

    processImage() {
        const file = this.selectedFile();
        if (!file || !this.cvReady()) return;

        this.showResults.set(true);

        this.errorMessage.set(null);
        this.isProcessing.set(true);
        this.processingText.set('Processing image...');

        if (this.lastLoadedImage && (this.lastLoadedImage as any)._file === file) {
            this.runPipelineDeferred(this.lastLoadedImage);
            return;
        }

        this.processingText.set('Loading image...');
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                (img as any)._file = file;
                this.lastLoadedImage = img;
                this.processingText.set('Processing image...');
                this.runPipelineDeferred(img);
            };
            img.onerror = () => {
                this.isProcessing.set(false);
                this.errorMessage.set('Could not decode image');
            };
            img.src = e.target!.result as string;
        };
        reader.readAsDataURL(file);
    }

    private runPipelineDeferred(img: HTMLImageElement) {
        setTimeout(() => {
            this.ngZone.runOutsideAngular(() => {
                try {
                    this.runPipeline(img);
                } catch (err: any) {
                    this.ngZone.run(() => {
                        this.errorMessage.set(err.message || String(err));
                    });
                } finally {
                    this.ngZone.run(() => {
                        this.isProcessing.set(false);
                    });
                }
            });
        }, 50);
    }

    private runPipeline(img: HTMLImageElement) {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const hiddenCanvas = this.hiddenCanvasRef?.nativeElement;
        const previewCanvas = this.previewCanvasRef?.nativeElement;
        if (!hiddenCanvas || !previewCanvas) return;

        hiddenCanvas.width = w;
        hiddenCanvas.height = h;
        const ctx = hiddenCanvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);

        let src = cv.imread(hiddenCanvas);
        let gray = new cv.Mat();
        let blurred = new cv.Mat();
        let binary = new cv.Mat();
        let kernel: any = null;
        let contours: any = null;
        let hierarchy: any = null;
        let plateMask: any = null;

        try {
            const blurSize = (this.blurRadius() | 1);
            const threshVal = this.threshValue();
            const closeIter = this.morphClose();
            const openIter = this.morphOpen();

            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
            this.showStep('stepGray', gray);
            const ksize = new cv.Size(blurSize, blurSize);
            cv.GaussianBlur(gray, blurred, ksize, 0);
            this.showStep('stepBlurred', blurred);

            const method_thresh = this.threshMethod();
            const blockSz = (this.blockSize() | 1);
            const aC = this.adaptiveC();

            // Rough full-image Otsu for plate detection
            cv.threshold(blurred, binary, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
            this.showStep('stepRoughOtsu', binary);
            let roughBinary = binary.clone();
            let roughKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
            cv.morphologyEx(roughBinary, roughBinary, cv.MORPH_CLOSE, roughKernel, new cv.Point(-1, -1), 2);
            this.showStep('stepRoughClosed', roughBinary);
            const plateInfo = this.detectPlate(roughBinary, w, h);
            roughKernel.delete();
            roughBinary.delete();

            // Apply selected threshold method
            if (threshVal > 0) {
                cv.threshold(blurred, binary, threshVal, 255, cv.THRESH_BINARY_INV);
            } else if (method_thresh === 'adaptive' || method_thresh === 'combined') {
                let adaptiveBin = new cv.Mat();
                cv.adaptiveThreshold(blurred, adaptiveBin, 255,
                    cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, blockSz, aC);
                if (method_thresh === 'combined') {
                    if (plateInfo) {
                        const pr = cv.boundingRect(plateInfo.contour);
                        let roiSrc = blurred.roi(new cv.Rect(pr.x, pr.y, pr.width, pr.height));
                        let roiDst = binary.roi(new cv.Rect(pr.x, pr.y, pr.width, pr.height));
                        cv.threshold(roiSrc, roiDst, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
                        roiSrc.delete(); roiDst.delete();
                    }
                    cv.bitwise_or(binary, adaptiveBin, binary);
                } else {
                    adaptiveBin.copyTo(binary);
                }
                adaptiveBin.delete();
            } else {
                if (plateInfo) {
                    const pr = cv.boundingRect(plateInfo.contour);
                    let roiSrc = blurred.roi(new cv.Rect(pr.x, pr.y, pr.width, pr.height));
                    let roiDst = binary.roi(new cv.Rect(pr.x, pr.y, pr.width, pr.height));
                    cv.threshold(roiSrc, roiDst, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
                    roiSrc.delete(); roiDst.delete();
                }
            }
            this.showStep('stepThreshold', binary);

            // Morphological close/open
            kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
            if (closeIter > 0)
                cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), closeIter);
            if (openIter > 0)
                cv.morphologyEx(binary, binary, cv.MORPH_OPEN, kernel, new cv.Point(-1, -1), openIter);
            this.showStep('stepMorph', binary);

            // Fill holes
            if (this.fillHoles()) {
                let invBinary = new cv.Mat();
                cv.bitwise_not(binary, invBinary);
                let holeContours = new cv.MatVector();
                let holeHier = new cv.Mat();
                cv.findContours(invBinary, holeContours, holeHier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
                if (holeContours.size() > 0) {
                    let maxArea = 0, maxIdx = 0;
                    for (let i = 0; i < holeContours.size(); i++) {
                        const a = cv.contourArea(holeContours.get(i));
                        if (a > maxArea) { maxArea = a; maxIdx = i; }
                    }
                    for (let i = 0; i < holeContours.size(); i++) {
                        if (i === maxIdx) continue;
                        let fillVec = new cv.MatVector();
                        fillVec.push_back(holeContours.get(i));
                        cv.drawContours(binary, fillVec, 0, new cv.Scalar(255, 255, 255, 255), -1);
                        fillVec.delete();
                    }
                }
                holeContours.delete(); holeHier.delete(); invBinary.delete();
            }
            this.showStep('stepFillHoles', binary);

            // Margin & scale
            const mmPerPx = this.computeScale(plateInfo, this.scaleMethod(), this.scaleValue(), this.plateHeight());

            // Find contours
            contours = new cv.MatVector();
            hierarchy = new cv.Mat();
            cv.findContours(binary, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_NONE);

            const imageArea = w * h;
            const minArea = imageArea * this.minAreaRatio();

            // Build plate mask
            if (plateInfo) {
                plateMask = cv.Mat.zeros(h, w, cv.CV_8UC1);
                let plateVec = new cv.MatVector();
                plateVec.push_back(plateInfo.contour);
                cv.drawContours(plateMask, plateVec, 0, new cv.Scalar(255), -1);
                plateVec.delete();
                this.showStep('stepPlateMask', plateMask);
            }

            // Filter contours
            let kept: { contour: any; isHole: boolean }[] = [];
            const hData = hierarchy.data32S;
            for (let i = 0; i < contours.size(); i++) {
                const c = contours.get(i);
                const area = cv.contourArea(c);
                const parent = hData[i * 4 + 3];
                let validSize = (parent === -1 && area >= minArea) || (parent >= 0 && area >= minArea * 0.1);
                if (!validSize) continue;
                if (plateMask) {
                    const moments = cv.moments(c);
                    if (moments.m00 > 0) {
                        const cx = Math.round(moments.m10 / moments.m00);
                        const cy = Math.round(moments.m01 / moments.m00);
                        if (cx >= 0 && cx < w && cy >= 0 && cy < h && plateMask.ucharAt(cy, cx) === 0) continue;
                    }
                }
                kept.push({ contour: c, isHole: parent >= 0 });
            }

            if (plateInfo) {
                const plateArea = cv.contourArea(plateInfo.contour);
                kept = kept.filter(k => cv.contourArea(k.contour) < plateArea * 0.8);
            }

            if (kept.length === 0) {
                this.ngZone.run(() => {
                    this.errorMessage.set('No tool outlines detected inside the plate.');
                });
                return;
            }

            const wMm = w * mmPerPx;
            const hMm = h * mmPerPx;
            const smoothFactor = this.smoothing();

            // Green paths (raw edges)
            const greenPaths: number[][][] = [];
            for (const k of kept) {
                const pts = this.contourToPoints(k.contour);
                greenPaths.push(this.douglasPeucker(pts, smoothFactor));
            }

            // Blue paths (with margin)
            let bluePaths = greenPaths;
            const marginPx = this.marginMm() > 0 ? Math.round(this.marginMm() / mmPerPx) : 0;
            const minRadPx = this.extRadiusMm() > 0 ? Math.max(1, Math.round(this.extRadiusMm() / mmPerPx)) : 0;
            const intRadPx = this.intRadiusMm() > 0 ? Math.max(1, Math.round(this.intRadiusMm() / mmPerPx)) : 0;

            if (marginPx > 0) {
                const kSize = marginPx * 2 + 1;
                let marginKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(kSize, kSize));
                let dilated = new cv.Mat();
                cv.dilate(binary, dilated, marginKernel, new cv.Point(-1, -1), 1);
                let mContours = new cv.MatVector();
                let mHierarchy = new cv.Mat();
                cv.findContours(dilated, mContours, mHierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_NONE);
                const mhData = mHierarchy.data32S;
                let mKept: any[] = [];
                for (let i = 0; i < mContours.size(); i++) {
                    const c = mContours.get(i);
                    const area = cv.contourArea(c);
                    const parent = mhData[i * 4 + 3];
                    if (!((parent === -1 && area >= minArea) || (parent >= 0 && area >= minArea * 0.1))) continue;
                    if (plateMask) {
                        const moments = cv.moments(c);
                        if (moments.m00 > 0) {
                            const cx = Math.round(moments.m10 / moments.m00);
                            const cy = Math.round(moments.m01 / moments.m00);
                            if (cx >= 0 && cx < w && cy >= 0 && cy < h && plateMask.ucharAt(cy, cx) === 0) continue;
                        }
                    }
                    mKept.push(c);
                }
                if (plateInfo) {
                    const plateArea = cv.contourArea(plateInfo.contour);
                    mKept = mKept.filter((c: any) => cv.contourArea(c) < plateArea * 0.8);
                }
                bluePaths = mKept.map((c: any) => this.douglasPeucker(this.contourToPoints(c), smoothFactor));
                marginKernel.delete(); dilated.delete(); mContours.delete(); mHierarchy.delete();
            }

            // Apply minimum radius
            if (minRadPx > 0 || intRadPx > 0) {
                bluePaths = bluePaths.map(pts => this.applyMinRadius(pts, minRadPx, intRadPx).pts);
            }

            // Centerlines
            let newCenterLines: CenterLine[] = [];
            if (this.centerLinesEnabled()) {
                for (const bp of bluePaths) {
                    const cl = this.computeCenterLine(bp);
                    if (cl) newCenterLines.push(cl);
                }
            }

            // Draw base preview (image + plate outline only)
            previewCanvas.width = w;
            previewCanvas.height = h;
            cv.imshow(previewCanvas, src);
            const pctx = previewCanvas.getContext('2d')!;

            // Red plate outline
            if (plateInfo) {
                const platePts = this.contourToPoints(plateInfo.contour);
                pctx.strokeStyle = '#ff0000';
                pctx.lineWidth = 3;
                pctx.beginPath();
                if (platePts.length > 0) {
                    pctx.moveTo(platePts[0][0], platePts[0][1]);
                    for (let i = 1; i < platePts.length; i++) pctx.lineTo(platePts[i][0], platePts[i][1]);
                    pctx.closePath();
                }
                pctx.stroke();
            }

            // Cache base image (before contours) for overlay redraws
            this.cachedBaseData = pctx.getImageData(0, 0, w, h);
            this.lastGreenPaths = greenPaths;
            this.lastHasMargin = (marginPx > 0 || minRadPx > 0 || intRadPx > 0);

            // Compute SVG params
            let svgWMm = wMm, svgHMm = hMm, svgOffsetX = 0, svgOffsetY = 0;
            if (plateInfo) {
                const pr = cv.boundingRect(plateInfo.contour);
                svgOffsetX = pr.x; svgOffsetY = pr.y;
                svgWMm = pr.width * mmPerPx; svgHMm = pr.height * mmPerPx;
            }

            this.lastBluePaths = bluePaths;
            this.lastSvgParams = { wMm: svgWMm, hMm: svgHMm, mmPerPx, offsetX: svgOffsetX, offsetY: svgOffsetY };

            this.ngZone.run(() => {
                this.deletedParts.set(new Set());
                this.centerLines.set(newCenterLines);
                this.drawPreviewOverlay();
                setTimeout(() => this.zoomToFit(), 0);

                // Generate per-part output
                this.generatePartOutput(bluePaths, newCenterLines, mmPerPx, svgOffsetX, svgOffsetY);

                // Info bar
                this.infoBarData.set({
                    imageW: w, imageH: h,
                    plateW: plateInfo ? plateInfo.rect.size.width : 0,
                    plateH: plateInfo ? plateInfo.rect.size.height : 0,
                    svgW: svgWMm, svgH: svgHMm,
                    contourCount: kept.length,
                    scale: mmPerPx
                });
            });

        } finally {
            src.delete(); gray.delete(); blurred.delete(); binary.delete();
            if (kernel) kernel.delete();
            if (contours) contours.delete();
            if (hierarchy) hierarchy.delete();
            if (plateMask) plateMask.delete();
        }
    }

    private generatePartOutput(bluePaths: number[][][], centerLinesList: CenterLine[], mmPerPx: number, offsetX: number, offsetY: number) {
        const newDxfParts: DxfPart[] = [];
        const newPartSvgs: string[] = [];
        const newDims: { length: number; width: number }[] = [];
        const names = this.partNames().length === bluePaths.length ? [...this.partNames()] : bluePaths.map((_, i) => 'Part ' + (i + 1));

        for (let i = 0; i < bluePaths.length; i++) {
            let polyPts = this.contourToPolylineMm(bluePaths[i], mmPerPx, offsetX, offsetY);
            const cl = (i < centerLinesList.length) ? centerLinesList[i] : null;
            let clMm: { x1: number; y1: number; x2: number; y2: number } | null = null;
            if (cl) {
                clMm = {
                    x1: (cl.x1 - offsetX) * mmPerPx, y1: (cl.y1 - offsetY) * mmPerPx,
                    x2: (cl.x2 - offsetX) * mmPerPx, y2: (cl.y2 - offsetY) * mmPerPx
                };
                const clAngle = Math.PI / 2 - Math.atan2(clMm.y2 - clMm.y1, clMm.x2 - clMm.x1);
                polyPts = this.rotatePoints(polyPts, clAngle);
                clMm = this.rotateLine(clMm, clAngle);
                let minX = Infinity, minY = Infinity;
                for (const p of polyPts) { if (p[0] < minX) minX = p[0]; if (p[1] < minY) minY = p[1]; }
                minX = Math.min(minX, clMm.x1, clMm.x2);
                minY = Math.min(minY, clMm.y1, clMm.y2);
                polyPts = polyPts.map(p => [p[0] - minX, p[1] - minY]);
                clMm = { x1: clMm.x1 - minX, y1: clMm.y1 - minY, x2: clMm.x2 - minX, y2: clMm.y2 - minY };
            }

            let bMaxX = 0, bMaxY = 0;
            for (const p of polyPts) { if (p[0] > bMaxX) bMaxX = p[0]; if (p[1] > bMaxY) bMaxY = p[1]; }
            const pad = 2;
            const d = this.pointsToBezierPath(polyPts);
            let partSvg = '<?xml version="1.0" encoding="UTF-8"?>\n' +
                '<svg xmlns="http://www.w3.org/2000/svg"\n' +
                '     width="' + (bMaxX + pad * 2).toFixed(2) + 'mm" height="' + (bMaxY + pad * 2).toFixed(2) + 'mm"\n' +
                '     viewBox="' + (-pad).toFixed(2) + ' ' + (-pad).toFixed(2) + ' ' +
                (bMaxX + pad * 2).toFixed(2) + ' ' + (bMaxY + pad * 2).toFixed(2) + '">\n' +
                '  <g fill="none" stroke="black" stroke-width="0.3">\n' +
                '    <path d="' + d + '"/>\n  </g>\n';
            if (clMm) {
                partSvg += '  <g fill="none" stroke="red" stroke-width="0.2" stroke-dasharray="2,1">\n' +
                    '    <line x1="' + clMm.x1.toFixed(2) + '" y1="' + clMm.y1.toFixed(2) +
                    '" x2="' + clMm.x2.toFixed(2) + '" y2="' + clMm.y2.toFixed(2) + '"/>\n  </g>\n';
            }
            partSvg += '</svg>';
            newPartSvgs.push(partSvg);
            newDxfParts.push({ name: names[i].replace(/[^a-zA-Z0-9_-]/g, '_') + '.dxf', dxf: this.generateDxf(polyPts, clMm) });
            newDims.push({ length: cl ? cl.lengthMm : 0, width: cl ? cl.maxWidthMm : 0 });
        }

        this.partNames.set(names);
        this.partSvgs.set(newPartSvgs);
        this.dxfParts.set(newDxfParts);
        this.partDimensions.set(newDims);
    }

    private updateOutputsAfterCLEdit() {
        if (!this.lastBluePaths || !this.lastSvgParams) return;
        const p = this.lastSvgParams;
        this.generatePartOutput(this.lastBluePaths, this.centerLines(), p.mmPerPx, p.offsetX, p.offsetY);
    }

    // ── Download helpers ────────────────────────────────────────────────────

    async downloadAllSvg() {
        const svgs = this.partSvgs();
        const names = this.partNames();
        const deleted = this.deletedParts();
        const active = svgs.map((svg, i) => ({ svg, name: names[i] || 'part_' + (i + 1) })).filter((_, i) => !deleted.has(i));
        if (!active.length) return;
        if (active.length === 1) {
            const sanitized = active[0].name.replace(/[^a-zA-Z0-9_-]/g, '_');
            this.downloadBlob(new Blob([active[0].svg], { type: 'image/svg+xml' }), sanitized + '.svg');
        } else {
            if (typeof JSZip === 'undefined') { alert('JSZip is still loading.'); return; }
            const zip = new JSZip();
            for (const p of active) zip.file(p.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.svg', p.svg);
            const blob = await zip.generateAsync({ type: 'blob' });
            this.downloadBlob(blob, 'tool_outlines_svg.zip');
        }
    }

    async downloadAllDxf() {
        const parts = this.dxfParts();
        const names = this.partNames();
        const deleted = this.deletedParts();
        const active = parts.map((p, i) => ({ dxf: p.dxf, name: names[i] || 'part_' + (i + 1) })).filter((_, i) => !deleted.has(i));
        if (!active.length) return;
        if (active.length === 1) {
            const sanitized = active[0].name.replace(/[^a-zA-Z0-9_-]/g, '_');
            this.downloadBlob(new Blob([active[0].dxf], { type: 'application/dxf' }), sanitized + '.dxf');
        } else {
            if (typeof JSZip === 'undefined') { alert('JSZip is still loading.'); return; }
            const zip = new JSZip();
            for (const p of active) zip.file(p.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.dxf', p.dxf);
            const blob = await zip.generateAsync({ type: 'blob' });
            this.downloadBlob(blob, 'tool_outlines_dxf.zip');
        }
    }

    downloadPartSvg(index: number) {
        const svgs = this.partSvgs();
        if (!svgs[index]) return;
        const name = this.partNames()[index] || 'part_' + (index + 1);
        this.downloadBlob(new Blob([svgs[index]], { type: 'image/svg+xml' }), name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.svg');
    }

    downloadPartDxf(index: number) {
        const parts = this.dxfParts();
        if (!parts[index]) return;
        const name = this.partNames()[index] || 'part_' + (index + 1);
        this.downloadBlob(new Blob([parts[index].dxf], { type: 'application/dxf' }), name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.dxf');
    }

    private downloadBlob(blob: Blob, filename: string) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    updatePartName(index: number, name: string) {
        const names = [...this.partNames()];
        names[index] = name;
        this.partNames.set(names);
    }

    deletePart(index: number) {
        const s = new Set(this.deletedParts());
        s.add(index);
        this.deletedParts.set(s);
        this.drawPreviewOverlay();
    }

    restorePart(index: number) {
        const s = new Set(this.deletedParts());
        s.delete(index);
        this.deletedParts.set(s);
        this.drawPreviewOverlay();
    }

    // ── Pipeline step canvas helper ─────────────────────────────────────────

    private showStep(canvasId: string, mat: any) {
        const c = document.getElementById(canvasId) as HTMLCanvasElement;
        if (c) cv.imshow(c, mat);
    }

    // ── Plate detection ─────────────────────────────────────────────────────

    private detectPlate(binary: any, imgW: number, imgH: number): { contour: any; rect: any; dims: any } | null {
        let plate = new cv.Mat();
        let plateKernel: any = null;
        let plateContours: any = null;
        let plateHier: any = null;

        try {
            cv.bitwise_not(binary, plate);
            plateKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(15, 15));
            cv.morphologyEx(plate, plate, cv.MORPH_CLOSE, plateKernel, new cv.Point(-1, -1), 3);
            plateContours = new cv.MatVector();
            plateHier = new cv.Mat();
            cv.findContours(plate, plateContours, plateHier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
            if (plateContours.size() === 0) return null;

            let bestIdx = -1, bestScore = 0;
            const imgArea = imgW * imgH;
            for (let i = 0; i < plateContours.size(); i++) {
                const c = plateContours.get(i);
                const area = cv.contourArea(c);
                if (area < imgArea * 0.05) continue;
                const rect = cv.minAreaRect(c);
                const rectArea = rect.size.width * rect.size.height;
                const rectangularity = rectArea > 0 ? area / rectArea : 0;
                const score = area * rectangularity;
                if (score > bestScore) { bestScore = score; bestIdx = i; }
            }
            if (bestIdx === -1) return null;

            const bestContour = plateContours.get(bestIdx);
            const rect = cv.minAreaRect(bestContour);
            return { contour: bestContour, rect, dims: { w: rect.size.width, h: rect.size.height } };
        } finally {
            plate.delete();
            if (plateKernel) plateKernel.delete();
            if (plateHier) plateHier.delete();
        }
    }

    // ── Scale computation ───────────────────────────────────────────────────

    computeScale(plateInfo: any, method: string, value: number, plateHeightMm: number): number {
        if (method === 'manual') return value;
        if (method === 'dpi') return 25.4 / value;
        if (method === 'reference' && plateInfo) {
            const detShort = Math.min(plateInfo.dims.w, plateInfo.dims.h);
            const detLong = Math.max(plateInfo.dims.w, plateInfo.dims.h);
            const refShort = Math.min(value, plateHeightMm);
            const refLong = Math.max(value, plateHeightMm);
            return (refShort / detShort + refLong / detLong) / 2;
        }
        return 25.4 / 96;
    }

    // ── Geometry helpers ────────────────────────────────────────────────────

    vertexAngle(p0: number[], p1: number[], p2: number[]): number {
        const ax = p0[0] - p1[0], ay = p0[1] - p1[1];
        const bx = p2[0] - p1[0], by = p2[1] - p1[1];
        const dot = ax * bx + ay * by;
        const magA = Math.sqrt(ax * ax + ay * ay);
        const magB = Math.sqrt(bx * bx + by * by);
        if (magA === 0 || magB === 0) return 180;
        const cos = Math.max(-1, Math.min(1, dot / (magA * magB)));
        return Math.acos(cos) * 180 / Math.PI;
    }

    clampCP(cpx: number, cpy: number, p1: number[], p2: number[]): [number, number] {
        const minX = Math.min(p1[0], p2[0]), maxX = Math.max(p1[0], p2[0]);
        const minY = Math.min(p1[1], p2[1]), maxY = Math.max(p1[1], p2[1]);
        return [Math.max(minX, Math.min(maxX, cpx)), Math.max(minY, Math.min(maxY, cpy))];
    }

    rotatePoints(pts: number[][], angle: number): number[][] {
        const cos = Math.cos(angle), sin = Math.sin(angle);
        return pts.map(p => [p[0] * cos - p[1] * sin, p[0] * sin + p[1] * cos]);
    }

    rotateLine(cl: { x1: number; y1: number; x2: number; y2: number }, angle: number) {
        const cos = Math.cos(angle), sin = Math.sin(angle);
        return {
            x1: cl.x1 * cos - cl.y1 * sin, y1: cl.x1 * sin + cl.y1 * cos,
            x2: cl.x2 * cos - cl.y2 * sin, y2: cl.x2 * sin + cl.y2 * cos
        };
    }

    contourToPoints(contour: any): number[][] {
        const rows = contour.rows;
        const data = contour.data32S;
        const pts: number[][] = [];
        for (let i = 0; i < rows; i++) pts.push([data[i * 2], data[i * 2 + 1]]);
        return pts;
    }

    contourToPolylineMm(pts: number[][], mmPerPx: number, offsetX: number, offsetY: number): number[][] {
        return pts.map(p => [(p[0] - offsetX) * mmPerPx, (p[1] - offsetY) * mmPerPx]);
    }

    douglasPeucker(pts: number[][], epsilonFactor: number): number[][] {
        const n = pts.length;
        if (n < 4) return pts;
        let perimeter = 0;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const dx = pts[j][0] - pts[i][0], dy = pts[j][1] - pts[i][1];
            perimeter += Math.sqrt(dx * dx + dy * dy);
        }
        const epsilon = epsilonFactor * perimeter;
        let mat = cv.matFromArray(n, 1, cv.CV_32FC2, pts.flat());
        let approx = new cv.Mat();
        try {
            cv.approxPolyDP(mat, approx, epsilon, true);
            const result: number[][] = [];
            const data = approx.data32F;
            for (let i = 0; i < approx.rows; i++) result.push([data[i * 2], data[i * 2 + 1]]);
            return result;
        } finally {
            mat.delete(); approx.delete();
        }
    }

    // ── Minimum radius ──────────────────────────────────────────────────────

    private applyMinRadius(pts: number[][], extRadius: number, intRadius: number): { pts: number[][]; arcs: any[] } {
        if (pts.length < 3 || (extRadius <= 0 && intRadius <= 0)) return { pts, arcs: [] };
        let current = pts;
        let allArcs: any[] = [];
        for (let pass = 0; pass < 20; pass++) {
            if (!this.hasRadiusViolations(current, extRadius, intRadius)) break;
            const { pts: rounded, arcs } = this.applyMinRadiusPass(current, extRadius, intRadius);
            allArcs = allArcs.concat(arcs);
            if (arcs.length === 0) break;
            current = rounded;
        }
        return { pts: current, arcs: allArcs };
    }

    private hasRadiusViolations(pts: number[][], extRadius: number, intRadius: number): boolean {
        const n = pts.length;
        if (n < 3) return false;
        let signedArea2 = 0;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            signedArea2 += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
        }
        const cw = signedArea2 < 0;
        for (let i = 0; i < n; i++) {
            const p0 = pts[((i - 1) % n + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
            const v1x = p0[0] - p1[0], v1y = p0[1] - p1[1];
            const v2x = p2[0] - p1[0], v2y = p2[1] - p1[1];
            const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
            const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
            if (len1 < 1e-6 || len2 < 1e-6) continue;
            const cross = v1x * v2y - v1y * v2x;
            const isConcave = cw ? (cross > 0) : (cross < 0);
            const cornerRadius = isConcave ? intRadius : extRadius;
            if (cornerRadius <= 0) continue;
            const dot = v1x * v2x + v1y * v2y;
            const cosA = Math.max(-1, Math.min(1, dot / (len1 * len2)));
            const angle = Math.acos(cosA);
            if (angle > Math.PI * 0.945) continue;
            return true;
        }
        return false;
    }

    private applyMinRadiusPass(pts: number[][], extRadius: number, intRadius: number): { pts: number[][]; arcs: any[] } {
        const n = pts.length;
        if (n < 3 || (extRadius <= 0 && intRadius <= 0)) return { pts, arcs: [] };
        let signedArea2 = 0;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            signedArea2 += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
        }
        const cw = signedArea2 < 0;
        const result: number[][] = [];
        const arcs: any[] = [];

        for (let i = 0; i < n; i++) {
            const p0 = pts[((i - 1) % n + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
            const v1x = p0[0] - p1[0], v1y = p0[1] - p1[1];
            const v2x = p2[0] - p1[0], v2y = p2[1] - p1[1];
            const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
            const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
            if (len1 < 1e-6 || len2 < 1e-6) { result.push(p1); continue; }
            const cross = v1x * v2y - v1y * v2x;
            const isConcave = cw ? (cross > 0) : (cross < 0);
            const cornerRadius = isConcave ? intRadius : extRadius;
            if (cornerRadius <= 0) { result.push(p1); continue; }
            const dot = v1x * v2x + v1y * v2y;
            const cosA = Math.max(-1, Math.min(1, dot / (len1 * len2)));
            const angle = Math.acos(cosA);
            const halfAngle = angle / 2;
            if (angle > Math.PI * 0.945 || halfAngle < 1e-6) { result.push(p1); continue; }
            let r = cornerRadius;
            let d = r / Math.tan(halfAngle);
            const maxD = Math.min(len1, len2) * 0.48;
            if (d > maxD) { d = maxD; r = d * Math.tan(halfAngle); }
            if (r < 0.5 || d < 0.5) { result.push(p1); continue; }
            const u1x = v1x / len1, u1y = v1y / len1;
            const u2x = v2x / len2, u2y = v2y / len2;
            const t1x = p1[0] + u1x * d, t1y = p1[1] + u1y * d;
            const t2x = p1[0] + u2x * d, t2y = p1[1] + u2y * d;
            const bisX = u1x + u2x, bisY = u1y + u2y;
            const bisLen = Math.sqrt(bisX * bisX + bisY * bisY);
            if (bisLen < 1e-6) { result.push(p1); continue; }
            const centerDist = r / Math.sin(halfAngle);
            const cx = p1[0] + (bisX / bisLen) * centerDist;
            const cy = p1[1] + (bisY / bisLen) * centerDist;
            arcs.push({ cx, cy, r, type: isConcave ? 'int' : 'ext' });
            const startA = Math.atan2(t1y - cy, t1x - cx);
            const endA = Math.atan2(t2y - cy, t2x - cx);
            let sweep = endA - startA;
            while (sweep > Math.PI) sweep -= Math.PI * 2;
            while (sweep < -Math.PI) sweep += Math.PI * 2;
            const numArcPts = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 64)));
            result.push([t1x, t1y]);
            for (let j = 1; j < numArcPts; j++) {
                const t = j / numArcPts;
                const a = startA + sweep * t;
                result.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
            }
            result.push([t2x, t2y]);
        }
        return { pts: result, arcs };
    }

    // ── Centerline computation ──────────────────────────────────────────────

    private computeCenterLine(pts: number[][]): CenterLine | null {
        const n = pts.length;
        if (n < 3) return null;
        let cx = 0, cy = 0;
        for (const p of pts) { cx += p[0]; cy += p[1]; }
        cx /= n; cy /= n;
        let mu20 = 0, mu02 = 0, mu11 = 0;
        for (const p of pts) {
            const dx = p[0] - cx, dy = p[1] - cy;
            mu20 += dx * dx; mu02 += dy * dy; mu11 += dx * dy;
        }
        const theta = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);
        const cosT = Math.cos(theta), sinT = Math.sin(theta);
        let minProj = Infinity, maxProj = -Infinity;
        for (const p of pts) {
            const proj = (p[0] - cx) * cosT + (p[1] - cy) * sinT;
            if (proj < minProj) minProj = proj;
            if (proj > maxProj) maxProj = proj;
        }
        const t1 = minProj + (maxProj - minProj) / 3;
        const t2 = minProj + (maxProj - minProj) * 2 / 3;
        return {
            cp1x: cx + cosT * t1, cp1y: cy + sinT * t1,
            cp2x: cx + cosT * t2, cp2y: cy + sinT * t2,
            x1: cx + cosT * minProj, y1: cy + sinT * minProj,
            x2: cx + cosT * maxProj, y2: cy + sinT * maxProj,
            lengthMm: 0, maxWidthMm: 0
        };
    }

    // ── Canvas bezier drawing ───────────────────────────────────────────────

    private drawBezierOnCanvas(ctx: CanvasRenderingContext2D, pts: number[][]) {
        const n = pts.length;
        if (n < 2) return;
        ctx.beginPath();
        if (n < 3) {
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath(); ctx.stroke(); return;
        }
        const isSharp = pts.map((_, i) => {
            const prev = pts[((i - 1) % n + n) % n];
            const curr = pts[i];
            const next = pts[(i + 1) % n];
            return this.vertexAngle(prev, curr, next) < CORNER_ANGLE_THRESHOLD;
        });
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 0; i < n; i++) {
            const p1 = pts[i], p2 = pts[(i + 1) % n];
            if (isSharp[i] || isSharp[(i + 1) % n]) {
                ctx.lineTo(p2[0], p2[1]);
            } else {
                const p0 = pts[((i - 1) % n + n) % n];
                const p3 = pts[(i + 2) % n];
                const [c1x, c1y] = this.clampCP(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p1, p2);
                const [c2x, c2y] = this.clampCP(p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p1, p2);
                ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2[0], p2[1]);
            }
        }
        ctx.closePath(); ctx.stroke();
    }

    // ── Preview overlay (contours + centerlines, skipping deleted) ──────────

    private drawPreviewOverlay() {
        if (!this.cachedBaseData) return;
        const canvas = this.previewCanvasRef?.nativeElement;
        if (!canvas) return;
        const pctx = canvas.getContext('2d')!;
        const w = canvas.width, h = canvas.height;
        const mmPerPx = this.lastSvgParams?.mmPerPx ?? 0;
        const deleted = this.deletedParts();
        const greenPaths = this.lastGreenPaths;
        const bluePaths = this.lastBluePaths;
        const hasMargin = this.lastHasMargin;

        // Restore base image (photo + plate outline)
        pctx.putImageData(this.cachedBaseData, 0, 0);

        // Draw contours for non-deleted parts
        if (greenPaths) {
            pctx.strokeStyle = '#00ff00'; pctx.lineWidth = 2;
            for (let i = 0; i < greenPaths.length; i++) {
                if (deleted.has(i)) continue;
                this.drawBezierOnCanvas(pctx, greenPaths[i]);
            }
        }
        if (hasMargin && bluePaths) {
            pctx.strokeStyle = '#b46bff'; pctx.lineWidth = 2;
            for (let i = 0; i < bluePaths.length; i++) {
                if (deleted.has(i)) continue;
                this.drawBezierOnCanvas(pctx, bluePaths[i]);
            }
        }

        // Draw vertex dots for non-deleted parts
        const dotPaths = (hasMargin && bluePaths) ? bluePaths : greenPaths;
        if (dotPaths) {
            for (let pi = 0; pi < dotPaths.length; pi++) {
                if (deleted.has(pi)) continue;
                const pts = dotPaths[pi];
                const n = pts.length;
                if (n < 3) continue;
                const isSharp = pts.map((_, i) => {
                    const prev = pts[((i - 1) % n + n) % n];
                    const curr = pts[i];
                    const next = pts[(i + 1) % n];
                    return this.vertexAngle(prev, curr, next) < CORNER_ANGLE_THRESHOLD;
                });
                for (let i = 0; i < n; i++) {
                    const p1 = pts[i];
                    const p2 = pts[(i + 1) % n];
                    if (!isSharp[i] && !isSharp[(i + 1) % n]) {
                        const p0 = pts[((i - 1) % n + n) % n];
                        const p3 = pts[(i + 2) % n];
                        const [c1x, c1y] = this.clampCP(p1[0] + (p2[0] - p0[0]) / 6.0, p1[1] + (p2[1] - p0[1]) / 6.0, p1, p2);
                        const [c2x, c2y] = this.clampCP(p2[0] - (p3[0] - p1[0]) / 6.0, p2[1] - (p3[1] - p1[1]) / 6.0, p1, p2);
                        pctx.strokeStyle = 'rgba(255,255,255,0.3)'; pctx.lineWidth = 1;
                        pctx.beginPath(); pctx.moveTo(p1[0], p1[1]); pctx.lineTo(c1x, c1y); pctx.stroke();
                        pctx.beginPath(); pctx.moveTo(p2[0], p2[1]); pctx.lineTo(c2x, c2y); pctx.stroke();
                        pctx.fillStyle = 'rgba(0,220,255,0.7)';
                        pctx.beginPath(); pctx.arc(c1x, c1y, 2.5, 0, Math.PI * 2); pctx.fill();
                        pctx.beginPath(); pctx.arc(c2x, c2y, 2.5, 0, Math.PI * 2); pctx.fill();
                    }
                    pctx.fillStyle = isSharp[i] ? 'rgba(255,80,80,0.8)' : 'rgba(255,255,0,0.7)';
                    pctx.beginPath(); pctx.arc(p1[0], p1[1], 3, 0, Math.PI * 2); pctx.fill();
                }
            }
        }

        // Draw centerlines for non-deleted parts
        const cls = this.centerLines();
        if (cls.length > 0 && bluePaths) {
            for (let i = 0; i < cls.length; i++) {
                if (deleted.has(i)) continue;
                const cl = { ...cls[i] };
                const contour = (i < bluePaths.length) ? bluePaths[i] : null;
                const dx = cl.cp2x - cl.cp1x, dy = cl.cp2y - cl.cp1y;
                const len = Math.sqrt(dx * dx + dy * dy);
                const dirX = len > 0 ? dx / len : 1, dirY = len > 0 ? dy / len : 0;

                let ex1: number, ey1: number, ex2: number, ey2: number;
                if (contour) {
                    const ext = this.extendLineToPart(cl.cp1x, cl.cp1y, cl.cp2x, cl.cp2y, contour);
                    ex1 = ext.x1; ey1 = ext.y1; ex2 = ext.x2; ey2 = ext.y2;
                } else {
                    ex1 = cl.cp1x; ey1 = cl.cp1y; ex2 = cl.cp2x; ey2 = cl.cp2y;
                }
                cl.x1 = ex1; cl.y1 = ey1; cl.x2 = ex2; cl.y2 = ey2;
                const clLenPx = Math.sqrt((ex2 - ex1) ** 2 + (ey2 - ey1) ** 2);
                cl.lengthMm = clLenPx * mmPerPx;
                const maxWidthPx = contour ? this.computeMaxWidth(dirX, dirY, contour) : 0;
                cl.maxWidthMm = maxWidthPx * mmPerPx;

                const updatedCls = [...this.centerLines()];
                updatedCls[i] = cl;
                this.centerLines.set(updatedCls);

                pctx.strokeStyle = '#00ffff'; pctx.lineWidth = 1.5;
                pctx.setLineDash([8, 4]);
                pctx.beginPath(); pctx.moveTo(ex1, ey1); pctx.lineTo(ex2, ey2); pctx.stroke();
                pctx.setLineDash([]);

                if (contour) {
                    pctx.lineWidth = 1.5; pctx.setLineDash([4, 3]);
                    for (const [cpx, cpy] of [[cl.cp1x, cl.cp1y], [cl.cp2x, cl.cp2y]]) {
                        const perp = this.perpLineAtPoint(cpx, cpy, dirX, dirY, contour);
                        const d1 = Math.sqrt((cpx - perp.x1) ** 2 + (cpy - perp.y1) ** 2);
                        const d2 = Math.sqrt((cpx - perp.x2) ** 2 + (cpy - perp.y2) ** 2);
                        const margin = Math.max(d1, d2) * 0.05;
                        let c1: string, c2: string;
                        if (Math.abs(d1 - d2) <= margin) { c1 = 'rgba(0,200,80,0.8)'; c2 = 'rgba(0,200,80,0.8)'; }
                        else if (d1 > d2) { c1 = 'rgba(255,80,80,0.8)'; c2 = 'rgba(180,107,255,0.8)'; }
                        else { c1 = 'rgba(180,107,255,0.8)'; c2 = 'rgba(255,80,80,0.8)'; }
                        pctx.strokeStyle = c1; pctx.beginPath(); pctx.moveTo(cpx, cpy); pctx.lineTo(perp.x1, perp.y1); pctx.stroke();
                        pctx.strokeStyle = c2; pctx.beginPath(); pctx.moveTo(cpx, cpy); pctx.lineTo(perp.x2, perp.y2); pctx.stroke();
                    }
                    pctx.setLineDash([]);
                }

                for (const [px, py] of [[cl.cp1x, cl.cp1y], [cl.cp2x, cl.cp2y]]) {
                    pctx.fillStyle = '#00ffff';
                    pctx.beginPath(); pctx.arc(px, py, 6, 0, Math.PI * 2); pctx.fill();
                    pctx.strokeStyle = '#ffffff'; pctx.lineWidth = 1.5; pctx.stroke();
                }

                if (mmPerPx > 0) {
                    const midX = (ex1 + ex2) / 2, midY = (ey1 + ey2) / 2;
                    pctx.font = '13px sans-serif'; pctx.fillStyle = '#00ffff';
                    pctx.textAlign = 'left';
                    pctx.textBaseline = 'bottom';
                    pctx.fillText('L=' + cl.lengthMm.toFixed(1) + 'mm', midX + dirY * 12, midY - dirX * 12);
                    pctx.textBaseline = 'top';
                    pctx.fillText('W=' + cl.maxWidthMm.toFixed(1) + 'mm', midX + dirY * 12, midY - dirX * 12 + 2);
                }
            }
        }

        // Scale indicator
        if (mmPerPx > 0) {
            const scaleMm = 25;
            const scalePx = Math.round(scaleMm / mmPerPx);
            const pad = 20;
            const originX = w - pad, originY = h - pad;
            pctx.strokeStyle = '#ffffff'; pctx.fillStyle = '#ffffff';
            pctx.lineWidth = 2; pctx.font = '14px sans-serif';
            pctx.textBaseline = 'middle'; pctx.textAlign = 'center';
            pctx.beginPath();
            pctx.moveTo(originX, originY); pctx.lineTo(originX - scalePx, originY);
            pctx.moveTo(originX - scalePx, originY - 6); pctx.lineTo(originX - scalePx, originY + 6);
            pctx.stroke();
            pctx.textBaseline = 'top'; pctx.fillText(scaleMm + 'mm', originX - scalePx / 2, originY + 6);
            pctx.beginPath();
            pctx.moveTo(originX, originY); pctx.lineTo(originX, originY - scalePx);
            pctx.moveTo(originX - 6, originY - scalePx); pctx.lineTo(originX + 6, originY - scalePx);
            pctx.stroke();
            pctx.save();
            pctx.translate(originX + 10, originY - scalePx / 2);
            pctx.rotate(-Math.PI / 2);
            pctx.textBaseline = 'bottom'; pctx.textAlign = 'center';
            pctx.fillText(scaleMm + 'mm', 0, 0);
            pctx.restore();

            const extRadMm = this.extRadiusMm();
            const intRadMm = this.intRadiusMm();
            const extRadPx = extRadMm > 0 ? Math.max(1, Math.round(extRadMm / mmPerPx)) : 0;
            const intRadPx = intRadMm > 0 ? Math.max(1, Math.round(intRadMm / mmPerPx)) : 0;
            const circleX = originX - scalePx / 2, circleY = originY - scalePx / 2;
            pctx.textAlign = 'center'; pctx.textBaseline = 'top'; pctx.lineWidth = 2;
            if (extRadPx > 0) {
                pctx.strokeStyle = '#ff6b6b'; pctx.beginPath();
                pctx.arc(circleX, circleY, extRadPx, 0, Math.PI * 2); pctx.stroke();
                pctx.fillStyle = '#ff6b6b';
                pctx.fillText('ext=' + extRadMm.toFixed(1), circleX, circleY + Math.max(extRadPx, intRadPx || 0) + 4);
            }
            if (intRadPx > 0) {
                pctx.strokeStyle = '#b46bff'; pctx.setLineDash([4, 4]); pctx.beginPath();
                pctx.arc(circleX, circleY, intRadPx, 0, Math.PI * 2); pctx.stroke();
                pctx.setLineDash([]); pctx.fillStyle = '#b46bff';
                const yOff = Math.max(extRadPx || 0, intRadPx) + 4 + (extRadPx > 0 ? 16 : 0);
                pctx.fillText('int=' + intRadMm.toFixed(1), circleX, circleY + yOff);
            }
        }
    }

    private extendLineToPart(cp1x: number, cp1y: number, cp2x: number, cp2y: number, pts: number[][]): { x1: number; y1: number; x2: number; y2: number } {
        const n = pts.length;
        if (n < 3) return { x1: cp1x, y1: cp1y, x2: cp2x, y2: cp2y };
        const dx = cp2x - cp1x, dy = cp2y - cp1y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-6) return { x1: cp1x, y1: cp1y, x2: cp2x, y2: cp2y };
        const ux = dx / len, uy = dy / len;
        const hits: number[] = [];
        for (let i = 0; i < n; i++) {
            const ax = pts[i][0], ay = pts[i][1];
            const bx = pts[(i + 1) % n][0], by = pts[(i + 1) % n][1];
            const ex = bx - ax, ey = by - ay;
            const denom = ux * ey - uy * ex;
            if (Math.abs(denom) < 1e-10) continue;
            const t = ((ax - cp1x) * ey - (ay - cp1y) * ex) / denom;
            const s = ((ax - cp1x) * uy - (ay - cp1y) * ux) / denom;
            if (s >= 0 && s <= 1) hits.push(t);
        }
        if (hits.length < 2) return { x1: cp1x, y1: cp1y, x2: cp2x, y2: cp2y };
        const minT = Math.min(...hits), maxT = Math.max(...hits);
        return { x1: cp1x + ux * minT, y1: cp1y + uy * minT, x2: cp1x + ux * maxT, y2: cp1y + uy * maxT };
    }

    private perpLineAtPoint(px: number, py: number, dirX: number, dirY: number, contourPts: number[][]): { x1: number; y1: number; x2: number; y2: number } {
        const perpX = -dirY, perpY = dirX;
        return this.extendLineToPart(px, py, px + perpX, py + perpY, contourPts);
    }

    private computeMaxWidth(dirX: number, dirY: number, contourPts: number[][]): number {
        const perpX = -dirY, perpY = dirX;
        let minProj = Infinity, maxProj = -Infinity;
        for (const p of contourPts) {
            const proj = p[0] * perpX + p[1] * perpY;
            if (proj < minProj) minProj = proj;
            if (proj > maxProj) maxProj = proj;
        }
        return maxProj - minProj;
    }

    // ── SVG / DXF generation ────────────────────────────────────────────────

    pointsToBezierPath(pts: number[][]): string {
        const n = pts.length;
        if (n < 3) {
            let d = 'M ' + pts[0][0].toFixed(2) + ',' + pts[0][1].toFixed(2);
            for (let i = 1; i < n; i++) d += ' L ' + pts[i][0].toFixed(2) + ',' + pts[i][1].toFixed(2);
            return d + ' Z';
        }
        const isSharp = pts.map((_, i) => {
            const prev = pts[((i - 1) % n + n) % n];
            const curr = pts[i];
            const next = pts[(i + 1) % n];
            return this.vertexAngle(prev, curr, next) < CORNER_ANGLE_THRESHOLD;
        });
        let d = 'M ' + pts[0][0].toFixed(2) + ',' + pts[0][1].toFixed(2);
        for (let i = 0; i < n; i++) {
            const p1 = pts[i], p2 = pts[(i + 1) % n];
            if (isSharp[i] || isSharp[(i + 1) % n]) {
                d += ' L ' + p2[0].toFixed(2) + ',' + p2[1].toFixed(2);
            } else {
                const p0 = pts[((i - 1) % n + n) % n];
                const p3 = pts[(i + 2) % n];
                const [c1x, c1y] = this.clampCP(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p1, p2);
                const [c2x, c2y] = this.clampCP(p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p1, p2);
                d += ' C ' + c1x.toFixed(2) + ',' + c1y.toFixed(2) + ' ' + c2x.toFixed(2) + ',' + c2y.toFixed(2) + ' ' + p2[0].toFixed(2) + ',' + p2[1].toFixed(2);
            }
        }
        return d + ' Z';
    }

    generateDxf(polylinePoints: number[][], centerLine: { x1: number; y1: number; x2: number; y2: number } | null): string {
        let dxf = '0\nSECTION\n2\nHEADER\n';
        dxf += '9\n$INSUNITS\n70\n4\n';
        dxf += '0\nENDSEC\n';
        dxf += '0\nSECTION\n2\nENTITIES\n';
        dxf += '0\nLWPOLYLINE\n8\n0\n90\n' + polylinePoints.length + '\n70\n1\n';
        for (const pt of polylinePoints) {
            dxf += '10\n' + pt[0].toFixed(4) + '\n20\n' + pt[1].toFixed(4) + '\n';
        }
        if (centerLine) {
            dxf += '0\nLINE\n8\nCENTERLINE\n';
            dxf += '10\n' + centerLine.x1.toFixed(4) + '\n20\n' + centerLine.y1.toFixed(4) + '\n';
            dxf += '11\n' + centerLine.x2.toFixed(4) + '\n21\n' + centerLine.y2.toFixed(4) + '\n';
        }
        dxf += '0\nENDSEC\n0\nEOF\n';
        return dxf;
    }
}
