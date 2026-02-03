import { Component, inject, signal, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { HarnessData } from '../../../models/harness.model';
import { HarnessService } from '../../../services/harness.service';

interface ValidationError {
  message: string;
  path?: string;
}

@Component({
  selector: 'app-harness-import-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressBarModule
  ],
  templateUrl: './harness-import-dialog.html',
  styleUrls: ['./harness-import-dialog.scss']
})
export class HarnessImportDialog {
  private dialogRef = inject(MatDialogRef<HarnessImportDialog>);
  private harnessService = inject(HarnessService);

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  // State
  isDragOver = signal<boolean>(false);
  fileContent = signal<string>('');
  fileName = signal<string>('');
  pastedJson = '';
  validating = signal<boolean>(false);
  validationErrors = signal<ValidationError[]>([]);
  parsedData = signal<HarnessData | null>(null);
  isValid = signal<boolean>(false);
  showSample = false;

  sampleJson = `{
  "name": "Sample Harness",
  "partNumber": "HRN-001",
  "revision": "A",
  "description": "Sample wire harness",
  "connectors": [
    {
      "id": "J1",
      "label": "J1",
      "type": "male",
      "pinCount": 4,
      "pins": [
        { "id": "J1-1", "number": "1", "label": "PWR" },
        { "id": "J1-2", "number": "2", "label": "GND" },
        { "id": "J1-3", "number": "3", "label": "SIG+" },
        { "id": "J1-4", "number": "4", "label": "SIG-" }
      ],
      "position": { "x": 100, "y": 200 }
    },
    {
      "id": "P1",
      "label": "P1",
      "type": "female",
      "pinCount": 4,
      "pins": [
        { "id": "P1-1", "number": "1", "label": "PWR" },
        { "id": "P1-2", "number": "2", "label": "GND" },
        { "id": "P1-3", "number": "3", "label": "SIG+" },
        { "id": "P1-4", "number": "4", "label": "SIG-" }
      ],
      "position": { "x": 500, "y": 200 }
    }
  ],
  "cables": [
    {
      "id": "W1",
      "label": "W1",
      "wireCount": 4,
      "gaugeAWG": "22",
      "wires": [
        { "id": "W1-1", "color": "Red", "colorCode": "RD" },
        { "id": "W1-2", "color": "Black", "colorCode": "BK" },
        { "id": "W1-3", "color": "Green", "colorCode": "GN" },
        { "id": "W1-4", "color": "White", "colorCode": "WH" }
      ]
    }
  ],
  "connections": [
    { "id": "C1", "fromConnector": "J1", "fromPin": "J1-1", "toConnector": "P1", "toPin": "P1-1", "cable": "W1", "wire": "W1-1" },
    { "id": "C2", "fromConnector": "J1", "fromPin": "J1-2", "toConnector": "P1", "toPin": "P1-2", "cable": "W1", "wire": "W1-2" }
  ],
  "canvasSettings": {
    "zoom": 1,
    "gridEnabled": true,
    "snapToGrid": true
  }
}`;

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragOver.set(false);

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.processFile(files[0]);
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.processFile(input.files[0]);
    }
  }

  private processFile(file: File) {
    if (!file.name.endsWith('.json')) {
      this.validationErrors.set([{ message: 'File must be a .json file' }]);
      return;
    }

    this.fileName.set(file.name);
    const reader = new FileReader();

    reader.onload = (e) => {
      const content = e.target?.result as string;
      this.fileContent.set(content);
      this.pastedJson = '';
      this.validateJson(content);
    };

    reader.readAsText(file);
  }

  clearFile(event: Event) {
    event.stopPropagation();
    this.fileContent.set('');
    this.fileName.set('');
    this.parsedData.set(null);
    this.isValid.set(false);
    this.validationErrors.set([]);
    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }

  onJsonPasted() {
    if (this.pastedJson.trim()) {
      this.fileContent.set('');
      this.fileName.set('');
      this.validateJson(this.pastedJson);
    } else {
      this.parsedData.set(null);
      this.isValid.set(false);
      this.validationErrors.set([]);
    }
  }

  private validateJson(jsonString: string) {
    this.validating.set(true);
    this.validationErrors.set([]);
    this.isValid.set(false);
    this.parsedData.set(null);

    try {
      const data = JSON.parse(jsonString);

      // Basic structure validation
      const errors: ValidationError[] = [];

      if (!data.name) {
        errors.push({ message: 'Missing name field' });
      }

      if (!Array.isArray(data.connectors)) {
        errors.push({ message: 'connectors must be an array' });
      }

      if (!Array.isArray(data.cables)) {
        errors.push({ message: 'cables must be an array' });
      }

      if (!Array.isArray(data.connections)) {
        errors.push({ message: 'connections must be an array' });
      }

      if (errors.length > 0) {
        this.validationErrors.set(errors);
        this.validating.set(false);
        return;
      }

      // Deduplicate arrays by ID
      const deduplicatedData = this.deduplicateHarnessData(data);

      // Validate via backend
      this.harnessService.validateHarness(deduplicatedData).subscribe({
        next: (result) => {
          if (result.valid) {
            this.parsedData.set(deduplicatedData);
            this.isValid.set(true);
          } else {
            this.validationErrors.set(result.errors.map(e => ({ message: e })));
          }
          this.validating.set(false);
        },
        error: () => {
          // Fallback - if backend validation fails, accept if basic structure is OK
          this.parsedData.set(deduplicatedData);
          this.isValid.set(true);
          this.validating.set(false);
        }
      });
    } catch (e) {
      this.validationErrors.set([{ message: `Invalid JSON: ${(e as Error).message}` }]);
      this.validating.set(false);
    }
  }

  useSample() {
    this.pastedJson = this.sampleJson;
    this.fileContent.set('');
    this.fileName.set('');
    this.validateJson(this.sampleJson);
  }

  import() {
    const data = this.parsedData();
    if (data) {
      this.dialogRef.close(data);
    }
  }

  /**
   * Remove duplicate elements by ID from harness data arrays
   */
  private deduplicateHarnessData(data: any): any {
    const dedupeById = <T extends { id: string }>(arr: T[]): T[] => {
      if (!Array.isArray(arr)) return arr;
      const seen = new Set<string>();
      return arr.filter(item => {
        if (!item.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    };

    // Deduplicate connectors and their nested pins
    const connectors = dedupeById(data.connectors || []).map((conn: any) => ({
      ...conn,
      pins: dedupeById(conn.pins || [])
    }));

    // Deduplicate cables and their nested wires
    const cables = dedupeById(data.cables || []).map((cable: any) => ({
      ...cable,
      wires: dedupeById(cable.wires || [])
    }));

    // Deduplicate components and their nested pin groups/pins
    const components = dedupeById(data.components || []).map((comp: any) => ({
      ...comp,
      pinGroups: dedupeById(comp.pinGroups || []).map((group: any) => ({
        ...group,
        pins: dedupeById(group.pins || [])
      }))
    }));

    return {
      ...data,
      connectors,
      cables,
      components,
      connections: dedupeById(data.connections || []),
      subHarnesses: dedupeById(data.subHarnesses || []),
      groups: dedupeById(data.groups || [])
    };
  }
}
