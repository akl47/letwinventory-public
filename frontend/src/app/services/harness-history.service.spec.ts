import { HarnessHistoryService } from './harness-history.service';
import { HarnessData } from '../models/harness.model';

function mockState(id: number): HarnessData {
  return { connectors: [{ id }], cables: [], connections: [], components: [] } as any;
}

describe('HarnessHistoryService', () => {
  let service: HarnessHistoryService;

  beforeEach(() => {
    service = new HarnessHistoryService();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('should have canUndo false', () => {
      expect(service.canUndo()).toBe(false);
    });

    it('should have canRedo false', () => {
      expect(service.canRedo()).toBe(false);
    });

    it('should return null on undo when empty', () => {
      expect(service.undo(mockState(1))).toBeNull();
    });

    it('should return null on redo when empty', () => {
      expect(service.redo(mockState(1))).toBeNull();
    });
  });

  describe('push', () => {
    it('should enable canUndo after push', () => {
      service.push(mockState(1));
      expect(service.canUndo()).toBe(true);
    });

    it('should clear future stack on push', () => {
      service.push(mockState(1));
      service.push(mockState(2));
      // undo to create a future entry
      service.undo(mockState(3));
      expect(service.canRedo()).toBe(true);
      // push clears future
      service.push(mockState(4));
      expect(service.canRedo()).toBe(false);
    });
  });

  describe('undo/redo cycle', () => {
    it('should undo and return previous state', () => {
      service.push(mockState(1));
      const result = service.undo(mockState(2));
      expect(result).toEqual(mockState(1));
      expect(service.canUndo()).toBe(false);
      expect(service.canRedo()).toBe(true);
    });

    it('should redo and return next state', () => {
      service.push(mockState(1));
      service.undo(mockState(2));
      const result = service.redo(mockState(1));
      expect(result).toEqual(mockState(2));
      expect(service.canUndo()).toBe(true);
      expect(service.canRedo()).toBe(false);
    });

    it('should handle multiple undo/redo steps', () => {
      service.push(mockState(1));
      service.push(mockState(2));
      service.push(mockState(3));
      // current state is 4, past = [1, 2, 3]

      const r1 = service.undo(mockState(4));
      expect(r1).toEqual(mockState(3));

      const r2 = service.undo(mockState(3));
      expect(r2).toEqual(mockState(2));

      const r3 = service.redo(mockState(2));
      expect(r3).toEqual(mockState(3));
    });
  });

  describe('max size enforcement', () => {
    it('should limit past stack to 50 entries', () => {
      for (let i = 0; i < 55; i++) {
        service.push(mockState(i));
      }
      // Should be able to undo 50 times, then get null
      let count = 0;
      let current = mockState(999);
      while (service.undo(current) !== null) {
        current = mockState(998 - count);
        count++;
      }
      expect(count).toBe(50);
    });
  });

  describe('clear', () => {
    it('should reset all stacks and signals', () => {
      service.push(mockState(1));
      service.push(mockState(2));
      service.undo(mockState(3));
      expect(service.canUndo()).toBe(true);
      expect(service.canRedo()).toBe(true);

      service.clear();
      expect(service.canUndo()).toBe(false);
      expect(service.canRedo()).toBe(false);
      expect(service.undo(mockState(1))).toBeNull();
      expect(service.redo(mockState(1))).toBeNull();
    });
  });

  describe('transactions', () => {
    it('should commit transaction when state changed', () => {
      service.beginTransaction(mockState(1));
      service.commitTransaction(mockState(2));
      expect(service.canUndo()).toBe(true);
      const result = service.undo(mockState(2));
      expect(result).toEqual(mockState(1));
    });

    it('should not push when state is unchanged', () => {
      const state = mockState(1);
      service.beginTransaction(state);
      service.commitTransaction(mockState(1)); // identical data
      expect(service.canUndo()).toBe(false);
    });

    it('should cancel transaction without pushing', () => {
      service.beginTransaction(mockState(1));
      service.cancelTransaction();
      expect(service.canUndo()).toBe(false);
    });

    it('should clear future stack on commit', () => {
      service.push(mockState(1));
      service.undo(mockState(2));
      expect(service.canRedo()).toBe(true);

      service.beginTransaction(mockState(2));
      service.commitTransaction(mockState(3));
      expect(service.canRedo()).toBe(false);
    });

    it('should handle commit without begin as no-op', () => {
      service.commitTransaction(mockState(1));
      expect(service.canUndo()).toBe(false);
    });
  });

  describe('deep cloning', () => {
    it('should not be affected by mutations to the original object', () => {
      const state = mockState(1);
      service.push(state);
      // Mutate the original
      (state as any).connectors[0].id = 999;
      const result = service.undo(mockState(2));
      expect((result as any).connectors[0].id).toBe(1);
    });
  });
});
