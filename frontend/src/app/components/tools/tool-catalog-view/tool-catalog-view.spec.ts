import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ToolCatalogView } from './tool-catalog-view';
import { ToolsService } from '../../../services/tools.service';
import { Tool, ToolCategory, ToolSubcategory } from '../../../models/tool.model';

const millCat = { id: 3, name: 'Mill Tools', activeFlag: true } as ToolCategory;
const lathCat = { id: 4, name: 'Lathe Tools', activeFlag: true } as ToolCategory;
const genCat = { id: 5, name: 'General Purpose', activeFlag: true } as ToolCategory;

const endMillSub = { id: 12, name: 'Square End Mill', activeFlag: true, categories: [millCat] } as ToolSubcategory;
const drillSub = { id: 27, name: 'Drill Bit', activeFlag: true, categories: [millCat, lathCat, genCat] } as ToolSubcategory;

const mockTools = [
  {
    id: 1, partID: 10, activeFlag: true,
    part: { id: 10, name: 'EM-001', description: '6mm 4-flute carbide' },
    toolSubcategoryID: 12, toolSubcategory: endMillSub,
    diameter: 6.0, numberOfFlutes: 4, toolMaterial: 'Carbide',
  },
  {
    id: 2, partID: 11, activeFlag: true,
    part: { id: 11, name: 'DR-001', description: '3.5mm HSS twist drill' },
    toolSubcategoryID: 27, toolSubcategory: drillSub,
    diameter: 3.5, numberOfFlutes: 2, toolMaterial: 'HSS',
  },
] as unknown as Tool[];

describe('ToolCatalogView', () => {
  let component: ToolCatalogView;
  let fixture: ComponentFixture<ToolCatalogView>;
  let toolsService: ToolsService;

  beforeEach(async () => {
    // displayLength reads toolUnit from localStorage at construction; reset so
    // tests don't pollute each other via the persisted 'in' setting.
    localStorage.removeItem('toolUnit');

    await TestBed.configureTestingModule({
      imports: [ToolCatalogView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} }, queryParams: of({}) } },
      ],
    }).compileComponents();

    toolsService = TestBed.inject(ToolsService);
    vi.spyOn(toolsService, 'getTools').mockReturnValue(of(mockTools));
    vi.spyOn(toolsService, 'getToolCategories').mockReturnValue(of([millCat, lathCat, genCat]));
    vi.spyOn(toolsService, 'getToolSubcategories').mockReturnValue(of([endMillSub, drillSub]));

    fixture = TestBed.createComponent(ToolCatalogView);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('loads tools, categories and subcategories on init', () => {
    expect(toolsService.getTools).toHaveBeenCalled();
    expect(toolsService.getToolCategories).toHaveBeenCalled();
    expect(toolsService.getToolSubcategories).toHaveBeenCalled();
    expect(component.tools().length).toBe(2);
    expect(component.categories().length).toBe(3);
    expect(component.subcategories().length).toBe(2);
    expect(component.ready()).toBe(true);
  });

  it('renders via <app-data-table>', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-data-table')).toBeTruthy();
  });

  it('exposes a multiSelect filter section for categories with array accessor', () => {
    const section = component.filterSections().find(s => s.key === 'categories');
    if (!section || section.type !== 'multiSelect') {
      throw new Error('expected multiSelect categories section');
    }
    expect(section.options.map(o => o.id)).toEqual([3, 4, 5]);
    // Drill (subcat 27) belongs to all three categories via its M:N link
    expect(section.accessor(mockTools[1])).toEqual([3, 4, 5]);
    // End mill (subcat 12) belongs to only Mill (3)
    expect(section.accessor(mockTools[0])).toEqual([3]);
  });

  it('exposes a multiSelect filter section for subcategories', () => {
    const section = component.filterSections().find(s => s.key === 'subcategories');
    if (!section || section.type !== 'multiSelect') {
      throw new Error('expected multiSelect subcategories section');
    }
    expect(section.options.map(o => o.id)).toEqual([12, 27]);
    expect(section.accessor(mockTools[0])).toBe(12);
  });

  it('displayLength converts mm to inches when unit is in', () => {
    component.onUnitToggle('in');
    expect(component.displayLength(25.4)).toBe('1');
  });

  it('displayLength returns mm value when unit is mm', () => {
    expect(component.displayLength(6)).toBe('6');
  });
});
