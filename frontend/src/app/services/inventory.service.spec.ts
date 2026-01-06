import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { InventoryService } from './inventory.service';

describe('InventoryService', () => {
  let service: InventoryService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        InventoryService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });

    service = TestBed.inject(InventoryService);
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

  describe('getAllTags', () => {
    it('should fetch all inventory tags', (done) => {
      const mockTags = [
        { id: 1, name: 'Tag 1', type: 'Location' },
        { id: 2, name: 'Tag 2', type: 'Box' }
      ];

      service.getAllTags().subscribe(tags => {
        expect(tags).toEqual(mockTags);
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/barcode/tag/');
      expect(req.request.method).toBe('GET');
      req.flush(mockTags);
    });
  });

  describe('updateItem', () => {
    it('should update a Location item', (done) => {
      const item = { id: 1, item_id: 1, type: 'Location' as const, name: 'Old Name', barcode: 'BC001' };
      const updateData = { name: 'New Name', description: 'Updated description' };

      service.updateItem(item, updateData).subscribe(result => {
        expect(result).toBeTruthy();
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/location/1');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual(updateData);
      req.flush({ success: true });
    });

    it('should update a Box item', (done) => {
      const item = { id: 2, item_id: 2, type: 'Box' as const, name: 'Old Box', barcode: 'BC002' };
      const updateData = { name: 'New Box' };

      service.updateItem(item, updateData).subscribe(result => {
        expect(result).toBeTruthy();
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/box/2');
      expect(req.request.method).toBe('PUT');
      req.flush({ success: true });
    });

    it('should return error for unsupported item type', (done) => {
      const item = { id: 3, item_id: 3, type: 'Unknown' as any, name: 'Unknown', barcode: 'BC003' };
      const updateData = { name: 'New Name' };

      service.updateItem(item, updateData).subscribe({
        error: (err) => {
          expect(err).toContain('Update not implemented');
          done();
        }
      });
    });
  });

  describe('createItem', () => {
    it('should create a new Location', (done) => {
      const createData = { name: 'New Location', description: 'A new location', parentBarcodeID: 0 };

      service.createItem('Location', createData).subscribe(result => {
        expect(result).toBeTruthy();
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/location');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(createData);
      req.flush({ id: 1, ...createData });
    });

    it('should create a new Box', (done) => {
      const createData = { name: 'New Box', parentBarcodeID: 1 };

      service.createItem('Box', createData).subscribe(result => {
        expect(result).toBeTruthy();
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/box');
      expect(req.request.method).toBe('POST');
      req.flush({ id: 1, ...createData });
    });
  });

  describe('deleteItem', () => {
    it('should delete an inventory item', (done) => {
      const item = { id: 1, item_id: 1, type: 'Location' as const, name: 'Delete Me', barcode: 'BC001' };

      service.deleteItem(item).subscribe(result => {
        expect(result).toBeTruthy();
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/barcode/1');
      expect(req.request.method).toBe('DELETE');
      req.flush({ success: true });
    });
  });

  describe('Parts operations', () => {
    it('should get all parts', (done) => {
      const mockParts = [
        { id: 1, name: 'Part 1', vendor: 'Vendor A' },
        { id: 2, name: 'Part 2', vendor: 'Vendor B' }
      ];

      service.getAllParts().subscribe(parts => {
        expect(parts).toEqual(mockParts);
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/part');
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe('Bearer test-token');
      req.flush(mockParts);
    });

    it('should create a new part', (done) => {
      const newPart = {
        name: 'New Part',
        vendor: 'Test Vendor',
        internalPart: true,
        minimumOrderQuantity: 5,
        partCategoryID: 1
      };

      service.createPart(newPart).subscribe(result => {
        expect(result.id).toBe(1);
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/part');
      expect(req.request.method).toBe('POST');
      req.flush({ id: 1, ...newPart });
    });

    it('should update a part', (done) => {
      const updateData = { name: 'Updated Part' };

      service.updatePart(1, updateData).subscribe(result => {
        expect(result).toBeTruthy();
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/part/1');
      expect(req.request.method).toBe('PUT');
      req.flush({ id: 1, ...updateData });
    });

    it('should delete a part', (done) => {
      service.deletePart(1).subscribe(result => {
        expect(result).toBeTruthy();
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/part/1');
      expect(req.request.method).toBe('DELETE');
      req.flush({ success: true });
    });
  });

  describe('Order operations', () => {
    it('should get all orders', (done) => {
      const mockOrders = [
        { id: 1, description: 'Order 1', vendor: 'Vendor A' },
        { id: 2, description: 'Order 2', vendor: 'Vendor B' }
      ];

      service.getAllOrders().subscribe(orders => {
        expect(orders).toEqual(mockOrders);
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/order');
      expect(req.request.method).toBe('GET');
      req.flush(mockOrders);
    });

    it('should get order by ID', (done) => {
      const mockOrder = { id: 1, description: 'Test Order' };

      service.getOrderById(1).subscribe(order => {
        expect(order).toEqual(mockOrder);
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/order/1');
      expect(req.request.method).toBe('GET');
      req.flush(mockOrder);
    });

    it('should create a new order', (done) => {
      const newOrder = { description: 'New Order', vendor: 'Test Vendor', orderStatusID: 1 };

      service.createOrder(newOrder).subscribe(result => {
        expect(result.id).toBe(1);
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/order');
      expect(req.request.method).toBe('POST');
      req.flush({ id: 1, ...newOrder });
    });

    it('should update an order', (done) => {
      const updateData = { description: 'Updated Order' };

      service.updateOrder(1, updateData).subscribe(result => {
        expect(result).toBeTruthy();
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/order/1');
      expect(req.request.method).toBe('PUT');
      req.flush({ id: 1, ...updateData });
    });

    it('should delete an order', (done) => {
      service.deleteOrder(1).subscribe(result => {
        expect(result).toBeTruthy();
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/order/1');
      expect(req.request.method).toBe('DELETE');
      req.flush({ success: true });
    });
  });

  describe('OrderItem operations', () => {
    it('should create order item', (done) => {
      const newItem = { orderID: 1, lineNumber: 1, quantity: 5 };

      service.createOrderItem(newItem).subscribe(result => {
        expect(result.id).toBe(1);
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/orderitem');
      expect(req.request.method).toBe('POST');
      req.flush({ id: 1, ...newItem });
    });

    it('should update order item', (done) => {
      const updateData = { quantity: 10 };

      service.updateOrderItem(1, updateData).subscribe(result => {
        expect(result).toBeTruthy();
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/orderitem/1');
      expect(req.request.method).toBe('PUT');
      req.flush({ id: 1, ...updateData });
    });

    it('should delete order item', (done) => {
      service.deleteOrderItem(1).subscribe(result => {
        expect(result).toBeTruthy();
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/orderitem/1');
      expect(req.request.method).toBe('DELETE');
      req.flush({ success: true });
    });
  });

  describe('Trace operations', () => {
    it('should create a trace', (done) => {
      const traceData = { partID: 1, quantity: 10, parentBarcodeID: 5 };

      service.createTrace(traceData).subscribe(result => {
        expect(result).toBeTruthy();
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/trace');
      expect(req.request.method).toBe('POST');
      expect(req.request.headers.get('Authorization')).toBe('Bearer test-token');
      req.flush({ id: 1, ...traceData });
    });
  });

  describe('moveBarcode', () => {
    it('should move a barcode to a new location', (done) => {
      service.moveBarcode(1, 5).subscribe(result => {
        expect(result).toBeTruthy();
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/inventory/barcode/move/1');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ newLocationID: 5 });
      req.flush({ success: true });
    });
  });
});
