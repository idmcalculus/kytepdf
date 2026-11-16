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
    embedFont: vi.fn(async (source: unknown) => ({
      source,
      widthOfTextAtSize: (text: string, size: number) => text.length * size * 0.52,
      // Printable Latin-1, standing in for the WinAnsi set of the standard fonts.
      getCharacterSet: () =>
        Array.from({ length: 224 }, (_, index) => index + 32).filter(
          (code) => code < 127 || code > 159,
        ),
    })),
    registerFontkit: vi.fn(),
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
    TimesRomanItalic: "TimesRomanItalic",
  },
  degrees: (angle: number) => ({ angle }),
  rgb: (r: number, g: number, b: number) => ({ r, g, b }),
}));

import {
  calculateInvoiceTotal,
  calculatePayslipTotals,
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      })),
    );
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

  it("subtracts payslip deductions from earnings", () => {
    const draft = createDefaultCreatorDraft();
    draft.payslip.lineItems = [
      { id: "salary", description: "Salary", quantity: 1, unitPrice: 5000 },
      { id: "bonus", description: "Bonus", quantity: 2, unitPrice: 250 },
    ];
    draft.payslip.deductions = [
      { id: "tax", description: "Tax", quantity: 1, unitPrice: 750 },
      { id: "pension", description: "Pension", quantity: 2, unitPrice: 100 },
    ];

    expect(calculatePayslipTotals(draft.payslip)).toEqual({
      earnings: 5500,
      deductions: 950,
      totalPay: 4550,
    });
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

  it("creates a payslip with company and employee details but no billing labels", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "payslip";
    draft.fileName = "June Payslip";
    draft.payslip.companyAddress = "1 Payroll Way\nLondon";
    draft.payslip.employeeName = "Morgan Lee";
    draft.payslip.employeeDetails = "Employee ID: EMP-42\nEngineering";
    draft.payslip.payslipNumber = "PAY-42";
    draft.payslip.companyReference = "PAYROLL-REF-42";
    draft.payslip.detailsValueAlignment = "left";
    draft.payslip.footerLogoPosition = "right";
    draft.payslip.includeCompanyNameInHeader = false;
    draft.payslip.headerTextColor = "#00aa55";
    draft.payslip.payPeriod = "June 2026";
    draft.payslip.payDate = "2026-06-30";
    draft.payslip.lineItems = [
      { id: "salary", description: "Salary", quantity: 1, unitPrice: 5000 },
      { id: "bonus", description: "Bonus", quantity: 2, unitPrice: 250 },
    ];
    draft.payslip.deductions = [
      { id: "tax", description: "Tax", quantity: 1, unitPrice: 750 },
      { id: "pension", description: "Pension", quantity: 2, unitPrice: 100 },
    ];
    draft.logoDataUrl = "data:image/png;base64,AQID";

    const result = await createPdfFromDraft(draft);
    const texts = getRenderedTexts();

    expect(result.outputName).toBe("June Payslip.pdf");
    expect(texts).toContain("PAYSLIP");
    expect(texts).toContain("1 Payroll Way");
    expect(texts).toContain("Employee Information");
    expect(texts).toContain("Morgan Lee");
    expect(texts).toContain("Payslip #");
    expect(texts).toContain("Company Ref");
    expect(texts).toContain("PAYROLL-REF-42");
    expect(texts).toContain("Ref: PAYROLL-REF-42");
    expect(texts).toContain("Pay Period");
    expect(texts).toContain("Pay Date");
    expect(texts).toContain("Total Pay");
    expect(texts).toContain("Earnings");
    expect(texts).toContain("Deductions");
    expect(texts).toContain("Total Earnings");
    expect(texts).toContain("Total Deductions");
    expect(texts).toContain("£5,500.00");
    expect(texts).toContain("-£950.00");
    expect(texts).toContain("£4,550.00");
    expect(texts).not.toContain("Bill From");
    expect(texts).not.toContain("Bill To");
    expect(texts).not.toContain("Kyte Studio");
    const payslipHeaderCall = pdfCreatorMock.pages[0].drawText.mock.calls.find(
      ([text]: [string]) => text === "PAYSLIP",
    );
    const footerLogoCall = pdfCreatorMock.pages[0].drawImage.mock.calls.find(
      ([, options]: [unknown, { y: number }]) => options.y < 50,
    );
    expect(payslipHeaderCall[1].color).toEqual({ r: 0, g: 170 / 255, b: 85 / 255 });
    expect(footerLogoCall).toBeTruthy();
    expect(pdfCreatorMock.doc.setTitle).toHaveBeenCalledWith("PAY-42");
    expect(pdfCreatorMock.doc.setSubject).toHaveBeenCalledWith("Payslip");
  });

  it("uses the company logo as the default payslip background watermark", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "payslip";
    draft.logoDataUrl = "data:image/png;base64,AQID";

    await createPdfFromDraft(draft);

    const watermarkCall = pdfCreatorMock.pages[0].drawImage.mock.calls.find(
      ([, options]: [unknown, { opacity?: number }]) => options.opacity === 0.08,
    );
    expect(draft.payslip.watermark.source).toBe("company-logo");
    expect(watermarkCall).toBeTruthy();
    expect(watermarkCall[1]).toEqual(
      expect.objectContaining({
        opacity: 0.08,
        rotate: { angle: 0 },
      }),
    );
  });

  it("renders diagonal text and tiled custom-image watermark styles", async () => {
    const textDraft = createDefaultCreatorDraft();
    textDraft.template = "payslip";
    textDraft.payslip.watermark = {
      ...textDraft.payslip.watermark,
      source: "text",
      style: "diagonal",
      text: "PRIVATE",
      opacity: 12,
      size: 50,
      rotation: 0,
    };

    await createPdfFromDraft(textDraft);

    const textWatermark = pdfCreatorMock.pages[0].drawText.mock.calls.find(
      ([text]: [string]) => text === "PRIVATE",
    );
    expect(textWatermark[1]).toEqual(
      expect.objectContaining({ opacity: 0.12, rotate: { angle: -35 } }),
    );

    const imageDraft = createDefaultCreatorDraft();
    imageDraft.template = "payslip";
    imageDraft.payslip.watermark = {
      ...imageDraft.payslip.watermark,
      source: "custom-image",
      style: "tiled",
      customImageDataUrl: "data:image/png;base64,AQID",
      customImageFileName: "watermark.png",
      grayscale: true,
    };

    await createPdfFromDraft(imageDraft);

    const tiledWatermarks = pdfCreatorMock.pages[0].drawImage.mock.calls.filter(
      ([, options]: [unknown, { opacity?: number }]) => options.opacity === 0.08,
    );
    expect(tiledWatermarks.length).toBeGreaterThan(1);
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
    const totalIndex = texts.indexOf("Total Pending");
    const paymentDetailsIndex = texts.indexOf("Payment Details");
    const paymentLinkIndex = texts.indexOf("Payment Link");
    const notesIndex = texts.indexOf("Notes");

    expect(paymentDetailsIndex).toBeGreaterThan(totalIndex);
    expect(paymentLinkIndex).toBeGreaterThan(paymentDetailsIndex);
    expect(notesIndex).toBeGreaterThan(paymentLinkIndex);
    expect(texts).toContain("https://pay.kytepdf.com/invoice/INV-2026-001");
  });

  it("renders optional invoice reference and signature details", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "invoice";
    draft.invoice.companyReference = "DEEL REF: 5099601";
    draft.invoice.signature = "Habeeb Tijani";

    await createPdfFromDraft(draft);

    const page = pdfCreatorMock.pages[0];
    const texts = page.drawText.mock.calls.map(([text]: [string]) => text);
    const invoiceNumberIndex = texts.indexOf("Invoice #");
    const referenceLabelIndex = texts.indexOf("Company Ref");
    const issueDateIndex = texts.indexOf("Issue Date");
    const notesIndex = texts.indexOf("Notes");
    const signatureIndex = texts.indexOf("Habeeb Tijani");
    const signatureCall = page.drawText.mock.calls[signatureIndex];

    expect(referenceLabelIndex).toBeGreaterThan(invoiceNumberIndex);
    expect(issueDateIndex).toBeGreaterThan(referenceLabelIndex);
    expect(texts).toContain("DEEL REF: 5099601");
    expect(signatureIndex).toBeGreaterThan(notesIndex);
    expect(texts).not.toContain("Signature");
    expect(signatureCall[1].size).toBe(28);
    expect(signatureCall[1].font.source).toBeInstanceOf(Uint8Array);
    expect(pdfCreatorMock.doc.registerFontkit).toHaveBeenCalledOnce();
    expect(texts).toContain("Ref: DEEL REF: 5099601");
  });

  it.each([
    { position: "left" as const, pageSlot: "right", referenceSlot: "center" },
    { position: "center" as const, pageSlot: "right", referenceSlot: "left" },
    { position: "right" as const, pageSlot: "left", referenceSlot: "center" },
  ])("places invoice footer items correctly with the logo at $position", async ({
    position,
    pageSlot,
    referenceSlot,
  }) => {
    const draft = createDefaultCreatorDraft();
    draft.template = "invoice";
    draft.logoDataUrl = "data:image/png;base64,AQID";
    draft.invoice.companyReference = "REF-123";
    draft.invoice.footerLogoPosition = position;

    await createPdfFromDraft(draft);

    const page = pdfCreatorMock.pages[0];
    const footerLogoCall = page.drawImage.mock.calls.find(
      ([, options]: [unknown, { y: number }]) => options.y < 50,
    );
    const referenceCall = page.drawText.mock.calls.find(
      ([text]: [string]) => text === "Ref: REF-123",
    );
    const pageNumberCall = page.drawText.mock.calls.find(([text]: [string]) =>
      text.startsWith("Page "),
    );
    const logoOptions = footerLogoCall[1] as { x: number; width: number };
    const referenceOptions = referenceCall[1] as { x: number; size: number };
    const pageNumberOptions = pageNumberCall[1] as { x: number };

    if (position === "left") expect(logoOptions.x).toBe(56);
    if (position === "center") {
      expect(logoOptions.x + logoOptions.width / 2).toBeCloseTo(306, 5);
    }
    if (position === "right") {
      expect(logoOptions.x + logoOptions.width).toBeCloseTo(556, 5);
    }

    if (referenceSlot === "left") {
      expect(referenceOptions.x).toBe(56);
    } else {
      const referenceWidth = "Ref: REF-123".length * referenceOptions.size * 0.52;
      expect(referenceOptions.x + referenceWidth / 2).toBeCloseTo(306, 5);
    }

    if (pageSlot === "left") expect(pageNumberOptions.x).toBe(56);
    if (pageSlot === "right") expect(pageNumberOptions.x).toBeGreaterThan(306);
  });

  it.each([
    { position: "none" as const, referenceSlot: "left" },
    { position: "left" as const, referenceSlot: "center" },
    { position: "center" as const, referenceSlot: "left" },
    { position: "right" as const, referenceSlot: "center" },
  ])("places the payslip copyright note below the footer reference at $position", async ({
    position,
    referenceSlot,
  }) => {
    const draft = createDefaultCreatorDraft();
    draft.template = "payslip";
    draft.logoDataUrl = "data:image/png;base64,AQID";
    draft.payslip.companyReference = "PAYROLL-REF";
    draft.payslip.copyrightNote = "© 2026 Northstar Ltd. All rights reserved.";
    draft.payslip.footerLogoPosition = position;

    await createPdfFromDraft(draft);

    const page = pdfCreatorMock.pages[0];
    const referenceCall = page.drawText.mock.calls.find(
      ([text]: [string]) => text === "Ref: PAYROLL-REF",
    );
    const copyrightCall = page.drawText.mock.calls.find(
      ([text]: [string]) => text === "© 2026 Northstar Ltd. All rights reserved.",
    );
    const referenceOptions = referenceCall[1] as { x: number; y: number; size: number };
    const copyrightOptions = copyrightCall[1] as { x: number; y: number; size: number };

    expect(copyrightOptions.y).toBeLessThan(referenceOptions.y);
    if (referenceSlot === "left") {
      expect(referenceOptions.x).toBe(56);
      expect(copyrightOptions.x).toBe(56);
    } else {
      const referenceWidth = "Ref: PAYROLL-REF".length * referenceOptions.size * 0.52;
      const copyrightWidth =
        "© 2026 Northstar Ltd. All rights reserved.".length * copyrightOptions.size * 0.52;
      expect(referenceOptions.x + referenceWidth / 2).toBeCloseTo(306, 5);
      expect(copyrightOptions.x + copyrightWidth / 2).toBeCloseTo(306, 5);
    }
  });

  it("falls back to a standard italic font if the signature font cannot load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const draft = createDefaultCreatorDraft();
    draft.template = "invoice";
    draft.invoice.signature = "Habeeb Tijani";

    await createPdfFromDraft(draft);

    const signatureCall = pdfCreatorMock.pages[0].drawText.mock.calls.find(
      ([text]: [string]) => text === "Habeeb Tijani",
    );
    expect(signatureCall[1].font.source).toBe("TimesRomanItalic");
  });

  it("stacks billing addresses on the left and places invoice details on the right", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "invoice";
    draft.invoice.businessDetails = "Sender address";
    draft.invoice.clientDetails = "Client address";

    await createPdfFromDraft(draft);

    const calls = pdfCreatorMock.pages[0].drawText.mock.calls;
    const billFromCall = calls.find(([text]: [string]) => text === "Bill From");
    const billToCall = calls.find(([text]: [string]) => text === "Bill To");
    const invoiceNumberCall = calls.find(([text]: [string]) => text === "Invoice #");

    expect(billFromCall[1].x).toBeLessThan(invoiceNumberCall[1].x);
    expect(billToCall[1].x).toBeCloseTo(billFromCall[1].x, 5);
    expect(billToCall[1].y).toBeLessThan(billFromCall[1].y);
    expect(invoiceNumberCall[1].y).toBeGreaterThan(billToCall[1].y);
  });

  it("uses context-aware spacing before the invoice signature", async () => {
    const withoutNotes = createDefaultCreatorDraft();
    withoutNotes.template = "invoice";
    withoutNotes.invoice.notes = "";
    withoutNotes.invoice.signature = "Habeeb Tijani";

    await createPdfFromDraft(withoutNotes);

    const noNotesCalls = pdfCreatorMock.pages[0].drawText.mock.calls;
    const totalCall = noNotesCalls.filter(([text]: [string]) => text === "$2,720.00").at(-1);
    const noNotesSignatureCall = noNotesCalls.find(([text]: [string]) => text === "Habeeb Tijani");
    expect(totalCall[1].y - noNotesSignatureCall[1].y).toBeGreaterThanOrEqual(100);

    const withNotes = createDefaultCreatorDraft();
    withNotes.template = "invoice";
    withNotes.invoice.notes = "Payment received.";
    withNotes.invoice.signature = "Habeeb Tijani";

    await createPdfFromDraft(withNotes);

    const notesCalls = pdfCreatorMock.pages[0].drawText.mock.calls;
    const noteCall = notesCalls.find(([text]: [string]) => text === "Payment received.");
    const notesSignatureCall = notesCalls.find(([text]: [string]) => text === "Habeeb Tijani");
    expect(noteCall[1].y - notesSignatureCall[1].y).toBeCloseTo(42, 5);
  });

  it("renders paid invoice status, paid date, and total paid labels", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "invoice";
    draft.invoice.status = "paid";
    draft.invoice.paidDate = "2022-11-09";

    await createPdfFromDraft(draft);

    const page = pdfCreatorMock.pages[0];
    const texts = page.drawText.mock.calls.map(([text]: [string]) => text);
    const dueDateIndex = texts.indexOf("Due Date");
    const statusIndex = texts.indexOf("Status");
    const paidDateIndex = texts.indexOf("Paid Date");
    const totalPaidIndex = texts.indexOf("Total Paid");

    expect(statusIndex).toBeGreaterThan(dueDateIndex);
    expect(paidDateIndex).toBeGreaterThan(statusIndex);
    expect(totalPaidIndex).toBeGreaterThan(paidDateIndex);
    expect(texts).toContain("Paid");
    expect(texts).toContain("2022-11-09");
    expect(texts).not.toContain("Total Pending");
  });

  it("right-aligns invoice detail values to a shared edge by default", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "invoice";
    draft.invoice.invoiceNumber = "INV-ALIGN";
    draft.invoice.companyReference = "REF-ALIGN";
    draft.invoice.issueDate = "2026-05-29";
    draft.invoice.dueDate = "2026-06-05";
    draft.invoice.status = "paid";
    draft.invoice.paidDate = "2026-06-02";

    await createPdfFromDraft(draft);

    const detailValues = [
      "INV-ALIGN",
      "REF-ALIGN",
      "2026-05-29",
      "2026-06-05",
      "Paid",
      "2026-06-02",
    ];
    const calls = detailValues.map((value) =>
      pdfCreatorMock.pages[0].drawText.mock.calls.find(([text]: [string]) => text === value),
    );
    const rightEdges = calls.map(
      ([text, options]: [string, { x: number; size: number }]) =>
        options.x + text.length * options.size * 0.52,
    );

    rightEdges.forEach((edge) => {
      expect(edge).toBeCloseTo(rightEdges[0], 5);
    });
  });

  it("left-aligns invoice detail values to a fixed column when selected", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "invoice";
    draft.invoice.detailsValueAlignment = "left";
    draft.invoice.invoiceNumber = "INV-LEFT";
    draft.invoice.issueDate = "2026-05-29";
    draft.invoice.dueDate = "2026-06-05";

    await createPdfFromDraft(draft);

    const detailValues = ["INV-LEFT", "2026-05-29", "2026-06-05", "Pending"];
    const valueXs = detailValues.map((value) => {
      const call = pdfCreatorMock.pages[0].drawText.mock.calls.find(
        ([text]: [string]) => text === value,
      );
      return call[1].x as number;
    });

    valueXs.forEach((x) => {
      expect(x).toBeCloseTo(valueXs[0], 5);
    });
  });

  it("uses the selected invoice header text color", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "invoice";
    draft.accentColor = "#ffffff";
    draft.invoice.headerTextColor = "#111827";

    await createPdfFromDraft(draft);

    const page = pdfCreatorMock.pages[0];
    const headerCalls = page.drawText.mock.calls.filter(([text]: [string]) => text === "INVOICE");

    expect(headerCalls).toHaveLength(1);
    headerCalls.forEach(([, options]: [string, { color: unknown }]) => {
      expect(options.color).toEqual({ r: 17 / 255, g: 24 / 255, b: 39 / 255 });
    });
  });

  it("applies the payslip accent color across the document theme", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "payslip";
    draft.accentColor = "#c026d3";
    draft.payslip.companyReference = "PAYROLL-REF";

    await createPdfFromDraft(draft);

    const page = pdfCreatorMock.pages[0];
    const rectangles = page.drawRectangle.mock.calls.map(
      ([options]: [
        {
          x: number;
          height: number;
          color: unknown;
          borderColor?: unknown;
        },
      ]) => options,
    );
    const title = rectangles.find((rectangle) => rectangle.x > 56 && rectangle.height === 32);
    const tableHeader = rectangles.find(
      (rectangle) => rectangle.x === 56 && rectangle.height === 30,
    );
    const tableRow = rectangles.find((rectangle) => rectangle.x === 56 && rectangle.height === 34);
    const total = rectangles.find((rectangle) => rectangle.x > 56 && rectangle.height === 84);
    const divider = page.drawLine.mock.calls
      .map(([options]: [{ start: { x: number }; end: { x: number }; color: unknown }]) => options)
      .find((line) => line.start.x === 56 && line.end.x > line.start.x);
    const accent = { r: 192 / 255, g: 38 / 255, b: 211 / 255 };

    expect(title?.color).toEqual(accent);
    expect(tableHeader?.color).toEqual(total?.color);
    expect(tableHeader?.color).not.toEqual({ r: 0.94, g: 0.98, b: 0.99 });
    expect(tableHeader?.borderColor).toEqual(tableRow?.borderColor);
    expect(divider?.color).toEqual(tableHeader?.borderColor);

    ["Employee Information", "Total Pay", "Notes", "Ref: PAYROLL-REF"].forEach((label) => {
      const call = page.drawText.mock.calls.find(([text]: [string]) => text === label);
      expect(call[1].color).toEqual(accent);
    });
  });

  it("keeps invoice section labels readable with a near-white accent", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "invoice";
    draft.accentColor = "#ffffff";

    await createPdfFromDraft(draft);

    const page = pdfCreatorMock.pages[0];
    const sectionLabels = ["Bill From", "Bill To", "Total Pending", "Notes"];
    sectionLabels.forEach((label) => {
      const call = page.drawText.mock.calls.find(([text]: [string]) => text === label);
      expect(call[1].color).toEqual({ r: 0.11, g: 0.17, b: 0.29 });
    });
  });

  it("omits only the business name from the header when disabled", async () => {
    const draft = createDefaultCreatorDraft();
    draft.template = "invoice";
    draft.invoice.includeBusinessNameInHeader = false;
    draft.logoDataUrl = "data:image/png;base64,AQID";

    await createPdfFromDraft(draft);

    const page = pdfCreatorMock.pages[0];
    const texts = page.drawText.mock.calls.map(([text]: [string]) => text);
    const businessNameCalls = texts.filter((text: string) => text === "Kyte Studio");
    const headerRectangle = page.drawRectangle.mock.calls.find(
      ([options]: [{ x: number; height: number }]) => options.x > 56 && options.height === 32,
    );

    expect(texts).toContain("INVOICE");
    expect(businessNameCalls).toHaveLength(1);
    expect(headerRectangle).toBeTruthy();
    expect(page.drawImage).toHaveBeenCalledOnce();
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
      .find((call) => call.text === "Jumis Cake Studio");

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
    expect(companyCall?.[1].size).toBeLessThan(22);
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
