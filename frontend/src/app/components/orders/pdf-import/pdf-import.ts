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
import { MatSelectModule } from '@angular/material/select';
import { InventoryService, BulkImportOrderItem, BulkImportOrderData } from '../../../services/inventory.service';
import { PartCategory } from '../../../models';
import { detectAndParse } from '../../../utils/pdf-parsers/parser-registry';
import { ParsedOrder } from '../../../utils/pdf-parsers/parser.interface';
import * as pdfjsLib from 'pdfjs-dist';

interface EditableOrderItem extends BulkImportOrderItem {
    index: number;
    orderLineTypeID?: number;
}

@Component({
    selector: 'app-pdf-import',
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
        MatNativeDateModule,
        MatSelectModule
    ],
    templateUrl: './pdf-import.html',
    styleUrl: './pdf-import.css'
})
export class PdfImportComponent {
    private inventoryService = inject(InventoryService);
    private router = inject(Router);
    private location = inject(Location);

    selectedFile = signal<File | null>(null);
    extractedText = signal<string>('');
    detectedVendor = signal<string>('');
    parsedOrder = signal<ParsedOrder | null>(null);
    isLoading = signal(false);
    error = signal<string | null>(null);
    showRawText = signal(false);

    // Editable items
    editableItems = signal<EditableOrderItem[]>([]);

    // Order fields
    vendor = signal<string>('');
    orderDescription = signal<string>('');
    placedDate = signal<Date | null>(null);
    trackingNumber = signal<string>('');
    orderLink = signal<string>('');
    notes = signal<string>('');

    // Part categories
    categories = signal<PartCategory[]>([]);

    // Editing state
    editingIndex = signal<number | null>(null);
    editingPartName = signal<string>('');
    editingDescription = signal<string>('');
    editingQuantity = signal<number>(0);
    editingPrice = signal<number>(0);
    editingPartCategoryID = signal<number>(1);

    displayedColumns = ['partName', 'description', 'type', 'quantity', 'price', 'lineTotal', 'status', 'actions'];

    constructor() {
        this.inventoryService.getPartCategories().subscribe({
            next: (cats) => this.categories.set(cats)
        });
    }

    orderTotal = computed(() => {
        return this.editableItems().reduce((sum, item) => sum + (item.quantity * item.price), 0);
    });

    newPartsCount = computed(() => {
        return this.editableItems().filter(item => item.isNew).length;
    });

    existingPartsCount = computed(() => {
        return this.editableItems().filter(item => !item.isNew).length;
    });

    partItemsCount = computed(() => {
        return this.editableItems().filter(item => !item.orderLineTypeID || item.orderLineTypeID === 1).length;
    });

    async onFileSelected(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        if (!input.files || input.files.length === 0) return;

        const file = input.files[0];
        this.selectedFile.set(file);
        this.error.set(null);
        this.parsedOrder.set(null);
        this.editableItems.set([]);
        this.isLoading.set(true);

        try {
            const arrayBuffer = await file.arrayBuffer();
            const text = await this.extractTextFromPdf(arrayBuffer);
            this.extractedText.set(text);

            const result = detectAndParse(text);
            if (!result) {
                this.error.set('Could not detect vendor from this PDF. Supported vendors: Bambu Lab');
                this.isLoading.set(false);
                return;
            }

            this.detectedVendor.set(result.vendor);
            this.parsedOrder.set(result.order);
            this.populateFromParsedOrder(result.order);
            this.isLoading.set(false);
        } catch (err: any) {
            this.error.set('Failed to parse PDF: ' + (err.message || err));
            this.isLoading.set(false);
        }
    }

    private async extractTextFromPdf(arrayBuffer: ArrayBuffer): Promise<string> {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/pdf.worker.min.mjs';

        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const lines: string[] = [];

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();

            // Group text items by y-coordinate to form lines
            const lineMap = new Map<number, Array<{ x: number; text: string }>>();
            const yThreshold = 3; // pixels tolerance for same line

            for (const item of content.items) {
                if (!('str' in item) || !item.str.trim()) continue;
                const textItem = item as pdfjsLib.TextItem;
                const y = Math.round(textItem.transform[5] / yThreshold) * yThreshold;
                const x = textItem.transform[4];
                if (!lineMap.has(y)) lineMap.set(y, []);
                lineMap.get(y)!.push({ x, text: item.str.trim() });
            }

            // Sort lines by y (descending because PDF y increases upward)
            const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);
            for (const y of sortedYs) {
                const lineItems = lineMap.get(y)!.sort((a, b) => a.x - b.x);
                // Join items with appropriate spacing
                let lineText = '';
                for (let j = 0; j < lineItems.length; j++) {
                    if (j > 0) {
                        const gap = lineItems[j].x - lineItems[j - 1].x;
                        lineText += gap > 50 ? '    ' : ' ';
                    }
                    lineText += lineItems[j].text;
                }
                lines.push(lineText);
            }
        }

        return lines.join('\n');
    }

    private populateFromParsedOrder(order: ParsedOrder): void {
        this.vendor.set(order.vendor);
        this.orderDescription.set(`Order ${order.orderNumber}`);
        if (order.placedDate) {
            this.placedDate.set(new Date(order.placedDate + 'T00:00:00'));
        }

        const items: EditableOrderItem[] = [];
        let index = 0;

        // Add product items
        for (const item of order.items) {
            const discountNote = item.discount > 0
                ? ` (discount: -$${item.discount.toFixed(2)})`
                : '';
            items.push({
                index: index++,
                partId: null,
                partName: item.name,
                description: item.description + discountNote,
                quantity: item.quantity,
                price: item.unitPrice,
                lineTotal: item.lineTotal,
                isNew: true,
                partCategoryID: 1,
                vendor: order.vendor,
                sku: undefined,
                manufacturer: order.vendor,
                manufacturerPN: undefined,
                orderLineTypeID: item.orderLineTypeID
            });
        }

        // Add shipping line item
        if (order.shipping >= 0) {
            items.push({
                index: index++,
                partId: null,
                partName: 'Shipping',
                description: '',
                quantity: 1,
                price: order.shipping,
                lineTotal: order.shipping,
                isNew: false,
                partCategoryID: 1,
                vendor: order.vendor,
                sku: undefined,
                manufacturer: undefined,
                manufacturerPN: undefined,
                orderLineTypeID: 2
            });
        }

        // Add tax line item
        if (order.tax > 0) {
            items.push({
                index: index++,
                partId: null,
                partName: 'Taxes',
                description: order.taxDescription,
                quantity: 1,
                price: order.tax,
                lineTotal: order.tax,
                isNew: false,
                partCategoryID: 1,
                vendor: order.vendor,
                sku: undefined,
                manufacturer: undefined,
                manufacturerPN: undefined,
                orderLineTypeID: 3
            });
        }

        this.editableItems.set(items);
    }

    preview(): void {
        const items = this.editableItems().filter(i => !i.orderLineTypeID || i.orderLineTypeID === 1);
        if (items.length === 0) return;

        this.isLoading.set(true);
        this.error.set(null);

        const orderData: BulkImportOrderData = {
            description: this.orderDescription() || undefined,
            vendor: this.vendor() || undefined,
        };

        const importItems = items.map(item => ({
            partName: item.partName,
            name: item.partName,
            description: item.description,
            quantity: item.quantity,
            qty: item.quantity,
            price: item.price,
            isNew: true,
            partId: null,
            vendor: item.vendor || this.vendor(),
            sku: item.sku,
            manufacturer: item.manufacturer,
            manufacturerPN: item.manufacturerPN,
            partCategoryID: item.partCategoryID || 1,
            internalPart: false
        }));

        this.inventoryService.bulkImportOrderPreview(importItems as any, orderData).subscribe({
            next: (result) => {
                // Update items with part matching results
                const currentItems = [...this.editableItems()];
                for (const resultItem of result.orderItems) {
                    const idx = currentItems.findIndex(
                        i => i.partName === resultItem.partName && (!i.orderLineTypeID || i.orderLineTypeID === 1)
                    );
                    if (idx !== -1) {
                        currentItems[idx] = {
                            ...currentItems[idx],
                            partId: resultItem.partId,
                            isNew: resultItem.isNew
                        };
                    }
                }
                this.editableItems.set(currentItems);
                this.isLoading.set(false);
            },
            error: (err) => {
                this.error.set(err.error?.message || 'Failed to preview import');
                this.isLoading.set(false);
            }
        });
    }

    executeImport(): void {
        const allItems = this.editableItems();
        if (allItems.length === 0) {
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
            placedDate: this.placedDate()?.toISOString() || undefined,
            orderStatusID: 2 // Placed
        };

        // Part items go through bulk import
        const partItems = allItems.filter(i => !i.orderLineTypeID || i.orderLineTypeID === 1);
        const nonPartItems = allItems.filter(i => i.orderLineTypeID && i.orderLineTypeID !== 1);

        const importItems = partItems.map(item => ({
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
            internalPart: false
        }));

        this.inventoryService.bulkImportOrderWithEdits(importItems as any, orderData).subscribe({
            next: (result) => {
                if (result.order?.id && nonPartItems.length > 0) {
                    // Create non-part line items (shipping, taxes)
                    let completed = 0;
                    for (const item of nonPartItems) {
                        this.inventoryService.createOrderItem({
                            orderID: result.order.id,
                            orderLineTypeID: item.orderLineTypeID,
                            name: item.partName,
                            quantity: 1,
                            price: item.price,
                            lineNumber: partItems.length + completed + 1
                        } as any).subscribe({
                            next: () => {
                                completed++;
                                if (completed === nonPartItems.length) {
                                    this.isLoading.set(false);
                                    this.router.navigate(['/orders', result.order!.id]);
                                }
                            },
                            error: () => {
                                completed++;
                                if (completed === nonPartItems.length) {
                                    this.isLoading.set(false);
                                    this.router.navigate(['/orders', result.order!.id]);
                                }
                            }
                        });
                    }
                } else if (result.order?.id) {
                    this.isLoading.set(false);
                    this.router.navigate(['/orders', result.order.id]);
                } else {
                    this.isLoading.set(false);
                }
            },
            error: (err) => {
                this.error.set(err.error?.message || 'Failed to create order');
                this.isLoading.set(false);
            }
        });
    }

    reset(): void {
        this.selectedFile.set(null);
        this.extractedText.set('');
        this.detectedVendor.set('');
        this.parsedOrder.set(null);
        this.editableItems.set([]);
        this.error.set(null);
        this.vendor.set('');
        this.orderDescription.set('');
        this.placedDate.set(null);
        this.trackingNumber.set('');
        this.orderLink.set('');
        this.notes.set('');
        this.editingIndex.set(null);
        this.showRawText.set(false);
    }

    goBack(): void {
        this.location.back();
    }

    toggleRawText(): void {
        this.showRawText.update(v => !v);
    }

    // Inline editing
    startEdit(index: number): void {
        if (this.editingIndex() !== null && this.editingIndex() !== index) {
            this.saveEdit();
        }

        const item = this.editableItems()[index];
        this.editingIndex.set(index);
        this.editingPartName.set(item.partName);
        this.editingDescription.set(item.description);
        this.editingQuantity.set(item.quantity);
        this.editingPrice.set(item.price);
        this.editingPartCategoryID.set(item.partCategoryID || 1);
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
        item.partCategoryID = this.editingPartCategoryID();

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

    getLineTypeName(typeId: number | undefined): string {
        switch (typeId) {
            case 2: return 'Shipping';
            case 3: return 'Taxes';
            case 4: return 'Services';
            case 5: return 'Other';
            default: return 'Part';
        }
    }

    getStatusLabel(item: EditableOrderItem): string {
        if (item.orderLineTypeID && item.orderLineTypeID !== 1) return this.getLineTypeName(item.orderLineTypeID);
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

    isPartItem(item: EditableOrderItem): boolean {
        return !item.orderLineTypeID || item.orderLineTypeID === 1;
    }

    getCategory(categoryId: number | undefined): PartCategory | undefined {
        if (!categoryId) return undefined;
        return this.categories().find(c => c.id === categoryId);
    }

    getCategoryName(categoryId: number | undefined): string {
        return this.getCategory(categoryId)?.name || '-';
    }

    getCategoryBgColor(hex: string | null | undefined): string {
        if (!hex) return 'rgba(255, 255, 255, 0.2)';
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, 0.2)`;
    }

    getCategoryTextColor(hex: string | null | undefined): string {
        return hex || '#808080';
    }
}
