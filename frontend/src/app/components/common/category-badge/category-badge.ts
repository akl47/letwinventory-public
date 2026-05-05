import { Component, Input, booleanAttribute, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

type Variant = 'neutral' | 'success' | 'warning' | 'info' | 'error';

const VARIANT_HEX: Record<Variant, string> = {
    neutral: '#9E9E9E',
    success: '#4CAF50',
    warning: '#FF9800',
    info: '#2196F3',
    error: '#F44336',
};

/**
 * Common pill-style badge used across the app for categories, statuses, and
 * tags. The default style mirrors the original parts-table category badge:
 * uppercase, 12px, 600 weight, 4×12 padding, 12px radius, color tint of 0.2
 * alpha for the bg and the full hex for the foreground.
 *
 *   <app-category-badge label="Kit" colorHex="#4CAF50" />
 *   <app-category-badge label="Approved" variant="success" />
 *   <app-category-badge label="Functional" subtle />
 */
@Component({
    selector: 'app-category-badge',
    standalone: true,
    imports: [CommonModule],
    template: `<span class="badge" [class.subtle]="subtle"
        [style.background-color]="bgColor()"
        [style.color]="fgColor()">{{ label }}</span>`,
    styleUrl: './category-badge.css',
})
export class CategoryBadge {
    private _label = signal('');
    private _hex = signal<string | null>(null);
    private _variant = signal<Variant | null>(null);
    private _subtle = signal(false);

    @Input() set label(v: string | null | undefined) { this._label.set(v ?? ''); }
    get label() { return this._label(); }
    @Input() set colorHex(v: string | null | undefined) { this._hex.set(v ?? null); }
    @Input() set variant(v: Variant | null | undefined) { this._variant.set(v ?? null); }
    @Input({ transform: booleanAttribute }) set subtle(v: boolean) { this._subtle.set(v); }
    get subtle() { return this._subtle(); }

    private resolvedHex = computed(() => {
        const v = this._variant();
        if (v) return VARIANT_HEX[v];
        const h = this._hex();
        if (!h) return null;
        return h.startsWith('#') ? h : `#${h}`;
    });

    bgColor = computed(() => {
        if (this._subtle()) return 'rgba(255, 255, 255, 0.08)';
        const hex = this.resolvedHex();
        return hex ? this.hexToRgba(hex, 0.2) : 'rgba(255, 255, 255, 0.18)';
    });

    fgColor = computed(() => {
        if (this._subtle()) return 'rgba(255, 255, 255, 0.7)';
        return this.resolvedHex() ?? '#9E9E9E';
    });

    private hexToRgba(hex: string, alpha: number): string {
        const h = hex.replace('#', '');
        if (h.length !== 6) return `rgba(255,255,255,${alpha})`;
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
}
