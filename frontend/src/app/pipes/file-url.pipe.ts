import { Pipe, PipeTransform } from '@angular/core';
import { environment } from '../../environments/environment';

@Pipe({ name: 'fileUrl', standalone: true })
export class FileUrlPipe implements PipeTransform {
  transform(fileId: number | null | undefined): string | null {
    if (!fileId) return null;
    return `${environment.apiUrl}/files/${fileId}/data`;
  }
}
