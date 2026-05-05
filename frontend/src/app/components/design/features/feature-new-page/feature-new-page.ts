import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';

import { DesignFeatureService } from '../../../../services/design-feature.service';
import { ProjectService } from '../../../../services/project.service';
import { Project } from '../../../../models/project.model';

function slugify(name: string): string {
    return (name || '').trim().toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '');
}

@Component({
    selector: 'app-feature-new-page',
    standalone: true,
    imports: [CommonModule, FormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule],
    templateUrl: './feature-new-page.html',
    styleUrl: './feature-new-page.css',
})
export class FeatureNewPage implements OnInit {
    private featureService = inject(DesignFeatureService);
    private projectService = inject(ProjectService);
    private router = inject(Router);

    name = signal('');
    projectID = signal<number | null>(null);
    projects = signal<Project[]>([]);
    submitting = signal(false);
    error = signal<string | null>(null);

    canSubmit = computed(() => !!this.name().trim() && !!this.projectID() && !this.submitting());
    suggestedSlug = computed(() => slugify(this.name()));

    ngOnInit() {
        const svc: any = this.projectService as any;
        const obs = (svc.getAll && svc.getAll()) || (svc.getProjects && svc.getProjects()) || null;
        if (obs) obs.subscribe((p: Project[]) => this.projects.set(p));
    }

    async submit() {
        if (!this.canSubmit()) return;
        this.submitting.set(true);
        this.error.set(null);
        const slug = this.suggestedSlug();
        this.featureService.create({
            name: this.name().trim(),
            slug,
            projectID: this.projectID()!,
        }).subscribe({
            next: (created) => {
                this.router.navigate(['/features', created.id, 'edit']);
            },
            error: (err) => {
                this.error.set(err?.error?.error || err?.error?.message || 'Failed to create feature');
                this.submitting.set(false);
            },
        });
    }
}
