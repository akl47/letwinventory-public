import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { InventoryService, BulkImportResult, BulkImportOrderItem, BulkImportOrderData } from '../../../services/inventory.service';

interface EditableOrderItem extends BulkImportOrderItem {
    index: number;
}

@Component({
    selector: 'app-bulk-upload',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        MatIconModule,
        MatTableModule,
        MatProgressSpinnerModule,
        MatFormFieldModule,
        MatInputModule,
        MatCardModule,
        MatChipsModule,
        MatTooltipModule,
        MatDatepickerModule,
        MatNativeDateModule
    ],
    templateUrl: './bulk-upload.html',
    styleUrl: './bulk-upload.css'
})
export class BulkUploadComponent {
    private inventoryService = inject(InventoryService);
    private router = inject(Router);
    private location = inject(Location);

    selectedFile = signal<File | null>(null);
    csvContent = signal<string>('');
    isLoading = signal(false);
    previewResult = signal<BulkImportResult | null>(null);
    error = signal<string | null>(null);

    // Editable items list
    editableItems = signal<EditableOrderItem[]>([]);

    // Order fields
    vendor = signal<string>('');
    orderDescription = signal<string>('');
    placedDate = signal<Date | null>(null);
    trackingNumber = signal<string>('');
    orderLink = signal<string>('');
    notes = signal<string>('');

    // Editing state - separate signals for the currently edited row
    editingIndex = signal<number | null>(null);
    editingPartName = signal<string>('');
    editingDescription = signal<string>('');
    editingQuantity = signal<number>(0);
    editingPrice = signal<number>(0);

    displayedColumns = ['partName', 'description', 'quantity', 'price', 'lineTotal', 'status', 'actions'];

    // Computed totals
    orderTotal = computed(() => {
        return this.editableItems().reduce((sum, item) => sum + (item.quantity * item.price), 0);
    });

    newPartsCount = computed(() => {
        return this.editableItems().filter(item => item.isNew).length;
    });

    existingPartsCount = computed(() => {
        return this.editableItems().filter(item => !item.isNew).length;
    });

    onFileSelected(event: Event): void {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            const file = input.files[0];
            this.selectedFile.set(file);
            this.error.set(null);
            this.previewResult.set(null);
            this.editableItems.set([]);

            const reader = new FileReader();
            reader.onload = () => {
                this.csvContent.set(reader.result as string);
                // Automatically preview after file is loaded
                this.preview();
            };
            reader.onerror = () => {
                this.error.set('Failed to read file');
            };
            reader.readAsText(file);
        }
    }

    preview(): void {
        if (!this.csvContent()) {
            this.error.set('Please select a CSV file first');
            return;
        }

        this.isLoading.set(true);
        this.error.set(null);

        this.inventoryService.bulkImportOrder(
            this.csvContent(),
            true,
            this.vendor() || undefined,
            this.orderDescription() || undefined
        ).subscribe({
            next: (result) => {
                this.previewResult.set(result);
                // Convert to editable items
                const items: EditableOrderItem[] = result.orderItems.map((item, index) => ({
                    ...item,
                    index
                }));
                this.editableItems.set(items);
                // Set vendor from result if not already set
                if (!this.vendor() && result.order?.vendor) {
                    this.vendor.set(result.order.vendor);
                }
                if (!this.orderDescription() && result.order?.description) {
                    this.orderDescription.set(result.order.description);
                }
                this.isLoading.set(false);
            },
            error: (err) => {
                this.error.set(err.error?.message || 'Failed to preview import');
                this.isLoading.set(false);
            }
        });
    }

    executeImport(): void {
        const items = this.editableItems();
        if (items.length === 0) {
            this.error.set('No items to import');
            return;
        }

        this.isLoading.set(true);
        this.error.set(null);

        const orderData: BulkImportOrderData = {
            description: this.orderDescription() || undefined,
            vendor: this.vendor() || undefined,
            trackingNumber: this.trackingNumber() || undefined,
            link: this.orderLink() || undefined,
            notes: this.notes() || undefined,
            placedDate: this.placedDate()?.toISOString() || undefined
        };

        // Map items to the format expected by the API
        const importItems = items.map(item => ({
            partName: item.partName,
            name: item.partName,
            description: item.description,
            quantity: item.quantity,
            qty: item.quantity,
            price: item.price,
            isNew: item.isNew,
            partId: item.partId,
            vendor: item.vendor || this.vendor(),
            sku: item.sku,
            manufacturer: item.manufacturer,
            manufacturerPN: item.manufacturerPN,
            partCategoryID: item.partCategoryID || 1,
            internalPart: item.internalPart ?? false
        }));

        this.inventoryService.bulkImportOrderWithEdits(importItems as any, orderData).subscribe({
            next: (result) => {
                this.isLoading.set(false);
                if (result.order?.id) {
                    this.router.navigate(['/orders', result.order.id]);
                }
            },
            error: (err) => {
                this.error.set(err.error?.message || 'Failed to execute import');
                this.isLoading.set(false);
            }
        });
    }

    reset(): void {
        this.selectedFile.set(null);
        this.csvContent.set('');
        this.previewResult.set(null);
        this.editableItems.set([]);
        this.error.set(null);
        this.vendor.set('');
        this.orderDescription.set('');
        this.placedDate.set(null);
        this.trackingNumber.set('');
        this.orderLink.set('');
        this.notes.set('');
        this.editingIndex.set(null);
    }

    goBack(): void {
        this.location.back();
    }

    // Inline editing
    startEdit(index: number): void {
        // Save any pending edits first
        if (this.editingIndex() !== null && this.editingIndex() !== index) {
            this.saveEdit();
        }

        const item = this.editableItems()[index];
        this.editingIndex.set(index);
        this.editingPartName.set(item.partName);
        this.editingDescription.set(item.description);
        this.editingQuantity.set(item.quantity);
        this.editingPrice.set(item.price);
    }

    saveEdit(): void {
        const index = this.editingIndex();
        if (index === null) return;

        const items = [...this.editableItems()];
        const item = { ...items[index] };

        item.partName = this.editingPartName();
        item.description = this.editingDescription();
        item.quantity = this.editingQuantity() || 1;
        item.price = this.editingPrice() || 0;
        item.lineTotal = item.quantity * item.price;

        items[index] = item;
        this.editableItems.set(items);
        this.editingIndex.set(null);
    }

    onQuantityChange(value: any): void {
        this.editingQuantity.set(parseFloat(value) || 0);
    }

    onPriceChange(value: any): void {
        this.editingPrice.set(parseFloat(value) || 0);
    }

    removeItem(index: number): void {
        if (this.editingIndex() === index) {
            this.editingIndex.set(null);
        }
        const items = this.editableItems().filter((_, i) => i !== index);
        this.editableItems.set(items);
    }

    getStatusLabel(item: EditableOrderItem): string {
        return item.isNew ? 'New Part' : 'Existing';
    }

    formatPrice(price: number): string {
        return '$' + price.toFixed(5);
    }

    formatTotal(total: number): string {
        return '$' + total.toFixed(2);
    }

    isEditing(index: number): boolean {
        return this.editingIndex() === index;
    }
}
