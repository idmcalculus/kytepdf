import { beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error
import { loadPdf, renderPage } from "../../utils/pdfRenderer";

// Mock pdfConfig
const mockGetPage = vi.fn();
const mockRender = vi.fn().mockReturnValue({ promise: Promise.resolve() });
const securityMocks = vi.hoisted(() => ({
  loadProcessablePdfJsDocument: vi.fn(),
}));
const mockPdfProxy = {
  getPage: mockGetPage,
  numPages: 5,
};

vi.mock("../../utils/pdfSecurity", () => ({
  loadProcessablePdfJsDocument: securityMocks.loadProcessablePdfJsDocument,
}));

describe("pdfRenderer", () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    vi.clearAllMocks();
    canvas = document.createElement("canvas");

    mockGetPage.mockResolvedValue({
      getViewport: vi.fn().mockReturnValue({ width: 100, height: 200 }),
      render: mockRender,
    });
    securityMocks.loadProcessablePdfJsDocument.mockResolvedValue({ pdfDoc: mockPdfProxy });
  });

  it("should load a PDF document", async () => {
    const pdfData = new Uint8Array([1, 2, 3]);
    const pdf = await loadPdf(pdfData);
    expect(pdf).toBe(mockPdfProxy);
  });

  it("should render a page to canvas", async () => {
    await renderPage(mockPdfProxy, 1, canvas);

    expect(mockGetPage).toHaveBeenCalledWith(1);
    expect(mockRender).toHaveBeenCalled();
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(200);
  });

  it("propagates PDF load failures", async () => {
    securityMocks.loadProcessablePdfJsDocument.mockRejectedValueOnce(new Error("locked"));

    await expect(loadPdf(new Uint8Array([1]))).rejects.toThrow("locked");
  });

  it("propagates missing canvas context and render failures", async () => {
    vi.spyOn(canvas, "getContext").mockReturnValueOnce(null);
    await expect(renderPage(mockPdfProxy, 1, canvas)).rejects.toThrow("Canvas 2D context");

    mockGetPage.mockResolvedValueOnce({
      getViewport: vi.fn().mockReturnValue({ width: 20, height: 20 }),
      render: vi.fn(() => ({ promise: Promise.reject(new Error("render failed")) })),
    });
    await expect(renderPage(mockPdfProxy, 2, canvas)).rejects.toThrow("render failed");
  });
});
