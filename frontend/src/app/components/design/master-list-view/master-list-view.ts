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
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { ManufacturingService } from '../../../services/manufacturing.service';
import { AuthService } from '../../../services/auth.service';
import { EngineeringMaster } from '../../../models/engineering-master.model';

@Component({
  selector: 'app-master-list-view',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule,
    MatProgressSpinnerModule, MatTooltipModule, MatChipsModule,
  ],
  templateUrl: './master-list-view.html',
  styleUrl: './master-list-view.css',
})
export class MasterListView implements OnInit {
  private router = inject(Router);
  private manufacturingService = inject(ManufacturingService);
  private authService = inject(AuthService);

  canWrite = computed(() => this.authService.hasPermission('manufacturing_planning', 'write'));

  masters = signal<EngineeringMaster[]>([]);
  isLoading = signal(true);
  searchText = signal('');
  displayedColumns = ['name', 'revision', 'releaseState', 'outputParts', 'steps', 'createdAt'];

  displayedMasters = computed(() => {
    const search = this.searchText().toLowerCase();
    let filtered = this.masters();
    if (search) {
      filtered = filtered.filter(m =>
        m.name?.toLowerCase().includes(search) ||
        m.description?.toLowerCase().includes(search)
      );
    }
    return filtered;
  });

  ngOnInit() {
    this.loadMasters();
  }

  loadMasters() {
    this.isLoading.set(true);
    this.manufacturingService.getMasters().subscribe({
      next: (masters) => {
        this.masters.set(masters);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  onSearchChange(value: string) {
    this.searchText.set(value);
  }

  createMaster() {
    this.router.navigate(['/design/masters/new']);
  }

  openMaster(master: EngineeringMaster) {
    this.router.navigate(['/design/masters', master.id, 'edit']);
  }

  getStateColor(state: string): string {
    switch (state) {
      case 'draft': return '#9e9e9e';
      case 'review': return '#ff9800';
      case 'released': return '#4caf50';
      default: return '#9e9e9e';
    }
  }
}
