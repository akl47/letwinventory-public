import { VendorParser, ParsedOrder, ParsedOrderItem } from './parser.interface';

export class BambuLabParser implements VendorParser {
    vendorName = 'Bambu Lab';

    detect(text: string): boolean {
        const lower = text.toLowerCase();
        return lower.includes('bambu lab') || lower.includes('bambulab.com') || lower.includes('noreply@bambulab.com');
    }

    parse(text: string): ParsedOrder {
        const orderNumber = this.extractOrderNumber(text);
        const placedDate = this.extractDate(text);
        const items = this.extractItems(text);
        const { subtotal, shipping, tax, taxDescription, total } = this.extractTotals(text);

        return {
            vendor: 'Bambu Lab',
            orderNumber,
            placedDate,
            items,
            subtotal,
            shipping,
            tax,
            taxDescription,
            total,
            notes: ''
        };
    }

    private extractOrderNumber(text: string): string {
        const match = text.match(/order\s+(us\w+)/i);
        return match ? match[1] : '';
    }

    private extractDate(text: string): string | null {
        // Look for date like "Mon, Mar 16, 2026 at 8:13 PM"
        const match = text.match(/\w+,\s+(\w+\s+\d+,\s+\d{4})\s+at/);
        if (match) {
            const d = new Date(match[1]);
            if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
        }
        return null;
    }

    private extractItems(text: string): ParsedOrderItem[] {
        const items: ParsedOrderItem[] = [];
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        // Find "Order Summary" start and "Subtotal" end
        const summaryIdx = lines.findIndex(l => /^Order Summary$/i.test(l));
        const subtotalIdx = lines.findIndex((l, i) => i > summaryIdx && /^Subtotal/i.test(l));

        if (summaryIdx === -1 || subtotalIdx === -1) return items;

        const section = lines.slice(summaryIdx + 1, subtotalIdx);

        // Collect item headers, descriptions, prices, and discounts in order
        const itemGroups: Array<{
            name: string;
            quantity: number;
            description: string;
            prices: number[];
            discount: number;
        }> = [];

        let currentGroup: typeof itemGroups[0] | null = null;

        for (const line of section) {
            // Skip Gmail page headers/footers
            if (this.isGmailNoise(line)) continue;

            // Item header: "Product Name x Qty"
            const itemMatch = line.match(/^(.+?)\s+x\s+(\d+)$/);
            if (itemMatch) {
                if (currentGroup) itemGroups.push(currentGroup);
                currentGroup = {
                    name: itemMatch[1].trim(),
                    quantity: parseInt(itemMatch[2], 10),
                    description: '',
                    prices: [],
                    discount: 0
                };
                continue;
            }

            // Discount line: "Filament Bulk Sale -$34.98"
            const discountMatch = line.match(/(?:Sale|Discount).*-\$?([\d,]+\.\d{2})/i);
            if (discountMatch) {
                if (currentGroup) {
                    currentGroup.discount = parseFloat(discountMatch[1].replace(',', ''));
                }
                continue;
            }

            // Dollar amount line
            const priceMatch = line.match(/^\$?([\d,]+\.\d{2})$/);
            if (priceMatch) {
                if (currentGroup) {
                    currentGroup.prices.push(parseFloat(priceMatch[1].replace(',', '')));
                }
                continue;
            }

            // Line with prices embedded (e.g., from column extraction: "description    $12.99")
            const embeddedPrices = [...line.matchAll(/\$?([\d,]+\.\d{2})/g)];
            if (embeddedPrices.length > 0 && currentGroup) {
                // Extract text portion (description) and prices separately
                const textPart = line.replace(/\$?[\d,]+\.\d{2}/g, '').trim();
                if (textPart && !currentGroup.description) {
                    currentGroup.description = textPart;
                }
                for (const m of embeddedPrices) {
                    currentGroup.prices.push(parseFloat(m[1].replace(',', '')));
                }
                continue;
            }

            // Description line (non-price, non-item text)
            if (currentGroup && !currentGroup.description && line.length > 0) {
                currentGroup.description = line;
            }
        }

        if (currentGroup) itemGroups.push(currentGroup);

        // Convert groups to ParsedOrderItems
        for (const group of itemGroups) {
            let lineTotal: number;
            let originalTotal: number | null = null;

            if (group.prices.length >= 2) {
                // Two prices: first is sale price (line total), second is original price
                lineTotal = group.prices[0];
                originalTotal = group.prices[1];
            } else if (group.prices.length === 1) {
                lineTotal = group.prices[0];
            } else {
                // No prices found, skip
                continue;
            }

            const unitPrice = lineTotal / group.quantity;
            const originalUnitPrice = originalTotal ? originalTotal / group.quantity : null;

            items.push({
                name: group.name,
                description: group.description,
                quantity: group.quantity,
                unitPrice: Math.round(unitPrice * 100000) / 100000,
                originalUnitPrice: originalUnitPrice ? Math.round(originalUnitPrice * 100000) / 100000 : null,
                discount: group.discount,
                lineTotal,
                orderLineTypeID: 1
            });
        }

        return items;
    }

    private extractTotals(text: string): {
        subtotal: number;
        shipping: number;
        tax: number;
        taxDescription: string;
        total: number;
    } {
        const result = { subtotal: 0, shipping: 0, tax: 0, taxDescription: '', total: 0 };
        const lines = text.split('\n').map(l => l.trim());

        const subtotalIdx = lines.findIndex(l => /^Subtotal/i.test(l));
        if (subtotalIdx === -1) return result;

        const footer = lines.slice(subtotalIdx);

        // Find dollar amounts near key labels
        for (let i = 0; i < footer.length; i++) {
            const line = footer[i];

            if (/^Subtotal/i.test(line)) {
                result.subtotal = this.findNextPrice(footer, i);
            } else if (/^Shipping/i.test(line)) {
                result.shipping = this.findNextPrice(footer, i);
            } else if (/^Taxes/i.test(line)) {
                result.tax = this.findNextPrice(footer, i);
                // Collect tax breakdown
                const taxLines: string[] = [];
                for (let j = i + 1; j < footer.length; j++) {
                    if (/TAX\s+[\d.]+%/i.test(footer[j])) {
                        const amt = this.findNextPrice(footer, j);
                        const label = footer[j].replace(/\s*\$[\d,.]+/g, '').trim();
                        taxLines.push(`${label}: $${amt.toFixed(2)}`);
                    } else if (/^Grand total/i.test(footer[j]) || /^Net Payment/i.test(footer[j])) {
                        break;
                    }
                }
                if (taxLines.length > 0) result.taxDescription = taxLines.join('; ');
            } else if (/^Grand total/i.test(line)) {
                result.total = this.findNextPrice(footer, i);
            }
        }

        return result;
    }

    private findNextPrice(lines: string[], startIdx: number): number {
        // Check current line for embedded $ price
        const dollarMatch = lines[startIdx].match(/\$([\d,]+\.\d{2})/);
        if (dollarMatch) {
            return parseFloat(dollarMatch[1].replace(',', ''));
        }

        // Check next few lines for a price
        for (let i = startIdx + 1; i < Math.min(startIdx + 4, lines.length); i++) {
            const match = lines[i].match(/\$([\d,]+\.\d{2})/);
            if (match) return parseFloat(match[1].replace(',', ''));
        }
        return 0;
    }

    private isGmailNoise(line: string): boolean {
        return /^\d+ of \d+$/.test(line) ||
            /^https:\/\/mail\.google\.com/.test(line) ||
            /^\d+\/\d+\/\d+,\s+\d+:\d+/.test(line) ||
            /^Gmail -/.test(line);
    }
}
