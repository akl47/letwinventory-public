import { Directive, ElementRef, Input, OnChanges, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

/**
 * Loads an SVG asset via HttpClient and inlines it into the host element.
 * Inlining (vs. <img src>) is required for `currentColor` strokes/fills to inherit
 * the surrounding text color, so the same SVG looks right in light and dark themes.
 *
 * After injection, the directive walks the SVG's dimension-callout group and stamps
 * a `data-dim` attribute on each callout's elements (based on the label text) so the
 * host page can highlight a single dimension via CSS — e.g.,
 * `.tool-diagram[data-highlight="diameter"] [data-dim="diameter"] { color: yellow }`.
 *
 * Usage: <div [appInlineSvg]="'assets/path/to.svg'"></div>
 */
@Directive({
  selector: '[appInlineSvg]',
  standalone: true,
})
export class InlineSvgDirective implements OnChanges {
  @Input('appInlineSvg') src = '';
  private http = inject(HttpClient);
  private el = inject(ElementRef<HTMLElement>);

  ngOnChanges() {
    const host = this.el.nativeElement;
    if (!this.src) {
      host.innerHTML = '';
      return;
    }
    this.http.get(this.src, { responseType: 'text' }).subscribe({
      next: (svg) => {
        host.innerHTML = svg;
        this.markDimensions(host);
      },
      error: () => { host.innerHTML = ''; },
    });
  }

  /**
   * Walk the SVG's dimension-callout group and stamp `data-dim` attributes on each
   * callout's elements. The dimension group is assumed to be the last top-level <g>
   * in the SVG. Within it, callouts are flat sequences of lines/paths followed by a
   * <text> that holds the label — we group everything up to and including each <text>
   * and tag the whole group with the same `data-dim` key derived from the label text.
   */
  private markDimensions(host: HTMLElement) {
    const svg = host.querySelector('svg');
    if (!svg) return;
    const topLevelGroups = Array.from(svg.children).filter(
      (n): n is SVGGElement => n.tagName.toLowerCase() === 'g',
    );
    if (topLevelGroups.length < 2) return;
    const dimGroup = topLevelGroups[topLevelGroups.length - 1];
    let pending: Element[] = [];
    for (const child of Array.from(dimGroup.children)) {
      pending.push(child);
      if (child.tagName.toLowerCase() === 'text') {
        const key = this.textToDimKey(child.textContent || '');
        if (key) {
          for (const el of pending) {
            el.setAttribute('data-dim', key);
          }
        }
        pending = [];
      }
    }
  }

  private textToDimKey(text: string): string | null {
    const t = text.toLowerCase();
    if (t.includes('reduced shank')) return 'reduced-shank';
    if (t.includes('shank')) return 'shank-diameter';
    if (t.includes('overall length')) return 'overall-length';
    if (t.includes('flute length')) return 'flute-length';
    if (t.includes('tip angle')) return 'tip-angle';
    if (t.includes('corner radius')) return 'corner-radius';
    if (t.includes('square drive')) return 'square-drive';
    if (t.includes('number of steps')) return 'number-of-steps';
    if (t.includes('step delta')) return 'step-delta';
    if (t.includes('diameter')) return 'diameter';
    return null;
  }
}
