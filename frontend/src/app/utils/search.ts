function getNestedValue(obj: any, path: string): string | null {
    const segments = path.split('.');
    let current = obj;
    for (const segment of segments) {
        if (current == null) return null;
        current = current[segment];
    }
    if (current == null) return null;
    return typeof current === 'string' ? current : String(current);
}

export function matchesSearch<T>(item: T, search: string, fields: string[]): boolean {
    const lower = search.toLowerCase();
    for (const field of fields) {
        const value = getNestedValue(item, field);
        if (value != null && value.toLowerCase().includes(lower)) return true;
    }
    return false;
}

export function filterBySearch<T>(items: T[], search: string, fields: string[]): T[] {
    if (!search) return items;
    return items.filter(item => matchesSearch(item, search, fields));
}
