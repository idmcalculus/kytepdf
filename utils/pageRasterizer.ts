import { loadProcessablePdfJsDocument } from "./pdfSecurity.ts";

export interface RasterizedPage {
  /** 1-indexed page number. */
  page: number;
  /** PNG bytes of the rendered page. */
  png: Uint8Array;
  width: number;
  height: number;
}

/**
 * Rasterize selected 1-indexed PDF pages to PNG for OCR, yielding one page at
 * a time.
 *
 * Streaming matters here: a 2000px-long-edge page PNG can be several MB, so
 * materializing a whole 20-page batch before OCR starts can hold >100 MB live
 * at once and OOM mobile Safari. Yielding lets the caller OCR and release each
 * page before the next is rendered, so peak memory is one page rather than the
 * whole batch.
 */
export async function* rasterizePdfPagesStream(
  pdfBytes: Uint8Array,
  pages: number[],
  maxEdgePx = 2000,
): AsyncGenerator<RasterizedPage, void, undefined> {
  const unique = Array.from(new Set(pages.filter((p) => Number.isInteger(p) && p >= 1))).sort(
    (a, b) => a - b,
  );
  if (unique.length === 0) return;

  const { pdfDoc } = await loadProcessablePdfJsDocument(pdfBytes.slice());

  try {
    for (const pageNum of unique) {
      if (pageNum > pdfDoc.numPages) continue;
      const page = await pdfDoc.getPage(pageNum);
      const base = page.getViewport({ scale: 1 });
      const longEdge = Math.max(base.width, base.height);
      // Up to 2x for small pages, and never past maxEdgePx however large the
      // page, so a poster-sized page cannot exceed the browser's canvas limit.
      const scale = Math.min(2, maxEdgePx / longEdge);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: false });
      if (!ctx) throw new Error("Canvas 2D context unavailable for OCR rasterization.");

      let png: Uint8Array;
      let width: number;
      let height: number;
      try {
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("Failed to encode page as PNG."))),
            "image/png",
          );
        });
        png = new Uint8Array(await blob.arrayBuffer());
        width = canvas.width;
        height = canvas.height;
      } finally {
        // Drop canvas backing store promptly, even if render/encode threw.
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup?.();
      }

      yield { page: pageNum, png, width, height };
    }
  } finally {
    // Runs on early return/throw too, so an aborted OCR run still frees the doc.
    await pdfDoc.destroy?.();
  }
}

/**
 * Eager variant of {@link rasterizePdfPagesStream} that collects every page.
 * Prefer the streaming version for OCR; this holds all PNGs in memory at once.
 */
export async function rasterizePdfPages(
  pdfBytes: Uint8Array,
  pages: number[],
  maxEdgePx = 2000,
): Promise<RasterizedPage[]> {
  const out: RasterizedPage[] = [];
  for await (const raster of rasterizePdfPagesStream(pdfBytes, pages, maxEdgePx)) {
    out.push(raster);
  }
  return out;
}
