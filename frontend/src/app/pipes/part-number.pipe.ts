import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formats a part number with revision suffix.
 * Shows "name-rev" unless revision is '00' and no other revisions exist.
 *
 * Usage:
 *   {{ part | partNumber }}                     — uses part.name and part.revision
 *   {{ name | partNumber:revision }}            — explicit name + revision
 *   {{ name | partNumber:revision:true }}       — force show rev even if '00'
 */
@Pipe({ name: 'partNumber', standalone: true })
export class PartNumberPipe implements PipeTransform {
  transform(value: any, revision?: string, hasOtherRevisions?: boolean): string {
    if (value && typeof value === 'object') {
      return formatPartNumber(value.name, value.revision, hasOtherRevisions);
    }
    return formatPartNumber(value, revision, hasOtherRevisions);
  }
}

export function formatPartNumber(name: string | undefined | null, revision: string | undefined | null, hasOtherRevisions = false): string {
  if (!name) return '';
  if (!revision || (revision === '00' && !hasOtherRevisions)) return name;
  return `${name}-${revision}`;
}
