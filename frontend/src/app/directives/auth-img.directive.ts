import { Directive, ElementRef, Input, OnChanges, OnDestroy, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

/** Global cache: fileId → blob URL. Persists across component lifecycles. */
const blobCache = new Map<number, string>();

@Directive({ selector: '[appAuthImg]', standalone: true })
export class AuthImgDirective implements OnChanges, OnDestroy {
  @Input('appAuthImg') fileId: number | null | undefined;

  private http = inject(HttpClient);
  private el = inject(ElementRef);
  private loadedFileId: number | null = null;

  ngOnChanges() {
    if (!this.fileId) {
      this.el.nativeElement.src = '';
      this.loadedFileId = null;
      return;
    }

    if (this.fileId === this.loadedFileId) return;
    this.loadedFileId = this.fileId;

    // Use cached blob URL if available
    const cached = blobCache.get(this.fileId);
    if (cached) {
      this.el.nativeElement.src = cached;
      return;
    }

    const fileId = this.fileId;
    this.http.get(`${environment.apiUrl}/files/${fileId}/data`, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        blobCache.set(fileId, url);
        // Only set if this is still the current fileId (avoid race conditions)
        if (this.loadedFileId === fileId) {
          this.el.nativeElement.src = url;
        }
      },
      error: () => {
        if (this.loadedFileId === fileId) {
          this.el.nativeElement.src = '';
        }
      },
    });
  }

  ngOnDestroy() {
    // Don't revoke — blob URLs are cached globally for reuse
  }
}
