import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { HarnessService } from './harness.service';

const API_BASE = 'https://dev.letwin.co/api/parts/harness';

describe('HarnessService', () => {
  let service: HarnessService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(HarnessService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getAllHarnesses', () => {
    it('should GET with default params', () => {
      service.getAllHarnesses().subscribe();
      const req = httpMock.expectOne(`${API_BASE}?page=1&limit=20&includeInactive=false`);
      expect(req.request.method).toBe('GET');
      req.flush({ rows: [], count: 0 });
    });

    it('should GET with custom params', () => {
      service.getAllHarnesses(2, 10, true).subscribe();
      const req = httpMock.expectOne(`${API_BASE}?page=2&limit=10&includeInactive=true`);
      expect(req.request.method).toBe('GET');
      req.flush({ rows: [], count: 0 });
    });
  });

  describe('getHarnessById', () => {
    it('should GET harness by id', () => {
      const mock = { id: 5, name: 'Test Harness' };
      service.getHarnessById(5).subscribe(data => {
        expect(data).toEqual(mock);
      });
      const req = httpMock.expectOne(`${API_BASE}/5`);
      expect(req.request.method).toBe('GET');
      req.flush(mock);
    });
  });

  describe('getNextPartNumber', () => {
    it('should GET next part number', () => {
      const mock = { partNumber: 'WH-0042', nextId: 42 };
      service.getNextPartNumber().subscribe(data => {
        expect(data).toEqual(mock);
      });
      const req = httpMock.expectOne(`${API_BASE}/next-part-number`);
      expect(req.request.method).toBe('GET');
      req.flush(mock);
    });
  });

  describe('createHarness', () => {
    it('should POST new harness', () => {
      const payload = { name: 'New Harness' };
      const mock = { id: 1, name: 'New Harness' };
      service.createHarness(payload).subscribe(data => {
        expect(data).toEqual(mock);
      });
      const req = httpMock.expectOne(API_BASE);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(payload);
      req.flush(mock);
    });
  });

  describe('updateHarness', () => {
    it('should PUT updated harness data', () => {
      const payload = { name: 'Updated Name' };
      service.updateHarness(3, payload).subscribe();
      const req = httpMock.expectOne(`${API_BASE}/3`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual(payload);
      req.flush({ id: 3, name: 'Updated Name' });
    });
  });

  describe('deleteHarness', () => {
    it('should DELETE harness by id', () => {
      service.deleteHarness(7).subscribe(data => {
        expect(data).toEqual({ message: 'Harness deleted' });
      });
      const req = httpMock.expectOne(`${API_BASE}/7`);
      expect(req.request.method).toBe('DELETE');
      req.flush({ message: 'Harness deleted' });
    });
  });

  describe('validateHarness', () => {
    it('should POST harness data for validation', () => {
      const harnessData = { connectors: [], cables: [], connections: [] } as any;
      service.validateHarness(harnessData).subscribe();
      const req = httpMock.expectOne(`${API_BASE}/validate`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ harnessData, harnessId: undefined });
      req.flush({ valid: true, errors: [] });
    });

    it('should include harnessId when provided', () => {
      const harnessData = { connectors: [] } as any;
      service.validateHarness(harnessData, 10).subscribe();
      const req = httpMock.expectOne(`${API_BASE}/validate`);
      expect(req.request.body).toEqual({ harnessData, harnessId: 10 });
      req.flush({ valid: true, errors: [] });
    });
  });

  describe('getSubHarnessData', () => {
    it('should GET sub-harness data with comma-separated ids', () => {
      service.getSubHarnessData([1, 2, 3]).subscribe();
      const req = httpMock.expectOne(`${API_BASE}/sub-harness-data?ids=1,2,3`);
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('should return empty array for empty ids without HTTP call', () => {
      service.getSubHarnessData([]).subscribe(data => {
        expect(data).toEqual([]);
      });
      httpMock.expectNone(`${API_BASE}/sub-harness-data`);
    });
  });

  describe('getParentHarnesses', () => {
    it('should GET parent harnesses', () => {
      const mock = [{ id: 1, name: 'Parent' }];
      service.getParentHarnesses(5).subscribe(data => {
        expect(data).toEqual(mock);
      });
      const req = httpMock.expectOne(`${API_BASE}/5/parents`);
      expect(req.request.method).toBe('GET');
      req.flush(mock);
    });
  });

  // REQ 1062–1065 — the version-control verbs mirror CadModelService
  describe('version control', () => {
    const post = (path: string, body: unknown, reply: object = {}) => {
      const req = httpMock.expectOne(`${API_BASE}/4/${path}`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(body);
      req.flush(reply);
    };
    const get = (path: string, reply: object = []) => {
      const req = httpMock.expectOne(`${API_BASE}/4/${path}`);
      expect(req.request.method).toBe('GET');
      req.flush(reply);
    };

    it('checks out, with and without takeover', () => {
      service.checkout(4).subscribe();
      post('checkout', {});
      service.checkout(4, { takeover: true }).subscribe();
      post('checkout', { takeover: true });
    });

    it('checks in with a message and the keep-checked-out flag', () => {
      service.checkin(4, 'add J1', null, true).subscribe();
      post('checkin', { message: 'add J1', keepCheckedOut: true }, { commitHash: 'abc', model: {} });
    });

    it('undoes a checkout and renews the lock', () => {
      service.undoCheckout(4).subscribe();
      post('undo-checkout', {});
      service.renewLock(4).subscribe();
      post('renew-lock', {}, { lockExpiresAt: '' });
    });

    it('reads commits, the working diff and a commit diff', () => {
      service.getCommits(4).subscribe();
      get('commits');
      service.workingDiff(4).subscribe();
      get('working-diff', { baseCommitHash: null, entries: [] });
      service.commitDiff(4, 'aaa', 'bbb').subscribe();
      get('commits/aaa/diff/bbb', { entries: [] });
    });

    it('lists, creates, switches and archives branches', () => {
      service.listBranches(4).subscribe();
      get('branches');
      service.createBranch(4, 'draft/02').subscribe();
      post('branches', { name: 'draft/02', fromCommit: undefined });
      service.switchBranch(4, 'draft/02').subscribe();
      post('switch-branch', { name: 'draft/02' });
      service.archiveBranch(4, 'draft/02').subscribe();
      const req = httpMock.expectOne(`${API_BASE}/4/branches/draft%2F02`);
      expect(req.request.method).toBe('DELETE');
      req.flush({ archived: 'draft/02' });
    });

    it('reads and transitions the review workflow', () => {
      service.getWorkflow(4).subscribe();
      get('workflow', { state: 'draft', actions: [] });
      service.transitionWorkflow(4, 'submit').subscribe();
      post('workflow', { action: 'submit' }, { state: 'in_review', actions: [] });
    });

    it('promotes a released revision to production', () => {
      service.productionRelease(4).subscribe();
      post('production-release', {}, { revision: 'A', model: {} });
    });

    it('opens the harness of a part', () => {
      service.getActiveByPart(9).subscribe();
      const req = httpMock.expectOne(`${API_BASE}/by-part/9/active`);
      expect(req.request.method).toBe('GET');
      req.flush({ id: 4 });
    });
  });

  describe('release', () => {
    it('should POST release', () => {
      service.release(4).subscribe();
      const req = httpMock.expectOne(`${API_BASE}/4/release`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush({ id: 4, releaseState: 'released' });
    });
  });

  describe('getHistory', () => {
    it('should GET revision history', () => {
      service.getHistory(4).subscribe();
      const req = httpMock.expectOne(`${API_BASE}/4/history`);
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });
  });

  describe('getAllRevisions', () => {
    it('should GET all revisions', () => {
      service.getAllRevisions(4).subscribe();
      const req = httpMock.expectOne(`${API_BASE}/4/revisions`);
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });
  });
});
