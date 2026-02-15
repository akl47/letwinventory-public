import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { InventoryHigherarchyItem } from './inventory-higherarchy-item';
import { InventoryTag } from '../../../services/inventory.service';

const mockItem: InventoryTag = {
  id: 1, barcode: 'LOC-001', parentBarcodeID: 0, barcodeCategoryID: 1,
  activeFlag: true, name: 'Warehouse', type: 'Location', item_id: 1,
  children: [
    {
      id: 2, barcode: 'BOX-001', parentBarcodeID: 1, barcodeCategoryID: 2,
      activeFlag: true, name: 'Shelf A', type: 'Box', item_id: 1, children: [],
    },
  ],
};

const mockLeafItem: InventoryTag = {
  id: 4, barcode: 'TRC-001', parentBarcodeID: 2, barcodeCategoryID: 3,
  activeFlag: true, name: 'Resistor 100R', type: 'Trace', item_id: 1,
  children: [],
};

describe('InventoryHigherarchyItem', () => {
  let component: InventoryHigherarchyItem;
  let fixture: ComponentFixture<InventoryHigherarchyItem>;
  let dialog: MatDialog;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InventoryHigherarchyItem],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
      ],
    }).compileComponents();

    dialog = TestBed.inject(MatDialog);

    fixture = TestBed.createComponent(InventoryHigherarchyItem);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('item', { ...mockItem, children: [...mockItem.children!] });
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should not be expanded by default', () => {
      expect(component.isExpanded()).toBe(false);
    });

    it('should expand if item id is in expandedPath', () => {
      fixture = TestBed.createComponent(InventoryHigherarchyItem);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('item', { ...mockItem, children: [...mockItem.children!] });
      component.expandedPath = [1, 2];
      fixture.detectChanges();
      // ngOnInit runs during detectChanges
      expect(component.isExpanded()).toBe(true);
    });

    it('should not expand if item id is not in expandedPath', () => {
      fixture = TestBed.createComponent(InventoryHigherarchyItem);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('item', { ...mockItem, children: [...mockItem.children!] });
      component.expandedPath = [99];
      fixture.detectChanges();
      expect(component.isExpanded()).toBe(false);
    });
  });

  describe('toggle', () => {
    it('should toggle isExpanded', () => {
      expect(component.isExpanded()).toBe(false);
      component.toggle();
      expect(component.isExpanded()).toBe(true);
      component.toggle();
      expect(component.isExpanded()).toBe(false);
    });

    it('should emit barcodeSelected with item id when expanding', () => {
      vi.spyOn(component.barcodeSelected, 'emit');
      component.toggle(); // expand
      expect(component.barcodeSelected.emit).toHaveBeenCalledWith(1);
    });

    it('should emit barcodeSelected with parent id when collapsing with children', () => {
      vi.spyOn(component.barcodeSelected, 'emit');
      component.isExpanded.set(true);
      component.toggle(); // collapse
      // parentBarcodeID is 0 (falsy), so falls through to item.id (1)
      expect(component.barcodeSelected.emit).toHaveBeenCalledWith(1);
    });

    it('should emit item.id when toggling leaf node', () => {
      fixture = TestBed.createComponent(InventoryHigherarchyItem);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('item', { ...mockLeafItem });
      fixture.detectChanges();

      vi.spyOn(component.barcodeSelected, 'emit');
      component.toggle();
      expect(component.barcodeSelected.emit).toHaveBeenCalledWith(4);
    });
  });

  describe('onBarcodeTagClick', () => {
    it('should emit barcodeSelected with item id', () => {
      vi.spyOn(component.barcodeSelected, 'emit');
      component.onBarcodeTagClick();
      expect(component.barcodeSelected.emit).toHaveBeenCalledWith(1);
    });
  });

  describe('openBarcode', () => {
    it('should stop event propagation', () => {
      const event = new MouseEvent('click');
      vi.spyOn(event, 'stopPropagation');
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(null)
      } as MatDialogRef<any>);
      component.openBarcode(event);
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('should emit barcodeSelected', () => {
      vi.spyOn(component.barcodeSelected, 'emit');
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(null)
      } as MatDialogRef<any>);
      component.openBarcode(new MouseEvent('click'));
      expect(component.barcodeSelected.emit).toHaveBeenCalledWith(1);
    });

    it('should open BarcodeDialog with correct data', () => {
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(null)
      } as MatDialogRef<any>);
      component.openBarcode(new MouseEvent('click'));
      expect(dialog.open).toHaveBeenCalledWith(expect.any(Function), {
        data: { barcode: 'LOC-001' }
      });
    });

    it('should emit dataChanged when dialog returns truthy', () => {
      vi.spyOn(component.dataChanged, 'emit');
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(true)
      } as MatDialogRef<any>);
      component.openBarcode(new MouseEvent('click'));
      expect(component.dataChanged.emit).toHaveBeenCalled();
    });

    it('should not emit dataChanged when dialog returns falsy', () => {
      vi.spyOn(component.dataChanged, 'emit');
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(null)
      } as MatDialogRef<any>);
      component.openBarcode(new MouseEvent('click'));
      expect(component.dataChanged.emit).not.toHaveBeenCalled();
    });
  });

  describe('openEdit', () => {
    it('should stop event propagation', () => {
      const event = new MouseEvent('click');
      vi.spyOn(event, 'stopPropagation');
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(null)
      } as MatDialogRef<any>);
      component.openEdit(event);
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('should open InventoryItemDialog with item data', () => {
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(null)
      } as MatDialogRef<any>);
      component.openEdit(new MouseEvent('click'));
      expect(dialog.open).toHaveBeenCalledWith(expect.any(Function), {
        data: { item: component.item }
      });
    });

    it('should emit dataChanged when edit returns truthy', () => {
      vi.spyOn(component.dataChanged, 'emit');
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(true)
      } as MatDialogRef<any>);
      component.openEdit(new MouseEvent('click'));
      expect(component.dataChanged.emit).toHaveBeenCalled();
    });
  });

  describe('addChild', () => {
    it('should stop event propagation', () => {
      const event = new MouseEvent('click');
      vi.spyOn(event, 'stopPropagation');
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(null)
      } as MatDialogRef<any>);
      component.addChild(event);
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('should open InventoryItemDialog with parentId', () => {
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(null)
      } as MatDialogRef<any>);
      component.addChild(new MouseEvent('click'));
      expect(dialog.open).toHaveBeenCalledWith(expect.any(Function), {
        data: { parentId: 1 }
      });
    });

    it('should emit dataChanged when add returns truthy', () => {
      vi.spyOn(component.dataChanged, 'emit');
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(true)
      } as MatDialogRef<any>);
      component.addChild(new MouseEvent('click'));
      expect(component.dataChanged.emit).toHaveBeenCalled();
    });
  });

  describe('onChildDataChanged', () => {
    it('should propagate dataChanged event', () => {
      vi.spyOn(component.dataChanged, 'emit');
      component.onChildDataChanged();
      expect(component.dataChanged.emit).toHaveBeenCalled();
    });
  });
});
