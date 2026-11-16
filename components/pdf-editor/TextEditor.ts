import { logger } from "../../utils/logger";
import { BaseTool } from "./BaseTool";

export class TextEditor extends BaseTool {
  constructor(context: any) {
    super("addTextBtn", context);
  }

  async onPageClick(pageIndex: number, x: number, y: number) {
    let fontSize = 16;
    const color = "#000000";

    try {
      const page = await this.context.pdfDoc.getPage(pageIndex + 1);
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1.0 });
      const scale = 800 / viewport.width;
      // The click on the page as shown, in PDF space: the viewport accounts
      // for page rotation and a crop box that does not start at (0, 0).
      const [pdfX, pdfY] = viewport.convertToPdfPoint(x / scale, y / scale);

      let minDistance = 50;
      let nearestItem: any = null;

      for (const item of textContent.items) {
        if (!("transform" in item)) continue;
        const tx = item.transform[4];
        const ty = item.transform[5];
        const dist = Math.sqrt((tx - pdfX) ** 2 + (ty - pdfY) ** 2);

        if (dist < minDistance) {
          minDistance = dist;
          nearestItem = item;
        }
      }

      if (nearestItem) {
        // The PDF reports size in PDF points; annotations live in editor
        // pixels (scaled to the 800px page), like extracted text blocks. The
        // text's height is its size, even for text turned in PDF space.
        // A page's /UserUnit makes each PDF unit show that much larger.
        const [, , c, d] = nearestItem.transform;
        fontSize = Math.round(Math.hypot(c, d) * scale * (page.userUnit || 1));
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
      style: { fontSize, color, font: "Helvetica" },
    });

    this.context.renderAnnotation(id);
  }
}
