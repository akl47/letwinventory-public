import { Component, Input, OnChanges, SimpleChanges, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TtsService } from '../../../services/tts.service';

/**
 * Dual-mode TTS button for a single requirement field:
 *   - cached on server → speaker icon, click = play (or stop if playing)
 *   - not cached       → download icon, click = generate (will also play once ready)
 *   - in flight        → spinner
 *
 *   <app-tts-play-button [reqId]="r.id" field="description" />
 */
@Component({
    selector: 'app-tts-play-button',
    standalone: true,
    imports: [
        CommonModule,
        MatButtonModule, MatIconModule, MatTooltipModule,
    ],
    template: `
        <button mat-icon-button class="dense-icon-button-2"
            type="button"
            [disabled]="isLoading()"
            [matTooltip]="tooltip()"
            (click)="toggle($event)">
            @if (isLoading()) {
                @if (progress() > 0) {
                    <span class="tts-progress-pct">{{ progress() }}%</span>
                } @else {
                    <mat-icon class="tts-spin">progress_activity</mat-icon>
                }
            } @else if (isPlaying()) {
                <mat-icon>stop_circle</mat-icon>
            } @else if (isCached()) {
                <mat-icon>volume_up</mat-icon>
            } @else {
                <mat-icon>cloud_download</mat-icon>
            }
        </button>
    `,
    styles: [`
        .tts-spin {
            animation: tts-spin-rotate 1s linear infinite;
        }
        @keyframes tts-spin-rotate {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .tts-progress-pct {
            font-size: 10px;
            font-weight: 700;
            line-height: 1;
            letter-spacing: -0.5px;
        }
    `],
})
export class TtsPlayButton implements OnChanges {
    private tts = inject(TtsService);
    private snackBar = inject(MatSnackBar);

    private reqIdSig = signal<number | null>(null);
    private fieldSig = signal<string>('');

    @Input({ required: true }) set reqId(v: number) { this.reqIdSig.set(v); }
    @Input({ required: true }) set field(v: string) { this.fieldSig.set(v); }

    private status = computed(() => {
        const id = this.reqIdSig();
        if (id == null) return null;
        // Subscribing to the status signal here causes Angular to re-run when
        // the cache-status fetch resolves.
        const sig = this.tts.getRequirementStatus(id);
        return sig()[this.fieldSig()];
    });

    isCached = computed(() => this.status() === true);

    isPlaying = computed(() => {
        const id = this.reqIdSig();
        if (id == null) return false;
        return this.tts.isPlaying(this.tts.requirementFieldKey(id, this.fieldSig()));
    });

    isLoading = computed(() => {
        const id = this.reqIdSig();
        if (id == null) return false;
        return this.tts.isLoading(this.tts.requirementFieldKey(id, this.fieldSig()));
    });

    progress = computed(() => {
        const id = this.reqIdSig();
        if (id == null) return 0;
        return this.tts.getProgress(this.tts.requirementFieldKey(id, this.fieldSig()))();
    });

    tooltip = computed(() => {
        if (this.isLoading()) {
            const p = this.progress();
            return p > 0 ? `Generating audio: ${p}%` : 'Generating audio…';
        }
        if (this.isPlaying()) return 'Stop';
        if (this.isCached()) return 'Read aloud';
        return 'Generate audio (read aloud)';
    });

    ngOnChanges(_: SimpleChanges) {
        // Touch the status signal so it kicks off the fetch eagerly.
        const id = this.reqIdSig();
        if (id != null) this.tts.getRequirementStatus(id);
    }

    toggle(ev: Event) {
        ev.stopPropagation();
        const id = this.reqIdSig();
        if (id == null) return;
        const field = this.fieldSig();
        if (field === 'all') {
            if (this.isPlaying()) {
                this.tts.stop();
            } else if (this.isCached()) {
                this.tts.playRequirementAll(id).catch(err => this.reportError(err));
            } else {
                // Not yet cached — queue generation for every field. After
                // the batch resolves, the icon flips to the speaker and a
                // second click starts playback. Errors are surfaced one at a
                // time as each fetch resolves rather than batched at the end.
                this.tts.queueRequirementAll(id, {
                    onError: failure => this.reportFailure(failure),
                }).catch(err => this.reportError(err));
            }
        } else {
            this.tts.toggleRequirementField(id, field).catch(err => this.reportError(err));
        }
    }

    private async reportError(err: unknown, fallback = 'Generate audio failed') {
        const message = (await this.extractMessage(err)) || fallback;
        this.openSnackbar(message);
    }

    private async reportFailure(failure: { field: string; error: unknown }) {
        const detail = (await this.extractMessage(failure.error)) || 'failed';
        this.openSnackbar(`${failure.field}: ${detail}`);
    }

    private async extractMessage(err: unknown): Promise<string | null> {
        // HttpErrorResponse with a Blob body — read it as JSON to extract the
        // backend's error message (the controller returns `{ error: '...' }`).
        const errRecord = err as { error?: unknown; message?: string };
        const errBody = errRecord?.error;
        if (errBody instanceof Blob) {
            try {
                const text = await errBody.text();
                const parsed = JSON.parse(text);
                if (parsed?.error) return String(parsed.error);
            } catch { /* fall through */ }
        }
        if (typeof errBody === 'object' && errBody !== null && 'error' in errBody) {
            return String((errBody as { error: unknown }).error);
        }
        if (typeof errRecord?.message === 'string') return errRecord.message;
        return null;
    }

    private openSnackbar(message: string) {
        this.snackBar.open(message, 'Dismiss', {
            duration: 8000,
            panelClass: 'error-snackbar',
        });
    }
}
