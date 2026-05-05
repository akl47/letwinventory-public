import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import {
    DesignFeature,
    DesignFeatureFilters,
    DesignFeatureHistoryEntry,
} from '../models/design-feature.model';

export interface GithubBranchPullRef {
    number: number;
    url: string;
    state: 'open' | 'closed' | 'merged' | string;
    title: string;
    isDraft: boolean;
}

export interface GithubBranch {
    name: string;
    sha: string;
    committedDate: string;
    subject: string;
    commitURL: string;
    author: string | null;
    pulls: GithubBranchPullRef[];
    repo?: string;
    isDefault?: boolean;
    deleted?: boolean;
}

export interface GithubBranchListResponse {
    branches: GithubBranch[];
    repos: string[];
    errors: string[];
}

export interface GithubBranchCommit {
    sha: string;
    url: string;
    subject: string;
    author: string | null;
    committedDate: string | null;
}

export interface GithubBranchCommitsResponse {
    branch: string;
    repo: string;
    commits: GithubBranchCommit[];
}

@Injectable({ providedIn: 'root' })
export class DesignFeatureService {
    private http = inject(HttpClient);
    private apiUrl = `${environment.apiUrl}/design/feature`;

    getAll(filters: DesignFeatureFilters = {}): Observable<DesignFeature[]> {
        let params = new HttpParams();
        if (filters.projectID != null) params = params.set('projectID', String(filters.projectID));
        if (filters.reviewState) params = params.set('reviewState', filters.reviewState);
        if (filters.ownerUserID != null) params = params.set('ownerUserID', String(filters.ownerUserID));
        return this.http.get<DesignFeature[]>(this.apiUrl, { params });
    }

    getById(id: number): Observable<DesignFeature> {
        return this.http.get<DesignFeature>(`${this.apiUrl}/${id}`);
    }

    create(data: Partial<DesignFeature>): Observable<DesignFeature> {
        return this.http.post<DesignFeature>(this.apiUrl, data);
    }

    update(id: number, data: Partial<DesignFeature>): Observable<DesignFeature> {
        return this.http.put<DesignFeature>(`${this.apiUrl}/${id}`, data);
    }

    softDelete(id: number): Observable<{ message: string }> {
        return this.http.delete<{ message: string }>(`${this.apiUrl}/${id}`);
    }

    submit(id: number): Observable<DesignFeature> {
        return this.http.post<DesignFeature>(`${this.apiUrl}/${id}/submit`, {});
    }

    approve(id: number): Observable<DesignFeature> {
        return this.http.post<DesignFeature>(`${this.apiUrl}/${id}/approve`, {});
    }

    reject(id: number, reason?: string): Observable<DesignFeature> {
        return this.http.post<DesignFeature>(`${this.apiUrl}/${id}/reject`, reason ? { reason } : {});
    }

    release(id: number): Observable<DesignFeature> {
        return this.http.post<DesignFeature>(`${this.apiUrl}/${id}/release`, {});
    }

    linkRequirement(featureID: number, requirementID: number): Observable<{ success: boolean }> {
        return this.http.post<{ success: boolean }>(
            `${this.apiUrl}/${featureID}/link-requirement`,
            { requirementID },
        );
    }

    unlinkRequirement(featureID: number, requirementID: number): Observable<{ success: boolean }> {
        return this.http.delete<{ success: boolean }>(
            `${this.apiUrl}/${featureID}/link-requirement/${requirementID}`,
        );
    }

    syncGithub(id: number): Observable<DesignFeature> {
        return this.http.post<DesignFeature>(`${this.apiUrl}/${id}/sync-github`, {});
    }

    listGithubBranches(id: number, repo?: string): Observable<GithubBranchListResponse> {
        let params = new HttpParams();
        if (repo) params = params.set('repo', repo);
        return this.http.get<GithubBranchListResponse>(`${this.apiUrl}/${id}/github/branches`, { params });
    }

    listGithubBranchCommits(id: number, branch: string, repo?: string): Observable<GithubBranchCommitsResponse> {
        let params = new HttpParams().set('branch', branch);
        if (repo) params = params.set('repo', repo);
        return this.http.get<GithubBranchCommitsResponse>(`${this.apiUrl}/${id}/github/branch-commits`, { params });
    }

    getHistory(id: number, opts: { limit?: number; offset?: number } = {}): Observable<DesignFeatureHistoryEntry[]> {
        let params = new HttpParams();
        if (opts.limit != null) params = params.set('limit', String(opts.limit));
        if (opts.offset != null) params = params.set('offset', String(opts.offset));
        return this.http.get<DesignFeatureHistoryEntry[]>(`${this.apiUrl}/${id}/history`, { params });
    }
}
