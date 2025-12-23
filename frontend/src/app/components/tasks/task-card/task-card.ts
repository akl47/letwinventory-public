import { Component, inject, input, signal, computed, OnInit } from '@angular/core';
import { Task } from '../../../models/task.model';
import { CommonModule } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { TaskCardDialog } from '../task-card-dialog/task-card-dialog';
import { ProjectService } from '../../../services/project.service';
import { Project } from '../../../models/project.model';

@Component({
  selector: 'app-task-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './task-card.html',
  styleUrl: './task-card.css',
})
export class TaskCard implements OnInit {
  task = input.required<Task>();

  private dialog = inject(MatDialog);
  private projectService = inject(ProjectService);

  projects = signal<Project[]>([]);
  projectColor = computed(() => {
    const project = this.projects().find(p => p.id === this.task().projectID);
    return project ? '#' + project.tagColorHex : null;
  });

  ngOnInit(): void {
    this.projectService.getProjects().subscribe(projects => {
      this.projects.set(projects);
    });
  }

  openDialog(): void {
    this.dialog.open(TaskCardDialog, {
      data: { task: this.task() },
      width: '768px',
      maxWidth: '95vw',
      panelClass: 'trello-dialog-container',
    });
  }
}
