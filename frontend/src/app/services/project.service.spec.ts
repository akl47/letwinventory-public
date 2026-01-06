import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ProjectService } from './project.service';

describe('ProjectService', () => {
  let service: ProjectService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ProjectService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });

    service = TestBed.inject(ProjectService);
    httpMock = TestBed.inject(HttpTestingController);
    localStorage.setItem('auth_token', 'test-token');
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getProjects', () => {
    it('should fetch all projects', (done) => {
      const mockProjects = [
        { id: 1, name: 'Project 1', description: 'Description 1' },
        { id: 2, name: 'Project 2', description: 'Description 2' }
      ];

      service.getProjects().subscribe(projects => {
        expect(projects).toEqual(mockProjects);
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/planning/project');
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe('Bearer test-token');
      req.flush(mockProjects);
    });

    it('should cache projects on subsequent calls', (done) => {
      const mockProjects = [
        { id: 1, name: 'Project 1' }
      ];

      // First call
      service.getProjects().subscribe();
      const req1 = httpMock.expectOne('http://localhost:3000/api/planning/project');
      req1.flush(mockProjects);

      // Second call should use cache
      service.getProjects().subscribe(projects => {
        expect(projects).toEqual(mockProjects);
        done();
      });

      // No additional HTTP request should be made
      httpMock.expectNone('http://localhost:3000/api/planning/project');
    });
  });

  describe('clearCache', () => {
    it('should clear the cached projects', (done) => {
      const mockProjects1 = [{ id: 1, name: 'Project 1' }];
      const mockProjects2 = [{ id: 2, name: 'Project 2' }];

      // First call
      service.getProjects().subscribe();
      const req1 = httpMock.expectOne('http://localhost:3000/api/planning/project');
      req1.flush(mockProjects1);

      // Clear cache
      service.clearCache();

      // Second call should make a new HTTP request
      service.getProjects().subscribe(projects => {
        expect(projects).toEqual(mockProjects2);
        done();
      });

      const req2 = httpMock.expectOne('http://localhost:3000/api/planning/project');
      req2.flush(mockProjects2);
    });
  });
});
