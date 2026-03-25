import { VendorParser, ParsedOrder } from './parser.interface';
import { BambuLabParser } from './bambu-lab.parser';

const parsers: VendorParser[] = [
    new BambuLabParser()
];

export function detectAndParse(text: string): { vendor: string; order: ParsedOrder } | null {
    for (const parser of parsers) {
        if (parser.detect(text)) {
            return {
                vendor: parser.vendorName,
                order: parser.parse(text)
            };
        }
    }
    return null;
}
