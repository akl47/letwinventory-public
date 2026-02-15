import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { RequirementCategoryService } from '../../../services/requirement-category.service';
import { RequirementCategory } from '../../../models/design-requirement.model';

@Component({
    selector: 'app-category-manage-dialog',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatDialogModule,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        MatIconModule,
        MatListModule,
    ],
    templateUrl: './category-manage-dialog.html',
    styleUrl: './category-manage-dialog.css'
})
export class CategoryManageDialog implements OnInit {
    private dialogRef = inject(MatDialogRef<CategoryManageDialog>);
    private categoryService = inject(RequirementCategoryService);

    categories = signal<RequirementCategory[]>([]);
    newCategoryName = '';
    editingId = signal<number | null>(null);
    editingName = '';

    ngOnInit() {
        this.loadCategories();
    }

    private loadCategories() {
        this.categoryService.clearCache();
        this.categoryService.getAll().subscribe(cats => {
            this.categories.set(cats);
        });
    }

    addCategory() {
        const name = this.newCategoryName.trim();
        if (!name) return;
        this.categoryService.create({ name }).subscribe({
            next: () => {
                this.newCategoryName = '';
                this.loadCategories();
            }
        });
    }

    startEdit(cat: RequirementCategory) {
        this.editingId.set(cat.id);
        this.editingName = cat.name;
    }

    saveEdit(cat: RequirementCategory) {
        const name = this.editingName.trim();
        if (!name) return;
        this.categoryService.update(cat.id, { name }).subscribe({
            next: () => {
                this.editingId.set(null);
                this.loadCategories();
            }
        });
    }

    cancelEdit() {
        this.editingId.set(null);
    }

    deleteCategory(cat: RequirementCategory) {
        this.categoryService.delete(cat.id).subscribe({
            next: () => {
                this.loadCategories();
            }
        });
    }

    close() {
        this.dialogRef.close();
    }
}
