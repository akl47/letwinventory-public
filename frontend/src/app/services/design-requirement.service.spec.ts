import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { DesignRequirementService } from './design-requirement.service';

const API_URL = 'https://dev.letwin.co/api/design/requirement';

describe('DesignRequirementService', () => {
    let service: DesignRequirementService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideHttpClient(), provideHttpClientTesting()]
        });
        service = TestBed.inject(DesignRequirementService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    describe('getAll', () => {
        it('should GET /design/requirement', () => {
            const mock = [{ id: 1, description: 'Req A' }];

            service.getAll().subscribe(result => {
                expect(result).toEqual(mock);
            });

            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush(mock);
        });

        it('should use cached result on second call without projectID', () => {
            service.getAll().subscribe();
            service.getAll().subscribe();

            // Only one HTTP request should be made
            const req = httpMock.expectOne(API_URL);
            req.flush([]);
        });

        it('should append projectID query param when provided', () => {
            service.getAll(5).subscribe();

            const req = httpMock.expectOne(`${API_URL}?projectID=5`);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });

        it('should not cache when projectID is provided', () => {
            service.getAll(5).subscribe();
            httpMock.expectOne(`${API_URL}?projectID=5`).flush([]);

            service.getAll(5).subscribe();
            const req = httpMock.expectOne(`${API_URL}?projectID=5`);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });

    describe('getById', () => {
        it('should GET /design/requirement/:id', () => {
            service.getById(3).subscribe(result => {
                expect(result.id).toBe(3);
            });

            const req = httpMock.expectOne(`${API_URL}/3`);
            expect(req.request.method).toBe('GET');
            req.flush({ id: 3, description: 'Req' });
        });
    });

    describe('create', () => {
        it('should POST to /design/requirement', () => {
            const data = { description: 'New req', projectID: 1 };

            service.create(data).subscribe();

            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('POST');
            expect(req.request.body).toEqual(data);
            req.flush({ id: 1, ...data });
        });

        it('should clear cache after creating', () => {
            // Populate cache
            service.getAll().subscribe();
            httpMock.expectOne(API_URL).flush([]);

            // Create (clears cache)
            service.create({ description: 'New' }).subscribe();
            httpMock.expectOne(API_URL).flush({ id: 2 });

            // Next getAll should make a new request
            service.getAll().subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });

    describe('update', () => {
        it('should PUT to /design/requirement/:id', () => {
            const data = { description: 'Updated req' };

            service.update(1, data).subscribe();

            const req = httpMock.expectOne(`${API_URL}/1`);
            expect(req.request.method).toBe('PUT');
            expect(req.request.body).toEqual(data);
            req.flush({ id: 1, ...data });
        });

        it('should clear cache after updating', () => {
            service.getAll().subscribe();
            httpMock.expectOne(API_URL).flush([]);

            service.update(1, { description: 'Updated' }).subscribe();
            httpMock.expectOne(`${API_URL}/1`).flush({});

            service.getAll().subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });

    describe('delete', () => {
        it('should DELETE /design/requirement/:id', () => {
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

    describe('approve', () => {
        it('should PUT to /design/requirement/:id/approve', () => {
            service.approve(4).subscribe();

            const req = httpMock.expectOne(`${API_URL}/4/approve`);
            expect(req.request.method).toBe('PUT');
            expect(req.request.body).toEqual({});
            req.flush({ id: 4, approved: true });
        });

        it('should clear cache after approving', () => {
            service.getAll().subscribe();
            httpMock.expectOne(API_URL).flush([]);

            service.approve(1).subscribe();
            httpMock.expectOne(`${API_URL}/1/approve`).flush({});

            service.getAll().subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });

    describe('unapprove', () => {
        it('should PUT to /design/requirement/:id/unapprove', () => {
            service.unapprove(4).subscribe();

            const req = httpMock.expectOne(`${API_URL}/4/unapprove`);
            expect(req.request.method).toBe('PUT');
            expect(req.request.body).toEqual({});
            req.flush({ id: 4, approved: false });
        });

        it('should clear cache after unapproving', () => {
            service.getAll().subscribe();
            httpMock.expectOne(API_URL).flush([]);

            service.unapprove(1).subscribe();
            httpMock.expectOne(`${API_URL}/1/unapprove`).flush({});

            service.getAll().subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });

    describe('takeOwnership', () => {
        it('should PUT to /design/requirement/:id/take-ownership', () => {
            service.takeOwnership(6).subscribe();

            const req = httpMock.expectOne(`${API_URL}/6/take-ownership`);
            expect(req.request.method).toBe('PUT');
            expect(req.request.body).toEqual({});
            req.flush({ id: 6 });
        });

        it('should clear cache after taking ownership', () => {
            service.getAll().subscribe();
            httpMock.expectOne(API_URL).flush([]);

            service.takeOwnership(1).subscribe();
            httpMock.expectOne(`${API_URL}/1/take-ownership`).flush({});

            service.getAll().subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });

    describe('getHistory', () => {
        it('should GET /design/requirement/:id/history', () => {
            const mockHistory = [{ id: 1, changeType: 'created' }];

            service.getHistory(3).subscribe(result => {
                expect(result).toEqual(mockHistory);
            });

            const req = httpMock.expectOne(`${API_URL}/3/history`);
            expect(req.request.method).toBe('GET');
            req.flush(mockHistory);
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
