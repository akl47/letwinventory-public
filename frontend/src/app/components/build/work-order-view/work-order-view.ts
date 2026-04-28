import { Component, OnInit, inject, signal, computed, HostListener, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthImgDirective } from '../../../directives/auth-img.directive';
import { PartLink } from '../../common/part-link/part-link';
import { BarcodeTag } from '../../inventory/barcode-tag/barcode-tag';
import { BarcodeMovementDialog, BarcodeMovementDialogData } from '../../inventory/barcode-movement-dialog/barcode-movement-dialog';
import { MatDialog } from '@angular/material/dialog';
import { ManufacturingService } from '../../../services/manufacturing.service';
import { AuthService } from '../../../services/auth.service';
import { WorkOrder, WorkOrderKitStatus, WorkOrderBomLine } from '../../../models/work-order.model';
import { WoDekitDialog, WoDekitDialogData } from '../wo-dekit-dialog/wo-dekit-dialog';

@Component({
  selector: 'app-work-order-view',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    MatTooltipModule, MatChipsModule, MatSnackBarModule, AuthImgDirective, PartLink, BarcodeTag,
  ],
  templateUrl: './work-order-view.html',
  styleUrl: './work-order-view.css',
})
export class WorkOrderView implements OnInit {
  private route = inject(ActivatedRoute);
  router = inject(Router);
  private manufacturingService = inject(ManufacturingService);
  private authService = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  @ViewChild('woMainContainer') woMainContainer!: ElementRef<HTMLDivElement>;

  workOrder = signal<WorkOrder | null>(null);
  kitStatus = signal<WorkOrderKitStatus | null>(null);
  isLoading = signal(true);
  selectedStepId = signal<number | null>(null); // null = overview
  sidebarCollapsed = signal(false);
  isFullscreen = signal(false);

  selectedStep = computed(() => {
    const id = this.selectedStepId();
    const wo = this.workOrder();
    if (id === null || !wo?.master?.steps) return null;
    return wo.master.steps.find(s => s.id === id) ?? null;
  });

  canWrite = computed(() => this.authService.hasPermission('manufacturing_execution', 'write'));

  nextStepID = computed(() => {
    const wo = this.workOrder();
    if (!wo?.master?.steps) return null;
    const completedIDs = new Set(wo.stepCompletions.map(sc => sc.stepID));
    const next = wo.master.steps.find(s => !completedIDs.has(s.id));
    return next?.id ?? null;
  });

  /** Maps partID → step number string(s) like "10" or "10, 20" */
  partStepMap = computed((): Map<number, string> => {
    const wo = this.workOrder();
    const map = new Map<number, string>();
    if (!wo?.master?.steps) return map;
    const partSteps = new Map<number, number[]>();
    for (const step of wo.master.steps) {
      for (const item of [...(step.parts || []), ...(step.tooling || [])]) {
        if (!partSteps.has(item.partID)) partSteps.set(item.partID, []);
        partSteps.get(item.partID)!.push(step.stepNumber);
      }
    }
    for (const [partID, steps] of partSteps) {
      map.set(partID, steps.join(', '));
    }
    return map;
  });

  allStepsCompleted = computed(() => {
    const wo = this.workOrder();
    if (!wo?.master?.steps) return false;
    return wo.stepCompletions.length >= wo.master.steps.length;
  });

  ngOnInit() {
    this.route.params.subscribe(params => {
      const id = parseInt(params['id']);
      if (!isNaN(id)) {
        this.loadWorkOrder(id);
      }
    });
  }

  loadWorkOrder(id: number) {
    this.isLoading.set(true);
    this.manufacturingService.getWorkOrder(id).subscribe({
      next: (wo) => {
        this.workOrder.set(wo);
        this.isLoading.set(false);
        // Auto-select first incomplete step, or stay on overview
        if (this.selectedStepId() === null && wo.master?.steps?.length) {
          const completedIDs = new Set(wo.stepCompletions.map(sc => sc.stepID));
          const nextStep = wo.master.steps.find(s => !completedIDs.has(s.id));
          // Don't auto-navigate — start on overview
        }
        // Load kit status
        this.manufacturingService.getWorkOrderKitStatus(id).subscribe({
          next: (status) => this.kitStatus.set(status),
        });
      },
      error: () => this.isLoading.set(false),
    });
  }

  areStepPartsKitted(step: any): boolean {
    const ks = this.kitStatus();
    if (!ks?.bomStatus) return true; // No BOM = no kitting required
    const stepPartIds = (step.parts || []).map((p: any) => p.partID);
    if (stepPartIds.length === 0) return true; // No parts = nothing to kit
    for (const partID of stepPartIds) {
      const line = ks.bomStatus.find((b: any) => b.partID === partID && !b.isTool);
      if (line && line.status !== 'complete') return false;
    }
    return true;
  }

  isStepCompleted(stepID: number): boolean {
    return this.workOrder()?.stepCompletions.some(sc => sc.stepID === stepID) ?? false;
  }

  getStepCompletion(stepID: number) {
    return this.workOrder()?.stepCompletions.find(sc => sc.stepID === stepID);
  }

  completeStep(stepID: number) {
    const wo = this.workOrder();
    if (!wo) return;
    this.manufacturingService.completeStep(wo.id, stepID).subscribe({
      next: () => {
        this.loadWorkOrder(wo.id);
        this.snackBar.open('Step completed', 'OK', { duration: 2000 });
        // Auto-advance to the next step
        const steps = wo.master?.steps;
        if (steps) {
          const currentIdx = steps.findIndex(s => s.id === stepID);
          if (currentIdx >= 0 && currentIdx < steps.length - 1) {
            this.selectedStepId.set(steps[currentIdx + 1].id);
          }
        }
      },
      error: (err) => this.snackBar.open('Error: ' + err.error?.message, 'OK', { duration: 3000 }),
    });
  }

  uncompleteStep(stepID: number) {
    const wo = this.workOrder();
    if (!wo) return;
    this.manufacturingService.uncompleteStep(wo.id, stepID).subscribe({
      next: () => {
        this.loadWorkOrder(wo.id);
        this.snackBar.open('Step uncompleted', 'OK', { duration: 2000 });
      },
      error: (err) => this.snackBar.open('Error: ' + err.error?.message, 'OK', { duration: 3000 }),
    });
  }

  completeWorkOrder() {
    const wo = this.workOrder();
    if (!wo) return;
    this.manufacturingService.completeWorkOrder(wo.id).subscribe({
      next: () => {
        this.loadWorkOrder(wo.id);
        this.snackBar.open('Work Order completed!', 'OK', { duration: 3000 });
      },
      error: (err) => this.snackBar.open('Error: ' + err.error?.message, 'OK', { duration: 3000 }),
    });
  }


  getStatusColor(status: string): string {
    switch (status) {
      case 'not_started': return '#9e9e9e';
      case 'in_progress': return '#ff9800';
      case 'complete': return '#4caf50';
      default: return '#9e9e9e';
    }
  }

  isPartKitted(partID: number): boolean {
    const ks = this.kitStatus();
    if (!ks?.bomStatus) return false;
    const line = ks.bomStatus.find(b => b.partID === partID);
    return line ? line.status === 'complete' : false;
  }

  getUnkittedQty(partID: number): number {
    const ks = this.kitStatus();
    if (!ks?.bomStatus) return 0;
    const line = ks.bomStatus.find(b => b.partID === partID);
    if (!line) return 0;
    return Math.max(0, line.required - line.kitted);
  }

  openKitDialogWithQty(defaultQuantity?: number) {
    const wo = this.workOrder();
    if (!wo?.outputTraces?.length) {
      this.snackBar.open('No output traces to kit to', 'OK', { duration: 2000 });
      return;
    }
    const trace = wo.outputTraces[0];
    const dialogData: BarcodeMovementDialogData = {
      action: 'kit',
      barcodeId: trace.barcodeID,
      barcode: trace.Barcode?.barcode || '',
      isTrace: true,
      kitToTarget: true,
      defaultQuantity: defaultQuantity || undefined,
    };
    const dialogRef = this.dialog.open(BarcodeMovementDialog, {
      width: '500px',
      data: dialogData,
    });
    dialogRef.afterClosed().subscribe((result: any) => {
      if (result?.success) {
        this.refreshKitStatus();
        this.snackBar.open('Part kitted', 'OK', { duration: 2000 });
      }
    });
  }

  openKitDialogForLine(line: WorkOrderBomLine) {
    const wo = this.workOrder();
    if (!wo?.outputTraces?.length) {
      this.snackBar.open('No output traces to kit to', 'OK', { duration: 2000 });
      return;
    }
    const trace = wo.outputTraces[0];
    const unkittedQty = Math.max(0, line.required - line.kitted);
    const dialogData: BarcodeMovementDialogData = {
      action: 'kit',
      barcodeId: trace.barcodeID,
      barcode: trace.Barcode?.barcode || '',
      isTrace: true,
      kitToTarget: true,
      defaultQuantity: unkittedQty > 0 ? unkittedQty : undefined,
    };
    const dialogRef = this.dialog.open(BarcodeMovementDialog, {
      width: '500px',
      data: dialogData,
    });
    dialogRef.afterClosed().subscribe((result: any) => {
      if (result?.success) {
        this.refreshKitStatus();
        this.snackBar.open('Part kitted', 'OK', { duration: 2000 });
      }
    });
  }

  openDekitDialogForLine(line: WorkOrderBomLine) {
    const wo = this.workOrder();
    if (!wo?.outputTraces?.length) {
      this.snackBar.open('No output traces', 'OK', { duration: 2000 });
      return;
    }
    const trace = wo.outputTraces[0];
    const dialogData: WoDekitDialogData = {
      woBarcodeId: trace.barcodeID,
      woBarcode: trace.Barcode?.barcode || '',
      partName: line.partName,
      partRevision: line.partRevision,
      kittedTraces: line.kittedTraces || [],
    };
    const dialogRef = this.dialog.open(WoDekitDialog, {
      width: '500px',
      data: dialogData,
    });
    dialogRef.afterClosed().subscribe((result: any) => {
      if (result?.success) {
        this.refreshKitStatus();
        if (result.moveError) {
          this.snackBar.open('Dekitted, but move failed: ' + result.moveError, 'OK', { duration: 5000 });
        } else {
          this.snackBar.open('Part dekitted', 'OK', { duration: 2000 });
        }
      }
    });
  }

  private refreshKitStatus() {
    const wo = this.workOrder();
    if (!wo) return;
    this.manufacturingService.getWorkOrderKitStatus(wo.id).subscribe({
      next: (status) => {
        this.kitStatus.set(status);
        // Auto-transition WO to in_progress if parts are kitted
        if (wo.status === 'not_started' && status.bomStatus?.some(b => b.kitted > 0)) {
          this.manufacturingService.getWorkOrder(wo.id).subscribe({
            next: (updated) => this.workOrder.set(updated),
          });
        }
      },
    });
  }

  formatStatus(status: string): string {
    switch (status) {
      case 'not_started': return 'Not Started';
      case 'in_progress': return 'In Progress';
      case 'complete': return 'Complete';
      default: return status;
    }
  }

  pinLetter(index: number): string {
    return String.fromCharCode(65 + (index % 26));
  }

  toggleFullscreen() {
    const el = this.woMainContainer?.nativeElement;
    if (!el) return;

    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => {
        this.isFullscreen.set(true);
      }).catch(() => {
        // Fallback: just use CSS fullscreen
        this.isFullscreen.set(true);
      });
    } else {
      document.exitFullscreen().then(() => {
        this.isFullscreen.set(false);
      });
    }
  }

  @HostListener('document:fullscreenchange')
  onFullscreenChange() {
    if (!document.fullscreenElement) {
      this.isFullscreen.set(false);
    }
  }
}
