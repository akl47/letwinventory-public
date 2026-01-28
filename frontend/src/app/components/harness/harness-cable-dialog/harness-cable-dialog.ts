import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { HarnessCable, HarnessWire } from '../../../models/harness.model';
import { WIRE_COLORS, AWG_GAUGES } from '../../../utils/harness/wire-color-map';

interface DialogData {
  cables: HarnessCable[];
}

@Component({
  selector: 'app-harness-cable-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatExpansionModule,
    MatTabsModule,
    MatTooltipModule
  ],
  templateUrl: './harness-cable-dialog.html',
  styleUrls: ['./harness-cable-dialog.scss']
})
export class HarnessCableDialog {
  private dialogRef = inject(MatDialogRef<HarnessCableDialog>);
  private data = inject<DialogData>(MAT_DIALOG_DATA, { optional: true });

  wireColors = WIRE_COLORS;
  awgGauges = AWG_GAUGES;

  cables = signal<HarnessCable[]>([]);

  // Quick add form
  quickLabel = '';
  quickGauge = '22';
  quickColors = '';

  constructor() {
    if (this.data?.cables) {
      // Deep clone cables to avoid mutating original
      this.cables.set(JSON.parse(JSON.stringify(this.data.cables)));
    }
  }

  addCable() {
    const existingLabels = this.cables().map(c => c.label);
    let label = 'W1';
    let counter = 1;
    while (existingLabels.includes(label)) {
      counter++;
      label = `W${counter}`;
    }

    const newCable: HarnessCable = {
      id: `cable-${Date.now()}`,
      label,
      wireCount: 1,
      gaugeAWG: '22',
      wires: [{
        id: `wire-${Date.now()}-1`,
        color: 'Black',
        colorCode: 'BK'
      }]
    };

    this.cables.update(cables => [...cables, newCable]);
  }

  removeCable(cable: HarnessCable) {
    if (confirm(`Delete cable "${cable.label}"?`)) {
      this.cables.update(cables => cables.filter(c => c.id !== cable.id));
    }
  }

  addWire(cable: HarnessCable) {
    const newWire: HarnessWire = {
      id: `wire-${Date.now()}`,
      color: 'Black',
      colorCode: 'BK'
    };
    cable.wires.push(newWire);
    cable.wireCount = cable.wires.length;
  }

  removeWire(cable: HarnessCable, index: number) {
    if (cable.wires.length > 1) {
      cable.wires.splice(index, 1);
      cable.wireCount = cable.wires.length;
    }
  }

  quickAdd() {
    if (!this.quickLabel || !this.quickColors) return;

    const colorCodes = this.quickColors.split(',').map(c => c.trim().toUpperCase());
    const wires: HarnessWire[] = colorCodes.map((code, i) => {
      const colorDef = this.wireColors.find(c => c.code === code);
      return {
        id: `wire-${Date.now()}-${i}`,
        color: colorDef?.name || code,
        colorCode: code
      };
    });

    const newCable: HarnessCable = {
      id: `cable-${Date.now()}`,
      label: this.quickLabel,
      wireCount: wires.length,
      gaugeAWG: this.quickGauge || undefined,
      wires
    };

    this.cables.update(cables => [...cables, newCable]);

    // Reset quick add form
    this.quickLabel = '';
    this.quickColors = '';
  }

  save() {
    this.dialogRef.close(this.cables());
  }
}
