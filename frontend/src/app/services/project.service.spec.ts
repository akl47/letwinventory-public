import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ProjectService } from './project.service';

const API_URL = 'https://dev.letwin.co/api/planning/project';

describe('ProjectService', () => {
    let service: ProjectService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideHttpClient(), provideHttpClientTesting()]
        });
        service = TestBed.inject(ProjectService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    describe('getProjects', () => {
        it('should GET /planning/project', () => {
            const mockProjects = [{ id: 1, name: 'Project A' }];

            service.getProjects().subscribe(result => {
                expect(result).toEqual(mockProjects);
            });

            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush(mockProjects);
        });

        it('should use cached result on second call', () => {
            service.getProjects().subscribe();
            service.getProjects().subscribe();

            // Only one HTTP request should be made
            const req = httpMock.expectOne(API_URL);
            req.flush([]);
        });
    });

    describe('getProjectById', () => {
        it('should GET /planning/project/:id', () => {
            service.getProjectById(3).subscribe();

            const req = httpMock.expectOne(`${API_URL}/3`);
            expect(req.request.method).toBe('GET');
            req.flush({ id: 3 });
        });
    });

    describe('createProject', () => {
        it('should POST to /planning/project', () => {
            const newProject = { name: 'New Project' };

            service.createProject(newProject).subscribe();

            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('POST');
            expect(req.request.body).toEqual(newProject);
            req.flush({ id: 1, ...newProject });
        });

        it('should clear cache after creating', () => {
            // Populate cache
            service.getProjects().subscribe();
            httpMock.expectOne(API_URL).flush([]);

            // Create project (clears cache)
            service.createProject({ name: 'New' }).subscribe();
            httpMock.expectOne(API_URL).flush({ id: 2, name: 'New' });

            // Next getProjects should make a new HTTP request
            service.getProjects().subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });

    describe('updateProject', () => {
        it('should PUT to /planning/project/:id', () => {
            const updates = { name: 'Updated' };

            service.updateProject(1, updates).subscribe();

            const req = httpMock.expectOne(`${API_URL}/1`);
            expect(req.request.method).toBe('PUT');
            expect(req.request.body).toEqual(updates);
            req.flush({ id: 1, ...updates });
        });

        it('should clear cache after updating', () => {
            // Populate cache
            service.getProjects().subscribe();
            httpMock.expectOne(API_URL).flush([]);

            // Update project (clears cache)
            service.updateProject(1, { name: 'Updated' }).subscribe();
            httpMock.expectOne(`${API_URL}/1`).flush({});

            // Next getProjects should make a new HTTP request
            service.getProjects().subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });

    describe('deleteProject', () => {
        it('should DELETE /planning/project/:id', () => {
            service.deleteProject(5).subscribe();

            const req = httpMock.expectOne(`${API_URL}/5`);
            expect(req.request.method).toBe('DELETE');
            req.flush(null);
        });

        it('should clear cache after deleting', () => {
            // Populate cache
            service.getProjects().subscribe();
            httpMock.expectOne(API_URL).flush([]);

            // Delete project (clears cache)
            service.deleteProject(1).subscribe();
            httpMock.expectOne(`${API_URL}/1`).flush(null);

            // Next getProjects should make a new HTTP request
            service.getProjects().subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });

    describe('clearCache', () => {
        it('should force new HTTP request on next getProjects', () => {
            // Populate cache
            service.getProjects().subscribe();
            httpMock.expectOne(API_URL).flush([]);

            service.clearCache();

            // Should make a new request
            service.getProjects().subscribe();
            const req = httpMock.expectOne(API_URL);
            expect(req.request.method).toBe('GET');
            req.flush([]);
        });
    });
});
