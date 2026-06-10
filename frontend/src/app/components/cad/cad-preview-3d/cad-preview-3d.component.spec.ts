import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { CadPreview3dComponent } from './cad-preview-3d.component';

// REQ 711/712 — the interactive commit preview. WebGL is not exercised in the
// Karma headless context (no geometry is flushed), so these cover the
// component's construction and the measure-tool toggle, not the GL render path.
describe('CadPreview3dComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({
    imports: [CadPreview3dComponent],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  }));

  it('creates and starts in the loading state', () => {
    const fixture = TestBed.createComponent(CadPreview3dComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.componentInstance.state()).toBe('loading');
  });

  it('toggles the measure tool on and off', () => {
    const fixture = TestBed.createComponent(CadPreview3dComponent);
    const c = fixture.componentInstance;
    expect(c.measuring()).toBe(false);
    c.toggleMeasure();
    expect(c.measuring()).toBe(true);
    c.toggleMeasure();
    expect(c.measuring()).toBe(false);
    expect(c.measureRows()).toEqual([]);
  });
});
