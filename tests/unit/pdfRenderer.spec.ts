import { beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error
import { loadPdf, renderPage } from "../../utils/pdfRenderer";

// Mock pdfConfig
const mockGetPage = vi.fn();
const mockRender = vi.fn().mockReturnValue({ promise: Promise.resolve() });
const mockPdfProxy = {
  getPage: mockGetPage,
  numPages: 5,
};

vi.mock("../../utils/pdfConfig", () => ({
  pdfjsLib: {
    getDocument: vi.fn(() => ({
      promise: Promise.resolve(mockPdfProxy),
    })),
  },
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
});
