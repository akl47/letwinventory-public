// REQ 1030 — multi-body export: choose bodies, one file or one per body.
import { TestBed } from '@angular/core/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { describe, it, expect, vi } from 'vitest';
import { CadExportDialogComponent, type ExportDialogData } from './cad-export-dialog.component';

function create(data: ExportDialogData) {
  const ref = { close: vi.fn() };
  TestBed.configureTestingModule({
    imports: [CadExportDialogComponent],
    providers: [provideAnimationsAsync(), { provide: MAT_DIALOG_DATA, useValue: data }, { provide: MatDialogRef, useValue: ref }],
  });
  const c = TestBed.createComponent(CadExportDialogComponent).componentInstance;
  return { c, ref };
}

const bodies = [{ id: 'a', label: 'Body 1' }, { id: 'b', label: 'Body 2' }, { id: 'c', label: 'Body 3' }];
const vars = { partNumber: 'P1', rev: '02' };

describe('CadExportDialogComponent (REQ 1030)', () => {
  it('starts with the given bodies ticked', () => {
    const { c } = create({ format: 'STEP', bodies, vars, selected: ['a', 'c'] });
    expect(c.isSelected('a')).toBe(true);
    expect(c.isSelected('b')).toBe(false);
    expect(c.isSelected('c')).toBe(true);
  });

  it('ticks every body when no selection is given', () => {
    const { c } = create({ format: 'STEP', bodies, vars });
    expect(c.selectedCount()).toBe(3);
  });

  it('exports the ticked bodies as one file by default', () => {
    const { c, ref } = create({ format: 'STEP', bodies, vars, selected: ['b', 'a'] });
    c.confirm();
    expect(ref.close).toHaveBeenCalledWith(expect.objectContaining({ bodyIds: ['a', 'b'], separate: false }));
  });

  it('exports one file per body when separate is ticked', () => {
    const { c, ref } = create({ format: 'STL', bodies, vars });
    c.separate.set(true);
    c.confirm();
    expect(ref.close).toHaveBeenCalledWith(expect.objectContaining({ bodyIds: ['a', 'b', 'c'], separate: true }));
  });
});
