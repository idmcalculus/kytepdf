import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadProcessablePdfJsDocument: vi.fn(),
}));

vi.mock("../../utils/pdfSecurity.ts", () => ({
  loadProcessablePdfJsDocument: mocks.loadProcessablePdfJsDocument,
}));

import { rasterizePdfPages, rasterizePdfPagesStream } from "../../utils/pageRasterizer";

interface FakeCanvas {
  width: number;
  height: number;
  /** Size the canvas had when it was encoded, so tests can check it after it is zeroed. */
  encodedSize: string | null;
  getContext: ReturnType<typeof vi.fn>;
  toBlob: ReturnType<typeof vi.fn>;
}

interface CanvasOptions {
  context?: object | null;
  /** When true, toBlob hands back null as a browser does when encoding fails. */
  encodeFails?: boolean;
}

/**
 * Canvases that encode to PNG bytes naming their own size, which lets a test
 * tell which render produced which output.
 */
function installFakeCanvases(options: CanvasOptions = {}) {
  const canvases: FakeCanvas[] = [];
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
    if (tagName !== "canvas") return createElement(tagName);
    const canvas: FakeCanvas = {
      width: 0,
      height: 0,
      encodedSize: null,
      getContext: vi.fn(() =>
        options.context === undefined ? { kind: "2d-context" } : options.context,
      ),
      toBlob: vi.fn((callback: (blob: Blob | null) => void, type: string) => {
        if (options.encodeFails) {
          callback(null);
          return;
        }
        canvas.encodedSize = `${canvas.width}x${canvas.height}`;
        const bytes = new TextEncoder().encode(`${type}:${canvas.encodedSize}`);
        callback({ arrayBuffer: () => Promise.resolve(bytes.buffer) } as Blob);
      }),
    };
    canvases.push(canvas);
    return canvas;
  }) as typeof document.createElement);
  return canvases;
}

interface FakePageSpec {
  width: number;
  height: number;
  renderError?: Error;
  /** Leave out the optional cleanup hook that older pdf.js pages lack. */
  noCleanup?: boolean;
}

function installFakePdf(pages: FakePageSpec[], options: { noDestroy?: boolean } = {}) {
  const renders: Array<{ pageNumber: number; viewport: any; canvas: any; canvasContext: any }> = [];
  const pageProxies: any[] = [];
  const pdfDoc: any = {
    numPages: pages.length,
    getPage: vi.fn(async (pageNumber: number) => {
      const spec = pages[pageNumber - 1];
      const page: any = {
        getViewport: vi.fn(({ scale }: { scale: number }) => ({
          width: spec.width * scale,
          height: spec.height * scale,
          scale,
        })),
        render: vi.fn((params: any) => {
          renders.push({ pageNumber, ...params });
          return {
            promise: spec.renderError ? Promise.reject(spec.renderError) : Promise.resolve(),
          };
        }),
      };
      if (!spec.noCleanup) page.cleanup = vi.fn();
      pageProxies.push(page);
      return page;
    }),
  };
  if (!options.noDestroy) pdfDoc.destroy = vi.fn().mockResolvedValue(undefined);
  mocks.loadProcessablePdfJsDocument.mockResolvedValue({ pdfDoc });
  return { pdfDoc, renders, pageProxies };
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("rasterizePdfPagesStream", () => {
  beforeEach(() => {
    mocks.loadProcessablePdfJsDocument.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders each requested page once, in page order, skipping invalid and missing pages", async () => {
    const canvases = installFakeCanvases();
    const { pdfDoc } = installFakePdf([
      { width: 100, height: 100 },
      { width: 100, height: 100 },
      { width: 100, height: 100 },
    ]);

    const pages = await rasterizePdfPages(new Uint8Array([1, 2, 3]), [
      3,
      1,
      3,
      0,
      -2,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      9,
      1,
    ]);

    expect(pages.map((p) => p.page)).toEqual([1, 3]);
    expect(pdfDoc.getPage.mock.calls.map(([n]: [number]) => n)).toEqual([1, 3]);
    expect(canvases).toHaveLength(2);
    expect(pdfDoc.destroy).toHaveBeenCalledTimes(1);
  });

  it("returns the PNG bytes and pixel size of each rendered page", async () => {
    installFakeCanvases();
    installFakePdf([
      { width: 612, height: 792 },
      { width: 3000, height: 1500 },
    ]);

    const pages = await rasterizePdfPages(new Uint8Array([1]), [1, 2]);

    // A Letter page is small, so it is rendered at the 2x cap: 1224 x 1584.
    expect(pages[0]).toMatchObject({ page: 1, width: 1224, height: 1584 });
    expect(decode(pages[0].png)).toBe("image/png:1224x1584");
    // A wide drawing is scaled down until its long edge is 2000 px.
    expect(pages[1]).toMatchObject({ page: 2, width: 2000, height: 1000 });
    expect(decode(pages[1].png)).toBe("image/png:2000x1000");
  });

  it("caps the long edge at a custom maxEdgePx and rounds pixel sizes up", async () => {
    installFakeCanvases();
    const { renders } = installFakePdf([{ width: 612, height: 792 }]);

    const [page] = await rasterizePdfPages(new Uint8Array([1]), [1], 500);

    expect(renders[0].viewport.scale).toBeCloseTo(500 / 792, 10);
    expect(page.height).toBe(500);
    // 612 * 500 / 792 = 386.36..., so the canvas needs 387 columns.
    expect(page.width).toBe(387);
  });

  it("ignores fractional page numbers, which pdf.js cannot load", async () => {
    installFakeCanvases();
    const { pdfDoc } = installFakePdf([
      { width: 100, height: 100 },
      { width: 100, height: 100 },
    ]);

    const pages = await rasterizePdfPages(new Uint8Array([1]), [1.5, 2]);

    expect(pages.map((p) => p.page)).toEqual([2]);
    expect(pdfDoc.getPage.mock.calls.map(([n]: [number]) => n)).toEqual([2]);
  });

  it("never renders past maxEdgePx, even for poster-sized pages", async () => {
    installFakeCanvases();
    // 10000 pt is over 2.5 m: fitting it to 2000 px means a scale of 0.2.
    const { renders } = installFakePdf([{ width: 10000, height: 5000 }]);

    const [page] = await rasterizePdfPages(new Uint8Array([1]), [1]);

    expect(renders[0].viewport.scale).toBeCloseTo(0.2, 10);
    expect(page).toMatchObject({ width: 2000, height: 1000 });
  });

  it("passes the canvas and its 2D context to pdf.js and frees the canvas after encoding", async () => {
    const canvases = installFakeCanvases();
    const { renders, pageProxies } = installFakePdf([{ width: 100, height: 200 }]);

    const [page] = await rasterizePdfPages(new Uint8Array([1]), [1]);

    expect(renders).toHaveLength(1);
    expect(renders[0].canvas).toBe(canvases[0]);
    expect(renders[0].canvasContext).toEqual({ kind: "2d-context" });
    expect(canvases[0].getContext).toHaveBeenCalledWith("2d", { willReadFrequently: false });
    expect(canvases[0].toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
    // The PNG was taken at full size, then the backing store was dropped.
    expect(canvases[0].encodedSize).toBe("200x400");
    expect(page).toMatchObject({ width: 200, height: 400 });
    expect(canvases[0].width).toBe(0);
    expect(canvases[0].height).toBe(0);
    expect(pageProxies[0].cleanup).toHaveBeenCalledTimes(1);
  });

  it("hands pdf.js a copy of the input bytes so the caller's buffer survives", async () => {
    installFakeCanvases();
    installFakePdf([{ width: 100, height: 100 }]);
    const input = new Uint8Array([7, 8, 9]);

    await rasterizePdfPages(input, [1]);

    const [passed] = mocks.loadProcessablePdfJsDocument.mock.calls[0];
    expect(passed).not.toBe(input);
    expect(Array.from(passed as Uint8Array)).toEqual([7, 8, 9]);
  });

  it("does not open the document when no requested page is valid", async () => {
    installFakeCanvases();

    await expect(rasterizePdfPages(new Uint8Array([1]), [])).resolves.toEqual([]);
    await expect(rasterizePdfPages(new Uint8Array([1]), [0, -1, Number.NaN])).resolves.toEqual([]);
    expect(mocks.loadProcessablePdfJsDocument).not.toHaveBeenCalled();
  });

  it("yields one page at a time so a caller can stop early, and still destroys the document", async () => {
    installFakeCanvases();
    const { pdfDoc, renders } = installFakePdf([
      { width: 100, height: 100 },
      { width: 100, height: 100 },
      { width: 100, height: 100 },
    ]);

    const seen: number[] = [];
    for await (const raster of rasterizePdfPagesStream(new Uint8Array([1]), [1, 2, 3])) {
      seen.push(raster.page);
      // Only the page being handed over has been rendered so far.
      expect(renders).toHaveLength(seen.length);
      if (raster.page === 2) break;
    }

    expect(seen).toEqual([1, 2]);
    expect(pdfDoc.getPage).toHaveBeenCalledTimes(2);
    expect(pdfDoc.destroy).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error when the canvas has no 2D context, and destroys the document", async () => {
    installFakeCanvases({ context: null });
    const { pdfDoc, renders } = installFakePdf([{ width: 100, height: 100 }]);

    await expect(rasterizePdfPages(new Uint8Array([1]), [1])).rejects.toThrow(
      "Canvas 2D context unavailable for OCR rasterization.",
    );
    expect(renders).toHaveLength(0);
    expect(pdfDoc.destroy).toHaveBeenCalledTimes(1);
  });

  it("rejects when PNG encoding fails, after freeing the canvas, page and document", async () => {
    const canvases = installFakeCanvases({ encodeFails: true });
    const { pdfDoc, pageProxies } = installFakePdf([{ width: 100, height: 100 }]);

    await expect(rasterizePdfPages(new Uint8Array([1]), [1])).rejects.toThrow(
      "Failed to encode page as PNG.",
    );
    expect(canvases[0].width).toBe(0);
    expect(canvases[0].height).toBe(0);
    expect(pageProxies[0].cleanup).toHaveBeenCalledTimes(1);
    expect(pdfDoc.destroy).toHaveBeenCalledTimes(1);
  });

  it("frees resources when pdf.js fails to render a page, and stops there", async () => {
    const canvases = installFakeCanvases();
    const { pdfDoc, pageProxies } = installFakePdf([
      { width: 100, height: 100, renderError: new Error("bad content stream") },
      { width: 100, height: 100 },
    ]);

    await expect(rasterizePdfPages(new Uint8Array([1]), [1, 2])).rejects.toThrow(
      "bad content stream",
    );
    expect(canvases[0].toBlob).not.toHaveBeenCalled();
    expect(canvases[0].width).toBe(0);
    expect(pageProxies[0].cleanup).toHaveBeenCalledTimes(1);
    expect(pdfDoc.getPage).toHaveBeenCalledTimes(1);
    expect(pdfDoc.destroy).toHaveBeenCalledTimes(1);
  });

  it("works with documents and pages that have no cleanup or destroy hooks", async () => {
    installFakeCanvases();
    installFakePdf([{ width: 100, height: 100, noCleanup: true }], { noDestroy: true });

    const pages = await rasterizePdfPages(new Uint8Array([1]), [1]);

    expect(pages).toHaveLength(1);
    expect(pages[0].page).toBe(1);
  });

  it("propagates a failure to open the document", async () => {
    mocks.loadProcessablePdfJsDocument.mockRejectedValue(new Error("password required"));

    await expect(rasterizePdfPages(new Uint8Array([1]), [1])).rejects.toThrow("password required");
  });
});
