import { describe, expect, it, vi } from "vitest";
import { destroyPdfDocument } from "../../utils/pdfDocument";

describe("destroyPdfDocument", () => {
  it("frees a document through the task that loaded it", async () => {
    // pdf.js 6 removed PDFDocumentProxy.destroy(); only the loading task frees it.
    const destroy = vi.fn().mockResolvedValue(undefined);

    await destroyPdfDocument({ loadingTask: { destroy } } as any);

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("passes on a failure so the caller can decide what to do with it", async () => {
    const destroy = vi.fn().mockRejectedValue(new Error("worker gone"));

    await expect(destroyPdfDocument({ loadingTask: { destroy } } as any)).rejects.toThrow(
      "worker gone",
    );
  });

  it("does nothing when there is no document", async () => {
    await expect(destroyPdfDocument(null)).resolves.toBeUndefined();
    await expect(destroyPdfDocument(undefined)).resolves.toBeUndefined();
  });
});
