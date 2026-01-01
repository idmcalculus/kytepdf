import { pdfjsLib } from "./pdfConfig.ts";

export type PdfPreviewTargets = {
  canvas: HTMLCanvasElement;
  pageIndicator?: HTMLElement | null;
  prevButton?: HTMLButtonElement | null;
  nextButton?: HTMLButtonElement | null;
  scale?: number;
};

export type PdfPreviewSource = File | Uint8Array | ArrayBuffer;

export class PdfPreviewController {
  private pdfDoc: any | null = null;
  private pageNum = 1;
  private scale: number;
  private renderToken = 0;
  private loadToken = 0;

  constructor(private targets: PdfPreviewTargets) {
    this.scale = targets.scale ?? 0.8;
  }

  async load(source: PdfPreviewSource) {
    const loadId = ++this.loadToken;
    await this.destroy();

    const data = await this.normalizeSource(source);
    const pdfDoc = await pdfjsLib.getDocument({ data }).promise;
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
    const page = await this.pdfDoc.getPage(pageNum);
    if (renderId !== this.renderToken) return;

    const canvas = this.targets.canvas;
    const context = canvas.getContext("2d");
    if (!context) return;

    const viewport = page.getViewport({ scale: this.scale });
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvasContext: context as any, viewport, canvas }).promise;
    if (renderId !== this.renderToken) return;

    this.pageNum = pageNum;
    this.updateIndicator();
    this.updateNavButtons();
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
    if (pdfDoc?.destroy) {
      try {
        await pdfDoc.destroy();
      } catch {
        // Ignore cleanup failures; preview will reinitialize on next load.
      }
    }
  }

  private async normalizeSource(source: PdfPreviewSource): Promise<Uint8Array> {
    if (source instanceof Uint8Array) return source;
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    const buffer = await source.arrayBuffer();
    return new Uint8Array(buffer);
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
}
