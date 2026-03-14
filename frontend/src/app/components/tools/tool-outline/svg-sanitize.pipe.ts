import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({ name: 'svgSanitize', standalone: true })
export class SvgSanitizePipe implements PipeTransform {
    private readonly sanitizer = inject(DomSanitizer);

    transform(svg: string): SafeHtml {
        // Strip XML declaration for inline display
        const cleaned = svg.replace(/<\?xml[^?]*\?>\s*/g, '');
        return this.sanitizer.bypassSecurityTrustHtml(cleaned);
    }
}
