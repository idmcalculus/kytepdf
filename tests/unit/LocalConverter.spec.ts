import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendSheet: vi.fn(),
  aoaToSheet: vi.fn((rows: string[][]) => ({ rows })),
  bookNew: vi.fn(() => ({ sheets: [] })),
  loadProcessable: vi.fn(),
  packToBlob: vi.fn(async () => new Blob(["docx"])),
  writeWorkbook: vi.fn(() => new Uint8Array([1, 2, 3]).buffer),
  yieldToMain: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("docx", () => ({
  Document: vi.fn(function Document(this: any, options: any) {
    this.options = options;
  }),
  Packer: {
    toBlob: mocks.packToBlob,
  },
  Paragraph: vi.fn(function Paragraph(this: any, options: any) {
    this.options = options;
  }),
  TextRun: vi.fn(function TextRun(this: any, text: string) {
    this.text = text;
  }),
}));

vi.mock("xlsx", () => ({
  utils: {
    aoa_to_sheet: mocks.aoaToSheet,
    book_append_sheet: mocks.appendSheet,
    book_new: mocks.bookNew,
  },
  write: mocks.writeWorkbook,
}));

vi.mock("../../utils/pdfSecurity.ts", () => ({
  loadProcessablePdfJsDocument: mocks.loadProcessable,
}));

vi.mock("../../utils/taskScheduler.ts", () => ({
  yieldToMain: mocks.yieldToMain,
}));

import { LocalConverter } from "../../utils/LocalConverter";

type TextItem = {
  str?: string;
  transform?: number[];
};

const textItem = (text: string, x: number, y: number): TextItem => ({
  str: text,
  transform: [1, 0, 0, 1, x, y],
});

const setupPdf = (pages: TextItem[][]) => {
  const getPage = vi.fn(async (pageNumber: number) => ({
    getTextContent: vi.fn(async () => ({
      items: pages[pageNumber - 1],
    })),
  }));

  mocks.loadProcessable.mockResolvedValue({
    pdfDoc: {
      getPage,
      numPages: pages.length,
    },
  });

  return { getPage };
};

describe("LocalConverter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.packToBlob.mockResolvedValue(new Blob(["docx"]));
    mocks.writeWorkbook.mockReturnValue(new Uint8Array([1, 2, 3]).buffer);
  });

  it("assesses quality from extracted text density and caches extraction by byte object", async () => {
    setupPdf([
      Array.from({ length: 90 }, (_, index) => textItem(`word-${index}`, index * 5, 700)),
      Array.from({ length: 90 }, (_, index) => textItem(`more-${index}`, index * 5, 680)),
    ]);
    const converter = new LocalConverter();
    const bytes = new Uint8Array([1, 2, 3]);

    await expect(converter.assessQuality(bytes, "docx")).resolves.toBe("good");
    await expect(converter.assessQuality(bytes, "xlsx")).resolves.toBe("good");

    expect(mocks.loadProcessable).toHaveBeenCalledTimes(1);
    expect(mocks.yieldToMain).toHaveBeenCalledTimes(1);
  });

  it("returns fair and poor quality for lower text density", async () => {
    setupPdf([Array.from({ length: 30 }, (_, index) => textItem(`cell-${index}`, index, 600))]);
    await expect(new LocalConverter().assessQuality(new Uint8Array([1]), "docx")).resolves.toBe(
      "fair",
    );

    setupPdf([Array.from({ length: 8 }, (_, index) => textItem(`few-${index}`, index, 600))]);
    await expect(new LocalConverter().assessQuality(new Uint8Array([2]), "docx")).resolves.toBe(
      "poor",
    );
  });

  it("builds a Word document from grouped lines and paragraphs", async () => {
    setupPdf([
      [
        textItem("Heading", 10, 700),
        textItem("One", 10, 680),
        textItem("continues", 50, 680),
        textItem("Next", 10, 620),
        { str: "   ", transform: [1, 0, 0, 1, 10, 600] },
        { str: "No position" },
      ],
    ]);

    const result = await new LocalConverter().pdfToWord(new Uint8Array([1]));

    expect(result).toEqual(
      expect.objectContaining({
        data: expect.any(Uint8Array),
        quality: "poor",
        success: true,
        warnings: ["Layout may be incomplete. Consider cloud conversion for better quality."],
      }),
    );
    expect(result.data).toBeInstanceOf(Uint8Array);
    expect(mocks.packToBlob).toHaveBeenCalled();
  });

  it("adds an empty-output warning for Word documents without extractable text", async () => {
    setupPdf([[{ str: "  ", transform: [1, 0, 0, 1, 0, 0] }]]);

    const result = await new LocalConverter().pdfToWord(new Uint8Array([1]));

    expect(result.success).toBe(true);
    expect(result.quality).toBe("poor");
    expect(result.warnings).toContain("No selectable text detected.");
    expect(result.warnings).toContain("No extractable text found; output may be empty.");
  });

  it("returns a failure result when Word conversion throws", async () => {
    setupPdf([[textItem("Hello", 10, 700)]]);
    mocks.packToBlob.mockRejectedValueOnce(new Error("pack failed"));

    const result = await new LocalConverter().pdfToWord(new Uint8Array([1]));

    expect(result).toEqual({
      data: null,
      quality: "poor",
      success: false,
      warnings: ["Local conversion failed."],
    });
  });

  it("builds Excel rows by line and x-position gaps", async () => {
    setupPdf([
      [
        textItem("Name", 10, 700),
        textItem("Amount", 80, 700),
        textItem("Alice", 10, 680),
        textItem("42", 80, 680),
        textItem("continued", 88, 680),
      ],
    ]);

    const result = await new LocalConverter().pdfToExcel(new Uint8Array([1]));

    expect(result.success).toBe(true);
    expect(result.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(mocks.aoaToSheet).toHaveBeenCalledWith([
      ["Name", "Amount"],
      ["Alice", "42 continued"],
    ]);
    expect(mocks.appendSheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), "Sheet1");
  });

  it("creates a blank Excel sheet and warnings when no text is found", async () => {
    setupPdf([[]]);

    const result = await new LocalConverter().pdfToExcel(new Uint8Array([1]));

    expect(result.success).toBe(true);
    expect(result.quality).toBe("poor");
    expect(result.warnings).toContain("No selectable text detected.");
    expect(result.warnings).toContain("No extractable text found; output may be empty.");
    expect(mocks.aoaToSheet).toHaveBeenCalledWith([[""]]);
  });

  it("returns a failure result when Excel conversion throws", async () => {
    setupPdf([[textItem("Hello", 10, 700)]]);
    mocks.writeWorkbook.mockImplementationOnce(() => {
      throw new Error("write failed");
    });

    const result = await new LocalConverter().pdfToExcel(new Uint8Array([1]));

    expect(result).toEqual({
      data: null,
      quality: "poor",
      success: false,
      warnings: ["Local conversion failed."],
    });
  });

  it("adds a fair-quality warning when local conversion has moderate text density", async () => {
    setupPdf([Array.from({ length: 30 }, (_, index) => textItem(`text-${index}`, index, 700))]);

    const result = await new LocalConverter().pdfToWord(new Uint8Array([1]));

    expect(result.quality).toBe("fair");
    expect(result.warnings).toContain("Some layout fidelity may be reduced in local mode.");
  });
});
