import { Component, Input, OnChanges, SimpleChanges, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
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
        MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule,
    ],
    template: `
        <button mat-icon-button class="dense-icon-button-2"
            type="button"
            [disabled]="isLoading()"
            [matTooltip]="tooltip()"
            (click)="toggle($event)">
            @if (isLoading()) {
                <mat-spinner diameter="16"></mat-spinner>
            } @else if (isPlaying()) {
                <mat-icon>stop_circle</mat-icon>
            } @else if (isCached()) {
                <mat-icon>volume_up</mat-icon>
            } @else {
                <mat-icon>cloud_download</mat-icon>
            }
        </button>
    `,
})
export class TtsPlayButton implements OnChanges {
    private tts = inject(TtsService);

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

    tooltip = computed(() => {
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
                this.tts.playRequirementAll(id).catch(() => {/* swallow */});
            } else {
                // Not yet cached — queue generation for every field. After
                // the batch resolves, the icon flips to the speaker and a
                // second click starts playback.
                this.tts.queueRequirementAll(id).catch(() => {/* swallow */});
            }
        } else {
            this.tts.toggleRequirementField(id, field).catch(() => {/* swallow */});
        }
    }
}
