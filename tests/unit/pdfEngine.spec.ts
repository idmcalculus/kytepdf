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
    warn: vi.fn(),
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
    rgb: vi.fn((r: number, g: number, b: number) => ({ r, g, b })),
    StandardFonts: {
      Courier: "Courier",
      CourierBold: "Courier-Bold",
      CourierOblique: "Courier-Oblique",
      CourierBoldOblique: "Courier-BoldOblique",
      Helvetica: "Helvetica",
      HelveticaBold: "Helvetica-Bold",
      HelveticaOblique: "Helvetica-Oblique",
      HelveticaBoldOblique: "Helvetica-BoldOblique",
      TimesRoman: "Times-Roman",
      TimesRomanBold: "Times-Bold",
      TimesRomanItalic: "Times-Italic",
      TimesRomanBoldItalic: "Times-BoldItalic",
    },
  };
});

import {
  convertImagesToPdf,
  convertPdfToImages,
  EXTRACTED_WHITEOUT_PADDING_PT,
  embedAllAnnotations,
  renderPdfPagesToImages,
} from "../../utils/pdfEngine";

/** On the 300pt-wide test pages, one editor px (pages are 800px wide in the editor) is 0.375pt. */
const PX = 300 / 800;
/** Extracted text starts 4 editor px in (1px border + 3px padding); Add Text boxes 5px. */
const BLOCK_INSET = 4 * PX;
const TEXT_INSET = 5 * PX;
/**
 * An extracted block's text wraps 2 editor px narrower than its stored width
 * (the box is 6px wider, less 4px on each side). Adding this keeps a test's
 * wrap width at the width it names.
 */
const BLOCK_WIDTH_EXTRA = 2 * PX;

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
    // The production Content-Security-Policy blocks fetch() of data: URLs.
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as any;

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
    expect(global.fetch).not.toHaveBeenCalled();
    // pdf-lib decodes the data URLs itself; each is embedded once.
    expect(doc.embedPng).toHaveBeenCalledTimes(1);
    expect(doc.embedPng).toHaveBeenCalledWith(pngData);
    expect(doc.embedJpg).toHaveBeenCalledTimes(1);
    expect(doc.embedJpg).toHaveBeenCalledWith(jpgData);
    expect(page.drawText).toHaveBeenCalledTimes(3);
    expect(page.drawRectangle).toHaveBeenCalledTimes(1);
    expect(page.drawImage).toHaveBeenCalledTimes(3);
  });

  it("wraps textblock content within its annotation width when exporting", async () => {
    const { PDFDocument } = await import("../../utils/pdfConfig");
    const font = {
      widthOfTextAtSize: vi.fn((text: string, size: number) => text.length * size * 0.5),
    };
    const page = {
      drawImage: vi.fn(),
      drawLine: vi.fn(),
      drawRectangle: vi.fn(),
      drawText: vi.fn(),
      getSize: vi.fn().mockReturnValue({ width: 300, height: 400 }),
    };
    const doc = {
      embedFont: vi.fn().mockResolvedValue(font),
      embedJpg: vi.fn(),
      embedPng: vi.fn(),
      getPages: vi.fn().mockReturnValue([page]),
      save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
    vi.mocked(PDFDocument.load).mockResolvedValueOnce(doc as any);

    await embedAllAnnotations(new Uint8Array([1]), [
      {
        content:
          "The Partners at TTFCX are pleased to offer you a Partnership position in our enterprise.",
        height: 100,
        id: "wrapped-textblock",
        pageIndex: 0,
        style: { color: "#000000", font: "Helvetica", fontSize: 10, lineHeight: 1.2 },
        type: "textblock",
        width: 90,
        x: 20,
        y: 30,
      },
    ]);

    expect(page.drawText.mock.calls.length).toBeGreaterThan(1);
    for (const [text, options] of page.drawText.mock.calls) {
      const textWidth = font.widthOfTextAtSize(text, options.size);
      expect(options.x + textWidth).toBeLessThanOrEqual(110);
      expect(text).not.toMatch(/^\s/);
    }
  });

  // The text box starts 1.5pt in and is 119.25pt wide; "Alpha beta" is 50pt.
  it.each([
    ["left", 21.5],
    ["center", 21.5 + (119.25 - 50) / 2],
    ["right", 21.5 + 119.25 - 50],
  ] as const)("persists %s textblock alignment when exporting", async (textAlign, expectedX) => {
    const { PDFDocument } = await import("../../utils/pdfConfig");
    const font = {
      widthOfTextAtSize: vi.fn((text: string, size: number) => text.length * size * 0.5),
    };
    const page = {
      drawImage: vi.fn(),
      drawLine: vi.fn(),
      drawRectangle: vi.fn(),
      drawText: vi.fn(),
      getSize: vi.fn().mockReturnValue({ width: 300, height: 400 }),
    };
    const doc = {
      embedFont: vi.fn().mockResolvedValue(font),
      embedJpg: vi.fn(),
      embedPng: vi.fn(),
      getPages: vi.fn().mockReturnValue([page]),
      save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
    vi.mocked(PDFDocument.load).mockResolvedValueOnce(doc as any);

    await embedAllAnnotations(new Uint8Array([1]), [
      {
        content: "Alpha beta",
        height: 40,
        id: `${textAlign}-aligned-textblock`,
        pageIndex: 0,
        richContent: "Alpha beta",
        style: { color: "#000000", font: "Helvetica", fontSize: 10, textAlign },
        type: "textblock",
        width: 120,
        x: 20,
        y: 30,
      },
    ]);

    expect(page.drawText).toHaveBeenCalledWith(
      "Alpha beta",
      expect.objectContaining({ x: expectedX }),
    );
  });

  it("persists justified textblock alignment across hard line breaks when exporting", async () => {
    const { PDFDocument } = await import("../../utils/pdfConfig");
    const font = {
      widthOfTextAtSize: vi.fn((text: string, size: number) => text.length * size * 0.5),
    };
    const page = {
      drawImage: vi.fn(),
      drawLine: vi.fn(),
      drawRectangle: vi.fn(),
      drawText: vi.fn(),
      getSize: vi.fn().mockReturnValue({ width: 300, height: 400 }),
    };
    const doc = {
      embedFont: vi.fn().mockResolvedValue(font),
      embedJpg: vi.fn(),
      embedPng: vi.fn(),
      getPages: vi.fn().mockReturnValue([page]),
      save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
    vi.mocked(PDFDocument.load).mockResolvedValueOnce(doc as any);

    await embedAllAnnotations(new Uint8Array([1]), [
      {
        content: "Alpha beta gamma\nLast line",
        height: 60,
        id: "justified-hard-break-textblock",
        pageIndex: 0,
        richContent: "Alpha beta gamma<br>Last line",
        style: { color: "#000000", font: "Helvetica", fontSize: 10, textAlign: "justify" },
        type: "textblock",
        width: 120,
        x: 20,
        y: 30,
      },
    ]);

    // As in CSS, a line that ends at a <br> is not stretched.
    const calls = page.drawText.mock.calls.map(([text, options]) => ({ text, x: options.x }));
    expect(calls.map((call) => call.text)).toEqual(["Alpha beta gamma", "Last line"]);
    expect(calls[0].x).toBeCloseTo(20 + BLOCK_INSET, 5);
    expect(calls[1].x).toBeCloseTo(20 + BLOCK_INSET, 5);
  });

  it("persists simple text annotation alignment when exporting", async () => {
    const { PDFDocument } = await import("../../utils/pdfConfig");
    const font = {
      widthOfTextAtSize: vi.fn((text: string, size: number) => text.length * size * 0.5),
    };
    const page = {
      drawImage: vi.fn(),
      drawLine: vi.fn(),
      drawRectangle: vi.fn(),
      drawText: vi.fn(),
      getSize: vi.fn().mockReturnValue({ width: 300, height: 400 }),
    };
    const doc = {
      embedFont: vi.fn().mockResolvedValue(font),
      embedJpg: vi.fn(),
      embedPng: vi.fn(),
      getPages: vi.fn().mockReturnValue([page]),
      save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
    vi.mocked(PDFDocument.load).mockResolvedValueOnce(doc as any);

    await embedAllAnnotations(new Uint8Array([1]), [
      {
        content: "Aligned",
        height: 20,
        id: "right-aligned-simple-text",
        pageIndex: 0,
        style: { color: "#000000", font: "Helvetica", fontSize: 10, textAlign: "right" },
        type: "text",
        width: 100,
        x: 20,
        y: 30,
      },
    ]);

    // Text starts 5 editor px (1.875pt) in; "Aligned" (35pt) ends at its 100pt width.
    expect(page.drawText).toHaveBeenCalledWith(
      "Aligned",
      expect.objectContaining({ x: 20 + TEXT_INSET + 65 }),
    );
  });

  it("preserves bullet list hanging indentation when exporting wrapped textblocks", async () => {
    const { PDFDocument } = await import("../../utils/pdfConfig");
    const font = {
      widthOfTextAtSize: vi.fn((text: string, size: number) => text.length * size * 0.5),
    };
    const page = {
      drawImage: vi.fn(),
      drawLine: vi.fn(),
      drawRectangle: vi.fn(),
      drawText: vi.fn(),
      getSize: vi.fn().mockReturnValue({ width: 300, height: 400 }),
    };
    const doc = {
      embedFont: vi.fn().mockResolvedValue(font),
      embedJpg: vi.fn(),
      embedPng: vi.fn(),
      getPages: vi.fn().mockReturnValue([page]),
      save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
    vi.mocked(PDFDocument.load).mockResolvedValueOnce(doc as any);

    await embedAllAnnotations(new Uint8Array([1]), [
      {
        content: "Any further benefits shall be based on performance and conduct.",
        height: 100,
        id: "wrapped-list-textblock",
        pageIndex: 0,
        richContent:
          "<ul><li>Any further benefits shall be based on performance and conduct by the partners executive committee platform</li></ul>",
        style: { color: "#000000", font: "Helvetica", fontSize: 10, lineHeight: 1.2 },
        type: "textblock",
        width: 115,
        x: 20,
        y: 30,
      },
    ]);

    const calls = page.drawText.mock.calls.map(([text, options]) => ({
      text,
      x: options.x,
      y: options.y,
    }));
    const bullet = calls.find((call) => call.text === "\u2022");
    const firstTextLine = calls.find((call) => call.text.includes("Any further"));
    const continuationLine = calls.find(
      (call) => call.text !== "\u2022" && firstTextLine && call.y < firstTextLine.y,
    );

    expect(bullet).toBeDefined();
    expect(firstTextLine).toBeDefined();
    expect(continuationLine).toBeDefined();
    expect(firstTextLine!.x).toBeGreaterThan(bullet!.x);
    expect(continuationLine!.x).toBeCloseTo(firstTextLine!.x, 5);
    expect(continuationLine!.x).toBeGreaterThan(20);
  });

  it("keeps line-broken bullet continuations on the list text column", async () => {
    const { PDFDocument } = await import("../../utils/pdfConfig");
    const font = {
      widthOfTextAtSize: vi.fn((text: string, size: number) => text.length * size * 0.5),
    };
    const page = {
      drawImage: vi.fn(),
      drawLine: vi.fn(),
      drawRectangle: vi.fn(),
      drawText: vi.fn(),
      getSize: vi.fn().mockReturnValue({ width: 300, height: 400 }),
    };
    const doc = {
      embedFont: vi.fn().mockResolvedValue(font),
      embedJpg: vi.fn(),
      embedPng: vi.fn(),
      getPages: vi.fn().mockReturnValue([page]),
      save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
    vi.mocked(PDFDocument.load).mockResolvedValueOnce(doc as any);

    await embedAllAnnotations(new Uint8Array([1]), [
      {
        content: "A partnership equity\nprofitability;",
        height: 100,
        id: "line-broken-list-textblock",
        pageIndex: 0,
        richContent: "\u2022 A partnership equity<br>profitability;",
        style: { color: "#000000", font: "Helvetica", fontSize: 10, lineHeight: 1.2 },
        type: "textblock",
        width: 160,
        x: 20,
        y: 30,
      },
    ]);

    const calls = page.drawText.mock.calls.map(([text, options]) => ({
      text,
      x: options.x,
      y: options.y,
    }));
    const firstTextLine = calls.find((call) => call.text.includes("A partnership"));
    const continuationLine = calls.find((call) => call.text.includes("profitability"));

    expect(firstTextLine).toBeDefined();
    expect(continuationLine).toBeDefined();
    expect(continuationLine!.x).toBeCloseTo(firstTextLine!.x, 5);
  });

  it("white-outs extracted annotation bounds when source regions are missing", async () => {
    const { PDFDocument } = await import("../../utils/pdfConfig");
    const font = {
      widthOfTextAtSize: vi.fn((text: string, size: number) => text.length * size * 0.5),
    };
    const page = {
      drawImage: vi.fn(),
      drawLine: vi.fn(),
      drawRectangle: vi.fn(),
      drawText: vi.fn(),
      getSize: vi.fn().mockReturnValue({ width: 300, height: 400 }),
    };
    const doc = {
      embedFont: vi.fn().mockResolvedValue(font),
      embedJpg: vi.fn(),
      embedPng: vi.fn(),
      getPages: vi.fn().mockReturnValue([page]),
      save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
    vi.mocked(PDFDocument.load).mockResolvedValueOnce(doc as any);

    await embedAllAnnotations(new Uint8Array([1]), [
      {
        content: "Extracted text",
        extracted: true,
        height: 40,
        id: "extracted-textblock",
        pageIndex: 0,
        style: { color: "#000000", font: "Helvetica", fontSize: 10, lineHeight: 1.2 },
        type: "textblock",
        width: 100,
        x: 20,
        y: 30,
      },
    ]);

    // The block's box plus 1pt on every side: 400 - 30 - 40 - 1 = 329.
    expect(page.drawRectangle).toHaveBeenCalledWith(
      expect.objectContaining({
        height: 42,
        width: 102,
        x: 19,
        y: 329,
      }),
    );
  });

  it("preserves ordered list markers when exporting textblocks", async () => {
    const { PDFDocument } = await import("../../utils/pdfConfig");
    const font = {
      widthOfTextAtSize: vi.fn((text: string, size: number) => text.length * size * 0.5),
    };
    const page = {
      drawImage: vi.fn(),
      drawLine: vi.fn(),
      drawRectangle: vi.fn(),
      drawText: vi.fn(),
      getSize: vi.fn().mockReturnValue({ width: 300, height: 400 }),
    };
    const doc = {
      embedFont: vi.fn().mockResolvedValue(font),
      embedJpg: vi.fn(),
      embedPng: vi.fn(),
      getPages: vi.fn().mockReturnValue([page]),
      save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
    vi.mocked(PDFDocument.load).mockResolvedValueOnce(doc as any);

    await embedAllAnnotations(new Uint8Array([1]), [
      {
        content: "First\nSecond",
        height: 100,
        id: "ordered-list-textblock",
        pageIndex: 0,
        richContent: "<ol><li>First numbered item</li><li>Second numbered item</li></ol>",
        style: { color: "#000000", font: "Helvetica", fontSize: 10, lineHeight: 1.2 },
        type: "textblock",
        width: 150,
        x: 20,
        y: 30,
      },
    ]);

    const drawnText = page.drawText.mock.calls.map(([text]) => text);
    expect(drawnText).toContain("1.");
    expect(drawnText).toContain("2.");
  });

  it("should propagate annotation embedding failures", async () => {
    const { PDFDocument } = await import("../../utils/pdfConfig");
    vi.mocked(PDFDocument.load).mockRejectedValueOnce(new Error("load failed"));
    await expect(embedAllAnnotations(new Uint8Array([1]), [])).rejects.toThrow("load failed");
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

  describe("textblock rich text export", () => {
    /** A font whose width is half its size per character, named after the standard font. */
    const makeDoc = (options: { measuring?: boolean; pageCount?: number } = {}) => {
      const page = {
        drawImage: vi.fn(),
        drawLine: vi.fn(),
        drawRectangle: vi.fn(),
        drawText: vi.fn(),
        getSize: vi.fn().mockReturnValue({ width: 300, height: 400 }),
      };
      const doc = {
        embedFont: vi.fn(async (name: string) =>
          options.measuring === false
            ? { name }
            : { name, widthOfTextAtSize: (text: string, size: number) => text.length * size * 0.5 },
        ),
        embedJpg: vi.fn(),
        embedPng: vi.fn(),
        getPages: vi
          .fn()
          .mockReturnValue(Array.from({ length: options.pageCount ?? 1 }, () => page)),
        save: vi.fn().mockResolvedValue(new Uint8Array([1])),
      };
      return { doc, page };
    };

    const exportBlock = async (
      block: Record<string, unknown>,
      options: { measuring?: boolean } = {},
      extractedSources: any[] = [],
    ) => {
      const { PDFDocument } = await import("../../utils/pdfConfig");
      const { doc, page } = makeDoc(options);
      vi.mocked(PDFDocument.load).mockResolvedValueOnce(doc as any);
      await embedAllAnnotations(
        new Uint8Array([1]),
        [
          {
            id: "block",
            type: "textblock",
            pageIndex: 0,
            x: 20,
            y: 30,
            width: 200,
            height: 100,
            style: { color: "#000000", font: "Helvetica", fontSize: 10, lineHeight: 1.2 },
            ...block,
          } as any,
        ],
        extractedSources,
      );
      const texts = page.drawText.mock.calls.map(([text, opts]: any[]) => ({
        text,
        x: opts.x,
        y: opts.y,
        size: opts.size,
        font: opts.font.name,
        color: opts.color,
      }));
      return { doc, page, texts };
    };

    it("draws each formatting tag with the matching standard font", async () => {
      const { texts } = await exportBlock({
        richContent:
          "<b>Bold</b> <strong>Strong</strong> <i>Ital</i> <em>Emph</em> <b><i>Both</i></b> plain",
      });

      const fontOf = (word: string) => texts.find((t) => t.text.includes(word))?.font;
      expect(fontOf("Bold")).toBe("Helvetica-Bold");
      expect(fontOf("Strong")).toBe("Helvetica-Bold");
      expect(fontOf("Ital")).toBe("Helvetica-Oblique");
      expect(fontOf("Emph")).toBe("Helvetica-Oblique");
      expect(fontOf("Both")).toBe("Helvetica-BoldOblique");
      expect(fontOf("plain")).toBe("Helvetica");
    });

    it.each([
      ["Times-Roman", ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"]],
      ["Georgia", ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"]],
      ["Courier", ["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"]],
    ])("maps %s styles onto its standard font family", async (font, expected) => {
      const { doc } = await exportBlock({
        richContent: "a <b>b</b> <i>c</i> <b><i>d</i></b>",
        style: { color: "#000000", font, fontSize: 10 },
      });

      expect(doc.embedFont.mock.calls.map(([name]) => name).sort()).toEqual([...expected].sort());
    });

    it("reads bold, italic, size and colour from inline styles and font tags", async () => {
      const { texts } = await exportBlock({
        richContent:
          '<span style="font-weight: 700">Heavy</span> ' +
          '<span style="font-weight: bold">Weighty</span> ' +
          '<span style="font-style: italic">Slanted</span> ' +
          '<span style="font-size: 20px">Large</span> ' +
          '<span style="font-size: big">Kept</span> ' +
          '<span style="color: rgb(255, 0, 0)">Red</span> ' +
          '<font color="#00ff00" face="Courier">Green</font>',
      });

      const find = (word: string) => texts.find((t) => t.text.includes(word));
      expect(find("Heavy")?.font).toBe("Helvetica-Bold");
      expect(find("Weighty")?.font).toBe("Helvetica-Bold");
      expect(find("Slanted")?.font).toBe("Helvetica-Oblique");
      expect(find("Large")?.size).toBe(20);
      expect(find("Kept")?.size).toBe(10);
      expect(find("Red")?.color).toEqual({ r: 1, g: 0, b: 0 });
      expect(find("Green")?.color).toEqual({ r: 0, g: 1, b: 0 });
      // The face attribute does not change the block's font.
      expect(find("Green")?.font).toBe("Helvetica");
    });

    it.each([
      ['<font color="#f00">Short hex</font>', { r: 1, g: 0, b: 0 }],
      ['<font color="#0F08">Short hex with alpha</font>', { r: 0, g: 1, b: 0 }],
      ['<font color="#0000ff80">Hex with alpha</font>', { r: 0, g: 0, b: 1 }],
      ['<font color="RebeccaPurple">Named</font>', { r: 0x66 / 255, g: 0x33 / 255, b: 0x99 / 255 }],
      ['<span style="color: teal">Styled name</span>', { r: 0, g: 0x80 / 255, b: 0x80 / 255 }],
    ])("reads the colour of %s", async (richContent, expected) => {
      const { texts } = await exportBlock({ richContent });

      const color = texts[0].color;
      expect(color.r).toBeCloseTo(expected.r, 5);
      expect(color.g).toBeCloseTo(expected.g, 5);
      expect(color.b).toBeCloseTo(expected.b, 5);
    });

    it("measures a space in the size it is drawn at when wrapping", async () => {
      const { texts } = await exportBlock({
        richContent: '<span style="font-size: 40px">Big </span>small',
        width: 100,
      });

      // "Big" (60pt) + a 40pt space (20pt) + "small" (25pt) = 105pt, over 100pt.
      const small = texts.find((t) => t.text === "small");
      // So "small" starts the next line instead of overflowing this one.
      expect(small?.x).toBe(20 + BLOCK_INSET);
      for (const t of texts) {
        expect(t.x + t.text.trimEnd().length * t.size * 0.5).toBeLessThanOrEqual(120);
      }
    });

    it("does not indent a paragraph that follows a list", async () => {
      const { texts } = await exportBlock({
        richContent: "<ul><li>Item</li></ul><div>After the list</div>",
      });

      expect(texts.find((t) => t.text === "Item")?.x).toBe(20 + BLOCK_INSET + 18);
      expect(texts.find((t) => t.text === "After the list")?.x).toBe(20 + BLOCK_INSET);
    });

    it("draws a typed bullet as the plain text the editor shows, not as a list item", async () => {
      const { texts } = await exportBlock({
        richContent: "<div>\u2022 Point</div><div>Next paragraph</div>",
      });

      expect(texts.map((t) => [t.text, t.x])).toEqual([
        ["\u2022 Point", 20 + BLOCK_INSET],
        ["Next paragraph", 20 + BLOCK_INSET],
      ]);
    });

    it("keeps a block wrapped inside a list item on the item's marker line", async () => {
      const { texts } = await exportBlock({
        richContent: "<ol><li><div>Wrapped item</div></li></ol>",
      });

      const marker = texts.find((t) => t.text === "1.");
      const item = texts.find((t) => t.text === "Wrapped item");
      expect(item?.y).toBe(marker?.y);
      expect(item?.x).toBe(20 + BLOCK_INSET + 18);
    });

    it("falls back to black for a malformed rgb colour", async () => {
      const { texts } = await exportBlock({
        richContent: '<font color="rgb(1, 2)">Short</font>',
        style: { color: "#336699", font: "Helvetica", fontSize: 10 },
      });

      expect(texts.find((t) => t.text.includes("Short"))?.color).toEqual({ r: 0, g: 0, b: 0 });
    });

    it("draws underline and strikethrough lines under and through their text", async () => {
      const { page } = await exportBlock({
        richContent:
          "<u>Under</u> <s>Gone</s> <strike>Old</strike> <del>Cut</del> " +
          '<span style="text-decoration: underline line-through">Both</span>',
      });

      // Baseline: 400 - 30 - 1.125 (3 editor px inset) - 1 (half-leading) - 8 = 359.875.
      const lines = page.drawLine.mock.calls.map(([options]: any[]) => options);
      const underlines = lines.filter((line) => line.start.y === 357.875);
      const strikes = lines.filter((line) => line.start.y === 362.875);
      expect(underlines).toHaveLength(2);
      expect(strikes).toHaveLength(4);
      // "Under" is 5 characters at 10pt: 25pt wide.
      expect(underlines[0].end.x - underlines[0].start.x).toBe(25);
    });

    it("puts each contentEditable block on its own line", async () => {
      const { texts } = await exportBlock({
        richContent: "First line<div>Second line</div><div><br></div><p>Third line</p>",
      });

      expect(texts.map((t) => t.text)).toEqual(["First line", "Second line", "Third line"]);
      const ys = texts.map((t) => t.y);
      // Each line is one line-height (12pt) lower; the empty block between
      // the second and third lines is an empty line, as the editor shows it.
      expect(ys[0] - ys[1]).toBeCloseTo(12, 5);
      expect(ys[1] - ys[2]).toBeCloseTo(24, 5);
    });

    it("keeps blank lines from plain content and applies its bold and italic style", async () => {
      const { texts } = await exportBlock({
        content: "Top\n\nBottom",
        style: { color: "#000000", font: "Helvetica", fontSize: 10, bold: true, italic: true },
      });

      expect(texts.map((t) => t.text)).toEqual(["Top", "Bottom"]);
      expect(texts[0].font).toBe("Helvetica-BoldOblique");
      expect(texts[0].y - texts[1].y).toBeCloseTo(2 * 1.4 * 10, 5);
    });

    it("uses default styling when a textblock has none", async () => {
      const { texts } = await exportBlock({ content: "Defaults", style: undefined });

      expect(texts).toEqual([
        expect.objectContaining({
          text: "Defaults",
          size: 16,
          font: "Helvetica",
          color: { r: 0, g: 0, b: 0 },
        }),
      ]);
    });

    it("draws nothing for a textblock without content", async () => {
      const { page } = await exportBlock({ content: undefined, richContent: "<b></b>" });
      expect(page.drawText).not.toHaveBeenCalled();
    });

    it("breaks a word wider than the block across lines", async () => {
      const { texts } = await exportBlock({
        richContent: "Supercalifragilistic tail",
        width: 50 + BLOCK_WIDTH_EXTRA,
      });

      // 5pt per character fits 10 characters per 50pt line.
      expect(texts.map((t) => t.text)).toEqual(["Supercalif", "ragilistic", "tail"]);
      for (const t of texts) {
        expect(t.text.length * 5).toBeLessThanOrEqual(50);
      }
    });

    it("estimates widths when the font cannot measure text", async () => {
      const { texts } = await exportBlock(
        {
          richContent: "Right",
          style: { color: "#000000", font: "Helvetica", fontSize: 10, textAlign: "right" },
          width: 100,
        },
        { measuring: false },
      );

      // Estimated width: 5 characters * 10pt * 0.5 = 25pt, ending at the
      // text's right edge (1.5pt in, 99.25pt wide).
      expect(texts[0]).toEqual(
        expect.objectContaining({ text: "Right", x: 20 + BLOCK_INSET + 99.25 - 25 }),
      );
    });

    it("draws text on one line when the block has no usable width", async () => {
      const { texts } = await exportBlock({ richContent: "One two three", width: -5 });

      expect(texts.map((t) => t.text)).toEqual(["One two three"]);
    });

    it("strips control characters before drawing", async () => {
      const { texts } = await exportBlock({ richContent: "Bell\u0007 ring\u0000s" });

      expect(texts.map((t) => t.text)).toEqual(["Bell rings"]);
    });

    it("draws a list marker in its item's style, right-aligned before the text column", async () => {
      const { texts } = await exportBlock({
        richContent: '<ol><li style="color: rgb(0, 0, 255)"><b>Item</b> text</li></ol>',
      });
      const column = 20 + BLOCK_INSET + 18;

      const marker = texts.find((t) => t.text === "1.");
      expect(marker).toEqual(
        expect.objectContaining({ font: "Helvetica", color: { r: 0, g: 0, b: 1 } }),
      );
      expect(texts.find((t) => t.text === "Item")).toEqual(
        expect.objectContaining({ font: "Helvetica-Bold", color: { r: 0, g: 0, b: 1 } }),
      );
      // Text starts on the list column 18pt in; the 10pt-wide "1." ends 3pt before it.
      expect(texts.find((t) => t.text === "Item")?.x).toBe(column);
      expect(marker?.x).toBe(column - 3 - 10);
    });

    it("draws the marker of an empty list item and moves the next item down", async () => {
      const { texts } = await exportBlock({ richContent: "<ul><li></li><li>dash item</li></ul>" });

      expect(texts.map((t) => t.text)).toEqual(["\u2022", "\u2022", "dash item"]);
      expect(texts[0].y - texts[1].y).toBeCloseTo(12, 5);
    });

    it("justifies runs that mix styles across the full line width", async () => {
      const { texts } = await exportBlock({
        richContent: "<b>Alpha</b> beta gamma delta<br>end",
        style: { color: "#000000", font: "Helvetica", fontSize: 10, textAlign: "justify" },
        width: 100 + BLOCK_WIDTH_EXTRA,
      });

      const left = 20 + BLOCK_INSET;
      const words = texts.filter((t) => t.text.trim().length > 0);
      const gamma = words.find((t) => t.text === "gamma");
      // The wrapped line "Alpha beta gamma" ends at the right edge (left + 100);
      // "delta" ends its source line and "end" ends the box, so neither stretches.
      expect((gamma?.x ?? 0) + 5 * 5).toBeCloseTo(left + 100, 5);
      expect(words.find((t) => t.text === "Alpha")?.font).toBe("Helvetica-Bold");
      expect(words.find((t) => t.text === "delta")?.x).toBe(left);
      expect(words.find((t) => t.text === "end")?.x).toBe(left);
    });

    it("centres the text of a list item within the list column", async () => {
      const { texts } = await exportBlock({
        richContent: "<ul><li>Mid</li></ul>",
        style: { color: "#000000", font: "Helvetica", fontSize: 10, textAlign: "center" },
        width: 118 + BLOCK_WIDTH_EXTRA,
      });

      // List column: 18pt in from the text's left edge, 100pt wide. "Mid" is 15pt wide.
      const column = 20 + BLOCK_INSET + 18;
      expect(texts.find((t) => t.text === "Mid")?.x).toBeCloseTo(column + (100 - 15) / 2, 5);
    });

    it("replaces characters the standard fonts cannot encode instead of failing the save", async () => {
      const { PDFDocument } = await import("../../utils/pdfConfig");
      const { doc, page } = makeDoc();
      // Like pdf-lib's standard fonts, which throw outside WinAnsi.
      const winAnsiOnly = (text: string) => {
        if (Array.from(text).some((ch) => (ch.codePointAt(0) ?? 0) > 0xff && ch !== "\u2022")) {
          throw new Error(`WinAnsi cannot encode "${text}"`);
        }
      };
      doc.embedFont.mockImplementation(async (name: string) => ({
        name,
        widthOfTextAtSize: (text: string, size: number) => {
          winAnsiOnly(text);
          return text.length * size * 0.5;
        },
      }));
      page.drawText.mockImplementation((text: string) => winAnsiOnly(text));
      vi.mocked(PDFDocument.load).mockResolvedValueOnce(doc as any);
      const onCharactersReplaced = vi.fn();

      await embedAllAnnotations(
        new Uint8Array([1]),
        [
          {
            id: "unicode",
            type: "textblock",
            pageIndex: 0,
            x: 20,
            y: 30,
            width: 400,
            richContent: "Zażółć Привет a − b → ≤ 你好",
            style: { fontSize: 10 },
          },
          {
            id: "plain",
            type: "text",
            pageIndex: 0,
            x: 20,
            y: 90,
            content: "x − y",
            style: { fontSize: 10 },
          },
        ],
        [],
        { onCharactersReplaced },
      );

      expect(page.drawText.mock.calls.map(([text]: any[]) => text)).toEqual([
        "Zazólc ?????? a - b -> <= ??",
        "x - y",
      ]);
      expect(onCharactersReplaced).toHaveBeenCalledWith(15);
    });

    it("does not report replaced characters when every character can be drawn", async () => {
      const { PDFDocument } = await import("../../utils/pdfConfig");
      const { doc } = makeDoc();
      vi.mocked(PDFDocument.load).mockResolvedValueOnce(doc as any);
      const onCharactersReplaced = vi.fn();

      await embedAllAnnotations(
        new Uint8Array([1]),
        [{ id: "t", type: "text", pageIndex: 0, x: 0, y: 0, content: "Café • ok" }],
        [],
        { onCharactersReplaced },
      );

      expect(onCharactersReplaced).not.toHaveBeenCalled();
    });

    it("carries formatting across <br> and from <div> styles to every line", async () => {
      const { texts } = await exportBlock({
        richContent:
          "<b>One<br>Two</b><br>" +
          '<span style="color: #f00">Red<br>Still red</span><br>' +
          '<span style="font-size: 20px">Big<br>Still big</span>' +
          '<div style="font-weight: bold; font-style: italic">Block style</div>',
      });

      const find = (text: string) => texts.find((t) => t.text === text);
      expect(find("Two")?.font).toBe("Helvetica-Bold");
      expect(find("Still red")?.color).toEqual({ r: 1, g: 0, b: 0 });
      expect(find("Still big")?.size).toBe(20);
      expect(find("Block style")?.font).toBe("Helvetica-BoldOblique");
    });

    it("numbers list items from <ol start>, and leaves script and style text out", async () => {
      const { texts } = await exportBlock({
        richContent:
          '<ol start="4"><li>Fourth</li><li>Fifth</li></ol><style>p{}</style><script>x()</script>',
      });

      expect(texts.map((t) => t.text)).toEqual(["4.", "Fourth", "5.", "Fifth"]);
    });

    it("draws lines that only look like list items as plain text in the paragraph", async () => {
      const { texts } = await exportBlock({
        richContent: "founded in<br>2024. Since then<br>- and now<br>* also this<br>A. too",
      });

      const left = 20 + BLOCK_INSET;
      expect(texts.map((t) => [t.text, t.x])).toEqual([
        ["founded in", left],
        ["2024. Since then", left],
        ["- and now", left],
        ["* also this", left],
        ["A. too", left],
      ]);
    });

    it("stretches wrapped lines when justifying but not the last line of each paragraph", async () => {
      const { texts } = await exportBlock({
        richContent: "<div>aaa bbb ccc ddd eee fff</div><div>hi there</div>",
        style: { color: "#000000", font: "Helvetica", fontSize: 10, textAlign: "justify" },
        width: 60 + BLOCK_WIDTH_EXTRA,
      });

      // "aaa bbb ccc" (55pt) is stretched to 60pt: each space gains 2.5pt.
      const left = 20 + BLOCK_INSET;
      const words = texts.filter((t) => t.text.trim().length > 0);
      expect(words.slice(0, 3).map((t) => [t.text, t.x])).toEqual([
        ["aaa", left],
        ["bbb", left + 22.5],
        ["ccc", left + 45],
      ]);
      // The paragraph's last line and the next paragraph are not stretched.
      expect(texts.find((t) => t.text === "ddd eee fff")?.x).toBe(left);
      expect(texts.find((t) => t.text === "hi there")?.x).toBe(left);
    });

    it("puts the first baseline where the editor shows it: below the inset and half-leading", async () => {
      const { texts } = await exportBlock({
        content: "Spaced",
        style: { color: "#000000", font: "Helvetica", fontSize: 10, lineHeight: 3 },
      });

      // Box top 370; 3 editor px is 1.125pt on a 300pt page; at line height 3
      // the half-leading is (3 - 1) x 10 / 2 = 10pt; then 0.8 x 10.
      expect(texts[0].y).toBeCloseTo(370 - 1.125 - 10 - 8, 5);
    });

    it("keeps repeated and leading spaces, as the editor's pre-wrap shows them", async () => {
      const { texts } = await exportBlock({
        richContent: "Name:     John<br>    indented<br>trailing   ",
      });

      const left = 20 + BLOCK_INSET;
      expect(texts.map((t) => [t.text, t.x])).toEqual([
        ["Name:     John", left],
        ["    indented", left],
        ["trailing", left],
      ]);
    });

    it("drops the spaces a line wraps at, but keeps the indent of its first line", async () => {
      const { texts } = await exportBlock({
        richContent: "  aaaa bbbb    cccc",
        width: 60 + BLOCK_WIDTH_EXTRA,
      });

      // "  aaaa bbbb" is 55pt; "    cccc" would not fit, so the wrap eats its spaces.
      expect(texts.map((t) => [t.text, t.x])).toEqual([
        ["  aaaa bbbb", 20 + BLOCK_INSET],
        ["cccc", 20 + BLOCK_INSET],
      ]);
    });

    it("right-aligns ordered-list numbers so two-digit numbers stay clear of the text", async () => {
      const items = Array.from({ length: 10 }, (_, i) => `<li>Item ${i + 1}</li>`).join("");
      const { texts } = await exportBlock({ richContent: `<ol>${items}</ol>`, height: 400 });

      const one = texts.find((t) => t.text === "1.");
      const ten = texts.find((t) => t.text === "10.");
      // Both end 3pt (0.3em) before the text column, 18pt in from the text's
      // left edge: "1." is 10pt wide, "10." 15pt.
      const column = 20 + BLOCK_INSET + 18;
      expect(one?.x).toBe(column - 3 - 10);
      expect(ten?.x).toBe(column - 3 - 15);
      expect((ten?.x ?? 0) + 15).toBeLessThan(column);
      expect(texts.find((t) => t.text === "Item 10")?.x).toBe(column);
    });

    it("draws an edited extracted text box on an opaque white box the size the editor shows", async () => {
      const { page } = await exportBlock({
        content: "Edited",
        extracted: true,
        height: 30,
        width: 100,
      });

      // The box: 100pt wide plus 6 editor px (2.25pt), at least 30pt tall,
      // drawn before the text so it covers what was under it.
      const box = page.drawRectangle.mock.calls
        .map(([options]: any[]) => options)
        .find((options: any) => options.width === 102.25);
      expect(box).toMatchObject({
        x: 20,
        y: 400 - 30 - 30,
        height: 30,
        color: { r: 1, g: 1, b: 1 },
      });
      expect(page.drawRectangle.mock.invocationCallOrder.at(-1)).toBeLessThan(
        page.drawText.mock.invocationCallOrder[0],
      );
    });

    it("grows the white box with text that no longer fits its original height", async () => {
      const { page } = await exportBlock({
        content: "one\ntwo\nthree",
        extracted: true,
        height: 10,
        width: 100,
      });

      // Inset 1.125 + three 12pt lines + inset 1.125 = 38.25pt.
      const box = page.drawRectangle.mock.calls
        .map(([options]: any[]) => options)
        .find((options: any) => options.width === 102.25);
      expect(box?.height).toBeCloseTo(38.25, 5);
    });

    it("draws no white box behind text boxes that were not extracted", async () => {
      const { page } = await exportBlock({ content: "New", height: 30, width: 100 });

      expect(page.drawRectangle).not.toHaveBeenCalled();
    });

    it("whites out only the given glyph boxes when a page has them, with 1pt around each", async () => {
      expect(EXTRACTED_WHITEOUT_PADDING_PT).toBe(1);
      const { page } = await exportBlock(
        { content: "Moved", extracted: true, x: 150, y: 200, width: 50, height: 20 },
        {},
        [{ pageIndex: 0, x: 20, y: 30, width: 60, height: 12 }],
      );

      const rects = page.drawRectangle.mock.calls.map(([options]: any[]) => options);
      // The glyph box plus 1pt, then the moved box's own white background;
      // the moved block's whole box is not whited out a second time.
      expect(rects[0]).toMatchObject({ x: 19, y: 400 - 30 - 12 - 1, width: 62, height: 14 });
      expect(rects).toHaveLength(2);
      expect(rects[1]).toMatchObject({ x: 150, width: 52.25 });
    });

    it("keeps the empty lines the editor shows for <div><br></div>, repeated <br> and newlines", async () => {
      const { texts } = await exportBlock({
        richContent: "One<br><br>Two<div><br></div><div>Three</div>Four\n\nFive<br>",
      });

      expect(texts.map((t) => t.text)).toEqual(["One", "Two", "Three", "Four", "Five"]);
      const gaps = texts.slice(1).map((t, i) => texts[i].y - t.y);
      // 12pt lines; an empty line in between doubles the step.
      expect(gaps[0]).toBeCloseTo(24, 5);
      expect(gaps[1]).toBeCloseTo(24, 5);
      expect(gaps[2]).toBeCloseTo(12, 5);
      expect(gaps[3]).toBeCloseTo(24, 5);
    });

    it("makes an empty line as tall as the style it was left in, and adds none for a trailing <br>", async () => {
      const { texts } = await exportBlock({
        richContent: 'One<br><span style="font-size: 30px"><br></span>Two',
      });
      // A 30pt empty line at line height 1.2 is 36pt tall.
      expect(texts[0].y - texts[1].y).toBeCloseTo(12 + 36, 5);

      // A <br> at the end of the text adds no line, so the white box of an
      // extracted block is one line tall: inset + 12pt + inset.
      const { page } = await exportBlock({
        richContent: "Last<br>",
        extracted: true,
        height: 1,
        width: 100,
      });
      const box = page.drawRectangle.mock.calls
        .map(([options]: any[]) => options)
        .find((options: any) => options.width === 100 + 6 * PX);
      expect(box?.height).toBeCloseTo(3 * PX + 12 + 3 * PX, 5);
    });

    it("starts text inside the box's border and padding, and wraps it at the editor's text width", async () => {
      // An extracted block's text is 4 editor px in and 2px narrower than its
      // stored width; an Add Text box's text is 5px in.
      const block = await exportBlock({ richContent: "aaaa bbbb", width: 45 });
      expect(block.texts.map((t) => [t.text, t.x])).toEqual([
        ["aaaa", 20 + 4 * PX],
        ["bbbb", 20 + 4 * PX],
      ]);

      const text = await exportBlock({ type: "text", width: undefined, richContent: "Added" });
      expect(text.texts[0].x).toBe(20 + 5 * PX);
    });

    it("white-outs extracted source regions and skips regions on missing pages", async () => {
      const { page } = await exportBlock({ content: "Text", extracted: false }, {}, [
        { pageIndex: 0, x: 10, y: 20, width: 30, height: 40 },
        { pageIndex: 5, x: 0, y: 0, width: 10, height: 10 },
      ]);

      // The region plus 1pt on every side.
      expect(page.drawRectangle).toHaveBeenCalledTimes(1);
      expect(page.drawRectangle).toHaveBeenCalledWith(
        expect.objectContaining({ x: 9, y: 339, width: 32, height: 42 }),
      );
    });

    it("does not white-out extracted annotations without a size or of other types", async () => {
      const { PDFDocument } = await import("../../utils/pdfConfig");
      const { doc, page } = makeDoc();
      vi.mocked(PDFDocument.load).mockResolvedValueOnce(doc as any);

      await embedAllAnnotations(new Uint8Array([1]), [
        { id: "a", type: "textblock", pageIndex: 0, x: 1, y: 1, extracted: true } as any,
        { id: "b", type: "rectangle", pageIndex: 0, x: 1, y: 1, extracted: true } as any,
      ]);

      // Only the rectangle annotation itself is drawn, with its defaults.
      expect(page.drawRectangle).toHaveBeenCalledTimes(1);
      expect(page.drawRectangle).toHaveBeenCalledWith(
        expect.objectContaining({ width: 100, height: 50, borderWidth: 0, opacity: 1 }),
      );
    });
  });

  describe("simple annotation defaults", () => {
    const loadPage = async () => {
      const { PDFDocument } = await import("../../utils/pdfConfig");
      const page = {
        drawImage: vi.fn(),
        drawLine: vi.fn(),
        drawRectangle: vi.fn(),
        drawText: vi.fn(),
        getSize: vi.fn().mockReturnValue({ width: 300, height: 400 }),
      };
      vi.mocked(PDFDocument.load).mockResolvedValueOnce({
        embedFont: vi.fn().mockResolvedValue({}),
        embedJpg: vi.fn().mockResolvedValue({ image: "jpg" }),
        embedPng: vi.fn(),
        getPages: vi.fn().mockReturnValue([page]),
        save: vi.fn().mockResolvedValue(new Uint8Array([1])),
      } as any);
      return page;
    };

    it("centres simple text by an estimated width when the font cannot measure", async () => {
      const page = await loadPage();

      await embedAllAnnotations(new Uint8Array([1]), [
        {
          id: "t",
          type: "text",
          pageIndex: 0,
          x: 10,
          y: 10,
          width: 100,
          content: "Centred",
          style: { fontSize: 10, textAlign: "center" },
        } as any,
      ]);

      // Estimated width 7 * 10 * 0.5 = 35, centred in the 100pt box whose
      // text starts 5 editor px (1.875pt) in.
      expect(page.drawText).toHaveBeenCalledWith(
        "Centred",
        expect.objectContaining({ x: 10 + TEXT_INSET + (100 - 35) / 2, size: 10 }),
      );
    });

    it("applies default sizes, colours and strokes to shapes, lines and images", async () => {
      const page = await loadPage();
      global.fetch = vi.fn().mockResolvedValue({
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(2)),
      }) as any;

      await embedAllAnnotations(new Uint8Array([1]), [
        { id: "r", type: "rectangle", pageIndex: 0, x: 0, y: 0 } as any,
        { id: "h", type: "highlight", pageIndex: 0, x: 0, y: 0 } as any,
        { id: "u", type: "underline", pageIndex: 0, x: 5, y: 10 } as any,
        { id: "s", type: "strikethrough", pageIndex: 0, x: 5, y: 10 } as any,
        {
          id: "f",
          type: "freehand",
          pageIndex: 0,
          x: 0,
          y: 0,
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        } as any,
        { id: "dot", type: "freehand", pageIndex: 0, x: 0, y: 0, points: [{ x: 0, y: 0 }] } as any,
        { id: "i", type: "image", pageIndex: 0, x: 0, y: 0, content: "data:image/jpeg;base64,x" },
        { id: "empty", type: "image", pageIndex: 0, x: 0, y: 0 } as any,
      ]);

      // The same default sizes the editor draws these annotations with.
      expect(page.drawRectangle).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ y: 350, width: 100, height: 50, color: { r: 1, g: 1, b: 1 } }),
      );
      expect(page.drawRectangle).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ y: 376, width: 120, height: 24, opacity: 0.3 }),
      );
      const lines = page.drawLine.mock.calls.map(([options]: any[]) => options);
      // A 12pt line box with the default 2pt stroke: the underline bar fills its
      // bottom 2pt (centre 11pt down), the strike bar its middle (centre 6pt down).
      expect(lines[0]).toEqual(
        expect.objectContaining({ start: { x: 5, y: 379 }, end: { x: 125, y: 379 }, thickness: 2 }),
      );
      expect(lines[1]).toEqual(expect.objectContaining({ start: { x: 5, y: 384 } }));
      // A one-point freehand stroke draws nothing.
      expect(lines).toHaveLength(3);
      expect(page.drawImage).toHaveBeenCalledTimes(1);
      expect(page.drawImage).toHaveBeenCalledWith(
        { image: "jpg" },
        expect.objectContaining({ width: 150, height: 150, opacity: 1 }),
      );
    });
  });

  describe("rendering pages to images", () => {
    it("keeps page numbers with images and marks pages that failed to encode", async () => {
      const { pdfjsLib } = await import("../../utils/pdfConfig");
      const page = {
        getViewport: vi.fn().mockReturnValue({ height: 10, width: 10 }),
        render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
      };
      const getPage = vi.fn().mockResolvedValue(page);
      vi.mocked(pdfjsLib.getDocument)
        .mockReturnValueOnce({ promise: Promise.resolve({ getPage, numPages: 3 }) } as any)
        .mockReturnValueOnce({ promise: Promise.resolve({ getPage, numPages: 3 }) } as any);
      let encoded = 0;
      const canvas = {
        getContext: vi.fn().mockReturnValue({}),
        height: 0,
        // Page 2 of each run fails to encode.
        toBlob: vi.fn((cb) => {
          encoded += 1;
          cb(encoded % 3 === 2 ? null : new Blob([`page-${encoded}`]));
        }),
        width: 0,
      };
      vi.mocked(document.createElement).mockImplementation(() => canvas as any);

      const pages = await renderPdfPagesToImages(new Uint8Array([1]), { format: "png" });
      expect(pages.map(({ pageNumber, blob }) => [pageNumber, blob === null])).toEqual([
        [1, false],
        [2, true],
        [3, false],
      ]);

      // Only the requested pages are rendered, in the order asked, and
      // pages outside the document are ignored.
      getPage.mockClear();
      const chosen = await renderPdfPagesToImages(new Uint8Array([1]), {
        format: "jpeg",
        pages: [3, 0, 1, 9],
      });
      expect(getPage.mock.calls.map(([n]) => n)).toEqual([3, 1]);
      expect(chosen.map(({ pageNumber }) => pageNumber)).toEqual([3, 1]);
    });

    it("frees each page and the document after rendering, also when rendering fails", async () => {
      const { pdfjsLib } = await import("../../utils/pdfConfig");
      const makePdf = (renderError?: Error) => {
        const page = {
          cleanup: vi.fn(),
          getViewport: vi.fn().mockReturnValue({ height: 10, width: 10 }),
          render: vi.fn().mockReturnValue({
            promise: renderError ? Promise.reject(renderError) : Promise.resolve(),
          }),
        };
        const pdf = {
          loadingTask: { destroy: vi.fn().mockResolvedValue(undefined) },
          getPage: vi.fn().mockResolvedValue(page),
          numPages: 2,
        };
        vi.mocked(pdfjsLib.getDocument).mockReturnValueOnce({
          promise: Promise.resolve(pdf),
        } as any);
        return { page, pdf };
      };
      const canvas = {
        getContext: vi.fn().mockReturnValue({}),
        height: 0,
        toBlob: vi.fn((cb) => cb(new Blob(["x"]))),
        width: 0,
      };
      vi.mocked(document.createElement).mockImplementation(() => canvas as any);

      const ok = makePdf();
      await renderPdfPagesToImages(new Uint8Array([1]), { format: "png" });
      expect(ok.page.cleanup).toHaveBeenCalledTimes(2);
      expect(ok.pdf.loadingTask.destroy).toHaveBeenCalledTimes(1);

      const failing = makePdf(new Error("render failed"));
      await expect(renderPdfPagesToImages(new Uint8Array([1]), { format: "png" })).rejects.toThrow(
        "render failed",
      );
      expect(failing.page.cleanup).toHaveBeenCalledTimes(1);
      expect(failing.pdf.loadingTask.destroy).toHaveBeenCalledTimes(1);

      // A failure to free the document is logged, not thrown over the result.
      const stubborn = makePdf();
      stubborn.pdf.loadingTask.destroy.mockRejectedValueOnce(new Error("worker gone"));
      await expect(
        renderPdfPagesToImages(new Uint8Array([1]), { format: "png" }),
      ).resolves.toHaveLength(2);
    });

    it("renders at the default scale and yields between every second page", async () => {
      const { pdfjsLib } = await import("../../utils/pdfConfig");
      const page = {
        getViewport: vi.fn().mockReturnValue({ height: 0.4, width: 0.4 }),
        render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
      };
      vi.mocked(pdfjsLib.getDocument).mockReturnValueOnce({
        promise: Promise.resolve({ getPage: vi.fn().mockResolvedValue(page), numPages: 3 }),
      } as any);
      const canvas = {
        getContext: vi.fn().mockReturnValue({}),
        height: 0,
        toBlob: vi.fn((cb) => cb(new Blob(["x"], { type: "image/jpeg" }))),
        width: 0,
      };
      vi.mocked(document.createElement).mockImplementationOnce(() => canvas as any);

      const images = await convertPdfToImages(new Uint8Array([1]), { format: "jpeg" });

      expect(images).toHaveLength(3);
      expect(page.getViewport).toHaveBeenCalledWith({ scale: 2 });
      // Tiny viewports still get a 1x1 canvas.
      expect(canvas.width).toBe(1);
      expect(canvas.height).toBe(1);
      expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.95);
    });
  });

  describe("text boxes, scripts and page geometry", () => {
    type Box = { x: number; y: number; width: number; height: number };

    const makePage = (geometry: { rotation?: number; crop?: Box; media?: Box } = {}) => {
      const media = geometry.media ?? { x: 0, y: 0, width: 300, height: 400 };
      return {
        drawImage: vi.fn(),
        drawLine: vi.fn(),
        drawRectangle: vi.fn(),
        drawText: vi.fn(),
        getSize: vi.fn().mockReturnValue({ width: media.width, height: media.height }),
        getMediaBox: vi.fn().mockReturnValue(media),
        getCropBox: vi.fn().mockReturnValue(geometry.crop ?? media),
        getRotation: vi.fn().mockReturnValue({ angle: geometry.rotation ?? 0 }),
      };
    };

    /** Exports annotations onto one page; fonts are half their size wide per character. */
    const exportOn = async (
      annotations: Array<Record<string, unknown>>,
      geometry: Parameters<typeof makePage>[0] = {},
      sources: any[] = [],
    ) => {
      const { PDFDocument } = await import("../../utils/pdfConfig");
      const page = makePage(geometry);
      const doc = {
        embedFont: vi.fn(async (name: string) => ({
          name,
          widthOfTextAtSize: (text: string, size: number) => text.length * size * 0.5,
        })),
        embedJpg: vi.fn().mockResolvedValue({ image: "jpg" }),
        embedPng: vi.fn().mockResolvedValue({ image: "png" }),
        getPages: vi.fn().mockReturnValue([page]),
        save: vi.fn().mockResolvedValue(new Uint8Array([1])),
      };
      vi.mocked(PDFDocument.load).mockResolvedValueOnce(doc as any);
      await embedAllAnnotations(
        new Uint8Array([1]),
        annotations.map((ann, i) => ({ id: `a${i}`, pageIndex: 0, ...ann }) as any),
        sources,
      );
      const texts = page.drawText.mock.calls.map(([text, opts]: any[]) => ({
        text,
        ...opts,
        font: opts.font.name,
      }));
      return { page, doc, texts };
    };

    describe("Add Text boxes", () => {
      it("exports the rich text a text box holds, not just its plain content", async () => {
        const { texts } = await exportOn([
          {
            type: "text",
            x: 20,
            y: 30,
            content: "Bold plain",
            richContent: '<b>Bold</b> <span style="color: rgb(255, 0, 0)">plain</span>',
            style: { fontSize: 10 },
          },
        ]);

        expect(texts.find((t) => t.text === "Bold")).toMatchObject({ font: "Helvetica-Bold" });
        expect(texts.find((t) => t.text.includes("plain"))).toMatchObject({
          font: "Helvetica",
          color: { r: 1, g: 0, b: 0 },
        });
      });

      it("aligns a text box without a width within its widest line", async () => {
        const { texts } = await exportOn([
          {
            type: "text",
            x: 20,
            y: 30,
            richContent: "Short<br>A longer second line",
            style: { fontSize: 10, textAlign: "right" },
          },
        ]);

        // "A longer second line" is 100pt wide, so "Short" (25pt) ends with it.
        const left = 20 + TEXT_INSET;
        expect(texts.find((t) => t.text === "Short")?.x).toBeCloseTo(left + 75, 1);
        expect(texts.find((t) => t.text.startsWith("A longer"))?.x).toBeCloseTo(left, 1);
      });

      it("wraps a text box without a width at the page edge, as the editor does", async () => {
        const { texts } = await exportOn([
          {
            type: "text",
            x: 200,
            y: 30,
            content: "aaaa bbbb cccc dddd eeee",
            style: { fontSize: 10 },
          },
        ]);

        // 100pt remain on the 300pt page: four words fit, the fifth wraps.
        expect(texts.map((t) => t.text)).toEqual(["aaaa bbbb cccc dddd", "eeee"]);
        expect(texts[1].y).toBeCloseTo(texts[0].y - 14, 5);
      });

      it("draws each line of plain multi-line text on its own line", async () => {
        const { texts } = await exportOn([
          { type: "text", x: 20, y: 30, content: "one\ntwo", style: { fontSize: 10 } },
        ]);

        expect(texts.map((t) => t.text)).toEqual(["one", "two"]);
        expect(texts[0].y - texts[1].y).toBeCloseTo(14, 5);
      });
    });

    describe("subscript and superscript", () => {
      it("draws them smaller and below or above the baseline", async () => {
        const { texts } = await exportOn([
          {
            type: "textblock",
            x: 20,
            y: 30,
            width: 200,
            richContent: "H<sub>2</sub>O x<sup>2</sup>",
            style: { fontSize: 12 },
          },
        ]);

        // The box top is 400 - 30 = 370. The line starts below the 3 editor px
        // inset (1.125pt on a 300pt page), the baseline below the half-leading
        // (0.2 x 12 at line height 1.4) and 0.8 x 12.
        const baseline = 370 - 1.125 - 2.4 - 9.6;
        expect(texts.map((t) => t.text)).toEqual(["H", "2", "O x", "2"]);
        expect(texts[0]).toMatchObject({ size: 12, x: 20 + BLOCK_INSET });
        expect(texts[0].y).toBeCloseTo(baseline, 5);
        expect(texts[1].size).toBeCloseTo(10, 5);
        expect(texts[1].y).toBeCloseTo(baseline - 12 * 0.2, 5);
        expect(texts[1].x).toBe(20 + BLOCK_INSET + 6);
        // The subscript is measured at its own size: "O x" starts 6 + 5 later.
        expect(texts[2].x).toBeCloseTo(20 + BLOCK_INSET + 11, 5);
        expect(texts[3].size).toBeCloseTo(10, 5);
        expect(texts[3].y).toBeCloseTo(baseline + 12 * 0.35, 5);
      });

      it("measures them at their smaller size when wrapping", async () => {
        // "water H2O": 25 + 5 + (5 + 4.17 + 5) = 44.17pt, which fits 44.5pt.
        const { texts } = await exportOn([
          {
            type: "textblock",
            x: 20,
            y: 30,
            width: 44.5 + BLOCK_WIDTH_EXTRA,
            richContent: "water H<sub>2</sub>O",
            style: { fontSize: 10 },
          },
        ]);

        expect(texts.map((t) => t.text)).toEqual(["water H", "2", "O"]);
        expect(texts[2].y).toBe(texts[0].y);
      });

      it("never splits a word at a style change when wrapping", async () => {
        const { texts } = await exportOn([
          {
            type: "textblock",
            x: 20,
            y: 30,
            width: 40,
            richContent: "water H<sub>2</sub>O",
            style: { fontSize: 10 },
          },
        ]);

        const [water, ...formula] = texts;
        expect(formula.map((t) => t.text)).toEqual(["H", "2", "O"]);
        expect(formula[0].x).toBe(20 + BLOCK_INSET);
        expect(formula[0].y).toBeLessThan(water.y);
        expect(formula[2].y).toBe(formula[0].y);
      });

      it("breaks an over-long word made of several styles between characters", async () => {
        const { texts } = await exportOn([
          {
            type: "textblock",
            x: 0,
            y: 0,
            width: 20 + BLOCK_WIDTH_EXTRA,
            richContent: "abc<b>defg</b>",
            style: { fontSize: 10 },
          },
        ]);

        // 5pt per character: four characters per 20pt line.
        expect(texts.map((t) => t.text)).toEqual(["abc", "d", "efg"]);
        expect(new Set(texts.map((t) => t.y)).size).toBe(2);
      });
    });

    it("makes each line as tall as its largest text", async () => {
      const { texts } = await exportOn([
        {
          type: "textblock",
          x: 20,
          y: 30,
          width: 200,
          richContent: '<span style="font-size: 40px">Big</span><br>next',
          style: { fontSize: 10, lineHeight: 1.2 },
        },
      ]);

      // Lines start below the 1.125pt inset. The 40pt line is 1.2 x 40 = 48pt
      // tall, with 4pt of half-leading above its text; "next" starts 48pt
      // lower, with 1pt of half-leading.
      expect(texts.find((t) => t.text === "Big")?.y).toBeCloseTo(370 - 1.125 - 4 - 32, 5);
      expect(texts.find((t) => t.text === "next")?.y).toBeCloseTo(370 - 1.125 - 48 - 1 - 8, 5);
    });

    it.each(["textblock", "text"])(
      "leaves the stored space before the first line of a %s",
      async (type) => {
        const { texts } = await exportOn([
          {
            type,
            x: 20,
            y: 30,
            width: 200,
            content: "Spaced",
            style: { fontSize: 10, paragraphSpacing: 12 },
          },
        ]);

        // Inset (1.125pt), spacing (12pt), half-leading (0.2 x 10) and 0.8 x 10.
        expect(texts[0].y).toBeCloseTo(400 - 30 - 1.125 - 12 - 2 - 8, 5);
      },
    );

    it.each([
      ["Palatino", "Times-Roman"],
      ["Garamond", "Times-Roman"],
      ["Bookman", "Times-Roman"],
      ["Cambria", "Times-Roman"],
      ["Lucida Console", "Courier"],
      ["Verdana", "Helvetica"],
      ["Impact", "Helvetica"],
    ])("draws the box font %s with the standard font %s", async (font, expected) => {
      const { texts } = await exportOn([
        { type: "text", x: 0, y: 0, content: "x", style: { font, fontSize: 10 } },
      ]);

      expect(texts[0].font).toBe(expected);
    });

    it("draws a rectangle's border in black only when it has one", async () => {
      const { page } = await exportOn([
        { type: "rectangle", x: 0, y: 0, width: 10, height: 10, style: { strokeWidth: 3 } },
        { type: "rectangle", x: 0, y: 0, width: 10, height: 10, style: { strokeWidth: 0 } },
      ]);

      expect(page.drawRectangle.mock.calls[0][0]).toMatchObject({
        borderWidth: 3,
        borderColor: { r: 0, g: 0, b: 0 },
      });
      expect(page.drawRectangle.mock.calls[1][0]).not.toHaveProperty("borderColor");
    });

    /** Corners of a pdf-lib rectangle or image: drawn from (x, y), turned anticlockwise by rotate. */
    const corners = (o: any) => {
      const t = ((o.rotate?.value ?? 0) * Math.PI) / 180;
      return [
        [0, 0],
        [o.width, 0],
        [0, o.height],
        [o.width, o.height],
      ].map(([u, v]) => ({
        x: o.x + u * Math.cos(t) - v * Math.sin(t),
        y: o.y + u * Math.sin(t) + v * Math.cos(t),
      }));
    };
    const bounds = (points: Array<{ x: number; y: number }>) => ({
      minX: Math.min(...points.map((p) => p.x)),
      maxX: Math.max(...points.map((p) => p.x)),
      minY: Math.min(...points.map((p) => p.y)),
      maxY: Math.max(...points.map((p) => p.y)),
    });
    const expectBounds = (actual: ReturnType<typeof bounds>, expected: typeof actual) => {
      for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
        expect(actual[key]).toBeCloseTo(expected[key], 5);
      }
    };

    it("turns an image clockwise about its centre, as the editor shows it", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(2)),
      }) as any;
      const { page } = await exportOn([
        {
          type: "image",
          x: 100,
          y: 100,
          width: 80,
          height: 40,
          content: "data:image/png;base64,x",
          style: { rotation: 90 },
        },
      ]);

      // Centre (140, 120) from the top = (140, 280) from the bottom; turned a
      // quarter, the 80 x 40 image stands 40 wide and 80 tall around it.
      const options = page.drawImage.mock.calls[0][1];
      expect(options.rotate).toEqual({ value: -90 });
      expectBounds(bounds(corners(options)), { minX: 120, maxX: 160, minY: 240, maxY: 320 });
    });

    describe("rotated pages and offset crop boxes", () => {
      /**
       * pdf.js's PageViewport transform at scale 1 (pdfjs-dist 5, display_utils
       * PageViewport), and its inverse: the editor's coordinates are viewport
       * coordinates, so these are where an editor point must land in the PDF.
       */
      const viewportTransform = (viewBox: number[], rotation: number) => {
        const [x0, y0, x1, y1] = viewBox;
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        const r = ((rotation % 360) + 360) % 360;
        const [a, b, c, d] =
          r === 90
            ? [0, 1, 1, 0]
            : r === 180
              ? [-1, 0, 0, 1]
              : r === 270
                ? [0, -1, -1, 0]
                : [1, 0, 0, -1];
        const [ox, oy] =
          a === 0 ? [Math.abs(cy - y0), Math.abs(cx - x0)] : [Math.abs(cx - x0), Math.abs(cy - y0)];
        return [a, b, c, d, ox - a * cx - c * cy, oy - b * cx - d * cy];
      };
      const toPdfPoint = (m: number[], x: number, y: number) => {
        const det = m[0] * m[3] - m[1] * m[2];
        return {
          x: (x * m[3] - y * m[2] + m[2] * m[5] - m[4] * m[3]) / det,
          y: (-x * m[1] + y * m[0] + m[4] * m[1] - m[5] * m[0]) / det,
        };
      };

      const media = { x: 0, y: 0, width: 600, height: 800 };
      const crop = { x: 50, y: 30, width: 400, height: 600 };
      const viewBox = [50, 30, 450, 630];

      it.each([0, 90, 180, 270])(
        "puts annotations where the editor showed them on a page turned %i°",
        async (rotation) => {
          const m = viewportTransform(viewBox, rotation);
          const mapped = (points: number[][]) =>
            bounds(points.map(([x, y]) => toPdfPoint(m, x, y)));

          const { page, texts } = await exportOn(
            [
              { type: "rectangle", x: 10, y: 20, width: 100, height: 50 },
              { type: "text", x: 30, y: 40, content: "Hi", style: { fontSize: 10 } },
              {
                type: "freehand",
                x: 5,
                y: 6,
                points: [
                  { x: 0, y: 0 },
                  { x: 30, y: 40 },
                ],
              },
              {
                type: "image",
                x: 200,
                y: 150,
                width: 60,
                height: 30,
                content: "data:image/png;base64,x",
              },
            ],
            { rotation, crop, media },
            [{ pageIndex: 0, x: 15, y: 25, width: 20, height: 10 }],
          );

          const [whiteOut, rectangle] = page.drawRectangle.mock.calls.map(([o]: any[]) => o);
          // The white-out covers the source region plus 1pt on every side.
          expectBounds(
            bounds(corners(whiteOut)),
            mapped([
              [14, 24],
              [36, 36],
            ]),
          );
          expectBounds(
            bounds(corners(rectangle)),
            mapped([
              [10, 20],
              [110, 70],
            ]),
          );
          expectBounds(
            bounds(corners(page.drawImage.mock.calls[0][1])),
            mapped([
              [200, 150],
              [260, 180],
            ]),
          );

          // Text starts at its baseline and runs along the page as shown. The
          // baseline is below the 3 editor px inset (the shown page is 800 editor
          // px wide), the half-leading (0.2 x 10) and 0.8 x 10.
          // It also starts 5 editor px in from the box's left edge.
          const shownWidth = rotation % 180 === 0 ? 400 : 600;
          const editorPx = shownWidth / 800;
          const start = toPdfPoint(m, 30 + 5 * editorPx, 40 + 3 * editorPx + 2 + 8);
          expect(texts[0].x).toBeCloseTo(start.x, 5);
          expect(texts[0].y).toBeCloseTo(start.y, 5);
          expect(texts[0].rotate).toEqual({ value: rotation });

          const line = page.drawLine.mock.calls[0][0];
          const from = toPdfPoint(m, 5, 6);
          const to = toPdfPoint(m, 35, 46);
          expect(line.start.x).toBeCloseTo(from.x, 5);
          expect(line.start.y).toBeCloseTo(from.y, 5);
          expect(line.end.x).toBeCloseTo(to.x, 5);
          expect(line.end.y).toBeCloseTo(to.y, 5);
        },
      );

      it.each([
        [90, 600],
        [270, 600],
        [0, 400],
      ])("wraps text to the shown width of a page turned %i°", async (rotation, shownWidth) => {
        const words = Array.from({ length: 30 }, () => "word").join(" ");
        const { texts } = await exportOn(
          [{ type: "text", x: 0, y: 0, content: words, style: { fontSize: 10 } }],
          { rotation, crop, media },
        );

        // "word " is 25pt. The text has the shown width less 5 editor px on
        // each side: 592.5pt of a 600pt page fits 23 words, 395pt of 400pt 16.
        const textWidth = shownWidth - 2 * 5 * (shownWidth / 800);
        expect(texts[0].text.split(" ")).toHaveLength(Math.floor((textWidth + 5) / 25));
      });

      it("treats -90° like 270° and ignores a turn that is not a quarter", async () => {
        const turned = await exportOn([{ type: "text", x: 0, y: 0, content: "a" }], {
          rotation: -90,
        });
        expect(turned.texts[0].rotate).toEqual({ value: 270 });

        const skewed = await exportOn([{ type: "text", x: 0, y: 0, content: "a" }], {
          rotation: 45,
        });
        expect(skewed.texts[0].rotate).toEqual({ value: 0 });
      });

      it("reads a reversed media box [x1 y1 x0 y0] the way pdf.js does", async () => {
        const reversed = { x: 0, y: 800, width: 600, height: -800 };
        const { page } = await exportOn(
          [{ type: "rectangle", x: 10, y: 20, width: 30, height: 40 }],
          { media: reversed, crop: reversed },
        );

        // On the normal 600 x 800 page the rectangle's bottom is 800 - 20 - 40.
        expect(page.drawRectangle.mock.calls[0][0]).toMatchObject({ x: 10, y: 740 });
      });

      it("uses the media box when the crop box lies outside it", async () => {
        const { page } = await exportOn(
          [{ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }],
          { crop: { x: 900, y: 900, width: 50, height: 50 }, media },
        );

        expect(page.drawRectangle.mock.calls[0][0]).toMatchObject({ x: 0, y: 790 });
      });
    });
  });
});
