import { loadProcessablePdfJsDocument } from "./pdfSecurity.ts";

export type PdfPreviewTargets = {
  canvas: HTMLCanvasElement;
  pageIndicator?: HTMLElement | null;
  prevButton?: HTMLButtonElement | null;
  nextButton?: HTMLButtonElement | null;
  scale?: number;
  cacheSize?: number;
  onPageChange?: (pageNum: number, pageCount: number) => void;
};

export type PdfPreviewSource = File | Uint8Array | ArrayBuffer;

type RenderPdfPageOptions = {
  pdfDoc: any | null;
  pageNum: number;
  canvas: HTMLCanvasElement;
  scale: number;
};

const normalizePdfSource = async (source: PdfPreviewSource): Promise<Uint8Array> => {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  const buffer = await source.arrayBuffer();
  return new Uint8Array(buffer);
};

export const loadPdfDocument = async (source: PdfPreviewSource) => {
  const data = await normalizePdfSource(source);
  const { pdfDoc } = await loadProcessablePdfJsDocument(data);
  return pdfDoc;
};

export const renderPdfPageToCanvas = async ({
  pdfDoc,
  pageNum,
  canvas,
  scale,
}: RenderPdfPageOptions) => {
  if (!pdfDoc) return false;
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const context = canvas.getContext("2d");
  if (!context) return false;

  canvas.height = viewport.height;
  canvas.width = viewport.width;
  await page.render({ canvasContext: context as any, viewport, canvas }).promise;
  return true;
};

export type PdfPreviewErrorContext = "preview" | "document";

export const PDF_PREVIEW_LOADING_MESSAGE = "Loading pages...";

export const getPdfPreviewErrorMessage = (context: PdfPreviewErrorContext) => {
  if (context === "preview") {
    return "Could not load PDF preview. The file might be corrupted, protected, or too complex for the browser.";
  }
  return "Could not load PDF. Please ensure it's a valid PDF file and not password protected.";
};

export const setPreviewLoadingState = (
  container: HTMLElement,
  message = PDF_PREVIEW_LOADING_MESSAGE,
) => {
  container.setAttribute("aria-busy", "true");
  container.innerHTML = "";
  const text = document.createElement("p");
  text.style.gridColumn = "1 / -1";
  text.style.textAlign = "center";
  text.textContent = message;
  container.appendChild(text);
};

export const clearPreviewLoadingState = (container: HTMLElement) => {
  container.removeAttribute("aria-busy");
};

type PdfThumbnailGridOptions = {
  container: HTMLElement;
  pdfDoc: any;
  scale?: number;
  root?: Element | null;
  rootMargin?: string;
  threshold?: number;
};

type ThumbnailEntry = {
  pageNum: number;
  canvas: HTMLCanvasElement;
};

export class PdfThumbnailGridController {
  private renderedPages = new Set<number>();
  private inFlight = new Set<number>();
  private entries = new WeakMap<Element, ThumbnailEntry>();
  private observer: IntersectionObserver | null = null;
  private queue: Promise<void> = Promise.resolve();
  private token = 0;
  private scale: number;

  constructor(private options: PdfThumbnailGridOptions) {
    this.scale = options.scale ?? 0.3;
    if (typeof IntersectionObserver !== "undefined") {
      this.observer = new IntersectionObserver(this.handleIntersect, {
        root: options.root ?? null,
        rootMargin: options.rootMargin ?? "200px 0px",
        threshold: options.threshold ?? 0.1,
      });
    }
  }

  observe(target: Element, pageNum: number, canvas: HTMLCanvasElement) {
    if (this.renderedPages.has(pageNum)) return;
    this.entries.set(target, { pageNum, canvas });
    if (this.observer) {
      this.observer.observe(target);
    } else {
      this.enqueueRender(pageNum, canvas);
    }
  }

  destroy() {
    this.token += 1;
    this.observer?.disconnect();
    this.observer = null;
    this.renderedPages.clear();
    this.inFlight.clear();
  }

  private handleIntersect: IntersectionObserverCallback = (entries) => {
    if (!this.observer) return;
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const data = this.entries.get(entry.target);
      if (!data) return;
      this.observer?.unobserve(entry.target);
      this.enqueueRender(data.pageNum, data.canvas);
    });
  };

  private enqueueRender(pageNum: number, canvas: HTMLCanvasElement) {
    if (this.renderedPages.has(pageNum) || this.inFlight.has(pageNum)) return;
    const token = this.token;
    this.inFlight.add(pageNum);
    this.queue = this.queue
      .then(async () => {
        try {
          await this.waitForIdle();
          if (token !== this.token) return;
          const rendered = await renderPdfPageToCanvas({
            pdfDoc: this.options.pdfDoc,
            pageNum,
            canvas,
            scale: this.scale,
          });
          if (token !== this.token) return;
          if (rendered) this.renderedPages.add(pageNum);
        } catch {
          // Ignore thumbnail render errors; keep the rest of the grid usable.
        } finally {
          this.inFlight.delete(pageNum);
        }
      })
      .catch(() => {
        this.inFlight.delete(pageNum);
      });
  }

  private waitForIdle() {
    const requestIdle = (globalThis as any).requestIdleCallback as
      | ((cb: () => void, options?: { timeout: number }) => void)
      | undefined;
    if (typeof requestIdle === "function") {
      return new Promise<void>((resolve) => {
        requestIdle(() => resolve(), { timeout: 250 });
      });
    }
    return new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

export class PdfPreviewController {
  private pdfDoc: any | null = null;
  private pageNum = 1;
  private scale: number;
  private cacheSize: number;
  private pageCache = new Map<number, HTMLCanvasElement>();
  private renderToken = 0;
  private loadToken = 0;

  constructor(private targets: PdfPreviewTargets) {
    this.scale = targets.scale ?? 0.8;
    this.cacheSize = Math.max(0, targets.cacheSize ?? 3);
  }

  async load(source: PdfPreviewSource) {
    const loadId = ++this.loadToken;
    await this.destroy();

    const pdfDoc = await loadPdfDocument(source);
    if (loadId !== this.loadToken) {
      await pdfDoc.destroy?.();
      return;
    }

    this.pdfDoc = pdfDoc;
    this.pageNum = 1;
    await this.render(this.pageNum);
  }

  async render(pageNum: number) {
    if (!this.pdfDoc) return;
    if (pageNum < 1 || pageNum > this.pdfDoc.numPages) return;

    const renderId = ++this.renderToken;
    const pdfDoc = this.pdfDoc;
    const canvas = this.targets.canvas;
    const cachedCanvas = this.getCachedCanvas(pageNum);
    if (cachedCanvas) {
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = cachedCanvas.width;
      canvas.height = cachedCanvas.height;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(cachedCanvas, 0, 0);
      if (renderId !== this.renderToken) return;
      this.pageNum = pageNum;
      this.updateIndicator();
      this.updateNavButtons();
      this.targets.onPageChange?.(this.pageNum, this.pdfDoc.numPages);
      return;
    }

    const rendered = await renderPdfPageToCanvas({
      pdfDoc,
      pageNum,
      canvas,
      scale: this.scale,
    });
    if (!rendered) return;
    if (renderId !== this.renderToken) return;

    this.pageNum = pageNum;
    this.updateIndicator();
    this.updateNavButtons();
    this.targets.onPageChange?.(this.pageNum, this.pdfDoc.numPages);
    this.storeCachedCanvas(pageNum, canvas);
  }

  next() {
    void this.render(this.pageNum + 1);
  }

  prev() {
    void this.render(this.pageNum - 1);
  }

  async destroy() {
    this.renderToken++;
    const pdfDoc = this.pdfDoc;
    this.pdfDoc = null;
    this.pageNum = 1;
    this.pageCache.clear();
    if (pdfDoc?.destroy) {
      try {
        await pdfDoc.destroy();
      } catch {
        // Ignore cleanup failures; preview will reinitialize on next load.
      }
    }
  }

  private updateIndicator() {
    if (!this.targets.pageIndicator || !this.pdfDoc) return;
    this.targets.pageIndicator.textContent = `Page ${this.pageNum} of ${this.pdfDoc.numPages}`;
  }

  private updateNavButtons() {
    if (!this.pdfDoc) return;
    if (this.targets.prevButton) {
      this.targets.prevButton.disabled = this.pageNum <= 1;
    }
    if (this.targets.nextButton) {
      this.targets.nextButton.disabled = this.pageNum >= this.pdfDoc.numPages;
    }
  }

  private getCachedCanvas(pageNum: number) {
    if (this.cacheSize <= 0) return null;
    const cached = this.pageCache.get(pageNum);
    if (!cached) return null;
    this.pageCache.delete(pageNum);
    this.pageCache.set(pageNum, cached);
    return cached;
  }

  private storeCachedCanvas(pageNum: number, canvas: HTMLCanvasElement) {
    if (this.cacheSize <= 0) return;
    const copy = this.cloneCanvas(canvas);
    if (!copy) return;
    this.pageCache.delete(pageNum);
    this.pageCache.set(pageNum, copy);
    if (this.pageCache.size > this.cacheSize) {
      const firstKey = this.pageCache.keys().next().value;
      if (typeof firstKey === "number") {
        this.pageCache.delete(firstKey);
      }
    }
  }

  private cloneCanvas(canvas: HTMLCanvasElement) {
    if (canvas.width === 0 || canvas.height === 0) return null;
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext("2d");
    if (!context) return null;
    context.drawImage(canvas, 0, 0);
    return copy;
  }
}
