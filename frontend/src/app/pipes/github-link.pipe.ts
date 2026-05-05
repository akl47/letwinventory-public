import { Pipe, PipeTransform } from '@angular/core';

export interface GithubLinkInfo {
    type: 'pull' | 'commit';
    owner: string;
    repo: string;
    ref: string;
    label: string;
    url: string;
}

const RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(pull|commit)\/([^/?#]+)/i;

@Pipe({ name: 'githubLink', standalone: true })
export class GithubLinkPipe implements PipeTransform {
    transform(input: string | null | undefined): GithubLinkInfo | null {
        if (!input || typeof input !== 'string') return null;
        const m = input.match(RE);
        if (!m) return null;
        const [, owner, repo, kind, ref] = m;
        const type = kind.toLowerCase() === 'pull' ? 'pull' : 'commit';
        const label = type === 'pull'
            ? `${owner}/${repo}#${ref}`
            : `${owner}/${repo}@${ref.slice(0, 7)}`;
        return { type, owner, repo, ref, label, url: input };
    }
}
