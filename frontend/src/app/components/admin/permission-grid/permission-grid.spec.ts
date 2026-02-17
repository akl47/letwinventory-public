import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { PermissionGridComponent } from './permission-grid';
import { Permission } from '../../../models/permission.model';

describe('PermissionGridComponent', () => {
  let component: PermissionGridComponent;
  let fixture: ComponentFixture<PermissionGridComponent>;

  const mockPermissions: Permission[] = [
    { id: 1, resource: 'tasks', action: 'read' },
    { id: 2, resource: 'tasks', action: 'write' },
    { id: 3, resource: 'tasks', action: 'delete' },
    { id: 4, resource: 'parts', action: 'read' },
    { id: 5, resource: 'parts', action: 'write' },
    { id: 6, resource: 'requirements', action: 'read' },
    { id: 7, resource: 'requirements', action: 'approve' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PermissionGridComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PermissionGridComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('permissions', mockPermissions);
    fixture.componentRef.setInput('selectedIds', new Set<number>());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create with provided inputs', () => {
    expect(component).toBeTruthy();
    expect(component.permissions().length).toBe(7);
    expect(component.selectedIds().size).toBe(0);
  });

  describe('permissionsByResource', () => {
    it('should group permissions by resource', () => {
      const grouped = component.permissionsByResource();
      const resources = grouped.map(g => g.resource);
      expect(resources).toContain('tasks');
      expect(resources).toContain('parts');
      expect(resources).toContain('requirements');
    });

    it('should include correct permissions per resource', () => {
      const grouped = component.permissionsByResource();
      const tasks = grouped.find(g => g.resource === 'tasks');
      expect(tasks!.permissions.length).toBe(3);
      const parts = grouped.find(g => g.resource === 'parts');
      expect(parts!.permissions.length).toBe(2);
    });

    it('should sort by resourceOrder', () => {
      const grouped = component.permissionsByResource();
      const resources = grouped.map(g => g.resource);
      // tasks before parts before requirements per resourceOrder
      expect(resources.indexOf('tasks')).toBeLessThan(resources.indexOf('parts'));
      expect(resources.indexOf('parts')).toBeLessThan(resources.indexOf('requirements'));
    });
  });

  describe('actions', () => {
    it('should include base actions', () => {
      const actions = component.actions();
      expect(actions).toContain('read');
      expect(actions).toContain('write');
      expect(actions).toContain('delete');
    });

    it('should include extra actions beyond base', () => {
      const actions = component.actions();
      expect(actions).toContain('approve');
    });

    it('should have base actions first', () => {
      const actions = component.actions();
      expect(actions[0]).toBe('read');
      expect(actions[1]).toBe('write');
      expect(actions[2]).toBe('delete');
    });
  });

  describe('getPermissionForCell', () => {
    it('should find correct permission', () => {
      const perm = component.getPermissionForCell('tasks', 'read');
      expect(perm).toBeDefined();
      expect(perm!.id).toBe(1);
    });

    it('should return undefined for non-existent cell', () => {
      const perm = component.getPermissionForCell('tasks', 'approve');
      expect(perm).toBeUndefined();
    });
  });

  describe('isPermissionSelected', () => {
    it('should return false when not in set', () => {
      expect(component.isPermissionSelected(1)).toBe(false);
    });

    it('should return true when in set', () => {
      fixture.componentRef.setInput('selectedIds', new Set([1, 2]));
      fixture.detectChanges();
      expect(component.isPermissionSelected(1)).toBe(true);
      expect(component.isPermissionSelected(2)).toBe(true);
      expect(component.isPermissionSelected(3)).toBe(false);
    });
  });

  describe('togglePermission', () => {
    it('should add permission when not selected', () => {
      component.togglePermission(1);
      expect(component.selectedIds().has(1)).toBe(true);
    });

    it('should remove permission when already selected', () => {
      fixture.componentRef.setInput('selectedIds', new Set([1, 2]));
      fixture.detectChanges();
      component.togglePermission(1);
      expect(component.selectedIds().has(1)).toBe(false);
      expect(component.selectedIds().has(2)).toBe(true);
    });
  });

  describe('isAllSelectedForResource', () => {
    it('should return false when none selected', () => {
      expect(component.isAllSelectedForResource('tasks')).toBe(false);
    });

    it('should return false when only some selected', () => {
      fixture.componentRef.setInput('selectedIds', new Set([1, 2]));
      fixture.detectChanges();
      expect(component.isAllSelectedForResource('tasks')).toBe(false);
    });

    it('should return true when all selected for resource', () => {
      fixture.componentRef.setInput('selectedIds', new Set([1, 2, 3]));
      fixture.detectChanges();
      expect(component.isAllSelectedForResource('tasks')).toBe(true);
    });
  });

  describe('isSomeSelectedForResource', () => {
    it('should return false when none selected', () => {
      expect(component.isSomeSelectedForResource('tasks')).toBe(false);
    });

    it('should return true when partially selected', () => {
      fixture.componentRef.setInput('selectedIds', new Set([1]));
      fixture.detectChanges();
      expect(component.isSomeSelectedForResource('tasks')).toBe(true);
    });

    it('should return false when all selected', () => {
      fixture.componentRef.setInput('selectedIds', new Set([1, 2, 3]));
      fixture.detectChanges();
      expect(component.isSomeSelectedForResource('tasks')).toBe(false);
    });
  });

  describe('toggleAllForResource', () => {
    it('should select all permissions for resource when none selected', () => {
      component.toggleAllForResource('tasks');
      const ids = component.selectedIds();
      expect(ids.has(1)).toBe(true);
      expect(ids.has(2)).toBe(true);
      expect(ids.has(3)).toBe(true);
    });

    it('should select all when only some selected', () => {
      fixture.componentRef.setInput('selectedIds', new Set([1]));
      fixture.detectChanges();
      component.toggleAllForResource('tasks');
      const ids = component.selectedIds();
      expect(ids.has(1)).toBe(true);
      expect(ids.has(2)).toBe(true);
      expect(ids.has(3)).toBe(true);
    });

    it('should deselect all when all are selected', () => {
      fixture.componentRef.setInput('selectedIds', new Set([1, 2, 3]));
      fixture.detectChanges();
      component.toggleAllForResource('tasks');
      const ids = component.selectedIds();
      expect(ids.has(1)).toBe(false);
      expect(ids.has(2)).toBe(false);
      expect(ids.has(3)).toBe(false);
    });

    it('should not affect other resources', () => {
      fixture.componentRef.setInput('selectedIds', new Set([4, 5]));
      fixture.detectChanges();
      component.toggleAllForResource('tasks');
      const ids = component.selectedIds();
      // tasks should be selected
      expect(ids.has(1)).toBe(true);
      expect(ids.has(2)).toBe(true);
      expect(ids.has(3)).toBe(true);
      // parts should remain unchanged
      expect(ids.has(4)).toBe(true);
      expect(ids.has(5)).toBe(true);
    });
  });
});
