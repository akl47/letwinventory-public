import { Component, Input, inject, signal, OnChanges, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CadModelService } from '../../../services/cad-model.service';

// A static thumbnail of a single commit: the low-res image captured from the
// model's default view at check-in. No live render — just the stored poster;
// commits without a stored image (e.g. pre-thumbnail) show a placeholder.
@Component({
  selector: 'app-cad-mini-preview',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule],
  template: `
    <div class="mp" [style.width.px]="w" [style.height.px]="h">
      <img *ngIf="posterUrl()" class="poster" [src]="posterUrl()" alt="commit preview" />
      <div class="mp-state" *ngIf="state() !== 'ok'">
        <mat-spinner *ngIf="state()==='loading'" [diameter]="Math.min(w,h) > 90 ? 24 : 16"></mat-spinner>
        <span *ngIf="state()==='empty'">no preview</span>
      </div>
    </div>
  `,
  styles: [`
    .mp { position: relative; border-radius: 8px; overflow: hidden; background: #1c1c2a; border: 1px solid #34344a; }
    .poster { display: block; width: 100%; height: 100%; object-fit: cover; }
    .mp-state { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #777; font-size: 12px; }
  `],
})
export class CadMiniPreviewComponent implements OnChanges, OnDestroy {
  @Input() modelId!: number;
  @Input() hash!: string;
  @Input() w = 320;
  @Input() h = 200;

  protected readonly Math = Math;
  private cadApi = inject(CadModelService);
  state = signal<'loading' | 'ok' | 'empty'>('loading');
  posterUrl = signal<string | null>(null);
  private lastKey = '';

  ngOnChanges() { this.load(); }
  ngOnDestroy() { this.revokePoster(); }

  private key() { return `${this.modelId}:${this.hash}`; }

  private load() {
    if (!this.modelId || !this.hash) return;
    const k = this.key();
    if (k === this.lastKey && this.state() === 'ok') return;
    this.lastKey = k;
    this.revokePoster();
    this.state.set('loading');
    // The stored low-res default-view image captured at check-in (instant, no kernel).
    this.cadApi.getCommitThumbnail(this.modelId, this.hash).subscribe({
      next: blob => { if (this.key() === k) { this.posterUrl.set(URL.createObjectURL(blob)); this.state.set('ok'); } },
      error: () => { if (this.key() === k) this.state.set('empty'); },
    });
  }

  private revokePoster() {
    const u = this.posterUrl();
    if (u) { URL.revokeObjectURL(u); this.posterUrl.set(null); }
  }
}
