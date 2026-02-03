import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatMenuModule } from '@angular/material/menu';
import { HarnessService } from '../../../services/harness.service';
import { WireHarnessSummary, HarnessPagination } from '../../../models/harness.model';

export interface HarnessListDialogData {
  excludeHarnessId?: number;  // Harness ID to exclude from the list
  excludePartNumber?: string; // Part number to exclude (filters out all revisions of a harness)
  selectMode?: boolean;       // If true, hides delete button and changes title
}

@Component({
  selector: 'app-harness-list-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
    MatPaginatorModule,
    MatMenuModule
  ],
  templateUrl: './harness-list-dialog.html',
  styleUrls: ['./harness-list-dialog.scss']
})
export class HarnessListDialog implements OnInit {
  private dialogRef = inject(MatDialogRef<HarnessListDialog>);
  private harnessService = inject(HarnessService);
  private dialogData = inject<HarnessListDialogData>(MAT_DIALOG_DATA, { optional: true });

  harnesses = signal<WireHarnessSummary[]>([]);
  pagination = signal<HarnessPagination>({ total: 0, page: 1, limit: 20, totalPages: 0 });
  loading = signal<boolean>(false);
  selectedHarness = signal<WireHarnessSummary | null>(null);
  searchText = '';

  // Expose dialog data for template
  get excludeHarnessId(): number | undefined { return this.dialogData?.excludeHarnessId; }
  get excludePartNumber(): string | undefined { return this.dialogData?.excludePartNumber; }
  get selectMode(): boolean { return this.dialogData?.selectMode ?? false; }

  private searchTimeout: any;

  ngOnInit() {
    this.loadHarnesses();
  }

  loadHarnesses(page: number = 1) {
    this.loading.set(true);
    this.harnessService.getAllHarnesses(page, this.pagination().limit).subscribe({
      next: (response) => {
        // Filter out the excluded harness if specified
        let filtered = response.harnesses;
        if (this.excludeHarnessId) {
          filtered = filtered.filter(h => h.id !== this.excludeHarnessId);
        }
        // Filter out harnesses with the same part number (all revisions of same harness)
        if (this.excludePartNumber) {
          filtered = filtered.filter(h => h.partNumber !== this.excludePartNumber);
        }
        this.harnesses.set(filtered);
        this.pagination.set(response.pagination);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  onSearch() {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.loadHarnesses(1);
    }, 300);
  }

  onPageChange(event: PageEvent) {
    this.loadHarnesses(event.pageIndex + 1);
  }

  selectHarness(harness: WireHarnessSummary) {
    this.selectedHarness.set(harness);
  }

  openSelected() {
    const harness = this.selectedHarness();
    if (harness) {
      // Fetch full harness data
      this.harnessService.getHarnessById(harness.id).subscribe({
        next: (fullHarness) => {
          this.dialogRef.close(fullHarness);
        }
      });
    }
  }


  deleteHarness(harness: WireHarnessSummary) {
    if (confirm(`Delete "${harness.name}"? This action cannot be undone.`)) {
      this.harnessService.deleteHarness(harness.id).subscribe({
        next: () => {
          this.loadHarnesses(this.pagination().page);
        }
      });
    }
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString();
  }
}
