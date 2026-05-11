import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ScheduledTaskService } from '../../../services/scheduled-task.service';
import { ScheduledTask } from '../../../models/scheduled-task.model';
import { ScheduledTaskEditDialog } from '../scheduled-task-edit-dialog/scheduled-task-edit-dialog';
import { DataTable, DataTableColumnDef, ColumnDef, FilterSection } from '../../common/data-table/data-table';

@Component({
  selector: 'app-scheduled-tasks-list-view',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatDialogModule,
    DataTable,
    DataTableColumnDef,
  ],
  templateUrl: './scheduled-tasks-list-view.html',
  styleUrl: './scheduled-tasks-list-view.css',
})
export class ScheduledTasksListView implements OnInit {
  private scheduledTaskService = inject(ScheduledTaskService);
  private dialog = inject(MatDialog);
  private location = inject(Location);

  allItems = signal<ScheduledTask[]>([]);
  showInactiveLoaded = signal<boolean>(false);

  columns: ColumnDef<ScheduledTask>[] = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'cronExpression', header: 'Schedule', sortable: true },
    { key: 'cronDescription', header: 'Description' },
    { key: 'taskList', header: 'Task List', sortable: true, sortValue: t => t.taskList?.name?.toLowerCase() ?? null },
    { key: 'project', header: 'Project', sortable: true, sortValue: t => t.project?.name?.toLowerCase() ?? null },
    { key: 'notifyOnCreate', header: 'Notify', sortable: true },
    { key: 'nextRunAt', header: 'Next Run', sortable: true, sortValue: t => t.nextRunAt ? new Date(t.nextRunAt).getTime() : null },
    { key: 'lastRunAt', header: 'Last Run', sortable: true, sortValue: t => t.lastRunAt ? new Date(t.lastRunAt).getTime() : null },
  ];

  filterSections: FilterSection<ScheduledTask>[] = [
    {
      type: 'toggle',
      key: 'inactive',
      label: 'Show Inactive',
      default: false,
      predicate: (t, on) => {
        if (on) {
          this.ensureInactiveLoaded();
          return true;
        }
        return t.activeFlag === true;
      },
    },
  ];

  searchKeys = ['name', 'cronExpression', 'taskList.name', 'project.name'];

  ngOnInit() {
    this.loadData(false);
  }

  goBack() {
    this.location.back();
  }

  loadData(includeInactive: boolean) {
    this.scheduledTaskService.clearCache();
    this.scheduledTaskService.getAll(includeInactive).subscribe({
      next: (items) => {
        this.allItems.set(items);
        this.showInactiveLoaded.set(includeInactive);
      },
      error: (err) => console.error('Error loading scheduled tasks:', err),
    });
  }

  private ensureInactiveLoaded() {
    if (!this.showInactiveLoaded()) {
      this.loadData(true);
    }
  }

  openNewDialog() {
    const dialogRef = this.dialog.open(ScheduledTaskEditDialog, { width: '550px', data: {} });
    dialogRef.afterClosed().subscribe(result => { if (result) this.loadData(this.showInactiveLoaded()); });
  }

  editItem(item: ScheduledTask) {
    const dialogRef = this.dialog.open(ScheduledTaskEditDialog, { width: '550px', data: { scheduledTask: item } });
    dialogRef.afterClosed().subscribe(result => { if (result) this.loadData(this.showInactiveLoaded()); });
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
}
