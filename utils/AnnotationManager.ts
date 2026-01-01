import type { HistoryAction, HistoryManager } from "./HistoryManager";

export interface Annotation {
  id: string;
  type: "text" | "image" | "rectangle" | "freehand" | "highlight" | "strikethrough" | "underline";
  pageIndex: number;
  x: number; // PDF coordinates
  y: number; // PDF coordinates
  width?: number;
  height?: number;
  points?: Array<{ x: number; y: number }>;
  content?: string; // For text or image data URL
  style?: {
    color?: string;
    fontSize?: number;
    strokeWidth?: number;
    opacity?: number;
    rotation?: number; // In degrees
    font?: string;
  };
}

export class AnnotationManager {
  private annotations: Map<string, Annotation> = new Map();
  private historyManager: HistoryManager | null;

  constructor(historyManager: HistoryManager | null = null) {
    this.historyManager = historyManager;
  }

  setHistoryManager(historyManager: HistoryManager | null) {
    this.historyManager = historyManager;
  }

  private cloneAnnotation(annotation: Annotation): Annotation {
    return {
      ...annotation,
      style: annotation.style ? { ...annotation.style } : undefined,
      points: annotation.points ? annotation.points.map((point) => ({ ...point })) : undefined,
    };
  }

  private recordHistory(action: HistoryAction, recordHistory: boolean) {
    if (!recordHistory || !this.historyManager) return;
    this.historyManager.push(action);
  }

  /**
   * Adds a new annotation and returns its unique ID
   */
  addAnnotation(
    ann: Omit<Annotation, "id">,
    options: { id?: string; recordHistory?: boolean } = {},
  ): string {
    const id = options.id ?? crypto.randomUUID();
    const newAnnotation: Annotation = { ...ann, id };
    this.annotations.set(id, newAnnotation);
    this.recordHistory(
      {
        type: "add",
        annotationId: id,
        previousState: null,
        newState: this.cloneAnnotation(newAnnotation),
        timestamp: Date.now(),
      },
      options.recordHistory !== false,
    );
    return id;
  }

  /**
   * Updates an existing annotation
   */
  updateAnnotation(
    id: string,
    updates: Partial<Omit<Annotation, "id" | "pageIndex">>,
    options: { recordHistory?: boolean } = {},
  ): boolean {
    const existing = this.annotations.get(id);
    if (!existing) return false;

    const previousState = this.cloneAnnotation(existing);
    const updated = { ...existing, ...updates };
    this.annotations.set(id, updated);
    this.recordHistory(
      {
        type: "update",
        annotationId: id,
        previousState,
        newState: this.cloneAnnotation(updated),
        timestamp: Date.now(),
      },
      options.recordHistory !== false,
    );
    return true;
  }

  /**
   * Removes an annotation by ID
   */
  removeAnnotation(id: string, options: { recordHistory?: boolean } = {}): boolean {
    const existing = this.annotations.get(id);
    if (!existing) return false;

    this.annotations.delete(id);
    this.recordHistory(
      {
        type: "remove",
        annotationId: id,
        previousState: this.cloneAnnotation(existing),
        newState: null,
        timestamp: Date.now(),
      },
      options.recordHistory !== false,
    );
    return true;
  }

  /**
   * Gets a single annotation by ID
   */
  getAnnotation(id: string): Annotation | undefined {
    return this.annotations.get(id);
  }

  /**
   * Gets all annotations for a specific page
   */
  getAnnotations(pageIndex: number): Annotation[] {
    return Array.from(this.annotations.values()).filter((ann) => ann.pageIndex === pageIndex);
  }

  /**
   * Gets all annotations across all pages
   */
  getAllAnnotations(): Annotation[] {
    return Array.from(this.annotations.values());
  }

  /**
   * Clears all annotations
   */
  clear(): void {
    this.annotations.clear();
  }
}
