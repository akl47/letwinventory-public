import { Component, inject, signal, computed, viewChild, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CadModelService } from '../../../services/cad-model.service';
import { CadModel, CadVersionGraph, CadVersionNode, CadCommitDiff, CadDiffEntry, FaceStatus, CadCommitGeometry } from '../../../models/cad-model.model';
import { AuthService } from '../../../services/auth.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { CadMiniPreviewComponent } from '../cad-mini-preview/cad-mini-preview.component';
import { CadPreview3dComponent, PreviewCamera } from '../cad-preview-3d/cad-preview-3d.component';
import { formatDiffEntry } from '../../../cad/lib/diffFormat';

// The part's CAD version history — a git-style branch graph (Graph), a
// two-commit diff (Diff), and a dense commit log (Log). Wired to the real VCS
// endpoints; each commit renders a lightweight 3D preview. Dark theme.
@Component({
  selector: 'app-cad-revision-list',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule, CadMiniPreviewComponent, CadPreview3dComponent],
  template: `
    <div class="vh" data-testid="cad-tab">
      <header class="vh-head">
        <h2>CAD Version History</h2>
        <div class="spacer"></div>
        <div class="seg" *ngIf="model()">
          <button [class.on]="view()==='timeline'" (click)="view.set('timeline')" data-testid="view-timeline"><mat-icon>account_tree</mat-icon> Graph</button>
          <button [class.on]="view()==='compare'" (click)="view.set('compare')" data-testid="view-compare"><mat-icon>compare_arrows</mat-icon> Diff</button>
          <button [class.on]="view()==='table'" (click)="view.set('table')" data-testid="view-table"><mat-icon>table_rows</mat-icon> Log</button>
          <button [class.on]="view()==='branches'" (click)="view.set('branches')" data-testid="view-branches"><mat-icon>call_split</mat-icon> Branches</button>
        </div>
        <button class="vh-open" *ngIf="model()" (click)="openEditor()" data-testid="open-editor"
                title="Open the CAD model in the editor"><mat-icon>edit</mat-icon> Open model</button>
      </header>

      <div *ngIf="loading()" class="center"><mat-spinner diameter="32"></mat-spinner></div>

      <div *ngIf="!loading() && !model()" class="empty">
        <p>No CAD model for this part yet.</p>
        <button mat-raised-button color="primary" data-testid="cad-create-button" [disabled]="!canWrite() || creating()" (click)="onCreate()"><mat-icon>add</mat-icon> Create CAD</button>
      </div>

      <div *ngIf="!loading() && model() && !nodes().length" class="empty">
        <p>No commits yet — check out and check in from the editor to start the history.</p>
        <button mat-raised-button color="primary" (click)="openEditor()"><mat-icon>edit</mat-icon> Open editor</button>
      </div>

      <ng-container *ngIf="!loading() && model() && nodes().length">
        <!-- ════ Graph (branch timeline) ════ -->
        <div *ngIf="view()==='timeline'" class="row gap20 top">
          <div class="card rail">
            <div class="row ac jb"><b>Commits</b><span class="muted">{{ nodes().length }} nodes</span></div>
            <div class="legend">
              <span class="row ac gap6"><span class="dot main"></span><span class="mono">main</span></span>
              <span class="row ac gap6" *ngIf="hasExperiment()"><span class="dot exp"></span><span class="mono">branch</span></span>
            </div>
            <div class="graph">
              <svg class="graph-svg" [attr.width]="76" [attr.height]="layout().height">
                <path *ngFor="let e of layout().edges" [attr.d]="e.d" fill="none" [attr.stroke]="e.exp ? '#d39a55' : '#7a7a8c'" stroke-width="2.6"/>
                <circle *ngFor="let n of layout().nodes" [attr.cx]="n.x" [attr.cy]="n.y" [attr.r]="n.hash===selectedHash() ? 9.5 : 7" style="cursor:pointer"
                        [attr.fill]="nodeFill(n)" [attr.stroke]="n.lane==='exp' ? '#d39a55' : '#cfcfe0'" stroke-width="2.6" (click)="select(n.hash)"/>
              </svg>
              <div class="rows">
                <div *ngFor="let n of nodes()" class="vrow" (click)="select(n.hash)">
                  <div class="gutter"></div>
                  <div class="info" [class.sel]="n.hash===selectedHash()">
                    <div class="branch-line" *ngIf="branchNames(n.hash).length">
                      <span class="branch-chip" *ngFor="let bn of branchNames(n.hash)"><mat-icon class="bc-ico">call_split</mat-icon>{{ bn }}</span>
                    </div>
                    <div class="row ac jb gap6">
                      <span class="row ac gap6 nowrap">
                        <span class="mono">{{ n.shortHash }}</span>
                        <span class="mono head" *ngIf="n.isHead">● HEAD</span>
                        <span class="tag" *ngFor="let tg of n.tags">⬗ Rev {{ tg }}</span>
                      </span>
                      <span class="badge {{ n.state }}">{{ n.state }}</span>
                    </div>
                    <div class="msg">{{ n.message || '(no message)' }}</div>
                    <div class="muted by"><span class="av sm">{{ n.author?.initials || '?' }}</span> {{ n.author?.name }} · {{ n.timestamp | date:'mediumDate' }}</div>
                  </div>
                  <app-cad-mini-preview class="rowthumb" [modelId]="model()!.id" [hash]="n.hash" [w]="58" [h]="46"></app-cad-mini-preview>
                </div>
              </div>
            </div>
          </div>

          <div class="col gap12 grow" *ngIf="selectedNode() as v">
            <div class="card">
              <div class="row ac jb wrap gap8">
                <div class="grow0">
                  <div class="row ac gap8"><span class="mono">{{ v.shortHash }}</span><span class="badge {{ v.state }}">{{ v.state }}</span><span class="tag" *ngFor="let tg of v.tags">⬗ Rev {{ tg }}</span><span class="branch-chip" *ngFor="let bn of branchNames(v.hash)"><mat-icon class="bc-ico">call_split</mat-icon>{{ bn }}</span></div>
                  <div class="title19">{{ v.message || '(no message)' }}</div>
                </div>
                <div class="row gap6 noshrink">
                  <ng-container *ngIf="v.state==='released'; else draftActions">
                    <button mat-stroked-button (click)="openVersion(v)" matTooltip="Open this version in the CAD editor (read-only)"><mat-icon>visibility</mat-icon> Open version</button>
                    <button mat-stroked-button [disabled]="!canWrite()" (click)="branchFrom(v)" matTooltip="Create a new draft branch from this released version"><mat-icon>call_split</mat-icon> Branch</button>
                    <button mat-raised-button color="primary" (click)="exportStep()"><mat-icon>download</mat-icon> Download</button>
                  </ng-container>
                  <ng-template #draftActions>
                    <button mat-stroked-button [disabled]="!canWrite()" (click)="branchFrom(v)"><mat-icon>call_split</mat-icon> Branch</button>
                    <button mat-stroked-button [disabled]="!canWrite()" (click)="releaseModel()"><mat-icon>publish</mat-icon> Release</button>
                    <button mat-stroked-button (click)="openVersion(v)" matTooltip="Open this version in the CAD editor (read-only)"><mat-icon>visibility</mat-icon> Open version</button>
                    <button mat-raised-button color="primary" [disabled]="!canWrite()" (click)="openEditor()"><mat-icon>edit</mat-icon> Checkout</button>
                  </ng-template>
                </div>
              </div>
              <app-cad-preview-3d class="bigpreview" [modelId]="model()!.id" [hash]="v.hash" [defaultView]="model()?.defaultView ?? null" [w]="520" [h]="220"></app-cad-preview-3d>
              <div class="muted by"><span class="av sm">{{ v.author?.initials || '?' }}</span> {{ v.author?.name }} committed {{ v.timestamp | date:'medium' }} · on <span class="mono">{{ v.branch }}</span></div>
            </div>

            <div class="card">
              <div class="row ac jb"><b>Diff <span class="muted">vs previous</span></b><button mat-button (click)="compareFrom(v)"><mat-icon>compare_arrows</mat-icon> Diff…</button></div>
              <div *ngIf="!v.parents.length" class="muted">First commit — nothing to compare.</div>
              <div class="changes">
                <ng-container *ngFor="let e of changeEntries()">
                  <div class="chg {{ e.cls }}"><span class="m">{{ e.sign }}</span><span>{{ e.text }}</span></div>
                  <div class="chg sub {{ s.cls }}" *ngFor="let s of e.sublines"><span class="m">{{ s.sign }}</span><span>{{ s.text }}</span></div>
                </ng-container>
                <div *ngIf="v.parents.length && !changeEntries().length" class="muted">No feature changes.</div>
              </div>
              <hr/>
              <div class="row gap8 wrap">
                <button mat-stroked-button disabled matTooltip="Coming soon"><mat-icon>restore</mat-icon> Revert</button>
                <button mat-stroked-button disabled matTooltip="Coming soon"><mat-icon>comment</mat-icon> Comment</button>
              </div>
            </div>
          </div>
        </div>

        <!-- ════ Diff (compare two commits) ════ -->
        <div *ngIf="view()==='compare'" class="col gap12">
          <div class="row ac gap10 wrap">
            <label class="pick"><span class="muted upper">base</span>
              <select [ngModel]="cmpA()" (ngModelChange)="cmpA.set($event); runCmpDiff()"><option *ngFor="let n of nodes()" [ngValue]="n.hash">{{ n.shortHash }} — {{ n.message }}</option></select>
            </label>
            <span class="big">⇄</span>
            <label class="pick"><span class="muted upper">head</span>
              <select [ngModel]="cmpB()" (ngModelChange)="cmpB.set($event); runCmpDiff()"><option *ngFor="let n of nodes()" [ngValue]="n.hash">{{ n.shortHash }} — {{ n.message }}</option></select>
            </label>
            <div class="spacer"></div>
            <button mat-stroked-button (click)="toggleCmpLock()"
                    [matTooltip]="cmpLocked() ? 'Views locked together — click to unlock' : 'Views independent — click to lock together'">
              <mat-icon>{{ cmpLocked() ? 'link' : 'link_off' }}</mat-icon> {{ cmpLocked() ? 'Locked' : 'Unlocked' }}
            </button>
            <button mat-stroked-button (click)="swapCmp()"><mat-icon>swap_horiz</mat-icon> swap</button>
          </div>
          <div class="row gap12 top">
            <div class="card grow vp" *ngIf="cmpNodeA() as v">
              <div class="row ac jb"><span class="row ac gap6"><span class="mono">{{ v.shortHash }}</span><span class="badge {{ v.state }}">{{ v.state }}</span></span><span class="muted">{{ v.timestamp | date:'mediumDate' }}</span></div>
              <div class="muted xs">base · <span class="legdot rem"></span> removed faces</div>
              <app-cad-preview-3d #cmpPreviewA [modelId]="model()!.id" [hash]="v.hash" [defaultView]="model()?.defaultView ?? null" [faceStatus]="cmpStatusA()" (cameraMove)="onCmpCamera('a', $event)" [w]="320" [h]="230"></app-cad-preview-3d>
              <div class="muted">{{ v.message }}</div>
            </div>
            <div class="card grow vp" *ngIf="cmpNodeB() as v">
              <div class="row ac jb"><span class="row ac gap6"><span class="mono">{{ v.shortHash }}</span><span class="badge {{ v.state }}">{{ v.state }}</span></span><span class="muted">{{ v.timestamp | date:'mediumDate' }}</span></div>
              <div class="muted xs">head · <span class="legdot add"></span> new faces</div>
              <app-cad-preview-3d #cmpPreviewB [modelId]="model()!.id" [hash]="v.hash" [defaultView]="model()?.defaultView ?? null" [faceStatus]="cmpStatusB()" (cameraMove)="onCmpCamera('b', $event)" [w]="320" [h]="230"></app-cad-preview-3d>
              <div class="muted">{{ v.message }}</div>
            </div>
          </div>
          <div class="card">
            <b>Diff <span class="muted">{{ cmpNodeA()?.shortHash }} → {{ cmpNodeB()?.shortHash }}</span></b>
            <div class="changes">
              <ng-container *ngFor="let e of cmpEntries()">
                <div class="chg {{ e.cls }}"><span class="m">{{ e.sign }}</span><span>{{ e.text }}</span></div>
                <div class="chg sub {{ s.cls }}" *ngFor="let s of e.sublines"><span class="m">{{ s.sign }}</span><span>{{ s.text }}</span></div>
              </ng-container>
              <div *ngIf="!cmpEntries().length" class="muted">No feature changes between these commits.</div>
            </div>
          </div>
        </div>

        <!-- ════ Log (commit table) ════ -->
        <div *ngIf="view()==='table'" class="col gap12">
          <div class="card table">
            <div class="trow thead">
              <span class="c-pick"></span><span class="c-graph">graph</span><span class="c-thumb">3D</span><span class="c-hash">hash</span>
              <span class="grow">message</span><span class="c-auth">author</span><span class="c-when">when</span><span class="c-state">state</span>
            </div>
            <div class="trow" *ngFor="let n of nodes()" [class.picked]="picked().includes(n.hash)">
              <span class="c-pick"><input type="checkbox" [checked]="picked().includes(n.hash)" (change)="togglePick(n.hash)"/></span>
              <span class="c-graph">
                <svg width="44" height="32" style="overflow:visible">
                  <line [attr.x1]="n.lane==='exp'?30:12" y1="0" [attr.x2]="n.lane==='exp'?30:12" y2="32" [attr.stroke]="n.lane==='exp'?'#d39a55':'#7a7a8c'" stroke-width="2.2"/>
                  <path *ngIf="n.lane==='exp'" d="M12,32 C12,15 30,18 30,4" fill="none" stroke="#d39a55" stroke-width="2.2"/>
                  <circle [attr.cx]="n.lane==='exp'?30:12" cy="16" [attr.r]="n.isHead?6.5:5" [attr.fill]="nodeFill(n)" [attr.stroke]="n.lane==='exp'?'#d39a55':'#cfcfe0'" stroke-width="2.2"/>
                </svg>
              </span>
              <span class="c-thumb"><app-cad-mini-preview [modelId]="model()!.id" [hash]="n.hash" [w]="52" [h]="38"></app-cad-mini-preview></span>
              <span class="c-hash mono">{{ n.shortHash }}</span>
              <span class="grow row ac gap6 wrap">{{ n.message }}<span class="tag" *ngFor="let tg of n.tags">⬗ Rev {{ tg }}</span><span class="branch-chip" *ngFor="let bn of branchNames(n.hash)"><mat-icon class="bc-ico">call_split</mat-icon>{{ bn }}</span><span class="mono head" *ngIf="n.isHead">HEAD</span></span>
              <span class="c-auth row ac gap6"><span class="av sm">{{ n.author?.initials || '?' }}</span><span class="muted">{{ n.author?.name }}</span></span>
              <span class="c-when muted">{{ n.timestamp | date:'MMM d' }}</span>
              <span class="c-state"><span class="badge {{ n.state }}">{{ n.state }}</span></span>
            </div>
          </div>
          <div class="card cmpbar" [class.ready]="picked().length===2">
            <b>Diff</b>
            <span class="mono">{{ picked()[0] ? short(picked()[0]) : '— pick one —' }}</span><span>⇄</span><span class="mono">{{ picked()[1] ? short(picked()[1]) : '— pick two —' }}</span>
            <div class="spacer"></div>
            <button mat-button *ngIf="picked().length" (click)="picked.set([])">clear</button>
            <button mat-raised-button color="primary" [disabled]="picked().length!==2" (click)="openPickedDiff()"><mat-icon>compare_arrows</mat-icon> Open diff</button>
          </div>
        </div>

        <!-- ════ Branches (management) ════ -->
        <div *ngIf="view()==='branches'" class="col gap12">
          <div class="card">
            <div class="row ac jb">
              <b>Branches <span class="muted">{{ branchList().length }}</span></b>
              <button mat-stroked-button [disabled]="!canWrite()" (click)="createBranchFromHead()"><mat-icon>add</mat-icon> New branch</button>
            </div>
            <div class="branch-rows">
              <div class="brow" *ngFor="let b of branchList()" [class.cur]="b.name===currentBranch()">
                <span class="bdot" [class.exp]="b.name!=='main'"></span>
                <div class="binfo">
                  <div class="row ac gap6 nowrap">
                    <span class="bname">{{ b.name }}</span>
                    <span class="cur-tag" *ngIf="b.name===currentBranch()">current</span>
                  </div>
                  <div class="muted by"><span class="mono">{{ b.shortHash }}</span> {{ b.message || '(no message)' }} · {{ b.author || 'unknown' }}<ng-container *ngIf="b.timestamp"> · {{ b.timestamp | date:'mediumDate' }}</ng-container></div>
                </div>
                <div class="row gap6 noshrink">
                  <button mat-stroked-button [disabled]="b.name!==currentBranch() && !canWrite()"
                          [matTooltip]="b.name===currentBranch() ? 'Open this branch in the editor' : 'Switch to and open this branch (in its current lock state)'"
                          (click)="switchToBranch(b.name)"><mat-icon>login</mat-icon> Open</button>
                  <button mat-stroked-button *ngIf="b.name!=='main' && branchBehindMain(b.head)" [disabled]="!canWrite()"
                          matTooltip="Behind main — merge main's latest in and pick which branch changes to keep"
                          (click)="startMerge(b)"><mat-icon>merge</mat-icon> Merge</button>
                  <button mat-stroked-button *ngIf="b.name!=='main'" [disabled]="!canWrite() || b.name===currentBranch()"
                          [matTooltip]="b.name===currentBranch() ? 'Switch away before archiving' : 'Remove this branch label (commits stay in history)'"
                          (click)="archiveBranchByName(b.name)"><mat-icon>archive</mat-icon> Archive</button>
                </div>
              </div>
            </div>
            <div class="muted xs branch-note">Opening a branch switches the working copy to its head and checks it out for editing. Archiving removes the label only — its commits remain in history.</div>
          </div>

          <!-- ════ Merge reconciliation tool ════ -->
          <div class="card merge-panel" *ngIf="merging() as mb">
            <div class="row ac jb"><b>Merge main → "{{ mb }}"</b><button class="mp-close" (click)="cancelMerge()">×</button></div>
            <div class="muted xs">Every feature/sketch that differs between main and "{{ mb }}" is listed. Ticked items take "{{ mb }}"'s version; unticked keep main's. All changes are ticked by default.</div>
            <div class="row gap12 top">
              <div class="merge-list grow">
                <label class="merge-row" *ngFor="let e of mergeEntries()">
                  <input type="checkbox" [checked]="mergeSelected().has(e.key)" (change)="toggleMergeFeature(e.key)"/>
                  <span class="m {{ e.cls }}">{{ e.sign }}</span>
                  <span class="merge-name"><span class="merge-kind">{{ e.kind }}</span> {{ e.label }} <span class="merge-id">{{ e.id }}</span></span>
                  <span class="merge-status muted">{{ e.statusText }}</span>
                </label>
                <div *ngIf="!mergeEntries().length" class="muted">No differences — this branch already matches main.</div>
              </div>
              <div class="merge-preview">
                <div class="muted xs upper">Merge result</div>
                <app-cad-preview-3d *ngIf="mergePreviewGeo()" [modelId]="model()!.id" [geometry]="mergePreviewGeo()"
                    [geometryKey]="mergePreviewKey()" [defaultView]="model()?.defaultView ?? null" [w]="300" [h]="230"></app-cad-preview-3d>
                <div class="mp-prev-state muted xs" *ngIf="mergePreviewLoading()">Regenerating preview…</div>
                <div class="mp-prev-state muted xs" *ngIf="!mergePreviewLoading() && !mergePreviewGeo()">Preview unavailable</div>
                <div class="merge-errors" *ngIf="mergePreviewErrors().length">
                  <div class="me-head"><mat-icon>warning</mat-icon> {{ mergePreviewErrors().length }} feature{{ mergePreviewErrors().length === 1 ? '' : 's' }} couldn't apply</div>
                  <div class="me-row" *ngFor="let e of mergePreviewErrors()">{{ e }}</div>
                  <div class="me-hint muted xs">These features don't fit the chosen merge result (often an Up-To-Surface target that no longer exists). Adjust which changes you keep, or fix the feature on the branch.</div>
                </div>
              </div>
            </div>
            <div class="row gap8 ac" style="margin-top:10px">
              <button mat-raised-button color="primary" [disabled]="!canWrite()" (click)="applyMerge()">
                <mat-icon>merge</mat-icon> Merge {{ mergeSelected().size }} change{{ mergeSelected().size === 1 ? '' : 's' }} onto main
              </button>
              <button mat-button (click)="cancelMerge()">Cancel</button>
            </div>
          </div>
        </div>
      </ng-container>
    </div>
  `,
  styles: [`
    /* The app shell's content area is fixed-height + overflow:hidden, so this
       view must scroll itself or long diffs get clipped. */
    :host { display: block; height: 100%; overflow-y: auto; }
    .vh { padding: 20px; color: #ddd; }
    .vh-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .vh-head h2 { margin: 0; font-size: 20px; color: #eee; }
    .spacer, .grow { flex: 1; }
    .row { display: flex; } .col { display: flex; flex-direction: column; }
    .top { align-items: flex-start; }
    .ac { align-items: center; } .jb { justify-content: space-between; } .wrap { flex-wrap: wrap; } .nowrap { white-space: nowrap; }
    .gap6 { gap: 6px; } .gap8 { gap: 8px; } .gap10 { gap: 10px; } .gap12 { gap: 12px; } .gap20 { gap: 20px; }
    .grow0 { flex: 1 1 220px; min-width: 0; } .noshrink { flex: 0 0 auto; }
    .center { display: flex; justify-content: center; padding: 40px; }
    .empty { padding: 40px; text-align: center; color: #999; border: 1px dashed #4a4a5a; border-radius: 10px; }
    .empty button { margin-top: 12px; }
    .muted { color: #999; font-size: 13px; } .upper { text-transform: uppercase; letter-spacing: .06em; font-size: 11px; }
    .mono { font-family: ui-monospace, 'Roboto Mono', monospace; font-size: 13px; color: #cfcfe0; }
    .seg { display: inline-flex; border: 1px solid #3a3a4a; border-radius: 8px; overflow: hidden; }
    .seg button { border: none; background: #2a2a3a; padding: 6px 12px; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; color: #aaa; }
    .seg button mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .seg button.on { background: #1976d2; color: #fff; }
    .vh-open { display: inline-flex; align-items: center; gap: 5px; padding: 6px 14px; font-size: 13px; cursor: pointer;
               background: #1976d2; color: #fff; border: 1px solid #1976d2; border-radius: 8px; }
    .vh-open:hover { background: #1e88e5; }
    .vh-open mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .card { background: #2a2a3a; border: 1px solid #3a3a4a; border-radius: 10px; padding: 14px; }
    .rail { width: 392px; flex: 0 0 392px; }
    .legend { display: flex; gap: 14px; flex-wrap: wrap; margin: 8px 0 10px; font-size: 13px; }
    .dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
    .dot.main { border: 2px solid #cfcfe0; background: #2a2a3a; } .dot.exp { border: 2px solid #d39a55; background: #5a3a1a; }
    .graph { position: relative; }
    .graph-svg { position: absolute; left: 0; top: 0; overflow: visible; }
    .vrow { display: flex; align-items: center; height: 88px; cursor: pointer; }
    .gutter { width: 76px; flex: 0 0 76px; }
    .info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; padding: 0 8px; border-radius: 8px; }
    .info.sel { background: rgba(66,165,245,0.14); }
    .rowthumb { flex: 0 0 58px; margin-left: 4px; }
    .bigpreview { display: block; margin: 10px auto; }
    .msg { font-size: 15px; margin: 1px 0 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #e4e4ea; }
    .by { display: flex; align-items: center; gap: 6px; }
    .head { color: #64b5f6; }
    .title19 { font-size: 19px; margin-top: 2px; color: #eee; }
    .av { background: #1976d2; color: #fff; border-radius: 50%; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; }
    .av.sm { width: 18px; height: 18px; font-size: 9px; }
    .badge { padding: 1px 8px; border-radius: 4px; font-size: 12px; text-transform: uppercase; font-weight: 600; }
    .badge.draft { background: #fff3e0; color: #e65100; } .badge.review { background: #e3f2fd; color: #1565c0; } .badge.released { background: #e8f5e9; color: #2e7d32; }
    .tag { background: rgba(154,123,30,0.28); color: #d8bd6a; border-radius: 4px; padding: 1px 6px; font-size: 12px; font-family: ui-monospace, monospace; }
    .branch-line { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 2px; }
    .branch-chip { display: inline-flex; align-items: center; gap: 2px; background: rgba(66,165,245,0.22); color: #8fc6f5; border-radius: 4px; padding: 1px 6px 1px 3px; font-size: 12px; font-family: ui-monospace, monospace; }
    .branch-chip .bc-ico { font-size: 13px; width: 13px; height: 13px; }
    .changes { margin: 6px 0; }
    .chg { display: flex; gap: 8px; padding: 2px 0; font-size: 14px; }
    .chg.sub { padding-left: 22px; font-size: 12.5px; opacity: 0.92; }
    .chg .m { font-family: ui-monospace, monospace; width: 14px; font-weight: 700; }
    .chg.add, .chg.add .m { color: #66bb6a; } .chg.mod, .chg.mod .m { color: #64b5f6; }
    .chg.del .m { color: #ef5350; } .chg.del span:last-child { color: #ef5350; text-decoration: line-through; }
    hr { border: none; border-top: 1px solid #3a3a4a; margin: 10px 0; }
    .pick { display: flex; flex-direction: column; gap: 2px; min-width: 258px; }
    .pick select { padding: 6px 8px; border: 1px solid #444; border-radius: 6px; font-size: 14px; background: #1e1e2e; color: #ddd; }
    .big { font-size: 24px; }
    .vp app-cad-mini-preview, .vp app-cad-preview-3d { display: block; margin: 8px 0; }
    .xs { font-size: 11px; }
    .legdot { display: inline-block; width: 9px; height: 9px; border-radius: 2px; vertical-align: middle; margin: 0 2px; }
    .legdot.add { background: #66bb6a; }
    .legdot.rem { background: #ef5350; }
    .bigpreview { display: block; margin: 8px 0; }
    .table { padding: 0; overflow: hidden; }
    .trow { display: flex; align-items: center; padding: 8px 12px; border-bottom: 1px solid #34344a; font-size: 14px; }
    .trow.thead { font-size: 12px; color: #999; border-bottom: 2px solid #4a4a5a; }
    .trow.picked { background: rgba(66,165,245,0.14); }
    .c-pick { width: 30px; } .c-graph { width: 50px; } .c-thumb { width: 56px; } .c-hash { width: 56px; } .c-auth { width: 130px; } .c-when { width: 70px; } .c-state { width: 90px; }
    .cmpbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .cmpbar.ready { background: rgba(255,193,7,0.12); border-color: #6b5a1a; }
    /* Branch management tab */
    .branch-rows { margin-top: 10px; display: flex; flex-direction: column; }
    .brow { display: flex; align-items: center; gap: 10px; padding: 10px 6px; border-top: 1px solid #34344a; }
    .brow:first-child { border-top: none; }
    .brow.cur { background: rgba(66,165,245,0.10); border-radius: 6px; }
    .bdot { width: 11px; height: 11px; border-radius: 50%; flex: 0 0 11px; border: 2px solid #cfcfe0; background: #2a2a3a; }
    .bdot.exp { border-color: #d39a55; background: #5a3a1a; }
    .binfo { flex: 1; min-width: 0; }
    .bname { font-family: ui-monospace, monospace; font-size: 14px; color: #e4e4ea; }
    .cur-tag { background: rgba(66,165,245,0.22); color: #8fc6f5; border-radius: 4px; padding: 1px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .branch-note { margin-top: 12px; }
    .merge-panel { border: 1px solid #6b5a1a; }
    .mp-close { background: none; border: none; color: #ccc; font-size: 18px; cursor: pointer; line-height: 1; }
    .merge-list { margin: 10px 0; display: flex; flex-direction: column; gap: 2px; }
    .merge-row { display: flex; align-items: center; gap: 8px; padding: 4px 2px; cursor: pointer; border-radius: 4px; }
    .merge-row:hover { background: rgba(255,255,255,0.04); }
    .merge-row input { accent-color: #42a5f5; cursor: pointer; }
    .merge-row .m { font-family: ui-monospace, monospace; width: 12px; font-weight: 700; }
    .merge-row .m.add { color: #66bb6a; } .merge-row .m.mod { color: #64b5f6; } .merge-row .m.del { color: #ef5350; }
    .merge-name { flex: 1; font-size: 14px; color: #e4e4ea; }
    .merge-kind { display: inline-block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; color: #9aa3b8; background: rgba(255,255,255,0.06); border-radius: 3px; padding: 1px 5px; margin-right: 4px; vertical-align: middle; }
    .merge-id { font-family: ui-monospace, monospace; font-size: 11px; color: #8a8a9a; }
    .merge-errors { margin-top: 8px; padding: 8px 10px; background: rgba(239,83,80,0.10); border: 1px solid rgba(239,83,80,0.4); border-radius: 6px; }
    .merge-errors .me-head { display: flex; align-items: center; gap: 6px; color: #ef9a9a; font-size: 13px; font-weight: 600; }
    .merge-errors .me-head mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .merge-errors .me-row { font-size: 12px; color: #e4b9b9; margin-top: 3px; }
    .merge-errors .me-hint { margin-top: 5px; }
    .merge-status { font-size: 12px; }
    .merge-preview { flex: 0 0 300px; }
    .merge-preview app-cad-preview-3d { display: block; margin-top: 4px; }
    .mp-prev-state { margin-top: 6px; }
  `],
})
export class CadRevisionListComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cadApi = inject(CadModelService);
  private auth = inject(AuthService);
  private errors = inject(ErrorNotificationService);

  partID = signal<number>(0);
  model = signal<CadModel | null>(null);
  graph = signal<CadVersionGraph | null>(null);
  loading = signal<boolean>(true);
  creating = signal<boolean>(false);

  view = signal<'timeline' | 'compare' | 'table' | 'branches'>('timeline');
  selectedHash = signal<string | null>(null);
  selectedDiff = signal<CadCommitDiff | null>(null);
  cmpA = signal<string | null>(null);
  cmpB = signal<string | null>(null);
  cmpDiff = signal<CadCommitDiff | null>(null);
  // Per-face status maps for the Compare previews: A shows removed (red),
  // B shows added (green).
  cmpStatusA = signal<Record<string, FaceStatus> | null>(null);
  cmpStatusB = signal<Record<string, FaceStatus> | null>(null);
  // Lock the two Compare previews' rotation/pan/zoom together (default on).
  cmpLocked = signal(true);
  private cmpPreviewA = viewChild<CadPreview3dComponent>('cmpPreviewA');
  private cmpPreviewB = viewChild<CadPreview3dComponent>('cmpPreviewB');
  picked = signal<string[]>([]);
  // Merge reconciliation tool state.
  merging = signal<string | null>(null);
  mergeEntries = signal<{ key: string; kind: 'feature' | 'sketch'; id: string; label: string; status: string; sign: string; cls: string; statusText: string }[]>([]);
  mergeSelected = signal<Set<string>>(new Set());  // holds entry keys: "feature:<id>" / "sketch:<id>"
  mergePreviewGeo = signal<CadCommitGeometry | null>(null);
  mergePreviewKey = signal<string>('');
  mergePreviewLoading = signal<boolean>(false);
  mergePreviewErrors = signal<string[]>([]);  // features that couldn't apply against the chosen merge result
  private previewVersion = 0;
  private mergePreviewTimer: ReturnType<typeof setTimeout> | null = null;

  nodes = computed(() => this.graph()?.nodes ?? []);
  selectedNode = computed(() => this.nodes().find(n => n.hash === this.selectedHash()));
  cmpNodeA = computed(() => this.nodes().find(n => n.hash === this.cmpA()));
  cmpNodeB = computed(() => this.nodes().find(n => n.hash === this.cmpB()));
  hasExperiment = computed(() => this.nodes().some(n => n.lane === 'exp'));
  // Branch heads by commit hash — lets the graph label which branches point at
  // each commit (a new branch is invisible by lane alone until it diverges).
  branchesByHash = computed(() => {
    const m = new Map<string, string[]>();
    for (const b of this.graph()?.branches ?? []) {
      const arr = m.get(b.head); if (arr) arr.push(b.name); else m.set(b.head, [b.name]);
    }
    return m;
  });
  branchNames(hash: string): string[] { return this.branchesByHash().get(hash) ?? []; }
  currentBranch(): string { return this.model()?.branchName || 'main'; }
  // Branch list enriched with each head commit's message/author/time for the
  // management tab. `main` first, then alphabetical.
  branchList = computed(() => {
    const byHash = new Map(this.nodes().map(n => [n.hash, n]));
    return (this.graph()?.branches ?? []).map(b => {
      const n = byHash.get(b.head);
      return {
        name: b.name, head: b.head, shortHash: (b.head || '').slice(0, 4),
        message: n?.message || '', author: n?.author?.name || '', timestamp: n?.timestamp || '',
      };
    }).sort((a, b) => a.name === 'main' ? -1 : b.name === 'main' ? 1 : a.name.localeCompare(b.name));
  });
  canWrite = computed(() => this.auth.hasPermission('cad', 'write'));
  private mainHead = computed(() => (this.graph()?.branches ?? []).find(b => b.name === 'main')?.head ?? null);
  // A branch is behind main when main's head is NOT in the branch head's ancestry
  // (main advanced past where the branch diverged). Walks the node parent graph.
  branchBehindMain(head: string): boolean {
    const mh = this.mainHead();
    if (!mh || head === mh) return false;
    const byHash = new Map(this.nodes().map(n => [n.hash, n]));
    const seen = new Set<string>(); const queue = [head];
    while (queue.length) {
      const h = queue.shift()!; if (seen.has(h)) continue; seen.add(h);
      const n = byHash.get(h); if (n) for (const p of n.parents) queue.push(p);
    }
    return !seen.has(mh);
  }
  changeEntries = computed(() => (this.selectedDiff()?.entries ?? []).filter(e => e.status !== 'unchanged').map(formatDiffEntry));
  cmpEntries = computed(() => (this.cmpDiff()?.entries ?? []).filter(e => e.status !== 'unchanged').map(formatDiffEntry));

  layout = computed(() => {
    const ns = this.nodes();
    const H = 88, LX = { main: 22, exp: 52 };
    const pos = new Map<string, { x: number; y: number; lane: string }>();
    ns.forEach((n, i) => pos.set(n.hash, { x: LX[n.lane], y: i * H + 32, lane: n.lane }));
    const placed = ns.map((n, i) => ({ ...n, x: LX[n.lane], y: i * H + 32 }));
    const edges: { d: string; exp: boolean }[] = [];
    for (const n of ns) {
      const a = pos.get(n.hash)!;
      for (const pid of n.parents) {
        const b = pos.get(pid);
        if (!b) continue;
        const midY = (a.y + b.y) / 2;
        edges.push({ d: `M${a.x},${a.y} C ${a.x},${midY} ${b.x},${midY} ${b.x},${b.y}`, exp: n.lane === 'exp' || b.lane === 'exp' });
      }
    }
    return { nodes: placed, edges, height: Math.max(ns.length * H, 1) };
  });

  short(h: string): string { return (h || '').slice(0, 4); }

  nodeFill(n: CadVersionNode): string {
    if (n.state === 'released') return '#2e7d32';
    if (n.isHead) return '#64b5f6';
    return n.lane === 'exp' ? '#5a3a1a' : '#3a3a4a';
  }

  ngOnInit() {
    const pickId = (pm: { get(k: string): string | null }) => {
      const id = Number(pm.get('id'));
      if (id && id !== this.partID()) { this.partID.set(id); this.loadModel(); }
    };
    this.route.parent?.paramMap.subscribe(pickId);
    this.route.paramMap.subscribe(pickId);
  }

  loadModel() {
    if (!this.partID()) return;
    this.loading.set(true);
    this.cadApi.getActiveByPart(this.partID()).subscribe({
      next: m => { this.model.set(m); this.loadGraph(); },
      error: err => {
        this.model.set(null); this.loading.set(false);
        if (err?.status !== 404) this.errors.showError(err?.error?.error || 'Failed to load CAD model');
      },
    });
  }

  loadGraph() {
    const m = this.model(); if (!m) { this.loading.set(false); return; }
    this.cadApi.getGraph(m.id).subscribe({
      next: g => {
        this.graph.set(g);
        this.loading.set(false);
        this.select(g.head || g.nodes[0]?.hash || null);
        const newest = g.nodes[0];
        if (newest) { this.cmpB.set(newest.hash); this.cmpA.set(newest.parents[0] || g.nodes[1]?.hash || newest.hash); this.runCmpDiff(); }
      },
      error: err => { this.loading.set(false); this.errors.showError(err?.error?.error || 'Failed to load version graph'); },
    });
  }

  select(hash: string | null) {
    this.selectedHash.set(hash);
    this.selectedDiff.set(null);
    const n = this.selectedNode(); const m = this.model();
    if (!n || !m || !n.parents.length) return;
    this.cadApi.commitDiff(m.id, n.parents[0], n.hash).subscribe({ next: d => this.selectedDiff.set(d), error: () => {} });
  }

  runCmpDiff() {
    const m = this.model(); const a = this.cmpA(); const b = this.cmpB();
    if (!m || !a || !b) return;
    this.cadApi.commitDiff(m.id, a, b).subscribe({ next: d => this.cmpDiff.set(d), error: () => this.cmpDiff.set(null) });
    // Face-level diff → paint A's removed faces red, B's added faces green.
    this.cmpStatusA.set(null); this.cmpStatusB.set(null);
    this.cadApi.faceDiff(m.id, a, b).subscribe({
      next: d => {
        const namesA = new Set(d.namesA), namesB = new Set(d.namesB);
        const sa: Record<string, FaceStatus> = {};
        for (const n of d.namesA) sa[n] = namesB.has(n) ? 'unchanged' : 'removed';
        const sb: Record<string, FaceStatus> = {};
        for (const n of d.namesB) sb[n] = namesA.has(n) ? 'unchanged' : 'added';
        this.cmpStatusA.set(sa); this.cmpStatusB.set(sb);
      },
      error: () => { this.cmpStatusA.set(null); this.cmpStatusB.set(null); },
    });
  }
  swapCmp() { const a = this.cmpA(); this.cmpA.set(this.cmpB()); this.cmpB.set(a); this.runCmpDiff(); }

  // When locked, mirror one preview's camera onto the other.
  onCmpCamera(from: 'a' | 'b', cam: PreviewCamera) {
    if (!this.cmpLocked()) return;
    (from === 'a' ? this.cmpPreviewB() : this.cmpPreviewA())?.applyCamera(cam);
  }

  toggleCmpLock() {
    const locked = !this.cmpLocked();
    this.cmpLocked.set(locked);
    // On re-locking, snap the head preview to the base preview's current pose.
    if (locked) {
      const a = this.cmpPreviewA()?.getCamera();
      if (a) this.cmpPreviewB()?.applyCamera(a);
    }
  }
  compareFrom(v: CadVersionNode) { this.cmpB.set(v.hash); this.cmpA.set(v.parents[0] || v.hash); this.view.set('compare'); this.runCmpDiff(); }

  togglePick(hash: string) {
    const p = this.picked();
    if (p.includes(hash)) this.picked.set(p.filter(x => x !== hash));
    else this.picked.set(p.length < 2 ? [...p, hash] : [p[1], hash]);
  }
  openPickedDiff() { const p = this.picked(); if (p.length !== 2) return; this.cmpA.set(p[0]); this.cmpB.set(p[1]); this.view.set('compare'); this.runCmpDiff(); }

  openEditor() {
    const m = this.model(); if (!m) return;
    this.router.navigate(['/parts', this.partID(), 'cad', 'editor'], { queryParams: { revisionID: m.id, branch: m.branchName || 'main' } });
  }

  // Open a specific commit/version in the CAD editor, read-only (REQ 743).
  // Does not change the working copy or current branch.
  openVersion(v: CadVersionNode) {
    const m = this.model(); if (!m) return;
    this.router.navigate(['/parts', this.partID(), 'cad', 'editor'], { queryParams: { revisionID: m.id, commit: v.hash } });
  }

  // Release the current draft branch onto main (self-service; locks the part).
  releaseModel() {
    const m = this.model(); if (!m) return;
    this.cadApi.release(m.id).subscribe({
      next: (r: any) => { this.errors.showSuccess(`Released as Rev ${r.revision} on main`); this.loadModel(); },
      error: err => this.errors.showError(err?.error?.error || 'Release failed'),
    });
  }

  exportStep() {
    const m = this.model(); if (!m) return;
    this.cadApi.exportStep(m.id).subscribe({
      next: text => {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/step' }));
        const a = document.createElement('a'); a.href = url; a.download = `${m.part?.sku || 'model'}.step`; a.click();
        URL.revokeObjectURL(url);
      },
      error: err => this.errors.showError(err?.error?.error || 'STEP export failed'),
    });
  }

  branchFrom(v: CadVersionNode) {
    const m = this.model(); if (!m) return;
    const name = window.prompt('New branch name:', '');
    if (!name) return;
    this.cadApi.createBranch(m.id, name, v.hash).subscribe({
      next: () => this.openOnBranch(name),
      error: err => this.errors.showError(err?.error?.error || 'Create branch failed'),
    });
  }

  // Switch the working copy onto `name`, check it out, and open the editor on
  // that branch (same model id — only branchName changes).
  private openOnBranch(name: string) {
    const m = this.model(); if (!m) return;
    this.cadApi.switchBranch(m.id, name).subscribe({
      next: () => this.cadApi.checkout(m.id).subscribe({
        next: () => this.router.navigate(['/parts', this.partID(), 'cad', 'editor'], { queryParams: { revisionID: m.id, branch: name } }),
        error: err => this.errors.showError(err?.error?.error || 'Checkout failed'),
      }),
      error: err => this.errors.showError(err?.error?.error || 'Switch branch failed'),
    });
  }

  // Open a branch in whatever lock state it's in: switch the working copy onto
  // it if needed (no forced checkout), then open the editor.
  switchToBranch(name: string) {
    const m = this.model(); if (!m) return;
    if (name === this.currentBranch()) { this.openEditor(); return; }
    this.cadApi.switchBranch(m.id, name).subscribe({
      next: () => this.router.navigate(['/parts', this.partID(), 'cad', 'editor'], { queryParams: { revisionID: m.id, branch: name } }),
      error: err => this.errors.showError(err?.error?.error || 'Switch branch failed'),
    });
  }

  createBranchFromHead() {
    const m = this.model(); if (!m) return;
    const name = window.prompt('New branch name:', '');
    if (!name) return;
    this.cadApi.createBranch(m.id, name).subscribe({
      next: () => this.openOnBranch(name),
      error: err => this.errors.showError(err?.error?.error || 'Create branch failed'),
    });
  }

  archiveBranchByName(name: string) {
    const m = this.model(); if (!m) return;
    if (!window.confirm(`Archive branch "${name}"?\n\nThe branch label is removed; its commits remain in history.`)) return;
    this.cadApi.archiveBranch(m.id, name).subscribe({
      next: () => this.loadGraph(),
      error: err => this.errors.showError(err?.error?.error || 'Archive branch failed'),
    });
  }

  // Merge reconciliation tool: open the feature picker comparing main vs the
  // branch. Loads the diff without switching the working copy (apply switches).
  startMerge(b: { name: string; head: string }) {
    const m = this.model(); const mh = this.mainHead(); if (!m || !mh) return;
    this.cadApi.commitDiff(m.id, mh, b.head).subscribe({
      next: d => {
        const entries = (d.entries || [])
          .filter(e => (e.name.startsWith('feature:') || e.name.startsWith('sketch:')) && e.status !== 'unchanged')
          .map(e => {
            const kind: 'feature' | 'sketch' = e.name.startsWith('feature:') ? 'feature' : 'sketch';
            const id = e.name.slice((kind + ':').length);
            return {
              key: e.name, kind, id,
              label: e.displayName || ((kind === 'feature' ? 'Feature ' : 'Sketch ') + id),
              status: e.status,
              sign: e.status === 'added' ? '+' : e.status === 'removed' ? '−' : '~',
              cls: e.status === 'added' ? 'add' : e.status === 'removed' ? 'del' : 'mod',
              statusText: e.status === 'added' ? 'added on branch' : e.status === 'removed' ? 'removed on branch' : 'changed on branch',
            };
          });
        // Features first, then sketches; within each, by id for stability.
        entries.sort((a, b2) => (a.kind === b2.kind ? a.id.localeCompare(b2.id) : a.kind === 'feature' ? -1 : 1));
        this.mergeEntries.set(entries);
        // Default: take ALL of the branch's changes (a full merge); the user
        // unticks anything they'd rather keep from main.
        this.mergeSelected.set(new Set(entries.map(e => e.key)));
        this.merging.set(b.name);
        this.refreshMergePreview();
      },
      error: err => this.errors.showError(err?.error?.error || 'Failed to load the merge diff'),
    });
  }

  toggleMergeFeature(key: string) {
    const s = new Set(this.mergeSelected());
    if (s.has(key)) s.delete(key); else s.add(key);
    this.mergeSelected.set(s);
    this.refreshMergePreview();
  }

  /** Split the selected entry keys into feature ids + sketch ids for the API. */
  private selectedMerge(): { featureIds: string[]; sketchIds: string[] } {
    const featureIds: string[] = []; const sketchIds: string[] = [];
    for (const k of this.mergeSelected()) {
      if (k.startsWith('feature:')) featureIds.push(k.slice('feature:'.length));
      else if (k.startsWith('sketch:')) sketchIds.push(k.slice('sketch:'.length));
    }
    return { featureIds, sketchIds };
  }

  // Regenerate the 3D preview of the merge result (debounced — each toggle would
  // otherwise re-run the kernel).
  private refreshMergePreview() {
    const m = this.model(); const name = this.merging(); if (!m || !name) return;
    if (this.mergePreviewTimer) clearTimeout(this.mergePreviewTimer);
    this.mergePreviewLoading.set(true);
    this.mergePreviewTimer = setTimeout(() => {
      const { featureIds, sketchIds } = this.selectedMerge();
      this.cadApi.reconcilePreview(m.id, name, featureIds, sketchIds).subscribe({
        next: geo => { this.mergePreviewGeo.set(geo); this.mergePreviewErrors.set(geo.errors || []); this.mergePreviewKey.set(String(++this.previewVersion)); this.mergePreviewLoading.set(false); },
        error: () => { this.mergePreviewGeo.set(null); this.mergePreviewErrors.set([]); this.mergePreviewLoading.set(false); },
      });
    }, 450);
  }

  cancelMerge() {
    if (this.mergePreviewTimer) clearTimeout(this.mergePreviewTimer);
    this.merging.set(null); this.mergeEntries.set([]); this.mergeSelected.set(new Set());
    this.mergePreviewGeo.set(null); this.mergePreviewLoading.set(false); this.mergePreviewErrors.set([]);
  }

  // Switch onto the branch, then merge main into it with the selected features + sketches.
  applyMerge() {
    const m = this.model(); const name = this.merging(); if (!m || !name) return;
    const { featureIds, sketchIds } = this.selectedMerge();
    this.cadApi.switchBranch(m.id, name).subscribe({
      next: () => this.cadApi.reconcile(m.id, featureIds, sketchIds).subscribe({
        next: () => { this.errors.showSuccess(`Merged main into "${name}"`); this.cancelMerge(); this.loadModel(); },
        error: err => this.errors.showError(err?.error?.error || 'Merge failed'),
      }),
      error: err => this.errors.showError(err?.error?.error || 'Switch branch failed'),
    });
  }

  onCreate() {
    this.creating.set(true);
    this.cadApi.createForPart(this.partID()).subscribe({
      next: created => { this.creating.set(false); this.router.navigate(['editor'], { relativeTo: this.route, queryParams: { revisionID: created.id, branch: created.branchName || 'main' } }); },
      error: err => { this.creating.set(false); this.errors.showError(err?.error?.error || 'Failed to create CAD model'); },
    });
  }
}
