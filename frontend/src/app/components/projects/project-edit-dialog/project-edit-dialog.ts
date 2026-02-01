import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { ProjectService } from '../../../services/project.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { Project } from '../../../models/project.model';

export interface ProjectEditDialogData {
  project?: Project;
  existingShortcuts?: string[];
}

@Component({
  selector: 'app-project-edit-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule
  ],
  templateUrl: './project-edit-dialog.html',
  styleUrl: './project-edit-dialog.css',
})
export class ProjectEditDialog {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<ProjectEditDialog>);
  private projectService = inject(ProjectService);
  private errorNotification = inject(ErrorNotificationService);
  data = inject<ProjectEditDialogData>(MAT_DIALOG_DATA, { optional: true });

  isEditMode = false;
  allDigits = ['1', '2', '3', '4', '5', '6', '7', '8', '9']; // 0 is reserved for "no project"
  usedShortcuts = signal<string[]>([]);

  form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    shortName: ['', [Validators.required, Validators.maxLength(6)]],
    description: ['', Validators.maxLength(255)],
    tagColorHex: ['#6366f1', Validators.required],
    keyboardShortcut: [null as string | null]
  });

  // Compute available shortcuts (not used by other projects)
  availableShortcuts = computed(() => {
    const used = this.usedShortcuts();
    const currentShortcut = this.data?.project?.keyboardShortcut;
    return this.allDigits.filter(d => !used.includes(d) || d === currentShortcut);
  });

  constructor() {
    // Load existing shortcuts from other projects
    this.loadExistingShortcuts();

    if (this.data?.project) {
      this.isEditMode = true;
      // Add # prefix if not present (database stores without #)
      const colorHex = this.data.project.tagColorHex || '6366f1';
      const colorWithHash = colorHex.startsWith('#') ? colorHex : '#' + colorHex;
      this.form.patchValue({
        name: this.data.project.name,
        shortName: this.data.project.shortName,
        description: this.data.project.description || '',
        tagColorHex: colorWithHash,
        keyboardShortcut: this.data.project.keyboardShortcut || null
      });
    }
  }

  loadExistingShortcuts() {
    this.projectService.getProjects().subscribe({
      next: (projects) => {
        const shortcuts = projects
          .filter(p => p.keyboardShortcut && p.id !== this.data?.project?.id)
          .map(p => p.keyboardShortcut!);
        this.usedShortcuts.set(shortcuts);
      }
    });
  }

  onColorChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.form.patchValue({ tagColorHex: input.value });
  }

  getFormValidationErrors(): string[] {
    const errors: string[] = [];
    if (this.form.get('name')?.hasError('required')) {
      errors.push('Name is required');
    }
    if (this.form.get('name')?.hasError('maxlength')) {
      errors.push('Name must be 100 characters or less');
    }
    if (this.form.get('shortName')?.hasError('required')) {
      errors.push('Short name is required');
    }
    if (this.form.get('shortName')?.hasError('maxlength')) {
      errors.push('Short name must be 6 characters or less');
    }
    if (this.form.get('tagColorHex')?.hasError('required')) {
      errors.push('Tag color is required');
    }
    return errors;
  }

  save() {
    Object.keys(this.form.controls).forEach(key => {
      this.form.get(key)?.markAsTouched();
    });

    if (!this.form.valid) {
      const errors = this.getFormValidationErrors();
      const errorMessage = errors.length > 0
        ? 'Please fix the following errors: ' + errors.join(', ')
        : 'Please fill in all required fields correctly';
      this.errorNotification.showError(errorMessage);
      return;
    }

    // Strip # prefix from color (database stores without #)
    const colorHex = this.form.value.tagColorHex!;
    const colorWithoutHash = colorHex.startsWith('#') ? colorHex.substring(1) : colorHex;

    const projectData = {
      name: this.form.value.name!,
      shortName: this.form.value.shortName!,
      description: this.form.value.description || '',
      tagColorHex: colorWithoutHash,
      keyboardShortcut: this.form.value.keyboardShortcut || undefined
    };

    if (this.isEditMode && this.data?.project?.id) {
      this.projectService.updateProject(this.data.project.id, projectData).subscribe({
        next: () => {
          this.errorNotification.showSuccess('Project updated successfully');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.errorNotification.showHttpError(err, 'Failed to update project');
        }
      });
    } else {
      this.projectService.createProject(projectData).subscribe({
        next: () => {
          this.errorNotification.showSuccess('Project created successfully');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.errorNotification.showHttpError(err, 'Failed to create project');
        }
      });
    }
  }

  delete() {
    if (!this.isEditMode || !this.data?.project?.id) {
      return;
    }

    const confirmed = confirm(`Are you sure you want to delete project "${this.data.project.name}"?`);
    if (!confirmed) {
      return;
    }

    this.projectService.deleteProject(this.data.project.id).subscribe({
      next: () => {
        this.errorNotification.showSuccess('Project deleted successfully');
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.errorNotification.showHttpError(err, 'Failed to delete project');
      }
    });
  }
}
