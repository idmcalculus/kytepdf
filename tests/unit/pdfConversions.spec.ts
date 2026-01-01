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
  PDFDocument: {
    create: vi.fn().mockResolvedValue({
      addPage: vi.fn().mockReturnValue({
        drawImage: vi.fn(),
      }),
      embedPng: vi.fn().mockResolvedValue({
        scale: vi.fn().mockReturnValue({ width: 100, height: 100 }),
      }),
      embedJpg: vi.fn().mockResolvedValue({
        scale: vi.fn().mockReturnValue({ width: 100, height: 100 }),
      }),
      save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }),
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

  describe("convertImagesToPdf", () => {
    it("should convert an array of images to a single PDF Uint8Array", async () => {
      const { convertImagesToPdf } = await import("../../utils/pdfEngine");
      
      const mockImages = [
        new File(["data1"], "img1.png", { type: "image/png" }),
        new File(["data2"], "img2.jpg", { type: "image/jpeg" }),
      ];

      const pdfBytes = await convertImagesToPdf(mockImages);

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(0);
    });
  });
});
