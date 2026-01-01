import * as fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { type HistoryAction, HistoryManager } from "../../utils/HistoryManager";

/**
 * Simplified HistoryAction generator for faster tests
 */
const historyActionArb = fc.record({
  type: fc.constantFrom("add", "remove", "update") as fc.Arbitrary<"add" | "remove" | "update">,
  annotationId: fc.string({ minLength: 5, maxLength: 10 }),
  previousState: fc.constant(null),
  newState: fc.constant(null),
  timestamp: fc.nat({ max: 10000 }),
});

describe("HistoryManager", () => {
  let historyManager: HistoryManager;

  beforeEach(() => {
    historyManager = new HistoryManager();
  });

  describe("Basic functionality", () => {
    it("should start with empty stacks", () => {
      expect(historyManager.canUndo()).toBe(false);
      expect(historyManager.canRedo()).toBe(false);
      expect(historyManager.getUndoCount()).toBe(0);
      expect(historyManager.getRedoCount()).toBe(0);
    });

    it("should allow pushing actions", () => {
      const action: HistoryAction = {
        type: "add",
        annotationId: "test-id",
        previousState: null,
        newState: { id: "test-id", type: "text", pageIndex: 0, x: 100, y: 100 },
        timestamp: Date.now(),
      };
      historyManager.push(action);
      expect(historyManager.canUndo()).toBe(true);
      expect(historyManager.getUndoCount()).toBe(1);
    });
  });

  /**
   * **Feature: kytepdf-roadmap, Property 9: Undo/Redo Round-Trip**
   * **Validates: Requirements 6.5, 6.6**
   *
   * For any sequence of annotation actions, performing undo followed by redo
   * SHALL restore the annotation state to its pre-undo condition.
   */
  describe("Property 9: Undo/Redo Round-Trip", () => {
    it("undo followed by redo restores state", () => {
      fc.assert(
        fc.property(fc.array(historyActionArb, { minLength: 1, maxLength: 10 }), (actions) => {
          const manager = new HistoryManager();

          for (const action of actions) {
            manager.push(action);
          }

          const undoCountBefore = manager.getUndoCount();
          const redoCountBefore = manager.getRedoCount();

          const undoneAction = manager.undo();
          const redoneAction = manager.redo();

          expect(manager.getUndoCount()).toBe(undoCountBefore);
          expect(manager.getRedoCount()).toBe(redoCountBefore);
          expect(undoneAction).toEqual(redoneAction);
        }),
        { numRuns: 20 },
      );
    });
  });

  /**
   * **Feature: kytepdf-roadmap, Property 10: History Stack Size Invariant**
   * **Validates: Requirements 6.7**
   *
   * For any sequence of annotation operations, the History_Manager undo stack
   * SHALL contain at most `maxSize` (50) entries, and the oldest entries
   * SHALL be discarded when the limit is exceeded.
   */
  describe("Property 10: History Stack Size Invariant", () => {
    it("undo stack never exceeds maxSize", () => {
      fc.assert(
        fc.property(
          fc.array(historyActionArb, { minLength: 1, maxLength: 30 }),
          fc.integer({ min: 1, max: 20 }),
          (actions, maxSize) => {
            const manager = new HistoryManager(maxSize);

            for (const action of actions) {
              manager.push(action);
            }

            expect(manager.getUndoCount()).toBeLessThanOrEqual(maxSize);
          },
        ),
        { numRuns: 20 },
      );
    });

    it("oldest entries are discarded when limit exceeded", () => {
      const maxSize = 5;
      const manager = new HistoryManager(maxSize);

      for (let i = 0; i < 10; i++) {
        manager.push({
          type: "add",
          annotationId: `id-${i}`,
          previousState: null,
          newState: null,
          timestamp: i,
        });
      }

      expect(manager.getUndoCount()).toBe(maxSize);

      const undoneIds: string[] = [];
      while (manager.canUndo()) {
        const action = manager.undo();
        if (action) undoneIds.push(action.annotationId);
      }

      expect(undoneIds).toEqual(["id-9", "id-8", "id-7", "id-6", "id-5"]);
    });
  });

  /**
   * **Feature: kytepdf-roadmap, Property 11: History Recording Completeness**
   * **Validates: Requirements 6.8**
   *
   * For any annotation operation (add, move, resize, delete), the History_Manager
   * stack size SHALL increase by exactly 1 (unless at max capacity).
   */
  describe("Property 11: History Recording Completeness", () => {
    it("each push increases undo count by exactly 1 (when not at capacity)", () => {
      fc.assert(
        fc.property(historyActionArb, (action) => {
          const manager = new HistoryManager(100);
          const countBefore = manager.getUndoCount();

          manager.push(action);

          expect(manager.getUndoCount()).toBe(countBefore + 1);
        }),
        { numRuns: 20 },
      );
    });

    it("push clears redo stack", () => {
      fc.assert(
        fc.property(
          fc.array(historyActionArb, { minLength: 3, maxLength: 8 }),
          historyActionArb,
          (initialActions, newAction) => {
            const manager = new HistoryManager();

            for (const action of initialActions) {
              manager.push(action);
            }

            manager.undo();
            manager.undo();

            expect(manager.getRedoCount()).toBeGreaterThan(0);

            manager.push(newAction);

            expect(manager.getRedoCount()).toBe(0);
          },
        ),
        { numRuns: 20 },
      );
    });
  });

  describe("Edge cases", () => {
    it("undo on empty stack returns null", () => {
      expect(historyManager.undo()).toBeNull();
    });

    it("redo on empty stack returns null", () => {
      expect(historyManager.redo()).toBeNull();
    });

    it("clear empties both stacks", () => {
      // Add some actions
      historyManager.push({
        type: "add",
        annotationId: "test",
        previousState: null,
        newState: { id: "test", type: "text", pageIndex: 0, x: 0, y: 0 },
        timestamp: Date.now(),
      });
      historyManager.undo();

      expect(historyManager.getUndoCount()).toBe(0);
      expect(historyManager.getRedoCount()).toBe(1);

      historyManager.clear();

      expect(historyManager.getUndoCount()).toBe(0);
      expect(historyManager.getRedoCount()).toBe(0);
    });
  });
});
