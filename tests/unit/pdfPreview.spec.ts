import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPreviewLoadingState,
  getPdfPreviewErrorMessage,
  loadPdfDocument,
  PdfPreviewController,
  PdfThumbnailGridController,
  renderPdfPageToCanvas,
  setPreviewLoadingState,
} from "../../utils/pdfPreview";

const pdfMocks = vi.hoisted(() => {
  const render = vi.fn().mockReturnValue({ promise: Promise.resolve() });
  const getViewport = vi.fn().mockReturnValue({ width: 200, height: 100 });
  const getPage = vi.fn().mockResolvedValue({ getViewport, render });
  const doc = { numPages: 3, getPage, destroy: vi.fn() };
  const getDocument = vi.fn().mockReturnValue({ promise: Promise.resolve(doc) });
  return { doc, getDocument, getPage, getViewport, render };
});

vi.mock("../../utils/pdfConfig", () => ({
  pdfjsLib: { getDocument: pdfMocks.getDocument },
}));

const createCanvas = () => {
  const canvas = document.createElement("canvas");
  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  };
  Object.defineProperty(canvas, "getContext", {
    configurable: true,
    value: vi.fn().mockReturnValue(context),
  });
  return canvas;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("PdfPreviewController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(pdfMocks.doc) });
  });

  it("loads and renders the first page with nav state", async () => {
    const canvas = createCanvas();
    const pageIndicator = document.createElement("span");
    const prevButton = document.createElement("button");
    const nextButton = document.createElement("button");
    const onPageChange = vi.fn();

    const controller = new PdfPreviewController({
      canvas,
      pageIndicator,
      prevButton,
      nextButton,
      scale: 0.5,
      onPageChange,
    });

    const source = new Uint8Array([1, 2, 3]);
    await controller.load(source);

    expect(pdfMocks.getDocument).toHaveBeenCalledWith({ data: source });
    expect(pdfMocks.getPage).toHaveBeenCalledWith(1);
    expect(pdfMocks.getViewport).toHaveBeenCalledWith({ scale: 0.5 });
    expect(pageIndicator.textContent).toBe("Page 1 of 3");
    expect(prevButton.disabled).toBe(true);
    expect(nextButton.disabled).toBe(false);
    expect(onPageChange).toHaveBeenCalledWith(1, 3);
  });

  it("renders a requested page and updates nav state", async () => {
    const canvas = createCanvas();
    const pageIndicator = document.createElement("span");
    const prevButton = document.createElement("button");
    const nextButton = document.createElement("button");
    const onPageChange = vi.fn();

    const controller = new PdfPreviewController({
      canvas,
      pageIndicator,
      prevButton,
      nextButton,
      onPageChange,
    });

    await controller.load(new Uint8Array([9, 8, 7]));
    await controller.render(3);

    expect(pageIndicator.textContent).toBe("Page 3 of 3");
    expect(prevButton.disabled).toBe(false);
    expect(nextButton.disabled).toBe(true);
    expect(onPageChange).toHaveBeenCalledWith(3, 3);
  });

  it("ignores invalid render requests and supports prev/next navigation", async () => {
    const canvas = createCanvas();
    const pageIndicator = document.createElement("span");
    const controller = new PdfPreviewController({ canvas, pageIndicator });

    await controller.render(1);
    expect(pdfMocks.getPage).not.toHaveBeenCalled();

    await controller.load(new Uint8Array([1]));
    pdfMocks.getPage.mockClear();

    await controller.render(0);
    await controller.render(4);
    expect(pdfMocks.getPage).not.toHaveBeenCalled();

    controller.next();
    await flush();
    expect(pageIndicator.textContent).toBe("Page 2 of 3");

    controller.prev();
    await flush();
    expect(pageIndicator.textContent).toBe("Page 1 of 3");
  });

  it("uses cached pages, evicts old cache entries, and handles destroy failures", async () => {
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === "canvas") {
        Object.defineProperty(element, "getContext", {
          configurable: true,
          value: vi.fn().mockReturnValue({ clearRect: vi.fn(), drawImage: vi.fn() }),
        });
      }
      return element;
    });

    const canvas = createCanvas();
    const pageIndicator = document.createElement("span");
    const controller = new PdfPreviewController({ cacheSize: 1, canvas, pageIndicator });

    await controller.load(new Uint8Array([1]));
    await controller.render(1);
    await controller.render(2);
    await controller.render(1);

    expect(pdfMocks.getPage).toHaveBeenCalledWith(1);
    expect(pdfMocks.getPage).toHaveBeenCalledWith(2);

    pdfMocks.doc.destroy.mockImplementationOnce(() => {
      throw new Error("destroy failed");
    });
    await expect(controller.destroy()).resolves.toBeUndefined();

    vi.mocked(document.createElement).mockRestore();
  });

  it("destroys stale documents when overlapping loads resolve out of order", async () => {
    const canvas = createCanvas();
    const staleDoc = { ...pdfMocks.doc, destroy: vi.fn() };
    const freshDoc = { ...pdfMocks.doc, destroy: vi.fn() };
    let resolveStale: (doc: typeof staleDoc) => void = () => {};
    pdfMocks.getDocument
      .mockReturnValueOnce({
        promise: new Promise((resolve) => {
          resolveStale = resolve;
        }),
      })
      .mockReturnValueOnce({ promise: Promise.resolve(freshDoc) });
    const controller = new PdfPreviewController({ canvas });

    const firstLoad = controller.load(new Uint8Array([1]));
    const secondLoad = controller.load(new Uint8Array([2]));
    resolveStale(staleDoc);
    await Promise.all([firstLoad, secondLoad]);

    expect(staleDoc.destroy).toHaveBeenCalled();
    expect(freshDoc.destroy).not.toHaveBeenCalled();
  });
});

describe("pdfPreview helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(pdfMocks.doc) });
  });

  it("loads a document from bytes", async () => {
    const data = new Uint8Array([4, 5, 6]);
    const doc = await loadPdfDocument(data);

    expect(pdfMocks.getDocument).toHaveBeenCalledWith({ data });
    expect(doc).toBe(pdfMocks.doc);
  });

  it("loads a document from ArrayBuffer and File sources", async () => {
    const buffer = new ArrayBuffer(4);
    await loadPdfDocument(buffer);
    expect(pdfMocks.getDocument).toHaveBeenLastCalledWith({ data: new Uint8Array(buffer) });

    const file = new File([new Uint8Array([7, 8])], "file.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: vi.fn().mockResolvedValue(new Uint8Array([7, 8]).buffer),
    });
    await loadPdfDocument(file);
    expect(pdfMocks.getDocument).toHaveBeenLastCalledWith({
      data: new Uint8Array([7, 8]),
    });
  });

  it("renders a page to a canvas", async () => {
    const canvas = createCanvas();

    await renderPdfPageToCanvas({
      pdfDoc: pdfMocks.doc,
      pageNum: 2,
      canvas,
      scale: 0.3,
    });

    expect(pdfMocks.getPage).toHaveBeenCalledWith(2);
    expect(pdfMocks.getViewport).toHaveBeenCalledWith({ scale: 0.3 });
    expect(pdfMocks.render).toHaveBeenCalled();
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
  });

  it("returns false when rendering has no document or no canvas context", async () => {
    expect(
      await renderPdfPageToCanvas({
        canvas: createCanvas(),
        pageNum: 1,
        pdfDoc: null,
        scale: 1,
      }),
    ).toBe(false);

    const canvas = createCanvas();
    Object.defineProperty(canvas, "getContext", {
      configurable: true,
      value: vi.fn().mockReturnValue(null),
    });

    expect(
      await renderPdfPageToCanvas({
        canvas,
        pageNum: 1,
        pdfDoc: pdfMocks.doc,
        scale: 1,
      }),
    ).toBe(false);
  });

  it("sets and clears loading state and returns context-specific error messages", () => {
    const container = document.createElement("div");

    setPreviewLoadingState(container, "Please wait");
    expect(container.getAttribute("aria-busy")).toBe("true");
    expect(container.textContent).toBe("Please wait");

    clearPreviewLoadingState(container);
    expect(container.hasAttribute("aria-busy")).toBe(false);
    expect(getPdfPreviewErrorMessage("preview")).toContain("preview");
    expect(getPdfPreviewErrorMessage("document")).toContain("valid PDF");
  });
});

describe("PdfThumbnailGridController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(pdfMocks.doc) });
  });

  it("renders immediately without IntersectionObserver", async () => {
    const originalObserver = (globalThis as any).IntersectionObserver;
    (globalThis as any).IntersectionObserver = undefined;
    const originalIdle = (globalThis as any).requestIdleCallback;
    (globalThis as any).requestIdleCallback = (cb: () => void) => cb();

    const container = document.createElement("div");
    const controller = new PdfThumbnailGridController({
      container,
      pdfDoc: pdfMocks.doc,
      scale: 0.3,
    });
    const target = document.createElement("div");
    const canvas = createCanvas();
    target.appendChild(canvas);

    controller.observe(target, 1, canvas);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pdfMocks.getPage).toHaveBeenCalledWith(1);

    (globalThis as any).IntersectionObserver = originalObserver;
    (globalThis as any).requestIdleCallback = originalIdle;
  });

  it("renders intersecting thumbnails through IntersectionObserver and disconnects on destroy", async () => {
    const originalObserver = (globalThis as any).IntersectionObserver;
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    let callback: IntersectionObserverCallback = () => {};
    (globalThis as any).IntersectionObserver = vi.fn().mockImplementation(function (this: any, cb) {
      callback = cb;
      this.disconnect = disconnect;
      this.observe = observe;
      this.unobserve = unobserve;
    });
    const originalIdle = (globalThis as any).requestIdleCallback;
    (globalThis as any).requestIdleCallback = (cb: () => void) => cb();
    const target = document.createElement("div");
    const canvas = createCanvas();
    const controller = new PdfThumbnailGridController({
      container: document.createElement("div"),
      pdfDoc: pdfMocks.doc,
    });

    controller.observe(target, 2, canvas);
    callback(
      [
        { isIntersecting: false, target } as IntersectionObserverEntry,
        { isIntersecting: true, target } as IntersectionObserverEntry,
        {
          isIntersecting: true,
          target: document.createElement("div"),
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
    await flush();

    expect(observe).toHaveBeenCalledWith(target);
    expect(unobserve).toHaveBeenCalledWith(target);
    expect(pdfMocks.getPage).toHaveBeenCalledWith(2);

    controller.destroy();
    expect(disconnect).toHaveBeenCalled();

    (globalThis as any).IntersectionObserver = originalObserver;
    (globalThis as any).requestIdleCallback = originalIdle;
  });

  it("ignores duplicate and failed thumbnail renders", async () => {
    const originalObserver = (globalThis as any).IntersectionObserver;
    (globalThis as any).IntersectionObserver = undefined;
    const originalIdle = (globalThis as any).requestIdleCallback;
    (globalThis as any).requestIdleCallback = undefined;
    pdfMocks.getPage.mockRejectedValueOnce(new Error("render failed"));
    const controller = new PdfThumbnailGridController({
      container: document.createElement("div"),
      pdfDoc: pdfMocks.doc,
    });
    const target = document.createElement("div");
    const canvas = createCanvas();

    controller.observe(target, 1, canvas);
    controller.observe(target, 1, canvas);
    await flush();
    await flush();

    expect(pdfMocks.getPage).toHaveBeenCalledTimes(1);

    (globalThis as any).IntersectionObserver = originalObserver;
    (globalThis as any).requestIdleCallback = originalIdle;
  });
});
