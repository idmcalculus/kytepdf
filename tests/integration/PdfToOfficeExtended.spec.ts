import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  localConverter: {
    pdfToExcel: vi.fn(),
    pdfToWord: vi.fn(),
    pdfToWordFromEnvelope: vi.fn(),
    pdfToExcelFromEnvelope: vi.fn(),
  },
  persistence: {
    addJob: vi.fn().mockResolvedValue(1),
    delete: vi.fn().mockResolvedValue(undefined),
    estimateUsage: vi.fn().mockResolvedValue(0),
    get: vi.fn().mockResolvedValue(undefined),
    getJobs: vi.fn().mockResolvedValue([]),
    getStorageUsage: vi.fn().mockResolvedValue({ quota: 1000, usage: 0 }),
    set: vi.fn().mockResolvedValue(undefined),
  },
  preview: {
    load: vi.fn().mockResolvedValue(undefined),
    next: vi.fn(),
    prev: vi.fn(),
  },
  pdfInspectorEngine: {
    analyze: vi.fn(),
  },
  ocrEngine: {
    enrichMarkdownWithOcr: vi.fn(),
  },
}));

vi.mock("../../utils/LocalConverter.ts", () => ({
  localConverter: mocks.localConverter,
}));

vi.mock("../../utils/pdfInspectorEngine.ts", () => ({
  PdfInspectorError: class PdfInspectorError extends Error {
    reason: string;
    constructor(failure: { reason: string; message: string }) {
      super(failure.message);
      this.name = "PdfInspectorError";
      this.reason = failure.reason;
    }
  },
  pdfInspectorEngine: mocks.pdfInspectorEngine,
}));

vi.mock("../../utils/ocrEngine.ts", () => ({
  OcrError: class OcrError extends Error {
    reason: string;
    constructor(reason: string, message: string) {
      super(message);
      this.name = "OcrError";
      this.reason = reason;
    }
  },
  ocrEngine: mocks.ocrEngine,
}));

vi.mock("../../utils/pdfPreview.ts", () => ({
  getPdfPreviewErrorMessage: vi.fn(() => "Preview error message"),
  PdfPreviewController: class {
    load = mocks.preview.load;
    next = mocks.preview.next;
    prev = mocks.preview.prev;
  },
}));

vi.mock("../../utils/persistence.ts", () => ({
  persistence: mocks.persistence,
}));

import { PdfToOffice } from "../../components/PdfToOffice";
import { OcrError } from "../../utils/ocrEngine";
import { PdfInspectorError } from "../../utils/pdfInspectorEngine";

const asFileList = (files: File[]) => files as unknown as FileList;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const pdfFile = (name = "sample.pdf") =>
  new File(["%PDF-1.4 mock"], name, { type: "application/pdf" });

describe("PdfToOffice extended behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.localConverter.pdfToWord.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      quality: "good",
      success: true,
      warnings: [],
    });
    mocks.localConverter.pdfToExcel.mockResolvedValue({
      data: new Uint8Array([4, 5, 6]),
      quality: "fair",
      success: true,
      warnings: ["Some layout fidelity may be reduced in local mode."],
    });
    mocks.persistence.get.mockResolvedValue(undefined);
    mocks.persistence.estimateUsage.mockResolvedValue(0);
    mocks.persistence.getStorageUsage.mockResolvedValue({ quota: 1000, usage: 0 });
    mocks.persistence.getJobs.mockResolvedValue([]);
    mocks.preview.load.mockResolvedValue(undefined);
    mocks.pdfInspectorEngine.analyze
      .mockReset()
      .mockRejectedValue(new Error("unavailable in test"));
    mocks.ocrEngine.enrichMarkdownWithOcr.mockReset();
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
    (window as any).lucide = { createIcons: vi.fn() };
  });

  const mount = async (format: "docx" | "pptx" | "xlsx" | "pdf" = "docx") => {
    const component = new PdfToOffice(format);
    document.body.appendChild(component);
    await flush();
    return component;
  };

  it("maps format labels and local support", async () => {
    const word = new PdfToOffice("docx");
    expect(word.formatLabel).toBe("Word");
    expect(word.supportsLocal).toBe(true);

    const powerpoint = new PdfToOffice("pptx");
    expect(powerpoint.formatLabel).toBe("PowerPoint");
    expect(powerpoint.supportsLocal).toBe(false);

    const excel = new PdfToOffice("xlsx");
    expect(excel.formatLabel).toBe("Excel (Sheets)");
    expect(excel.supportsLocal).toBe(true);

    const pdf = new PdfToOffice("pdf");
    expect(pdf.formatLabel).toBe("PDF");
  });

  it("uses the format attribute and marks PPT unavailable locally", async () => {
    const component = new PdfToOffice();
    component.setAttribute("format", "pptx");
    document.body.appendChild(component);
    await flush();

    expect(component.querySelector("h1")?.textContent).toContain("PDF to PowerPoint");
    expect(component.querySelector("#convertLabel")?.textContent).toContain("Not available");
    expect(component.querySelector("#modeCloudBtn")).toBeNull();
  });

  it("loads previews, handles preview failures, and restores sessions", async () => {
    const component = await mount("docx");
    const file = pdfFile();

    await component.handleFiles(asFileList([file]));
    expect(mocks.persistence.set).toHaveBeenCalledWith("pdf-to-docx", file);
    expect(mocks.preview.load).toHaveBeenCalledWith(file);
    expect(component.querySelector("#mainLayout")?.classList.contains("hidden")).toBe(false);

    mocks.preview.load.mockRejectedValueOnce(new Error("preview failed"));
    await component.handleFiles(asFileList([pdfFile("bad.pdf")]));
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Preview error message", type: "error" }),
    );

    const saved = pdfFile("saved.pdf");
    mocks.persistence.get.mockResolvedValue(saved);
    await component.checkExistingSession();
    expect(component.querySelector("#resumeContainer")?.classList.contains("hidden")).toBe(false);
    await component.restoreSession();
    expect(component.querySelector("#fileName")?.textContent).toBe("saved.pdf");
  });

  it("does not execute HTML/JS embedded in a resumed filename (stored XSS regression)", async () => {
    const maliciousName = "<img src=x onerror=window.__resumeXss=1>.pdf";
    const saved = pdfFile(maliciousName);
    mocks.persistence.get.mockResolvedValue(saved);
    (window as any).__resumeXss = undefined;

    const component = await mount("docx");
    await component.checkExistingSession();

    const resumeBtn = component.querySelector("#resumeBtn") as HTMLElement;
    expect(resumeBtn.querySelector("img")).toBeNull();
    expect((window as any).__resumeXss).toBeUndefined();
    expect(resumeBtn.textContent).toContain(".pdf");
  });

  it("runs local Word and Excel conversions and reuses cached PDF bytes", async () => {
    const word = await mount("docx");
    const file = pdfFile();
    await word.handleFiles(asFileList([file]));

    await word.handleConvert();
    await word.handleConvert();

    expect(mocks.localConverter.pdfToWord).toHaveBeenCalledTimes(2);
    expect((word as any).cachedPdfBytes).toBeInstanceOf(Uint8Array);
    expect(mocks.persistence.addJob).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ mode: "local", quality: "good" }),
        tool: "PDF to Word",
      }),
    );

    word.remove();
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
    const excel = await mount("xlsx");
    await excel.handleFiles(asFileList([pdfFile("table.pdf")]));
    await excel.handleConvert();

    expect(mocks.localConverter.pdfToExcel).toHaveBeenCalled();
    expect(mocks.persistence.addJob).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ format: "xlsx", mode: "local", quality: "fair" }),
        tool: "PDF to Excel (Sheets)",
      }),
    );
  });

  it("clears the stale pre-OCR warning after OCR succeeds, so job metadata doesn't contradict itself", async () => {
    mocks.pdfInspectorEngine.analyze.mockResolvedValueOnce({
      fileType: "application/pdf",
      pdfType: "Scanned",
      pageCount: 1,
      confidence: 0.9,
      markdown: "",
      layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
      pagesNeedingOcr: [1],
      ocrReasonsByPage: [{ page: 1, reason: "scanned" }],
      hasEncodingIssues: false,
      engine: "pdf-inspector-wasm",
      engineVersion: "1.14.1",
      processingTimeMs: 5,
      warnings: ["Page 1 needs OCR on page 1 before it can be exported."],
    });
    mocks.ocrEngine.enrichMarkdownWithOcr.mockResolvedValueOnce({
      markdown: "# Recognized text",
      ocr: { pages: [{ page: 1, text: "Recognized text" }], warnings: [] },
    });
    mocks.localConverter.pdfToWordFromEnvelope.mockResolvedValueOnce({
      success: true,
      data: new Uint8Array([1, 2, 3]),
      quality: "good",
      warnings: [],
    });

    const component = await mount("docx");
    await component.handleFiles(asFileList([pdfFile("scanned.pdf")]));
    await component.handleConvert();

    expect(mocks.ocrEngine.enrichMarkdownWithOcr).toHaveBeenCalled();
    const call = mocks.persistence.addJob.mock.calls.at(-1)?.[0];
    const warnings: string[] = call.metadata.warnings;
    // The pre-OCR "won't include text" / "needs OCR" warnings must not
    // survive alongside "OCR applied" once recognition actually succeeded.
    expect(warnings.some((w) => /will not include text from page/i.test(w))).toBe(false);
    expect(warnings.some((w) => /needs OCR on page/i.test(w))).toBe(false);
    expect(warnings.some((w) => /OCR applied/i.test(w))).toBe(true);
  });

  it("handles local conversion failures and missing files", async () => {
    const component = await mount("docx");
    await component.handleConvert();
    expect(mocks.localConverter.pdfToWord).not.toHaveBeenCalled();

    await component.handleFiles(asFileList([pdfFile()]));
    mocks.localConverter.pdfToWord.mockResolvedValueOnce({
      data: null,
      quality: "poor",
      success: false,
      warnings: [],
    });

    await component.handleConvert();

    expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Error", type: "error" }),
    );

    expect((component.querySelector("#convertBtn") as HTMLButtonElement).disabled).toBe(false);
    expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(true);
  });

  it("keeps OCR toggle available for local conversion", async () => {
    const component = await mount("docx");
    await component.handleFiles(asFileList([pdfFile()]));
    const ocrToggle = component.querySelector("#ocrToggle") as HTMLInputElement;
    expect(ocrToggle.disabled).toBe(false);
    ocrToggle.checked = true;
    ocrToggle.dispatchEvent(new Event("change"));
    expect((component as any).ocrEnabled).toBe(true);
  });
});

describe("PdfToOffice with pdf-inspector analysis", () => {
  const envelope = (overrides: Record<string, unknown> = {}) => ({
    fileType: "application/pdf",
    pdfType: "TextBased",
    pageCount: 2,
    confidence: 0.95,
    markdown: "<!-- Page 1 -->\n\nHello",
    layout: { isComplex: false, pagesWithTables: [] as number[], pagesWithColumns: [] },
    pagesNeedingOcr: [] as number[],
    ocrReasonsByPage: [],
    hasEncodingIssues: false,
    engine: "pdf-inspector-wasm",
    engineVersion: "1.14.1",
    processingTimeMs: 2,
    warnings: [] as string[],
    ...overrides,
  });
  const converted = (warnings: string[] = []) => ({
    success: true,
    data: new Uint8Array([9, 9]),
    quality: "good",
    warnings,
  });
  const dialog = () => (document.getElementById("globalDialog") as any).show;
  const lastDialog = () => dialog().mock.calls.at(-1)?.[0];
  const lastJob = () => mocks.persistence.addJob.mock.calls.at(-1)?.[0];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persistence.get.mockResolvedValue(undefined);
    mocks.persistence.estimateUsage.mockResolvedValue(0);
    mocks.persistence.getStorageUsage.mockResolvedValue({ quota: 1000, usage: 0 });
    mocks.persistence.getJobs.mockResolvedValue([]);
    mocks.preview.load.mockResolvedValue(undefined);
    mocks.pdfInspectorEngine.analyze.mockReset().mockResolvedValue(envelope());
    mocks.ocrEngine.enrichMarkdownWithOcr.mockReset();
    mocks.localConverter.pdfToWordFromEnvelope.mockReset().mockResolvedValue(converted());
    mocks.localConverter.pdfToExcelFromEnvelope.mockReset().mockResolvedValue(converted());
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
  });

  const mountWithFile = async (format: "docx" | "xlsx" = "docx") => {
    const component = new PdfToOffice(format);
    document.body.appendChild(component);
    await flush();
    await component.handleFiles(asFileList([pdfFile("statement.pdf")]));
    return component;
  };

  it("starts a conversion from the convert button", async () => {
    const component = await mountWithFile();

    (component.querySelector("#convertBtn") as HTMLButtonElement).click();

    await vi.waitFor(() => expect(mocks.persistence.addJob).toHaveBeenCalled());
    expect(lastJob().fileName).toBe("statement_converted.docx");
  });

  it("rejects files that are not PDFs", async () => {
    const component = new PdfToOffice("docx");
    document.body.appendChild(component);
    await flush();

    await component.handleFiles(asFileList([new File(["x"], "photo.png", { type: "image/png" })]));

    expect(lastDialog()).toMatchObject({ type: "error" });
    expect(mocks.persistence.set).not.toHaveBeenCalled();
  });

  it("moves the preview with the page buttons", async () => {
    const component = await mountWithFile();

    (component.querySelector("#nextPage") as HTMLButtonElement).click();
    (component.querySelector("#prevPage") as HTMLButtonElement).click();

    expect(mocks.preview.next).toHaveBeenCalledTimes(1);
    expect(mocks.preview.prev).toHaveBeenCalledTimes(1);
  });

  it("survives a storage error while looking for a saved session", async () => {
    const component = await mountWithFile();
    mocks.persistence.get.mockRejectedValueOnce(new Error("IndexedDB unavailable"));

    await expect(component.checkExistingSession()).resolves.toBeUndefined();
  });

  it("builds the Word file from the analysis and reports what it found", async () => {
    const analysis = envelope({
      layout: { isComplex: true, pagesWithTables: [1, 2], pagesWithColumns: [] },
      hasEncodingIssues: true,
    });
    mocks.pdfInspectorEngine.analyze.mockResolvedValue(analysis);
    const component = await mountWithFile();

    await component.handleConvert();

    expect(mocks.pdfInspectorEngine.analyze).toHaveBeenCalledWith(expect.any(Uint8Array), {
      profile: "compact",
    });
    expect(mocks.localConverter.pdfToWordFromEnvelope).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      analysis,
    );
    expect(mocks.localConverter.pdfToWord).not.toHaveBeenCalled();
    // One paragraph of whole sentences: the dialog does not show line breaks.
    expect(lastDialog().message).toBe(
      "Your Word file is ready. " +
        "Source type: TextBased (95% confidence). " +
        "Tables detected on pages 1, 2. " +
        "Encoding issues detected in the source PDF.",
    );
    expect(lastJob().metadata).toMatchObject({
      engine: "pdf-inspector-wasm",
      pdfType: "TextBased",
      confidence: 0.95,
      pagesNeedingOcr: [],
      ocrPages: [],
    });
  });

  it("leaves out the source type when the analysis could not tell it", async () => {
    mocks.pdfInspectorEngine.analyze.mockResolvedValue(envelope({ pdfType: "Unknown" }));
    const component = await mountWithFile();

    await component.handleConvert();

    expect(lastDialog().message).toBe("Your Word file is ready.");
  });

  it.each([
    [[3], "Tables detected on page 3."],
    [[1, 4], "Tables detected on pages 1, 4."],
    [[], "No tables were confidently detected. The spreadsheet may contain only flat text rows."],
  ])("builds the Excel file from the analysis (tables on %j)", async (tables, warning) => {
    mocks.pdfInspectorEngine.analyze.mockResolvedValue(
      envelope({ layout: { isComplex: false, pagesWithTables: tables, pagesWithColumns: [] } }),
    );
    const component = await mountWithFile("xlsx");

    await component.handleConvert();

    expect(mocks.localConverter.pdfToExcelFromEnvelope).toHaveBeenCalled();
    expect(mocks.localConverter.pdfToExcel).not.toHaveBeenCalled();
    expect(lastJob().metadata.warnings).toContain(warning);
  });

  it.each([
    ["encrypted"],
    ["password-required"],
  ] as const)("points to the Unlock PDF tool when the PDF is %s", async (reason) => {
    mocks.pdfInspectorEngine.analyze.mockRejectedValue(
      new PdfInspectorError({ reason, message: "locked" }),
    );
    const component = await mountWithFile();

    await component.handleConvert();

    // The tool has no password field, so the message must not ask for one.
    expect(lastDialog()).toMatchObject({
      type: "error",
      message:
        "Conversion failed. This PDF is password-protected. Remove the password with the Unlock PDF tool, then try again.",
    });
    expect(mocks.localConverter.pdfToWord).not.toHaveBeenCalled();
    expect(mocks.localConverter.pdfToWordFromEnvelope).not.toHaveBeenCalled();
    expect(mocks.persistence.addJob).not.toHaveBeenCalled();
  });

  it("falls back to the legacy export when the WASM engine cannot load", async () => {
    mocks.pdfInspectorEngine.analyze.mockRejectedValue(
      new PdfInspectorError({
        reason: "engine-unavailable",
        message: "pdf-inspector wasm fetch failed: 404",
      }),
    );
    const component = await mountWithFile();

    await component.handleConvert();

    expect(mocks.localConverter.pdfToWord).toHaveBeenCalled();
    expect(lastDialog()).toMatchObject({ type: "success", message: "Your Word file is ready." });
  });

  it("falls back to the legacy export for other analysis failures", async () => {
    mocks.pdfInspectorEngine.analyze.mockRejectedValue(
      new PdfInspectorError({ reason: "malformed", message: "bad xref" }),
    );
    const component = await mountWithFile();

    await component.handleConvert();

    expect(mocks.localConverter.pdfToWord).toHaveBeenCalled();
    expect(lastJob().metadata.pdfType).toBeUndefined();
  });

  describe("scanned pages", () => {
    const turnOcrOff = (component: PdfToOffice) => {
      const toggle = component.querySelector("#ocrToggle") as HTMLInputElement;
      toggle.checked = false;
      toggle.dispatchEvent(new Event("change"));
    };

    it.each([
      [
        "Scanned",
        [1],
        "This document is scanned — local export will not include text from page 1 until OCR is performed.",
        "Needs OCR on page 1",
      ],
      [
        "Mixed",
        [2, 3],
        "This document is mixed — local export will not include text from pages 2, 3 until OCR is performed.",
        "Needs OCR on pages 2, 3",
      ],
    ])("warns that %s pages will be missing when OCR is off", async (pdfType, pages, warning, diagnosis) => {
      mocks.pdfInspectorEngine.analyze.mockResolvedValue(
        envelope({ pdfType, pagesNeedingOcr: pages }),
      );
      const component = await mountWithFile();
      turnOcrOff(component);

      await component.handleConvert();

      expect(mocks.ocrEngine.enrichMarkdownWithOcr).not.toHaveBeenCalled();
      expect(lastJob().metadata.warnings).toContain(warning);
      expect(lastDialog().message).toContain(diagnosis);
      expect(lastJob().metadata.ocr).toBe(false);
    });

    it("names no pages when a scanned PDF reports none", async () => {
      mocks.pdfInspectorEngine.analyze.mockResolvedValue(
        envelope({ pdfType: "Scanned", pagesNeedingOcr: [] }),
      );
      const component = await mountWithFile();

      await component.handleConvert();

      expect(mocks.ocrEngine.enrichMarkdownWithOcr).not.toHaveBeenCalled();
      expect(lastJob().metadata.warnings).toContain(
        "This document is scanned — local export will not include text from pages (OCR-needed) until OCR is performed.",
      );
    });

    it("reports the pages OCR could not read", async () => {
      mocks.pdfInspectorEngine.analyze.mockResolvedValue(
        envelope({ pdfType: "Mixed", pageCount: 3, pagesNeedingOcr: [2, 3] }),
      );
      mocks.ocrEngine.enrichMarkdownWithOcr.mockResolvedValue({
        markdown: "<!-- Page 2 -->\n\nScanned",
        ocr: {
          pages: [{ page: 2, text: "Scanned" }],
          warnings: ["Page 3 OCR timed out; skipped."],
        },
      });
      const component = await mountWithFile();

      await component.handleConvert();

      expect(mocks.ocrEngine.enrichMarkdownWithOcr).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        "<!-- Page 1 -->\n\nHello",
        [2, 3],
        3,
      );
      const passed = mocks.localConverter.pdfToWordFromEnvelope.mock.calls[0][1];
      expect(passed).toMatchObject({
        markdown: "<!-- Page 2 -->\n\nScanned",
        pagesNeedingOcr: [3],
      });
      const warnings: string[] = lastJob().metadata.warnings;
      expect(
        warnings.some((w) => w.startsWith("Local export still will not include text from page 3 ")),
      ).toBe(true);
      expect(warnings).toContain("Page 3 OCR timed out; skipped.");
      expect(warnings).toContain("OCR applied to page 2.");
      expect(warnings.some((w) => /until OCR is performed/.test(w))).toBe(false);
      // Both what OCR read and what is still missing.
      expect(lastDialog().message).toContain(
        "OCR applied to page 2. Text missing from page 3 (OCR could not read it).",
      );
      expect(lastJob().metadata).toMatchObject({ ocrPages: [2], pagesNeedingOcr: [3] });
    });

    it("reports every page when OCR recognised none of them", async () => {
      mocks.pdfInspectorEngine.analyze.mockResolvedValue(
        envelope({ pdfType: "Scanned", pagesNeedingOcr: [1, 2], markdown: undefined }),
      );
      mocks.ocrEngine.enrichMarkdownWithOcr.mockResolvedValue({
        markdown: "",
        ocr: { pages: [], warnings: [] },
      });
      const component = await mountWithFile();

      await component.handleConvert();

      expect(mocks.ocrEngine.enrichMarkdownWithOcr.mock.calls[0][1]).toBe("");
      const warnings: string[] = lastJob().metadata.warnings;
      expect(
        warnings.some((w) =>
          w.startsWith("Local export still will not include text from pages 1, 2 "),
        ),
      ).toBe(true);
      expect(warnings.some((w) => /^OCR applied/.test(w))).toBe(false);
    });

    it("says how many pages OCR covered when it applied to several", async () => {
      mocks.pdfInspectorEngine.analyze.mockResolvedValue(
        envelope({ pdfType: "Scanned", pagesNeedingOcr: [1, 2] }),
      );
      mocks.ocrEngine.enrichMarkdownWithOcr.mockResolvedValue({
        markdown: "both",
        ocr: { pages: [{ page: 1 }, { page: 2 }], warnings: [] },
      });
      const component = await mountWithFile();

      await component.handleConvert();

      expect(lastJob().metadata.warnings).toContain("OCR applied to pages 1, 2.");
      expect(lastDialog().message).toContain("OCR applied to pages 1, 2");
    });

    it.each([
      [
        "an OCR error",
        () => new OcrError("worker-failed", "OCR worker could not start."),
        "OCR skipped: OCR worker could not start.",
      ],
      ["an unexpected error", () => new Error("boom"), "OCR skipped: OCR failed"],
    ])("converts the native text when OCR fails with %s", async (_label, makeError, warning) => {
      mocks.pdfInspectorEngine.analyze.mockResolvedValue(
        envelope({ pdfType: "Scanned", pagesNeedingOcr: [1] }),
      );
      mocks.ocrEngine.enrichMarkdownWithOcr.mockRejectedValue(makeError());
      const component = await mountWithFile();

      await component.handleConvert();

      expect(mocks.localConverter.pdfToWordFromEnvelope).toHaveBeenCalled();
      expect(lastJob().metadata.warnings).toContain(warning);
      expect(lastDialog()).toMatchObject({ type: "success" });
    });
  });
});

describe("PdfToOffice review fixes", () => {
  const envelope = (overrides: Record<string, unknown> = {}) => ({
    fileType: "application/pdf",
    pdfType: "TextBased",
    pageCount: 2,
    confidence: 0.95,
    markdown: "<!-- Page 1 -->\n\nHello",
    layout: { isComplex: false, pagesWithTables: [] as number[], pagesWithColumns: [] },
    pagesNeedingOcr: [] as number[],
    ocrReasonsByPage: [],
    hasEncodingIssues: false,
    engine: "pdf-inspector-wasm",
    engineVersion: "1.14.1",
    processingTimeMs: 2,
    warnings: [] as string[],
    ...overrides,
  });
  const converted = (quality = "good") => ({
    success: true,
    data: new Uint8Array([9, 9]),
    quality,
    warnings: [],
  });
  const dialog = () => (document.getElementById("globalDialog") as any).show;
  const lastDialog = () => dialog().mock.calls.at(-1)?.[0];
  const lastJob = () => mocks.persistence.addJob.mock.calls.at(-1)?.[0];
  const banner = (component: PdfToOffice) =>
    component.querySelector("#qualityWarning") as HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persistence.get.mockResolvedValue(undefined);
    mocks.persistence.estimateUsage.mockResolvedValue(0);
    mocks.persistence.getStorageUsage.mockResolvedValue({ quota: 1000, usage: 0 });
    mocks.persistence.getJobs.mockResolvedValue([]);
    mocks.preview.load.mockResolvedValue(undefined);
    mocks.pdfInspectorEngine.analyze.mockReset().mockResolvedValue(envelope());
    mocks.ocrEngine.enrichMarkdownWithOcr.mockReset();
    mocks.localConverter.pdfToWordFromEnvelope.mockReset().mockResolvedValue(converted());
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
  });

  const mountWithFile = async (name = "statement.pdf") => {
    const component = new PdfToOffice("docx");
    document.body.appendChild(component);
    await flush();
    await component.handleFiles(asFileList([pdfFile(name)]));
    return component;
  };

  it("names pages still missing after OCR even when it read none of them", async () => {
    mocks.pdfInspectorEngine.analyze.mockResolvedValue(
      envelope({ pdfType: "Scanned", pagesNeedingOcr: [1, 2] }),
    );
    mocks.ocrEngine.enrichMarkdownWithOcr.mockResolvedValue({
      markdown: "",
      ocr: { pages: [], warnings: [] },
    });
    const component = await mountWithFile();

    await component.handleConvert();

    expect(lastDialog().message).toContain(
      "Text missing from pages 1, 2 (OCR could not read them).",
    );
    expect(lastDialog().message).not.toContain("Needs OCR");
  });

  it("does not suggest turning on OCR when OCR was already on", async () => {
    mocks.pdfInspectorEngine.analyze.mockResolvedValue(
      envelope({ pdfType: "Mixed", confidence: 0.7, pagesNeedingOcr: [2] }),
    );
    mocks.ocrEngine.enrichMarkdownWithOcr.mockResolvedValue({
      markdown: "text",
      ocr: { pages: [{ page: 2 }], warnings: [] },
    });
    mocks.localConverter.pdfToWordFromEnvelope.mockResolvedValue(converted("poor"));
    const component = await mountWithFile();

    await component.handleConvert();

    expect(banner(component).classList.contains("hidden")).toBe(false);
    expect(banner(component).textContent?.trim()).toBe(
      "Some pages could not be read reliably. Check the output against the original.",
    );
  });

  it("suggests OCR when it was off, and clears the note for the next file", async () => {
    mocks.localConverter.pdfToWordFromEnvelope.mockResolvedValue(converted("poor"));
    const component = await mountWithFile();
    const toggle = component.querySelector("#ocrToggle") as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));

    await component.handleConvert();
    expect(banner(component).textContent?.trim()).toBe(
      "This PDF yielded limited extractable text. Try enabling OCR for scanned content.",
    );
    expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(false);

    await component.handleFiles(asFileList([pdfFile("next.pdf")]));

    expect(banner(component).classList.contains("hidden")).toBe(true);
    expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(true);
    expect((component.querySelector("#downloadLink") as HTMLElement).onclick).toBeNull();
  });

  it("names the output after the file it came from when another file is picked mid-run", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.pdfInspectorEngine.analyze.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const component = await mountWithFile("first.pdf");

    const run = component.handleConvert();
    await flush();
    await component.handleFiles(asFileList([pdfFile("second.pdf")]));
    finish(envelope());
    await run;

    expect(lastJob().fileName).toBe("first_converted.docx");
    expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(true);
    expect(dialog().mock.calls.some(([options]: any[]) => options.type === "success")).toBe(false);
  });

  it("names and describes the OCR checkbox", async () => {
    const component = await mountWithFile();
    const toggle = component.querySelector("#ocrToggle") as HTMLInputElement;

    const label = component.querySelector(`#${toggle.getAttribute("aria-labelledby")}`);
    const desc = component.querySelector(`#${toggle.getAttribute("aria-describedby")}`);
    expect(label?.textContent).toBe("OCR (Text Recognition)");
    expect(desc?.textContent).toBe("Runs locally on pages that need it");
  });
});
