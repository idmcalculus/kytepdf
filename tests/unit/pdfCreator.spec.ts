import { beforeEach, describe, expect, it, vi } from "vitest";

const pdfCreatorMock = vi.hoisted(() => {
  const pages: any[] = [];
  const createPage = () => ({
    drawText: vi.fn(),
    drawRectangle: vi.fn(),
    drawLine: vi.fn(),
    drawImage: vi.fn(),
  });

  const doc = {
    addPage: vi.fn(() => {
      const page = createPage();
      pages.push(page);
      return page;
    }),
    embedFont: vi.fn(async () => ({
      widthOfTextAtSize: (text: string, size: number) => text.length * size * 0.52,
    })),
    embedPng: vi.fn(async () => ({ width: 120, height: 60 })),
    embedJpg: vi.fn(async () => ({ width: 120, height: 60 })),
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
      doc.addPage.mockClear();
      doc.addPage.mockImplementation(() => {
        const page = createPage();
        pages.push(page);
        return page;
      });
      return doc;
    }),
  };
});

vi.mock("../../utils/pdfConfig", () => ({
  PDFDocument: {
    create: pdfCreatorMock.create,
  },
  StandardFonts: {
    Helvetica: "Helvetica",
    HelveticaBold: "HelveticaBold",
    Courier: "Courier",
  },
  rgb: (r: number, g: number, b: number) => ({ r, g, b }),
}));

import {
  calculateInvoiceTotal,
  createDefaultCreatorDraft,
  createDefaultCvExtraSection,
  createDefaultReportSection,
  createPdfFromDraft,
} from "../../utils/pdfCreator";

const getRenderedTexts = () =>
  pdfCreatorMock.pages.flatMap((page) => page.drawText.mock.calls.map(([text]: [string]) => text));

describe("pdfCreator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calculates invoice totals from all line items", () => {
    const draft = createDefaultCreatorDraft();
    draft.invoice.lineItems = [
      { id: "1", description: "Design", quantity: 2, unitPrice: 150 },
      { id: "2", description: "Support", quantity: 3, unitPrice: 80 },
    ];

    expect(calculateInvoiceTotal(draft.invoice.lineItems)).toBe(540);
  });

  it("treats non-finite invoice values as zero", () => {
    const draft = createDefaultCreatorDraft();
    draft.invoice.lineItems = [
      {
        id: "1",
        description: "Invalid quantity",
        quantity: Number.POSITIVE_INFINITY,
        unitPrice: 150,
      },
      { id: "2", description: "Invalid rate", quantity: 3, unitPrice: Number.NaN },
    ];

    expect(calculateInvoiceTotal(draft.invoice.lineItems)).toBe(0);
  });

  it("falls back to a generated id when crypto UUID is unavailable", () => {
    const originalCrypto = globalThis.crypto;
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(1234);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {},
    });

    const section = createDefaultReportSection();

    expect(section.id).toMatch(/^draft-1234-/);
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
    dateSpy.mockRestore();
    randomSpy.mockRestore();
  });

  it("creates a multipage report when content exceeds a single page", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "report";
    draft.fileName = "Long Form Report";
    draft.report.sections = [
      createDefaultReportSection({
        heading: "Deep dive",
        body: Array.from(
          { length: 220 },
          () =>
            "This paragraph is intentionally repeated to force the document composer to paginate across multiple pages while keeping the output stable.",
        ).join(" "),
      }),
    ];

    const result = await createPdfFromDraft(draft);

    expect(result.outputName).toBe("Long Form Report.pdf");
    expect(result.pageCount).toBeGreaterThan(1);
    expect(pdfCreatorMock.doc.addPage).toHaveBeenCalledTimes(result.pageCount);
  });

  it("wraps blank paragraphs and long words in report content", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "report";
    draft.report.sections = [
      createDefaultReportSection({
        heading: "Wrapping",
        body: `First paragraph\n\n${"supercalifragilistic".repeat(12)}`,
      }),
    ];

    await createPdfFromDraft(draft);

    expect(pdfCreatorMock.pages[0].drawText).toHaveBeenCalled();
  });

  it("uses editable section labels in the Harvard CV renderer", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "cv-harvard";
    draft.fileName = "Jordan Taylor CV";
    draft.cv.profileLabel = "Personal Profile";
    draft.cv.experienceLabel = "Work History";
    draft.cv.educationLabel = "Academic Background";
    draft.cv.skillsLabel = "Key Skills";

    const result = await createPdfFromDraft(draft);

    const texts = getRenderedTexts();
    expect(result.outputName).toBe("Jordan Taylor CV.pdf");
    expect(texts).toContain("PERSONAL PROFILE");
    expect(texts).toContain("WORK HISTORY");
    expect(texts).toContain("ACADEMIC BACKGROUND");
    expect(texts).toContain("KEY SKILLS");
    expect(pdfCreatorMock.doc.setSubject).toHaveBeenCalledWith("Harvard-style curriculum vitae");
  });

  it("renders Harvard CV logos, single-line extra sections, and partial date ranges", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "cv-harvard";
    draft.logoDataUrl = "data:image/jpeg;base64,AQID";
    draft.cv.experiences[0].startDate = "";
    draft.cv.experiences[0].endDate = "Present";
    draft.cv.educationLabel = "";
    draft.cv.additionalSections = [
      createDefaultCvExtraSection({
        title: "Memberships",
        body: "IxDA",
      }),
      createDefaultCvExtraSection({
        title: "",
        body: "Skipped",
      }),
    ];

    await createPdfFromDraft(draft);

    const texts = getRenderedTexts();
    expect(pdfCreatorMock.doc.embedJpg).toHaveBeenCalled();
    expect(texts).toContain("MEMBERSHIPS");
    expect(texts).toContain("Present");
  });

  it("creates a modern CV PDF from the shared CV draft", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "cv-modern";
    draft.cv.profileLabel = "Career Overview";
    draft.cv.additionalSections = [
      {
        id: "section-1",
        title: "Certifications",
        body: "Google UX Design Certificate\nScrum Master",
      },
    ];

    const result = await createPdfFromDraft(draft);

    const texts = getRenderedTexts();
    expect(result.pageCount).toBeGreaterThan(0);
    expect(texts).toContain("Career Overview");
    expect(texts).toContain("Certifications");
    expect(pdfCreatorMock.doc.setSubject).toHaveBeenCalledWith("Modern curriculum vitae");
  });

  it("renders modern CV logo and single-line extra sections", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "cv-modern";
    draft.logoDataUrl = "data:image/png;base64,AQID";
    draft.cv.profileLabel = "";
    draft.cv.additionalSections = [
      createDefaultCvExtraSection({
        title: "Open Source",
        body: "KytePDF contributor",
      }),
      createDefaultCvExtraSection({
        title: "Skipped",
        body: "",
      }),
    ];

    await createPdfFromDraft(draft);

    const texts = getRenderedTexts();
    expect(pdfCreatorMock.doc.embedPng).toHaveBeenCalled();
    expect(texts).toContain("Open Source");
    expect(texts).toContain("KytePDF contributor");
  });

  it("aligns modern CV date labels to a fixed column", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "cv-modern";
    draft.cv.profile = "";
    draft.cv.skills = "";
    draft.cv.additionalSections = [];
    draft.cv.experiences = [draft.cv.experiences[0]];
    draft.cv.education = [draft.cv.education[0]];

    await createPdfFromDraft(draft);

    const calls = pdfCreatorMock.pages.flatMap((page) =>
      page.drawText.mock.calls.map(([text, options]: [string, { x: number }]) => ({
        text,
        x: options.x,
      })),
    );
    const dateCalls = calls.filter((call) => ["2022 - Present", "2016 - 2019"].includes(call.text));

    expect(dateCalls).toHaveLength(2);
    expect(dateCalls[0].x).toBeCloseTo(dateCalls[1].x, 5);
  });

  it("creates an invoice PDF with a sanitized output name", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "invoice";
    draft.fileName = "Client: Invoice / March";

    const result = await createPdfFromDraft(draft);

    expect(result.outputName).toBe("Client- Invoice - March.pdf");
    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(pdfCreatorMock.doc.setTitle).toHaveBeenCalledWith("INV-2026-001");
  });

  it("right-aligns invoice rate and amount columns to consistent edges", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "invoice";
    draft.invoice.currency = "GBP";
    draft.invoice.lineItems = [
      { id: "1", description: "Design system audit", quantity: 2, unitPrice: 625 },
      { id: "2", description: "Implementation support", quantity: 10, unitPrice: 16 },
    ];

    await createPdfFromDraft(draft);

    const page = pdfCreatorMock.pages[0];
    const calls = page.drawText.mock.calls.map(
      ([text, options]: [string, { x: number; size: number }]) => ({
        text,
        x: options.x,
        size: options.size,
      }),
    );
    const rateCalls = calls.filter((call) => call.text === "£625.00" || call.text === "£16.00");
    const amountCalls = calls.filter(
      (call) => call.text === "£1,250.00" || call.text === "£160.00",
    );
    const textWidth = (text: string, size: number) => text.length * size * 0.52;

    expect(rateCalls).toHaveLength(2);
    expect(amountCalls).toHaveLength(2);

    const rateEdges = rateCalls.map((call) => call.x + textWidth(call.text, call.size));
    const amountEdges = amountCalls.map((call) => call.x + textWidth(call.text, call.size));

    expect(rateEdges[0]).toBeCloseTo(rateEdges[1], 5);
    expect(amountEdges[0]).toBeCloseTo(amountEdges[1], 5);
  });

  it("centers invoice quantity values inside the quantity column", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "invoice";
    draft.invoice.lineItems = [
      { id: "1", description: "Design system audit", quantity: 1, unitPrice: 1500 },
      { id: "2", description: "Implementation support", quantity: 10, unitPrice: 160 },
    ];

    await createPdfFromDraft(draft);

    const page = pdfCreatorMock.pages[0];
    const calls = page.drawText.mock.calls.map(
      ([text, options]: [string, { x: number; size: number }]) => ({
        text,
        x: options.x,
        size: options.size,
      }),
    );
    const qtyCalls = calls.filter((call) => call.text === "1" || call.text === "10");
    const textWidth = (text: string, size: number) => text.length * size * 0.52;

    expect(qtyCalls).toHaveLength(2);

    const qtyCenters = qtyCalls.map((call) => call.x + textWidth(call.text, call.size) / 2);
    expect(qtyCenters[0]).toBeCloseTo(qtyCenters[1], 5);
  });

  it("renders invoice rows and total as contiguous table blocks without overlap", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "invoice";

    await createPdfFromDraft(draft);

    const page = pdfCreatorMock.pages[0];
    const rectangles = page.drawRectangle.mock.calls.map(
      ([options]: [{ x: number; y: number; width: number; height: number }]) => options,
    );
    const headerRect = rectangles.find((rect) => rect.x === 56 && rect.height === 30);
    const rowRects = rectangles
      .filter((rect) => rect.x === 56 && rect.height === 34)
      .sort((a, b) => b.y - a.y);
    const totalRect = rectangles.find((rect) => rect.height === 52 && rect.x > 56);

    expect(headerRect).toBeTruthy();
    expect(rowRects).toHaveLength(2);
    expect(totalRect).toBeTruthy();

    expect(rowRects[0].y + rowRects[0].height).toBeCloseTo(headerRect!.y, 5);
    expect(rowRects[1].y + rowRects[1].height).toBeCloseTo(rowRects[0].y, 5);
    expect(totalRect!.y + totalRect!.height).toBeCloseTo(rowRects[1].y, 5);
  });

  it("renders optional payment details after the total block and before notes", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "invoice";
    draft.invoice.paymentDetails =
      "Bank: Monzo Business\nAccount number: 12345678\nSort code: 12-34-56";
    draft.invoice.paymentLink = "https://pay.kytepdf.com/invoice/INV-2026-001";

    await createPdfFromDraft(draft);

    const page = pdfCreatorMock.pages[0];
    const texts = page.drawText.mock.calls.map(([text]: [string]) => text);
    const totalIndex = texts.indexOf("Total Due");
    const paymentDetailsIndex = texts.indexOf("Payment Details");
    const paymentLinkIndex = texts.indexOf("Payment Link");
    const notesIndex = texts.indexOf("Notes");

    expect(paymentDetailsIndex).toBeGreaterThan(totalIndex);
    expect(paymentLinkIndex).toBeGreaterThan(paymentDetailsIndex);
    expect(notesIndex).toBeGreaterThan(paymentLinkIndex);
    expect(texts).toContain("https://pay.kytepdf.com/invoice/INV-2026-001");
  });

  it("places the invoice business name beside the logo in the header", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "invoice";
    draft.logoDataUrl = "data:image/png;base64,AQID";
    draft.invoice.businessName = "Jumis Cake Studio";

    await createPdfFromDraft(draft);

    const page = pdfCreatorMock.pages[0];
    const imageCall = page.drawImage.mock.calls[0];
    const headerTitleCall = page.drawText.mock.calls
      .map(([text, options]: [string, { x: number; size: number }]) => ({
        text,
        x: options.x,
        size: options.size,
      }))
      .find((call) => call.text === "Jumis Cake Studio" && call.size >= 16);

    expect(imageCall).toBeTruthy();
    expect(headerTitleCall).toBeTruthy();

    const imageOptions = imageCall[1] as { x: number; width: number };
    expect(headerTitleCall!.x).toBeCloseTo(imageOptions.x + imageOptions.width + 18, 5);
  });

  it("shrinks long invoice business names and paginates tall invoice rows", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "invoice";
    draft.logoDataUrl = "data:image/png;base64,AQID";
    draft.invoice.businessName = "A very long invoice business name that must be reduced to fit";
    draft.invoice.lineItems = Array.from({ length: 24 }, (_, index) => ({
      id: `item-${index}`,
      description: `Detailed service ${index} ${"with extended description ".repeat(6)}`,
      quantity: index + 1,
      unitPrice: 12.5,
    }));

    await createPdfFromDraft(draft);

    const companyCall = pdfCreatorMock.pages
      .flatMap((page) => page.drawText.mock.calls)
      .find(([text]: [string]) => text === draft.invoice.businessName);
    expect(companyCall?.[1].size).toBeLessThan(24);
    expect(pdfCreatorMock.pages.length).toBeGreaterThan(1);
  });

  it("aligns the logo, company name, and invoice label on the same header centerline", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "invoice";
    draft.logoDataUrl = "data:image/png;base64,AQID";
    draft.invoice.businessName = "Kyte Studio";

    await createPdfFromDraft(draft);

    const page = pdfCreatorMock.pages[0];
    const imageOptions = page.drawImage.mock.calls[0][1] as { y: number; height: number };
    const textCalls = page.drawText.mock.calls.map(
      ([text, options]: [string, { y: number; size: number }]) => ({
        text,
        y: options.y,
        size: options.size,
      }),
    );
    const companyCall = textCalls.find((call) => call.text === "Kyte Studio");
    const invoiceCall = textCalls.find((call) => call.text === "INVOICE");

    expect(companyCall).toBeTruthy();
    expect(invoiceCall).toBeTruthy();

    const logoCenterY = imageOptions.y + imageOptions.height / 2;
    const companyCenterY = companyCall!.y + companyCall!.size / 2;
    const invoiceCenterY = invoiceCall!.y + invoiceCall!.size / 2;

    expect(companyCenterY).toBeCloseTo(invoiceCenterY, 5);
    expect(logoCenterY).toBeCloseTo(companyCenterY, 5);
  });

  it("creates a business letter PDF", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "letter";
    draft.fileName = "kickoff-letter";

    const result = await createPdfFromDraft(draft);

    expect(result.outputName).toBe("kickoff-letter.pdf");
    expect(result.pageCount).toBe(1);
    expect(pdfCreatorMock.doc.setSubject).toHaveBeenCalledWith("Business letter");
  });

  it("falls back when the primary save returns no content", async () => {
    pdfCreatorMock.doc.save
      .mockResolvedValueOnce(new Uint8Array([]))
      .mockResolvedValueOnce(new Uint8Array([9, 8, 7]));

    const draft = createDefaultCreatorDraft();
    const result = await createPdfFromDraft(draft);

    expect(result.bytes).toEqual(new Uint8Array([9, 8, 7]));
    expect(pdfCreatorMock.doc.save).toHaveBeenNthCalledWith(2, { useObjectStreams: false });
  });

  it("uses base64 serialization when save fallbacks are empty", async () => {
    const originalBuffer = (globalThis as any).Buffer;
    Object.defineProperty(globalThis, "Buffer", {
      configurable: true,
      value: undefined,
    });
    pdfCreatorMock.doc.save.mockResolvedValue(new Uint8Array([]));
    pdfCreatorMock.doc.saveAsBase64.mockResolvedValueOnce("AQIDBA==");

    const result = await createPdfFromDraft(createDefaultCreatorDraft());

    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
    Object.defineProperty(globalThis, "Buffer", {
      configurable: true,
      value: originalBuffer,
    });
  });

  it("rejects invalid logos and empty serialized output", async () => {
    const invalidLogo = createDefaultCreatorDraft();
    invalidLogo.logoDataUrl = "not-a-data-url";
    await expect(createPdfFromDraft(invalidLogo)).rejects.toThrow("Invalid image data");

    pdfCreatorMock.doc.save.mockResolvedValue(new Uint8Array([]));
    pdfCreatorMock.doc.saveAsBase64.mockResolvedValueOnce("");
    await expect(createPdfFromDraft(createDefaultCreatorDraft())).rejects.toThrow(
      "PDF serialization produced no content",
    );
  });
});
