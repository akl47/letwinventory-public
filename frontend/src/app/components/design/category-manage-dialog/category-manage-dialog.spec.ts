import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { CategoryManageDialog } from './category-manage-dialog';
import { RequirementCategoryService } from '../../../services/requirement-category.service';
import { RequirementCategory } from '../../../models/design-requirement.model';

describe('CategoryManageDialog', () => {
    let component: CategoryManageDialog;
    let fixture: ComponentFixture<CategoryManageDialog>;
    let categoryService: RequirementCategoryService;
    let dialogRef: MatDialogRef<CategoryManageDialog>;

    const mockCategories: RequirementCategory[] = [
        { id: 1, name: 'Functional', activeFlag: true },
        { id: 2, name: 'Safety', activeFlag: true },
        { id: 3, name: 'Performance', activeFlag: true },
    ];

    beforeEach(async () => {
        dialogRef = { close: vi.fn() } as any;

        await TestBed.configureTestingModule({
            imports: [CategoryManageDialog],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                provideAnimationsAsync(),
                provideRouter([]),
                { provide: MatDialogRef, useValue: dialogRef },
            ],
        }).compileComponents();

        categoryService = TestBed.inject(RequirementCategoryService);
        vi.spyOn(categoryService, 'clearCache').mockImplementation(() => {});
        vi.spyOn(categoryService, 'getAll').mockReturnValue(of(mockCategories));

        fixture = TestBed.createComponent(CategoryManageDialog);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await fixture.whenStable();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should load categories on init', () => {
        expect(categoryService.clearCache).toHaveBeenCalled();
        expect(categoryService.getAll).toHaveBeenCalled();
        expect(component.categories().length).toBe(3);
    });

    describe('addCategory', () => {
        it('should not add when name is empty', () => {
            const spy = vi.spyOn(categoryService, 'create');
            component.newCategoryName = '   ';
            component.addCategory();
            expect(spy).not.toHaveBeenCalled();
        });

        it('should create category and reload', () => {
            vi.spyOn(categoryService, 'create').mockReturnValue(of({ id: 4, name: 'New Cat', activeFlag: true }));
            component.newCategoryName = 'New Cat';
            component.addCategory();
            expect(categoryService.create).toHaveBeenCalledWith({ name: 'New Cat' });
            expect(component.newCategoryName).toBe('');
            // getAll called once on init and once after create
            expect(categoryService.getAll).toHaveBeenCalledTimes(2);
        });
    });

    describe('edit category', () => {
        it('startEdit should set editingId and editingName', () => {
            component.startEdit(mockCategories[0]);
            expect(component.editingId()).toBe(1);
            expect(component.editingName).toBe('Functional');
        });

        it('cancelEdit should clear editingId', () => {
            component.startEdit(mockCategories[0]);
            component.cancelEdit();
            expect(component.editingId()).toBeNull();
        });

        it('saveEdit should not proceed with empty name', () => {
            const spy = vi.spyOn(categoryService, 'update');
            component.startEdit(mockCategories[0]);
            component.editingName = '   ';
            component.saveEdit(mockCategories[0]);
            expect(spy).not.toHaveBeenCalled();
        });

        it('saveEdit should update category and reload', () => {
            vi.spyOn(categoryService, 'update').mockReturnValue(of({ id: 1, name: 'Renamed', activeFlag: true }));
            component.startEdit(mockCategories[0]);
            component.editingName = 'Renamed';
            component.saveEdit(mockCategories[0]);
            expect(categoryService.update).toHaveBeenCalledWith(1, { name: 'Renamed' });
            expect(component.editingId()).toBeNull();
        });
    });

    describe('deleteCategory', () => {
        it('should delete and reload categories', () => {
            vi.spyOn(categoryService, 'delete').mockReturnValue(of({}));
            component.deleteCategory(mockCategories[1]);
            expect(categoryService.delete).toHaveBeenCalledWith(2);
            // getAll called once on init and once after delete
            expect(categoryService.getAll).toHaveBeenCalledTimes(2);
        });
    });

    describe('close', () => {
        it('should close the dialog', () => {
            component.close();
            expect(dialogRef.close).toHaveBeenCalled();
        });
    });
});
