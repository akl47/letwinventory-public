import { GithubLinkPipe } from './github-link.pipe';

describe('GithubLinkPipe', () => {
    let pipe: GithubLinkPipe;

    beforeEach(() => {
        pipe = new GithubLinkPipe();
    });

    it('parses a PR URL', () => {
        const result = pipe.transform('https://github.com/akl47/letwinventory/pull/42');
        expect(result).toEqual({
            type: 'pull',
            owner: 'akl47',
            repo: 'letwinventory',
            ref: '42',
            label: 'akl47/letwinventory#42',
            url: 'https://github.com/akl47/letwinventory/pull/42',
        });
    });

    it('parses a commit URL with full SHA', () => {
        const result = pipe.transform('https://github.com/akl47/letwinventory/commit/abc1234567890def1234567890abcdef12345678');
        expect(result).not.toBeNull();
        expect(result!.type).toBe('commit');
        expect(result!.owner).toBe('akl47');
        expect(result!.repo).toBe('letwinventory');
        expect(result!.ref).toBe('abc1234567890def1234567890abcdef12345678');
        // Label should use short SHA (first 7 chars).
        expect(result!.label).toContain('abc1234');
    });

    it('returns null for unparseable input', () => {
        expect(pipe.transform('https://example.com/foo/bar')).toBeNull();
        expect(pipe.transform('not a url at all')).toBeNull();
        expect(pipe.transform('')).toBeNull();
        expect(pipe.transform(null as any)).toBeNull();
        expect(pipe.transform(undefined as any)).toBeNull();
    });

    it('returns null for github.com URLs that do not match pull/commit patterns', () => {
        expect(pipe.transform('https://github.com/akl47/letwinventory')).toBeNull();
        expect(pipe.transform('https://github.com/akl47/letwinventory/issues/1')).toBeNull();
    });
});
