import { Injectable, signal } from '@angular/core';
import type { KernelAdapter } from '../cad/lib/featureTree';
import { makeOccKernel } from '../cad/lib/kernel';

/**
 * Lazy-loads the opencascade.js WASM kernel. Singleton-promise pattern so
 * concurrent calls share a single load. ~53 MB of WASM, so this is gated
 * behind a dynamic import and cached for the lifetime of the page.
 */
@Injectable({ providedIn: 'root' })
export class CadKernelService {
  private kernelPromise: Promise<KernelAdapter> | null = null;
  readonly loading = signal<boolean>(false);
  readonly loaded = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  load(): Promise<KernelAdapter> {
    if (this.kernelPromise) return this.kernelPromise;
    this.loading.set(true);
    this.error.set(null);
    this.kernelPromise = (async () => {
      try {
        const occModule = await import(/* @vite-ignore */ 'opencascade.js');
        const initOpenCascade: any = (occModule as any).initOpenCascade || (occModule as any).default;
        const oc = await initOpenCascade();
        const kernel = makeOccKernel(oc);
        this.loaded.set(true);
        return kernel;
      } catch (e: any) {
        this.error.set(e?.message || String(e));
        this.kernelPromise = null;
        throw e;
      } finally {
        this.loading.set(false);
      }
    })();
    return this.kernelPromise;
  }
}
