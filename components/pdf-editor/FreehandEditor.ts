import { BaseTool } from "./BaseTool";
import type { ToolContext } from "./types";

type Point = { x: number; y: number };

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export class FreehandEditor extends BaseTool {
  private isDrawing = false;
  private currentPoints: Point[] = [];
  private pageIndex: number | null = null;
  private previewEl: HTMLDivElement | null = null;
  private previewSvg: SVGSVGElement | null = null;
  private previewPath: SVGPathElement | null = null;
  private strokeColor = "#111827";
  private strokeWidth = 2;
  private opacity = 1;

  constructor(context: ToolContext) {
    super("addFreehandBtn", context);
  }

  onPageClick() {
    // Freehand drawing is handled via pointer events.
  }

  onPointerDown(pageIndex: number, x: number, y: number) {
    if (!this.active) return;
    this.isDrawing = true;
    this.pageIndex = pageIndex;
    this.currentPoints = [{ x, y }];
    this.createPreview(pageIndex, x, y);
  }

  onPointerMove(pageIndex: number, x: number, y: number) {
    if (!this.isDrawing || this.pageIndex !== pageIndex) return;
    this.currentPoints.push({ x, y });
    this.updatePreview();
  }

  onPointerUp(pageIndex: number, x: number, y: number) {
    if (!this.isDrawing || this.pageIndex !== pageIndex) return;

    this.currentPoints.push({ x, y });
    const points = this.ensureRenderablePoints(this.currentPoints);
    const bounds = this.getBounds(points);
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const normalizedPoints = points.map((point) => ({
      x: point.x - bounds.minX,
      y: point.y - bounds.minY,
    }));

    const id = this.context.annotationManager.addAnnotation({
      type: "freehand",
      pageIndex,
      x: bounds.minX,
      y: bounds.minY,
      width,
      height,
      points: normalizedPoints,
      style: {
        color: this.strokeColor,
        strokeWidth: this.strokeWidth,
        opacity: this.opacity,
      },
    });

    this.context.renderAnnotation(id);
    this.cleanupPreview();
    this.currentPoints = [];
    this.pageIndex = null;
    this.isDrawing = false;
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
    this.previewEl.className = "annotation annotation-freehand";
    this.previewEl.style.position = "absolute";
    this.previewEl.style.left = `${x}px`;
    this.previewEl.style.top = `${y}px`;
    this.previewEl.style.width = "1px";
    this.previewEl.style.height = "1px";
    this.previewEl.style.pointerEvents = "none";
    this.previewEl.style.zIndex = "105";

    this.previewSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.previewSvg.setAttribute("width", "1");
    this.previewSvg.setAttribute("height", "1");
    this.previewSvg.setAttribute("viewBox", "0 0 1 1");
    this.previewSvg.style.width = "100%";
    this.previewSvg.style.height = "100%";

    this.previewPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    this.previewPath.setAttribute("fill", "none");
    this.previewPath.setAttribute("stroke", this.strokeColor);
    this.previewPath.setAttribute("stroke-width", `${this.strokeWidth}`);
    this.previewPath.setAttribute("stroke-linecap", "round");
    this.previewPath.setAttribute("stroke-linejoin", "round");
    this.previewPath.setAttribute("opacity", `${this.opacity}`);

    this.previewSvg.appendChild(this.previewPath);
    this.previewEl.appendChild(this.previewSvg);
    pageWrapper.appendChild(this.previewEl);
  }

  private updatePreview() {
    if (!this.previewEl || !this.previewSvg || !this.previewPath) return;

    const points = this.ensureRenderablePoints(this.currentPoints);
    const bounds = this.getBounds(points);
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);

    this.previewEl.style.left = `${bounds.minX}px`;
    this.previewEl.style.top = `${bounds.minY}px`;
    this.previewEl.style.width = `${width}px`;
    this.previewEl.style.height = `${height}px`;

    this.previewSvg.setAttribute("width", `${width}`);
    this.previewSvg.setAttribute("height", `${height}`);
    this.previewSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    const pathData = points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"} ${point.x - bounds.minX} ${point.y - bounds.minY}`,
      )
      .join(" ");
    this.previewPath.setAttribute("d", pathData);
  }

  private cleanupPreview() {
    if (this.previewEl) this.previewEl.remove();
    this.previewEl = null;
    this.previewSvg = null;
    this.previewPath = null;
  }

  private ensureRenderablePoints(points: Point[]): Point[] {
    if (points.length >= 2) return points;
    if (points.length === 1) {
      return [points[0], { x: points[0].x + 0.1, y: points[0].y + 0.1 }];
    }
    return [];
  }

  private getBounds(points: Point[]): Bounds {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const point of points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }

    if (points.length === 0) {
      minX = 0;
      minY = 0;
      maxX = 1;
      maxY = 1;
    }

    return { minX, minY, maxX, maxY };
  }
}
