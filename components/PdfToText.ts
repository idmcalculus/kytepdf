import { describeFailure } from "../utils/errorMapper.ts";
import { localConverter } from "../utils/LocalConverter.ts";
import { logger } from "../utils/logger.ts";
import { markdownToPlainText } from "../utils/markdownText.ts";
import { OcrError, ocrEngine } from "../utils/ocrEngine.ts";
import { PdfInspectorError, pdfInspectorEngine } from "../utils/pdfInspectorEngine.ts";
import type { AnalysisEnvelope } from "../utils/pdfInspectorTypes.ts";
import { getPdfPreviewErrorMessage, PdfPreviewController } from "../utils/pdfPreview.ts";
import { generateOutputFilename } from "../utils/pdfUtils.ts";
import { persistence } from "../utils/persistence.ts";
import { BaseComponent } from "./BaseComponent.ts";

export type TextFormat = "txt" | "md";

/**
 * Engine failures that the legacy extractor cannot get past: a password, or a
 * file too large for this browser. Any other failure, such as a damaged xref
 * that pdf.js can rebuild, is retried with the legacy extractor.
 */
const STOP_REASONS = new Set(["encrypted", "password-required", "resource-limit"]);

/** "[Image: Im1]" lines that pdf-inspector's plain text puts where images are. */
const IMAGE_PLACEHOLDER_RE = /^[ \t]*\[Image: [^\]\n]*\][ \t]*$/gm;

function stripImagePlaceholders(text: string): string {
  return text
    .replace(IMAGE_PLACEHOLDER_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const plural = (count: number) => (count === 1 ? "" : "s");

export class PdfToText extends BaseComponent {
  protected toolKey = "pdf-to-text";
  private targetFormat: TextFormat = "md";
  private ocrEnabled = true;
  private previewController: PdfPreviewController | null = null;
  private cachedPdfBytes: Uint8Array | null = null;
  private cachedPdfFile: File | null = null;

  connectedCallback() {
    const attrFormat = this.getAttribute("format") as TextFormat | null;
    if (attrFormat === "txt" || attrFormat === "md") {
      this.targetFormat = attrFormat;
    }
    super.connectedCallback();
  }

  get formatLabel() {
    return PdfToText.labelFor(this.targetFormat);
  }

  private static labelFor(format: TextFormat) {
    return format === "md" ? "Markdown" : "Plain Text";
  }

  render() {
    this.innerHTML = `
      <div class="tool-view">
        ${this.getBackButton()}

        <h1>PDF to Text</h1>
        <p class="subtitle">Extract text from your PDF as Markdown or plain text — entirely in your browser.</p>

        ${this.getDropZone("your PDF", "file-up")}

        <div id="fileInfo" class="file-list-item hidden" style="margin-bottom: 2rem; cursor: default;">
          <div class="file-item-details">
            <span id="fileName" class="file-name">document.pdf</span>
            <span id="fileSize" class="file-size">0 MB</span>
          </div>
        </div>

        <div id="mainLayout" class="layout-grid hidden">
          <div class="layout-left">
            <div id="previewSection" class="preview-container">
              <div class="preview-viewport">
                <canvas id="previewCanvas"></canvas>
                <button id="prevPage" class="nav-btn prev">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                </button>
                <button id="nextPage" class="nav-btn next">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                </button>
              </div>
              <div class="preview-info">
                <span id="pageIndicator">Page 1 of 1</span>
              </div>
            </div>
          </div>

          <div class="layout-right">
            <div class="controls">
              <div class="control-group">
                <label>Output Format</label>
                <div class="presets-grid" id="formatToggle" role="group" aria-label="Output format">
                  <button id="formatMdBtn" type="button" class="preset-btn" aria-pressed="true">
                    <span class="preset-name">Markdown</span>
                    <span class="preset-desc">Headings, lists, bold</span>
                  </button>
                  <button id="formatTxtBtn" type="button" class="preset-btn" aria-pressed="false">
                    <span class="preset-name">Plain Text</span>
                    <span class="preset-desc">Raw text, no formatting</span>
                  </button>
                </div>
              </div>

              <div class="control-group">
                <label>Options</label>
                <div class="preset-btn active" style="flex-direction: row; justify-content: space-between; align-items: center; padding: 1rem; cursor: default;">
                  <div>
                    <span class="preset-name" id="ocrToggleLabel">OCR (scanned pages)</span>
                    <span class="preset-desc" id="ocrToggleDesc">Runs locally only on pages that need it</span>
                  </div>
                  <input type="checkbox" id="ocrToggle" aria-labelledby="ocrToggleLabel" aria-describedby="ocrToggleDesc" checked style="width: 20px; height: 20px; cursor: pointer;" />
                </div>
              </div>

              <div class="control-group">
                <div class="warning" style="border-color: var(--primary-glow); background: rgba(6, 182, 212, 0.05);">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--primary);"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  <span>All processing happens locally in your browser. Your files never leave your device.</span>
                </div>
              </div>

              <div class="actions-row">
                <button id="convertBtn" class="btn btn-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
                  <span id="convertLabel">Extract as Markdown</span>
                </button>
              </div>

              ${this.getProgressSection("Extracting text...")}

              <div id="successMessage" class="success-message hidden">
                <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">Extraction Complete!</p>
                <button id="downloadLink" class="btn btn-primary">Download ${this.formatLabel} File</button>
                <button id="copyBtn" class="btn btn-secondary" style="margin-top: 0.5rem;">Copy to Clipboard</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    if ((window as any).lucide) (window as any).lucide.createIcons();
  }

  setupEventListeners() {
    this.setupBaseListeners();

    const convertBtn = this.querySelector("#convertBtn") as HTMLButtonElement;
    const formatMdBtn = this.querySelector("#formatMdBtn") as HTMLButtonElement;
    const formatTxtBtn = this.querySelector("#formatTxtBtn") as HTMLButtonElement;
    const ocrToggle = this.querySelector("#ocrToggle") as HTMLInputElement | null;

    convertBtn.onclick = () => this.handleConvert();
    formatMdBtn.onclick = () => this.setFormat("md");
    formatTxtBtn.onclick = () => this.setFormat("txt");
    if (ocrToggle) {
      ocrToggle.onchange = () => {
        this.ocrEnabled = ocrToggle.checked;
      };
    }

    this.previewController = this.createPreviewController();

    this.checkExistingSession();
    this.updateFormatUI();
  }

  async handleFiles(files: FileList) {
    const file = files[0];
    if (!(await this.validateFile(file))) return;

    this.selectedFile = file;
    // A result belongs to the file it came from; don't offer it for this one.
    this.clearResult();
    if (this.cachedPdfFile !== file) {
      this.cachedPdfFile = file;
      this.cachedPdfBytes = null;
    }
    await persistence.set(this.toolKey, file);

    if (!this.previewController) {
      this.previewController = this.createPreviewController();
    }

    (this.querySelector("#fileName") as HTMLElement).textContent = file.name;
    (this.querySelector("#fileSize") as HTMLElement).textContent = this.formatBytes(file.size);
    (this.querySelector("#fileInfo") as HTMLElement).classList.remove("hidden");
    (this.querySelector("#dropZone") as HTMLElement).classList.add("hidden");
    (this.querySelector("#mainLayout") as HTMLElement).classList.remove("hidden");

    try {
      await this.previewController?.load(this.selectedFile);
    } catch (err) {
      logger.error("Preview load error", err);
      this.showErrorDialog(getPdfPreviewErrorMessage("preview"));
    }
  }

  private createPreviewController() {
    const canvas = this.querySelector("#previewCanvas") as HTMLCanvasElement | null;
    if (!canvas) return null;
    const pageIndicator = this.querySelector("#pageIndicator") as HTMLElement | null;
    const prevButton = this.querySelector("#prevPage") as HTMLButtonElement | null;
    const nextButton = this.querySelector("#nextPage") as HTMLButtonElement | null;

    const controller = new PdfPreviewController({
      canvas,
      pageIndicator,
      prevButton,
      nextButton,
      scale: 0.8,
    });

    prevButton?.addEventListener("click", () => controller.prev());
    nextButton?.addEventListener("click", () => controller.next());
    return controller;
  }

  private setFormat(format: TextFormat) {
    if (format !== this.targetFormat) this.clearResult();
    this.targetFormat = format;
    this.updateFormatUI();
  }

  /**
   * Hides a finished result so its download and copy buttons can't hand out
   * the previous format's file under the new format's label.
   */
  private clearResult() {
    const successMsg = this.querySelector("#successMessage") as HTMLElement | null;
    const downloadLink = this.querySelector("#downloadLink") as HTMLElement | null;
    const copyBtn = this.querySelector("#copyBtn") as HTMLElement | null;
    successMsg?.classList.add("hidden");
    if (downloadLink) downloadLink.onclick = null;
    if (copyBtn) copyBtn.onclick = null;
  }

  private updateFormatUI() {
    const formatMdBtn = this.querySelector("#formatMdBtn") as HTMLButtonElement | null;
    const formatTxtBtn = this.querySelector("#formatTxtBtn") as HTMLButtonElement | null;
    const convertLabel = this.querySelector("#convertLabel") as HTMLElement | null;
    const downloadLink = this.querySelector("#downloadLink") as HTMLElement | null;

    for (const [button, format] of [
      [formatMdBtn, "md"],
      [formatTxtBtn, "txt"],
    ] as const) {
      button?.classList.toggle("active", this.targetFormat === format);
      button?.setAttribute("aria-pressed", String(this.targetFormat === format));
    }
    if (convertLabel) {
      convertLabel.textContent =
        this.targetFormat === "md" ? "Extract as Markdown" : "Extract as Plain Text";
    }
    if (downloadLink) {
      downloadLink.textContent = `Download ${this.formatLabel} File`;
    }
  }

  async checkExistingSession() {
    try {
      const saved = await persistence.get<File>(this.toolKey);
      if (saved) {
        const resumeContainer = this.querySelector("#resumeContainer");
        const resumeBtn = this.querySelector("#resumeBtn");
        if (resumeContainer && resumeBtn) {
          resumeContainer.classList.remove("hidden");
          resumeBtn.innerHTML = "";

          // Static trusted icon
          const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          icon.setAttribute("width", "14");
          icon.setAttribute("height", "14");
          icon.setAttribute("viewBox", "0 0 24 24");
          icon.setAttribute("fill", "none");
          icon.setAttribute("stroke", "currentColor");
          icon.setAttribute("stroke-width", "2");
          icon.setAttribute("stroke-linecap", "round");
          icon.setAttribute("stroke-linejoin", "round");
          icon.style.marginRight = "4px";
          icon.innerHTML = `<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>`;
          resumeBtn.appendChild(icon);

          // User-controlled text via textContent (safe)
          const label = document.createTextNode(`Resume ${this.sanitize(saved.name)}`);
          resumeBtn.appendChild(label);
        }
      }
    } catch (err) {
      logger.error("Failed to check for existing session", err);
    }
  }

  async restoreSession() {
    const saved = await persistence.get<File>(this.toolKey);
    if (saved) {
      await this.handleFiles([saved] as unknown as FileList);
    }
  }

  async handleConvert() {
    // Read the file and the settings once: the user can pick another file
    // while this runs, and the output must match what was converted.
    const file = this.selectedFile;
    if (!file) return;
    const format = this.targetFormat;
    const formatLabel = PdfToText.labelFor(format);
    const useMarkdown = format === "md";
    const ocrEnabled = this.ocrEnabled;

    const convertBtn = this.querySelector("#convertBtn") as HTMLButtonElement;
    const progressSection = this.querySelector("#progressSection") as HTMLElement;
    const successMsg = this.querySelector("#successMessage") as HTMLElement;
    const formatButtons = ["#formatMdBtn", "#formatTxtBtn"]
      .map((id) => this.querySelector(id) as HTMLButtonElement | null)
      .filter((button): button is HTMLButtonElement => button !== null);

    try {
      convertBtn.disabled = true;
      // A format switch mid-run would label the output wrongly.
      for (const button of formatButtons) button.disabled = true;
      progressSection.classList.remove("hidden");
      successMsg.classList.add("hidden");

      this.updateProgress(10, "Preparing extraction...");
      const pdfBytes = await this.getCachedPdfBytes(file);

      // pdf-inspector is the authoritative engine for text extraction. It runs
      // in a Web Worker and returns a structured envelope with diagnosis
      // (scan detection, OCR-needed pages, encoding issues, layout warnings).
      let envelope: AnalysisEnvelope;
      let text: string;
      let warnings: string[];

      try {
        if (useMarkdown) {
          this.updateProgress(30, "Analyzing document structure...");
          envelope = await pdfInspectorEngine.extractMarkdown(pdfBytes);
          text = envelope.markdown ?? "";
        } else {
          this.updateProgress(30, "Extracting text...");
          const out = await pdfInspectorEngine.extractText(pdfBytes, { profile: "fidelity" });
          envelope = out.envelope;
          // The engine's text is already plain; only the Markdown fallback
          // needs its syntax removed.
          text = stripImagePlaceholders(out.text) || markdownToPlainText(envelope.markdown ?? "");
        }
        // Copy: the engine returns its cached envelope, and the pushes below
        // must not pile up in that cache across runs.
        warnings = [...(envelope.warnings ?? [])];
      } catch (err) {
        if (err instanceof PdfInspectorError && STOP_REASONS.has(err.reason)) {
          throw err;
        }
        // The worker or WASM engine is unavailable, or the engine could not
        // parse the file (pdf.js rebuilds a damaged xref, for example): try
        // the legacy extractor rather than failing the whole tool.
        const inspectorErr = err instanceof PdfInspectorError ? err : null;
        logger.warn("pdf-inspector could not extract text; falling back to legacy extractor", err);
        const fallback = await this.legacyText(pdfBytes, useMarkdown);
        if (fallback === null) {
          throw inspectorErr ?? new Error("Text extraction failed.");
        }
        text = fallback;
        warnings = [
          inspectorErr && inspectorErr.reason !== "engine-unavailable"
            ? "The analysis engine could not read this file, so the legacy local extractor was used; diagnosis (scan detection, layout warnings) is not available for this run."
            : "Extraction used the legacy local pipeline; diagnosis (scan detection, layout warnings) is not available for this run.",
        ];
        envelope = {
          fileType: "application/pdf",
          pdfType: "Unknown",
          pageCount: 0,
          confidence: 0,
          markdown: useMarkdown ? text : undefined,
          layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
          pagesNeedingOcr: [],
          ocrReasonsByPage: [],
          hasEncodingIssues: false,
          engine: "pdf-inspector-wasm",
          engineVersion: "unavailable",
          processingTimeMs: 0,
          warnings,
        };
      }

      // The engine can return no text for a PDF that has some, for example
      // one it rates ImageBased, or when it fell back to detection only. A
      // fully scanned PDF has nothing for pdf.js to find either.
      if (
        !text.trim() &&
        envelope.engineVersion !== "unavailable" &&
        envelope.pdfType !== "Scanned"
      ) {
        const legacy = await this.legacyText(pdfBytes, useMarkdown);
        if (legacy?.trim()) {
          text = legacy;
          warnings.push(
            "The analysis engine returned no text for this file; the text came from the legacy local extractor.",
          );
        }
      }

      const neededOcr = envelope.pagesNeedingOcr.length > 0;
      let ocrMeta: {
        attempted: boolean;
        pages: number[];
        engine?: string;
        engineVersion?: string;
        warnings: string[];
      } = { attempted: false, pages: [], warnings: [] };

      if (ocrEnabled && neededOcr) {
        const pageCount = envelope.pageCount || envelope.pagesNeedingOcr.length;
        this.updateProgress(
          55,
          `Running OCR on ${envelope.pagesNeedingOcr.length} page${plural(envelope.pagesNeedingOcr.length)}...`,
        );
        try {
          // Without page markers, OCR text is added after the base text. When
          // every page needs OCR, the engine's own text for them is only noise,
          // so start from nothing rather than repeat the pages.
          const coversAll = envelope.pagesNeedingOcr.length >= pageCount;
          const nativeMd = envelope.markdown?.trim() ? envelope.markdown : coversAll ? "" : text;
          const { markdown, ocr } = await ocrEngine.enrichMarkdownWithOcr(
            pdfBytes,
            nativeMd,
            envelope.pagesNeedingOcr,
            pageCount,
          );
          const applied = ocr.pages.map((p) => p.page);
          if (applied.length > 0) {
            text = useMarkdown ? markdown : markdownToPlainText(markdown);
          }
          const resolved = new Set(applied);
          // The engine's "needs OCR on page…" warning predates this OCR run;
          // keep only what is still true about the pages OCR could not read.
          const remaining = envelope.pagesNeedingOcr.filter((p) => !resolved.has(p));
          warnings = warnings.filter((w) => !/needs OCR on page/i.test(w));
          if (remaining.length > 0) {
            warnings.push(
              `OCR could not read page${plural(remaining.length)} ${remaining.join(", ")}; text from ${remaining.length === 1 ? "that page" : "those pages"} may be missing.`,
            );
          }
          warnings.push(...ocr.warnings);
          envelope = {
            ...envelope,
            markdown: applied.length > 0 ? markdown : envelope.markdown,
            pagesNeedingOcr: remaining,
          };
          ocrMeta = {
            attempted: true,
            pages: applied,
            engine: ocr.engine,
            engineVersion: ocr.engineVersion,
            warnings: ocr.warnings,
          };
        } catch (err) {
          if (err instanceof OcrError) {
            warnings.push(`OCR skipped: ${err.message}`);
            logger.warn("OCR failed; continuing with native text only", err);
          } else {
            warnings.push("OCR failed; continuing with native text only.");
            logger.warn("OCR failed; continuing with native text only", err);
          }
        }
      }

      if (!text.trim()) {
        // Nothing to save: don't offer a download that can only fail.
        const scanned = envelope.pdfType === "Scanned" || neededOcr;
        const hint = !scanned
          ? ""
          : ocrEnabled
            ? " OCR could not read any text on its pages."
            : " It looks like a scanned document. Turn on OCR and try again.";
        this.showErrorDialog(`No text was found in this PDF.${hint}`, "No text found");
        return;
      }

      this.updateProgress(100, "Extraction complete!");

      const data = new TextEncoder().encode(text);
      const ext = useMarkdown ? ".md" : ".txt";
      const outputName = generateOutputFilename(file.name, "", ext);

      // A result for a file that is no longer selected goes to history only.
      if (this.selectedFile === file) {
        this.showSuccess(data, outputName, "", ext);
        this.bindCopyButton(data);

        const diagnosis = this.formatDiagnosis(envelope, ocrMeta.pages, ocrMeta.attempted);
        this.showSuccessDialog(
          `Your ${formatLabel} file is ready.${diagnosis ? ` ${diagnosis}` : ""}`,
        );
      }

      await this.recordJob(`PDF to ${formatLabel}`, outputName, data, {
        format,
        mode: "local",
        engine: envelope.engine,
        engineVersion: envelope.engineVersion,
        pdfType: envelope.pdfType,
        confidence: envelope.confidence,
        pagesNeedingOcr: envelope.pagesNeedingOcr,
        ocrPages: ocrMeta.pages,
        ocrEngine: ocrMeta.engine,
        ocrEngineVersion: ocrMeta.engineVersion,
        warnings,
      });
    } catch (err: any) {
      logger.error("Text extraction failed", err);
      const message =
        err instanceof PdfInspectorError
          ? this.extractUserMessage(err)
          : describeFailure("Extraction failed.", err);
      this.showErrorDialog(message);
    } finally {
      convertBtn.disabled = false;
      for (const button of formatButtons) button.disabled = false;
      progressSection.classList.add("hidden");
    }
  }

  /** Text from the legacy pdf.js extractor, or null when it fails. */
  private async legacyText(pdfBytes: Uint8Array, useMarkdown: boolean): Promise<string | null> {
    const result = useMarkdown
      ? await localConverter.pdfToMarkdown(pdfBytes)
      : await localConverter.pdfToText(pdfBytes);
    return result.success && result.data ? new TextDecoder().decode(result.data) : null;
  }

  private extractUserMessage(err: PdfInspectorError): string {
    switch (err.reason) {
      // This tool has no password field, so point to the tool that has one.
      case "encrypted":
      case "password-required":
        return "This PDF is password-protected. Remove the password with the Unlock PDF tool, then try again.";
      case "malformed":
        return "This file is not a valid or readable PDF.";
      case "resource-limit":
        return "The document is too large to analyze in this browser session. Try a smaller file or fewer pages.";
      case "unsupported":
        return "This PDF uses features the local analysis engine does not support.";
      default:
        return `Extraction failed: ${err.message}`;
    }
  }

  /**
   * One sentence per finding. The dialog shows its message as one paragraph,
   * so each item must read on its own.
   */
  private formatDiagnosis(
    envelope: AnalysisEnvelope,
    ocrPages: number[] = [],
    ocrAttempted = false,
  ): string {
    if (envelope.engineVersion === "unavailable") return "";
    const parts: string[] = [];
    if (envelope.pdfType && envelope.pdfType !== "Unknown") {
      parts.push(
        `Type: ${envelope.pdfType} (${Math.round(envelope.confidence * 100)}% confidence).`,
      );
    }
    if (ocrPages.length > 0) {
      parts.push(`OCR applied to page${plural(ocrPages.length)} ${ocrPages.join(", ")}.`);
    }
    const missing = envelope.pagesNeedingOcr;
    if (missing.length > 0) {
      parts.push(
        ocrAttempted
          ? `Text missing from page${plural(missing.length)} ${missing.join(", ")} (OCR could not read ${missing.length === 1 ? "it" : "them"}).`
          : `Needs OCR on page${plural(missing.length)} ${missing.join(", ")}.`,
      );
    }
    const tables = envelope.layout.pagesWithTables;
    if (tables.length > 0) {
      parts.push(`Tables detected on page${plural(tables.length)} ${tables.join(", ")}.`);
    }
    if (envelope.hasEncodingIssues) {
      parts.push("Encoding issues detected; some characters may be missing or garbled.");
    }
    return parts.join(" ");
  }

  private bindCopyButton(data: Uint8Array) {
    const copyBtn = this.querySelector("#copyBtn") as HTMLButtonElement | null;
    if (!copyBtn) return;

    copyBtn.onclick = async () => {
      try {
        const text = new TextDecoder().decode(data);
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = "Copy to Clipboard";
        }, 2000);
      } catch (err) {
        logger.error("Copy to clipboard failed", err);
        this.showErrorDialog("Failed to copy to clipboard.");
      }
    };
  }

  private async getCachedPdfBytes(file: File) {
    if (this.cachedPdfBytes && this.cachedPdfFile === file) {
      return this.cachedPdfBytes;
    }

    const pdfBytes = new Uint8Array(await file.arrayBuffer());
    this.cachedPdfBytes = pdfBytes;
    this.cachedPdfFile = file;
    return pdfBytes;
  }
}

customElements.define("pdf-to-text", PdfToText);
