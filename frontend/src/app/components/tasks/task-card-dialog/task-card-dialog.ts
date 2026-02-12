import { Component, inject, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { Task, ChecklistItem } from '../../../models/task.model';
import { CommonModule } from '@angular/common';
import { TaskService } from '../../../services/task.service';
import { TaskList } from '../../../models/task-list.model';
import { ProjectService } from '../../../services/project.service';
import { Project } from '../../../models/project.model';

export interface TaskCardDialogData {
  task: Task;
}

export type TaskTypeEnum = 'normal' | 'tracking' | 'critical_path' | 'scheduled';

export interface LabelOption {
  value: TaskTypeEnum;
  label: string;
  colorClass: string;
}

@Component({
  selector: 'app-task-card-dialog',
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatMenuModule, MatDatepickerModule, FormsModule, MatSlideToggleModule],
  templateUrl: './task-card-dialog.html',
  styleUrl: './task-card-dialog.css',
})
export class TaskCardDialog implements OnInit, OnDestroy {
  data = inject<TaskCardDialogData>(MAT_DIALOG_DATA);
  private taskService = inject(TaskService);
  private projectService = inject(ProjectService);
  private pendingRefresh: any;

  labelOptions = signal<LabelOption[]>([]);

  task = signal<Task>(this.data.task);
  taskLists = signal<TaskList[]>([]);
  projects = signal<Project[]>([]);
  isEditingDescription = signal(false);
  descriptionDraft = signal('');
  subtasks = signal<Task[]>([]);
  subtaskDraft = signal('');
  showSubtasks = signal(false);
  availableTasks = signal<Task[]>([]);
  searchQuery = signal('');
  isEditingTitle = signal(false);
  titleDraft = signal('');
  showChecklist = signal(false);
  checklistDraft = signal('');

  checklist = computed(() => this.task().checklist || []);
  checklistProgress = computed(() => {
    const items = this.checklist();
    if (!items.length) return '';
    const checked = items.filter(i => i.checked).length;
    return `${checked}/${items.length}`;
  });
  checklistProgressPercent = computed(() => {
    const items = this.checklist();
    if (!items.length) return 0;
    return (items.filter(i => i.checked).length / items.length) * 100;
  });

  currentListName = computed(() => {
    const lists = this.taskLists();
    const task = this.task();
    const currentList = lists.find(l => l.id === task.taskListID);
    return currentList ? currentList.name : '';
  });

  currentProject = computed(() => {
    const projects = this.projects();
    const task = this.task();
    return projects.find(p => p.id === task.projectID);
  });

  filteredAvailableTasks = computed(() => {
    const query = this.searchQuery().toLowerCase();
    return this.availableTasks().filter(task =>
      task.name.toLowerCase().includes(query)
    );
  });

  ngOnInit(): void {
    this.loadTaskTypes();
    this.loadTaskLists();
    this.loadProjects();
    this.loadSubtasks();
    this.loadAvailableTasks();
    this.descriptionDraft.set(this.task().description || '');
    this.titleDraft.set(this.task().name);
    if (this.task().checklist?.length) {
      this.showChecklist.set(true);
    }
  }

  loadTaskTypes(): void {
    this.taskService.getTaskTypes().subscribe({
      next: (types) => {
        this.labelOptions.set(types.filter((t: any) => t.value !== 'scheduled'));
      },
      error: (err) => console.error('Failed to load task types', err)
    });
  }

  loadSubtasks(): void {
    this.taskService.getSubtasks(this.task().id).subscribe({
      next: (tasks) => {
        this.subtasks.set(tasks);
        if (tasks.length > 0) {
          this.showSubtasks.set(true);
        }
      },
      error: (err) => console.error('Failed to load subtasks', err)
    });
  }

  loadAvailableTasks(): void {
    this.taskService.getAllTasks().subscribe({
      next: (tasks) => {
        const currentId = this.task().id;
        const subtaskIds = this.subtasks().map(s => s.id);
        // Available: not done, not current, not already a subtask, active, AND no existing parent
        const available = tasks.filter(t =>
          !t.doneFlag &&
          t.id !== currentId &&
          !subtaskIds.includes(t.id) &&
          t.activeFlag &&
          !t.parentTaskID
        );
        this.availableTasks.set(available);
      },
      error: (err) => console.error('Failed to load available tasks', err)
    });
  }

  toggleSubtasks(): void {
    this.showSubtasks.set(true);
  }

  toggleChecklist(): void {
    this.showChecklist.set(true);
  }

  addChecklistItem(): void {
    const text = this.checklistDraft().trim();
    if (!text) return;

    const item: ChecklistItem = {
      id: crypto.randomUUID(),
      text,
      checked: false
    };
    const newChecklist = [...this.checklist(), item];
    this.checklistDraft.set('');
    this.updateChecklist(newChecklist);
  }

  toggleChecklistItem(id: string): void {
    const newChecklist = this.checklist().map(item =>
      item.id === id ? { ...item, checked: !item.checked } : item
    );
    this.updateChecklist(newChecklist);
  }

  deleteChecklistItem(id: string): void {
    const newChecklist = this.checklist().filter(item => item.id !== id);
    this.updateChecklist(newChecklist.length ? newChecklist : null as any);
  }

  private updateChecklist(checklist: ChecklistItem[] | null): void {
    const task = this.task();
    this.task.set({ ...task, checklist: checklist as any });
    this.taskService.updateTask(task.id, { checklist } as any).subscribe({
      next: () => this.taskService.triggerRefresh(),
      error: (err) => console.error('Failed to update checklist', err)
    });
  }

  addSubtask(): void {
    const name = this.subtaskDraft().trim();
    if (!name) return;

    const parentTask = this.task();
    const subtask: Partial<Task> = {
      name,
      taskListID: parentTask.taskListID,
      projectID: parentTask.projectID,
      parentTaskID: parentTask.id,
      ownerUserID: parentTask.ownerUserID
    };

    this.taskService.createTask(subtask).subscribe({
      next: (newTask) => {
        this.subtasks.set([...this.subtasks(), newTask]);
        this.subtaskDraft.set('');
        this.taskService.triggerRefresh();
        this.loadAvailableTasks();
      },
      error: (err) => console.error('Failed to create subtask', err)
    });
  }

  toggleCompleteWithChildren(): void {
    const task = this.task();
    const newValue = !task.completeWithChildren;
    this.taskService.updateTask(task.id, { completeWithChildren: newValue }).subscribe({
      next: (updatedTask) => {
        this.task.set({ ...task, completeWithChildren: updatedTask.completeWithChildren });
        this.taskService.triggerRefresh();
      },
      error: (err) => console.error('Failed to toggle auto-complete', err)
    });
  }

  linkExistingTask(task: Task): void {
    this.taskService.updateTask(task.id, {
      parentTaskID: this.task().id,
      projectID: this.task().projectID
    }).subscribe({
      next: (updatedTask) => {
        this.subtasks.set([...this.subtasks(), updatedTask]);
        this.taskService.triggerRefresh();
        this.loadAvailableTasks();
      },
      error: (err) => console.error('Failed to link existing task', err)
    });
  }

  toggleSubtaskDone(subtask: Task): void {
    const newDoneFlag = !subtask.doneFlag;
    this.taskService.updateTask(subtask.id, { doneFlag: newDoneFlag }).subscribe({
      next: (updatedTask) => {
        this.subtasks.set(this.subtasks().map(t => t.id === updatedTask.id ? updatedTask : t));
        this.taskService.triggerRefresh();
      },
      error: (err) => console.error('Failed to toggle subtask', err)
    });
  }

  unlinkSubtask(subtask: Task): void {
    this.taskService.updateTask(subtask.id, { parentTaskID: null as any }).subscribe({
      next: () => {
        this.subtasks.set(this.subtasks().filter(t => t.id !== subtask.id));
        this.taskService.triggerRefresh();
        this.loadAvailableTasks();
      },
      error: (err) => console.error('Failed to unlink subtask', err)
    });
  }

  removeSubtask(subtaskId: number): void {
    // Legacy - removed in favor of unlink
  }

  toggleEditTitle(): void {
    this.titleDraft.set(this.task().name);
    this.isEditingTitle.set(true);
  }

  updateTitle(): void {
    const newTitle = this.titleDraft().trim();
    if (!newTitle || newTitle === this.task().name) {
      this.isEditingTitle.set(false);
      return;
    }

    this.taskService.updateTask(this.task().id, { name: newTitle }).subscribe({
      next: (updatedTask) => {
        this.task.set(updatedTask);
        this.isEditingTitle.set(false);
        this.taskService.triggerRefresh();
      },
      error: (err) => console.error('Failed to update title', err)
    });
  }

  toggleEditDescription(): void {
    this.descriptionDraft.set(this.task().description || '');
    this.isEditingDescription.set(true);
  }

  updateDraft(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.descriptionDraft.set(value);
  }

  cancelEditDescription(): void {
    this.isEditingDescription.set(false);
  }

  saveDescription(): void {
    const newDescription = this.descriptionDraft();
    const task = this.task();
    this.taskService.updateTask(task.id, { description: newDescription }).subscribe({
      next: (updatedTask) => {
        this.task.set({ ...task, description: updatedTask.description });
        this.isEditingDescription.set(false);
        this.taskService.triggerRefresh();
      },
      error: (err) => console.error('Failed to update description', err)
    });
  }

  loadTaskLists(): void {
    this.taskService.getTaskLists().subscribe({
      next: (lists) => {
        this.taskLists.set(lists);
      },
      error: (err) => console.error('Failed to load task lists', err)
    });
  }

  loadProjects(): void {
    this.projectService.getProjects().subscribe({
      next: (projects) => {
        this.projects.set(projects);
      },
      error: (err) => console.error('Failed to load projects', err)
    });
  }

  ngOnDestroy(): void {
    if (this.pendingRefresh) {
      clearTimeout(this.pendingRefresh);
      this.taskService.triggerRefresh();
    }
  }

  isDueToday(): boolean {
    const task = this.task();
    if (!task.dueDate) return false;
    const due = new Date(task.dueDate);
    const now = new Date();
    return due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth() && due.getDate() === now.getDate();
  }

  isOverdue(): boolean {
    const task = this.task();
    if (!task.dueDate) return false;
    if (this.isDueToday()) return false;
    const due = new Date(task.dueDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return due < now;
  }

  selectLabel(option: LabelOption): void {
    const task = this.task();
    // Assuming updateTask works for labels too
    this.taskService.updateTask(task.id, { taskTypeEnum: option.value }).subscribe({
      next: (updatedTask) => {
        this.task.set({ ...task, taskTypeEnum: updatedTask.taskTypeEnum });
        this.taskService.triggerRefresh();
      }
    });
  }

  toggleComplete(): void {
    const currentTask = this.task();
    const newDoneFlag = !currentTask.doneFlag;

    if (this.pendingRefresh) {
      clearTimeout(this.pendingRefresh);
      this.pendingRefresh = null;
    }

    // Optimistic Update
    this.task.set({ ...currentTask, doneFlag: newDoneFlag });

    this.taskService.updateTask(currentTask.id, { doneFlag: newDoneFlag }).subscribe({
      next: (updatedTask) => {
        // Ensure signal is in sync with server one more time
        this.task.set({ ...currentTask, doneFlag: updatedTask.doneFlag });

        if (newDoneFlag) {
          this.pendingRefresh = setTimeout(() => {
            this.taskService.triggerRefresh();
            this.pendingRefresh = null;
          }, 3000);
        } else {
          this.taskService.triggerRefresh();
        }
      },
      error: (err) => {
        console.error('Failed to toggle completion status', err);
        // Revert Optimistic Update
        this.task.set(currentTask);
      }
    });
  }

  moveToList(list: TaskList): void {
    const task = this.task();
    if (list.id === task.taskListID) return;

    this.taskService.moveTask(task.id, list.id, 0).subscribe({
      next: (updatedTask) => {
        this.task.set({ ...task, taskListID: list.id });
        this.taskService.triggerRefresh();
        // The computed signals will update automatically now
      },
      error: (err) => console.error('Failed to move task', err)
    });
  }

  selectProject(project: Project | null): void {
    const task = this.task();
    const newProjectId = project ? project.id : null;
    if (newProjectId === task.projectID) return;

    this.taskService.updateTask(task.id, { projectID: newProjectId as any }).subscribe({
      next: (updatedTask) => {
        this.task.set({ ...task, projectID: newProjectId as any });
        this.taskService.triggerRefresh();
      },
      error: (err) => console.error('Failed to update project', err)
    });
  }

  selectedDate = signal<Date | null>(null);
  selectedTime = signal<string>('12:00');

  openDateMenu(): void {
    const task = this.task();
    if (task.dueDate) {
      const d = new Date(task.dueDate);
      this.selectedDate.set(d);
      const pad = (n: number) => n.toString().padStart(2, '0');
      this.selectedTime.set(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    } else {
      const now = this.roundToNearest15Minutes(new Date());
      this.selectedDate.set(now);
      const pad = (n: number) => n.toString().padStart(2, '0');
      this.selectedTime.set(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
    }
  }

  private roundToNearest15Minutes(date: Date): Date {
    const result = new Date(date);
    const minutes = result.getMinutes();
    const roundedMinutes = Math.floor(minutes / 15) * 15;
    result.setMinutes(roundedMinutes, 0, 0);
    return result;
  }

  saveDueDate(): void {
    const date = this.selectedDate();
    if (!date) return;

    const time = this.selectedTime() || '00:00';
    const [hours, minutes] = time.split(':').map(Number);

    const dueDate = new Date(date);
    dueDate.setHours(hours, minutes, 0, 0);

    const task = this.task();
    this.taskService.updateTask(task.id, { dueDate: dueDate as any }).subscribe({
      next: (updatedTask) => {
        this.task.set({ ...task, dueDate: updatedTask.dueDate });
        this.taskService.triggerRefresh();
      },
      error: (err) => console.error('Failed to update due date', err)
    });
  }

  removeDueDate(): void {
    const task = this.task();
    this.taskService.updateTask(task.id, { dueDate: null as any }).subscribe({
      next: () => {
        this.task.set({ ...task, dueDate: undefined });
        this.taskService.triggerRefresh();
      },
      error: (err) => console.error('Failed to remove due date', err)
    });
  }

  reminderOptions = [
    { value: 15, label: '15 minutes before' },
    { value: 30, label: '30 minutes before' },
    { value: 60, label: '1 hour before' },
    { value: 120, label: '2 hours before' },
    { value: 1440, label: '1 day before' },
  ];

  formatReminder(minutes?: number): string {
    if (!minutes) return '';
    if (minutes >= 1440) return `${minutes / 1440}d before`;
    if (minutes >= 60) return `${minutes / 60}h before`;
    return `${minutes}m before`;
  }

  updateReminder(minutes: number | null): void {
    const task = this.task();
    this.task.set({ ...task, reminderMinutes: minutes as any });
    this.taskService.updateTask(task.id, { reminderMinutes: minutes } as any).subscribe({
      next: () => this.taskService.triggerRefresh(),
      error: (err) => console.error('Failed to update reminder', err)
    });
  }

  // Time estimates: minutes up to 8h, then days, weeks, month
  estimateOptions = [
    15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480,  // Up to 8 hours
    1440, 2880, 4320,  // 1 day, 2 days, 3 days
    10080, 20160, 30240,  // 1 week, 2 weeks, 3 weeks
    43200  // 1 month (30 days)
  ];

  formatEstimate(minutes?: number): string {
    if (minutes === undefined || minutes === null) return '';

    // Month (30 days)
    if (minutes >= 43200) {
      const months = Math.floor(minutes / 43200);
      return months === 1 ? '1 month' : `${months} months`;
    }
    // Weeks (7 days)
    if (minutes >= 10080) {
      const weeks = Math.floor(minutes / 10080);
      return weeks === 1 ? '1 week' : `${weeks} weeks`;
    }
    // Days (24 hours)
    if (minutes >= 1440) {
      const days = Math.floor(minutes / 1440);
      return days === 1 ? '1 day' : `${days} days`;
    }
    // Hours and minutes
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }

  updateEstimate(minutes: number): void {
    const task = this.task();
    this.taskService.updateTask(task.id, { timeEstimate: minutes }).subscribe({
      next: (updatedTask) => {
        this.task.set({ ...task, timeEstimate: updatedTask.timeEstimate });
        this.taskService.triggerRefresh();
      },
      error: (err) => console.error('Failed to update estimate', err)
    });
  }

  removeEstimate(): void {
    const task = this.task();
    this.taskService.updateTask(task.id, { timeEstimate: null as any }).subscribe({
      next: () => {
        this.task.set({ ...task, timeEstimate: undefined });
        this.taskService.triggerRefresh();
      },
      error: (err) => console.error('Failed to remove estimate', err)
    });
  }
}
