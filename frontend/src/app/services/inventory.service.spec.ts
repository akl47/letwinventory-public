import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { InventoryService } from './inventory.service';

const API = 'https://dev.letwin.co/api/inventory';
const CONFIG_API = 'https://dev.letwin.co/api/config';

describe('InventoryService', () => {
  let service: InventoryService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(InventoryService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // --- Barcode / Tag ---

  it('getAllTags sends GET to /barcode/tag/', () => {
    service.getAllTags().subscribe();
    const req = httpMock.expectOne(`${API}/barcode/tag/`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getAllBarcodes sends GET to /barcode/', () => {
    service.getAllBarcodes().subscribe();
    const req = httpMock.expectOne(`${API}/barcode/`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getAllBarcodes with includeInactive appends query param', () => {
    service.getAllBarcodes(true).subscribe();
    const req = httpMock.expectOne(`${API}/barcode/?includeInactive=true`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getLocationBarcodes sends GET to /barcode/locations', () => {
    service.getLocationBarcodes().subscribe();
    const req = httpMock.expectOne(`${API}/barcode/locations`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('lookupBarcode sends GET with encoded barcode string', () => {
    service.lookupBarcode('AKL-001').subscribe();
    const req = httpMock.expectOne(`${API}/barcode/lookup/AKL-001`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('getBarcodeZPL sends GET with text responseType', () => {
    service.getBarcodeZPL(5).subscribe();
    const req = httpMock.expectOne(`${API}/barcode/display/5`);
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('text');
    req.flush('^XA^FO10,10^FDTEST^FS^XZ');
  });

  it('getBarcodeZPL with labelSize appends query param', () => {
    service.getBarcodeZPL(5, '1.5x1').subscribe();
    const req = httpMock.expectOne(`${API}/barcode/display/5?labelSize=1.5x1`);
    expect(req.request.method).toBe('GET');
    req.flush('^XA^XZ');
  });

  it('printBarcode sends POST with labelSize', () => {
    service.printBarcode(5, '3x1').subscribe();
    const req = httpMock.expectOne(`${API}/barcode/print/5`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ labelSize: '3x1' });
    req.flush({});
  });

  it('printBarcode with printerIP includes it in body', () => {
    service.printBarcode(5, '3x1', '10.0.0.1').subscribe();
    const req = httpMock.expectOne(`${API}/barcode/print/5`);
    expect(req.request.body).toEqual({ labelSize: '3x1', printerIP: '10.0.0.1' });
    req.flush({});
  });

  it('moveBarcode sends POST with newLocationID', () => {
    service.moveBarcode(10, 20).subscribe();
    const req = httpMock.expectOne(`${API}/barcode/move/10`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ newLocationID: 20 });
    req.flush({});
  });

  it('getTagById sends GET to /barcode/tag/:id', () => {
    service.getTagById(3).subscribe();
    const req = httpMock.expectOne(`${API}/barcode/tag/3`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('getTagChain sends GET to /barcode/tag/chain/:id', () => {
    service.getTagChain(3).subscribe();
    const req = httpMock.expectOne(`${API}/barcode/tag/chain/3`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  // --- Locations & Boxes ---

  it('updateItem for Location sends PUT to /location/:id', () => {
    const item = { type: 'Location', item_id: 1 } as any;
    service.updateItem(item, { name: 'Updated' }).subscribe();
    const req = httpMock.expectOne(`${API}/location/1`);
    expect(req.request.method).toBe('PUT');
    req.flush({});
  });

  it('updateItem for Box sends PUT to /box/:id', () => {
    const item = { type: 'Box', item_id: 2 } as any;
    service.updateItem(item, { name: 'Updated' }).subscribe();
    const req = httpMock.expectOne(`${API}/box/2`);
    expect(req.request.method).toBe('PUT');
    req.flush({});
  });

  it('createItem Location sends POST to /location', () => {
    service.createItem('Location', { name: 'NewLoc', parentBarcodeID: 1 }).subscribe();
    const req = httpMock.expectOne(`${API}/location`);
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('createItem Box sends POST to /box', () => {
    service.createItem('Box', { name: 'NewBox', parentBarcodeID: 1 }).subscribe();
    const req = httpMock.expectOne(`${API}/box`);
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('deleteItem sends DELETE to /barcode/:id', () => {
    const item = { id: 5 } as any;
    service.deleteItem(item).subscribe();
    const req = httpMock.expectOne(`${API}/barcode/5`);
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });

  // --- Traces ---

  it('createTrace sends POST to /trace', () => {
    const data = { partID: 1, quantity: 10 };
    service.createTrace(data).subscribe();
    const req = httpMock.expectOne(`${API}/trace`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(data);
    req.flush({});
  });

  it('splitTrace sends POST to /trace/split/:barcodeId', () => {
    service.splitTrace(5, 25).subscribe();
    const req = httpMock.expectOne(`${API}/trace/split/5`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ splitQuantity: 25 });
    req.flush({});
  });

  it('mergeTrace sends POST to /trace/merge/:targetId', () => {
    service.mergeTrace(5, 10).subscribe();
    const req = httpMock.expectOne(`${API}/trace/merge/5`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ mergeBarcodeId: 10 });
    req.flush({});
  });

  it('deleteTrace sends DELETE to /trace/barcode/:id', () => {
    service.deleteTrace(5).subscribe();
    const req = httpMock.expectOne(`${API}/trace/barcode/5`);
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });

  it('deleteTrace with quantity includes body', () => {
    service.deleteTrace(5, 10).subscribe();
    const req = httpMock.expectOne(`${API}/trace/barcode/5`);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toEqual({ deleteQuantity: 10 });
    req.flush({});
  });

  // --- Parts ---

  it('getAllParts sends GET to /part', () => {
    service.getAllParts().subscribe();
    const req = httpMock.expectOne(`${API}/part`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getPartById sends GET to /part/:id', () => {
    service.getPartById(3).subscribe();
    const req = httpMock.expectOne(`${API}/part/3`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('getPartCategories sends GET to /part/categories', () => {
    service.getPartCategories().subscribe();
    const req = httpMock.expectOne(`${API}/part/categories`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('createPart sends POST to /part', () => {
    service.createPart({ name: 'P1' }).subscribe();
    const req = httpMock.expectOne(`${API}/part`);
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('updatePart sends PUT to /part/:id', () => {
    service.updatePart(3, { name: 'P1-Updated' }).subscribe();
    const req = httpMock.expectOne(`${API}/part/3`);
    expect(req.request.method).toBe('PUT');
    req.flush({});
  });

  it('deletePart sends DELETE to /part/:id', () => {
    service.deletePart(3).subscribe();
    const req = httpMock.expectOne(`${API}/part/3`);
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });

  it('searchPartsByCategory sends GET with params', () => {
    service.searchPartsByCategory('Connectors', 'molex').subscribe();
    const req = httpMock.expectOne(r => r.url === `${API}/part/search`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('category')).toBe('Connectors');
    expect(req.request.params.get('q')).toBe('molex');
    req.flush([]);
  });

  // --- Orders ---

  it('getAllOrders sends GET to /order', () => {
    service.getAllOrders().subscribe();
    const req = httpMock.expectOne(`${API}/order`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getOrderById sends GET to /order/:id', () => {
    service.getOrderById(7).subscribe();
    const req = httpMock.expectOne(`${API}/order/7`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('createOrder sends POST to /order', () => {
    service.createOrder({ description: 'Test Order' }).subscribe();
    const req = httpMock.expectOne(`${API}/order`);
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('updateOrder sends PUT to /order/:id', () => {
    service.updateOrder(7, { description: 'Updated' }).subscribe();
    const req = httpMock.expectOne(`${API}/order/7`);
    expect(req.request.method).toBe('PUT');
    req.flush({});
  });

  it('deleteOrder sends DELETE to /order/:id', () => {
    service.deleteOrder(7).subscribe();
    const req = httpMock.expectOne(`${API}/order/7`);
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });

  it('getOrderStatuses sends GET to /order/statuses', () => {
    service.getOrderStatuses().subscribe();
    const req = httpMock.expectOne(`${API}/order/statuses`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getOrderLineTypes sends GET to /order/line-types', () => {
    service.getOrderLineTypes().subscribe();
    const req = httpMock.expectOne(`${API}/order/line-types`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('bulkImportOrder dryRun sends POST with query param', () => {
    service.bulkImportOrder('csv-data', true, 'Vendor1').subscribe();
    const req = httpMock.expectOne(`${API}/order/bulk-import?dryRun=true`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.csvContent).toBe('csv-data');
    expect(req.request.body.vendor).toBe('Vendor1');
    req.flush({});
  });

  it('bulkImportOrder execute sends POST without query param', () => {
    service.bulkImportOrder('csv-data', false).subscribe();
    const req = httpMock.expectOne(`${API}/order/bulk-import`);
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('bulkImportOrderWithEdits sends POST with items and orderData', () => {
    const items = [{ partName: 'P1', quantity: 5 }] as any;
    const orderData = { vendor: 'V1' };
    service.bulkImportOrderWithEdits(items, orderData).subscribe();
    const req = httpMock.expectOne(`${API}/order/bulk-import`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ items, orderData });
    req.flush({});
  });

  // --- Order Items ---

  it('createOrderItem sends POST to /orderitem', () => {
    service.createOrderItem({ orderID: 1, quantity: 5 } as any).subscribe();
    const req = httpMock.expectOne(`${API}/orderitem`);
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('updateOrderItem sends PUT to /orderitem/:id', () => {
    service.updateOrderItem(3, { quantity: 10 } as any).subscribe();
    const req = httpMock.expectOne(`${API}/orderitem/3`);
    expect(req.request.method).toBe('PUT');
    req.flush({});
  });

  it('deleteOrderItem sends DELETE to /orderitem/:id', () => {
    service.deleteOrderItem(3).subscribe();
    const req = httpMock.expectOne(`${API}/orderitem/3`);
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });

  // --- Equipment ---

  it('getAllEquipment sends GET to /equipment', () => {
    service.getAllEquipment().subscribe();
    const req = httpMock.expectOne(`${API}/equipment`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getEquipmentById sends GET to /equipment/:id', () => {
    service.getEquipmentById(4).subscribe();
    const req = httpMock.expectOne(`${API}/equipment/4`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('createEquipment sends POST to /equipment', () => {
    service.createEquipment({ name: 'EQ1' } as any).subscribe();
    const req = httpMock.expectOne(`${API}/equipment`);
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('updateEquipment sends PUT to /equipment/:id', () => {
    service.updateEquipment(4, { name: 'EQ1-Updated' } as any).subscribe();
    const req = httpMock.expectOne(`${API}/equipment/4`);
    expect(req.request.method).toBe('PUT');
    req.flush({});
  });

  it('deleteEquipment sends DELETE to /equipment/:id', () => {
    service.deleteEquipment(4).subscribe();
    const req = httpMock.expectOne(`${API}/equipment/4`);
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });

  it('receiveEquipment sends POST to /equipment/receive', () => {
    const data = { name: 'EQ1', parentBarcodeID: 5 };
    service.receiveEquipment(data).subscribe();
    const req = httpMock.expectOne(`${API}/equipment/receive`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(data);
    req.flush({});
  });

  // --- Utility ---

  it('getUnitsOfMeasure sends GET to /unitofmeasure', () => {
    service.getUnitsOfMeasure().subscribe();
    const req = httpMock.expectOne(`${API}/unitofmeasure`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getPrinters sends GET to /config/printers', () => {
    service.getPrinters().subscribe();
    const req = httpMock.expectOne(`${CONFIG_API}/printers`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });
});
