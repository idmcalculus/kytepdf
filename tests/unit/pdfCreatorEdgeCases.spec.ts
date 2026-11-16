import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pdfMock = vi.hoisted(() => {
  const pages: any[] = [];
  const doc = {
    addPage: vi.fn((size: [number, number]) => {
      const page = {
        size,
        drawText: vi.fn(),
        drawRectangle: vi.fn(),
        drawLine: vi.fn(),
        drawImage: vi.fn(),
      };
      pages.push(page);
      return page;
    }),
    embedFont: vi.fn(async (source: unknown) => ({
      source,
      widthOfTextAtSize: (text: string, size: number) => text.length * size * 0.52,
      // Printable Latin-1, standing in for the WinAnsi set of the standard fonts.
      getCharacterSet: () =>
        Array.from({ length: 224 }, (_, index) => index + 32).filter(
          (code) => code < 127 || code > 159,
        ),
    })),
    embedPng: vi.fn(async (_bytes: Uint8Array): Promise<any> => ({ width: 120, height: 60 })),
    embedJpg: vi.fn(async (_bytes: Uint8Array): Promise<any> => ({ width: 120, height: 60 })),
    setTitle: vi.fn(),
    setAuthor: vi.fn(),
    setSubject: vi.fn(),
    setKeywords: vi.fn(),
    setCreator: vi.fn(),
    setProducer: vi.fn(),
    setCreationDate: vi.fn(),
    setModificationDate: vi.fn(),
    save: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    saveAsBase64: vi.fn(async () => "AQIDBA=="),
  };

  return {
    doc,
    pages,
    create: vi.fn(async () => {
      pages.length = 0;
      return doc;
    }),
  };
});

vi.mock("../../utils/pdfConfig", () => ({
  PDFDocument: { create: pdfMock.create },
  StandardFonts: {
    Helvetica: "Helvetica",
    HelveticaBold: "HelveticaBold",
    Courier: "Courier",
    TimesRomanItalic: "TimesRomanItalic",
  },
  degrees: (angle: number) => ({ angle }),
  rgb: (r: number, g: number, b: number) => ({ r, g, b }),
}));

/** A stand-in for the canvas pen: jsdom has no FontFace or canvas text. */
const signatureMock = vi.hoisted(() => {
  const pen = {
    widthOfTextAtSize: vi.fn((text: string, size: number) => text.length * size * 0.5),
    drawLine: vi.fn((text: string, size: number) => ({
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      width: text.length * size * 0.5 + 9,
      height: size * 1.5,
      left: 3,
      descent: 11,
    })),
  };
  return { pen, createSignaturePen: vi.fn(async (): Promise<typeof pen | null> => pen) };
});

vi.mock("../../utils/signatureImage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/signatureImage")>()),
  createSignaturePen: signatureMock.createSignaturePen,
}));

import { logger } from "../../utils/logger";
import {
  createDefaultCreatorDraft,
  createDefaultCvEducation,
  createDefaultCvExperience,
  createDefaultInvoiceItem,
  createDefaultLetterParagraph,
  createDefaultReportSection,
  createPdfFromDraft,
  detectDataUrlImageFormat,
  getInvoiceStatusLabel,
  getInvoiceTotalLabel,
  getTemplateLabel,
  normalizeInvoiceDetailsAlignment,
  normalizeInvoiceFooterLogoPosition,
  normalizeInvoiceStatus,
  normalizeWatermarkSource,
  normalizeWatermarkStyle,
  type PdfCreatorDraft,
} from "../../utils/pdfCreator";

// Real PNG and JPEG signatures: the engine reads the format from the bytes.
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";
const JPEG_DATA_URL = "data:image/jpeg;base64,/9j/4A==";

type TextCall = {
  page: number;
  text: string;
  x: number;
  y: number;
  size: number;
  color?: unknown;
  font: { source: unknown };
  opacity?: number;
  rotate?: { angle: number };
};

type RectCall = { page: number; x: number; y: number; width: number; height: number; color?: any };

const LETTER_HEIGHT = 792;
const MARGIN_BOTTOM = 58;
const DEFAULT_ACCENT = { r: 6 / 255, g: 182 / 255, b: 212 / 255 };

const textCalls = (): TextCall[] =>
  pdfMock.pages.flatMap((page, index) =>
    page.drawText.mock.calls.map(([text, options]: [string, Omit<TextCall, "page" | "text">]) => ({
      page: index,
      text,
      ...options,
    })),
  );

const texts = () => textCalls().map((call) => call.text);

const findText = (text: string) => textCalls().find((call) => call.text === text);

const rectCalls = (): RectCall[] =>
  pdfMock.pages.flatMap((page, index) =>
    page.drawRectangle.mock.calls.map(([options]: [Omit<RectCall, "page">]) => ({
      page: index,
      ...options,
    })),
  );

const imageCalls = () =>
  pdfMock.pages.flatMap((page, index) =>
    page.drawImage.mock.calls.map(
      ([, options]: [unknown, { x: number; y: number; width: number; height: number }]) => ({
        page: index,
        ...options,
      }),
    ),
  );

const draftFor = (template: PdfCreatorDraft["template"]) => {
  const draft = createDefaultCreatorDraft();
  draft.template = template;
  return draft;
};

describe("pdfCreator edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signatureMock.createSignaturePen.mockResolvedValue(signatureMock.pen);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("labels and saved-value normalisers", () => {
    it("labels every template and invoice status, defaulting unknown statuses to Pending", () => {
      expect(
        (["report", "letter", "invoice", "payslip", "cv-harvard", "cv-modern"] as const).map(
          getTemplateLabel,
        ),
      ).toEqual([
        "Project Report",
        "Business Letter",
        "Invoice",
        "Payslip",
        "Harvard CV",
        "Modern CV",
      ]);
      expect(getInvoiceTotalLabel("overdue")).toBe("Total Overdue");
      expect(getInvoiceTotalLabel("cancelled")).toBe("Total Cancelled");
      expect(getInvoiceStatusLabel("archived" as any)).toBe("Pending");
    });

    it("rejects non-string and unknown saved option values", () => {
      expect(normalizeInvoiceStatus(3)).toBe("pending");
      expect(normalizeInvoiceStatus("overdue")).toBe("overdue");
      expect(normalizeInvoiceDetailsAlignment(null)).toBe("right");
      expect(normalizeInvoiceFooterLogoPosition({})).toBe("none");
      expect(normalizeWatermarkSource("photo")).toBe("company-logo");
      expect(normalizeWatermarkSource("text")).toBe("text");
      expect(normalizeWatermarkStyle(undefined)).toBe("centered");
      expect(normalizeWatermarkStyle("tiled")).toBe("tiled");
    });
  });

  describe("document setup", () => {
    it("swaps A4 dimensions for landscape and right-aligns page numbers to the new width", async () => {
      const draft = draftFor("report");
      draft.pageSize = "a4";
      draft.orientation = "landscape";

      await createPdfFromDraft(draft);

      expect(pdfMock.doc.addPage).toHaveBeenCalledWith([841.89, 595.28]);
      const pageNumber = textCalls().find((call) => call.text.startsWith("Page 1 of"));
      const width = pageNumber!.text.length * pageNumber!.size * 0.52;
      expect(pageNumber!.x + width).toBeCloseTo(841.89 - 56, 5);
    });

    it.each([
      ["   ", "kyte-document.pdf"],
      ["...", "kyte-document.pdf"],
      [".env", "env.pdf"],
      ["Q1\tReport", "Q1-Report.pdf"],
      ["Board   pack", "Board pack.pdf"],
    ])("turns the file name %j into %j", async (fileName, expected) => {
      const draft = draftFor("report");
      draft.fileName = fileName;

      const result = await createPdfFromDraft(draft);

      expect(result.outputName).toBe(expected);
    });

    it("renders an invalid accent colour exactly like the default accent", async () => {
      const capture = async (accentColor: string) => {
        const draft = draftFor("invoice");
        draft.accentColor = accentColor;
        draft.invoice.issueDate = "2026-01-01";
        draft.invoice.dueDate = "2026-01-31";
        await createPdfFromDraft(draft);
        return {
          rects: rectCalls().map((call) => call.color),
          text: textCalls().map((call) => call.color),
          lines: pdfMock.pages[0].drawLine.mock.calls.map(([options]: [any]) => options.color),
        };
      };

      const invalid = await capture("teal");
      const fallback = await capture("#06b6d4");

      expect(invalid).toEqual(fallback);
      expect(invalid.rects).toContainEqual(DEFAULT_ACCENT);

      const report = draftFor("report");
      report.accentColor = "#12345";
      await createPdfFromDraft(report);
      expect(findText("Quarterly Product Review")?.color).toEqual(DEFAULT_ACCENT);
    });

    it("leaves page numbers off reports and invoices when they are turned off", async () => {
      const report = draftFor("report");
      report.includePageNumbers = false;
      await createPdfFromDraft(report);
      expect(texts().some((text) => text.startsWith("Page "))).toBe(false);

      const invoice = draftFor("invoice");
      invoice.includePageNumbers = false;
      invoice.invoice.companyReference = "PO-77";
      await createPdfFromDraft(invoice);
      expect(texts().some((text) => text.startsWith("Page "))).toBe(false);
      expect(texts()).toContain("Ref: PO-77");
    });
  });

  describe("report and letter layouts", () => {
    it("caps a tall report logo at 48pt and starts the title just after it", async () => {
      pdfMock.doc.embedPng.mockResolvedValueOnce({ width: 60, height: 240 });
      const draft = draftFor("report");
      draft.logoDataUrl = PNG_DATA_URL;

      await createPdfFromDraft(draft);

      const [logo] = imageCalls();
      expect(logo).toEqual(expect.objectContaining({ x: 56, width: 12, height: 48 }));
      expect(logo.y).toBeCloseTo(LETTER_HEIGHT - 72 - 48 + 8, 5);
      expect(findText("Quarterly Product Review")?.x).toBeCloseTo(56 + 12 + 18, 5);
    });

    it("keeps a wide letter logo at 72pt and starts the sender block after it", async () => {
      pdfMock.doc.embedJpg.mockResolvedValueOnce({ width: 240, height: 60 });
      const draft = draftFor("letter");
      draft.logoDataUrl = JPEG_DATA_URL;

      await createPdfFromDraft(draft);

      const [logo] = imageCalls();
      expect(logo).toEqual(expect.objectContaining({ width: 72, height: 18 }));
      const senderName = textCalls().find((call) => call.text === "Alex Morgan");
      expect(senderName?.x).toBeCloseTo(56 + 72 + 18, 5);
    });

    it("uses placeholders and metadata fallbacks for an empty report", async () => {
      const draft = draftFor("report");
      draft.report = {
        title: "  ",
        subtitle: "",
        author: "",
        summary: "",
        sections: [
          createDefaultReportSection({ heading: "", body: "" }),
          createDefaultReportSection({ heading: "Risks", body: "Supplier delays." }),
        ],
      };

      await createPdfFromDraft(draft);

      expect(texts()).toEqual(expect.arrayContaining(["Untitled document", "Section 1", "Risks"]));
      expect(texts().some((text) => text.startsWith("Prepared by"))).toBe(false);
      expect(pdfMock.doc.setTitle).toHaveBeenCalledWith("Document");
      expect(pdfMock.doc.setAuthor).toHaveBeenCalledWith("Kyte");
      // An empty section body still leaves the same gap before the next heading.
      expect(findText("Section 1")!.y - findText("Risks")!.y).toBe(24 + 16);
    });

    it("fills a sparse letter with a default greeting and today's date", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-03-04T10:00:00Z") });
      const draft = draftFor("letter");
      Object.assign(draft.letter, {
        senderName: "",
        date: "",
        subject: "",
        greeting: "",
        closing: "",
        signature: "",
      });

      await createPdfFromDraft(draft);

      expect(texts()).toEqual(expect.arrayContaining(["Hello,", "2026-03-04"]));
      expect(texts()).not.toContain("Sincerely,");
      expect(pdfMock.doc.setTitle).toHaveBeenCalledWith("Letter");
      expect(pdfMock.doc.setAuthor).toHaveBeenCalledWith("Kyte");
    });

    it("keeps the letter closing and signature together above the bottom margin", async () => {
      for (let count = 1; count <= 30; count += 1) {
        const draft = draftFor("letter");
        draft.letter.paragraphs = Array.from({ length: count }, () =>
          createDefaultLetterParagraph({ text: "Short line." }),
        );

        await createPdfFromDraft(draft);

        const closing = findText("Sincerely,")!;
        const signature = textCalls()
          .filter((call) => call.text === "Alex Morgan")
          .at(-1)!;
        expect({ count, y: closing.y >= MARGIN_BOTTOM }).toEqual({ count, y: true });
        expect({ count, y: signature.y >= MARGIN_BOTTOM }).toEqual({ count, y: true });
        expect(signature.page).toBe(closing.page);
        expect(closing.y - signature.y).toBe(42);
      }
    });

    it("does not add a blank page when a full letter has no sign-off", async () => {
      const draft = draftFor("letter");
      draft.letter.closing = "";
      draft.letter.signature = "";
      draft.letter.paragraphs = Array.from({ length: 15 }, () =>
        createDefaultLetterParagraph({ text: "Short line." }),
      );

      const result = await createPdfFromDraft(draft);

      expect(result.pageCount).toBe(1);
    });
  });

  describe("invoice and payslip details", () => {
    it("fills blank invoice details with placeholders", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-03-04T10:00:00Z") });
      const draft = draftFor("invoice");
      Object.assign(draft.invoice, {
        businessName: "",
        invoiceNumber: "",
        issueDate: "",
        dueDate: "",
        status: "paid",
        paidDate: "",
        lineItems: [createDefaultInvoiceItem({ description: "", quantity: 0, unitPrice: 80 })],
      });

      await createPdfFromDraft(draft);

      const all = texts();
      expect(all).toEqual(
        expect.arrayContaining(["Invoice", "Pending", "Not provided", "Line item", "0", "$0.00"]),
      );
      expect(all.filter((text) => text === "2026-03-04")).toHaveLength(2);
      expect(all).toContain("Total Paid");
      expect(pdfMock.doc.setTitle).toHaveBeenCalledWith("Invoice");
      expect(pdfMock.doc.setAuthor).toHaveBeenCalledWith("Kyte");
    });

    it("uses the issue date as the due date when no due date is set", async () => {
      const draft = draftFor("invoice");
      draft.invoice.issueDate = "2026-01-05";
      draft.invoice.dueDate = " ";

      await createPdfFromDraft(draft);

      const dueLabel = findText("Due Date")!;
      const dueValue = textCalls().find(
        (call) => call.text === "2026-01-05" && Math.abs(call.y - dueLabel.y) < 0.001,
      );
      expect(dueValue).toBeTruthy();
    });

    it.each([
      { details: "", link: "https://pay.example.com/1", expectLinkLabel: true },
      { details: "Sort code 12-34-56", link: "", expectLinkLabel: false },
    ])(
      "renders payment details=$details link=$link",
      async ({ details, link, expectLinkLabel }) => {
        const draft = draftFor("invoice");
        draft.invoice.paymentDetails = details;
        draft.invoice.paymentLink = link;

        await createPdfFromDraft(draft);

        expect(texts()).toContain("Payment Details");
        expect(texts().includes("Payment Link")).toBe(expectLinkLabel);
        expect(texts()).toContain(details || link);
      },
    );

    it("fills blank payslip details with placeholders", async () => {
      const draft = draftFor("payslip");
      draft.payslip.companyName = "";
      draft.payslip.payslipNumber = "";
      draft.payslip.payPeriod = "";

      await createPdfFromDraft(draft);

      expect(texts()).toEqual(expect.arrayContaining(["Company", "Pending", "Not provided"]));
      expect(pdfMock.doc.setTitle).toHaveBeenCalledWith("Payslip");
      expect(pdfMock.doc.setAuthor).toHaveBeenCalledWith("Kyte");
    });

    it("repeats the table header when deductions run onto another page and keeps totals right", async () => {
      const draft = draftFor("payslip");
      draft.payslip.deductions = Array.from({ length: 30 }, (_, index) =>
        createDefaultInvoiceItem({
          description: index === 29 ? "" : `Deduction ${index + 1}`,
          quantity: 1,
          unitPrice: 10,
        }),
      );

      const result = await createPdfFromDraft(draft);

      expect(result.pageCount).toBeGreaterThan(1);
      const calls = textCalls();
      const rowPages = new Set(
        calls.filter((call) => /^Deduction \d+$/.test(call.text)).map((call) => call.page),
      );
      for (const page of rowPages) {
        const header = calls.find((call) => call.page === page && call.text === "Description");
        const rows = calls.filter(
          (call) => call.page === page && /^Deduction \d+$/.test(call.text),
        );
        expect(header).toBeTruthy();
        expect(Math.min(header!.y, ...rows.map((row) => row.y))).toBeGreaterThanOrEqual(
          MARGIN_BOTTOM,
        );
        for (const row of rows) expect(row.y).toBeLessThan(header!.y);
      }
      expect(texts()).toContain("Line item");
      // Default earnings are £3,500 + 4 × £35; thirty £10 deductions come off that.
      expect(texts()).toEqual(expect.arrayContaining(["£3,640.00", "-£300.00", "£3,340.00"]));
    });

    it("fits a wide logo into the invoice header and footer slots", async () => {
      pdfMock.doc.embedPng.mockResolvedValueOnce({ width: 400, height: 40 });
      const draft = draftFor("invoice");
      draft.logoDataUrl = PNG_DATA_URL;
      draft.invoice.footerLogoPosition = "left";

      await createPdfFromDraft(draft);

      const [header, footer] = imageCalls();
      expect(header).toEqual(expect.objectContaining({ width: 108 }));
      expect(header.height).toBeCloseTo(10.8, 5);
      expect(findText("Kyte Studio")?.x).toBeCloseTo(56 + 108 + 18, 5);
      expect(footer).toEqual(expect.objectContaining({ x: 56, width: 64 }));
      expect(footer.height).toBeCloseTo(6.4, 5);
    });

    it("shrinks long footer text but never below the minimum sizes", async () => {
      const draft = draftFor("payslip");
      draft.payslip.companyReference = "X".repeat(50);
      draft.payslip.copyrightNote = "word ".repeat(80);

      const result = await createPdfFromDraft(draft);

      const reference = findText(`Ref: ${"X".repeat(50)}`)!;
      expect(reference.size).toBe(8);
      expect(reference.text.length * reference.size * 0.52).toBeLessThanOrEqual(500 * 0.46);

      // Four lines stacked up from the bottom edge; the cut is marked and reported.
      const copyright = textCalls().filter((call) => call.text.startsWith("word"));
      expect(copyright.map((line) => line.size)).toEqual([5.5, 5.5, 5.5, 5.5]);
      expect(copyright.map((line) => line.y)).toEqual([31, 23.5, 16, 8.5]);
      expect(copyright.at(-1)!.text.endsWith("...")).toBe(true);
      for (const line of copyright) {
        expect(line.text.length * line.size * 0.52).toBeLessThanOrEqual(500 * 0.46);
      }
      expect(reference.y).toBe(31 + 13);
      expect(reference.y + reference.size).toBeLessThan(MARGIN_BOTTOM);
      expect(result.warnings).toEqual([
        "The copyright note is longer than 4 footer lines, so its end was cut. Shorten it to show all of it.",
      ]);

      draft.payslip.companyReference = "R".repeat(100);
      await createPdfFromDraft(draft);
      expect(findText(`Ref: ${"R".repeat(100)}`)?.size).toBe(6.5);
    });

    it("shows a three-line copyright note in full, without a warning", async () => {
      const draft = draftFor("payslip");
      draft.payslip.copyrightNote = "word ".repeat(30);

      const result = await createPdfFromDraft(draft);

      const copyright = textCalls().filter((call) => call.text.startsWith("word"));
      expect(copyright.map((line) => line.text.split(" ").length)).toEqual([12, 12, 6]);
      expect(copyright.map((line) => line.y)).toEqual([23.5, 16, 8.5]);
      expect(result.warnings).toEqual([]);
    });

    it("signs in the standard italic font when the handwriting font cannot load", async () => {
      signatureMock.createSignaturePen.mockResolvedValueOnce(null);
      const warn = vi.spyOn(logger, "warn");
      const draft = draftFor("invoice");
      draft.invoice.signature = "Habeeb Tijani";

      await createPdfFromDraft(draft);

      expect(findText("Habeeb Tijani")?.font.source).toBe("TimesRomanItalic");
      expect(imageCalls()).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        "Signature font could not be loaded; using Times Italic instead.",
      );
    });

    it("draws each line of a long signature as its own picture, a line apart", async () => {
      const draft = draftFor("invoice");
      // The pen measures 14 pt a character at 28 pt, and the line holds 310 pt.
      draft.invoice.signature = "Habeeb Adewale Tijani Okonkwo\n\nJr";

      await createPdfFromDraft(draft);

      expect(signatureMock.pen.drawLine.mock.calls.map(([text]) => text)).toEqual([
        "Habeeb Adewale Tijani",
        "Okonkwo",
        "Jr",
      ]);
      const [first, second, third] = imageCalls();
      expect(first.y - second.y).toBe(34);
      // The blank line draws nothing but still takes its space.
      expect(second.y - third.y).toBe(68);
      expect([first.x, second.x, third.x]).toEqual([53, 53, 53]);
    });

    it("does not load the handwriting font for unsigned invoices or other templates", async () => {
      const unsigned = draftFor("invoice");
      unsigned.invoice.signature = "   ";
      await createPdfFromDraft(unsigned);

      const payslip = draftFor("payslip");
      payslip.invoice.signature = "Habeeb Tijani";
      await createPdfFromDraft(payslip);

      expect(signatureMock.createSignaturePen).not.toHaveBeenCalled();
      expect(signatureMock.pen.drawLine).not.toHaveBeenCalled();
      expect(texts()).not.toContain("Habeeb Tijani");
    });

    it("turns signature characters the fallback font lacks into near matches, and says so", async () => {
      signatureMock.createSignaturePen.mockResolvedValueOnce(null);
      const draft = draftFor("invoice");
      draft.invoice.signature = "José Łukasz Dvořák 李";

      const result = await createPdfFromDraft(draft);

      // Ł has a near match, ř loses its accent, and 李 has no WinAnsi form.
      const signature = findText("José Lukasz Dvorák ?");
      expect(signature?.font.source).toBe("TimesRomanItalic");
      expect(result.warnings).toEqual([
        'Some characters are not in the PDF\'s built-in fonts and were replaced with a similar letter or "?": Ł ř 李.',
      ]);
    });

    it("never asks the handwriting font for letters its Latin subset lacks", async () => {
      const warn = vi.spyOn(logger, "warn");
      const draft = draftFor("invoice");
      // Š and ƒ are in WinAnsi but not in the handwriting font's Latin subset:
      // Š can lose its accent, ƒ has no near match and is left out. Œ is in it.
      draft.invoice.signature = "Šárka Œuvre ƒ";

      await createPdfFromDraft(draft);

      expect(signatureMock.pen.drawLine).toHaveBeenCalledWith(
        "Sárka Œuvre",
        28,
        [0.04, 0.06, 0.09],
      );
      expect(warn).toHaveBeenCalledWith(
        "The signature font cannot show every character in the signature.",
        { replaced: 1, dropped: 1 },
      );
    });

    it("draws characters outside the built-in fonts' range instead of failing the whole PDF", async () => {
      const draft = draftFor("payslip");
      draft.payslip.employeeName = "Łukasz Żółć";
      draft.payslip.companyName = "Northwind Ltd";
      draft.payslip.watermark = {
        ...draft.payslip.watermark,
        source: "text",
        text: "Конфиденциально",
      };

      const result = await createPdfFromDraft(draft);

      expect(texts()).toContain("Lukasz Zólc");
      expect(texts().some((text) => /^\?+$/.test(text))).toBe(true);
      expect(result.warnings[0]).toMatch(/^Some characters are not in the PDF's built-in fonts/);
      expect(result.warnings[0]).toContain("Ł");
      // The document's own metadata keeps the original Unicode text.
      expect(pdfMock.doc.setAuthor).toHaveBeenCalledWith("Northwind Ltd");
    });

    it("keeps the payment link label on the same page as the link", async () => {
      for (let count = 1; count <= 45; count += 1) {
        const draft = draftFor("invoice");
        draft.invoice.notes = "";
        draft.invoice.paymentDetails = Array.from(
          { length: count },
          (_, index) => `Line ${index + 1}`,
        ).join("\n");
        draft.invoice.paymentLink = "https://pay.example.com/invoice/1";

        await createPdfFromDraft(draft);

        const label = findText("Payment Link")!;
        const link = findText("https://pay.example.com/invoice/1")!;
        expect({ count, page: label.page }).toEqual({ count, page: link.page });
        expect(label.y).toBeGreaterThanOrEqual(MARGIN_BOTTOM);
      }
    });
  });

  describe("payslip watermarks", () => {
    it("tiles text watermarks across the page and defaults blank text to CONFIDENTIAL", async () => {
      const draft = draftFor("payslip");
      draft.payslip.watermark = {
        ...draft.payslip.watermark,
        source: "text",
        style: "tiled",
        text: "   ",
      };

      await createPdfFromDraft(draft);

      const tiles = textCalls().filter((call) => call.text === "CONFIDENTIAL");
      expect(tiles.length).toBeGreaterThan(4);
      expect(new Set(tiles.map((tile) => `${tile.x}:${tile.y}`)).size).toBe(tiles.length);
      tiles.forEach((tile) => {
        expect(tile.opacity).toBe(0.08);
        expect(tile.rotate).toEqual({ angle: 0 });
        expect(tile.x).toBeGreaterThanOrEqual(24);
        expect(tile.x).toBeLessThan(612);
        expect(tile.y).toBeGreaterThan(0);
        expect(tile.y).toBeLessThan(LETTER_HEIGHT);
      });
    });

    it("uses default opacity, size and rotation when saved values are not numbers", async () => {
      const draft = draftFor("payslip");
      draft.payslip.watermark = {
        ...draft.payslip.watermark,
        source: "text",
        text: "DRAFT",
        opacity: Number.NaN,
        size: Number.NaN,
        rotation: Number.NaN,
      };

      await createPdfFromDraft(draft);

      const [watermark] = textCalls().filter((call) => call.text === "DRAFT");
      expect(watermark.opacity).toBe(0.08);
      expect(watermark.rotate).toEqual({ angle: 0 });
      expect(watermark.size).toBeCloseTo(612 * 0.45 * 0.18, 5);
    });

    it("caps a tall watermark image at 70% of the page height and keeps it centred", async () => {
      pdfMock.doc.embedPng.mockResolvedValueOnce({ width: 100, height: 1000 });
      const draft = draftFor("payslip");
      draft.payslip.watermark = {
        ...draft.payslip.watermark,
        source: "custom-image",
        customImageDataUrl: PNG_DATA_URL,
        size: 90,
      };

      await createPdfFromDraft(draft);

      const watermark = imageCalls().find((call: any) => call.opacity === 0.08)!;
      expect(watermark.height).toBeCloseTo(LETTER_HEIGHT * 0.7, 5);
      expect(watermark.width).toBeCloseTo(LETTER_HEIGHT * 0.07, 5);
      expect(watermark.x + watermark.width / 2).toBeCloseTo(306, 5);
    });

    it("skips the watermark when the custom image source has no image", async () => {
      const draft = draftFor("payslip");
      draft.logoDataUrl = PNG_DATA_URL;
      draft.payslip.watermark = {
        ...draft.payslip.watermark,
        source: "custom-image",
        customImageDataUrl: null,
      };

      await createPdfFromDraft(draft);

      expect(imageCalls().some((call: any) => call.opacity !== undefined)).toBe(false);
    });

    // pdf-lib rotates about the bottom-left corner; this finds where the middle ends up.
    const rotatedCentre = (x: number, y: number, width: number, height: number, angle: number) => {
      const radians = (angle * Math.PI) / 180;
      return {
        x: x + (width / 2) * Math.cos(radians) - (height / 2) * Math.sin(radians),
        y: y + (width / 2) * Math.sin(radians) + (height / 2) * Math.cos(radians),
      };
    };
    const textCentres = (text: string) =>
      textCalls()
        .filter((call) => call.text === text)
        .map((call) =>
          rotatedCentre(
            call.x,
            call.y,
            text.length * call.size * 0.52,
            call.size,
            call.rotate!.angle,
          ),
        );
    const imageCentres = () =>
      imageCalls()
        .filter((call: any) => call.opacity === 0.08)
        .map((call: any) =>
          rotatedCentre(call.x, call.y, call.width, call.height, call.rotate.angle),
        );
    const rounded = (points: { x: number; y: number }[]) =>
      points.map(({ x, y }) => `${x.toFixed(3)}:${y.toFixed(3)}`).sort();

    it.each([
      { style: "diagonal" as const, rotation: 0, angle: -35 },
      { style: "centered" as const, rotation: 60, angle: 60 },
    ])("centres a $style text watermark rotated by $angle°", async ({ style, rotation, angle }) => {
      const draft = draftFor("payslip");
      draft.payslip.watermark = {
        ...draft.payslip.watermark,
        source: "text",
        text: "PRIVATE",
        style,
        rotation,
      };

      await createPdfFromDraft(draft);

      expect(findText("PRIVATE")?.rotate).toEqual({ angle });
      const [centre] = textCentres("PRIVATE");
      expect(centre.x).toBeCloseTo(306, 5);
      expect(centre.y).toBeCloseTo(LETTER_HEIGHT / 2, 5);
    });

    it("centres a rotated image watermark on the page", async () => {
      const draft = draftFor("payslip");
      draft.logoDataUrl = PNG_DATA_URL;
      draft.payslip.watermark = { ...draft.payslip.watermark, rotation: 30 };

      await createPdfFromDraft(draft);

      const [centre] = imageCentres();
      expect(centre.x).toBeCloseTo(306, 5);
      expect(centre.y).toBeCloseTo(LETTER_HEIGHT / 2, 5);
    });

    it.each([{ source: "text" as const }, { source: "company-logo" as const }])(
      "keeps tiled $source watermarks on the same grid when they are rotated",
      async ({ source }) => {
        const centresAt = async (rotation: number) => {
          const draft = draftFor("payslip");
          draft.logoDataUrl = PNG_DATA_URL;
          draft.payslip.watermark = {
            ...draft.payslip.watermark,
            source,
            style: "tiled",
            text: "COPY",
            rotation,
          };
          await createPdfFromDraft(draft);
          return rounded(source === "text" ? textCentres("COPY") : imageCentres());
        };

        const upright = await centresAt(0);
        const turned = await centresAt(45);

        expect(upright.length).toBeGreaterThan(4);
        expect(turned).toEqual(upright);
      },
    );
  });

  describe("grayscale watermark images", () => {
    const setUpCanvas = (context: unknown) => {
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as any);
      vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
        "data:image/png;base64,iVBORw0KGgoFBgc=",
      );
      // The production CSP blocks fetch() on data: URLs, so it must not be used.
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("Refused to connect: violates connect-src");
        }),
      );
    };

    const grayscaleDraft = (customImageDataUrl: string) => {
      const draft = draftFor("payslip");
      draft.payslip.watermark = {
        ...draft.payslip.watermark,
        source: "custom-image",
        customImageDataUrl,
        grayscale: true,
      };
      return draft;
    };

    it("converts the watermark to grayscale once and embeds the converted PNG", async () => {
      const bitmap = { width: 2, height: 1, close: vi.fn() };
      const createImageBitmap = vi.fn(async () => bitmap);
      vi.stubGlobal("createImageBitmap", createImageBitmap);
      const pixels = { data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 128]) };
      const context = {
        drawImage: vi.fn(),
        getImageData: vi.fn(() => pixels),
        putImageData: vi.fn(),
      };
      setUpCanvas(context);
      const draft = grayscaleDraft("data:image/jpeg;base64,/9j/4AAB");

      await createPdfFromDraft(draft);

      expect(fetch).not.toHaveBeenCalled();
      const [decoded] = createImageBitmap.mock.calls[0] as unknown as [Blob];
      expect(decoded).toBeInstanceOf(Blob);
      expect(decoded.type).toBe("image/jpeg");
      expect(decoded.size).toBe(6);
      expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
      expect(bitmap.close).toHaveBeenCalled();
      // Luma weights: red → 76, blue → 29; alpha is left alone.
      expect(Array.from(context.putImageData.mock.calls[0][0].data)).toEqual([
        76, 76, 76, 255, 29, 29, 29, 128,
      ]);
      expect(pdfMock.doc.embedPng).toHaveBeenCalledWith(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 5, 6, 7]),
      );
      expect(pdfMock.doc.embedJpg).not.toHaveBeenCalled();

      await createPdfFromDraft(draft);
      expect(createImageBitmap).toHaveBeenCalledTimes(1);
      expect(pdfMock.doc.embedPng).toHaveBeenCalledTimes(2);
    });

    it("keeps the original image when the browser cannot decode it", async () => {
      vi.stubGlobal(
        "createImageBitmap",
        vi.fn(async () => {
          throw new Error("decode failed");
        }),
      );
      setUpCanvas(null);

      await createPdfFromDraft(grayscaleDraft("data:image/jpeg;base64,/9j/4AAC"));

      expect(pdfMock.doc.embedJpg).toHaveBeenCalledWith(
        new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 2]),
      );
      expect(imageCalls().some((call: any) => call.opacity === 0.08)).toBe(true);
    });

    it("keeps the original image when no 2D canvas context is available", async () => {
      vi.stubGlobal(
        "createImageBitmap",
        vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })),
      );
      setUpCanvas(null);

      await createPdfFromDraft(grayscaleDraft("data:image/jpeg;base64,/9j/4AAD"));

      expect(pdfMock.doc.embedJpg).toHaveBeenCalledWith(
        new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 3]),
      );
      expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
    });
  });

  describe("CV layouts", () => {
    const blankExperience = () =>
      createDefaultCvExperience({
        role: "",
        organization: "",
        location: "",
        startDate: "",
        endDate: "",
        achievements: "",
      });
    const blankEducation = () =>
      createDefaultCvEducation({
        qualification: "",
        institution: "",
        location: "",
        startDate: "",
        endDate: "",
        details: "",
      });
    const clearCvHeader = (draft: PdfCreatorDraft) => {
      Object.assign(draft.cv, {
        fullName: "",
        professionalTitle: "",
        email: "",
        phone: "",
        location: "",
        website: "",
        linkedin: "",
        profile: "",
        skills: "",
        additionalSections: [],
      });
    };

    it("draws a sparse Harvard CV without empty headings or contact lines", async () => {
      const draft = draftFor("cv-harvard");
      clearCvHeader(draft);
      draft.cv.experienceLabel = "";
      draft.cv.education = [blankEducation()];

      await createPdfFromDraft(draft);

      const all = texts();
      expect(all).toEqual(expect.arrayContaining(["Unnamed Candidate", "EDUCATION"]));
      expect(all).not.toContain("EXPERIENCE");
      expect(all).not.toContain("PROFESSIONAL PROFILE");
      expect(all).not.toContain("CORE SKILLS");
      expect(all.some((text) => text.includes(" • "))).toBe(false);
      expect(pdfMock.doc.setTitle).toHaveBeenCalledWith("Candidate CV");
      expect(pdfMock.doc.setAuthor).toHaveBeenCalledWith("Kyte");
    });

    it("closes up Harvard CV entries when subtitles and dates are missing", async () => {
      const draft = draftFor("cv-harvard");
      clearCvHeader(draft);
      draft.cv.fullName = "Sam Lee";
      draft.cv.experiences = [
        blankExperience(),
        createDefaultCvExperience({
          role: "Designer",
          organization: "",
          location: "",
          startDate: "2020",
          endDate: "",
          achievements: "Shipped the app",
        }),
      ];
      draft.cv.education = [
        createDefaultCvEducation({
          qualification: "BA Design",
          institution: "",
          location: "",
          startDate: "",
          endDate: "",
          details: "First Class",
        }),
      ];

      await createPdfFromDraft(draft);

      const role = findText("Designer")!;
      expect(findText("2020")).toBeTruthy();
      expect(role.y - findText("Shipped the app")!.y).toBe(16);
      const qualification = findText("BA Design")!;
      expect(qualification.y - findText("First Class")!.y).toBe(16);
      expect(texts()).not.toContain(" - ");
      expect(pdfMock.doc.setTitle).toHaveBeenCalledWith("Sam Lee CV");
    });

    it("draws a sparse modern CV header and skips sections without labels", async () => {
      const draft = draftFor("cv-modern");
      clearCvHeader(draft);
      draft.cv.experienceLabel = " ";
      draft.cv.educationLabel = "";

      await createPdfFromDraft(draft);

      expect(texts()).toEqual(["Unnamed Candidate", "Page 1 of 1"]);
      expect(pdfMock.doc.setTitle).toHaveBeenCalledWith("Candidate CV");
      expect(pdfMock.doc.setAuthor).toHaveBeenCalledWith("Kyte");
    });

    it("gives a title-only modern CV entry the minimum card height and no date column", async () => {
      const draft = draftFor("cv-modern");
      clearCvHeader(draft);
      draft.cv.experiences = [createDefaultCvExperience({ ...blankExperience(), role: "Advisor" })];
      draft.cv.educationLabel = "";

      await createPdfFromDraft(draft);

      const card = rectCalls().find((rect) => rect.color?.r === 0.98)!;
      expect(card.height).toBe(52);
      const title = findText("Advisor")!;
      expect(title.y).toBe(card.y + card.height - 16);
      expect(texts()).not.toContain("•");
    });

    it("moves modern CV cards to a new page as whole cards", async () => {
      const draft = draftFor("cv-modern");
      clearCvHeader(draft);
      draft.cv.educationLabel = "";
      draft.cv.experiences = Array.from({ length: 12 }, (_, index) =>
        createDefaultCvExperience({
          role: `Role ${index + 1}`,
          achievements: "Led delivery\nHired the team\nCut costs",
        }),
      );

      const result = await createPdfFromDraft(draft);

      expect(result.pageCount).toBeGreaterThan(1);
      const cards = rectCalls().filter((rect) => rect.color?.r === 0.98);
      expect(cards).toHaveLength(12);
      cards.forEach((card) => {
        expect(card.y).toBeGreaterThanOrEqual(MARGIN_BOTTOM);
        expect(card.y + card.height).toBeLessThanOrEqual(LETTER_HEIGHT - 54);
      });
      const firstOnPageTwo = cards.find((card) => card.page === 1)!;
      expect(firstOnPageTwo.y + firstOnPageTwo.height).toBe(LETTER_HEIGHT - 54);
    });

    it("keeps blank lines in the modern CV profile as a short gap", async () => {
      const draft = draftFor("cv-modern");
      draft.cv.profile = "First paragraph\n\nSecond paragraph";

      await createPdfFromDraft(draft);

      expect(findText("First paragraph")!.y - findText("Second paragraph")!.y).toBe(25);
    });

    it("moves a long modern CV profile to the next page as one panel", async () => {
      const draft = draftFor("cv-modern");
      draft.cv.profile = Array.from({ length: 40 }, (_, index) => `Line ${index + 1}`).join("\n");

      await createPdfFromDraft(draft);

      const panel = rectCalls().find((rect) => rect.color?.r === 0.96)!;
      expect(panel.page).toBe(1);
      expect(panel.y + panel.height).toBe(LETTER_HEIGHT - 54);
      expect(panel.y).toBeGreaterThanOrEqual(MARGIN_BOTTOM);
      expect(findText("Line 1")?.page).toBe(1);
      expect(findText("Line 40")?.page).toBe(1);
    });

    // Every line must be drawn, in order, inside a panel slice on its own page.
    const expectSplitAcrossPages = (lineTexts: string[], panelColour: number) => {
      const calls = lineTexts.map((text) => findText(text));
      expect(calls.every(Boolean)).toBe(true);
      const panels = rectCalls().filter((rect) => rect.color?.r === panelColour);
      expect(new Set(panels.map((panel) => panel.page)).size).toBeGreaterThan(1);

      calls.forEach((call, index) => {
        const panel = panels.find(
          (rect) =>
            rect.page === call!.page && rect.y <= call!.y && call!.y <= rect.y + rect.height,
        );
        expect({ line: call!.text, inPanel: Boolean(panel) }).toEqual({
          line: call!.text,
          inPanel: true,
        });
        expect(call!.y).toBeGreaterThanOrEqual(MARGIN_BOTTOM);
        const previous = calls[index - 1];
        if (previous && previous.page === call!.page) {
          expect(call!.y).toBeLessThan(previous.y);
        } else if (previous) {
          expect(call!.page).toBe(previous.page + 1);
        }
      });
      panels.forEach((panel) => {
        expect(panel.y).toBeGreaterThanOrEqual(MARGIN_BOTTOM);
        expect(panel.y + panel.height).toBeLessThanOrEqual(LETTER_HEIGHT - 54);
      });
      return panels;
    };

    it("splits a modern CV profile taller than a page across pages line by line", async () => {
      const draft = draftFor("cv-modern");
      const lines = Array.from({ length: 60 }, (_, index) => `Line ${index + 1}`);
      draft.cv.profile = lines.join("\n");

      await createPdfFromDraft(draft);

      const panels = expectSplitAcrossPages(lines, 0.96);
      // The first slice uses the space left under the heading on page one.
      expect(panels[0].page).toBe(0);
    });

    it("splits a modern CV entry taller than a page and keeps its accent bar on each part", async () => {
      const draft = draftFor("cv-modern");
      draft.cv.profile = "";
      draft.cv.educationLabel = "";
      draft.cv.additionalSections = [];
      const achievements = Array.from({ length: 70 }, (_, index) => `Achievement ${index + 1}`);
      draft.cv.experiences = [
        createDefaultCvExperience({ role: "Lead", achievements: achievements.join("\n") }),
      ];

      await createPdfFromDraft(draft);

      const cards = expectSplitAcrossPages(achievements, 0.98);
      const accentBars = rectCalls().filter((rect) => rect.width === 4);
      expect(accentBars.map(({ page, y, height }) => ({ page, y, height }))).toEqual(
        cards.map(({ page, y, height }) => ({ page, y, height })),
      );
      expect(textCalls().filter((call) => call.text === "•")).toHaveLength(70);
      expect(findText("Lead")?.page).toBe(0);
    });

    it("starts a tall entry on a new page when too little room is left to begin it", async () => {
      const achievements = Array.from({ length: 70 }, (_, index) => `Achievement ${index + 1}`);
      // Longer profiles push the entry lower, until it no longer has room to start.
      for (let profileLines = 25; profileLines <= 36; profileLines += 1) {
        const draft = draftFor("cv-modern");
        draft.cv.profile = Array.from({ length: profileLines }, (_, i) => `Profile ${i + 1}`).join(
          "\n",
        );
        draft.cv.educationLabel = "";
        draft.cv.additionalSections = [];
        draft.cv.experiences = [
          createDefaultCvExperience({ role: "Lead", achievements: achievements.join("\n") }),
        ];

        await createPdfFromDraft(draft);

        expectSplitAcrossPages(achievements, 0.98);
        expect(findText("Lead")!.y).toBeGreaterThanOrEqual(MARGIN_BOTTOM);
      }
    });

    it("stacks a wrapped modern CV subtitle one line below the other", async () => {
      const draft = draftFor("cv-modern");
      draft.cv.experiences = [
        createDefaultCvExperience({
          role: "Designer",
          organization: "Northstar Studio for Public Services and Digital Transformation",
          location: "Manchester, United Kingdom",
          achievements: "",
        }),
      ];

      await createPdfFromDraft(draft);

      const calls = textCalls();
      const titleIndex = calls.findIndex((call) => call.text === "Designer");
      const subtitleLines = calls
        .slice(titleIndex + 1)
        .filter((call) => call.size === 10.4)
        .slice(0, 2);
      expect(subtitleLines.map((line) => line.x)).toEqual([70, 70]);
      expect(subtitleLines.map((line) => line.text).join(" ")).toContain("Manchester");
      expect(calls[titleIndex].y - subtitleLines[0].y).toBe(14 + 2);
      expect(subtitleLines[0].y - subtitleLines[1].y).toBe(12);
    });
  });

  describe("review fixes", () => {
    it("draws the payslip watermark over the tables rather than under them", async () => {
      const draft = draftFor("payslip");
      draft.logoDataUrl = PNG_DATA_URL;

      await createPdfFromDraft(draft);

      const page = pdfMock.pages[0];
      const watermarkCall = page.drawImage.mock.calls.findIndex(
        ([, options]: [unknown, { opacity?: number }]) => options.opacity === 0.08,
      );
      const watermarkOrder = page.drawImage.mock.invocationCallOrder[watermarkCall];
      const lastFill = Math.max(...page.drawRectangle.mock.invocationCallOrder);
      expect(watermarkOrder).toBeGreaterThan(lastFill);
    });

    it("reads a logo's real format from its bytes, whatever its label says", async () => {
      const pngLabelledJpeg = PNG_DATA_URL.replace("image/png", "image/jpeg");
      const draft = draftFor("report");
      draft.logoDataUrl = pngLabelledJpeg;

      await createPdfFromDraft(draft);

      expect(pdfMock.doc.embedPng).toHaveBeenCalled();
      expect(pdfMock.doc.embedJpg).not.toHaveBeenCalled();
      expect(detectDataUrlImageFormat(pngLabelledJpeg)).toBe("png");
      expect(detectDataUrlImageFormat(JPEG_DATA_URL)).toBe("jpeg");
      expect(detectDataUrlImageFormat("data:image/gif;base64,R0lGODlh")).toBeNull();
      expect(detectDataUrlImageFormat("data:image/png,raw")).toBeNull();
      expect(detectDataUrlImageFormat("data:image/png;base64,***")).toBeNull();

      draft.logoDataUrl = "data:image/png;base64,R0lGODlh";
      await expect(createPdfFromDraft(draft)).rejects.toThrow(
        "The logo or watermark image is not a PNG or JPEG file. Remove it and upload a PNG or JPEG.",
      );
    });

    it.each([0, 0.01, 35, -35, 90])(
      "keeps a long text watermark turned %s° inside the page",
      async (rotation) => {
        const text = "STRICTLY CONFIDENTIAL - EMPLOYEE COPY";
        const draft = draftFor("payslip");
        draft.payslip.watermark = { ...draft.payslip.watermark, source: "text", text, rotation };

        await createPdfFromDraft(draft);

        const call = findText(text)!;
        const width = text.length * call.size * 0.52;
        const radians = (call.rotate!.angle * Math.PI) / 180;
        const corners = [
          [0, 0],
          [width, 0],
          [0, call.size],
          [width, call.size],
        ].map(([dx, dy]) => [
          call.x + dx * Math.cos(radians) - dy * Math.sin(radians),
          call.y + dx * Math.sin(radians) + dy * Math.cos(radians),
        ]);
        for (const [x, y] of corners) {
          expect(x).toBeGreaterThanOrEqual(-0.001);
          expect(x).toBeLessThanOrEqual(612.001);
          expect(y).toBeGreaterThanOrEqual(-0.001);
          expect(y).toBeLessThanOrEqual(LETTER_HEIGHT + 0.001);
        }
      },
    );

    it("splits a line item taller than a page across pages without losing lines", async () => {
      const lines = Array.from({ length: 70 }, (_, index) => `Detail ${index + 1}`);
      const draft = draftFor("invoice");
      draft.invoice.notes = "";
      draft.invoice.lineItems = [
        createDefaultInvoiceItem({ description: lines.join("\n"), quantity: 2, unitPrice: 50 }),
      ];

      const result = await createPdfFromDraft(draft);

      expect(result.pageCount).toBeGreaterThan(1);
      const calls = textCalls();
      const drawn = lines.map((line) => calls.find((call) => call.text === line));
      expect(drawn.every(Boolean)).toBe(true);
      for (const call of drawn) {
        expect(call!.y).toBeGreaterThanOrEqual(MARGIN_BOTTOM);
        expect(call!.y).toBeLessThan(LETTER_HEIGHT);
      }
      // The rate is drawn once, beside the first part; each page repeats the header.
      expect(calls.filter((call) => call.text === "$50.00")).toHaveLength(1);
      const rowPages = new Set(drawn.map((call) => call!.page));
      for (const page of rowPages) {
        expect(calls.some((call) => call.page === page && call.text === "Description")).toBe(true);
      }
      // Rows stay inside the page.
      for (const rect of rectCalls().filter((r) => r.x === 56 && r.color?.r === 1)) {
        expect(rect.y).toBeGreaterThanOrEqual(MARGIN_BOTTOM);
      }
    });

    it.each([
      ["late evening", new Date(2026, 10, 15, 23, 30)],
      ["just after midnight", new Date(2026, 10, 15, 0, 30)],
    ])("defaults dates to the local day in the %s", (_label, now) => {
      const originalTimeZone = process.env.TZ;
      process.env.TZ = "America/New_York";
      try {
        vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 15, now.getHours(), 30) });
        const draft = createDefaultCreatorDraft();
        expect(draft.invoice.issueDate).toBe("2026-11-15");
        expect(draft.payslip.payDate).toBe("2026-11-15");
        expect(draft.letter.date).toBe("2026-11-15");
      } finally {
        vi.useRealTimers();
        process.env.TZ = originalTimeZone;
      }
    });
  });
});
