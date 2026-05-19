import { Injectable, signal } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// WebSocket client for the CAD streaming session. Matches the server-side
// protocol in `backend/services/cadStreamService.js`.
//
// The HTTP `POST /:id/regenerate` endpoint stays the canonical regenerate
// trigger and returns the merged geometry for fallback clients. This
// service is an OPTIMIZATION: when connected + subscribed, the editor
// receives per-feature `feature-result` events as the kernel completes
// each one, rendering progressively instead of waiting for the full HTTP
// response.
//
// Lifecycle:
//   stream.subscribeToModel(modelId)  // implicit connect + auth
//   stream.events$.subscribe(...)
//   stream.disconnect()               // on editor teardown
//
// Reconnect: exponential backoff up to 30s. Subscribed model is restored
// after auth on every reconnect.

// Derive the WS URL from environment.apiUrl so it tracks dev/prod/e2e
// without a separate config knob. apiUrl can be absolute
// (`https://dev.letwin.co/api`) or relative (`/api` for the e2e proxy);
// strip the trailing `/api` and swap http(s) for ws(s).
export function buildWsUrl(apiUrl: string): string {
  const trimmed = apiUrl.replace(/\/api\/?$/, '');
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^http/i, 'ws') + '/ws/cad';
  }
  // Relative apiUrl — use the current page's origin.
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${trimmed}/ws/cad`;
}

export type CadStreamEvent =
  | { type: 'regenerate-started'; modelId: number }
  | {
      type: 'feature-result';
      modelId: number;
      featureId: string;
      faces: Array<{ faceId: string; persistentName: string; isFlat: boolean; positions: number[]; normals: number[]; indices: number[] }>;
      topology: { vertices: Array<{ id: string; position: [number, number, number] }>; edges: Array<{ id: string; isStraight: boolean; endpoints: [[number, number, number], [number, number, number]] }> };
      cached: boolean;
      error?: string;
    }
  | { type: 'regenerate-complete'; modelId: number; errors: string[] }
  | { type: 'authenticated'; userId: number; displayName: string }
  | { type: 'auth-failed'; reason: string }
  | { type: 'subscribed'; modelId: number };

@Injectable({ providedIn: 'root' })
export class CadStreamService {
  private socket: WebSocket | null = null;
  private subject = new Subject<CadStreamEvent>();
  private currentModelId: number | null = null;
  private backoffMs = 1_000;
  private readonly MAX_BACKOFF_MS = 30_000;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private authResolved = false;

  /** Connection state for the editor to surface in the UI if it wants. */
  readonly connected = signal(false);
  /** Observable of all received events. Subscribe before calling `subscribeToModel`. */
  readonly events$: Observable<CadStreamEvent> = this.subject.asObservable();

  subscribeToModel(modelId: number): void {
    this.currentModelId = modelId;
    if (this.socket && this.socket.readyState === WebSocket.OPEN && this.authResolved) {
      this.send({ type: 'subscribe-model', modelId });
      return;
    }
    this.connect();
  }

  disconnect(): void {
    this.currentModelId = null;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.socket) { try { this.socket.close(1000, 'editor closed'); } catch { /* noop */ } }
    this.socket = null;
    this.authResolved = false;
    this.connected.set(false);
  }

  // ─── internals ────────────────────────────────────────────────────────

  private connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const token = localStorage.getItem('auth_token');
    if (!token) {
      console.warn('[cad-stream] no auth_token in localStorage — skipping WS connect');
      return;
    }
    const url = buildWsUrl(environment.apiUrl);
    console.log('[cad-stream] connecting to', url);
    this.authResolved = false;
    const sock = new WebSocket(url);
    this.socket = sock;

    sock.addEventListener('open', () => {
      console.log('[cad-stream] socket open, sending authenticate');
      this.connected.set(true);
      sock.send(JSON.stringify({ type: 'authenticate', token }));
    });

    sock.addEventListener('message', (ev) => {
      let msg: CadStreamEvent;
      try { msg = JSON.parse(ev.data); }
      catch { return; }
      if (msg.type === 'authenticated') {
        console.log('[cad-stream] authenticated as', msg.userId);
        this.authResolved = true;
        this.backoffMs = 1_000;  // reset on successful auth
        if (this.currentModelId !== null) {
          this.send({ type: 'subscribe-model', modelId: this.currentModelId });
        }
      } else if (msg.type === 'auth-failed') {
        console.warn('[cad-stream] auth-failed:', msg.reason);
      }
      this.subject.next(msg);
    });

    sock.addEventListener('close', (ev) => {
      console.warn(`[cad-stream] socket closed code=${ev.code} reason="${ev.reason}" wasClean=${ev.wasClean}`);
      this.connected.set(false);
      this.authResolved = false;
      this.socket = null;
      // Only reconnect if there's still an active subscription to restore;
      // otherwise the editor must have torn down.
      if (this.currentModelId !== null) {
        this.scheduleReconnect();
      }
    });

    sock.addEventListener('error', (ev) => {
      console.error('[cad-stream] socket error', ev);
    });

    if (!this.heartbeatTimer) {
      this.heartbeatTimer = window.setInterval(() => {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          this.send({ type: 'heartbeat' });
        }
      }, 30_000);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.MAX_BACKOFF_MS);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private send(payload: object): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }
}
