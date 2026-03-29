import { Injectable, signal } from '@angular/core';
import { HarnessData } from '../models/harness.model';

interface HistoryStack {
  past: HarnessData[];
  future: HarnessData[];
  transactionSnapshot: HarnessData | null;
}

@Injectable({ providedIn: 'root' })
export class HarnessHistoryService {
  private stacks = new Map<string, HistoryStack>();
  private activeKey = 'new';
  private maxSize = 50;

  canUndo = signal(false);
  canRedo = signal(false);

  /**
   * Switch to a harness's history stack (creates if needed)
   * Pass null for a new unsaved harness
   */
  setActiveHarness(id: number | null): void {
    this.activeKey = id === null ? 'new' : String(id);
    if (!this.stacks.has(this.activeKey)) {
      this.stacks.set(this.activeKey, { past: [], future: [], transactionSnapshot: null });
    }
    this.updateSignals();
  }

  /**
   * Move the 'new' stack to a numeric ID after first save
   */
  promoteNewToId(id: number): void {
    const newStack = this.stacks.get('new');
    if (newStack) {
      this.stacks.delete('new');
      this.stacks.set(String(id), newStack);
      this.activeKey = String(id);
    }
  }

  /**
   * Push state before a change (for instant operations like delete, rotate, etc.)
   */
  push(state: HarnessData): void {
    const stack = this.getActiveStack();
    stack.past.push(structuredClone(state));
    if (stack.past.length > this.maxSize) stack.past.shift();
    stack.future = []; // Clear redo stack on new change
    this.updateSignals();
  }

  /**
   * For drag operations - snapshot at start of drag
   */
  beginTransaction(state: HarnessData): void {
    this.getActiveStack().transactionSnapshot = structuredClone(state);
  }

  /**
   * Commit transaction if state actually changed
   */
  commitTransaction(newState: HarnessData): void {
    const stack = this.getActiveStack();
    if (stack.transactionSnapshot &&
        JSON.stringify(stack.transactionSnapshot) !== JSON.stringify(newState)) {
      stack.past.push(stack.transactionSnapshot);
      if (stack.past.length > this.maxSize) stack.past.shift();
      stack.future = [];
      this.updateSignals();
    }
    stack.transactionSnapshot = null;
  }

  /**
   * Cancel transaction without committing
   */
  cancelTransaction(): void {
    this.getActiveStack().transactionSnapshot = null;
  }

  /**
   * Undo: pop from past, push current to future, return previous state
   */
  undo(currentState: HarnessData): HarnessData | null {
    const stack = this.getActiveStack();
    if (stack.past.length === 0) return null;
    stack.future.push(structuredClone(currentState));
    const previous = stack.past.pop()!;
    this.updateSignals();
    return previous;
  }

  /**
   * Redo: pop from future, push current to past, return next state
   */
  redo(currentState: HarnessData): HarnessData | null {
    const stack = this.getActiveStack();
    if (stack.future.length === 0) return null;
    stack.past.push(structuredClone(currentState));
    const next = stack.future.pop()!;
    this.updateSignals();
    return next;
  }

  /**
   * Clear the active harness's history
   */
  clear(): void {
    const stack = this.getActiveStack();
    stack.past = [];
    stack.future = [];
    stack.transactionSnapshot = null;
    this.updateSignals();
  }

  private getActiveStack(): HistoryStack {
    let stack = this.stacks.get(this.activeKey);
    if (!stack) {
      stack = { past: [], future: [], transactionSnapshot: null };
      this.stacks.set(this.activeKey, stack);
    }
    return stack;
  }

  private updateSignals(): void {
    const stack = this.getActiveStack();
    this.canUndo.set(stack.past.length > 0);
    this.canRedo.set(stack.future.length > 0);
  }
}
