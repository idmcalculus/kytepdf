import type { AnnotationManager } from "../../utils/AnnotationManager";

export interface EditorTool {
  id: string;
  active: boolean;
  onActivate(): void;
  onDeactivate(): void;
  onPageClick(pageIndex: number, x: number, y: number): void;
  onPointerDown?: (pageIndex: number, x: number, y: number, event: MouseEvent) => void;
  onPointerMove?: (pageIndex: number, x: number, y: number, event: MouseEvent) => void;
  onPointerUp?: (pageIndex: number, x: number, y: number, event: MouseEvent) => void;
}

export interface ToolContext {
  container: HTMLElement;
  annotationManager: AnnotationManager;
  pdfDoc: any;
  renderAnnotation: (id: string) => void;
  showProperties: (id: string) => void;
}
