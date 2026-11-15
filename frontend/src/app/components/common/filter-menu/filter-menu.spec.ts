import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { vi } from 'vitest';

import { FilterMenu, FilterSection } from './filter-menu';

interface Row { active: boolean; category: number; }

// REQ 508 — the reusable filter drop-down.
describe('FilterMenu', () => {
  let component: FilterMenu<Row>;
  let fixture: ComponentFixture<FilterMenu<Row>>;

  const sections: FilterSection<Row>[] = [
    {
      type: 'multiSelect', key: 'categories', label: 'Categories',
      options: [{ id: 1, label: 'Cat-A', colorHex: '#ff0000' }, { id: 2, label: 'Cat-B' }, { id: 3, label: 'Cat-C' }],
      accessor: r => r.category,
    },
    { type: 'toggle', key: 'inactive', label: 'Show Inactive', default: false, predicate: (r, on) => on || r.active },
  ];
  const categories = sections[0] as FilterSection<Row> & { type: 'multiSelect' };

  const setValues = (values: Record<string, unknown>) => {
    fixture.componentRef.setInput('values', values);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FilterMenu],
      providers: [provideAnimationsAsync()],
    }).compileComponents();
    fixture = TestBed.createComponent(FilterMenu<Row>);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('sections', sections);
    setValues({ categories: new Set([1, 2, 3]), inactive: false });
  });

  it('shows the active filter count on the button only when filters are active', () => {
    const badge = () => fixture.nativeElement.querySelector('.filter-badge');
    expect(badge()).toBeNull();
    fixture.componentRef.setInput('activeCount', 2);
    fixture.detectChanges();
    expect(badge().textContent.trim()).toBe('2');
    expect(fixture.nativeElement.querySelector('.filter-btn').classList).toContain('has-filter');
  });

  it('reports all / some / none selected for a group', () => {
    expect(component.isAllSelected(categories)).toBe(true);
    expect(component.isSomeSelected(categories)).toBe(false);
    setValues({ categories: new Set([1]) });
    expect(component.isAllSelected(categories)).toBe(false);
    expect(component.isSomeSelected(categories)).toBe(true);
    expect(component.isSelected('categories', 1)).toBe(true);
    expect(component.isSelected('categories', 2)).toBe(false);
    setValues({ categories: new Set() });
    expect(component.isSomeSelected(categories)).toBe(false);
  });

  it('emits the new selection when an option is toggled, without mutating the input', () => {
    const emit = vi.spyOn(component.valueChange, 'emit');
    const current = new Set([1, 2, 3]);
    setValues({ categories: current });
    component.toggleOption('categories', 2);
    expect(emit).toHaveBeenCalledWith({ key: 'categories', value: new Set([1, 3]) });
    expect(current.size).toBe(3);
    setValues({ categories: new Set([1]) });
    component.toggleOption('categories', 2);
    expect(emit).toHaveBeenLastCalledWith({ key: 'categories', value: new Set([1, 2]) });
  });

  it('the group checkbox clears a full selection and otherwise selects everything', () => {
    const emit = vi.spyOn(component.valueChange, 'emit');
    component.toggleAll(categories);
    expect(emit).toHaveBeenLastCalledWith({ key: 'categories', value: new Set() });
    setValues({ categories: new Set([2]) });
    component.toggleAll(categories);
    expect(emit).toHaveBeenLastCalledWith({ key: 'categories', value: new Set([1, 2, 3]) });
  });

  it('emits a toggle section as a boolean', () => {
    const emit = vi.spyOn(component.valueChange, 'emit');
    component.setToggle('inactive', true);
    expect(emit).toHaveBeenCalledWith({ key: 'inactive', value: true });
  });

  it('renders each multi-select group with its options nested under the group checkbox', async () => {
    fixture.nativeElement.querySelector('[data-testid="filter-menu-button"]').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const group = document.querySelector('[data-testid="filter-group-categories"]')!;
    expect(group.querySelector('.filter-group-head')!.textContent).toContain('Categories');
    expect(group.querySelectorAll('.filter-group-options .filter-option').length).toBe(3);
    expect(group.querySelector('.filter-group-options .option-color')).toBeTruthy();
    // A toggle is a single row with no nested options
    const toggle = document.querySelector('[data-testid="filter-group-inactive"]')!;
    expect(toggle.querySelector('.filter-group-options')).toBeNull();
  });
});
