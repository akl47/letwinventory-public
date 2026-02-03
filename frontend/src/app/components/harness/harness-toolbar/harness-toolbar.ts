import { Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FormsModule } from '@angular/forms';

export type HarnessTool = 'select' | 'pan' | 'wire' | 'connector' | 'nodeEdit';

@Component({
  selector: 'app-harness-toolbar',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatDividerModule,
    MatMenuModule,
    MatSlideToggleModule,
    FormsModule
  ],
  templateUrl: './harness-toolbar.html',
  styleUrls: ['./harness-toolbar.scss']
})
export class HarnessToolbar {
  // Inputs
  hasChanges = input<boolean>(false);
  isSaving = input<boolean>(false);
  zoomLevel = input<number>(100);
  gridEnabled = input<boolean>(true);
  harnessName = input<string>('');
  harnessPartNumber = input<string>('');
  harnessRevision = input<string>('');
  hasElementSelected = input<boolean>(false);
  activeTool = input<HarnessTool>('select');
  canUndo = input<boolean>(false);
  canRedo = input<boolean>(false);
  isLocked = input<boolean>(false);

  // Outputs
  newHarness = output<void>();
  openHarness = output<void>();
  save = output<void>();
  exportJSON = output<void>();
  exportPNG = output<void>();
  importJSON = output<void>();
  addConnector = output<void>();
  addCable = output<void>();
  addComponent = output<void>();
  addSubHarness = output<void>();
  deleteSelected = output<void>();
  rotateConnector = output<void>();
  flipConnector = output<void>();
  zoomIn = output<void>();
  zoomOut = output<void>();
  resetZoom = output<void>();
  gridEnabledChange = output<boolean>();
  toolChanged = output<HarnessTool>();
  undo = output<void>();
  redo = output<void>();

  setTool(tool: HarnessTool) {
    this.toolChanged.emit(tool);
  }
}
