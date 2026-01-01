import { BaseTool } from "./BaseTool";
import type { ToolContext } from "./types";

type Bounds = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

type LineType = "strikethrough" | "underline";

export class LineAnnotationEditor extends BaseTool {
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private pageIndex: number | null = null;
  private previewEl: HTMLDivElement | null = null;
  private previewLine: HTMLDivElement | null = null;
  private strokeColor = "#111827";
  private strokeWidth = 2;
  private opacity = 1;

  constructor(
    id: string,
    context: ToolContext,
    private lineType: LineType,
  ) {
    super(id, context);
  }

  onPageClick() {
    // Line annotations are handled via pointer events.
  }

  onPointerDown(pageIndex: number, x: number, y: number) {
    if (!this.active) return;
    this.isDrawing = true;
    this.pageIndex = pageIndex;
    this.startX = x;
    this.startY = y;
    this.createPreview(pageIndex, x, y);
  }

  onPointerMove(pageIndex: number, x: number, y: number) {
    if (!this.isDrawing || this.pageIndex !== pageIndex) return;
    this.updatePreview(x, y);
  }

  onPointerUp(pageIndex: number, x: number, y: number) {
    if (!this.isDrawing || this.pageIndex !== pageIndex) return;

    const bounds = this.getBounds(x, y);
    const width = Math.max(30, bounds.width);
    const height = Math.max(this.strokeWidth * 2, bounds.height);

    const id = this.context.annotationManager.addAnnotation({
      type: this.lineType,
      pageIndex,
      x: bounds.minX,
      y: bounds.minY,
      width,
      height,
      style: {
        color: this.strokeColor,
        strokeWidth: this.strokeWidth,
        opacity: this.opacity,
      },
    });

    this.context.renderAnnotation(id);
    this.cleanupPreview();
    this.isDrawing = false;
    this.pageIndex = null;
  }

  private getPageWrapper(pageIndex: number): HTMLElement | null {
    return this.context.container.querySelector(
      `.pdf-page-wrapper[data-index="${pageIndex}"]`,
    ) as HTMLElement | null;
  }

  private createPreview(pageIndex: number, x: number, y: number) {
    const pageWrapper = this.getPageWrapper(pageIndex);
    if (!pageWrapper) return;

    this.previewEl = document.createElement("div");
    this.previewEl.className = `annotation annotation-${this.lineType}`;
    this.previewEl.style.position = "absolute";
    this.previewEl.style.left = `${x}px`;
    this.previewEl.style.top = `${y}px`;
    this.previewEl.style.width = "1px";
    this.previewEl.style.height = `${this.strokeWidth * 2}px`;
    this.previewEl.style.pointerEvents = "none";
    this.previewEl.style.zIndex = "105";

    this.previewLine = document.createElement("div");
    this.previewLine.className = "line-annotation";
    this.previewLine.style.position = "absolute";
    this.previewLine.style.left = "0";
    this.previewLine.style.right = "0";
    this.previewLine.style.height = `${this.strokeWidth}px`;
    this.previewLine.style.backgroundColor = this.strokeColor;
    this.previewLine.style.opacity = this.opacity.toString();
    this.previewLine.style.top = "0";

    this.previewEl.appendChild(this.previewLine);
    pageWrapper.appendChild(this.previewEl);
  }

  private updatePreview(x: number, y: number) {
    if (!this.previewEl || !this.previewLine) return;
    const bounds = this.getBounds(x, y);
    const height = Math.max(this.strokeWidth * 2, bounds.height);

    this.previewEl.style.left = `${bounds.minX}px`;
    this.previewEl.style.top = `${bounds.minY}px`;
    this.previewEl.style.width = `${Math.max(1, bounds.width)}px`;
    this.previewEl.style.height = `${height}px`;

    const lineTop =
      this.lineType === "underline"
        ? Math.max(0, height - this.strokeWidth)
        : Math.max(0, height / 2 - this.strokeWidth / 2);
    this.previewLine.style.top = `${lineTop}px`;
  }

  private cleanupPreview() {
    if (this.previewEl) this.previewEl.remove();
    this.previewEl = null;
    this.previewLine = null;
  }

  private getBounds(x: number, y: number): Bounds {
    const minX = Math.min(this.startX, x);
    const minY = Math.min(this.startY, y);
    const width = Math.abs(x - this.startX);
    const height = Math.abs(y - this.startY);

    return { minX, minY, width, height };
  }
}
