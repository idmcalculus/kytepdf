import { pdfjsLib } from "./pdfConfig.ts";
import { logger } from "./logger.ts";

export async function loadPdf(data: ArrayBuffer | Uint8Array) {
  try {
    const loadingTask = pdfjsLib.getDocument({ data });
    return await loadingTask.promise;
  } catch (error) {
    logger.error("Failed to load PDF document", error);
    throw error;
  }
}

export async function renderPage(
  pdfDoc: any,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.0
) {
  try {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context not available");

    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise;
  } catch (error) {
    logger.error(`Failed to render page ${pageNumber}`, error);
    throw error;
  }
}
