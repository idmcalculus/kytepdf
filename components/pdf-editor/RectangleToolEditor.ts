import { BaseTool } from "./BaseTool";

export class RectangleToolEditor extends BaseTool {
  constructor(context: any) {
    super("addRectBtn", context);
  }

  onPageClick(pageIndex: number, x: number, y: number) {
    const id = this.context.annotationManager.addAnnotation({
      type: "rectangle",
      pageIndex,
      x,
      y,
      width: 100,
      height: 50,
      style: { color: "#ffffff", strokeWidth: 0, opacity: 1.0 }
    });
    
    this.context.renderAnnotation(id);
  }
}
