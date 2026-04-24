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
    degrees: vi.fn((value) => ({ value })),
    rgb: vi.fn().mockReturnValue({}),
    StandardFonts: {
      Courier: "Courier",
      Helvetica: "Helvetica",
      TimesRoman: "Times-Roman",
    },
  };
});

import {
  compressPdf,
  convertImagesToPdf,
  convertPdfToImages,
  embedAllAnnotations,
  embedShapeAnnotations,
  embedTextAnnotations,
} from "../../utils/pdfEngine";

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

    const result = await embedAllAnnotations(pdfData, annotations);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(pageMock.drawRectangle).toHaveBeenCalled();
    expect(pageMock.drawLine).toHaveBeenCalled();
  });

  it("should embed text, rectangles, and cached images through the unified annotation path", async () => {
    const { PDFDocument, StandardFonts } = await import("../../utils/pdfConfig");
    const page = {
      drawImage: vi.fn(),
      drawLine: vi.fn(),
      drawRectangle: vi.fn(),
      drawText: vi.fn(),
      getSize: vi.fn().mockReturnValue({ width: 612, height: 792 }),
    };
    const doc = {
      embedFont: vi.fn().mockResolvedValue({ font: true }),
      embedJpg: vi.fn().mockResolvedValue({ image: "jpg" }),
      embedPng: vi.fn().mockResolvedValue({ image: "png" }),
      getPages: vi.fn().mockReturnValue([page]),
      save: vi.fn().mockResolvedValue(new Uint8Array([7, 8, 9])),
    };
    vi.mocked(PDFDocument.load).mockResolvedValueOnce(doc as any);
    global.fetch = vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
    }) as any;

    const pngData = "data:image/png;base64,abc";
    const jpgData = "data:image/jpeg;base64,def";
    const result = await embedAllAnnotations(new Uint8Array([1]), [
      {
        content: "Times",
        id: "text-times",
        pageIndex: 0,
        style: { color: "#zzzzzz", font: "Times-Roman", fontSize: 18 },
        type: "text",
        x: 10,
        y: 20,
      },
      {
        content: "Courier",
        id: "text-courier",
        pageIndex: 0,
        style: { color: "#112233", font: "Courier", fontSize: 12 },
        type: "text",
        x: 20,
        y: 30,
      },
      {
        content: "Default",
        id: "text-default",
        pageIndex: 0,
        type: "text",
        x: 30,
        y: 40,
      },
      {
        height: 20,
        id: "rect",
        pageIndex: 0,
        style: { color: "#abcdef", opacity: 0.4, strokeWidth: 3 },
        type: "rectangle",
        width: 40,
        x: 50,
        y: 60,
      },
      {
        content: pngData,
        height: 30,
        id: "image-png-1",
        pageIndex: 0,
        style: { opacity: 0.8, rotation: 15 },
        type: "image",
        width: 30,
        x: 70,
        y: 80,
      },
      {
        content: pngData,
        height: 30,
        id: "image-png-2",
        pageIndex: 0,
        type: "image",
        width: 30,
        x: 75,
        y: 85,
      },
      {
        content: jpgData,
        height: 30,
        id: "image-jpg",
        pageIndex: 0,
        type: "image",
        width: 30,
        x: 90,
        y: 100,
      },
      {
        content: "Skipped",
        id: "missing-page",
        pageIndex: 99,
        type: "text",
        x: 1,
        y: 1,
      },
    ]);

    expect(result).toEqual(new Uint8Array([7, 8, 9]));
    expect(doc.embedFont).toHaveBeenCalledWith(StandardFonts.TimesRoman);
    expect(doc.embedFont).toHaveBeenCalledWith(StandardFonts.Courier);
    expect(doc.embedFont).toHaveBeenCalledWith(StandardFonts.Helvetica);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(doc.embedPng).toHaveBeenCalledTimes(1);
    expect(doc.embedJpg).toHaveBeenCalledTimes(1);
    expect(page.drawText).toHaveBeenCalledTimes(3);
    expect(page.drawRectangle).toHaveBeenCalledTimes(1);
    expect(page.drawImage).toHaveBeenCalledTimes(3);
  });

  it("should embed rectangle-only annotations and ignore other annotation types", async () => {
    const result = await embedShapeAnnotations(new Uint8Array([1]), [
      {
        id: "text",
        pageIndex: 0,
        type: "text",
        x: 1,
        y: 1,
      },
      {
        height: 25,
        id: "rect",
        pageIndex: 0,
        style: { color: "#ffffff", strokeWidth: 2 },
        type: "rectangle",
        width: 75,
        x: 10,
        y: 20,
      },
      {
        height: 25,
        id: "missing",
        pageIndex: 99,
        type: "rectangle",
        width: 75,
        x: 10,
        y: 20,
      },
    ]);

    expect(result).toEqual(new Uint8Array([4, 5, 6]));
    expect(pageMock.drawRectangle).toHaveBeenCalled();
  });

  it("should propagate annotation embedding failures", async () => {
    const { PDFDocument } = await import("../../utils/pdfConfig");
    vi.mocked(PDFDocument.load).mockRejectedValueOnce(new Error("load failed"));
    await expect(embedAllAnnotations(new Uint8Array([1]), [])).rejects.toThrow("load failed");

    vi.mocked(PDFDocument.load).mockRejectedValueOnce(new Error("text failed"));
    await expect(embedTextAnnotations(new Uint8Array([1]), [])).rejects.toThrow("text failed");

    vi.mocked(PDFDocument.load).mockRejectedValueOnce(new Error("shape failed"));
    await expect(embedShapeAnnotations(new Uint8Array([1]), [])).rejects.toThrow("shape failed");
  });

  it("should fail compression when canvas context or image blobs are unavailable", async () => {
    vi.mocked(document.createElement).mockImplementationOnce((tagName: string) => {
      if (tagName === "canvas") {
        return {
          getContext: vi.fn().mockReturnValue(null),
        } as any;
      }
      return originalCreateElement(tagName);
    });

    await expect(
      compressPdf(new File([""], "test.pdf", { type: "application/pdf" }), 100, vi.fn()),
    ).rejects.toThrow("Could not get 2D context");

    vi.mocked(document.createElement).mockImplementationOnce((tagName: string) => {
      if (tagName === "canvas") {
        return {
          getContext: vi.fn().mockReturnValue({}),
          height: 0,
          toBlob: vi.fn((cb) => cb(null)),
          width: 0,
        } as any;
      }
      return originalCreateElement(tagName);
    });

    await expect(
      compressPdf(new File([""], "test.pdf", { type: "application/pdf" }), 100, vi.fn()),
    ).rejects.toThrow("Failed to create blob from canvas");
  });

  it("should yield while compressing multi-page PDFs and keep the best result after later errors", async () => {
    const { PDFDocument, pdfjsLib } = await import("../../utils/pdfConfig");
    const page = {
      getViewport: vi.fn().mockReturnValue({ height: 100, width: 100 }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
    };
    vi.mocked(pdfjsLib.getDocument).mockReturnValueOnce({
      promise: Promise.resolve({
        getPage: vi.fn().mockResolvedValue(page),
        numPages: 2,
      }),
    } as any);

    const currentPdf = {
      addPage: vi.fn().mockReturnValue({ drawImage: vi.fn() }),
      embedJpg: vi.fn().mockResolvedValue({}),
      save: vi.fn().mockResolvedValue(new Uint8Array(2048)),
    };
    vi.mocked(PDFDocument.create)
      .mockResolvedValueOnce(currentPdf as any)
      .mockRejectedValueOnce(new Error("later iteration failed"));

    const result = await compressPdf(
      new File([""], "two-pages.pdf", { type: "application/pdf" }),
      1,
      vi.fn(),
    );

    expect(result).toEqual(new Uint8Array(2048));
    expect(page.render).toHaveBeenCalledTimes(2);
  });

  it("should convert PDF pages to image blobs and skip unavailable page blobs", async () => {
    const { pdfjsLib } = await import("../../utils/pdfConfig");
    const page = {
      getViewport: vi.fn().mockReturnValue({ height: 80, width: 120 }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
    };
    vi.mocked(pdfjsLib.getDocument).mockReturnValueOnce({
      promise: Promise.resolve({
        getPage: vi.fn().mockResolvedValue(page),
        numPages: 2,
      }),
    } as any);
    let callCount = 0;
    vi.mocked(document.createElement).mockImplementationOnce((tagName: string) => {
      if (tagName === "canvas") {
        return {
          getContext: vi.fn().mockReturnValue({}),
          height: 0,
          toBlob: vi.fn((cb) => {
            callCount += 1;
            cb(callCount === 1 ? new Blob(["image"], { type: "image/png" }) : null);
          }),
          width: 0,
        } as any;
      }
      return originalCreateElement(tagName);
    });

    const images = await convertPdfToImages(new Uint8Array([1, 2, 3]), {
      format: "png",
      scale: 1,
    });

    expect(images).toHaveLength(1);
    expect(page.render).toHaveBeenCalledTimes(2);
  });

  it("should surface PDF-to-image rendering failures", async () => {
    vi.mocked(document.createElement).mockImplementationOnce((tagName: string) => {
      if (tagName === "canvas") {
        return {
          getContext: vi.fn().mockReturnValue(null),
        } as any;
      }
      return originalCreateElement(tagName);
    });

    await expect(convertPdfToImages(new Uint8Array([1, 2, 3]), { format: "jpeg" })).rejects.toThrow(
      "Could not get 2D context",
    );
  });

  it("should convert PNG and JPEG images into a PDF", async () => {
    const { PDFDocument } = await import("../../utils/pdfConfig");
    const page = { drawImage: vi.fn() };
    const doc = {
      addPage: vi.fn().mockReturnValue(page),
      embedJpg: vi.fn().mockResolvedValue({ scale: vi.fn(() => ({ height: 20, width: 10 })) }),
      embedPng: vi.fn().mockResolvedValue({ scale: vi.fn(() => ({ height: 40, width: 30 })) }),
      save: vi.fn().mockResolvedValue(new Uint8Array([3, 2, 1])),
    };
    vi.mocked(PDFDocument.create).mockResolvedValueOnce(doc as any);

    const result = await convertImagesToPdf([
      new File(["png"], "one.png", { type: "image/png" }),
      new File(["jpg"], "two.jpg", { type: "image/jpeg" }),
    ]);

    expect(result).toEqual(new Uint8Array([3, 2, 1]));
    expect(doc.embedPng).toHaveBeenCalledTimes(1);
    expect(doc.embedJpg).toHaveBeenCalledTimes(1);
    expect(doc.addPage).toHaveBeenCalledTimes(2);
    expect(page.drawImage).toHaveBeenCalledTimes(2);
  });

  it("should surface image-to-PDF conversion failures", async () => {
    const { PDFDocument } = await import("../../utils/pdfConfig");
    vi.mocked(PDFDocument.create).mockRejectedValueOnce(new Error("create failed"));

    await expect(
      convertImagesToPdf([new File(["png"], "one.png", { type: "image/png" })]),
    ).rejects.toThrow("create failed");
  });
});
