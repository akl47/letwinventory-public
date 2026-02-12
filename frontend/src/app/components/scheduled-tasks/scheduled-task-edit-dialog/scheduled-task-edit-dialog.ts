import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Subscription } from 'rxjs';
import { ScheduledTaskService } from '../../../services/scheduled-task.service';
import { TaskService } from '../../../services/task.service';
import { ProjectService } from '../../../services/project.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { ScheduledTask } from '../../../models/scheduled-task.model';
import { TaskList } from '../../../models/task-list.model';
import { Project } from '../../../models/project.model';

export interface ScheduledTaskEditDialogData {
  scheduledTask?: ScheduledTask;
}

@Component({
  selector: 'app-scheduled-task-edit-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatSlideToggleModule
  ],
  templateUrl: './scheduled-task-edit-dialog.html',
  styleUrl: './scheduled-task-edit-dialog.css',
})
export class ScheduledTaskEditDialog implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<ScheduledTaskEditDialog>);
  private scheduledTaskService = inject(ScheduledTaskService);
  private taskService = inject(TaskService);
  private projectService = inject(ProjectService);
  private errorNotification = inject(ErrorNotificationService);
  data = inject<ScheduledTaskEditDialogData>(MAT_DIALOG_DATA, { optional: true });

  isEditMode = false;
  taskLists = signal<TaskList[]>([]);
  projects = signal<Project[]>([]);
  timezones: string[] = Intl.supportedValuesOf('timeZone');
  cronDescription = signal<string>('');
  private cronSub?: Subscription;

  form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    description: [''],
    taskListID: [null as number | null, Validators.required],
    projectID: [null as number | null],
    timeEstimate: [null as number | null],
    dueDateOffsetHours: [null as number | null],
    cronExpression: ['', Validators.required],
    timezone: ['America/Los_Angeles', Validators.required],
    notifyOnCreate: [true],
    activeFlag: [true]
  });

  constructor() {
    this.loadDropdowns();

    if (this.data?.scheduledTask) {
      this.isEditMode = true;
      const st = this.data.scheduledTask;
      this.form.patchValue({
        name: st.name,
        description: st.description || '',
        taskListID: st.taskListID,
        projectID: st.projectID || null,
        timeEstimate: st.timeEstimate || null,
        dueDateOffsetHours: st.dueDateOffsetHours ?? null,
        cronExpression: st.cronExpression,
        timezone: st.timezone || 'UTC',
        notifyOnCreate: st.notifyOnCreate !== false,
        activeFlag: st.activeFlag
      });
    }
  }

  ngOnInit() {
    this.cronSub = this.form.get('cronExpression')!.valueChanges.subscribe(value => {
      this.updateCronDescription(value || '');
    });
    // Set initial description if editing
    this.updateCronDescription(this.form.value.cronExpression || '');
  }

  ngOnDestroy() {
    this.cronSub?.unsubscribe();
  }

  private updateCronDescription(expr: string) {
    if (!expr.trim()) {
      this.cronDescription.set('');
      return;
    }
    try {
      const parts = expr.trim().split(/\s+/);
      if (parts.length !== 5) throw new Error();
      const [min, hour, dom, mon, dow] = parts;
      const descs: string[] = [];
      if (min === '0' && hour === '*') descs.push('Every hour');
      else if (min === '0' && hour !== '*') descs.push(`At ${hour}:00`);
      else if (min !== '*' && hour !== '*') descs.push(`At ${hour}:${min.padStart(2, '0')}`);
      else if (min !== '*') descs.push(`At minute ${min}`);
      else descs.push(`Every minute`);
      if (dom !== '*') descs.push(`on day ${dom}`);
      if (mon !== '*') descs.push(`of month ${mon}`);
      if (dow !== '*') {
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const dayName = days[parseInt(dow)] || dow;
        descs.push(`on ${dayName}`);
      }
      this.cronDescription.set(descs.join(' '));
    } catch {
      this.cronDescription.set('Invalid cron expression');
    }
  }

  loadDropdowns() {
    this.taskService.getTaskLists().subscribe({
      next: (lists) => this.taskLists.set(lists),
    });
    this.projectService.getProjects().subscribe({
      next: (projects) => this.projects.set(projects),
    });
  }

  save() {
    Object.keys(this.form.controls).forEach(key => {
      this.form.get(key)?.markAsTouched();
    });

    if (!this.form.valid) {
      this.errorNotification.showError('Please fill in all required fields');
      return;
    }

    const formData = {
      name: this.form.value.name!,
      description: this.form.value.description || undefined,
      taskListID: this.form.value.taskListID!,
      projectID: this.form.value.projectID || undefined,
      taskTypeEnum: 'scheduled' as ScheduledTask['taskTypeEnum'],
      timeEstimate: this.form.value.timeEstimate || undefined,
      dueDateOffsetHours: this.form.value.dueDateOffsetHours ?? undefined,
      cronExpression: this.form.value.cronExpression!,
      timezone: this.form.value.timezone!,
      notifyOnCreate: this.form.value.notifyOnCreate ?? true,
      activeFlag: this.form.value.activeFlag ?? true
    };

    if (this.isEditMode && this.data?.scheduledTask?.id) {
      this.scheduledTaskService.update(this.data.scheduledTask.id, formData).subscribe({
        next: () => {
          this.errorNotification.showSuccess('Scheduled task updated');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.errorNotification.showHttpError(err, 'Failed to update scheduled task');
        }
      });
    } else {
      this.scheduledTaskService.create(formData).subscribe({
        next: () => {
          this.errorNotification.showSuccess('Scheduled task created');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.errorNotification.showHttpError(err, 'Failed to create scheduled task');
        }
      });
    }
  }

  delete() {
    if (!this.isEditMode || !this.data?.scheduledTask?.id) return;

    const confirmed = confirm(`Are you sure you want to delete "${this.data.scheduledTask.name}"?`);
    if (!confirmed) return;

    this.scheduledTaskService.delete(this.data.scheduledTask.id).subscribe({
      next: () => {
        this.errorNotification.showSuccess('Scheduled task deleted');
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.errorNotification.showHttpError(err, 'Failed to delete scheduled task');
      }
    });
  }
}
