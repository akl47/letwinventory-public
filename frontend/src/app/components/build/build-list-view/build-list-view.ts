import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { InventoryService } from '../../../services/inventory.service';
import { AuthService } from '../../../services/auth.service';
import { NewBuildDialog } from '../new-build-dialog/new-build-dialog';
import { BarcodeTag } from '../../inventory/barcode-tag/barcode-tag';
import { PartNumberPipe } from '../../../pipes/part-number.pipe';

@Component({
  selector: 'app-build-list-view',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatSlideToggleModule,
    BarcodeTag,
    PartNumberPipe,
  ],
  templateUrl: './build-list-view.html',
  styleUrl: './build-list-view.css',
})
export class BuildListView implements OnInit {
  private router = inject(Router);
  private inventoryService = inject(InventoryService);
  private authService = inject(AuthService);
  private dialog = inject(MatDialog);

  canWrite = computed(() => this.authService.hasPermission('inventory', 'write'));

  builds = signal<any[]>([]);
  isLoading = signal(true);
  searchText = signal('');
  showCompleted = signal(false);
  displayedColumns = ['barcode', 'partName', 'category', 'status', 'progress', 'createdAt'];

  displayedBuilds = computed(() => {
    const search = this.searchText().toLowerCase();
    let filtered = this.builds();
    if (search) {
      filtered = filtered.filter(b =>
        b.partName?.toLowerCase().includes(search) ||
        b.barcode?.toLowerCase().includes(search) ||
        b.categoryName?.toLowerCase().includes(search)
      );
    }
    return filtered;
  });

  ngOnInit() {
    this.loadBuilds();
  }

  toggleShowCompleted() {
    this.showCompleted.update(v => !v);
    this.loadBuilds();
  }

  loadBuilds() {
    this.isLoading.set(true);
    this.inventoryService.getInProgressBuilds(this.showCompleted()).subscribe({
      next: (builds) => {
        this.builds.set(builds);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }

  onSearchChange(value: string) {
    this.searchText.set(value);
  }

  openNewBuild() {
    const dialogRef = this.dialog.open(NewBuildDialog, {
      width: '500px'
    });
    dialogRef.afterClosed().subscribe((result: any) => {
      if (result?.barcodeId) {
        this.router.navigate(['/kits', result.barcodeId]);
      }
    });
  }

  openBuild(build: any) {
    this.router.navigate(['/kits', build.barcodeID]);
  }

  getCategoryBgColor(hex: string | null): string {
    if (!hex) return 'rgba(255, 255, 255, 0.2)';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, 0.2)`;
  }

  getCategoryTextColor(hex: string | null): string {
    return hex || '#808080';
  }
}
