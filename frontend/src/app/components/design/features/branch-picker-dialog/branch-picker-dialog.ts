import { Component, Inject, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';

import {
    DesignFeatureService, GithubBranch, GithubBranchPullRef,
} from '../../../../services/design-feature.service';
import { CategoryBadge } from '../../../common/category-badge/category-badge';

export interface BranchPickerInput {
    featureID: number;
}

export interface BranchPickerResult {
    branchName: string;
    repo: string;
    prURL?: string;
}

interface BranchWithRepo extends GithubBranch {
    repo: string;
    isDefault?: boolean;
}

@Component({
    selector: 'app-branch-picker-dialog',
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
        MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule,
        MatMenuModule, MatSelectModule, CategoryBadge,
    ],
    templateUrl: './branch-picker-dialog.html',
    styleUrl: './branch-picker-dialog.css',
})
export class BranchPickerDialog implements OnInit {
    private featureService = inject(DesignFeatureService);
    private dialogRef = inject(MatDialogRef<BranchPickerDialog, BranchPickerResult | null>);

    branches = signal<BranchWithRepo[]>([]);
    repos = signal<string[]>([]);
    loadErrors = signal<string[]>([]);
    loading = signal(false);
    error = signal<string | null>(null);
    searchText = signal('');
    selectedRepo = signal<string | null>(null);
    showDeleted = signal(false);

    deletedCount = computed(() => this.branches().filter(b => b.deleted).length);

    filteredBranches = computed(() => {
        const q = this.searchText().toLowerCase().trim();
        const repoFilter = this.selectedRepo();
        const includeDeleted = this.showDeleted();
        return this.branches().filter(b => {
            if (repoFilter && b.repo !== repoFilter) return false;
            if (!includeDeleted && b.deleted) return false;
            if (!q) return true;
            return b.name.toLowerCase().includes(q)
                || b.repo.toLowerCase().includes(q)
                || (b.subject || '').toLowerCase().includes(q);
        });
    });

    constructor(@Inject(MAT_DIALOG_DATA) public data: BranchPickerInput) {}

    ngOnInit() {
        this.load();
    }

    load() {
        this.loading.set(true);
        this.error.set(null);
        // No repo arg — backend uses configured GITHUB_REPOS env.
        this.featureService.listGithubBranches(this.data.featureID).subscribe({
            next: (resp: any) => {
                const branches = (resp.branches || []) as BranchWithRepo[];
                this.branches.set(branches);
                this.repos.set(resp.repos || []);
                this.loadErrors.set(resp.errors || []);
                this.loading.set(false);
                // If only one repo configured, prefilter to it.
                if ((resp.repos || []).length === 1) this.selectedRepo.set(resp.repos[0]);
            },
            error: (err) => {
                this.error.set(err?.error?.error || err?.message || 'Failed to load branches');
                this.loading.set(false);
                this.branches.set([]);
            },
        });
    }

    pickBranch(b: BranchWithRepo) {
        const openOrMerged = b.pulls.find(p => p.state === 'open')
            || b.pulls.find(p => p.state === 'merged')
            || b.pulls[0];
        const result: BranchPickerResult = { branchName: b.name, repo: b.repo };
        if (openOrMerged) result.prURL = openOrMerged.url;
        this.dialogRef.close(result);
    }

    pickBranchWithPR(b: BranchWithRepo, pr: GithubBranchPullRef) {
        this.dialogRef.close({ branchName: b.name, repo: b.repo, prURL: pr.url });
    }

    cancel() {
        this.dialogRef.close(null);
    }

    prVariant(state: string): 'neutral' | 'success' | 'warning' | 'info' | 'error' {
        switch (state) {
            case 'open': return 'success';
            case 'merged': return 'info';
            case 'closed': return 'error';
            default: return 'neutral';
        }
    }

    relativeTime(iso: string | null | undefined): string {
        if (!iso) return '';
        const then = new Date(iso).getTime();
        if (isNaN(then)) return '';
        const diff = Math.max(0, Date.now() - then) / 1000;
        if (diff < 60) return `${Math.round(diff)}s ago`;
        if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
        if (diff < 86400 * 30) return `${Math.round(diff / 86400)}d ago`;
        if (diff < 86400 * 365) return `${Math.round(diff / 86400 / 30)}mo ago`;
        return `${Math.round(diff / 86400 / 365)}y ago`;
    }
}
