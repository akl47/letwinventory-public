import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ManufacturingService } from './manufacturing.service';

const API = 'https://dev.letwin.co/api/manufacturing';
const MASTER_API = `${API}/master`;
const STEP_API = `${API}/master-step`;
const WO_API = `${API}/work-order`;

describe('ManufacturingService', () => {
  let service: ManufacturingService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ManufacturingService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // Engineering Master endpoints
  describe('Engineering Masters', () => {
    it('should GET all masters', () => {
      const mock = [{ id: 1, name: 'Test Master' }];
      service.getMasters().subscribe(result => {
        expect(result).toEqual(mock);
      });
      const req = httpMock.expectOne(MASTER_API);
      expect(req.request.method).toBe('GET');
      req.flush(mock);
    });

    it('should GET a single master by id', () => {
      const mock = { id: 1, name: 'Test Master', steps: [] };
      service.getMaster(1).subscribe(result => {
        expect(result).toEqual(mock);
      });
      const req = httpMock.expectOne(`${MASTER_API}/1`);
      expect(req.request.method).toBe('GET');
      req.flush(mock);
    });

    it('should POST to create a master', () => {
      const payload = { name: 'New Master', description: 'Desc', outputParts: [] };
      service.createMaster(payload).subscribe();
      const req = httpMock.expectOne(MASTER_API);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(payload);
      req.flush({ id: 1, ...payload });
    });

    it('should PUT to update a master', () => {
      const payload = { name: 'Updated' };
      service.updateMaster(1, payload).subscribe();
      const req = httpMock.expectOne(`${MASTER_API}/1`);
      expect(req.request.method).toBe('PUT');
      req.flush({ id: 1, ...payload });
    });

    it('should DELETE a master', () => {
      service.deleteMaster(1).subscribe();
      const req = httpMock.expectOne(`${MASTER_API}/1`);
      expect(req.request.method).toBe('DELETE');
      req.flush({});
    });

    it('should POST to submit for review', () => {
      service.submitForReview(1).subscribe();
      const req = httpMock.expectOne(`${MASTER_API}/1/submit-review`);
      expect(req.request.method).toBe('POST');
      req.flush({});
    });

    it('should POST to reject', () => {
      service.reject(1).subscribe();
      const req = httpMock.expectOne(`${MASTER_API}/1/reject`);
      expect(req.request.method).toBe('POST');
      req.flush({});
    });

    it('should POST to release', () => {
      service.release(1).subscribe();
      const req = httpMock.expectOne(`${MASTER_API}/1/release`);
      expect(req.request.method).toBe('POST');
      req.flush({});
    });

    it('should POST to create new revision', () => {
      service.newRevision(1).subscribe();
      const req = httpMock.expectOne(`${MASTER_API}/1/new-revision`);
      expect(req.request.method).toBe('POST');
      req.flush({});
    });

    it('should GET master history', () => {
      service.getHistory(1).subscribe();
      const req = httpMock.expectOne(`${MASTER_API}/1/history`);
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('should GET master revisions', () => {
      service.getRevisions(1).subscribe();
      const req = httpMock.expectOne(`${MASTER_API}/1/revisions`);
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });
  });

  // Step endpoints
  describe('Steps', () => {
    it('should POST to create a step', () => {
      const payload = { engineeringMasterID: 1, title: 'Step 1' };
      service.createStep(payload).subscribe();
      const req = httpMock.expectOne(STEP_API);
      expect(req.request.method).toBe('POST');
      req.flush({ id: 1, ...payload });
    });

    it('should PUT to update a step', () => {
      const payload = { title: 'Updated Step' };
      service.updateStep(1, payload).subscribe();
      const req = httpMock.expectOne(`${STEP_API}/1`);
      expect(req.request.method).toBe('PUT');
      req.flush({ id: 1, ...payload });
    });

    it('should DELETE a step', () => {
      service.deleteStep(1).subscribe();
      const req = httpMock.expectOne(`${STEP_API}/1`);
      expect(req.request.method).toBe('DELETE');
      req.flush({});
    });

    it('should PUT to reorder a step', () => {
      service.reorderStep(1, 25).subscribe();
      const req = httpMock.expectOne(`${STEP_API}/1/reorder`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ stepNumber: 25 });
      req.flush({});
    });
  });

  // Work Order endpoints
  describe('Work Orders', () => {
    it('should GET all work orders', () => {
      service.getWorkOrders().subscribe();
      const req = httpMock.expectOne(WO_API);
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('should GET work orders with status filter', () => {
      service.getWorkOrders('in_progress').subscribe();
      const req = httpMock.expectOne(`${WO_API}?status=in_progress`);
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('should GET a single work order', () => {
      service.getWorkOrder(1).subscribe();
      const req = httpMock.expectOne(`${WO_API}/1`);
      expect(req.request.method).toBe('GET');
      req.flush({});
    });

    it('should POST to create a work order', () => {
      const payload = { engineeringMasterID: 1, quantity: 5 };
      service.createWorkOrder(payload).subscribe();
      const req = httpMock.expectOne(WO_API);
      expect(req.request.method).toBe('POST');
      req.flush({ id: 1, ...payload });
    });

    it('should POST to complete a step', () => {
      service.completeStep(1, 10).subscribe();
      const req = httpMock.expectOne(`${WO_API}/1/complete-step`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ stepID: 10 });
      req.flush({});
    });

    it('should POST to uncomplete a step', () => {
      service.uncompleteStep(1, 10).subscribe();
      const req = httpMock.expectOne(`${WO_API}/1/uncomplete-step`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ stepID: 10 });
      req.flush({});
    });

    it('should POST to complete a work order', () => {
      service.completeWorkOrder(1).subscribe();
      const req = httpMock.expectOne(`${WO_API}/1/complete`);
      expect(req.request.method).toBe('POST');
      req.flush({});
    });

    it('should DELETE a work order with a reason in the body', () => {
      service.deleteWorkOrder(1, 'Created in error').subscribe();
      const req = httpMock.expectOne(`${WO_API}/1`);
      expect(req.request.method).toBe('DELETE');
      expect(req.request.body).toEqual({ deletionReason: 'Created in error' });
      req.flush({});
    });

    it('should POST to undelete a work order', () => {
      service.undeleteWorkOrder(1).subscribe();
      const req = httpMock.expectOne(`${WO_API}/1/undelete`);
      expect(req.request.method).toBe('POST');
      req.flush({});
    });

    it('should pass includeDeleted to getWorkOrders', () => {
      service.getWorkOrders(undefined, true).subscribe();
      const req = httpMock.expectOne(`${WO_API}?includeDeleted=true`);
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });
  });
});
