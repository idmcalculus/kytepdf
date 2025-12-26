import { BaseTool } from "./BaseTool";
import { logger } from "../../utils/logger";

export class TextEditor extends BaseTool {
  constructor(context: any) {
    super("addTextBtn", context);
  }

  async onPageClick(pageIndex: number, x: number, y: number) {
    let fontSize = 16;
    let color = "#000000";

    try {
      const page = await this.context.pdfDoc.getPage(pageIndex + 1);
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1.0 });
      const scale = 800 / viewport.width;
      const pdfX = x / scale;
      const pdfY = viewport.height - (y / scale);

      let minDistance = 50;
      let nearestItem: any = null;

      for (const item of textContent.items) {
        if (!('transform' in item)) continue;
        const tx = item.transform[4];
        const ty = item.transform[5];
        const dist = Math.sqrt(Math.pow(tx - pdfX, 2) + Math.pow(ty - pdfY, 2));
        
        if (dist < minDistance) {
          minDistance = dist;
          nearestItem = item;
        }
      }

      if (nearestItem) {
        fontSize = Math.round(nearestItem.transform[0]);
        logger.info("Smart Match detected font size", { fontSize });
      }
    } catch (err) {
      logger.warn("Smart Match failed", err);
    }

    const id = this.context.annotationManager.addAnnotation({
      type: "text",
      pageIndex,
      x,
      y,
      content: "New Text",
      style: { fontSize, color, font: "Helvetica" }
    });
    
    this.context.renderAnnotation(id);
  }
}
