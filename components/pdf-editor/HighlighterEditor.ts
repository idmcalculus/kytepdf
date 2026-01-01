import { BaseTool } from "./BaseTool";
import type { ToolContext } from "./types";

type Bounds = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

export class HighlighterEditor extends BaseTool {
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private pageIndex: number | null = null;
  private previewEl: HTMLDivElement | null = null;
  private defaultColor = "#ffff00";
  private defaultOpacity = 0.3;

  constructor(context: ToolContext) {
    super("addHighlightBtn", context);
  }

  onPageClick() {
    // Highlight rectangles are handled via pointer events.
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
    const width = Math.max(20, bounds.width);
    const height = Math.max(12, bounds.height);

    const id = this.context.annotationManager.addAnnotation({
      type: "highlight",
      pageIndex,
      x: bounds.minX,
      y: bounds.minY,
      width,
      height,
      style: {
        color: this.defaultColor,
        opacity: this.defaultOpacity,
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
    this.previewEl.className = "annotation annotation-highlight";
    this.previewEl.style.position = "absolute";
    this.previewEl.style.left = `${x}px`;
    this.previewEl.style.top = `${y}px`;
    this.previewEl.style.width = "1px";
    this.previewEl.style.height = "1px";
    this.previewEl.style.backgroundColor = this.defaultColor;
    this.previewEl.style.opacity = this.defaultOpacity.toString();
    this.previewEl.style.borderRadius = "2px";
    this.previewEl.style.pointerEvents = "none";
    this.previewEl.style.zIndex = "105";

    pageWrapper.appendChild(this.previewEl);
  }

  private updatePreview(x: number, y: number) {
    if (!this.previewEl) return;
    const bounds = this.getBounds(x, y);
    this.previewEl.style.left = `${bounds.minX}px`;
    this.previewEl.style.top = `${bounds.minY}px`;
    this.previewEl.style.width = `${Math.max(1, bounds.width)}px`;
    this.previewEl.style.height = `${Math.max(1, bounds.height)}px`;
  }

  private cleanupPreview() {
    if (this.previewEl) this.previewEl.remove();
    this.previewEl = null;
  }

  private getBounds(x: number, y: number): Bounds {
    const minX = Math.min(this.startX, x);
    const minY = Math.min(this.startY, y);
    const width = Math.abs(x - this.startX);
    const height = Math.abs(y - this.startY);

    return { minX, minY, width, height };
  }
}
