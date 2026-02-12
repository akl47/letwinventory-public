import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { ScheduledTaskService } from '../../../services/scheduled-task.service';
import { ScheduledTask } from '../../../models/scheduled-task.model';
import { ScheduledTaskEditDialog } from '../scheduled-task-edit-dialog/scheduled-task-edit-dialog';

@Component({
  selector: 'app-scheduled-tasks-list-view',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatInputModule,
    MatFormFieldModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatSlideToggleModule,
    MatDialogModule,
    FormsModule
  ],
  templateUrl: './scheduled-tasks-list-view.html',
  styleUrl: './scheduled-tasks-list-view.css',
})
export class ScheduledTasksListView implements OnInit {
  private scheduledTaskService = inject(ScheduledTaskService);
  private dialog = inject(MatDialog);
  private location = inject(Location);

  allItems = signal<ScheduledTask[]>([]);
  displayedItems = signal<ScheduledTask[]>([]);
  searchText = signal<string>('');
  showInactive = signal<boolean>(false);

  displayedColumns: string[] = ['name', 'cronExpression', 'cronDescription', 'taskList', 'project', 'notifyOnCreate', 'nextRunAt', 'lastRunAt'];

  // Pagination
  pageSize = signal<number>(10);
  pageIndex = signal<number>(0);
  pageSizeOptions = [5, 10, 25, 50];

  // Sorting
  sortColumn = signal<string>('name');
  sortDirection = signal<'asc' | 'desc'>('asc');

  ngOnInit() {
    this.loadData();
  }

  goBack() {
    this.location.back();
  }

  loadData() {
    this.scheduledTaskService.clearCache();
    this.scheduledTaskService.getAll(this.showInactive()).subscribe({
      next: (items) => {
        this.allItems.set(items);
        this.applyFiltersAndSort();
      },
      error: (err) => {
        console.error('Error loading scheduled tasks:', err);
      }
    });
  }

  applyFiltersAndSort() {
    let filtered = [...this.allItems()];

    if (!this.showInactive()) {
      filtered = filtered.filter(item => item.activeFlag === true);
    }

    const search = this.searchText().toLowerCase();
    if (search) {
      filtered = filtered.filter(item =>
        item.name.toLowerCase().includes(search) ||
        item.cronExpression.toLowerCase().includes(search) ||
        item.taskList?.name?.toLowerCase().includes(search) ||
        item.project?.name?.toLowerCase().includes(search)
      );
    }

    const sortCol = this.sortColumn();
    const sortDir = this.sortDirection();
    filtered.sort((a, b) => {
      const aVal = this.getSortValue(a, sortCol);
      const bVal = this.getSortValue(b, sortCol);

      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return sortDir === 'asc' ? 1 : -1;
      if (bVal === null) return sortDir === 'asc' ? -1 : 1;

      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === 'asc' ? comparison : -comparison;
    });

    const startIndex = this.pageIndex() * this.pageSize();
    const endIndex = startIndex + this.pageSize();
    this.displayedItems.set(filtered.slice(startIndex, endIndex));
  }

  onSearchChange(value: string) {
    this.searchText.set(value);
    this.pageIndex.set(0);
    this.applyFiltersAndSort();
  }

  onPageChange(event: PageEvent) {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.applyFiltersAndSort();
  }

  onSortChange(sort: Sort) {
    this.sortColumn.set(sort.active);
    this.sortDirection.set(sort.direction as 'asc' | 'desc' || 'asc');
    this.applyFiltersAndSort();
  }

  onToggleInactive(checked: boolean) {
    this.showInactive.set(checked);
    this.pageIndex.set(0);
    this.loadData();
  }

  getTotalCount(): number {
    let filtered = [...this.allItems()];

    if (!this.showInactive()) {
      filtered = filtered.filter(item => item.activeFlag === true);
    }

    const search = this.searchText().toLowerCase();
    if (search) {
      filtered = filtered.filter(item =>
        item.name.toLowerCase().includes(search) ||
        item.cronExpression.toLowerCase().includes(search) ||
        item.taskList?.name?.toLowerCase().includes(search) ||
        item.project?.name?.toLowerCase().includes(search)
      );
    }

    return filtered.length;
  }

  openNewDialog() {
    const dialogRef = this.dialog.open(ScheduledTaskEditDialog, {
      width: '550px',
      data: {}
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadData();
      }
    });
  }

  editItem(item: ScheduledTask) {
    const dialogRef = this.dialog.open(ScheduledTaskEditDialog, {
      width: '550px',
      data: { scheduledTask: item }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadData();
      }
    });
  }

  cronToEnglish(expr: string): string {
    if (!expr?.trim()) return '';
    try {
      const parts = expr.trim().split(/\s+/);
      if (parts.length !== 5) return expr;
      const [min, hour, dom, mon, dow] = parts;
      const descs: string[] = [];
      if (min === '0' && hour === '*') descs.push('Every hour');
      else if (min === '0' && hour !== '*') descs.push(`At ${hour}:00`);
      else if (min !== '*' && hour !== '*') descs.push(`At ${hour}:${min.padStart(2, '0')}`);
      else if (min !== '*') descs.push(`At minute ${min}`);
      else descs.push('Every minute');
      if (dom !== '*') descs.push(`on day ${dom}`);
      if (mon !== '*') descs.push(`of month ${mon}`);
      if (dow !== '*') {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayName = days[parseInt(dow)] || dow;
        descs.push(`on ${dayName}`);
      }
      return descs.join(' ');
    } catch {
      return expr;
    }
  }

  private getSortValue(item: ScheduledTask, column: string): string | number | null {
    switch (column) {
      case 'nextRunAt':
        return item.nextRunAt ? new Date(item.nextRunAt).getTime() : null;
      case 'lastRunAt':
        return item.lastRunAt ? new Date(item.lastRunAt).getTime() : null;
      case 'taskList':
        return item.taskList?.name?.toLowerCase() || null;
      case 'project':
        return item.project?.name?.toLowerCase() || null;
      default:
        const val = (item as any)[column];
        if (val === undefined || val === null) return null;
        if (typeof val === 'string') return val.toLowerCase();
        return val;
    }
  }
}
