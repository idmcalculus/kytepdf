import { beforeEach, describe, expect, it, vi } from "vitest";

const pageMock = vi.hoisted(() => ({
  drawText: vi.fn(),
  drawRectangle: vi.fn(),
  drawLine: vi.fn(),
  drawImage: vi.fn(),
  getSize: vi.fn().mockReturnValue({ width: 600, height: 800 }),
}));

// Mock dependency modules before importing they are used
vi.mock("../../utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock pdfConfig
vi.mock("../../utils/pdfConfig", () => {
  return {
    pdfjsLib: {
      getDocument: vi.fn().mockReturnValue({
        promise: Promise.resolve({
          numPages: 1,
          getPage: vi.fn().mockResolvedValue({
            getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
            render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
          }),
        }),
      }),
    },
    PDFDocument: {
      create: vi.fn().mockResolvedValue({
        embedJpg: vi.fn().mockResolvedValue({}),
        addPage: vi.fn().mockReturnValue({
          drawImage: vi.fn(),
        }),
        save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      }),
      load: vi.fn().mockResolvedValue({
        getPages: vi.fn().mockReturnValue([pageMock]),
        embedFont: vi.fn().mockResolvedValue({}),
        embedPng: vi.fn().mockResolvedValue({}),
        embedJpg: vi.fn().mockResolvedValue({}),
        save: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
      }),
    },
    rgb: vi.fn().mockReturnValue({}),
    StandardFonts: {
      Helvetica: "Helvetica",
    },
  };
});

import { compressPdf } from "../../utils/pdfEngine";

describe("pdfEngine", () => {
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    vi.clearAllMocks();

    // Polyfill File/Blob.arrayBuffer for jsdom
    if (!File.prototype.arrayBuffer) {
      File.prototype.arrayBuffer = () => Promise.resolve(new ArrayBuffer(0));
    }
    if (!Blob.prototype.arrayBuffer) {
      Blob.prototype.arrayBuffer = () => Promise.resolve(new ArrayBuffer(0));
    }

    // Mock canvas methods - store original to avoid recursion
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      if (tagName === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: vi.fn().mockReturnValue({}),
          toBlob: vi.fn((cb) => cb(new Blob([""], { type: "image/jpeg" }))),
        } as any;
      }
      return originalCreateElement(tagName);
    });
  });

  it("should compress a PDF successfully", async () => {
    const mockFile = new File([""], "test.pdf", { type: "application/pdf" });
    const onProgress = vi.fn();

    const result = await compressPdf(mockFile, 100, onProgress);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(onProgress).toHaveBeenCalledWith(100, "Finalizing...");
  });

  it("should handle compression failure", async () => {
    const { PDFDocument } = await import("../../utils/pdfConfig");
    (PDFDocument.create as any).mockRejectedValueOnce(new Error("Failed to create PDF"));

    const mockFile = new File([""], "test.pdf", { type: "application/pdf" });
    const onProgress = vi.fn();

    await expect(compressPdf(mockFile, 100, onProgress)).rejects.toThrow("Failed to create PDF");
  });

  it("should call progress callback multiple times", async () => {
    const mockFile = new File([""], "test.pdf", { type: "application/pdf" });
    const onProgress = vi.fn();

    await compressPdf(mockFile, 100, onProgress);

    expect(onProgress).toHaveBeenCalled();
  });

  it("should handle file with arrayBuffer", async () => {
    const buffer = new ArrayBuffer(10);
    const mockFile = new File([buffer], "buffer.pdf", { type: "application/pdf" });
    const onProgress = vi.fn();

    const result = await compressPdf(mockFile, 100, onProgress);

    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("should embed text annotations into a PDF", async () => {
    const pdfData = new Uint8Array([1, 2, 3]);
    const annotations = [
      {
        id: "1",
        type: "text" as const,
        pageIndex: 0,
        x: 100,
        y: 100,
        content: "Hello PDF",
        style: { fontSize: 12, color: "#000000" },
      },
    ];

    const { embedTextAnnotations } = await import("../../utils/pdfEngine");
    const result = await embedTextAnnotations(pdfData, annotations);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toEqual(new Uint8Array([4, 5, 6])); // Value from mock
  });

  it("should embed highlight and line annotations into a PDF", async () => {
    const pdfData = new Uint8Array([1, 2, 3]);
    const annotations = [
      {
        id: "highlight-1",
        type: "highlight" as const,
        pageIndex: 0,
        x: 10,
        y: 20,
        width: 120,
        height: 24,
        style: { color: "#ffff00", opacity: 0.3 },
      },
      {
        id: "freehand-1",
        type: "freehand" as const,
        pageIndex: 0,
        x: 50,
        y: 60,
        points: [
          { x: 0, y: 0 },
          { x: 30, y: 10 },
          { x: 60, y: 20 },
        ],
        style: { color: "#111827", strokeWidth: 2, opacity: 1 },
      },
      {
        id: "strike-1",
        type: "strikethrough" as const,
        pageIndex: 0,
        x: 40,
        y: 100,
        width: 80,
        height: 12,
        style: { color: "#111827", strokeWidth: 2 },
      },
      {
        id: "underline-1",
        type: "underline" as const,
        pageIndex: 0,
        x: 40,
        y: 140,
        width: 90,
        height: 12,
        style: { color: "#111827", strokeWidth: 2 },
      },
    ];

    const { embedAllAnnotations } = await import("../../utils/pdfEngine");
    const result = await embedAllAnnotations(pdfData, annotations);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(pageMock.drawRectangle).toHaveBeenCalled();
    expect(pageMock.drawLine).toHaveBeenCalled();
  });
});
