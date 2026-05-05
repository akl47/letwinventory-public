import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { forkJoin } from 'rxjs';

import { DesignFeatureService } from '../../../../services/design-feature.service';
import { DesignRequirementService } from '../../../../services/design-requirement.service';
import { ProjectService } from '../../../../services/project.service';
import { AuthService } from '../../../../services/auth.service';
import {
    DesignFeature, DesignFeatureHistoryEntry, ReviewState, CommitRef,
} from '../../../../models/design-feature.model';
import { DesignRequirement } from '../../../../models/design-requirement.model';
import { Project } from '../../../../models/project.model';
import { GithubLinkPipe } from '../../../../pipes/github-link.pipe';
import { CategoryBadge } from '../../../common/category-badge/category-badge';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import {
    BranchPickerDialog, BranchPickerInput, BranchPickerResult,
} from '../branch-picker-dialog/branch-picker-dialog';
import { GithubBranchCommit } from '../../../../services/design-feature.service';
import { TtsService } from '../../../../services/tts.service';
import { TtsPlayButton } from '../../../common/tts-play-button/tts-play-button';

@Component({
    selector: 'app-feature-edit-page',
    standalone: true,
    imports: [
        CommonModule, FormsModule, RouterModule,
        MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
        MatButtonModule, MatIconModule, MatExpansionModule, MatTableModule,
        MatTooltipModule, MatAutocompleteModule, MatProgressSpinnerModule,
        MatDialogModule,
        GithubLinkPipe, CategoryBadge, TtsPlayButton,
    ],
    templateUrl: './feature-edit-page.html',
    styleUrl: './feature-edit-page.css',
})
export class FeatureEditPage implements OnInit {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private location = inject(Location);
    private featureService = inject(DesignFeatureService);
    private requirementService = inject(DesignRequirementService);
    private projectService = inject(ProjectService);
    private authService = inject(AuthService);
    private dialog = inject(MatDialog);
    private ttsService = inject(TtsService);

    playFieldTts(reqId: number, field: string) {
        this.ttsService.toggleRequirementField(reqId, field).catch(err => {
            this.error.set(err?.error?.error || err?.message || 'TTS failed');
        });
    }
    isFieldPlaying(reqId: number, field: string): boolean {
        return this.ttsService.isPlaying(this.ttsService.requirementFieldKey(reqId, field));
    }
    isFieldLoadingTts(reqId: number, field: string): boolean {
        return this.ttsService.isLoading(this.ttsService.requirementFieldKey(reqId, field));
    }

    feature = signal<DesignFeature | null>(null);
    history = signal<DesignFeatureHistoryEntry[]>([]);
    projects = signal<Project[]>([]);
    allRequirements = signal<DesignRequirement[]>([]);
    loading = signal(true);
    error = signal<string | null>(null);
    saving = signal(false);

    isFormEditMode = signal(false);

    // Editable form fields (synced from loaded feature; flushed back on save).
    name = signal('');
    description = signal('');
    markdownBody = signal('');
    branchName = signal('');
    prURL = signal('');
    githubRepo = signal('');
    commitRefs = signal<CommitRef[]>([]);
    projectID = signal<number | null>(null);
    reviewerUserID = signal<number | null>(null);

    requirementSearchText = signal('');

    filteredRequirements = computed(() => {
        const f = this.feature();
        if (!f) return [];
        const search = this.requirementSearchText().toLowerCase();
        return this.allRequirements()
            .filter(r => r.activeFlag && (!r.designFeatureID || r.designFeatureID === f.id))
            .filter(r => r.projectID === f.projectID)
            .filter(r => !search || `#${r.id}`.includes(search) || (r.description || '').toLowerCase().includes(search))
            .slice(0, 20);
    });

    linkedRequirements = computed(() => {
        const f = this.feature();
        if (!f) return [];
        return this.allRequirements().filter(r => r.activeFlag && r.designFeatureID === f.id);
    });

    /**
     * Same set as linkedRequirements, but flattened in tree order with a
     * `depth` per node so the template can indent. A child whose parent isn't
     * also linked to this feature appears at depth 0 (orphan in this context).
     */
    linkedRequirementsTree = computed<{ req: DesignRequirement; depth: number }[]>(() => {
        const linked = this.linkedRequirements();
        const linkedIds = new Set(linked.map(r => r.id));
        const childrenByParent = new Map<number, DesignRequirement[]>();
        const roots: DesignRequirement[] = [];

        for (const r of linked) {
            const parentLinked = !!(r.parentRequirementID && linkedIds.has(r.parentRequirementID));
            if (parentLinked) {
                const arr = childrenByParent.get(r.parentRequirementID!) || [];
                arr.push(r);
                childrenByParent.set(r.parentRequirementID!, arr);
            } else {
                roots.push(r);
            }
        }
        const byId = (a: DesignRequirement, b: DesignRequirement) => a.id - b.id;
        roots.sort(byId);
        for (const arr of childrenByParent.values()) arr.sort(byId);

        const out: { req: DesignRequirement; depth: number }[] = [];
        const walk = (node: DesignRequirement, depth: number) => {
            out.push({ req: node, depth });
            const kids = childrenByParent.get(node.id) || [];
            for (const c of kids) walk(c, depth + 1);
        };
        for (const r of roots) walk(r, 0);
        return out;
    });

    canWrite = computed(() => this.authService.hasPermission('features', 'write'));
    canApprove = computed(() => this.authService.hasPermission('features', 'approve'));
    canApproveReqs = computed(() => this.authService.hasPermission('requirements', 'approve'));
    canWriteReqs = computed(() => this.authService.hasPermission('requirements', 'write'));
    isReleased = computed(() => this.feature()?.reviewState === 'released');
    isEditableState = computed(() => !this.isReleased());

    expandedReqs = signal<Set<number>>(new Set());

    toggleReqExpansion(reqID: number) {
        this.expandedReqs.update(set => {
            const next = new Set(set);
            if (next.has(reqID)) next.delete(reqID);
            else next.add(reqID);
            return next;
        });
    }

    isReqExpanded(reqID: number): boolean {
        return this.expandedReqs().has(reqID);
    }

    showHistory = signal(false);

    ngOnInit() {
        const idParam = this.route.snapshot.params['id'];
        if (!idParam) {
            this.router.navigate(['/features']);
            return;
        }
        const id = +idParam;
        forkJoin({
            feature: this.featureService.getById(id),
            requirements: this.requirementService.getAll(),
        }).subscribe({
            next: ({ feature, requirements }) => {
                this.feature.set(feature);
                this.allRequirements.set(requirements);
                this.syncFromFeature(feature);
                this.loading.set(false);
                this.featureService.getHistory(id).subscribe(h => this.history.set(h));
            },
            error: (err) => {
                this.error.set(err?.error?.error || 'Failed to load feature');
                this.loading.set(false);
            },
        });
        const svc: any = this.projectService as any;
        const obs = (svc.getAll && svc.getAll()) || (svc.getProjects && svc.getProjects()) || null;
        if (obs) obs.subscribe((p: Project[]) => this.projects.set(p));
    }

    private syncFromFeature(f: DesignFeature) {
        this.name.set(f.name);
        this.description.set(f.description || '');
        this.markdownBody.set(f.markdownBody || '');
        this.branchName.set(f.branchName || '');
        this.prURL.set(f.prURL || '');
        this.githubRepo.set((f as any).githubRepo || '');
        this.commitRefs.set([...(f.commitRefs || [])]);
        this.projectID.set(f.projectID);
        this.reviewerUserID.set(f.reviewerUserID || null);
    }

    back() {
        this.location.back();
    }

    enableEdit() {
        if (!this.canWrite() || this.isReleased()) return;
        this.isFormEditMode.set(true);
    }

    cancelEdit() {
        const f = this.feature();
        if (f) this.syncFromFeature(f);
        this.isFormEditMode.set(false);
    }

    save() {
        const f = this.feature();
        if (!f || this.isReleased()) return;
        this.saving.set(true);
        this.featureService.update(f.id, {
            name: this.name().trim(),
            description: this.description(),
            markdownBody: this.markdownBody(),
            branchName: this.branchName() || null,
            prURL: this.prURL() || null,
            githubRepo: this.githubRepo() || null,
            commitRefs: this.commitRefs(),
            projectID: this.projectID()!,
            reviewerUserID: this.reviewerUserID(),
        } as any).subscribe({
            next: (updated) => {
                this.feature.set({ ...f, ...updated });
                this.saving.set(false);
                this.isFormEditMode.set(false);
                this.refreshHistory();
            },
            error: (err) => {
                this.error.set(err?.error?.error || 'Save failed');
                this.saving.set(false);
            },
        });
    }

    addCommitRow() {
        this.commitRefs.update(rows => [...rows, { sha: '', url: '', subject: '' }]);
    }

    updateCommit(idx: number, key: keyof CommitRef, value: string) {
        this.commitRefs.update(rows => rows.map((r, i) => i === idx ? { ...r, [key]: value } : r));
    }

    removeCommit(idx: number) {
        this.commitRefs.update(rows => rows.filter((_, i) => i !== idx));
    }

    transition(action: 'submit' | 'approve' | 'reject' | 'release') {
        const f = this.feature();
        if (!f) return;
        const obs = action === 'submit' ? this.featureService.submit(f.id)
                  : action === 'approve' ? this.featureService.approve(f.id)
                  : action === 'reject' ? this.featureService.reject(f.id)
                  : this.featureService.release(f.id);
        obs.subscribe({
            next: (updated) => {
                this.feature.set({ ...f, ...updated });
                this.refreshHistory();
            },
            error: (err) => this.error.set(err?.error?.error || `${action} failed`),
        });
    }

    selectRequirementForLink(event: MatAutocompleteSelectedEvent) {
        const req: DesignRequirement = event.option.value;
        const f = this.feature();
        if (!f || !req) return;
        this.featureService.linkRequirement(f.id, req.id).subscribe({
            next: () => {
                this.allRequirements.update(list => list.map(r =>
                    r.id === req.id ? { ...r, designFeatureID: f.id } : r
                ));
                this.requirementSearchText.set('');
                this.refreshHistory();
            },
            error: (err) => this.error.set(err?.error?.error || 'Link failed'),
        });
    }

    unlinkRequirement(reqID: number) {
        const f = this.feature();
        if (!f) return;
        this.featureService.unlinkRequirement(f.id, reqID).subscribe({
            next: () => {
                this.allRequirements.update(list => list.map(r =>
                    r.id === reqID ? { ...r, designFeatureID: null } : r
                ));
                this.refreshHistory();
            },
            error: (err) => this.error.set(err?.error?.error || 'Unlink failed'),
        });
    }

    approveRequirement(reqID: number) {
        this.requirementService.approve(reqID).subscribe({
            next: (updated) => {
                this.allRequirements.update(list => list.map(r =>
                    r.id === reqID ? { ...r, ...updated } : r
                ));
            },
            error: (err) => this.error.set(err?.error?.error || 'Approve failed'),
        });
    }

    submitRequirement(reqID: number) {
        this.requirementService.submit(reqID).subscribe({
            next: (updated) => {
                this.allRequirements.update(list => list.map(r =>
                    r.id === reqID ? { ...r, ...updated } : r
                ));
            },
            error: (err) => this.error.set(err?.error?.error || 'Submit failed'),
        });
    }

    pendingApprovalCount = computed(() =>
        this.linkedRequirements().filter(r => r.approvalStatus !== 'approved').length
    );

    bulkApproving = signal(false);
    syncingGithub = signal(false);

    // Branch-commits read-only display (separate from PR commits stored in commitRefs).
    branchCommits = signal<GithubBranchCommit[]>([]);
    branchCommitsLoading = signal(false);
    branchCommitsError = signal<string | null>(null);
    showBranchCommits = signal(false);

    /** Effective repo: stored githubRepo, or derived from prURL. */
    effectiveRepo = computed(() => {
        const r = this.githubRepo();
        if (r) return r;
        const url = this.feature()?.prURL;
        if (!url) return null;
        const m = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/(?:pull|commit)\//i);
        return m ? `${m[1]}/${m[2]}` : null;
    });

    openBranchPicker() {
        const f = this.feature();
        if (!f) return;
        const ref = this.dialog.open<BranchPickerDialog, BranchPickerInput, BranchPickerResult | null>(
            BranchPickerDialog,
            {
                data: { featureID: f.id },
                panelClass: 'branch-picker-panel',
                width: '960px',
                maxWidth: '95vw',
            },
        );
        ref.afterClosed().subscribe((result) => {
            if (!result) return;
            this.branchName.set(result.branchName);
            this.githubRepo.set(result.repo);
            this.prURL.set(result.prURL || '');
            // Auto-save so the user doesn't have to step through edit mode just for picking.
            this.save();
        });
    }

    toggleBranchCommits() {
        const next = !this.showBranchCommits();
        this.showBranchCommits.set(next);
        if (next && this.branchCommits().length === 0) {
            this.loadBranchCommits();
        }
    }

    loadBranchCommits() {
        const f = this.feature();
        const branch = this.branchName();
        if (!f || !branch) return;
        this.branchCommitsLoading.set(true);
        this.branchCommitsError.set(null);
        this.featureService.listGithubBranchCommits(f.id, branch, this.effectiveRepo() || undefined).subscribe({
            next: (resp) => {
                this.branchCommits.set(resp.commits);
                this.branchCommitsLoading.set(false);
            },
            error: (err) => {
                this.branchCommitsError.set(err?.error?.error || err?.message || 'Failed to load branch commits');
                this.branchCommitsLoading.set(false);
                this.branchCommits.set([]);
            },
        });
    }

    syncGithub() {
        const f = this.feature();
        if (!f) return;
        if (this.syncingGithub()) return;
        this.syncingGithub.set(true);
        this.error.set(null);
        this.featureService.syncGithub(f.id).subscribe({
            next: (updated) => {
                this.feature.set({ ...f, ...updated });
                this.syncFromFeature(this.feature()!);
                this.syncingGithub.set(false);
                this.refreshHistory();
            },
            error: (err) => {
                const msg = err?.error?.error || err?.message || 'Sync failed';
                this.error.set(msg);
                this.syncingGithub.set(false);
            },
        });
    }

    prStateVariant(state: string | null | undefined): 'neutral' | 'success' | 'warning' | 'info' | 'error' {
        switch (state) {
            case 'merged': return 'info';
            case 'open': return 'success';
            case 'closed': return 'error';
            default: return 'neutral';
        }
    }

    async approveAllRequirements() {
        if (this.bulkApproving()) return;
        const pending = this.linkedRequirements().filter(r => r.approvalStatus !== 'approved');
        if (pending.length === 0) return;
        this.bulkApproving.set(true);
        const errors: string[] = [];
        for (const r of pending) {
            try {
                if (r.approvalStatus === 'draft') {
                    if (!this.canWriteReqs()) {
                        errors.push(`#${r.id}: missing requirements.write to submit draft`);
                        continue;
                    }
                    const submitted = await new Promise<any>((resolve, reject) =>
                        this.requirementService.submit(r.id).subscribe({ next: resolve, error: reject })
                    );
                    this.allRequirements.update(list => list.map(x => x.id === r.id ? { ...x, ...submitted } : x));
                }
                if (!this.canApproveReqs()) {
                    errors.push(`#${r.id}: missing requirements.approve`);
                    continue;
                }
                const approved = await new Promise<any>((resolve, reject) =>
                    this.requirementService.approve(r.id).subscribe({ next: resolve, error: reject })
                );
                this.allRequirements.update(list => list.map(x => x.id === r.id ? { ...x, ...approved } : x));
            } catch (err: any) {
                errors.push(`#${r.id}: ${err?.error?.error || err?.message || 'failed'}`);
            }
        }
        this.bulkApproving.set(false);
        if (errors.length > 0) {
            this.error.set(`Approved ${pending.length - errors.length}/${pending.length}. Errors: ${errors.join('; ')}`);
        }
    }

    private refreshHistory() {
        const f = this.feature();
        if (!f) return;
        this.featureService.getHistory(f.id).subscribe(h => this.history.set(h));
    }

    displayRequirement(r: DesignRequirement | null): string {
        return r ? `#${r.id} ${r.description?.slice(0, 80) || ''}` : '';
    }

    projectName(id: number | null | undefined): string {
        const p = this.projects().find(p => p.id === id);
        return p?.name || '—';
    }

    stateVariant(state: string | null | undefined): 'neutral' | 'success' | 'warning' | 'info' | 'error' {
        switch (state) {
            case 'approved': return 'success';
            case 'released': return 'info';
            case 'draft': return 'neutral';
            case 'in_review':
            case 'unapproved': return 'warning';
            default: return 'neutral';
        }
    }

    canSubmit(): boolean {
        return this.canWrite() && this.feature()?.reviewState === 'draft';
    }
    canApproveBtn(): boolean {
        return this.feature()?.reviewState === 'in_review';
    }
    canReject(): boolean {
        return this.canWrite() && this.feature()?.reviewState === 'in_review';
    }
    canReleaseBtn(): boolean {
        return this.feature()?.reviewState === 'approved';
    }
}
