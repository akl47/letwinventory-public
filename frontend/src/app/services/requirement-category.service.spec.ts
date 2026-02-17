import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { RequirementCategoryService } from './requirement-category.service';

const API_URL = 'https://dev.letwin.co/api/design/requirement-category';

describe('RequirementCategoryService', () => {
    let service: RequirementCategoryService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideHttpClient(), provideHttpClientTesting()]
        });
        service = TestBed.inject(RequirementCategoryService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    describe('getAll', () => {
        it('should GET /design/requirement-category', () => {
            const mock = [{ id: 1, name: 'Functional', activeFlag: true }];

            service.getAll().subscribe(result => {
                expect(result).toEqual(mock);
            });

            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush(mock);
        });

        it('should use cached result on second call', () => {
            service.getAll().subscribe();
            service.getAll().subscribe();

            // Only one HTTP request should be made
            const req = httpMock.expectOne(API_URL);
            req.flush([]);
        });
    });

    describe('create', () => {
        it('should POST to /design/requirement-category', () => {
            const data = { name: 'Performance' };

            service.create(data).subscribe();

            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('POST');
            expect(req.request.body).toEqual(data);
            req.flush({ id: 2, ...data });
        });

        it('should clear cache after creating', () => {
            // Populate cache
            service.getAll().subscribe();
            httpMock.expectOne(API_URL).flush([]);

            // Create (clears cache)
            service.create({ name: 'New' }).subscribe();
            httpMock.expectOne(API_URL).flush({ id: 3, name: 'New' });

            // Next getAll should make a new request
            service.getAll().subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });

    describe('update', () => {
        it('should PUT to /design/requirement-category/:id', () => {
            const data = { name: 'Updated Category' };

            service.update(2, data).subscribe();

            const req = httpMock.expectOne(`${API_URL}/2`);
            expect(req.request.method).toBe('PUT');
            expect(req.request.body).toEqual(data);
            req.flush({ id: 2, ...data });
        });

        it('should clear cache after updating', () => {
            service.getAll().subscribe();
            httpMock.expectOne(API_URL).flush([]);

            service.update(1, { name: 'Updated' }).subscribe();
            httpMock.expectOne(`${API_URL}/1`).flush({});

            service.getAll().subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });

    describe('delete', () => {
        it('should DELETE /design/requirement-category/:id', () => {
            service.delete(5).subscribe();

            const req = httpMock.expectOne(`${API_URL}/5`);
            expect(req.request.method).toBe('DELETE');
            req.flush(null);
        });

        it('should clear cache after deleting', () => {
            service.getAll().subscribe();
            httpMock.expectOne(API_URL).flush([]);

            service.delete(1).subscribe();
            httpMock.expectOne(`${API_URL}/1`).flush(null);

            service.getAll().subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });

    describe('clearCache', () => {
        it('should force new HTTP request on next getAll', () => {
            service.getAll().subscribe();
            httpMock.expectOne(API_URL).flush([]);

            service.clearCache();

            service.getAll().subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });
});
