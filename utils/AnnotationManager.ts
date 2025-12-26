export interface Annotation {
  id: string;
  type: 'text' | 'image' | 'rectangle';
  pageIndex: number;
  x: number; // PDF coordinates
  y: number; // PDF coordinates
  width?: number;
  height?: number;
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

  /**
   * Adds a new annotation and returns its unique ID
   */
  addAnnotation(ann: Omit<Annotation, 'id'>): string {
    const id = crypto.randomUUID();
    const newAnnotation: Annotation = { ...ann, id };
    this.annotations.set(id, newAnnotation);
    return id;
  }

  /**
   * Updates an existing annotation
   */
  updateAnnotation(id: string, updates: Partial<Omit<Annotation, 'id' | 'pageIndex'>>): boolean {
    const existing = this.annotations.get(id);
    if (!existing) return false;

    this.annotations.set(id, { ...existing, ...updates });
    return true;
  }

  /**
   * Removes an annotation by ID
   */
  removeAnnotation(id: string): boolean {
    return this.annotations.delete(id);
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
    return Array.from(this.annotations.values())
      .filter(ann => ann.pageIndex === pageIndex);
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
