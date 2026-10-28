import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { CadModelService } from './cad-model.service';

// REQ 987 — every create path checks the new working copy out to the creator.
describe('CadModelService.checkoutCreated', () => {
  let svc: CadModelService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(CadModelService);
  });

  it('checks out the freshly created model and emits it', async () => {
    const checkout = vi.spyOn(svc, 'checkout').mockReturnValue(of({} as any));
    const created = await firstValueFrom(svc.checkoutCreated(of({ id: 42, branchName: 'draft/01' })));
    expect(checkout).toHaveBeenCalledWith(42);
    expect(created).toEqual({ id: 42, branchName: 'draft/01' });
  });

  it('still emits the created model when checkout fails, so the caller can open it', async () => {
    vi.spyOn(svc, 'checkout').mockReturnValue(throwError(() => new Error('423')));
    const created = await firstValueFrom(svc.checkoutCreated(of({ id: 7 })));
    expect(created).toEqual({ id: 7 });
  });

  it('propagates a create failure without attempting checkout', async () => {
    const checkout = vi.spyOn(svc, 'checkout');
    await expect(firstValueFrom(svc.checkoutCreated(throwError(() => new Error('boom')))))
      .rejects.toThrow('boom');
    expect(checkout).not.toHaveBeenCalled();
  });
});
