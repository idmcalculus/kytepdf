import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendSheet: vi.fn(),
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
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
  HeadingLevel: {
    HEADING_1: "Heading1",
    HEADING_2: "Heading2",
    HEADING_3: "Heading3",
    HEADING_4: "Heading4",
    HEADING_5: "Heading5",
    HEADING_6: "Heading6",
  },
  Packer: {
    toBlob: mocks.packToBlob,
  },
  Paragraph: vi.fn(function Paragraph(this: any, options: any) {
    this.options = options;
  }),
  Table: vi.fn(function Table(this: any, options: any) {
    this.kind = "table";
    this.options = options;
  }),
  TableCell: vi.fn(function TableCell(this: any, options: any) {
    this.options = options;
  }),
  TableRow: vi.fn(function TableRow(this: any, options: any) {
    this.options = options;
  }),
  TextRun: vi.fn(function TextRun(this: any, text: any) {
    this.text = text;
  }),
  WidthType: { PERCENTAGE: "pct" },
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

vi.mock("../../utils/logger.ts", () => ({ logger: mocks.logger }));

import { Document } from "docx";
import { type ConversionResult, LocalConverter } from "../../utils/LocalConverter";

type TextItem = {
  str?: unknown;
  transform?: number[];
  fontName?: unknown;
};

/** A 12pt text item at (x, y), as pdf.js reports it. */
const textItem = (text: string, x: number, y: number): TextItem => ({
  str: text,
  transform: [12, 0, 0, 12, x, y],
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

/** A text item with a font size (from the transform) and font name, as pdf.js reports them. */
const richItem = (
  text: string,
  x: number,
  y: number,
  size = 10,
  fontName = "Helvetica",
): TextItem => ({
  str: text,
  transform: [size, 0, 0, size, x, y],
  fontName,
});

/** Single-font items stacked down a column, 12pt apart, starting at `top`. */
const column = (texts: string[], x: number, top: number, step = 12) =>
  texts.map((text, i) => richItem(text, x, top - i * step));

const decode = (result: ConversionResult) =>
  new TextDecoder().decode(result.data ?? new Uint8Array());

/**
 * The paragraphs handed to the last docx Document, written out as
 * "Heading1 text", "bullet(0) text" or plain text, with bold runs in <b>.
 */
const runText = (run: any): string => {
  if (typeof run.text === "string") return run.text;
  let text = run.text.text;
  if (run.text.strike) text = `<s>${text}</s>`;
  if (run.text.italics) text = `<i>${text}</i>`;
  if (run.text.bold) text = `<b>${text}</b>`;
  return text;
};

const describeParagraph = (paragraph: any): string => {
  const text = paragraph.options.children.map(runText).join("");
  if (paragraph.options.heading) return `${paragraph.options.heading} ${text}`;
  if (paragraph.options.bullet) return `bullet(${paragraph.options.bullet.level}) ${text}`;
  if (paragraph.options.indent) return `indent(${paragraph.options.indent.left}) ${text}`;
  return text;
};

/** "table[th: a | b / c | d]": rows split by " / ", cells by " | ", header rows marked. */
const describeTable = (table: any): string => {
  const rows = table.options.rows.map((row: any) => {
    const cells = row.options.children.map((cell: any) =>
      cell.options.children.map(describeParagraph).join(" "),
    );
    return `${row.options.tableHeader ? "th: " : ""}${cells.join(" | ")}`;
  });
  return `table[${rows.join(" / ")}]`;
};

/**
 * The blocks handed to the last docx Document, written out as
 * "Heading1 text", "bullet(0) text", "indent(720) text", "table[...]" or
 * plain text, with <b>, <i> and <s> around styled runs.
 */
const docxParagraphs = (): string[] => {
  const options = (Document as unknown as Mock).mock.calls.at(-1)?.[0];
  return options.sections[0].children.map((block: any) =>
    block.kind === "table" ? describeTable(block) : describeParagraph(block),
  );
};

const FAILED: ConversionResult = {
  data: null,
  quality: "poor",
  success: false,
  warnings: ["Local conversion failed."],
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
        warnings: [
          "Layout may be incomplete. Try enabling OCR for scanned pages, or use a text-based PDF.",
        ],
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

  describe("envelope-aware semantic export", () => {
    const baseEnvelope = {
      fileType: "application/pdf" as const,
      pdfType: "TextBased" as const,
      pageCount: 1,
      confidence: 0.9,
      markdown: "# Title\n\nPara one.\n\n- bullet A\n- bullet B\n\n**bold word** plain",
      layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
      pagesNeedingOcr: [],
      ocrReasonsByPage: [],
      hasEncodingIssues: false,
      engine: "pdf-inspector-wasm" as const,
      engineVersion: "1.14.1",
      processingTimeMs: 5,
      warnings: [],
    };

    it("builds a semantic DOCX from the envelope markdown, preserving headings/lists/bold", async () => {
      const result = await new LocalConverter().pdfToWordFromEnvelope(
        new Uint8Array([1]),
        baseEnvelope,
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(mocks.packToBlob).toHaveBeenCalled();
      expect(docxParagraphs()).toEqual([
        "Heading1 Title",
        "Para one.",
        "bullet(0) bullet A",
        "bullet(0) bullet B",
        "<b>bold word</b> plain",
      ]);
    });

    it("rates quality from the engine confidence rather than text density", async () => {
      const good = await new LocalConverter().pdfToWordFromEnvelope(
        new Uint8Array([1]),
        baseEnvelope,
      );
      expect(good.quality).toBe("good");

      const scanned = await new LocalConverter().pdfToWordFromEnvelope(new Uint8Array([1]), {
        ...baseEnvelope,
        pdfType: "Scanned",
        confidence: 0.9,
        pagesNeedingOcr: [1],
      });
      expect(scanned.quality).toBe("fair");
      expect(scanned.warnings.some((w) => w.includes("Output excludes"))).toBe(true);

      const lowConf = await new LocalConverter().pdfToWordFromEnvelope(new Uint8Array([1]), {
        ...baseEnvelope,
        confidence: 0.3,
      });
      expect(lowConf.quality).toBe("poor");
    });

    it("does not emit page markers or horizontal rules as document text", async () => {
      // `analyze` requests includePageMarkers:true so OCR can be merged in page
      // order — those markers are scaffolding and must not reach the DOCX.
      const { Paragraph, TextRun } = await import("docx");
      (Paragraph as unknown as ReturnType<typeof vi.fn>).mockClear();
      (TextRun as unknown as ReturnType<typeof vi.fn>).mockClear();

      const result = await new LocalConverter().pdfToWordFromEnvelope(new Uint8Array([1]), {
        ...baseEnvelope,
        markdown: "<!-- Page 1 -->\n\nReal content\n\n---\n\n<!-- Page 2 -->\n\nMore content",
      });

      expect(result.success).toBe(true);

      const runTexts = (TextRun as unknown as ReturnType<typeof vi.fn>).mock.calls
        .map(([arg]) => (typeof arg === "string" ? arg : (arg?.text ?? "")))
        .join("\n");

      expect(runTexts).toContain("Real content");
      expect(runTexts).toContain("More content");
      expect(runTexts).not.toContain("<!-- Page");
      expect(runTexts).not.toMatch(/^---$/m);
    });

    it("falls back to the legacy word path when the envelope has no markdown", async () => {
      setupPdf([Array.from({ length: 90 }, (_, i) => textItem(`word-${i}`, i, 700))]);
      const result = await new LocalConverter().pdfToWordFromEnvelope(new Uint8Array([1]), {
        ...baseEnvelope,
        markdown: undefined,
      });
      expect(result.success).toBe(true);
      expect(result.quality).toBe("good");
    });

    const tableEnvelope = {
      ...baseEnvelope,
      markdown: "| SKU | Qty |\n|---|---|\n| A-1 | 10 |\n| B-2 | 4 |",
      layout: { isComplex: true, pagesWithTables: [1], pagesWithColumns: [] },
    };

    it("builds an XLSX from detected markdown tables", async () => {
      const result = await new LocalConverter().pdfToExcelFromEnvelope(
        new Uint8Array([1]),
        tableEnvelope,
      );
      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(result.quality).toBe("good");
      // Header + two data rows; the separator row is filtered out.
      expect(mocks.aoaToSheet).toHaveBeenCalledWith([
        ["SKU", "Qty"],
        ["A-1", "10"],
        ["B-2", "4"],
      ]);
    });

    it("uses the legacy column-aware xlsx for a native PDF with no tables", async () => {
      setupPdf([[textItem("Name", 10, 700), textItem("Qty", 80, 700)]]);
      const result = await new LocalConverter().pdfToExcelFromEnvelope(
        new Uint8Array([1]),
        baseEnvelope,
      );
      expect(result.success).toBe(true);
      expect(mocks.loadProcessable).toHaveBeenCalledTimes(1);
      expect(mocks.aoaToSheet).toHaveBeenCalledWith([["Name", "Qty"]]);
    });

    it.each([
      "Scanned",
      "Mixed",
      "ImageBased",
    ] as const)("keeps the envelope's (OCR) text for a %s PDF with no tables", async (pdfType) => {
      const result = await new LocalConverter().pdfToExcelFromEnvelope(new Uint8Array([1]), {
        ...baseEnvelope,
        pdfType,
        confidence: 0.9,
        markdown: "<!-- Page 1 -->\n\n## Line A\n\n- Line **B**\n\n<!-- Page 2 -->\n\n> Line C",
      });

      expect(result.success).toBe(true);
      // pdf.js cannot see text that only OCR found, so it must not be used.
      expect(mocks.loadProcessable).not.toHaveBeenCalled();
      expect(sheets()).toEqual([["Sheet1", [["Line A"], ["Line B"], ["Line C"]]]]);
      expect(result.warnings).toEqual([
        "No tables were found; the text was written one line per row.",
      ]);
    });

    it("uses the legacy xlsx when the envelope Markdown has no text at all", async () => {
      setupPdf([[textItem("Name", 10, 700)]]);

      const result = await new LocalConverter().pdfToExcelFromEnvelope(new Uint8Array([1]), {
        ...baseEnvelope,
        pdfType: "Scanned",
        markdown: "<!-- Page 1 -->\n\n---",
      });

      expect(result.success).toBe(true);
      expect(mocks.loadProcessable).toHaveBeenCalledTimes(1);
    });

    const wordBlocksFor = async (lines: string[]) => {
      const result = await new LocalConverter().pdfToWordFromEnvelope(new Uint8Array([1]), {
        ...baseEnvelope,
        markdown: lines.join("\r\n"),
      });
      expect(result.success).toBe(true);
      return docxParagraphs();
    };

    it("maps Markdown headings to Word heading levels, with styled runs inside", async () => {
      await expect(
        wordBlocksFor([
          "# Title with **bold** and *italic* ##",
          "## Section",
          "### Sub",
          "#### Fourth",
          "##### Fifth",
          "###### Sixth",
          "####### Seven hashes is text",
          "# C# in practice",
        ]),
      ).resolves.toEqual([
        "Heading1 Title with <b>bold</b> and <i>italic</i>",
        "Heading2 Section",
        "Heading3 Sub",
        "Heading4 Fourth",
        "Heading5 Fifth",
        "Heading6 Sixth",
        "####### Seven hashes is text",
        "Heading1 C# in practice",
      ]);
    });

    it("turns emphasis markers into bold, italic and struck-through runs", async () => {
      await expect(
        wordBlocksFor([
          "Intro with **bold**, __strong__, *em*, _em_, ***both*** and ~~gone~~ words.",
          "**Only bold**",
          "**bold *and italic***",
        ]),
      ).resolves.toEqual([
        "Intro with <b>bold</b>, <b>strong</b>, <i>em</i>, <i>em</i>, <b><i>both</i></b> and <s>gone</s> words.",
        "<b>Only bold</b>",
        "<b>bold </b><b><i>and italic</i></b>",
      ]);
    });

    it("keeps link and image text, code and escaped characters, and leaves non-emphasis alone", async () => {
      await expect(
        wordBlocksFor([
          "See [the guide](https://example.com/guide), ![chart](img.png) or <https://example.com>.",
          "Keep `a*b*c` and \\*stars\\* and snake_case_name and 2 * 3 * 4 as typed.",
        ]),
      ).resolves.toEqual([
        "See the guide, chart or https://example.com.",
        "Keep a*b*c and *stars* and snake_case_name and 2 * 3 * 4 as typed.",
      ]);
    });

    it("gives nested bullets deeper levels and indents nested numbered items", async () => {
      await expect(
        wordBlocksFor([
          "- dash item   ",
          "  - nested item",
          "    - deeper item",
          "  - back one level",
          "* star item",
          "+ plus item",
          "1. First step",
          "    1. Sub step",
          "12. Twelfth step with **bold**",
          "Paragraph between lists.",
          "\t- tab-indented list start",
        ]),
      ).resolves.toEqual([
        "bullet(0) dash item",
        "bullet(1) nested item",
        "bullet(2) deeper item",
        "bullet(1) back one level",
        "bullet(0) star item",
        "bullet(0) plus item",
        // Numbered items keep their numbers: the document has no list numbering.
        "1. First step",
        "indent(720) 1. Sub step",
        "12. Twelfth step with <b>bold</b>",
        "Paragraph between lists.",
        "bullet(0) tab-indented list start",
      ]);
    });

    it("indents quotes, keeps code blocks verbatim and drops rules", async () => {
      await expect(
        wordBlocksFor([
          "> Quoted **text**",
          ">",
          "***",
          "* * *",
          "___",
          "```js",
          "const x = **not bold**;",
          "",
          "| not | a table |",
          "```",
          "Plain closing line.   ",
        ]),
      ).resolves.toEqual([
        "indent(720) Quoted <b>text</b>",
        "const x = **not bold**;",
        "| not | a table |",
        "Plain closing line.",
      ]);
    });

    it("renders pipe tables as Word tables with a bold header row", async () => {
      await expect(
        wordBlocksFor([
          "Before the table.",
          "| Name | Notes |",
          "|:---|---:|",
          "| Ada | wrote *notes* |",
          "| Bob \\| Co | |",
          "| Cy |",
          "After the table.",
          "| No | Header |",
          "| 1 | 2 |",
        ]),
      ).resolves.toEqual([
        "Before the table.",
        "table[th: <b>Name</b> | <b>Notes</b> / Ada | wrote <i>notes</i> / Bob | Co |  / Cy | ]",
        "After the table.",
        "table[No | Header / 1 | 2]",
      ]);

      const { Table } = await import("docx");
      expect(vi.mocked(Table).mock.calls[0][0]).toMatchObject({
        width: { size: 100, type: "pct" },
      });
    });

    it("warns about encoding problems and every page left out for OCR", async () => {
      const result = await new LocalConverter().pdfToWordFromEnvelope(new Uint8Array([1]), {
        ...baseEnvelope,
        hasEncodingIssues: true,
        pagesNeedingOcr: [2, 5],
      });

      expect(result.success).toBe(true);
      expect(result.quality).toBe("fair");
      expect(result.warnings).toEqual([
        "Source PDF reported encoding issues; some characters may be missing.",
        "Output excludes pages 2, 5 (OCR needed).",
      ]);
    });

    it("warns when the Markdown holds only page markers and rules", async () => {
      const result = await new LocalConverter().pdfToWordFromEnvelope(new Uint8Array([1]), {
        ...baseEnvelope,
        markdown: "<!-- Page 1 -->\n\n---\n\n<!-- page 2 -->",
      });

      expect(result.success).toBe(true);
      expect(docxParagraphs()).toEqual([]);
      expect(result.warnings).toEqual(["No extractable text found; output may be empty."]);
    });

    it("uses the legacy path for Markdown that is only whitespace", async () => {
      setupPdf([[textItem("From pdf.js", 10, 700)]]);

      const result = await new LocalConverter().pdfToWordFromEnvelope(new Uint8Array([1]), {
        ...baseEnvelope,
        markdown: "  \n\n ",
      });

      expect(result.success).toBe(true);
      expect(mocks.loadProcessable).toHaveBeenCalledTimes(1);
      expect(docxParagraphs()).toEqual(["From pdf.js"]);
    });

    it("returns a failure result when the semantic Word export throws", async () => {
      mocks.packToBlob.mockRejectedValueOnce(new Error("pack failed"));

      const result = await new LocalConverter().pdfToWordFromEnvelope(
        new Uint8Array([1]),
        baseEnvelope,
      );

      expect(result).toEqual(FAILED);
      expect(mocks.logger.error).toHaveBeenCalledWith(
        "Local PDF to Word (envelope) conversion failed",
        expect.any(Error),
      );
    });

    it.each([
      ["TextBased", 0.6, false, "fair"],
      ["TextBased", 0.49, false, "poor"],
      ["Scanned", 0.5, false, "poor"],
      ["Mixed", 0.75, false, "fair"],
      ["Mixed", 0.74, false, "poor"],
      ["ImageBased", 0.99, false, "poor"],
      ["Unknown", 0.9, false, "good"],
      ["TextBased", 0.95, true, "fair"],
    ] as const)("rates a %s Word export at confidence %s (encoding issues: %s) as %s", async (pdfType, confidence, hasEncodingIssues, expected) => {
      const result = await new LocalConverter().pdfToWordFromEnvelope(new Uint8Array([1]), {
        ...baseEnvelope,
        pdfType,
        confidence,
        hasEncodingIssues,
      });
      expect(result.quality).toBe(expected);
    });

    it.each([
      ["TextBased", 0.6, "good"],
      ["TextBased", 0.59, "fair"],
      ["Scanned", 0.9, "fair"],
      ["ImageBased", 0.9, "poor"],
    ] as const)("rates a %s Excel export at confidence %s as %s", async (pdfType, confidence, expected) => {
      const result = await new LocalConverter().pdfToExcelFromEnvelope(new Uint8Array([1]), {
        ...tableEnvelope,
        pdfType,
        confidence,
      });
      expect(result.quality).toBe(expected);
    });

    /** [sheet name, rows] for every worksheet added to the workbook. */
    const sheets = () =>
      mocks.appendSheet.mock.calls.map(([, sheet, name]: any[]) => [name, sheet.rows]);

    it("writes each table to its own worksheet named after its page", async () => {
      const result = await new LocalConverter().pdfToExcelFromEnvelope(new Uint8Array([1]), {
        ...tableEnvelope,
        markdown: [
          "<!-- Page 1 -->",
          "## Orders",
          "| SKU | Qty | Price |",
          "| :--- | :-: | ---: |",
          "| A-1 |  10 | **2.50** |",
          "",
          "Totals follow.",
          "<!-- Page 3 -->",
          "|Region|Sales|",
          "|------|-----|",
          "|North|[1200](https://example.com/n)|",
          "| not a row",
          "|Q|Notes|",
          "|1|a \\| b|",
        ].join("\n"),
      });

      expect(result.success).toBe(true);
      expect(result.warnings).toEqual([]);
      // Separator rows are left out, Markdown in cells is resolved, and the
      // prose between tables goes to a Text sheet.
      expect(sheets()).toEqual([
        [
          "Table 1 (p.1)",
          [
            ["SKU", "Qty", "Price"],
            ["A-1", "10", "2.50"],
          ],
        ],
        [
          "Table 2 (p.3)",
          [
            ["Region", "Sales"],
            ["North", "1200"],
          ],
        ],
        [
          "Table 3 (p.3)",
          [
            ["Q", "Notes"],
            ["1", "a | b"],
          ],
        ],
        ["Text", [["Orders"], ["Totals follow."], ["| not a row"]]],
      ]);
    });

    it("names worksheets by position alone when the Markdown has no page markers", async () => {
      await new LocalConverter().pdfToExcelFromEnvelope(new Uint8Array([1]), tableEnvelope);

      expect(sheets()).toEqual([
        [
          "Table 1",
          [
            ["SKU", "Qty"],
            ["A-1", "10"],
            ["B-2", "4"],
          ],
        ],
      ]);
    });

    it("writes the text as rows when the detected tables have no pipe rows", async () => {
      const result = await new LocalConverter().pdfToExcelFromEnvelope(new Uint8Array([1]), {
        ...tableEnvelope,
        markdown: "Revenue 2024: 1200\nCosts 2024: 800",
      });

      expect(result.success).toBe(true);
      expect(result.warnings).toEqual([
        "No tables were found; the text was written one line per row.",
      ]);
      expect(sheets()).toEqual([["Sheet1", [["Revenue 2024: 1200"], ["Costs 2024: 800"]]]]);
      // No table was parsed, so the result is not rated "good".
      expect(result.quality).toBe("fair");
      expect(mocks.loadProcessable).not.toHaveBeenCalled();
    });

    it("keeps the text around tables on a Text sheet", async () => {
      const result = await new LocalConverter().pdfToExcelFromEnvelope(new Uint8Array([1]), {
        ...tableEnvelope,
        markdown: [
          "## Invoice 1042",
          "Bill to: Acme Ltd",
          "|SKU|Qty|",
          "|---|---|",
          "|A-100|10|",
          "Payment due within 30 days.",
          "```",
          "# raw note",
          "```",
        ].join("\n"),
      });

      expect(result.success).toBe(true);
      expect(sheets()).toEqual([
        [
          "Table 1",
          [
            ["SKU", "Qty"],
            ["A-100", "10"],
          ],
        ],
        [
          "Text",
          [
            ["Invoice 1042"],
            ["Bill to: Acme Ltd"],
            ["Payment due within 30 days."],
            ["# raw note"],
          ],
        ],
      ]);
    });

    it("falls back to legacy xlsx when the envelope has no Markdown, even with tables", async () => {
      setupPdf([[textItem("Name", 10, 700), textItem("Qty", 80, 700)]]);

      const result = await new LocalConverter().pdfToExcelFromEnvelope(new Uint8Array([1]), {
        ...tableEnvelope,
        markdown: undefined,
      });

      expect(result.success).toBe(true);
      expect(mocks.aoaToSheet).toHaveBeenCalledWith([["Name", "Qty"]]);
    });

    it("returns a failure result when the table export throws", async () => {
      mocks.writeWorkbook.mockImplementationOnce(() => {
        throw new Error("write failed");
      });

      const result = await new LocalConverter().pdfToExcelFromEnvelope(
        new Uint8Array([1]),
        tableEnvelope,
      );

      expect(result).toEqual(FAILED);
      expect(mocks.logger.error).toHaveBeenCalledWith(
        "Local PDF to Excel (envelope) conversion failed",
        expect.any(Error),
      );
    });
  });

  describe("legacy Word paragraphs", () => {
    it("joins close lines into one paragraph and starts a new one at gaps and page breaks", async () => {
      setupPdf([
        [
          textItem("line", 60, 688),
          textItem("First", 10, 700),
          textItem("second", 10, 688),
          textItem("Next paragraph", 10, 660),
        ],
        [textItem("Page two", 10, 700)],
      ]);

      await new LocalConverter().pdfToWord(new Uint8Array([1]));

      expect(docxParagraphs()).toEqual(["First second line", "Next paragraph", "Page two"]);
    });

    it("keeps 12pt lines at normal spacing together and splits at extra space or a size change", async () => {
      // 14.4pt baseline steps (1.2 line spacing), then 6pt of space after the
      // paragraph, then an 18pt heading over 12pt body text.
      setupPdf([
        [
          textItem("Line one", 10, 700),
          textItem("line two", 10, 685.6),
          textItem("line three", 10, 671.2),
          textItem("Next paragraph", 10, 650.8),
          richItem("Heading", 10, 620, 18),
          textItem("Body under it", 10, 600),
        ],
      ]);

      await new LocalConverter().pdfToWord(new Uint8Array([1]));
      expect(docxParagraphs()).toEqual([
        "Line one line two line three",
        "Next paragraph",
        "Heading",
        "Body under it",
      ]);

      const text = await new LocalConverter().pdfToText(new Uint8Array([2]));
      expect(decode(text)).toBe(
        "Line one\nline two\nline three\n\nNext paragraph\n\nHeading\n\nBody under it\n",
      );
    });
  });

  describe("plain text export", () => {
    it("writes lines in reading order with blank lines between paragraphs and pages", async () => {
      setupPdf([
        [
          textItem("world", 60, 700),
          textItem("Hello", 10, 700),
          textItem("Second line", 10, 686),
          textItem("New paragraph", 10, 650),
        ],
        [textItem("Page two", 10, 700)],
        [],
      ]);

      const result = await new LocalConverter().pdfToText(new Uint8Array([1]));

      expect(result.success).toBe(true);
      expect(decode(result)).toBe("Hello world\nSecond line\n\nNew paragraph\n\nPage two\n");
    });

    it("cleans up item text and tolerates items without positions or names", async () => {
      setupPdf([
        [
          { str: "  padded  ", transform: [1, 0, 0, 1, 10, 700] },
          { str: 42 as unknown as string, transform: [1, 0, 0, 1, 10, 690] },
          { str: "No transform", fontName: { name: "obj" } },
        ],
      ]);

      const result = await new LocalConverter().pdfToText(new Uint8Array([1]));

      // The positionless item sits at (0, 0), below everything else.
      expect(decode(result)).toBe("padded\n\nNo transform\n");
    });

    it("warns when no text can be extracted", async () => {
      setupPdf([[], []]);

      const result = await new LocalConverter().pdfToText(new Uint8Array([1]));

      expect(result.success).toBe(true);
      expect(decode(result)).toBe("");
      expect(result.warnings).toEqual([
        "No selectable text detected.",
        "Layout may be incomplete. Try enabling OCR for scanned pages, or use a text-based PDF.",
        "No extractable text found; output may be empty.",
      ]);
    });

    it("returns a failure result when the PDF cannot be opened", async () => {
      mocks.loadProcessable.mockRejectedValueOnce(new Error("encrypted"));

      await expect(new LocalConverter().pdfToText(new Uint8Array([1]))).resolves.toEqual(FAILED);
      expect(mocks.logger.error).toHaveBeenCalledWith(
        "Local PDF to Text conversion failed",
        expect.any(Error),
      );
    });

    it("reuses one extraction for text and Markdown exports of the same bytes", async () => {
      setupPdf([[richItem("Shared", 10, 700)]]);
      const converter = new LocalConverter();
      const bytes = new Uint8Array([1]);

      await converter.pdfToText(bytes);
      await converter.pdfToMarkdown(bytes);
      await converter.pdfToText(new Uint8Array([1]));

      // Same bytes object: cached. A new array with equal content: extracted again.
      expect(mocks.loadProcessable).toHaveBeenCalledTimes(2);
    });
  });

  describe("Markdown export", () => {
    it("turns font sizes into headings and keeps bold lines, lists and page breaks", async () => {
      setupPdf([
        [
          richItem("Annual Report", 50, 765, 20),
          richItem("Overview", 50, 730, 16),
          richItem("Details", 50, 700, 13),
          richItem("rose.", 85, 668),
          richItem("The year went well.", 50, 680),
          richItem("Sales", 50, 668),
          richItem("Key points", 50, 640, 10, "Helvetica-Bold"),
          richItem("• Revenue up", 50, 628),
          richItem("- Costs down", 50, 616),
          richItem("1) First step", 50, 604),
          richItem("2. Second step", 50, 592),
          richItem("OK", 50, 580, 10, "Helvetica-Bold"),
        ],
        [richItem("Appendix", 50, 760)],
      ]);

      const result = await new LocalConverter().pdfToMarkdown(new Uint8Array([1]));

      expect(result.success).toBe(true);
      expect(decode(result)).toBe(
        [
          "# Annual Report",
          "",
          "## Overview",
          "",
          "### Details",
          "",
          "The year went well.",
          "Sales rose.",
          "",
          "**Key points**",
          "- Revenue up",
          "- Costs down",
          "1) First step",
          "2. Second step",
          "OK",
          "",
          "---",
          "",
          "Appendix",
          "",
        ].join("\n"),
      );
    });

    it("reads a two-column page column by column under each column's heading", async () => {
      setupPdf([
        [
          richItem("Services", 50, 700, 14),
          richItem("Contact", 350, 700, 14),
          ...column(["Design", "Build", "Test", "Ship"], 50, 670),
          ...column(["Email us", "Call us", "Visit us", "Write us"], 350, 670),
        ],
      ]);

      const result = await new LocalConverter().pdfToMarkdown(new Uint8Array([1]));

      expect(decode(result)).toBe(
        [
          "#### Services",
          "",
          "Design",
          "Build",
          "Test",
          "Ship",
          "#### Contact",
          "",
          "Email us",
          "Call us",
          "Visit us",
          "Write us",
          "",
        ].join("\n"),
      );
    });

    it("does not repeat the second line of a two-line column heading in the body", async () => {
      setupPdf([
        [
          richItem("Quarterly", 50, 700, 14),
          richItem("Results", 50, 684, 14),
          richItem("Contact", 350, 700, 14),
          ...column(["Revenue", "Costs", "Margin", "Outlook"], 50, 660),
          ...column(["Email us", "Call us", "Visit us", "Write us"], 350, 670),
        ],
      ]);

      const result = await new LocalConverter().pdfToMarkdown(new Uint8Array([1]));

      expect(decode(result)).toBe(
        [
          "#### Quarterly Results",
          "",
          "Revenue",
          "Costs",
          "Margin",
          "Outlook",
          "#### Contact",
          "",
          "Email us",
          "Call us",
          "Visit us",
          "Write us",
          "",
        ].join("\n"),
      );
    });

    it("keeps each column's rows together, including amounts far to the right", async () => {
      setupPdf([
        [
          ...column(["Alpha", "Beta", "Gamma", "Delta", "Epsilon"], 50, 700),
          ...column(["Rent", "Power", "Water", "Phone", "Total"], 300, 700),
          richItem("$40", 420, 652),
        ],
      ]);

      const result = await new LocalConverter().pdfToMarkdown(new Uint8Array([1]));

      // No heading: same font size at the top of each column as below it.
      expect(decode(result)).toBe(
        "Alpha\nBeta\nGamma\nDelta\nEpsilon\nRent\nPower\nWater\nPhone\nTotal $40\n",
      );
    });

    it("leaves a page as one column when it is narrow, has no clear gutter, or one side is thin", async () => {
      const lineByLine = "One Two\nThree Four\nFive Six\nSeven Eight\nNine Ten\n";
      const pairs = (rightX: number) => [
        ...column(["One", "Three", "Five", "Seven", "Nine"], 50, 700),
        ...column(["Two", "Four", "Six", "Eight", "Ten"], rightX, 700),
      ];

      // Narrow: only 150 pt between the left and right edges.
      setupPdf([pairs(200)]);
      expect(decode(await new LocalConverter().pdfToMarkdown(new Uint8Array([1])))).toBe(
        lineByLine,
      );

      // A row of words spread evenly across the page leaves no gutter.
      setupPdf([Array.from({ length: 21 }, (_, i) => richItem(`w${i}`, 50 + i * 15, 700))]);
      expect(decode(await new LocalConverter().pdfToMarkdown(new Uint8Array([1])))).toBe(
        `${Array.from({ length: 21 }, (_, i) => `w${i}`).join(" ")}\n`,
      );

      // A page number on the far right does not make a second column.
      setupPdf([
        [
          ...column(["a", "b", "c", "d", "e", "f", "g", "h", "i"], 50, 700),
          richItem("12", 400, 700),
        ],
      ]);
      expect(decode(await new LocalConverter().pdfToMarkdown(new Uint8Array([1])))).toBe(
        "a 12\nb\nc\nd\ne\nf\ng\nh\ni\n",
      );
    });

    it("gives a column no heading when its top text is long, reads like a sentence, or is all there is", async () => {
      const longTitle =
        "A very long heading that keeps going on and on until it runs well past the eighty character limit";
      const sentence = "This opening line is set large but it is a full sentence of prose.";
      setupPdf([
        [
          richItem(longTitle, 50, 700, 14),
          ...column(["Design", "Build", "Test", "Ship"], 50, 670),
          richItem(sentence, 350, 700, 14),
          ...column(["Email us", "Call us", "Visit us", "Write us"], 350, 670),
        ],
      ]);

      const twoColumns = decode(await new LocalConverter().pdfToMarkdown(new Uint8Array([1])));
      expect(twoColumns).not.toContain("####");
      // Large but not headings at column level; at page level they are still large text.
      expect(twoColumns).toContain(`### ${longTitle}`);
      expect(twoColumns).toContain(`### ${sentence}`);

      // Two short lines per column: both sit in the top band, so there is no
      // body text to compare against and no heading.
      const smallPrint = (x: number) => [
        richItem("Small", x, 700),
        richItem("print", x + 30, 700),
        richItem("terms", x + 60, 700),
        richItem("apply", x, 688),
        richItem("here", x + 30, 688),
      ];
      setupPdf([[...smallPrint(50), ...smallPrint(350)]]);
      expect(decode(await new LocalConverter().pdfToMarkdown(new Uint8Array([1])))).toBe(
        "Small print terms\napply here\nSmall print terms\napply here\n",
      );
    });

    it("reads a column heading line by line, even when a later line starts further left", async () => {
      setupPdf([
        [
          richItem("Quarterly", 60, 700, 14),
          richItem("Sales Results", 50, 684, 14),
          richItem("Contact", 350, 700, 14),
          ...column(["Revenue", "Costs", "Margin", "Outlook"], 50, 660),
          ...column(["Email us", "Call us", "Visit us", "Write us"], 350, 670),
        ],
      ]);

      const markdown = decode(await new LocalConverter().pdfToMarkdown(new Uint8Array([1])));

      expect(markdown.split("\n")[0]).toBe("#### Quarterly Sales Results");
    });

    it("measures rotated text by its full transform, so its size is not lost", async () => {
      setupPdf([
        [
          ...column(["Body one", "Body two", "Body three"], 50, 700),
          // 20pt text turned a quarter turn: [0 20 -20 0 x y].
          { str: "Sideways", transform: [0, 20, -20, 0, 300, 400], fontName: "Helvetica" },
        ],
      ]);

      const markdown = decode(await new LocalConverter().pdfToMarkdown(new Uint8Array([1])));

      expect(markdown).toBe("Body one\nBody two\nBody three\n\n# Sideways\n");
    });

    it("warns when there is nothing to write", async () => {
      setupPdf([[]]);

      const result = await new LocalConverter().pdfToMarkdown(new Uint8Array([1]));

      expect(result.success).toBe(true);
      expect(decode(result)).toBe("");
      expect(result.warnings).toContain("No extractable text found; output may be empty.");
    });

    it("returns a failure result when the PDF cannot be opened", async () => {
      mocks.loadProcessable.mockRejectedValueOnce(new Error("corrupt"));

      await expect(new LocalConverter().pdfToMarkdown(new Uint8Array([1]))).resolves.toEqual(
        FAILED,
      );
      expect(mocks.logger.error).toHaveBeenCalledWith(
        "Local PDF to Markdown conversion failed",
        expect.any(Error),
      );
    });
  });
});
