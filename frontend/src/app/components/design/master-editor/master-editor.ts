import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatTableModule } from '@angular/material/table';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { VerificationDialog, VerificationDialogData, VerificationResult } from '../verification-dialog/verification-dialog';
import { ManufacturingService } from '../../../services/manufacturing.service';
import { InventoryService } from '../../../services/inventory.service';
import { AuthService } from '../../../services/auth.service';
import { EngineeringMaster, EngineeringMasterHistory } from '../../../models/engineering-master.model';
import { StepEditor } from '../step-editor/step-editor';
import { BomTable, BomItem } from '../../common/bom-table/bom-table';

@Component({
  selector: 'app-master-editor',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink,
    MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatProgressSpinnerModule, MatTooltipModule, MatChipsModule,
    MatExpansionModule, MatAutocompleteModule, MatSnackBarModule,
    MatTableModule,
    StepEditor, BomTable,
  ],
  templateUrl: './master-editor.html',
  styleUrl: './master-editor.css',
})
export class MasterEditor implements OnInit {
  private route = inject(ActivatedRoute);
  router = inject(Router);
  private manufacturingService = inject(ManufacturingService);
  private inventoryService = inject(InventoryService);
  private authService = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  master = signal<EngineeringMaster | null>(null);
  history = signal<EngineeringMasterHistory[]>([]);
  isLoading = signal(true);
  isNew = signal(false);
  showHistory = signal(false);
  isSaving = signal(false);
  editingOutputParts = signal(false);
  editingBom = signal(false);
  emSidebarCollapsed = signal(false);
  selectedStepId = signal<number | null>(null); // null = overview

  // Form fields
  description = signal('');

  // New master flow
  newMainPart = signal<any>(null);

  // Output part search
  outputPartSearch = signal('');
  outputPartResults = signal<any[]>([]);
  additionalPartSearch = signal('');
  additionalPartResults = signal<any[]>([]);
  outputPartColumns = ['role', 'name', 'revision', 'quantity', 'actions'];
  bomColumns = ['type', 'name', 'revision', 'totalQty', 'steps', 'actions'];
  bomSearch = signal('');
  bomSearchResults = signal<any[]>([]);
  showBomSearch = signal(false);

  isEditable = computed(() => {
    const m = this.master();
    return !m || m.releaseState === 'draft';
  });

  canWrite = computed(() => this.authService.hasPermission('manufacturing_planning', 'write'));

  canSave = computed(() => {
    if (this.isNew()) return !!this.newMainPart();
    return true;
  });

  selectedStep = computed(() => {
    const id = this.selectedStepId();
    if (id === null) return null;
    return this.master()?.steps?.find(s => s.id === id) ?? null;
  });

  mainOutputPart = computed(() => {
    const m = this.master();
    return m?.outputParts?.[0] ?? null;
  });

  additionalOutputParts = computed(() => {
    const m = this.master();
    return m?.outputParts?.slice(1) ?? [];
  });

  outputPartBomItems = computed((): BomItem[] => {
    const m = this.master();
    if (!m?.outputParts?.length) return [];
    return m.outputParts.map((op, i) => ({
      partID: op.partID,
      quantity: op.quantity,
      partName: op.part.name,
      partRevision: op.part.revision,
      partDescription: op.part.description,
      partImageFileId: (op.part as any).imageFile?.id ?? null,
      uomName: op.part.UnitOfMeasure?.name,
      allowDecimal: op.part.UnitOfMeasure?.allowDecimal ?? false,
      typeBadge: i === 0 ? 'Main' : 'Additional',
      typeBadgeClass: i === 0 ? 'main' : 'additional',
    }));
  });

  /** EM BOM items as BomItem[] for the table, with step assignment breakdown in the extra column */
  /**
   * Merges EM BOM items with step-sourced items.
   * All parts from steps appear here even if not in the stored BOM.
   * Stored BOM qty is authoritative — if higher than step total, the difference is "Unassigned".
   */
  /** Parts in the EM BOM that are not yet assigned to any step (isTool=false) */
  unassignedBomParts = computed(() => {
    const m = this.master();
    if (!m?.bomItems || !m?.steps) return [];
    const assignedPartIds = new Set<number>();
    for (const step of m.steps) {
      for (const item of [...(step.parts || [])]) {
        assignedPartIds.add(item.partID);
      }
    }
    return (m.bomItems || [])
      .filter(bi => !bi.isTool && !assignedPartIds.has(bi.partID))
      .map(bi => ({ id: bi.partID, name: bi.part?.name, revision: bi.part?.revision, imageFile: (bi.part as any)?.imageFile, UnitOfMeasure: (bi.part as any)?.UnitOfMeasure }));
  });

  /** Tools in the EM BOM that are not yet assigned to any step (isTool=true) */
  unassignedBomTools = computed(() => {
    const m = this.master();
    if (!m?.bomItems || !m?.steps) return [];
    const assignedToolIds = new Set<number>();
    for (const step of m.steps) {
      for (const item of [...(step.tooling || [])]) {
        assignedToolIds.add(item.partID);
      }
    }
    return (m.bomItems || [])
      .filter(bi => bi.isTool && !assignedToolIds.has(bi.partID))
      .map(bi => ({ id: bi.partID, name: bi.part?.name, revision: bi.part?.revision, imageFile: (bi.part as any)?.imageFile, UnitOfMeasure: (bi.part as any)?.UnitOfMeasure }));
  });

  aggregatedBomItems = computed((): BomItem[] => {
    const m = this.master();
    if (!m) return [];

    // Step assignments: partID-isTool → [{ stepNumber, qty, part }]
    const stepMap = new Map<string, { stepNumber: number; qty: number; part: any }[]>();
    for (const step of (m.steps || [])) {
      for (const item of [...(step.parts || []), ...(step.tooling || [])]) {
        const key = `${item.partID}-${item.isTool}`;
        const list = stepMap.get(key) || [];
        list.push({ stepNumber: step.stepNumber, qty: Number(item.quantity), part: item.part });
        stepMap.set(key, list);
      }
    }

    // Stored BOM: partID-isTool → bomItem
    const bomMap = new Map<string, any>();
    for (const bi of (m.bomItems || [])) {
      bomMap.set(`${bi.partID}-${bi.isTool}`, bi);
    }

    // Union of all keys
    const allKeys = new Set([...stepMap.keys(), ...bomMap.keys()]);
    const results: BomItem[] = [];

    for (const key of allKeys) {
      const bomItem = bomMap.get(key);
      const assignments = stepMap.get(key) || [];
      const stepTotal = assignments.reduce((sum, a) => sum + a.qty, 0);

      // Use BOM qty if stored, otherwise use step total
      const totalQty = bomItem ? Number(bomItem.quantity) : stepTotal;

      // Part info from BOM item or first step assignment
      const partSource = bomItem?.part ?? assignments[0]?.part;
      const isTool = key.endsWith('-true');
      const partID = parseInt(key.split('-')[0]);

      // Build assignment breakdown
      const parts: string[] = [];
      const unassigned = totalQty - stepTotal;
      const isFullyUnassigned = assignments.length === 0;
      const needsQtyDetail = assignments.length > 1 || (unassigned > 0 && !isFullyUnassigned);
      for (const a of assignments) {
        parts.push(needsQtyDetail ? `Step ${a.stepNumber} (${a.qty})` : `Step ${a.stepNumber}`);
      }
      if (unassigned > 0 && !isFullyUnassigned) {
        parts.push(`Unassigned (${unassigned})`);
      }

      results.push({
        partID,
        quantity: totalQty,
        partName: partSource?.name ?? 'Unknown',
        partRevision: partSource?.revision,
        partImageFileId: partSource?.imageFile?.id ?? null,
        uomName: partSource?.UnitOfMeasure?.name,
        allowDecimal: partSource?.UnitOfMeasure?.allowDecimal ?? false,
        typeBadge: isTool ? 'Tool' : 'Part',
        typeBadgeClass: isTool ? 'tool' : 'part',
        extra: isFullyUnassigned ? 'Unassigned' : parts.join(', '),
        warning: isFullyUnassigned,
      });
    }

    return results;
  });

  ngOnInit() {
    this.route.params.subscribe(params => {
      if (params['id']) {
        this.isNew.set(false);
        this.loadMaster(parseInt(params['id']));
      } else {
        this.isNew.set(true);
        this.isLoading.set(false);
      }
    });
  }

  loadMaster(id?: number) {
    const masterId = id || this.master()?.id;
    if (!masterId) return;
    this.isLoading.set(true);
    this.manufacturingService.getMaster(masterId).subscribe({
      next: (master) => {
        this.master.set(master);
        this.description.set(master.description || '');
        this.isLoading.set(false);
        // Auto-pull BOM from output parts if EM BOM is empty
        if (master.releaseState === 'draft' && (!master.bomItems || master.bomItems.length === 0) && master.outputParts?.length > 0) {
          this.pullBomFromOutputParts(master.id, master.outputParts.map((op: any) => op.partID));
        }
      },
      error: () => this.isLoading.set(false),
    });
    this.manufacturingService.getHistory(masterId).subscribe({
      next: (history) => this.history.set(history),
    });
  }

  private deriveName(): string {
    const m = this.master();
    const main = m?.outputParts?.[0]?.part ?? this.newMainPart();
    if (!main) return 'Untitled';
    const rev = main.revision;
    if (rev && rev !== '00' && rev !== '0') {
      return `${main.name} Rev ${rev}`;
    }
    return main.name;
  }

  save() {
    if (this.isNew()) {
      const main = this.newMainPart();
      if (!main) return;
      this.manufacturingService.createMaster({
        name: (main.revision && main.revision !== '00' && main.revision !== '0') ? `${main.name} Rev ${main.revision}` : main.name,
        description: this.description(),
        outputParts: [{ partID: main.id, quantity: 1 }],
      }).subscribe({
        next: (master) => {
          this.snackBar.open('Master created', 'OK', { duration: 2000 });
          this.router.navigate(['/design/masters', master.id, 'edit']);
        },
        error: (err) => this.snackBar.open('Error: ' + err.error?.message, 'OK', { duration: 3000 }),
      });
    } else {
      this.autosave();
    }
  }

  onDescriptionBlur() {
    const m = this.master();
    if (!m || m.description === this.description()) return;
    this.autosave();
  }

  /** Save current master state to backend and refresh history. */
  /** Pull BOM items from output parts' inventory BOMs into the EM BOM */
  private pullBomFromOutputParts(masterId: number, partIds: number[]) {
    const allItems: { partID: number; quantity: number; isTool: boolean }[] = [];
    let pending = partIds.length;
    if (pending === 0) return;

    for (const partId of partIds) {
      this.inventoryService.getBom(partId).subscribe({
        next: (data) => {
          for (const item of (data.bomItems || [])) {
            const pid = item.componentPartID || item.componentPart?.id || item.partID;
            if (pid && !allItems.some(i => i.partID === pid)) {
              allItems.push({ partID: pid, quantity: Number(item.quantity) || 1, isTool: false });
            }
          }
          pending--;
          if (pending === 0 && allItems.length > 0) {
            this.manufacturingService.updateBom(masterId, allItems).subscribe({
              next: (master) => {
                this.master.set(master);
                this.refreshHistory();
              },
            });
          }
        },
        error: () => { pending--; },
      });
    }
  }

  /** Pull BOM from a single output part and merge into existing EM BOM */
  /** Sync EM BOM against all output parts' inventory BOMs — adds missing parts, reports results */
  syncBomFromParts() {
    const m = this.master();
    if (!m || !m.outputParts?.length) {
      this.snackBar.open('No output parts to sync from', 'OK', { duration: 2000 });
      return;
    }

    const existing = this.getCurrentBomForSave();
    const existingIds = new Set(existing.map(i => `${i.partID}-${i.isTool}`));
    let pending = m.outputParts.length;
    let addedCount = 0;

    for (const op of m.outputParts) {
      this.inventoryService.getBom(op.partID).subscribe({
        next: (data) => {
          for (const item of (data.bomItems || [])) {
            const pid = item.componentPartID || item.componentPart?.id || item.partID;
            const key = `${pid}-false`;
            if (pid && !existingIds.has(key)) {
              existing.push({ partID: pid, quantity: Number(item.quantity) || 1, isTool: false });
              existingIds.add(key);
              addedCount++;
            }
          }
          pending--;
          if (pending === 0) {
            if (addedCount > 0) {
              this.saveBom(existing);
              this.snackBar.open(`Synced: ${addedCount} part(s) added from Part BOM`, 'OK', { duration: 3000 });
            } else {
              this.snackBar.open('BOM is already in sync with Part BOM', 'OK', { duration: 2000 });
            }
          }
        },
        error: () => {
          pending--;
          if (pending === 0 && addedCount > 0) {
            this.saveBom(existing);
          }
        },
      });
    }
  }

  private pullBomFromOutputPart(masterId: number, partId: number) {
    this.inventoryService.getBom(partId).subscribe({
      next: (data) => {
        const existing = this.getCurrentBomForSave();
        const existingIds = new Set(existing.map(i => `${i.partID}-${i.isTool}`));
        let added = false;
        for (const item of (data.bomItems || [])) {
          const pid = item.componentPartID || item.componentPart?.id || item.partID;
          const key = `${pid}-false`;
          if (pid && !existingIds.has(key)) {
            existing.push({ partID: pid, quantity: Number(item.quantity) || 1, isTool: false });
            existingIds.add(key);
            added = true;
          }
        }
        if (added) {
          this.saveBom(existing);
        }
      },
    });
  }

  private autosave() {
    const m = this.master();
    if (!m || m.releaseState !== 'draft') return;
    this.isSaving.set(true);
    this.manufacturingService.updateMaster(m.id, {
      name: this.deriveName(),
      description: this.description(),
      outputParts: m.outputParts.map(op => ({ partID: op.partID, quantity: op.quantity })),
    }).subscribe({
      next: (master) => {
        this.master.set(master);
        this.isSaving.set(false);
        this.refreshHistory();
      },
      error: (err) => {
        this.isSaving.set(false);
        this.snackBar.open('Error: ' + err.error?.message, 'OK', { duration: 3000 });
      },
    });
  }

  refreshHistory() {
    const m = this.master();
    if (!m) return;
    this.manufacturingService.getHistory(m.id).subscribe({
      next: (history) => this.history.set(history),
    });
  }

  /** Called when step content changes (parts added/removed, title, etc.) — refreshes history and BOM computeds */
  onStepContentChanged() {
    this.refreshHistory();
    // Bump master signal to force recomputation of aggregatedBomItems / unassigned lists
    const m = this.master();
    if (m) {
      this.master.set({ ...m });
    }
  }

  confirmDeleteMaster() {
    const m = this.master();
    if (!m) return;
    if (!confirm(`Are you sure you want to delete "${m.name}"? This cannot be undone.`)) return;
    this.manufacturingService.deleteMaster(m.id).subscribe({
      next: () => {
        this.snackBar.open('Engineering Master deleted', 'OK', { duration: 2000 });
        this.router.navigate(['/design/masters']);
      },
      error: (err) => this.snackBar.open('Error: ' + (err.error?.message || err.message), 'OK', { duration: 3000 }),
    });
  }

  submitForReview() {
    const m = this.master();
    if (!m) return;

    // Run local verification checks
    const checks: VerificationResult[] = [];
    const warnings: string[] = [];

    // Check: has steps
    const stepCount = m.steps?.length || 0;
    checks.push({
      passed: stepCount > 0,
      label: 'Has at least one step',
      detail: stepCount > 0 ? `${stepCount} step(s)` : 'No steps defined',
    });

    // Check: has output parts
    const outputCount = m.outputParts?.length || 0;
    checks.push({
      passed: outputCount > 0,
      label: 'Has output parts',
      detail: outputCount > 0 ? `${outputCount} output part(s)` : 'No output parts defined',
    });

    // Warning: unassigned BOM items
    const unassignedParts = this.unassignedBomParts();
    const unassignedTools = this.unassignedBomTools();
    const totalUnassigned = unassignedParts.length + unassignedTools.length;
    if (totalUnassigned > 0) {
      warnings.push(`${totalUnassigned} BOM item(s) not assigned to any step: ${[...unassignedParts, ...unassignedTools].map(p => p.name).join(', ')}`);
    }

    // Check: all steps have instructions
    const noInstructions = (m.steps || []).filter(s => !s.instructions?.trim());
    if (noInstructions.length > 0) {
      warnings.push(`Step(s) ${noInstructions.map(s => s.stepNumber).join(', ')} have no instructions`);
    }

    // Check: all steps have an image
    const noImage = (m.steps || []).filter(s => !s.imageFileID);
    if (noImage.length > 0) {
      warnings.push(`Step(s) ${noImage.map(s => s.stepNumber).join(', ')} have no image`);
    }

    const allPassed = checks.every(c => c.passed);
    const hasWarnings = warnings.length > 0;

    const dialogData: VerificationDialogData = {
      title: 'Submit for Review — Verification',
      checks,
      warnings,
      canProceed: allPassed || hasWarnings,
      proceedLabel: hasWarnings && !allPassed ? 'Submit Anyway' : 'Submit for Review',
    };

    // If no issues at all, skip the dialog
    if (allPassed && !hasWarnings) {
      this.doSubmitForReview();
      return;
    }

    const dialogRef = this.dialog.open(VerificationDialog, {
      width: '550px',
      data: dialogData,
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === 'proceed') {
        this.doSubmitForReview();
      }
    });
  }

  private doSubmitForReview() {
    const m = this.master();
    if (!m) return;
    this.manufacturingService.submitForReview(m.id).subscribe({
      next: (response: any) => {
        this.master.set(response);
        this.refreshHistory();
        this.snackBar.open('Submitted for review', 'OK', { duration: 2000 });
      },
      error: (err) => this.snackBar.open('Error: ' + (err.error?.errorMessage || err.error?.message || err.message), 'OK', { duration: 5000 }),
    });
  }

  reject() {
    const m = this.master();
    if (!m) return;
    this.manufacturingService.reject(m.id).subscribe({
      next: (master) => {
        this.master.set(master);
        this.refreshHistory();
        this.snackBar.open('Rejected', 'OK', { duration: 2000 });
      },
      error: (err) => this.snackBar.open('Error: ' + (err.error?.errorMessage || err.error?.message || err.message), 'OK', { duration: 5000 }),
    });
  }

  release() {
    const m = this.master();
    if (!m) return;
    this.manufacturingService.release(m.id).subscribe({
      next: (master) => {
        this.master.set(master);
        this.refreshHistory();
        this.snackBar.open('Released', 'OK', { duration: 2000 });
      },
      error: (err) => this.snackBar.open('Error: ' + (err.error?.errorMessage || err.error?.message || err.message), 'OK', { duration: 5000 }),
    });
  }

  newRevision() {
    const m = this.master();
    if (!m) return;
    this.manufacturingService.newRevision(m.id).subscribe({
      next: (master) => {
        this.router.navigate(['/design/masters', master.id, 'edit']);
        this.snackBar.open('New revision created', 'OK', { duration: 2000 });
      },
      error: (err) => this.snackBar.open('Error: ' + (err.error?.errorMessage || err.error?.message || err.message), 'OK', { duration: 5000 }),
    });
  }

  addStep() {
    const m = this.master();
    if (!m) return;
    this.manufacturingService.createStep({
      engineeringMasterID: m.id,
      title: 'New Step',
    }).subscribe({
      next: (step: any) => {
        this.loadMaster();
        this.selectedStepId.set(step.id);
        this.showHistory.set(false);
      },
    });
  }

  confirmDeleteStep(step: any) {
    if (!confirm(`Are you sure you want to delete step ${step.stepNumber} "${step.title}"?`)) return;
    this.manufacturingService.deleteStep(step.id).subscribe({
      next: () => {
        if (this.selectedStepId() === step.id) {
          this.selectedStepId.set(null);
        }
        this.loadMaster();
        this.snackBar.open('Step deleted', 'OK', { duration: 2000 });
      },
    });
  }

  onStepChanged() {
    this.loadMaster();
    this.refreshHistory();
  }

  searchOutputParts(query: string) {
    this.outputPartSearch.set(query);
    if (query.length < 2) {
      this.outputPartResults.set([]);
      return;
    }
    this.inventoryService.getAllParts().subscribe({
      next: (parts) => {
        const q = query.toLowerCase();
        this.outputPartResults.set(
          parts.filter((p: any) => p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)).slice(0, 10)
        );
      },
    });
  }

  existingEmWarning = signal<{ masterName: string; masterId: number; revision: string } | null>(null);

  selectNewMainPart(part: any) {
    this.newMainPart.set(part);
    this.outputPartSearch.set('');
    this.outputPartResults.set([]);
    this.existingEmWarning.set(null);

    // Check if an EM already exists for this part
    this.manufacturingService.getMasters().subscribe({
      next: (masters) => {
        const existing = masters.find(m =>
          m.activeFlag !== false && m.outputParts?.some((op: any) => op.partID === part.id)
        );
        if (existing) {
          this.existingEmWarning.set({
            masterName: existing.name,
            masterId: existing.id,
            revision: existing.revision,
          });
        }
      },
    });
  }

  addOutputPart(part: any) {
    const m = this.master();
    if (!m) return;
    if (m.outputParts.some(op => op.partID === part.id)) return;
    const updated = [...m.outputParts, { id: 0, engineeringMasterID: m.id, partID: part.id, quantity: 1, part: { id: part.id, name: part.name, revision: part.revision, description: part.description, imageFileID: part.imageFileID, imageFile: part.imageFile } }];
    this.master.set({ ...m, outputParts: updated, name: this.deriveName() });
    this.outputPartSearch.set('');
    this.outputPartResults.set([]);
    this.additionalPartSearch.set('');
    this.additionalPartResults.set([]);
    this.autosave();
    // Pull BOM from the newly added output part
    if (m.id) {
      this.pullBomFromOutputPart(m.id, part.id);
    }
  }

  removeOutputPart(index: number) {
    const m = this.master();
    if (!m) return;
    const updated = [...m.outputParts];
    updated.splice(index, 1);
    this.master.set({ ...m, outputParts: updated, name: updated[0]?.part?.name ?? m.name });
    this.autosave();
  }

  updateOutputPartQty(index: number, value: number) {
    const m = this.master();
    if (!m) return;
    if (isNaN(value) || value < 0) return;
    const updated = [...m.outputParts];
    updated[index] = { ...updated[index], quantity: value };
    this.master.set({ ...m, outputParts: updated });
    this.autosave();
  }

  searchAdditionalParts(query: string) {
    this.additionalPartSearch.set(query);
    if (query.length < 2) {
      this.additionalPartResults.set([]);
      return;
    }
    this.inventoryService.getAllParts().subscribe({
      next: (parts) => {
        const q = query.toLowerCase();
        const existing = new Set(this.master()?.outputParts?.map(op => op.partID) ?? []);
        this.additionalPartResults.set(
          parts.filter((p: any) => !existing.has(p.id) && (p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q))).slice(0, 10)
        );
      },
    });
  }

  searchBomParts(query: string) {
    this.bomSearch.set(query);
    if (query.length < 2) { this.bomSearchResults.set([]); return; }
    this.inventoryService.getAllParts().subscribe({
      next: (parts) => {
        const q = query.toLowerCase();
        this.bomSearchResults.set(
          parts.filter((p: any) => p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)).slice(0, 10)
        );
      },
    });
  }

  addBomPart(part: any, isTool: boolean) {
    // Check if already in merged BOM
    const existing = this.aggregatedBomItems().find(bi => bi.partID === part.id && (bi.typeBadgeClass === (isTool ? 'tool' : 'part')));
    if (existing) {
      this.snackBar.open('Part already in BOM', 'OK', { duration: 2000 });
      return;
    }
    const current = this.getCurrentBomForSave();
    current.push({ partID: part.id, quantity: 1, isTool });
    this.saveBom(current);
    this.bomSearch.set('');
    this.bomSearchResults.set([]);
  }

  removeBomItem(index: number) {
    // Get the item from the merged list
    const items = this.aggregatedBomItems();
    if (index < 0 || index >= items.length) return;
    const removed = items[index];
    const current = this.getCurrentBomForSave().filter(
      bi => !(bi.partID === removed.partID && bi.isTool === (removed.typeBadgeClass === 'tool'))
    );
    this.saveBom(current);
  }

  updateBomQty(index: number, quantity: number) {
    if (isNaN(quantity) || quantity < 0) return;
    const items = this.aggregatedBomItems();
    if (index < 0 || index >= items.length) return;
    const target = items[index];
    const isTool = target.typeBadgeClass === 'tool';
    const current = this.getCurrentBomForSave();
    const match = current.find(bi => bi.partID === target.partID && bi.isTool === isTool);
    if (match) {
      match.quantity = quantity;
    } else {
      current.push({ partID: target.partID, quantity, isTool });
    }
    this.saveBom(current);
  }

  /** Build the full BOM for saving: merge stored bomItems with any step-only items */
  private getCurrentBomForSave(): { partID: number; quantity: number; isTool: boolean }[] {
    return this.aggregatedBomItems().map(bi => ({
      partID: bi.partID,
      quantity: Number(bi.quantity),
      isTool: bi.typeBadgeClass === 'tool',
    }));
  }

  private saveBom(items: { partID: number; quantity: number; isTool: boolean }[]) {
    const m = this.master();
    if (!m) return;
    this.isSaving.set(true);
    this.manufacturingService.updateBom(m.id, items).subscribe({
      next: (master) => {
        this.master.set(master);
        this.isSaving.set(false);
        this.refreshHistory();
      },
      error: (err) => {
        this.isSaving.set(false);
        this.snackBar.open('Error: ' + err.error?.message, 'OK', { duration: 3000 });
      },
    });
  }

  getOutputPartAllowDecimal(op: any): boolean {
    return op.part?.UnitOfMeasure?.allowDecimal ?? false;
  }

  getOutputPartUoM(op: any): string | null {
    return op.part?.UnitOfMeasure?.name ?? null;
  }

  getStateColor(state: string): string {
    switch (state) {
      case 'draft': return '#9e9e9e';
      case 'review': return '#ff9800';
      case 'released': return '#4caf50';
      default: return '#9e9e9e';
    }
  }

  getHistoryIcon(type: string): string {
    switch (type) {
      case 'created': return 'add_circle';
      case 'updated': return 'edit';
      case 'submitted': return 'send';
      case 'rejected': return 'undo';
      case 'released': return 'verified';
      case 'new_revision': return 'content_copy';
      case 'deleted': return 'delete';
      default: return 'history';
    }
  }

  getChangeTypeLabel(type: string): string {
    switch (type) {
      case 'created': return 'Created';
      case 'updated': return 'Updated';
      case 'submitted': return 'Submitted for Review';
      case 'rejected': return 'Rejected';
      case 'released': return 'Released';
      case 'new_revision': return 'New Revision';
      case 'deleted': return 'Deleted';
      default: return type;
    }
  }

  isDiffFormat(value: any): boolean {
    return value && (Array.isArray(value.added) || Array.isArray(value.removed) || Array.isArray(value.changed));
  }

  getChangedFields(changes: any): string[] {
    if (!changes || typeof changes !== 'object') return [];
    return Object.keys(changes);
  }

  getFieldLabel(field: string): string {
    const labels: Record<string, string> = {
      name: 'Name',
      description: 'Description',
      previousRevision: 'Previous Revision',
      outputParts: 'Output Parts',
      bom: 'Bill of Materials',
    };
    return labels[field] || field;
  }
}
