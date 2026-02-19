import { Component, OnInit, OnDestroy, signal, computed, ElementRef, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { forkJoin } from 'rxjs';
import { InventoryService, InventoryTag, Barcode } from '../../../services/inventory.service';
import { inject } from '@angular/core';
import { Location } from '@angular/common';

type ScannerState =
    | 'unsupported'
    | 'scanning'
    | 'loading'
    | 'display'
    | 'scanning_second'
    | 'confirming_second'
    | 'confirming_action'
    | 'executing'
    | 'result'
    | 'error';

type SecondScanAction = 'move' | 'merge';

@Component({
    selector: 'app-mobile-scanner',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatFormFieldModule,
        MatInputModule,
        MatTooltipModule,
    ],
    templateUrl: './mobile-scanner.html',
    styleUrl: './mobile-scanner.css',
})
export class MobileScanner implements OnInit, OnDestroy {
    private inventoryService = inject(InventoryService);
    private location = inject(Location);

    videoEl = viewChild<ElementRef<HTMLVideoElement>>('videoElement');

    state = signal<ScannerState>('scanning');
    errorMessage = signal('');
    resultMessage = signal('');
    resultSuccess = signal(true);

    // Scanned item data
    scannedBarcode = signal<Barcode | null>(null);
    scannedTag = signal<InventoryTag | null>(null);
    tagChain = signal<InventoryTag[]>([]);

    // Second scan context
    secondScanAction = signal<SecondScanAction | null>(null);
    secondScanInstruction = signal('');
    secondScannedBarcode = signal<Barcode | null>(null);
    secondScannedTag = signal<InventoryTag | null>(null);

    // Split / trash quantity
    splitQuantity = signal<number>(1);
    trashQuantity = signal<number>(1);
    trashAll = signal(false);
    confirmAction = signal<'split' | 'trash' | null>(null);

    // Scan mode
    continuousScan = signal(true);

    // Camera / detector
    private stream: MediaStream | null = null;
    private detector: any = null;
    private animFrameId = 0;
    private scanDebounceMs = 1500;
    private lastScanTime = 0;
    private scanPaused = false;

    isTrace = computed(() => this.scannedTag()?.type === 'Trace');

    locationChain = computed(() => {
        const chain = this.tagChain();
        if (chain.length <= 1) return [];
        // Chain is [self, parent, grandparent, ...] — reverse and skip self
        return chain.slice(1).reverse();
    });

    ngOnInit() {
        if (!('BarcodeDetector' in window)) {
            this.state.set('unsupported');
            return;
        }
        this.initDetector();
        this.startCamera();
    }

    ngOnDestroy() {
        this.stopCamera();
    }

    private initDetector() {
        this.detector = new (window as any).BarcodeDetector({
            formats: ['code_128', 'code_39', 'qr_code', 'ean_13', 'ean_8'],
        });
    }

    private async startCamera() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' },
            });
            const video = this.videoEl()?.nativeElement;
            if (video) {
                video.srcObject = this.stream;
                video.onloadedmetadata = () => {
                    video.play();
                    this.startDetectionLoop();
                };
            }
        } catch {
            this.state.set('error');
            this.errorMessage.set('Could not access camera. Please grant camera permission and try again.');
        }
    }

    private stopCamera() {
        cancelAnimationFrame(this.animFrameId);
        this.animFrameId = 0;
        if (this.stream) {
            this.stream.getTracks().forEach((t) => t.stop());
            this.stream = null;
        }
    }

    private startDetectionLoop() {
        const video = this.videoEl()?.nativeElement;
        if (!video || !this.detector) return;

        const detect = async () => {
            const currentState = this.state();
            if (currentState !== 'scanning' && currentState !== 'scanning_second') {
                this.animFrameId = requestAnimationFrame(detect);
                return;
            }

            if (video.readyState < 2 || this.scanPaused) {
                this.animFrameId = requestAnimationFrame(detect);
                return;
            }

            // In manual mode, only scan when triggered
            if (!this.continuousScan() && currentState === 'scanning') {
                this.animFrameId = requestAnimationFrame(detect);
                return;
            }

            const now = Date.now();
            if (now - this.lastScanTime < this.scanDebounceMs) {
                this.animFrameId = requestAnimationFrame(detect);
                return;
            }

            try {
                const barcodes = await this.detector.detect(video);
                if (barcodes.length > 0) {
                    this.lastScanTime = now;
                    this.onBarcodeDetected(this.closestToCenter(barcodes, video).rawValue);
                }
            } catch {
                // Detection error, continue loop
            }

            this.animFrameId = requestAnimationFrame(detect);
        };

        this.animFrameId = requestAnimationFrame(detect);
    }

    private closestToCenter(barcodes: any[], video: HTMLVideoElement): any {
        if (barcodes.length === 1) return barcodes[0];
        const cx = video.videoWidth / 2;
        const cy = video.videoHeight / 2;
        let best = barcodes[0];
        let bestDist = Infinity;
        for (const b of barcodes) {
            const box = b.boundingBox;
            const dx = box.x + box.width / 2 - cx;
            const dy = box.y + box.height / 2 - cy;
            const dist = dx * dx + dy * dy;
            if (dist < bestDist) {
                bestDist = dist;
                best = b;
            }
        }
        return best;
    }

    toggleScanMode() {
        this.continuousScan.set(!this.continuousScan());
    }

    manualScan() {
        const video = this.videoEl()?.nativeElement;
        if (!video || !this.detector || video.readyState < 2) return;

        this.detector.detect(video).then((barcodes: any[]) => {
            if (barcodes.length > 0) {
                this.lastScanTime = Date.now();
                this.onBarcodeDetected(this.closestToCenter(barcodes, video).rawValue);
            }
        }).catch(() => {});
    }

    private onBarcodeDetected(rawValue: string) {
        const currentState = this.state();

        if (currentState === 'scanning') {
            this.handleFirstScan(rawValue);
        } else if (currentState === 'scanning_second') {
            this.handleSecondScan(rawValue);
        }
    }

    private handleFirstScan(barcodeString: string) {
        this.state.set('loading');

        this.inventoryService.lookupBarcode(barcodeString).subscribe({
            next: (barcode) => {
                this.scannedBarcode.set(barcode);
                forkJoin({
                    tag: this.inventoryService.getTagById(barcode.id),
                    chain: this.inventoryService.getTagChain(barcode.id),
                }).subscribe({
                    next: ({ tag, chain }) => {
                        this.scannedTag.set(tag);
                        this.tagChain.set(chain);
                        this.state.set('display');
                        this.stopCamera();
                    },
                    error: () => {
                        this.state.set('error');
                        this.errorMessage.set('Failed to load item details.');
                    },
                });
            },
            error: () => {
                this.state.set('error');
                this.errorMessage.set(`Barcode "${barcodeString}" not found.`);
            },
        });
    }

    private handleSecondScan(barcodeString: string) {
        this.state.set('loading');
        this.stopCamera();

        this.inventoryService.lookupBarcode(barcodeString).subscribe({
            next: (destBarcode) => {
                this.secondScannedBarcode.set(destBarcode);
                this.inventoryService.getTagById(destBarcode.id).subscribe({
                    next: (tag) => {
                        this.secondScannedTag.set(tag);
                        this.state.set('confirming_second');
                    },
                    error: () => {
                        this.showResult(false, 'Failed to load destination details.');
                    },
                });
            },
            error: () => {
                this.showResult(false, `Destination barcode "${barcodeString}" not found.`);
            },
        });
    }

    // Action handlers
    startMove() {
        this.secondScanAction.set('move');
        this.secondScanInstruction.set('Scan destination location or box');
        this.state.set('scanning_second');
        this.startCamera();
    }

    startMerge() {
        this.secondScanAction.set('merge');
        this.secondScanInstruction.set('Scan target barcode to merge into');
        this.state.set('scanning_second');
        this.startCamera();
    }

    startSplit() {
        this.splitQuantity.set(1);
        this.confirmAction.set('split');
        this.state.set('confirming_action');
    }

    startTrash() {
        this.trashQuantity.set(1);
        this.trashAll.set(false);
        this.confirmAction.set('trash');
        this.state.set('confirming_action');
    }

    toggleTrashAll() {
        const all = !this.trashAll();
        this.trashAll.set(all);
        if (all) {
            this.trashQuantity.set(this.scannedTag()?.quantity ?? 1);
        } else {
            this.trashQuantity.set(1);
        }
    }

    confirmSplit() {
        this.state.set('executing');
        const barcodeId = this.scannedBarcode()!.id;
        this.inventoryService.splitTrace(barcodeId, this.splitQuantity()).subscribe({
            next: () => this.showResult(true, `Split ${this.splitQuantity()} from item.`),
            error: (err) => this.showResult(false, err?.error?.message || 'Split failed.'),
        });
    }

    confirmTrash() {
        this.state.set('executing');
        const tag = this.scannedTag()!;
        const barcode = this.scannedBarcode()!;

        if (tag.type === 'Trace') {
            const qty = this.trashAll() ? undefined : this.trashQuantity();
            this.inventoryService.deleteTrace(barcode.id, qty).subscribe({
                next: () => this.showResult(true, this.trashAll() ? 'All quantity trashed.' : `Trashed ${qty} from item.`),
                error: (err) => this.showResult(false, err?.error?.message || 'Trash failed.'),
            });
        } else {
            this.inventoryService.deleteItem(tag).subscribe({
                next: () => this.showResult(true, 'Item deleted.'),
                error: (err) => this.showResult(false, err?.error?.message || 'Delete failed.'),
            });
        }
    }

    cancelAction() {
        this.state.set('display');
    }

    cancelSecondScan() {
        this.stopCamera();
        this.state.set('display');
    }

    confirmSecondAction() {
        this.state.set('executing');
        const action = this.secondScanAction();
        const scannedId = this.scannedBarcode()!.id;
        const destId = this.secondScannedBarcode()!.id;

        if (action === 'move') {
            this.inventoryService.moveBarcode(scannedId, destId).subscribe({
                next: () => this.showResult(true, 'Item moved successfully.'),
                error: (err) => this.showResult(false, err?.error?.message || 'Move failed.'),
            });
        } else if (action === 'merge') {
            this.inventoryService.mergeTrace(destId, scannedId).subscribe({
                next: () => this.showResult(true, 'Items merged successfully.'),
                error: (err) => this.showResult(false, err?.error?.message || 'Merge failed.'),
            });
        }
    }

    cancelSecondAction() {
        this.secondScannedBarcode.set(null);
        this.secondScannedTag.set(null);
        this.state.set('display');
    }

    scanAgain() {
        this.resetState();
        this.startCamera();
    }

    tryAgain() {
        this.resetState();
        this.startCamera();
    }

    private resetState() {
        this.scannedBarcode.set(null);
        this.scannedTag.set(null);
        this.tagChain.set([]);
        this.secondScanAction.set(null);
        this.secondScannedBarcode.set(null);
        this.secondScannedTag.set(null);
        this.confirmAction.set(null);
        this.errorMessage.set('');
        this.resultMessage.set('');
        this.state.set('scanning');
    }

    private showResult(success: boolean, message: string) {
        this.resultSuccess.set(success);
        this.resultMessage.set(message);
        this.state.set(success ? 'result' : 'error');
    }

    goBack() {
        this.location.back();
    }

    getTypeBadgeClass(): string {
        const type = this.scannedTag()?.type;
        switch (type) {
            case 'Location': return 'badge-location';
            case 'Box': return 'badge-box';
            case 'Trace': return 'badge-trace';
            case 'Equipment': return 'badge-equipment';
            default: return '';
        }
    }
}
