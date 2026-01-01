import type { Annotation } from "./AnnotationManager";

/**
 * Represents a single action that can be undone/redone
 */
export interface HistoryAction {
  type: "add" | "remove" | "update";
  annotationId: string;
  previousState: Annotation | null;
  newState: Annotation | null;
  timestamp: number;
}

/**
 * HistoryManager implements the Command pattern for undo/redo functionality.
 * It maintains two stacks: one for undo operations and one for redo operations.
 * The maximum stack size is configurable (default: 50 operations).
 */
export class HistoryManager {
  private undoStack: HistoryAction[] = [];
  private redoStack: HistoryAction[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 50) {
    this.maxSize = maxSize;
  }

  /**
   * Push a new action onto the history stack.
   * Clears the redo stack since a new action invalidates the redo history.
   * If the stack exceeds maxSize, the oldest entry is removed.
   */
  push(action: HistoryAction): void {
    this.undoStack.push(action);
    this.redoStack = []; // Clear redo stack on new action

    // Enforce stack size limit
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
  }

  /**
   * Undo the last action.
   * Returns the action that was undone, or null if nothing to undo.
   */
  undo(): HistoryAction | null {
    const action = this.undoStack.pop();
    if (action) {
      this.redoStack.push(action);
    }
    return action ?? null;
  }

  /**
   * Redo the last undone action.
   * Returns the action that was redone, or null if nothing to redo.
   */
  redo(): HistoryAction | null {
    const action = this.redoStack.pop();
    if (action) {
      this.undoStack.push(action);
    }
    return action ?? null;
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * Get the number of actions in the undo stack
   */
  getUndoCount(): number {
    return this.undoStack.length;
  }

  /**
   * Get the number of actions in the redo stack
   */
  getRedoCount(): number {
    return this.redoStack.length;
  }

  /**
   * Get the maximum stack size
   */
  getMaxSize(): number {
    return this.maxSize;
  }
}
