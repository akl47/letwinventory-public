import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ScheduledTaskService } from './scheduled-task.service';

const API_URL = 'https://dev.letwin.co/api/planning/scheduled-task';

describe('ScheduledTaskService', () => {
    let service: ScheduledTaskService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideHttpClient(), provideHttpClientTesting()]
        });
        service = TestBed.inject(ScheduledTaskService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    describe('getAll', () => {
        it('should GET /planning/scheduled-task', () => {
            const mockTasks = [{ id: 1, name: 'Weekly task' }];

            service.getAll().subscribe(result => {
                expect(result).toEqual(mockTasks);
            });

            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush(mockTasks);
        });

        it('should use cached result on second call without includeInactive', () => {
            service.getAll().subscribe();
            service.getAll().subscribe();

            // Only one HTTP request
            const req = httpMock.expectOne(API_URL);
            req.flush([]);
        });

        it('should append includeInactive query param and bypass cache', () => {
            // First call without inactive - populates cache
            service.getAll().subscribe();
            httpMock.expectOne(API_URL).flush([]);

            // Call with includeInactive=true should make new request
            service.getAll(true).subscribe();

            const req = httpMock.expectOne(`${API_URL}?includeInactive=true`);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });

    describe('getById', () => {
        it('should GET /planning/scheduled-task/:id', () => {
            service.getById(4).subscribe();

            const req = httpMock.expectOne(`${API_URL}/4`);
            expect(req.request.method).toBe('GET');
            req.flush({ id: 4 });
        });
    });

    describe('create', () => {
        it('should POST to /planning/scheduled-task', () => {
            const newTask = { name: 'Daily cleanup', cronExpression: '0 9 * * *' };

            service.create(newTask).subscribe();

            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('POST');
            expect(req.request.body).toEqual(newTask);
            req.flush({ id: 1, ...newTask });
        });

        it('should clear cache after creating', () => {
            // Populate cache
            service.getAll().subscribe();
            httpMock.expectOne(API_URL).flush([]);

            // Create (clears cache)
            service.create({ name: 'New' }).subscribe();
            httpMock.expectOne(API_URL).flush({ id: 2 });

            // Next getAll should make new request
            service.getAll().subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });

    describe('update', () => {
        it('should PUT to /planning/scheduled-task/:id', () => {
            const updates = { name: 'Updated task' };

            service.update(3, updates).subscribe();

            const req = httpMock.expectOne(`${API_URL}/3`);
            expect(req.request.method).toBe('PUT');
            expect(req.request.body).toEqual(updates);
            req.flush({ id: 3, ...updates });
        });

        it('should clear cache after updating', () => {
            // Populate cache
            service.getAll().subscribe();
            httpMock.expectOne(API_URL).flush([]);

            // Update (clears cache)
            service.update(1, { name: 'Changed' }).subscribe();
            httpMock.expectOne(`${API_URL}/1`).flush({});

            // Next getAll should make new request
            service.getAll().subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });

    describe('delete', () => {
        it('should DELETE /planning/scheduled-task/:id', () => {
            service.delete(7).subscribe();

            const req = httpMock.expectOne(`${API_URL}/7`);
            expect(req.request.method).toBe('DELETE');
            req.flush(null);
        });

        it('should clear cache after deleting', () => {
            // Populate cache
            service.getAll().subscribe();
            httpMock.expectOne(API_URL).flush([]);

            // Delete (clears cache)
            service.delete(1).subscribe();
            httpMock.expectOne(`${API_URL}/1`).flush(null);

            // Next getAll should make new request
            service.getAll().subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });

    describe('clearCache', () => {
        it('should force new HTTP request on next getAll', () => {
            // Populate cache
            service.getAll().subscribe();
            httpMock.expectOne(API_URL).flush([]);

            service.clearCache();

            // Should make a new request
            service.getAll().subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });
});
