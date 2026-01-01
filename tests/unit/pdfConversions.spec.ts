import { describe, it, expect, vi, beforeEach } from "vitest";
// @ts-ignore
import { convertPdfToImages } from "../../utils/pdfEngine";

// Mock pdfConfig
const mockGetPage = vi.fn();
const mockRender = vi.fn().mockReturnValue({ promise: Promise.resolve() });
const mockPdfProxy = {
  getPage: mockGetPage,
  numPages: 2,
};

vi.mock("../../utils/pdfConfig", () => ({
  pdfjsLib: {
    getDocument: vi.fn(() => ({
      promise: Promise.resolve(mockPdfProxy),
    })),
  },
}));

describe("pdfConversions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    mockGetPage.mockResolvedValue({
      getViewport: vi.fn().mockReturnValue({ width: 100, height: 200 }),
      render: mockRender,
    });

    // Mock HTMLCanvasElement toBlob
    // @ts-ignore
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => {
      callback(new Blob(["mock-image-data"], { type: "image/png" }));
    });
  });

  describe("convertPdfToImages", () => {
    it("should convert all pages of a PDF to an array of blobs", async () => {
      const pdfData = new Uint8Array([1, 2, 3]);
      const images = await convertPdfToImages(pdfData, { format: "png", scale: 2.0 });

      expect(images.length).toBe(2);
      expect(images[0]).toBeInstanceOf(Blob);
      expect(mockGetPage).toHaveBeenCalledTimes(2);
      expect(mockRender).toHaveBeenCalledTimes(2);
    });
  });
});
