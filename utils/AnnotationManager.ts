import type { HistoryAction, HistoryManager } from "./HistoryManager";

export interface Annotation {
  id: string;
  type:
    | "text"
    | "textblock"
    | "image"
    | "rectangle"
    | "freehand"
    | "highlight"
    | "strikethrough"
    | "underline";
  pageIndex: number;
  x: number; // PDF coordinates
  y: number; // PDF coordinates
  width?: number;
  height?: number;
  points?: Array<{ x: number; y: number }>;
  content?: string; // For text or image data URL
  richContent?: string; // HTML-formatted content for text blocks
  extracted?: boolean; // Whether this was extracted from the original PDF
  style?: {
    color?: string;
    fontSize?: number;
    strokeWidth?: number;
    opacity?: number;
    rotation?: number; // In degrees
    font?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    textAlign?: "left" | "center" | "right" | "justify";
    lineHeight?: number;
    /** Space above the box's first line, in editor pixels like fontSize. */
    paragraphSpacing?: number;
    letterSpacing?: number;
  };
}

/**
 * Represents the original bounding box of an extracted PDF element.
 * Recorded at extraction time and never removed, so the export can
 * white-out all original content even after annotations are deleted.
 */
export interface ExtractedSource {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The annotation made from this region, so save can tell if it changed. */
  annotationId?: string;
}

export class AnnotationManager {
  private annotations: Map<string, Annotation> = new Map();
  private historyManager: HistoryManager | null;
  private extractedSources: ExtractedSource[] = [];

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
   * Clears all annotations and extracted sources
   */
  clear(): void {
    this.annotations.clear();
    this.extractedSources = [];
  }

  /**
   * Records the original bounding box of an extracted PDF element.
   * Called once at extraction time; never removed.
   */
  addExtractedSource(source: ExtractedSource): void {
    this.extractedSources.push(source);
  }

  /**
   * Returns all recorded extracted source regions.
   */
  getAllExtractedSources(): ExtractedSource[] {
    return [...this.extractedSources];
  }
}
