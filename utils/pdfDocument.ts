import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * Frees a pdf.js document and the worker that loaded it.
 *
 * pdf.js 6 removed PDFDocumentProxy.destroy(): a document is now freed
 * through the loading task that opened it. Accepts null so callers can free
 * whatever they hold without checking first.
 */
export function destroyPdfDocument(
  doc: Pick<PDFDocumentProxy, "loadingTask"> | null | undefined,
): Promise<void> {
  return doc?.loadingTask?.destroy() ?? Promise.resolve();
}
