import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ToolCatalogView } from './tool-catalog-view';
import { ToolsService } from '../../../services/tools.service';

const millCat = { id: 3, name: 'Mill Tools', activeFlag: true };
const lathCat = { id: 4, name: 'Lathe Tools', activeFlag: true };
const genCat  = { id: 5, name: 'General Purpose', activeFlag: true };

const endMillSub = { id: 12, name: 'Square End Mill', activeFlag: true, categories: [millCat] };
const drillSub   = { id: 27, name: 'Drill Bit',       activeFlag: true, categories: [millCat, lathCat, genCat] };

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
];

const mockCategories = [millCat, lathCat, genCat];
const mockSubcategories = [endMillSub, drillSub];

describe('ToolCatalogView', () => {
  let component: ToolCatalogView;
  let fixture: ComponentFixture<ToolCatalogView>;
  let toolsService: ToolsService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToolCatalogView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
      ],
    }).compileComponents();

    toolsService = TestBed.inject(ToolsService);
    vi.spyOn(toolsService, 'getTools').mockReturnValue(of(mockTools as any));
    vi.spyOn(toolsService, 'getToolCategories').mockReturnValue(of(mockCategories as any));
    vi.spyOn(toolsService, 'getToolSubcategories').mockReturnValue(of(mockSubcategories as any));

    fixture = TestBed.createComponent(ToolCatalogView);
    component = fixture.componentInstance;
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
  });

  it('shows all tools when no filter is applied', () => {
    expect(component.displayedTools().length).toBe(2);
  });

  it('filters by category (M:N traversal)', () => {
    component.onCategoryFilterChange(4); // Lathe Tools
    // Drill Bit belongs to Lathe Tools, Square End Mill does not
    expect(component.displayedTools().length).toBe(1);
    expect(component.displayedTools()[0]?.part?.name).toBe('DR-001');
  });

  it('filters by subcategory', () => {
    component.subcategoryFilter.set(12);
    expect(component.displayedTools().length).toBe(1);
    expect(component.displayedTools()[0]?.part?.name).toBe('EM-001');
  });

  it('filters by search text matching part name', () => {
    component.onSearchChange('EM');
    expect(component.displayedTools().length).toBe(1);
    expect(component.displayedTools()[0]?.part?.name).toBe('EM-001');
  });

  it('filters subcategory dropdown when category is chosen', () => {
    component.onCategoryFilterChange(4); // Lathe Tools
    expect(component.filteredSubcategories().length).toBe(1);
    expect(component.filteredSubcategories()[0].name).toBe('Drill Bit');
  });

  it('clears subcategory filter when it no longer fits the new category', () => {
    component.subcategoryFilter.set(12); // Square End Mill (Mill only)
    component.onCategoryFilterChange(4); // Lathe Tools — doesn't include End Mill
    expect(component.subcategoryFilter()).toBeNull();
  });

  it('renders empty state when no tools match', () => {
    component.onSearchChange('nonexistent');
    expect(component.displayedTools().length).toBe(0);
  });
});
