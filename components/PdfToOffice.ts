import { describeFailure, UserFacingError } from "../utils/errorMapper.ts";
import {
  type ConversionQuality,
  type ConversionResult,
  localConverter,
} from "../utils/LocalConverter.ts";
import { logger } from "../utils/logger.ts";
import { OcrError, ocrEngine } from "../utils/ocrEngine.ts";
import { PdfInspectorError, pdfInspectorEngine } from "../utils/pdfInspectorEngine.ts";
import type { AnalysisEnvelope } from "../utils/pdfInspectorTypes.ts";
import { getPdfPreviewErrorMessage, PdfPreviewController } from "../utils/pdfPreview.ts";
import { generateOutputFilename } from "../utils/pdfUtils.ts";
import { persistence } from "../utils/persistence.ts";
import { BaseComponent } from "./BaseComponent.ts";

export type ConversionFormat = "docx" | "pptx" | "xlsx" | "pdf";

export class PdfToOffice extends BaseComponent {
  protected toolKey = "pdf-to-office";
  private targetFormat: ConversionFormat = "docx";
  private ocrEnabled = true;
  private lastLocalQuality: ConversionQuality | null = null;
  /** Whether OCR was on for the conversion that set lastLocalQuality. */
  private lastQualityUsedOcr = false;
  private previewController: PdfPreviewController | null = null;
  private cachedPdfBytes: Uint8Array | null = null;
  private cachedPdfFile: File | null = null;

  constructor(format: ConversionFormat = "docx") {
    super();
    this.targetFormat = format;
    this.toolKey = `pdf-to-${format}`;
  }

  connectedCallback() {
    const attrFormat = this.getAttribute("format") as ConversionFormat;
    if (attrFormat) {
      this.targetFormat = attrFormat;
      this.toolKey = `pdf-to-${attrFormat}`;
    }
    super.connectedCallback();
  }

  get formatLabel() {
    switch (this.targetFormat) {
      case "docx":
        return "Word";
      case "pptx":
        return "PowerPoint";
      case "xlsx":
        return "Excel (Sheets)";
      default:
        return this.targetFormat.toUpperCase();
    }
  }

  get supportsLocal() {
    return this.targetFormat === "docx" || this.targetFormat === "xlsx";
  }

  render() {
    this.innerHTML = `
      <div class="tool-view">
        ${this.getBackButton()}

        <h1>PDF to ${this.formatLabel}</h1>
        <p class="subtitle">Extract text and structure from your PDF into an editable ${this.formatLabel} document. Runs locally; results preserve content and detectable tables, not the original page layout.</p>

        ${this.getDropZone(`your PDF`, "file-up")}

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
                <div class="warning" style="border-color: var(--primary-glow); background: rgba(6, 182, 212, 0.05);">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--primary);"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  <span>Local export reconstructs content and detectable tables from text, not the original visual layout. Scanned pages need OCR before they contribute text.</span>
                </div>
              </div>

              <div class="control-group">
                <label>Options</label>
                <div class="preset-btn active" style="flex-direction: row; justify-content: space-between; align-items: center; padding: 1rem; cursor: default;">
                  <div>
                    <span class="preset-name" id="ocrToggleLabel">OCR (Text Recognition)</span>
                    <span class="preset-desc" id="ocrToggleDesc">Runs locally on pages that need it</span>
                  </div>
                  <input type="checkbox" id="ocrToggle" aria-labelledby="ocrToggleLabel" aria-describedby="ocrToggleDesc" checked style="width: 20px; height: 20px; cursor: pointer;" />
                </div>
              </div>

              <div id="qualityWarning" class="warning hidden">
                <span id="qualityWarningText">This PDF yielded limited extractable text. Try enabling OCR for scanned content.</span>
              </div>

              <div class="actions-row">
                <button id="convertBtn" class="btn btn-primary" ${this.supportsLocal ? "" : "disabled"}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a3.5 3.5 0 0 0 .5-6.91V11a5 5 0 0 0-10 0v1.09a3.5 3.5 0 0 0 .5 6.91Z"/><path d="M12 13v4"/><path d="m10 15 2 2 2-2"/></svg>
                  <span id="convertLabel">${this.supportsLocal ? "Start Local Conversion" : "Not available locally"}</span>
                </button>
              </div>

              ${this.getProgressSection("Converting locally...")}

              <div id="successMessage" class="success-message hidden">
                <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">Conversion Complete!</p>
                <button id="downloadLink" class="btn btn-primary">Download ${this.formatLabel} File</button>
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
    const ocrToggle = this.querySelector("#ocrToggle") as HTMLInputElement;

    ocrToggle.onchange = () => {
      this.ocrEnabled = ocrToggle.checked;
    };

    convertBtn.onclick = () => this.handleConvert();

    this.previewController = this.createPreviewController();

    this.checkExistingSession();
    this.updateQualityUI();
  }

  async handleFiles(files: FileList) {
    const file = files[0];
    if (!(await this.validateFile(file))) return;

    this.selectedFile = file;
    // The last result and its quality note belong to the previous file.
    this.lastLocalQuality = null;
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

    this.updateQualityUI();
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

  /** Hides a finished result so its download can't be taken for another file. */
  private clearResult() {
    const successMsg = this.querySelector("#successMessage") as HTMLElement | null;
    const downloadLink = this.querySelector("#downloadLink") as HTMLElement | null;
    successMsg?.classList.add("hidden");
    if (downloadLink) downloadLink.onclick = null;
  }

  private updateQualityUI() {
    const qualityWarning = this.querySelector("#qualityWarning") as HTMLElement | null;
    const text = this.querySelector("#qualityWarningText") as HTMLElement | null;
    if (text) {
      // Suggesting OCR only makes sense when it was off for that conversion.
      text.textContent = this.lastQualityUsedOcr
        ? "Some pages could not be read reliably. Check the output against the original."
        : "This PDF yielded limited extractable text. Try enabling OCR for scanned content.";
    }
    if (qualityWarning) {
      qualityWarning.classList.toggle("hidden", this.lastLocalQuality !== "poor");
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
    // Read the file once: the user can pick another while this runs, and the
    // output must be named after the file it came from.
    const file = this.selectedFile;
    if (!file) return;
    if (!this.supportsLocal) {
      this.showErrorDialog(
        `Local ${this.formatLabel} export is not available yet. Only Word and Excel are supported in the browser.`,
      );
      return;
    }

    const convertBtn = this.querySelector("#convertBtn") as HTMLButtonElement;
    const progressSection = this.querySelector("#progressSection") as HTMLElement;
    const successMsg = this.querySelector("#successMessage") as HTMLElement;

    try {
      convertBtn.disabled = true;
      progressSection.classList.remove("hidden");
      successMsg.classList.add("hidden");
      await this.handleLocalConvert(file);
    } catch (err: any) {
      logger.error("Conversion failed", err);
      this.showErrorDialog(describeFailure("Conversion failed.", err));
    } finally {
      convertBtn.disabled = false;
      progressSection.classList.add("hidden");
    }
  }

  private async handleLocalConvert(file: File) {
    const ocrEnabled = this.ocrEnabled;
    this.updateProgress(10, "Preparing local conversion...");
    const pdfBytes = await this.getCachedPdfBytes(file);

    const analysis = await this.analyzeForExport(pdfBytes, this.targetFormat);
    for (const w of analysis.warnings) logger.info(`pdf-inspector: ${w}`);
    if (analysis.surfaceAsError) {
      // Written for the user, so the error mapper must not replace it.
      throw new UserFacingError(analysis.surfaceAsError);
    }

    let ocrAppliedPages: number[] = [];
    let ocrAttempted = false;
    if (ocrEnabled && analysis.envelope && analysis.envelope.pagesNeedingOcr.length > 0) {
      this.updateProgress(
        25,
        `Running OCR on ${analysis.envelope.pagesNeedingOcr.length} page${analysis.envelope.pagesNeedingOcr.length === 1 ? "" : "s"}...`,
      );
      try {
        const { markdown, ocr } = await ocrEngine.enrichMarkdownWithOcr(
          pdfBytes,
          analysis.envelope.markdown ?? "",
          analysis.envelope.pagesNeedingOcr,
          analysis.envelope.pageCount,
        );
        ocrAttempted = true;
        ocrAppliedPages = ocr.pages.map((p) => p.page);
        const resolved = new Set(ocrAppliedPages);
        const remaining = analysis.envelope.pagesNeedingOcr.filter((p) => !resolved.has(p));
        // Matches both the pdf-inspector envelope's own "needs OCR on page…"
        // warning and analyzeForExport's "will not include text from page…
        // until OCR is performed" message. `analysis.warnings` starts as a
        // *copy* of `envelope.warnings` (see analyzeForExport), so both the
        // envelope and the top-level analysis warnings need to be re-filtered
        // here — otherwise the stale pre-OCR warning survives in job
        // metadata alongside "OCR applied", contradicting the actual result.
        const stalePreOcrWarning = /needs OCR on page|will not include text from page/i;
        analysis.envelope = {
          ...analysis.envelope,
          markdown,
          pagesNeedingOcr: remaining,
          warnings: (analysis.envelope.warnings ?? []).filter((w) => !stalePreOcrWarning.test(w)),
        };
        analysis.warnings = analysis.warnings.filter((w) => !stalePreOcrWarning.test(w));
        if (remaining.length > 0) {
          analysis.warnings.push(
            `Local export still will not include text from page${remaining.length === 1 ? "" : "s"} ${remaining.join(", ")} — OCR was unable to recognize them.`,
          );
        }
        analysis.warnings.push(...ocr.warnings);
        if (ocrAppliedPages.length > 0) {
          analysis.warnings.push(
            `OCR applied to page${ocrAppliedPages.length === 1 ? "" : "s"} ${ocrAppliedPages.join(", ")}.`,
          );
        }
      } catch (err) {
        const msg = err instanceof OcrError ? err.message : "OCR failed";
        analysis.warnings.push(`OCR skipped: ${msg}`);
        logger.warn("Local OCR failed; continuing with native text", err);
      }
    }

    let result: ConversionResult;
    if (this.targetFormat === "docx") {
      this.updateProgress(30, "Extracting text locally...");
      result = analysis.envelope
        ? await localConverter.pdfToWordFromEnvelope(pdfBytes, analysis.envelope)
        : await localConverter.pdfToWord(pdfBytes);
    } else if (this.targetFormat === "xlsx") {
      this.updateProgress(30, "Extracting tables locally...");
      result = analysis.envelope
        ? await localConverter.pdfToExcelFromEnvelope(pdfBytes, analysis.envelope)
        : await localConverter.pdfToExcel(pdfBytes);
    } else {
      throw new Error("Local conversion is only available for Word or Excel.");
    }

    if (!result.success || !result.data) {
      throw new Error("Local conversion failed.");
    }

    this.updateProgress(100, "Conversion complete!");

    const ext = `.${this.targetFormat}`;
    const outputName = generateOutputFilename(file.name, "_converted", ext);

    // A result for a file that is no longer selected goes to history only.
    if (this.selectedFile === file) {
      this.lastLocalQuality = result.quality;
      this.lastQualityUsedOcr = ocrEnabled;
      this.updateQualityUI();
      this.showSuccess(result.data, outputName, "", ext);

      const diagnosis = analysis.envelope
        ? this.formatOfficeDiagnosis(analysis.envelope, ocrAppliedPages, ocrAttempted)
        : "";
      this.showSuccessDialog(
        `Your ${this.formatLabel} file is ready.${diagnosis ? ` ${diagnosis}` : ""}`,
      );
    }

    await this.recordJob(`PDF to ${this.formatLabel}`, outputName, result.data, {
      ocr: ocrEnabled,
      format: this.targetFormat,
      mode: "local",
      quality: result.quality,
      warnings: [...result.warnings, ...analysis.warnings],
      ...(analysis.envelope
        ? {
            engine: analysis.envelope.engine,
            pdfType: analysis.envelope.pdfType,
            confidence: analysis.envelope.confidence,
            pagesNeedingOcr: analysis.envelope.pagesNeedingOcr,
            ocrPages: ocrAppliedPages,
          }
        : {}),
    });
  }

  /**
   * One sentence per finding. The dialog shows its message as one paragraph,
   * so each item must read on its own.
   */
  private formatOfficeDiagnosis(
    envelope: AnalysisEnvelope,
    ocrPages: number[] = [],
    ocrAttempted = false,
  ): string {
    const plural = (count: number) => (count === 1 ? "" : "s");
    const parts: string[] = [];
    if (envelope.pdfType && envelope.pdfType !== "Unknown") {
      parts.push(
        `Source type: ${envelope.pdfType} (${Math.round(envelope.confidence * 100)}% confidence).`,
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
      parts.push("Encoding issues detected in the source PDF.");
    }
    return parts.join(" ");
  }

  private async analyzeForExport(
    pdfBytes: Uint8Array,
    targetFormat: ConversionFormat,
  ): Promise<{ envelope?: AnalysisEnvelope; warnings: string[]; surfaceAsError?: string }> {
    let envelope: AnalysisEnvelope | undefined;
    try {
      envelope = await pdfInspectorEngine.analyze(pdfBytes, { profile: "compact" });
    } catch (err) {
      if (
        err instanceof PdfInspectorError &&
        (err.reason === "encrypted" || err.reason === "password-required")
      ) {
        // This tool has no password field, so point to the tool that has one.
        return {
          warnings: [],
          surfaceAsError:
            "This PDF is password-protected. Remove the password with the Unlock PDF tool, then try again.",
        };
      }
      logger.warn("pdf-inspector analysis unavailable; relying on legacy export", err);
      return { warnings: [] };
    }

    const warnings: string[] = [...(envelope.warnings ?? [])];

    if (envelope.pdfType === "Scanned" || envelope.pdfType === "Mixed") {
      warnings.push(
        `This document is ${envelope.pdfType.toLowerCase()} — local export will not include text from page${envelope.pagesNeedingOcr.length === 1 ? "" : "s"} ${envelope.pagesNeedingOcr.join(", ") || "(OCR-needed)"} until OCR is performed.`,
      );
    }

    if (targetFormat === "xlsx") {
      const hasTables = envelope.layout.pagesWithTables.length > 0;
      if (!hasTables) {
        warnings.push(
          "No tables were confidently detected. The spreadsheet may contain only flat text rows.",
        );
      } else {
        warnings.push(
          `Tables detected on page${envelope.layout.pagesWithTables.length === 1 ? "" : "s"} ${envelope.layout.pagesWithTables.join(", ")}.`,
        );
      }
    }

    return { envelope, warnings };
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

customElements.define("pdf-to-office", PdfToOffice);
