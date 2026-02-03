import { Injectable, signal } from '@angular/core';
import { HarnessData } from '../models/harness.model';

@Injectable({ providedIn: 'root' })
export class HarnessHistoryService {
  private past: HarnessData[] = [];
  private future: HarnessData[] = [];
  private maxSize = 50;
  private transactionSnapshot: HarnessData | null = null;

  canUndo = signal(false);
  canRedo = signal(false);

  /**
   * Push state before a change (for instant operations like delete, rotate, etc.)
   */
  push(state: HarnessData): void {
    this.past.push(structuredClone(state));
    if (this.past.length > this.maxSize) this.past.shift();
    this.future = []; // Clear redo stack on new change
    this.updateSignals();
  }

  /**
   * For drag operations - snapshot at start of drag
   */
  beginTransaction(state: HarnessData): void {
    this.transactionSnapshot = structuredClone(state);
  }

  /**
   * Commit transaction if state actually changed
   */
  commitTransaction(newState: HarnessData): void {
    if (this.transactionSnapshot &&
        JSON.stringify(this.transactionSnapshot) !== JSON.stringify(newState)) {
      this.past.push(this.transactionSnapshot);
      if (this.past.length > this.maxSize) this.past.shift();
      this.future = [];
      this.updateSignals();
    }
    this.transactionSnapshot = null;
  }

  /**
   * Cancel transaction without committing
   */
  cancelTransaction(): void {
    this.transactionSnapshot = null;
  }

  /**
   * Undo: pop from past, push current to future, return previous state
   */
  undo(currentState: HarnessData): HarnessData | null {
    if (this.past.length === 0) return null;
    this.future.push(structuredClone(currentState));
    const previous = this.past.pop()!;
    this.updateSignals();
    return previous;
  }

  /**
   * Redo: pop from future, push current to past, return next state
   */
  redo(currentState: HarnessData): HarnessData | null {
    if (this.future.length === 0) return null;
    this.past.push(structuredClone(currentState));
    const next = this.future.pop()!;
    this.updateSignals();
    return next;
  }

  /**
   * Clear all history (e.g., when loading a different harness)
   */
  clear(): void {
    this.past = [];
    this.future = [];
    this.transactionSnapshot = null;
    this.updateSignals();
  }

  private updateSignals(): void {
    this.canUndo.set(this.past.length > 0);
    this.canRedo.set(this.future.length > 0);
  }
}
