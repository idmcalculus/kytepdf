import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisEnvelope } from "../../utils/pdfInspectorTypes";

const mocks = vi.hoisted(() => ({
  localConverter: {
    pdfToMarkdown: vi.fn(),
    pdfToText: vi.fn(),
  },
  persistence: {
    addJob: vi.fn().mockResolvedValue(1),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteJob: vi.fn().mockResolvedValue(undefined),
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
    extractMarkdown: vi.fn(),
    extractText: vi.fn(),
  },
  ocrEngine: {
    enrichMarkdownWithOcr: vi.fn(),
  },
}));

vi.mock("../../utils/LocalConverter.ts", () => ({
  localConverter: mocks.localConverter,
}));

// Keep the real PdfInspectorError so the component's instanceof checks are exercised.
vi.mock("../../utils/pdfInspectorEngine.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/pdfInspectorEngine")>()),
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

import { PdfToText } from "../../components/PdfToText";
import { OcrError } from "../../utils/ocrEngine";
import { PdfInspectorError } from "../../utils/pdfInspectorEngine";

const asFileList = (files: File[]) => files as unknown as FileList;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const pdfFile = (name = "report.pdf") =>
  new File(["%PDF-1.7 mock"], name, { type: "application/pdf" });

const makeEnvelope = (overrides: Partial<AnalysisEnvelope> = {}): AnalysisEnvelope => ({
  fileType: "application/pdf",
  pdfType: "TextBased",
  pageCount: 1,
  confidence: 0.87,
  markdown: "<!-- Page 1 -->\n\n# Title\n\nBody text",
  layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
  pagesNeedingOcr: [],
  ocrReasonsByPage: [],
  hasEncodingIssues: false,
  engine: "pdf-inspector-wasm",
  engineVersion: "1.14.1",
  processingTimeMs: 3,
  warnings: [],
  ...overrides,
});

const dialog = () =>
  (document.getElementById("globalDialog") as any).show as ReturnType<typeof vi.fn>;
const lastDialog = () => dialog().mock.calls.at(-1)?.[0];
const lastJob = () => mocks.persistence.addJob.mock.calls.at(-1)?.[0];
const lastJobText = () => new TextDecoder().decode(lastJob().data);

describe("PdfToText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persistence.get.mockResolvedValue(undefined);
    mocks.persistence.estimateUsage.mockResolvedValue(0);
    mocks.persistence.getStorageUsage.mockResolvedValue({ quota: 1000, usage: 0 });
    mocks.persistence.getJobs.mockResolvedValue([]);
    mocks.persistence.addJob.mockResolvedValue(1);
    mocks.preview.load.mockResolvedValue(undefined);
    mocks.pdfInspectorEngine.extractMarkdown.mockReset().mockResolvedValue(makeEnvelope());
    mocks.pdfInspectorEngine.extractText.mockReset();
    mocks.ocrEngine.enrichMarkdownWithOcr.mockReset();
    // The legacy extractor finds nothing unless a test says otherwise.
    const legacyFails = { success: false, data: null, quality: "poor", warnings: [] };
    mocks.localConverter.pdfToMarkdown.mockReset().mockResolvedValue(legacyFails);
    mocks.localConverter.pdfToText.mockReset().mockResolvedValue(legacyFails);
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
  });

  const mount = async (format?: string) => {
    const component = new PdfToText();
    if (format) component.setAttribute("format", format);
    document.body.appendChild(component);
    await flush();
    return component;
  };

  const mountWithFile = async (format?: string, file = pdfFile()) => {
    const component = await mount(format);
    await component.handleFiles(asFileList([file]));
    return component;
  };

  const text = (component: PdfToText, selector: string) =>
    component.querySelector(selector)?.textContent?.trim();
  const isHidden = (component: PdfToText, selector: string) =>
    component.querySelector(selector)?.classList.contains("hidden");

  describe("format choice", () => {
    it("defaults to Markdown", async () => {
      const component = await mount();

      expect(component.formatLabel).toBe("Markdown");
      expect(text(component, "#convertLabel")).toBe("Extract as Markdown");
      expect(component.querySelector("#formatMdBtn")?.classList.contains("active")).toBe(true);
      expect(component.querySelector("#formatTxtBtn")?.classList.contains("active")).toBe(false);
    });

    it("starts in plain text when the format attribute asks for it", async () => {
      const component = await mount("txt");

      expect(component.formatLabel).toBe("Plain Text");
      expect(text(component, "#convertLabel")).toBe("Extract as Plain Text");
      expect(text(component, "#downloadLink")).toBe("Download Plain Text File");
      expect(component.querySelector("#formatTxtBtn")?.classList.contains("active")).toBe(true);
    });

    it("ignores a format attribute it does not support", async () => {
      const component = await mount("docx");

      expect(component.formatLabel).toBe("Markdown");
    });

    it("switches format from the toggle buttons", async () => {
      const component = await mount();

      (component.querySelector("#formatTxtBtn") as HTMLButtonElement).click();
      expect(text(component, "#convertLabel")).toBe("Extract as Plain Text");
      expect(text(component, "#downloadLink")).toBe("Download Plain Text File");
      expect(component.querySelector("#formatMdBtn")?.classList.contains("active")).toBe(false);

      (component.querySelector("#formatMdBtn") as HTMLButtonElement).click();
      expect(text(component, "#convertLabel")).toBe("Extract as Markdown");
      expect(text(component, "#downloadLink")).toBe("Download Markdown File");
    });
  });

  describe("changing format after a result", () => {
    it("hides the previous result so it can't be saved under the new label", async () => {
      const component = await mountWithFile();
      await component.handleConvert();
      const downloadLink = component.querySelector("#downloadLink") as HTMLButtonElement;
      const copyBtn = component.querySelector("#copyBtn") as HTMLButtonElement;
      expect(isHidden(component, "#successMessage")).toBe(false);
      expect(downloadLink.onclick).toBeTypeOf("function");

      (component.querySelector("#formatTxtBtn") as HTMLButtonElement).click();

      expect(isHidden(component, "#successMessage")).toBe(true);
      expect(downloadLink.onclick).toBeNull();
      expect(copyBtn.onclick).toBeNull();
      expect(text(component, "#downloadLink")).toBe("Download Plain Text File");
    });

    it("keeps the result when the same format is chosen again", async () => {
      const component = await mountWithFile();
      await component.handleConvert();

      (component.querySelector("#formatMdBtn") as HTMLButtonElement).click();

      expect(isHidden(component, "#successMessage")).toBe(false);
      expect((component.querySelector("#downloadLink") as HTMLButtonElement).onclick).toBeTypeOf(
        "function",
      );
    });
  });

  describe("file selection", () => {
    it("shows the file, saves the session and loads the preview", async () => {
      const file = pdfFile("annual-report.pdf");
      const component = await mountWithFile(undefined, file);

      expect(mocks.persistence.set).toHaveBeenCalledWith("pdf-to-text", file);
      expect(mocks.preview.load).toHaveBeenCalledWith(file);
      expect(text(component, "#fileName")).toBe("annual-report.pdf");
      expect(isHidden(component, "#fileInfo")).toBe(false);
      expect(isHidden(component, "#dropZone")).toBe(true);
      expect(isHidden(component, "#mainLayout")).toBe(false);
    });

    it("rejects files that are not PDFs", async () => {
      const component = await mount();

      await component.handleFiles(
        asFileList([new File(["hello"], "notes.txt", { type: "text/plain" })]),
      );

      expect(lastDialog()).toMatchObject({ type: "error" });
      expect(lastDialog().message).toContain("Invalid file type: text/plain");
      expect(mocks.persistence.set).not.toHaveBeenCalled();
      expect(isHidden(component, "#mainLayout")).toBe(true);
    });

    it("tells the user when the preview cannot be drawn", async () => {
      mocks.preview.load.mockRejectedValueOnce(new Error("render failed"));

      await mountWithFile();

      expect(lastDialog()).toMatchObject({ message: "Preview error message", type: "error" });
    });

    it("moves the preview with the page buttons", async () => {
      const component = await mountWithFile();

      (component.querySelector("#nextPage") as HTMLButtonElement).click();
      (component.querySelector("#prevPage") as HTMLButtonElement).click();

      expect(mocks.preview.next).toHaveBeenCalledTimes(1);
      expect(mocks.preview.prev).toHaveBeenCalledTimes(1);
    });
  });

  describe("saved sessions", () => {
    it("offers to resume a saved file and restores it", async () => {
      const saved = pdfFile("saved.pdf");
      mocks.persistence.get.mockResolvedValue(saved);
      const component = await mount();

      await component.checkExistingSession();
      expect(isHidden(component, "#resumeContainer")).toBe(false);
      expect(text(component, "#resumeBtn")).toBe("Resume saved.pdf");

      await component.restoreSession();
      expect(text(component, "#fileName")).toBe("saved.pdf");
    });

    it("does not run markup from a saved file name", async () => {
      mocks.persistence.get.mockResolvedValue(pdfFile("<img src=x onerror=window.__ptXss=1>.pdf"));
      (window as any).__ptXss = undefined;
      const component = await mount();

      await component.checkExistingSession();

      const resumeBtn = component.querySelector("#resumeBtn") as HTMLElement;
      expect(resumeBtn.querySelector("img")).toBeNull();
      expect((window as any).__ptXss).toBeUndefined();
    });

    it("does nothing when there is no saved file, and survives storage errors", async () => {
      const component = await mount();

      await component.restoreSession();
      expect(isHidden(component, "#mainLayout")).toBe(true);

      mocks.persistence.get.mockRejectedValueOnce(new Error("IndexedDB unavailable"));
      await expect(component.checkExistingSession()).resolves.toBeUndefined();
      expect(isHidden(component, "#resumeContainer")).toBe(true);
    });
  });

  describe("Markdown extraction", () => {
    it("does nothing until a file is chosen", async () => {
      const component = await mount();

      await component.handleConvert();

      expect(mocks.pdfInspectorEngine.extractMarkdown).not.toHaveBeenCalled();
      expect(dialog()).not.toHaveBeenCalled();
    });

    it("saves the engine's Markdown and reports what it found", async () => {
      mocks.pdfInspectorEngine.extractMarkdown.mockResolvedValue(
        makeEnvelope({
          pageCount: 3,
          layout: { isComplex: true, pagesWithTables: [2, 3], pagesWithColumns: [] },
          hasEncodingIssues: true,
          warnings: ["Encoding issues detected in the source PDF."],
        }),
      );
      const component = await mountWithFile();

      await component.handleConvert();

      expect(mocks.pdfInspectorEngine.extractMarkdown).toHaveBeenCalledWith(expect.any(Uint8Array));
      expect(lastJobText()).toBe("<!-- Page 1 -->\n\n# Title\n\nBody text");
      expect(isHidden(component, "#successMessage")).toBe(false);
      expect(lastDialog()).toMatchObject({ type: "success" });
      // One paragraph of whole sentences: the dialog does not show line breaks.
      expect(lastDialog().message).toBe(
        "Your Markdown file is ready. " +
          "Type: TextBased (87% confidence). " +
          "Tables detected on pages 2, 3. " +
          "Encoding issues detected; some characters may be missing or garbled.",
      );
      expect(lastJob()).toMatchObject({
        tool: "PDF to Markdown",
        fileName: "report.md",
        metadata: {
          format: "md",
          mode: "local",
          engine: "pdf-inspector-wasm",
          engineVersion: "1.14.1",
          pdfType: "TextBased",
          confidence: 0.87,
          pagesNeedingOcr: [],
          ocrPages: [],
          warnings: ["Encoding issues detected in the source PDF."],
        },
      });
      expect((component.querySelector("#convertBtn") as HTMLButtonElement).disabled).toBe(false);
      expect(isHidden(component, "#progressSection")).toBe(true);
    });

    it("starts extraction from the convert button", async () => {
      const component = await mountWithFile();

      (component.querySelector("#convertBtn") as HTMLButtonElement).click();

      await vi.waitFor(() => expect(mocks.persistence.addJob).toHaveBeenCalled());
      expect(lastJob().fileName).toBe("report.md");
    });

    it("leaves out the type line when the engine could not tell the type", async () => {
      mocks.pdfInspectorEngine.extractMarkdown.mockResolvedValue(
        makeEnvelope({
          pdfType: "Unknown",
          layout: { isComplex: false, pagesWithTables: [4], pagesWithColumns: [] },
        }),
      );
      const component = await mountWithFile();

      await component.handleConvert();

      expect(lastDialog().message).toBe("Your Markdown file is ready. Tables detected on page 4.");
    });

    it("reads the file once and reuses the bytes for later runs", async () => {
      const file = pdfFile();
      const readSpy = vi.spyOn(file, "arrayBuffer");
      const component = await mountWithFile(undefined, file);

      await component.handleConvert();
      await component.handleFiles(asFileList([file]));
      await component.handleConvert();

      expect(readSpy).toHaveBeenCalledTimes(1);
      const [first, second] = mocks.pdfInspectorEngine.extractMarkdown.mock.calls;
      expect(second[0]).toBe(first[0]);

      const other = pdfFile("other.pdf");
      const otherSpy = vi.spyOn(other, "arrayBuffer");
      await component.handleFiles(asFileList([other]));
      await component.handleConvert();
      expect(otherSpy).toHaveBeenCalledTimes(1);
      expect(lastJob().fileName).toBe("other.md");
    });

    it("leaves the engine's cached envelope alone across runs", async () => {
      // The real engine hands back the same cached envelope object on every run,
      // and a failed OCR run adds a warning to this run's list.
      const cached = makeEnvelope({
        pdfType: "Mixed",
        pageCount: 2,
        pagesNeedingOcr: [2],
        warnings: ["Confidence is low; results may be incomplete."],
      });
      mocks.pdfInspectorEngine.extractMarkdown.mockResolvedValue(cached);
      mocks.ocrEngine.enrichMarkdownWithOcr.mockRejectedValue(new Error("boom"));
      const component = await mountWithFile();

      await component.handleConvert();
      await component.handleConvert();

      expect(lastJob().metadata.warnings).toEqual([
        "Confidence is low; results may be incomplete.",
        "OCR failed; continuing with native text only.",
      ]);
      expect(cached.warnings).toEqual(["Confidence is low; results may be incomplete."]);
    });
  });

  describe("plain text extraction", () => {
    it("asks for fidelity output and saves the engine's text", async () => {
      mocks.pdfInspectorEngine.extractText.mockResolvedValue({
        envelope: makeEnvelope(),
        text: "Title\nBody text",
      });
      const component = await mountWithFile("txt");

      await component.handleConvert();

      expect(mocks.pdfInspectorEngine.extractText).toHaveBeenCalledWith(expect.any(Uint8Array), {
        profile: "fidelity",
      });
      expect(mocks.pdfInspectorEngine.extractMarkdown).not.toHaveBeenCalled();
      expect(lastJobText()).toBe("Title\nBody text");
      expect(lastJob()).toMatchObject({
        tool: "PDF to Plain Text",
        fileName: "report.txt",
        metadata: { format: "txt" },
      });
      expect(lastDialog().message).toMatch(/^Your Plain Text file is ready\./);
    });

    it("keeps the engine's plain text exactly as extracted", async () => {
      // Plain text that happens to look like Markdown must not be "cleaned".
      const plain = "# 1 priority\n- 5 degrees\n> 3 items\nTotal: 2 * 3 * 4\n_draft_ copy";
      mocks.pdfInspectorEngine.extractText.mockResolvedValue({
        envelope: makeEnvelope(),
        text: plain,
      });
      const component = await mountWithFile("txt");

      await component.handleConvert();

      expect(lastJobText()).toBe(plain);
    });

    it("strips Markdown syntax when only Markdown is available", async () => {
      mocks.pdfInspectorEngine.extractText.mockResolvedValue({
        envelope: makeEnvelope({
          markdown: [
            "<!-- Page 1 -->",
            "",
            "# Heading",
            "",
            "**Bold** and __strong__ with *em* and _it_",
            "",
            "[link](https://example.com) ![logo](a.png) and `code`",
            "",
            "Note: 2 * 3 * 4 = 24 for f(x) and snake_case",
            "",
            "|SKU|Qty|",
            "|---|---|",
            "|A-100|10|",
            "",
            "- item one",
            "+ item two",
            "1.  first",
            "> quoted",
            "",
            "---",
            "",
            "```",
            "fenced",
            "```",
            "",
            "<!-- Page 2 -->",
            "",
            "End",
          ].join("\n"),
        }),
        text: "",
      });
      const component = await mountWithFile("txt");

      await component.handleConvert();

      const out = lastJobText();
      expect(out).toBe(
        [
          "Heading",
          "",
          "Bold and strong with em and it",
          "",
          "link logo and code",
          "",
          "Note: 2 * 3 * 4 = 24 for f(x) and snake_case",
          "",
          "SKU\tQty",
          "A-100\t10",
          "",
          "item one",
          "item two",
          "1. first",
          "quoted",
          "",
          "fenced",
          "",
          "End",
        ].join("\n"),
      );
    });
  });

  describe("OCR", () => {
    const scanned = (overrides: Partial<AnalysisEnvelope> = {}) =>
      makeEnvelope({
        pdfType: "Mixed",
        pageCount: 3,
        confidence: 0.7,
        markdown: "<!-- Page 1 -->\n\nNative text\n\n<!-- Page 2 -->\n\n<!-- Page 3 -->\n\n",
        pagesNeedingOcr: [2, 3],
        warnings: [
          "This document needs OCR on pages 2, 3. Text extraction is limited until those pages are OCR'd.",
        ],
        ...overrides,
      });
    const ocrRun = (pages: number[], warnings: string[] = []) => ({
      pages: pages.map((page) => ({
        page,
        text: `Scanned ${page}`,
        confidence: 0.9,
        processingTimeMs: 5,
      })),
      language: "eng",
      engine: "tesseract.js",
      engineVersion: "7.0.0",
      warnings,
      totalProcessingTimeMs: 10,
    });
    const merged =
      "<!-- Page 1 -->\n\nNative text\n\n<!-- Page 2 -->\n\nScanned 2\n\n<!-- Page 3 -->\n\nScanned 3";

    it("reads scanned pages and drops the engine's now-stale OCR warning", async () => {
      const envelope = scanned();
      mocks.pdfInspectorEngine.extractMarkdown.mockResolvedValue(envelope);
      mocks.ocrEngine.enrichMarkdownWithOcr.mockResolvedValue({
        markdown: merged,
        ocr: ocrRun([2, 3]),
      });
      const component = await mountWithFile();

      await component.handleConvert();

      expect(mocks.ocrEngine.enrichMarkdownWithOcr).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        envelope.markdown,
        [2, 3],
        3,
      );
      expect(lastJobText()).toBe(merged);
      expect(lastDialog().message).toBe(
        "Your Markdown file is ready. Type: Mixed (70% confidence). OCR applied to pages 2, 3.",
      );
      expect(lastJob().metadata).toMatchObject({
        pagesNeedingOcr: [],
        ocrPages: [2, 3],
        ocrEngine: "tesseract.js",
        ocrEngineVersion: "7.0.0",
        warnings: [],
      });
    });

    it("keeps a warning only for the pages OCR could not read", async () => {
      mocks.pdfInspectorEngine.extractMarkdown.mockResolvedValue(
        scanned({
          warnings: [...scanned().warnings, "Confidence is low; results may be incomplete."],
        }),
      );
      mocks.ocrEngine.enrichMarkdownWithOcr.mockResolvedValue({
        markdown: "<!-- Page 1 -->\n\nNative text\n\n<!-- Page 2 -->\n\nScanned 2",
        ocr: ocrRun([2], ["Page 3 OCR timed out; skipped."]),
      });
      const component = await mountWithFile();

      await component.handleConvert();

      // Both what OCR read and what is still missing.
      expect(lastDialog().message).toContain(
        "OCR applied to page 2. Text missing from page 3 (OCR could not read it).",
      );
      expect(lastJob().metadata).toMatchObject({
        pagesNeedingOcr: [3],
        ocrPages: [2],
        warnings: [
          "Confidence is low; results may be incomplete.",
          "OCR could not read page 3; text from that page may be missing.",
          "Page 3 OCR timed out; skipped.",
        ],
      });
    });

    it("says which pages are still unread when OCR recognised none of them", async () => {
      mocks.pdfInspectorEngine.extractMarkdown.mockResolvedValue(scanned());
      mocks.ocrEngine.enrichMarkdownWithOcr.mockResolvedValue({
        markdown: scanned().markdown,
        ocr: ocrRun([], ["OCR stopped at page 2: wasm blocked"]),
      });
      const component = await mountWithFile();

      await component.handleConvert();

      expect(lastDialog().message).toContain(
        "Text missing from pages 2, 3 (OCR could not read them).",
      );
      expect(lastJobText()).toBe(scanned().markdown);
      expect(lastJob().metadata.warnings).toEqual([
        "OCR could not read pages 2, 3; text from those pages may be missing.",
        "OCR stopped at page 2: wasm blocked",
      ]);
    });

    it("does not repeat a fully scanned PDF's text before its OCR text in plain text mode", async () => {
      mocks.pdfInspectorEngine.extractText.mockResolvedValue({
        // No Markdown and no page count: every page needs OCR, so the
        // engine's own text (an image placeholder here) is not the base.
        envelope: makeEnvelope({ markdown: undefined, pageCount: 0, pagesNeedingOcr: [1] }),
        text: "Scanned words\n[Image: Im1]",
      });
      mocks.ocrEngine.enrichMarkdownWithOcr.mockResolvedValue({
        markdown: "<!-- Page 1 -->\n\n**Scanned** words",
        ocr: ocrRun([1]),
      });
      const component = await mountWithFile("txt");

      await component.handleConvert();

      expect(mocks.ocrEngine.enrichMarkdownWithOcr).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        "",
        [1],
        1,
      );
      expect(lastJobText()).toBe("Scanned words");
    });

    it("adds OCR text after the native text, without image placeholders, when only some pages need it", async () => {
      mocks.pdfInspectorEngine.extractText.mockResolvedValue({
        envelope: makeEnvelope({ markdown: undefined, pageCount: 2, pagesNeedingOcr: [2] }),
        text: "Native words\n[Image: Im1]\n",
      });
      mocks.ocrEngine.enrichMarkdownWithOcr.mockImplementation(
        async (_bytes: Uint8Array, native: string) => ({
          markdown: `${native}\n\n<!-- Page 2 -->\n\nScanned words`,
          ocr: ocrRun([2]),
        }),
      );
      const component = await mountWithFile("txt");

      await component.handleConvert();

      expect(mocks.ocrEngine.enrichMarkdownWithOcr.mock.calls[0][1]).toBe("Native words");
      expect(lastJobText()).toBe("Native words\n\nScanned words");
    });

    it("skips OCR when the user turns it off", async () => {
      mocks.pdfInspectorEngine.extractMarkdown.mockResolvedValue(scanned());
      const component = await mountWithFile();
      const toggle = component.querySelector("#ocrToggle") as HTMLInputElement;
      toggle.checked = false;
      toggle.dispatchEvent(new Event("change"));

      await component.handleConvert();

      expect(mocks.ocrEngine.enrichMarkdownWithOcr).not.toHaveBeenCalled();
      expect(lastDialog().message).toContain("Needs OCR on pages 2, 3.");
      expect(lastJob().metadata.warnings).toEqual(scanned().warnings);
    });

    it.each([
      [
        "an OCR error",
        () => new OcrError("worker-failed", "OCR worker could not start."),
        "OCR skipped: OCR worker could not start.",
      ],
      [
        "an unexpected error",
        () => new Error("boom"),
        "OCR failed; continuing with native text only.",
      ],
    ])("keeps the native text when OCR fails with %s", async (_label, makeError, warning) => {
      mocks.pdfInspectorEngine.extractMarkdown.mockResolvedValue(scanned());
      mocks.ocrEngine.enrichMarkdownWithOcr.mockRejectedValue(makeError());
      const component = await mountWithFile();

      await component.handleConvert();

      expect(lastJobText()).toBe(scanned().markdown);
      expect(lastDialog()).toMatchObject({ type: "success" });
      expect(lastJob().metadata.warnings).toEqual([...scanned().warnings, warning]);
      expect(lastJob().metadata.ocrPages).toEqual([]);
    });
  });

  describe("errors", () => {
    it.each([
      [
        "encrypted",
        "This PDF is password-protected. Remove the password with the Unlock PDF tool, then try again.",
      ],
      [
        "password-required",
        "This PDF is password-protected. Remove the password with the Unlock PDF tool, then try again.",
      ],
      [
        "resource-limit",
        "The document is too large to analyze in this browser session. Try a smaller file or fewer pages.",
      ],
    ] as const)(
      "explains a %s failure without trying the legacy extractor",
      async (reason, message) => {
        mocks.pdfInspectorEngine.extractMarkdown.mockRejectedValue(
          new PdfInspectorError({ reason, message: "engine said no" }),
        );
        const component = await mountWithFile();

        await component.handleConvert();

        expect(lastDialog()).toMatchObject({ type: "error", message });
        expect(mocks.localConverter.pdfToMarkdown).not.toHaveBeenCalled();
        expect(mocks.persistence.addJob).not.toHaveBeenCalled();
        expect((component.querySelector("#convertBtn") as HTMLButtonElement).disabled).toBe(false);
        expect(isHidden(component, "#progressSection")).toBe(true);
      },
    );

    it.each([
      ["malformed", "This file is not a valid or readable PDF."],
      ["unsupported", "This PDF uses features the local analysis engine does not support."],
      ["unknown", "Extraction failed: engine said no"],
    ] as const)(
      "tries the legacy extractor for a %s failure, and explains it if that fails too",
      async (reason, message) => {
        mocks.pdfInspectorEngine.extractMarkdown.mockRejectedValue(
          new PdfInspectorError({ reason, message: "engine said no" }),
        );
        const component = await mountWithFile();

        await component.handleConvert();

        expect(mocks.localConverter.pdfToMarkdown).toHaveBeenCalled();
        expect(lastDialog()).toMatchObject({ type: "error", message });
        expect(mocks.persistence.addJob).not.toHaveBeenCalled();
      },
    );

    it("reads a PDF the engine cannot parse (such as a damaged xref) with the legacy extractor", async () => {
      mocks.pdfInspectorEngine.extractText.mockRejectedValue(
        new PdfInspectorError({ reason: "malformed", message: "invalid file trailer" }),
      );
      mocks.localConverter.pdfToText.mockResolvedValue({
        success: true,
        data: new TextEncoder().encode("Recovered text"),
        quality: "good",
        warnings: [],
      });
      const component = await mountWithFile("txt");

      await component.handleConvert();

      expect(lastJobText()).toBe("Recovered text");
      expect(lastDialog()).toMatchObject({
        type: "success",
        message: "Your Plain Text file is ready.",
      });
      expect(lastJob().metadata.warnings).toEqual([
        "The analysis engine could not read this file, so the legacy local extractor was used; diagnosis (scan detection, layout warnings) is not available for this run.",
      ]);
    });

    it("explains when the file can no longer be read", async () => {
      const file = pdfFile();
      vi.spyOn(file, "arrayBuffer").mockRejectedValue(
        Object.assign(new Error("The file could not be read."), { name: "NotReadableError" }),
      );
      const component = await mountWithFile(undefined, file);

      await component.handleConvert();

      expect(lastDialog().type).toBe("error");
      expect(lastDialog().message).toMatch(/^Extraction failed\. Kyte could not read this file\./);
    });
  });

  describe("legacy fallback when the analysis worker is unavailable", () => {
    it.each([
      ["md", "pdfToMarkdown", "extractMarkdown", "# Legacy heading"],
      ["txt", "pdfToText", "extractText", "Legacy plain"],
    ] as const)("uses the legacy %s extractor", async (format, legacyFn, engineFn, output) => {
      mocks.pdfInspectorEngine[engineFn].mockRejectedValue(
        new Error("Failed to start the PDF analysis worker."),
      );
      mocks.localConverter[legacyFn].mockResolvedValue({
        success: true,
        data: new TextEncoder().encode(output),
        quality: "good",
        warnings: [],
      });
      const component = await mountWithFile(format);

      await component.handleConvert();

      expect(mocks.localConverter[legacyFn]).toHaveBeenCalledWith(expect.any(Uint8Array));
      expect(lastJobText()).toBe(output);
      // No diagnosis is available from the legacy pipeline.
      expect(lastDialog().message).toBe(`Your ${component.formatLabel} file is ready.`);
      expect(lastJob().metadata).toMatchObject({
        engineVersion: "unavailable",
        pdfType: "Unknown",
        warnings: [
          "Extraction used the legacy local pipeline; diagnosis (scan detection, layout warnings) is not available for this run.",
        ],
      });
    });

    it("uses the legacy extractor when the WASM engine cannot load, without showing the load error", async () => {
      mocks.pdfInspectorEngine.extractMarkdown.mockRejectedValue(
        new PdfInspectorError({
          reason: "engine-unavailable",
          message: "pdf-inspector wasm fetch failed: 404",
        }),
      );
      mocks.localConverter.pdfToMarkdown.mockResolvedValue({
        success: true,
        data: new TextEncoder().encode("# Legacy heading"),
        quality: "good",
        warnings: [],
      });
      const component = await mountWithFile();

      await component.handleConvert();

      expect(mocks.localConverter.pdfToMarkdown).toHaveBeenCalled();
      expect(lastJobText()).toBe("# Legacy heading");
      expect(lastDialog()).toMatchObject({
        type: "success",
        message: "Your Markdown file is ready.",
      });
      const shown = dialog().mock.calls.map((call) => (call[0] as { message: string }).message);
      expect(shown.join("\n")).not.toMatch(/wasm|404/i);
    });

    it("reports a failure when the legacy extractor fails too", async () => {
      mocks.pdfInspectorEngine.extractMarkdown.mockRejectedValue(new Error("worker crashed"));
      mocks.localConverter.pdfToMarkdown.mockResolvedValue({
        success: false,
        data: null,
        quality: "poor",
        warnings: ["Local conversion failed."],
      });
      const component = await mountWithFile();

      await component.handleConvert();

      expect(lastDialog()).toMatchObject({
        type: "error",
        message: "Extraction failed. Please try again.",
      });
      expect(mocks.persistence.addJob).not.toHaveBeenCalled();
    });
  });

  describe("copy to clipboard", () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    let writeText: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
      else delete (navigator as any).clipboard;
    });

    it("copies the extracted text and resets the button label", async () => {
      const component = await mountWithFile();
      await component.handleConvert();
      const copyBtn = component.querySelector("#copyBtn") as HTMLButtonElement;

      vi.useFakeTimers();
      copyBtn.click();
      await vi.advanceTimersByTimeAsync(0);

      expect(writeText).toHaveBeenCalledWith("<!-- Page 1 -->\n\n# Title\n\nBody text");
      expect(copyBtn.textContent).toBe("Copied!");

      await vi.advanceTimersByTimeAsync(2000);
      expect(copyBtn.textContent).toBe("Copy to Clipboard");
    });

    it("tells the user when the clipboard refuses", async () => {
      writeText.mockRejectedValue(new Error("NotAllowedError"));
      const component = await mountWithFile();
      await component.handleConvert();

      (component.querySelector("#copyBtn") as HTMLButtonElement).click();
      await flush();

      expect(lastDialog()).toMatchObject({
        type: "error",
        message: "Failed to copy to clipboard.",
      });
    });
  });
});

describe("PdfToText review fixes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persistence.get.mockResolvedValue(undefined);
    mocks.persistence.estimateUsage.mockResolvedValue(0);
    mocks.persistence.getStorageUsage.mockResolvedValue({ quota: 1000, usage: 0 });
    mocks.persistence.getJobs.mockResolvedValue([]);
    mocks.persistence.addJob.mockResolvedValue(1);
    mocks.preview.load.mockResolvedValue(undefined);
    mocks.pdfInspectorEngine.extractMarkdown.mockReset().mockResolvedValue(makeEnvelope());
    mocks.pdfInspectorEngine.extractText.mockReset();
    mocks.ocrEngine.enrichMarkdownWithOcr.mockReset();
    const legacyFails = { success: false, data: null, quality: "poor", warnings: [] };
    mocks.localConverter.pdfToMarkdown.mockReset().mockResolvedValue(legacyFails);
    mocks.localConverter.pdfToText.mockReset().mockResolvedValue(legacyFails);
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
  });

  const mountWithFile = async (format?: string, file = pdfFile()) => {
    const component = new PdfToText();
    if (format) component.setAttribute("format", format);
    document.body.appendChild(component);
    await flush();
    await component.handleFiles(asFileList([file]));
    return component;
  };
  const isHidden = (component: PdfToText, selector: string) =>
    component.querySelector(selector)?.classList.contains("hidden");
  const legacyGives = (fn: "pdfToMarkdown" | "pdfToText", text: string) =>
    mocks.localConverter[fn].mockResolvedValue({
      success: true,
      data: new TextEncoder().encode(text),
      quality: "good",
      warnings: [],
    });
  /** A promise the test settles by hand, for runs that must still be going. */
  const deferred = <T>() => {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  describe("when the engine returns no text", () => {
    it("takes the text from the legacy extractor and keeps the engine's diagnosis", async () => {
      mocks.pdfInspectorEngine.extractMarkdown.mockResolvedValue(
        makeEnvelope({ pdfType: "ImageBased", markdown: undefined, confidence: 0.6 }),
      );
      legacyGives("pdfToMarkdown", "# Real heading\n\nReal text");
      const component = await mountWithFile();

      await component.handleConvert();

      expect(lastJobText()).toBe("# Real heading\n\nReal text");
      expect(lastDialog().message).toBe(
        "Your Markdown file is ready. Type: ImageBased (60% confidence).",
      );
      expect(lastJob().metadata).toMatchObject({
        pdfType: "ImageBased",
        warnings: [
          "The analysis engine returned no text for this file; the text came from the legacy local extractor.",
        ],
      });
    });

    it("does not ask pdf.js for text from a fully scanned PDF", async () => {
      mocks.pdfInspectorEngine.extractMarkdown.mockResolvedValue(
        makeEnvelope({ pdfType: "Scanned", markdown: "", pagesNeedingOcr: [1] }),
      );
      const component = await mountWithFile();
      const toggle = component.querySelector("#ocrToggle") as HTMLInputElement;
      toggle.checked = false;
      toggle.dispatchEvent(new Event("change"));

      await component.handleConvert();

      expect(mocks.localConverter.pdfToMarkdown).not.toHaveBeenCalled();
    });
  });

  describe("empty results", () => {
    it.each([
      [
        "a scan with OCR off",
        { pdfType: "Scanned", pagesNeedingOcr: [1] },
        false,
        "No text was found in this PDF. It looks like a scanned document. Turn on OCR and try again.",
      ],
      [
        "a scan OCR could not read",
        { pdfType: "Scanned", pagesNeedingOcr: [1] },
        true,
        "No text was found in this PDF. OCR could not read any text on its pages.",
      ],
      ["a PDF with no text", { pdfType: "TextBased" }, true, "No text was found in this PDF."],
    ] as const)(
      "reports %s instead of offering an empty file",
      async (_label, overrides, ocrOn, message) => {
        mocks.pdfInspectorEngine.extractText.mockResolvedValue({
          // Only an image placeholder: not text the user can use.
          envelope: makeEnvelope({
            markdown: undefined,
            ...(overrides as Partial<AnalysisEnvelope>),
          }),
          text: "[Image: Image-7098480789]",
        });
        mocks.ocrEngine.enrichMarkdownWithOcr.mockResolvedValue({
          markdown: "",
          ocr: { pages: [], warnings: [], engine: "tesseract.js", engineVersion: "7.0.0" },
        });
        const component = await mountWithFile("txt");
        const toggle = component.querySelector("#ocrToggle") as HTMLInputElement;
        toggle.checked = ocrOn;
        toggle.dispatchEvent(new Event("change"));

        await component.handleConvert();

        expect(lastDialog()).toMatchObject({ type: "error", title: "No text found", message });
        expect(isHidden(component, "#successMessage")).toBe(true);
        expect(mocks.persistence.addJob).not.toHaveBeenCalled();
      },
    );
  });

  describe("changes during a run", () => {
    it("locks the format buttons during a run and labels the output by the format it started with", async () => {
      const pending = deferred<AnalysisEnvelope>();
      mocks.pdfInspectorEngine.extractMarkdown.mockReturnValue(pending.promise);
      const component = await mountWithFile();
      const mdBtn = component.querySelector("#formatMdBtn") as HTMLButtonElement;
      const txtBtn = component.querySelector("#formatTxtBtn") as HTMLButtonElement;

      const run = component.handleConvert();
      await flush();
      expect(mdBtn.disabled).toBe(true);
      expect(txtBtn.disabled).toBe(true);
      // Even if the format changes some other way, the output keeps its own.
      (component as any).setFormat("txt");
      pending.resolve(makeEnvelope());
      await run;

      expect(lastJob()).toMatchObject({
        tool: "PDF to Markdown",
        fileName: "report.md",
        metadata: { format: "md" },
      });
      expect(lastJobText()).toContain("# Title");
      expect(mdBtn.disabled).toBe(false);
      expect(txtBtn.disabled).toBe(false);
    });

    it("names the output after the file it came from when another file is picked mid-run", async () => {
      const pending = deferred<AnalysisEnvelope>();
      mocks.pdfInspectorEngine.extractMarkdown.mockReturnValue(pending.promise);
      const component = await mountWithFile(undefined, pdfFile("first.pdf"));

      const run = component.handleConvert();
      await flush();
      await component.handleFiles(asFileList([pdfFile("second.pdf")]));
      pending.resolve(makeEnvelope());
      await run;

      expect(lastJob().fileName).toBe("first.md");
      // The result is not shown beside the other file.
      expect(isHidden(component, "#successMessage")).toBe(true);
      expect(dialog().mock.calls.some(([options]: any[]) => options.type === "success")).toBe(
        false,
      );
    });

    it("hides a finished result when another file is chosen", async () => {
      const component = await mountWithFile(undefined, pdfFile("first.pdf"));
      await component.handleConvert();
      const copyBtn = component.querySelector("#copyBtn") as HTMLButtonElement;
      expect(isHidden(component, "#successMessage")).toBe(false);

      await component.handleFiles(asFileList([pdfFile("second.pdf")]));

      expect(isHidden(component, "#successMessage")).toBe(true);
      expect(copyBtn.onclick).toBeNull();
    });
  });

  describe("accessibility", () => {
    it("names the OCR checkbox and describes it", async () => {
      const component = await mountWithFile();
      const toggle = component.querySelector("#ocrToggle") as HTMLInputElement;

      const label = component.querySelector(`#${toggle.getAttribute("aria-labelledby")}`);
      const desc = component.querySelector(`#${toggle.getAttribute("aria-describedby")}`);
      expect(label?.textContent).toBe("OCR (scanned pages)");
      expect(desc?.textContent).toBe("Runs locally only on pages that need it");
    });

    it("tells assistive technology which format is chosen", async () => {
      const component = await mountWithFile();
      const mdBtn = component.querySelector("#formatMdBtn") as HTMLButtonElement;
      const txtBtn = component.querySelector("#formatTxtBtn") as HTMLButtonElement;
      expect(component.querySelector("#formatToggle")?.getAttribute("role")).toBe("group");
      expect(mdBtn.getAttribute("type")).toBe("button");
      expect(mdBtn.getAttribute("aria-pressed")).toBe("true");
      expect(txtBtn.getAttribute("aria-pressed")).toBe("false");

      txtBtn.click();

      expect(mdBtn.getAttribute("aria-pressed")).toBe("false");
      expect(txtBtn.getAttribute("aria-pressed")).toBe("true");
    });
  });
});
