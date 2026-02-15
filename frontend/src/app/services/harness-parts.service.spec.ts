import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { HarnessPartsService } from './harness-parts.service';

const API = 'https://dev.letwin.co/api';

describe('HarnessPartsService', () => {
  let service: HarnessPartsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(HarnessPartsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // --- File Upload ---

  it('uploadFile reads file and POSTs base64 data', async () => {
    const fileContent = 'test file content';
    const blob = new Blob([fileContent], { type: 'image/png' });
    const file = new File([blob], 'test.png', { type: 'image/png' });

    const resultPromise = new Promise<void>((resolve) => {
      service.uploadFile(file).subscribe(result => {
        expect(result.id).toBe(1);
        expect(result.filename).toBe('test.png');
        resolve();
      });
    });

    // FileReader is async — wait for it to fire then check the HTTP request
    await new Promise(r => setTimeout(r, 100));
    const req = httpMock.expectOne(`${API}/files`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.filename).toBe('test.png');
    expect(req.request.body.mimeType).toBe('image/png');
    expect(req.request.body.data).toBeTruthy();
    req.flush({ id: 1, filename: 'test.png', mimeType: 'image/png', fileSize: 100, createdAt: '2026-01-01' });

    await resultPromise;
  });

  it('deleteFile sends DELETE to /files/:id', () => {
    service.deleteFile(5).subscribe();
    const req = httpMock.expectOne(`${API}/files/5`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ message: 'deleted' });
  });

  // --- Pin Types ---

  it('getPinTypes sends GET to /parts/connector/pin-types', () => {
    service.getPinTypes().subscribe();
    const req = httpMock.expectOne(`${API}/parts/connector/pin-types`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  // --- Wire Ends ---

  it('getWireEnds sends GET to /parts/wire-end', () => {
    service.getWireEnds().subscribe();
    const req = httpMock.expectOne(`${API}/parts/wire-end`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getWireEnds with includeInactive appends query param', () => {
    service.getWireEnds(true).subscribe();
    const req = httpMock.expectOne(`${API}/parts/wire-end?includeInactive=true`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getWireEndByCode sends GET to /parts/wire-end/by-code/:code', () => {
    service.getWireEndByCode('f-pin').subscribe();
    const req = httpMock.expectOne(`${API}/parts/wire-end/by-code/f-pin`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('createWireEnd sends POST to /parts/wire-end', () => {
    const data = { code: 'test', name: 'Test' };
    service.createWireEnd(data).subscribe();
    const req = httpMock.expectOne(`${API}/parts/wire-end`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(data);
    req.flush({});
  });

  it('updateWireEnd sends PUT to /parts/wire-end/:id', () => {
    service.updateWireEnd(3, { name: 'Updated' }).subscribe();
    const req = httpMock.expectOne(`${API}/parts/wire-end/3`);
    expect(req.request.method).toBe('PUT');
    req.flush({});
  });

  it('deleteWireEnd sends DELETE to /parts/wire-end/:id', () => {
    service.deleteWireEnd(3).subscribe();
    const req = httpMock.expectOne(`${API}/parts/wire-end/3`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ message: 'deleted' });
  });

  // --- Connectors ---

  it('getConnectors sends GET to /parts/connector', () => {
    service.getConnectors().subscribe();
    const req = httpMock.expectOne(`${API}/parts/connector`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getConnectors with includeInactive appends query param', () => {
    service.getConnectors(true).subscribe();
    const req = httpMock.expectOne(`${API}/parts/connector?includeInactive=true`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getConnectorById sends GET to /parts/connector/:id', () => {
    service.getConnectorById(5).subscribe();
    const req = httpMock.expectOne(`${API}/parts/connector/5`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('getConnectorByPartId sends GET to /parts/connector/by-part/:partId', () => {
    service.getConnectorByPartId(10).subscribe();
    const req = httpMock.expectOne(`${API}/parts/connector/by-part/10`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('createConnector sends POST to /parts/connector', () => {
    const data = { label: 'J1', type: 'male' as const };
    service.createConnector(data).subscribe();
    const req = httpMock.expectOne(`${API}/parts/connector`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(data);
    req.flush({});
  });

  it('updateConnector sends PUT to /parts/connector/:id', () => {
    service.updateConnector(5, { label: 'J1-Updated' }).subscribe();
    const req = httpMock.expectOne(`${API}/parts/connector/5`);
    expect(req.request.method).toBe('PUT');
    req.flush({});
  });

  it('deleteConnector sends DELETE to /parts/connector/:id', () => {
    service.deleteConnector(5).subscribe();
    const req = httpMock.expectOne(`${API}/parts/connector/5`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ message: 'deleted' });
  });

  it('getConnectors transforms response with image data', () => {
    service.getConnectors().subscribe((connectors) => {
      expect(connectors[0].pinoutDiagramImage).toBe('base64data');
      expect(connectors[0].connectorImage).toBeNull();
    });
    const req = httpMock.expectOne(`${API}/parts/connector`);
    req.flush([{
      id: 1,
      label: 'J1',
      pinoutDiagramFile: { data: 'base64data' },
      connectorImageFile: null,
    }]);
  });

  // --- Wires ---

  it('getWires sends GET to /parts/wire', () => {
    service.getWires().subscribe();
    const req = httpMock.expectOne(`${API}/parts/wire`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getWires with includeInactive appends query param', () => {
    service.getWires(true).subscribe();
    const req = httpMock.expectOne(`${API}/parts/wire?includeInactive=true`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getWireById sends GET to /parts/wire/:id', () => {
    service.getWireById(3).subscribe();
    const req = httpMock.expectOne(`${API}/parts/wire/3`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('getWireByPartId sends GET to /parts/wire/by-part/:partId', () => {
    service.getWireByPartId(10).subscribe();
    const req = httpMock.expectOne(`${API}/parts/wire/by-part/10`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('createWire sends POST to /parts/wire', () => {
    const data = { label: 'W1', color: '#ff0000' };
    service.createWire(data).subscribe();
    const req = httpMock.expectOne(`${API}/parts/wire`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(data);
    req.flush({});
  });

  it('updateWire sends PUT to /parts/wire/:id', () => {
    service.updateWire(3, { label: 'W1-Updated' }).subscribe();
    const req = httpMock.expectOne(`${API}/parts/wire/3`);
    expect(req.request.method).toBe('PUT');
    req.flush({});
  });

  it('deleteWire sends DELETE to /parts/wire/:id', () => {
    service.deleteWire(3).subscribe();
    const req = httpMock.expectOne(`${API}/parts/wire/3`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ message: 'deleted' });
  });

  // --- Cables ---

  it('getCables sends GET to /parts/cable', () => {
    service.getCables().subscribe();
    const req = httpMock.expectOne(`${API}/parts/cable`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getCables with includeInactive appends query param', () => {
    service.getCables(true).subscribe();
    const req = httpMock.expectOne(`${API}/parts/cable?includeInactive=true`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getCableById sends GET to /parts/cable/:id', () => {
    service.getCableById(3).subscribe();
    const req = httpMock.expectOne(`${API}/parts/cable/3`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('getCableByPartId sends GET to /parts/cable/by-part/:partId', () => {
    service.getCableByPartId(10).subscribe();
    const req = httpMock.expectOne(`${API}/parts/cable/by-part/10`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('createCable sends POST to /parts/cable', () => {
    const data = { label: 'C1' };
    service.createCable(data).subscribe();
    const req = httpMock.expectOne(`${API}/parts/cable`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(data);
    req.flush({});
  });

  it('updateCable sends PUT to /parts/cable/:id', () => {
    service.updateCable(3, { label: 'C1-Updated' }).subscribe();
    const req = httpMock.expectOne(`${API}/parts/cable/3`);
    expect(req.request.method).toBe('PUT');
    req.flush({});
  });

  it('deleteCable sends DELETE to /parts/cable/:id', () => {
    service.deleteCable(3).subscribe();
    const req = httpMock.expectOne(`${API}/parts/cable/3`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ message: 'deleted' });
  });

  it('getCables transforms response with image data', () => {
    service.getCables().subscribe((cables) => {
      expect(cables[0].cableDiagramImage).toBe('diagram-data');
    });
    const req = httpMock.expectOne(`${API}/parts/cable`);
    req.flush([{
      id: 1,
      label: 'C1',
      cableDiagramFile: { data: 'diagram-data' },
    }]);
  });

  // --- Components ---

  it('getComponents sends GET to /parts/component', () => {
    service.getComponents().subscribe();
    const req = httpMock.expectOne(`${API}/parts/component`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getComponents with includeInactive appends query param', () => {
    service.getComponents(true).subscribe();
    const req = httpMock.expectOne(`${API}/parts/component?includeInactive=true`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getComponentById sends GET to /parts/component/:id', () => {
    service.getComponentById(3).subscribe();
    const req = httpMock.expectOne(`${API}/parts/component/3`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('getComponentByPartId sends GET to /parts/component/by-part/:partId', () => {
    service.getComponentByPartId(10).subscribe();
    const req = httpMock.expectOne(`${API}/parts/component/by-part/10`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('createComponent sends POST to /parts/component', () => {
    const data = { label: 'R1' };
    service.createComponent(data).subscribe();
    const req = httpMock.expectOne(`${API}/parts/component`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(data);
    req.flush({});
  });

  it('updateComponent sends PUT to /parts/component/:id', () => {
    service.updateComponent(3, { label: 'R1-Updated' }).subscribe();
    const req = httpMock.expectOne(`${API}/parts/component/3`);
    expect(req.request.method).toBe('PUT');
    req.flush({});
  });

  it('deleteComponent sends DELETE to /parts/component/:id', () => {
    service.deleteComponent(3).subscribe();
    const req = httpMock.expectOne(`${API}/parts/component/3`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ message: 'deleted' });
  });

  it('getComponents transforms response with image data', () => {
    service.getComponents().subscribe((components) => {
      expect(components[0].pinoutDiagramImage).toBe('pinout-data');
      expect(components[0].componentImage).toBeNull();
    });
    const req = httpMock.expectOne(`${API}/parts/component`);
    req.flush([{
      id: 1,
      label: 'R1',
      pinoutDiagramFile: { data: 'pinout-data' },
      componentImageFile: null,
    }]);
  });
});
