import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPdf: vi.fn(),
  loadProcessablePdfJsDocument: vi.fn(),
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../utils/logger", () => ({ logger: mocks.logger }));
vi.mock("../../utils/pdfConfig", () => ({
  PDFDocument: { create: mocks.createPdf },
  pdfjsLib: { AnnotationMode: { ENABLE: 1 } },
}));
vi.mock("../../utils/pdfSecurity", () => ({
  loadProcessablePdfJsDocument: mocks.loadProcessablePdfJsDocument,
}));
vi.mock("../../utils/taskScheduler", () => ({ yieldToMain: () => Promise.resolve() }));

import { UserFacingError } from "../../utils/errorMapper";
import {
  compressPdf,
  estimateSize,
  pickSamplePages,
  solveQuality,
} from "../../utils/pdfCompression";

/** Mirrors what pdf-lib writes besides the images, so estimates for fully sampled documents are exact. */
const PAGE_OVERHEAD_BYTES = 600;
const DOCUMENT_OVERHEAD_BYTES = 2048;

interface FakePage {
  /** Page size in points. */
  width?: number;
  height?: number;
  /** JPEG bytes per pixel at quality 1. Busier pages compress less. */
  density?: number;
}

/** A pdf.js document whose pages report a size and how much detail they hold. */
function createFakePdf(pages: FakePage[]) {
  const renders: Array<{ pageNumber: number; scale: number }> = [];
  const pageProxies: any[] = [];
  const pdf = {
    numPages: pages.length,
    getPage: vi.fn(async (pageNumber: number) => {
      const { width = 100, height = 100, density = 1 } = pages[pageNumber - 1];
      const page = {
        getViewport: vi.fn(({ scale }: { scale: number }) => ({
          width: width * scale,
          height: height * scale,
          scale,
        })),
        render: vi.fn(({ canvas, viewport }: any) => {
          canvas.density = density;
          renders.push({ pageNumber, scale: viewport.scale });
          return { promise: Promise.resolve() };
        }),
        cleanup: vi.fn(() => true),
      };
      pageProxies.push(page);
      return page;
    }),
    loadingTask: { destroy: vi.fn().mockResolvedValue(undefined) },
  };
  return { pdf, renders, pageProxies };
}

/**
 * Replaces the canvas with one whose JPEG size is pixels × density × quality,
 * which is roughly how real encoders behave and makes sizes predictable.
 */
function installFakeCanvas(options: { context?: object | null } = {}) {
  const canvas: any = {
    width: 0,
    height: 0,
    density: 1,
    largestArea: 0,
    getContext: vi.fn(() => (options.context === undefined ? {} : options.context)),
    toBlob: vi.fn((callback: (blob: Blob | null) => void, _type: string, quality: number) => {
      canvas.largestArea = Math.max(canvas.largestArea, canvas.width * canvas.height);
      const size = Math.round(canvas.width * canvas.height * canvas.density * quality);
      callback({ size, arrayBuffer: () => Promise.resolve(new ArrayBuffer(size)) } as Blob);
    }),
  };
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) =>
    tagName === "canvas" ? canvas : createElement(tagName)) as typeof document.createElement);
  return canvas;
}

/** A pdf-lib stand-in whose saved size is the images plus pdf-lib's usual overhead. */
function installFakePdfLib() {
  const outputs: any[] = [];
  mocks.createPdf.mockImplementation(async () => {
    let imageBytes = 0;
    const drawImage = vi.fn();
    const output = {
      drawImage,
      addPage: vi.fn(() => ({ drawImage })),
      embedJpg: vi.fn(async (bytes: Uint8Array) => {
        imageBytes += bytes.length;
        return {};
      }),
      save: vi.fn(async () => {
        const pages = output.addPage.mock.calls.length;
        return new Uint8Array(imageBytes + pages * PAGE_OVERHEAD_BYTES + DOCUMENT_OVERHEAD_BYTES);
      }),
    };
    outputs.push(output);
    return output;
  });
  return outputs;
}

const pdfFile = (size: number) => {
  const file = new File(["%PDF-1.7"], "input.pdf", { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

const KB = 1024;

describe("compressPdf", () => {
  let canvas: any;
  let outputs: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    canvas = installFakeCanvas();
    outputs = installFakePdfLib();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("compresses a short document in one pass that fits the target", async () => {
    const { pdf } = createFakePdf([{}, {}, {}]);
    const onProgress = vi.fn();

    const result = await compressPdf(pdfFile(200 * KB), 20, onProgress, {
      targetRatio: 0.1,
      document: pdf as any,
    });

    expect(outputs).toHaveLength(1);
    expect(result.length).toBeLessThanOrEqual(20 * KB);
    // Every page was sampled, so the estimate is exact and the result fills the target.
    expect(result.length).toBeGreaterThan(20 * KB * 0.9);
    expect(onProgress).toHaveBeenLastCalledWith(100, "Finalizing...");
  });

  it("keeps each page's size in points, whatever the image resolution", async () => {
    const { pdf } = createFakePdf([{ width: 612, height: 792 }]);

    await compressPdf(pdfFile(500 * KB), 300, vi.fn(), { document: pdf as any });

    const [output] = outputs;
    expect(output.addPage).toHaveBeenCalledWith([612, 792]);
    expect(output.drawImage).toHaveBeenCalledWith(expect.anything(), {
      x: 0,
      y: 0,
      width: 612,
      height: 792,
    });
  });

  it("draws form fields into the page images and releases each page after use", async () => {
    const { pdf, pageProxies } = createFakePdf([{}, {}]);

    await compressPdf(pdfFile(100 * KB), 30, vi.fn(), { document: pdf as any });

    for (const page of pageProxies) {
      expect(page.render).toHaveBeenCalledWith(expect.objectContaining({ annotationMode: 1 }));
      expect(page.cleanup).toHaveBeenCalledTimes(1);
    }
  });

  it("starts at a lower resolution for aggressive targets", async () => {
    const { pdf, renders } = createFakePdf([{}]);

    await compressPdf(pdfFile(100 * KB), 5, vi.fn(), { targetRatio: 0.1, document: pdf as any });

    expect(renders[0].scale).toBe(0.85);
  });

  it("uses more resolution when the target leaves room at full quality", async () => {
    const { pdf, renders } = createFakePdf([{}]);

    await compressPdf(pdfFile(10_000 * KB), 7_000, vi.fn(), {
      targetRatio: 0.7,
      document: pdf as any,
    });

    expect(renders.at(-1)?.scale).toBe(2.4);
  });

  it("samples a long document, then renders every page once when the sample is accurate", async () => {
    const { pdf, renders } = createFakePdf(Array.from({ length: 40 }, () => ({})));

    await compressPdf(pdfFile(4_000 * KB), 400, vi.fn(), {
      targetRatio: 0.1,
      document: pdf as any,
    });

    const sampled = renders.slice(0, renders.length - 40).map((render) => render.pageNumber);
    expect(new Set(sampled)).toEqual(new Set(pickSamplePages(40)));
    expect(renders.slice(-40).map((render) => render.pageNumber)).toEqual(
      Array.from({ length: 40 }, (_, index) => index + 1),
    );
    expect(outputs).toHaveLength(1);
  });

  it("corrects the size when the sampled pages misjudge the document", async () => {
    const samplePages = new Set(pickSamplePages(20));
    // Pages left out of the sample hold twice the detail, so the first pass overshoots.
    const { pdf } = createFakePdf(
      Array.from({ length: 20 }, (_, index) => ({
        density: samplePages.has(index + 1) ? 1 : 2,
      })),
    );
    const progress: number[] = [];

    const result = await compressPdf(
      pdfFile(2_000 * KB),
      200,
      (percent) => progress.push(percent),
      { targetRatio: 0.1, document: pdf as any },
    );

    expect(outputs.length).toBeGreaterThan(1);
    const [firstPass] = await Promise.all(
      outputs.map((output) => output.save.mock.results[0].value),
    );
    expect(firstPass.length).toBeGreaterThan(200 * KB);
    expect(result.length).toBeLessThanOrEqual(200 * KB);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(100);
  });

  it("keeps the earlier result when a fine-tuning pass fails", async () => {
    const samplePages = new Set(pickSamplePages(20));
    const { pdf } = createFakePdf(
      Array.from({ length: 20 }, (_, index) => ({
        density: samplePages.has(index + 1) ? 1 : 2,
      })),
    );
    const createWorking = mocks.createPdf.getMockImplementation();
    mocks.createPdf
      .mockImplementationOnce(createWorking as any)
      .mockRejectedValueOnce(new RangeError("Array buffer allocation failed"));

    const result = await compressPdf(pdfFile(2_000 * KB), 200, vi.fn(), {
      targetRatio: 0.1,
      document: pdf as any,
    });

    expect(result).toBe(await outputs[0].save.mock.results[0].value);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("keeping the earlier result"),
      expect.any(RangeError),
    );
  });

  it("keeps the earlier result when choosing new settings fails", async () => {
    const samplePages = new Set(pickSamplePages(20));
    // Unsampled pages are so busy that the correction needs a smaller scale,
    // which means sampling again.
    const { pdf, renders } = createFakePdf(
      Array.from({ length: 20 }, (_, index) => ({
        density: samplePages.has(index + 1) ? 1 : 20,
      })),
    );
    const createWorking = mocks.createPdf.getMockImplementation() as () => Promise<any>;
    mocks.createPdf.mockImplementationOnce(async () => {
      const output = await createWorking();
      const save = output.save;
      output.save = vi.fn(async () => {
        const saved = await save();
        // From here on the browser can no longer encode images.
        canvas.toBlob.mockImplementation((callback: (blob: Blob | null) => void) => callback(null));
        return saved;
      });
      return output;
    });

    const result = await compressPdf(pdfFile(2_000 * KB), 200, vi.fn(), {
      targetRatio: 0.1,
      document: pdf as any,
    });

    expect(result).toBe(await outputs[0].save.mock.results[0].value);
    expect(renders.at(-1)?.scale).toBeLessThan(0.85);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("keeping the earlier result"),
      expect.any(UserFacingError),
    );
  });

  it("returns the smallest possible result when the target cannot be reached", async () => {
    const { pdf, renders } = createFakePdf([{}, {}, {}]);

    // Smaller than pdf-lib's own overhead for three pages.
    const result = await compressPdf(pdfFile(100 * KB), 1, vi.fn(), { document: pdf as any });

    expect(result.length).toBeGreaterThan(KB);
    expect(renders.at(-1)?.scale).toBe(0.2);
    expect(outputs).toHaveLength(1);
  });

  it("renders very large pages within the browser's canvas limit", async () => {
    const { pdf } = createFakePdf([{ width: 10_000, height: 10_000, density: 0.001 }]);

    await compressPdf(pdfFile(1_000 * KB), 500, vi.fn(), { document: pdf as any });

    expect(canvas.largestArea).toBeLessThanOrEqual(16_777_216);
    expect(canvas.largestArea).toBeGreaterThan(16_000_000);
  });

  it("explains in plain words when the browser cannot encode a page", async () => {
    const { pdf } = createFakePdf([{}]);
    canvas.toBlob.mockImplementation((callback: (blob: Blob | null) => void) => callback(null));

    const attempt = compressPdf(pdfFile(100 * KB), 10, vi.fn(), { document: pdf as any });

    await expect(attempt).rejects.toBeInstanceOf(UserFacingError);
    await expect(attempt).rejects.toThrow("Your browser could not encode page 1.");
  });

  it("explains in plain words when the browser has no 2D canvas", async () => {
    vi.restoreAllMocks();
    installFakeCanvas({ context: null });
    const { pdf } = createFakePdf([{}]);

    await expect(
      compressPdf(pdfFile(100 * KB), 10, vi.fn(), { document: pdf as any }),
    ).rejects.toThrow(
      new UserFacingError(
        "Your browser could not create the drawing surface needed to compress this PDF.",
      ),
    );
  });

  it("opens and then releases its own document when none is lent", async () => {
    const { pdf } = createFakePdf([{}]);
    mocks.loadProcessablePdfJsDocument.mockResolvedValue({ pdfDoc: pdf, restrictionOnly: false });
    const file = pdfFile(100 * KB);

    await compressPdf(file, 30, vi.fn());

    expect(mocks.loadProcessablePdfJsDocument).toHaveBeenCalledWith(file);
    expect(pdf.loadingTask.destroy).toHaveBeenCalledTimes(1);
  });

  it("releases its own document even when compression fails", async () => {
    const { pdf } = createFakePdf([{}]);
    mocks.loadProcessablePdfJsDocument.mockResolvedValue({ pdfDoc: pdf, restrictionOnly: false });
    mocks.createPdf.mockRejectedValue(new Error("pdf-lib failed"));
    pdf.loadingTask.destroy.mockRejectedValueOnce(new Error("worker already gone"));

    await expect(compressPdf(pdfFile(100 * KB), 30, vi.fn())).rejects.toThrow("pdf-lib failed");

    expect(pdf.loadingTask.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.logger.warn).toHaveBeenCalled();
  });

  it("leaves a lent document open for its owner", async () => {
    const { pdf } = createFakePdf([{}]);

    await compressPdf(pdfFile(100 * KB), 30, vi.fn(), { document: pdf as any });

    expect(mocks.loadProcessablePdfJsDocument).not.toHaveBeenCalled();
    expect(pdf.loadingTask.destroy).not.toHaveBeenCalled();
  });

  it("refuses a document without pages", async () => {
    const { pdf } = createFakePdf([]);

    await expect(
      compressPdf(pdfFile(100 * KB), 30, vi.fn(), { document: pdf as any }),
    ).rejects.toThrow(new UserFacingError("This PDF has no pages to compress."));
  });
});

describe("compression planning helpers", () => {
  // Estimated sizes that grow in step with quality: 1,000 bytes per unit of quality.
  const totals = [50, 150, 300, 450, 600, 750, 850, 950];

  it("spreads sample pages evenly and uses every page of a short document", () => {
    expect(pickSamplePages(5)).toEqual([1, 2, 3, 4, 5]);
    expect(pickSamplePages(40)).toEqual([3, 8, 13, 18, 23, 28, 33, 38]);
  });

  it("finds the highest quality that fits, interpolating between measured steps", () => {
    expect(solveQuality(totals, 375)).toBeCloseTo(0.375);
    expect(solveQuality(totals, 2_000)).toBe(0.95);
    expect(solveQuality(totals, 40)).toBeNull();
  });

  it("estimates the size at any quality", () => {
    expect(estimateSize(totals, 0.375)).toBeCloseTo(375);
    expect(estimateSize(totals, 0.01)).toBe(50);
    expect(estimateSize(totals, 1)).toBe(950);
  });
});
