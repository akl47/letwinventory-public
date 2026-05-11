import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { HarnessService } from '../../../services/harness.service';
import { AuthService } from '../../../services/auth.service';
import { WireHarnessSummary, createEmptyHarnessData } from '../../../models/harness.model';
import { PartEditDialog } from '../../inventory/part-edit-dialog/part-edit-dialog';
import { Part } from '../../../models';
import { DataTable, DataTableColumnDef, ColumnDef, FilterSection } from '../../common/data-table/data-table';

@Component({
  selector: 'app-harness-list-view',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    DataTable,
    DataTableColumnDef,
  ],
  templateUrl: './harness-list-view.html',
  styleUrl: './harness-list-view.css',
})
export class HarnessListView implements OnInit {
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private harnessService = inject(HarnessService);
  private authService = inject(AuthService);
  canWrite = computed(() => this.authService.hasPermission('harness', 'write'));

  allHarnesses = signal<WireHarnessSummary[]>([]);
  isLoading = signal(true);

  columns: ColumnDef<WireHarnessSummary>[] = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'partNumber', header: 'Part Number', sortable: true },
    { key: 'revision', header: 'Rev', sortable: true },
    { key: 'releaseState', header: 'Status', sortable: true },
    { key: 'description', header: 'Description', sortable: true },
    { key: 'updatedAt', header: 'Last Modified', sortable: true, sortValue: h => h.updatedAt ? new Date(h.updatedAt).getTime() : null },
    { key: 'actions', header: 'Actions' },
  ];

  filterSections: FilterSection<WireHarnessSummary>[] = [
    {
      type: 'toggle',
      key: 'inactive',
      label: 'Show Inactive',
      default: false,
      predicate: (h, on) => on || h.activeFlag === true,
    },
  ];

  searchKeys = ['name', 'partNumber', 'description'];

  rowHref = (h: WireHarnessSummary) => `/harness/editor/${h.id}`;

  ngOnInit() {
    this.loadHarnesses();
  }

  loadHarnesses() {
    this.isLoading.set(true);
    this.harnessService.getAllHarnesses().subscribe({
      next: (response) => {
        this.allHarnesses.set(response.harnesses);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  createNew() {
    const dialogRef = this.dialog.open(PartEditDialog, {
      width: '500px',
      data: { lockedCategory: 'Harness' },
    });
    dialogRef.afterClosed().subscribe((result: boolean | Part | undefined) => {
      if (result && typeof result === 'object') {
        const part = result as Part;
        const harnessData = createEmptyHarnessData(part.name);
        harnessData.description = part.description || '';
        this.harnessService.createHarness({
          name: part.name,
          description: part.description || undefined,
          harnessData,
          partID: part.id,
        }).subscribe({
          next: (harness) => this.router.navigate(['/harness/editor', harness.id]),
        });
      }
    });
  }

  openHarness(harness: WireHarnessSummary) {
    this.router.navigate(['/harness/editor', harness.id]);
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
