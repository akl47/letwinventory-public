import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ToolsService } from './tools.service';

const API = 'https://dev.letwin.co/api/tools';
const TOOL = `${API}/tool`;
const CAT = `${API}/tool-category`;
const SUB = `${API}/tool-subcategory`;

describe('ToolsService', () => {
  let service: ToolsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ToolsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('Tools', () => {
    it('GET all tools', () => {
      service.getTools().subscribe();
      const req = httpMock.expectOne(TOOL);
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('GET tools filtered by categoryID', () => {
      service.getTools({ categoryID: 3 }).subscribe();
      httpMock.expectOne(`${TOOL}?categoryID=3`).flush([]);
    });

    it('GET tools filtered by subcategoryID', () => {
      service.getTools({ subcategoryID: 27 }).subscribe();
      httpMock.expectOne(`${TOOL}?subcategoryID=27`).flush([]);
    });

    it('GET tools with search query', () => {
      service.getTools({ q: 'mill' }).subscribe();
      httpMock.expectOne(`${TOOL}?q=mill`).flush([]);
    });

    it('GET tool by partID', () => {
      service.getToolByPart(42).subscribe();
      const req = httpMock.expectOne(`${TOOL}/by-part/42`);
      expect(req.request.method).toBe('GET');
      req.flush({ id: 1, partID: 42 });
    });

    it('POST creates a tool', () => {
      service.createTool({ partID: 1, toolSubcategoryID: 12, diameter: 6 } as any).subscribe();
      const req = httpMock.expectOne(TOOL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ partID: 1, toolSubcategoryID: 12, diameter: 6 });
      req.flush({ id: 99 });
    });

    it('PUT updates a tool', () => {
      service.updateTool(99, { diameter: 8, activeFlag: true } as any).subscribe();
      const req = httpMock.expectOne(`${TOOL}/99`);
      expect(req.request.method).toBe('PUT');
      req.flush({});
    });

    it('DELETE soft-deletes a tool', () => {
      service.deleteTool(99).subscribe();
      const req = httpMock.expectOne(`${TOOL}/99`);
      expect(req.request.method).toBe('DELETE');
      req.flush({});
    });
  });

  describe('Tool Categories', () => {
    it('GET all categories', () => {
      service.getToolCategories().subscribe();
      httpMock.expectOne(CAT).flush([]);
    });

    it('POST creates a category', () => {
      service.createToolCategory({ name: 'Custom' }).subscribe();
      httpMock.expectOne(CAT).flush({});
    });

    it('PUT updates a category', () => {
      service.updateToolCategory(3, { name: 'Renamed' }).subscribe();
      httpMock.expectOne(`${CAT}/3`).flush({});
    });

    it('DELETE removes a category', () => {
      service.deleteToolCategory(3).subscribe();
      httpMock.expectOne(`${CAT}/3`).flush({});
    });
  });

  describe('Tool Subcategories', () => {
    it('GET all subcategories', () => {
      service.getToolSubcategories().subscribe();
      httpMock.expectOne(SUB).flush([]);
    });

    it('GET subcategories filtered by category', () => {
      service.getToolSubcategories({ categoryID: 3 }).subscribe();
      httpMock.expectOne(`${SUB}?categoryID=3`).flush([]);
    });

    it('POST creates a subcategory with category links', () => {
      service.createToolSubcategory({ name: 'Reamer', categoryIDs: [3, 4, 5] }).subscribe();
      const req = httpMock.expectOne(SUB);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ name: 'Reamer', categoryIDs: [3, 4, 5] });
      req.flush({});
    });

    it('PUT updates a subcategory', () => {
      service.updateToolSubcategory(7, { categoryIDs: [3] }).subscribe();
      const req = httpMock.expectOne(`${SUB}/7`);
      expect(req.request.method).toBe('PUT');
      req.flush({});
    });

    it('DELETE removes a subcategory', () => {
      service.deleteToolSubcategory(7).subscribe();
      httpMock.expectOne(`${SUB}/7`).flush({});
    });
  });
});
