import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { HistoryService, BarcodeHistoryService } from './history.service';

const API_BASE = 'https://dev.letwin.co/api';

describe('HistoryService', () => {
  let service: HistoryService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(HistoryService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getAllHistory', () => {
    it('should GET with default offset and limit', () => {
      const mockData = [{ id: 1, taskID: 10 }];
      service.getAllHistory().subscribe(data => {
        expect(data).toEqual(mockData);
      });
      const req = httpMock.expectOne(`${API_BASE}/planning/taskhistory?offset=0&limit=10`);
      expect(req.request.method).toBe('GET');
      req.flush(mockData);
    });

    it('should GET with custom offset and limit', () => {
      service.getAllHistory(5, 25).subscribe();
      const req = httpMock.expectOne(`${API_BASE}/planning/taskhistory?offset=5&limit=25`);
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });
  });

  describe('getTaskHistory', () => {
    it('should GET history for a specific task', () => {
      const mockData = [{ id: 1, taskID: 42 }];
      service.getTaskHistory(42).subscribe(data => {
        expect(data).toEqual(mockData);
      });
      const req = httpMock.expectOne(`${API_BASE}/planning/taskhistory/task/42`);
      expect(req.request.method).toBe('GET');
      req.flush(mockData);
    });
  });

  describe('getActionTypes', () => {
    it('should GET action types', () => {
      const mockTypes = [{ id: 1, code: 'MOVE', label: 'Moved' }];
      service.getActionTypes().subscribe(data => {
        expect(data).toEqual(mockTypes);
      });
      const req = httpMock.expectOne(`${API_BASE}/planning/taskhistory/actiontypes`);
      expect(req.request.method).toBe('GET');
      req.flush(mockTypes);
    });
  });
});

describe('BarcodeHistoryService', () => {
  let service: BarcodeHistoryService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(BarcodeHistoryService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getAllHistory', () => {
    it('should GET with default offset and limit', () => {
      const mockData = [{ id: 1, barcodeID: 10 }];
      service.getAllHistory().subscribe(data => {
        expect(data).toEqual(mockData);
      });
      const req = httpMock.expectOne(`${API_BASE}/inventory/barcodehistory?offset=0&limit=10`);
      expect(req.request.method).toBe('GET');
      req.flush(mockData);
    });

    it('should GET with custom offset and limit', () => {
      service.getAllHistory(20, 50).subscribe();
      const req = httpMock.expectOne(`${API_BASE}/inventory/barcodehistory?offset=20&limit=50`);
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });
  });

  describe('getBarcodeHistory', () => {
    it('should GET history for a specific barcode', () => {
      const mockData = [{ id: 1, barcodeID: 99 }];
      service.getBarcodeHistory(99).subscribe(data => {
        expect(data).toEqual(mockData);
      });
      const req = httpMock.expectOne(`${API_BASE}/inventory/barcodehistory/barcode/99`);
      expect(req.request.method).toBe('GET');
      req.flush(mockData);
    });
  });

  describe('getActionTypes', () => {
    it('should GET barcode action types', () => {
      const mockTypes = [{ id: 1, code: 'SCAN', label: 'Scanned' }];
      service.getActionTypes().subscribe(data => {
        expect(data).toEqual(mockTypes);
      });
      const req = httpMock.expectOne(`${API_BASE}/inventory/barcodehistory/actiontypes`);
      expect(req.request.method).toBe('GET');
      req.flush(mockTypes);
    });
  });
});
