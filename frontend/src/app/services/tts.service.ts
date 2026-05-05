import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Shared TTS player. Single Audio element across the app — playing a new key
 * stops the previous. Blob URLs are cached per key so subsequent plays skip
 * the network round-trip.
 */
@Injectable({ providedIn: 'root' })
export class TtsService {
    private http = inject(HttpClient);
    private currentAudio: HTMLAudioElement | null = null;
    private currentKeySig = signal<string | null>(null);
    /** During sequence playback, the per-field key currently sounding. Lets
     *  per-field buttons light up while the "all" parent stays in playing
     *  state too. */
    private currentSegmentSig = signal<string | null>(null);
    private loadingKeySig = signal<string | null>(null);
    private blobUrls = new Map<string, string>();
    private statusByReq = new Map<number, ReturnType<typeof signal<Record<string, boolean | null>>>>();
    private statusFetched = new Set<number>();
    private sequenceToken = 0;

    /** Fields used for "play all" sequential playback, in spoken order. */
    static readonly REQUIREMENT_FIELDS = ['description', 'rationale', 'parameter', 'verification', 'validation'];

    /** Currently playing key, or null. */
    playingKey = computed(() => this.currentKeySig());
    /** Currently fetching key (between click and audio.play()), or null. */
    loadingKey = computed(() => this.loadingKeySig());

    isPlaying(key: string): boolean {
        return this.currentKeySig() === key || this.currentSegmentSig() === key;
    }

    isLoading(key: string): boolean {
        return this.loadingKeySig() === key;
    }

    /** Click play on the same key while playing → stops. */
    async toggle(key: string, fetcher: () => Observable<Blob>): Promise<void> {
        if (this.isPlaying(key)) {
            this.stop();
            return;
        }
        // Stop whatever else is playing.
        this.stop();

        let url = this.blobUrls.get(key);
        if (!url) {
            this.loadingKeySig.set(key);
            try {
                const blob = await firstValueFrom(fetcher());
                url = URL.createObjectURL(blob);
                this.blobUrls.set(key, url);
            } catch (err) {
                this.loadingKeySig.set(null);
                throw err;
            }
            this.loadingKeySig.set(null);
        }

        const audio = new Audio(url);
        const cleanup = () => {
            if (this.currentAudio === audio) {
                this.currentAudio = null;
                this.currentKeySig.set(null);
            }
        };
        audio.addEventListener('ended', cleanup);
        audio.addEventListener('error', cleanup);
        this.currentAudio = audio;
        this.currentKeySig.set(key);
        try {
            await audio.play();
        } catch (err) {
            cleanup();
            throw err;
        }
    }

    stop() {
        // Bump the token so any in-flight sequence aborts after its current
        // segment cleanup.
        this.sequenceToken++;
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            this.currentAudio = null;
        }
        this.currentKeySig.set(null);
        this.currentSegmentSig.set(null);
        this.loadingKeySig.set(null);
    }

    /**
     * Trigger generation for every populated field that isn't yet cached.
     * Fetches in parallel — chatterbox queues server-side anyway, so this
     * fans out the network round-trips while the GPU processes them in
     * order. As each field's wav arrives, its blob URL is cached and its
     * per-field status flips to true.
     *
     * Returns when every queued field has resolved (success or failure). No
     * playback is triggered; the user clicks Play after generation completes.
     */
    async queueRequirementAll(reqId: number, fields: string[] = TtsService.REQUIREMENT_FIELDS): Promise<void> {
        const status = this.statusByReq.get(reqId)?.() ?? {};
        // Only queue fields that have text (status !== null) and aren't
        // already cached.
        const todo = fields.filter(f => status[f] !== null && status[f] !== true);
        if (todo.length === 0) return;

        const allKey = this.requirementFieldKey(reqId, 'all');
        this.loadingKeySig.set(allKey);
        try {
            // Serialize the fetches: chatterbox-tts has a known tensor-
            // batching bug that crashes 500s when multiple synthesis
            // requests overlap. Sequential is slightly slower but reliable.
            for (const field of todo) {
                const fieldKey = this.requirementFieldKey(reqId, field);
                if (this.blobUrls.has(fieldKey)) continue;
                try {
                    const blob = await firstValueFrom(this.fetchRequirementField(reqId, field));
                    this.blobUrls.set(fieldKey, URL.createObjectURL(blob));
                    this.markCached(reqId, field, true);
                } catch (err) {
                    console.warn(`TTS queue failed for ${field}:`, err);
                }
            }
        } finally {
            this.loadingKeySig.set(null);
        }
    }

    /**
     * Play every populated field for a requirement back-to-back. Uses the
     * "all" key while running so the frontend sees a single playing state and
     * the same toggle button can stop it.
     */
    async playRequirementAll(reqId: number, fields: string[] = TtsService.REQUIREMENT_FIELDS): Promise<void> {
        const allKey = this.requirementFieldKey(reqId, 'all');
        if (this.isPlaying(allKey)) {
            this.stop();
            return;
        }
        this.stop();
        const myToken = ++this.sequenceToken;
        this.currentKeySig.set(allKey);

        const status = this.statusByReq.get(reqId)?.() ?? {};

        for (const field of fields) {
            if (this.sequenceToken !== myToken) return;
            // Skip fields with no text (status null means empty).
            if (status[field] === null) continue;
            try {
                await this.playSegment(reqId, field, allKey, myToken);
            } catch {
                break;
            }
            if (this.sequenceToken !== myToken) return;
        }
        if (this.sequenceToken === myToken) {
            this.currentKeySig.set(null);
        }
    }

    private async playSegment(reqId: number, field: string, ownerKey: string, token: number): Promise<void> {
        const fieldKey = this.requirementFieldKey(reqId, field);
        let url = this.blobUrls.get(fieldKey);
        if (!url) {
            this.loadingKeySig.set(ownerKey);
            try {
                const blob = await firstValueFrom(this.fetchRequirementField(reqId, field));
                if (this.sequenceToken !== token) return; // stopped while fetching
                url = URL.createObjectURL(blob);
                this.blobUrls.set(fieldKey, url);
                this.markCached(reqId, field, true);
            } finally {
                this.loadingKeySig.set(null);
            }
        }
        // Light up the per-field icon as this segment plays.
        this.currentSegmentSig.set(fieldKey);
        try {
            await new Promise<void>((resolve, reject) => {
                const audio = new Audio(url!);
                const finish = () => {
                    audio.removeEventListener('ended', onEnded);
                    audio.removeEventListener('error', onError);
                    audio.removeEventListener('pause', onPause);
                    if (this.currentAudio === audio) this.currentAudio = null;
                };
                const onEnded = () => { finish(); resolve(); };
                const onError = () => { finish(); reject(new Error('audio error')); };
                const onPause = () => {
                    if (!audio.ended) { finish(); resolve(); }
                };
                audio.addEventListener('ended', onEnded);
                audio.addEventListener('error', onError);
                audio.addEventListener('pause', onPause);
                this.currentAudio = audio;
                audio.play().catch((err) => { finish(); reject(err); });
            });
        } finally {
            // Only clear if no other segment has taken over and we weren't
            // cancelled into a different state.
            if (this.currentSegmentSig() === fieldKey) {
                this.currentSegmentSig.set(null);
            }
        }
    }

    fetchRequirementField(reqId: number, field: string): Observable<Blob> {
        return this.http.get(`${environment.apiUrl}/tts/requirement/${reqId}/${field}`, {
            responseType: 'blob',
        });
    }

    /** Convenience: toggle playback for a requirement field. Marks the
     *  field cached on first successful fetch so the UI flips to the speaker
     *  icon. */
    toggleRequirementField(reqId: number, field: string): Promise<void> {
        const key = this.requirementFieldKey(reqId, field);
        return this.toggle(key, () => this.fetchRequirementField(reqId, field))
            .then(() => this.markCached(reqId, field, true));
    }

    requirementFieldKey(reqId: number, field: string): string {
        return `req-${reqId}-${field}`;
    }

    /** Returns a signal carrying the cache-status map for a requirement.
     *  Lazily fires the GET /tts/requirement/:id/status the first time. */
    getRequirementStatus(reqId: number) {
        let sig = this.statusByReq.get(reqId);
        if (!sig) {
            sig = signal<Record<string, boolean | null>>({});
            this.statusByReq.set(reqId, sig);
        }
        if (!this.statusFetched.has(reqId)) {
            this.statusFetched.add(reqId);
            this.http.get<Record<string, boolean | null>>(
                `${environment.apiUrl}/tts/requirement/${reqId}/status`,
            ).subscribe({
                next: (s) => sig!.set(s),
                error: () => { /* leave empty; treated as not-cached */ },
            });
        }
        return sig;
    }

    /** True if the named field's audio is known to be on the server already. */
    isCached(reqId: number, field: string): boolean {
        const sig = this.statusByReq.get(reqId);
        if (!sig) return false;
        return sig()[field] === true;
    }

    /** True if the named field has no text (server reports null). */
    hasNoText(reqId: number, field: string): boolean {
        const sig = this.statusByReq.get(reqId);
        if (!sig) return false;
        return sig()[field] === null;
    }

    /** Update the status for a single field — used after a successful fetch
     *  or to invalidate when the user edits the field. */
    markCached(reqId: number, field: string, cached: boolean) {
        const sig = this.statusByReq.get(reqId);
        if (!sig) return;
        sig.update(s => ({ ...s, [field]: cached }));
    }

    /** Clear cached blob URL for a (req, field) — call after the requirement
     *  is updated so the next play hits the network and pulls the fresh wav. */
    invalidate(reqId: number, field: string) {
        const key = this.requirementFieldKey(reqId, field);
        const url = this.blobUrls.get(key);
        if (url) {
            URL.revokeObjectURL(url);
            this.blobUrls.delete(key);
        }
        this.statusFetched.delete(reqId);
        const sig = this.statusByReq.get(reqId);
        if (sig) sig.update(s => ({ ...s, [field]: false }));
    }
}
