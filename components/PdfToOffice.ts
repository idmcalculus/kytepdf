import { type ConversionFormat, cloudConversionService } from "../utils/CloudConversionService.ts";
import {
  type ConversionQuality,
  type ConversionResult,
  localConverter,
} from "../utils/LocalConverter.ts";
import { logger } from "../utils/logger.ts";
import { getPdfPreviewErrorMessage, PdfPreviewController } from "../utils/pdfPreview.ts";
import { generateOutputFilename } from "../utils/pdfUtils.ts";
import { persistence } from "../utils/persistence.ts";
import { BaseComponent } from "./BaseComponent.ts";

type ConversionMode = "local" | "cloud";

export class PdfToOffice extends BaseComponent {
  protected toolKey = "pdf-to-office";
  private targetFormat: ConversionFormat = "docx";
  private ocrEnabled = false;
  private conversionMode: ConversionMode = "local";
  private lastLocalQuality: ConversionQuality | null = null;
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
    this.conversionMode = this.supportsLocal ? "local" : "cloud";
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
        <p class="subtitle">Convert your PDF into an editable ${this.formatLabel} document.</p>

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
                <label>Conversion Mode</label>
                <div class="presets-grid" id="modeToggle">
                  <button id="modeLocalBtn" class="preset-btn">
                    <span class="preset-name">Local</span>
                    <span class="preset-desc">Runs in your browser</span>
                  </button>
                  <button id="modeCloudBtn" class="preset-btn">
                    <span class="preset-name">Cloud</span>
                    <span class="preset-desc">Best quality</span>
                  </button>
                </div>
                <div id="localWarning" class="warning hidden">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
                  <span>Local conversion is best-effort and may miss complex layouts. Try cloud mode for higher fidelity.</span>
                </div>
                <div id="qualityWarning" class="warning hidden" style="align-items: center; justify-content: space-between;">
                  <span>Local results look limited. For higher fidelity, switch to cloud conversion.</span>
                  <button id="tryCloudBtn" class="btn btn-secondary btn-sm" style="width: auto;">Try Cloud</button>
                </div>
              </div>

              <div class="control-group">
                <label>Options</label>
                <div class="preset-btn active" style="flex-direction: row; justify-content: space-between; align-items: center; padding: 1rem; cursor: default;">
                  <div>
                    <span class="preset-name">OCR (Text Recognition)</span>
                    <span class="preset-desc">Recommended for scanned documents</span>
                  </div>
                  <input type="checkbox" id="ocrToggle" style="width: 20px; height: 20px; cursor: pointer;" />
                </div>
              </div>

              <div class="actions-row">
                <button id="convertBtn" class="btn btn-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a3.5 3.5 0 0 0 .5-6.91V11a5 5 0 0 0-10 0v1.09a3.5 3.5 0 0 0 .5 6.91Z"/><path d="M12 13v4"/><path d="m10 15 2 2 2-2"/></svg>
                  <span id="convertLabel">Start Conversion</span>
                </button>
              </div>

              ${this.getProgressSection("Uploading to cloud...")}

              <div id="successMessage" class="success-message hidden">
                <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">🎉 Conversion Complete!</p>
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
    const modeLocalBtn = this.querySelector("#modeLocalBtn") as HTMLButtonElement;
    const modeCloudBtn = this.querySelector("#modeCloudBtn") as HTMLButtonElement;
    const tryCloudBtn = this.querySelector("#tryCloudBtn") as HTMLButtonElement;

    ocrToggle.onchange = () => {
      this.ocrEnabled = ocrToggle.checked;
    };

    convertBtn.onclick = () => this.handleConvert();
    modeLocalBtn.onclick = () => this.setConversionMode("local");
    modeCloudBtn.onclick = () => this.setConversionMode("cloud");
    tryCloudBtn.onclick = () => this.setConversionMode("cloud");

    this.previewController = this.createPreviewController();

    this.checkExistingSession();
    this.updateModeUI();
  }

  async handleFiles(files: FileList) {
    const file = files[0];
    if (!(await this.validateFile(file))) return;

    this.selectedFile = file;
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

    this.updateModeUI();
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

  private setConversionMode(mode: ConversionMode) {
    if (mode === "local" && !this.supportsLocal) {
      this.showErrorDialog("Local conversion is not available for PPT yet.");
      return;
    }
    this.conversionMode = mode;
    if (mode === "local") {
      this.ocrEnabled = false;
    }
    this.lastLocalQuality = null;
    this.updateModeUI();
  }

  private updateModeUI() {
    const modeLocalBtn = this.querySelector("#modeLocalBtn") as HTMLButtonElement | null;
    const modeCloudBtn = this.querySelector("#modeCloudBtn") as HTMLButtonElement | null;
    const localWarning = this.querySelector("#localWarning") as HTMLElement | null;
    const qualityWarning = this.querySelector("#qualityWarning") as HTMLElement | null;
    const convertLabel = this.querySelector("#convertLabel") as HTMLElement | null;
    const ocrToggle = this.querySelector("#ocrToggle") as HTMLInputElement | null;

    if (modeLocalBtn) {
      modeLocalBtn.disabled = !this.supportsLocal;
      modeLocalBtn.classList.toggle("active", this.conversionMode === "local");
      if (!this.supportsLocal) {
        modeLocalBtn.title = "Local mode is not available for this format.";
      } else {
        modeLocalBtn.title = "";
      }
    }
    if (modeCloudBtn) {
      modeCloudBtn.classList.toggle("active", this.conversionMode === "cloud");
    }
    if (localWarning) {
      localWarning.classList.toggle("hidden", this.conversionMode !== "local");
    }
    if (qualityWarning) {
      qualityWarning.classList.toggle(
        "hidden",
        this.conversionMode !== "local" || this.lastLocalQuality !== "poor",
      );
    }
    if (convertLabel) {
      convertLabel.textContent =
        this.conversionMode === "local" ? "Start Local Conversion" : "Start Cloud Conversion";
    }
    if (ocrToggle) {
      ocrToggle.disabled = this.conversionMode === "local";
      if (this.conversionMode === "local") {
        ocrToggle.checked = false;
      }
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
          resumeBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
            Resume ${saved.name}
          `;
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
    if (!this.selectedFile) return;

    const convertBtn = this.querySelector("#convertBtn") as HTMLButtonElement;
    const progressSection = this.querySelector("#progressSection") as HTMLElement;
    const successMsg = this.querySelector("#successMessage") as HTMLElement;

    try {
      convertBtn.disabled = true;
      progressSection.classList.remove("hidden");
      successMsg.classList.add("hidden");
      if (this.conversionMode === "local") {
        await this.handleLocalConvert();
      } else {
        await this.handleCloudConvert();
      }
    } catch (err: any) {
      logger.error("Conversion failed", err);
      this.showErrorDialog(`Conversion failed: ${err.message}`);
    } finally {
      convertBtn.disabled = false;
      progressSection.classList.add("hidden");
    }
  }

  private async handleCloudConvert() {
    if ((window as any).ensureCloudConsent) {
      const consented = await (window as any).ensureCloudConsent();
      if (!consented) return;
    }

    this.lastLocalQuality = null;
    this.updateModeUI();
    this.updateProgress(20, "Uploading to secure cloud...");

    const resultBytes = await cloudConversionService.convertFile(
      this.selectedFile as File,
      this.targetFormat,
      { ocr: this.ocrEnabled },
    );

    this.updateProgress(100, "Conversion complete!");

    const ext = `.${this.targetFormat}`;
    const outputName = generateOutputFilename(
      this.selectedFile?.name || "document.pdf",
      "_converted",
      ext,
    );

    this.showSuccess(resultBytes, outputName, "", ext);
    this.showSuccessDialog(`Your ${this.formatLabel} file is ready.`);

    await this.recordJob(`PDF to ${this.formatLabel}`, outputName, resultBytes, {
      ocr: this.ocrEnabled,
      format: this.targetFormat,
      mode: "cloud",
    });
  }

  private async handleLocalConvert() {
    if (!this.supportsLocal) {
      this.showErrorDialog("Local conversion is not available for this format.");
      return;
    }

    this.updateProgress(10, "Preparing local conversion...");
    const pdfBytes = await this.getCachedPdfBytes();

    let result: ConversionResult;
    if (this.targetFormat === "docx") {
      this.updateProgress(30, "Extracting text locally...");
      result = await localConverter.pdfToWord(pdfBytes);
    } else if (this.targetFormat === "xlsx") {
      this.updateProgress(30, "Extracting tables locally...");
      result = await localConverter.pdfToExcel(pdfBytes);
    } else {
      throw new Error("Local conversion is only available for Word or Excel.");
    }

    if (!result.success || !result.data) {
      throw new Error("Local conversion failed.");
    }

    this.lastLocalQuality = result.quality;
    this.updateModeUI();
    this.updateProgress(100, "Conversion complete!");

    const ext = `.${this.targetFormat}`;
    const outputName = generateOutputFilename(
      this.selectedFile?.name || "document.pdf",
      "_converted",
      ext,
    );

    this.showSuccess(result.data, outputName, "", ext);
    this.showSuccessDialog(`Your ${this.formatLabel} file is ready.`);

    await this.recordJob(`PDF to ${this.formatLabel}`, outputName, result.data, {
      ocr: false,
      format: this.targetFormat,
      mode: "local",
      quality: result.quality,
      warnings: result.warnings,
    });
  }

  private async getCachedPdfBytes() {
    if (!this.selectedFile) {
      throw new Error("No file selected for conversion.");
    }

    if (this.cachedPdfBytes && this.cachedPdfFile === this.selectedFile) {
      return this.cachedPdfBytes;
    }

    const arrayBuffer = await (this.selectedFile as File).arrayBuffer();
    const pdfBytes = new Uint8Array(arrayBuffer);
    this.cachedPdfBytes = pdfBytes;
    this.cachedPdfFile = this.selectedFile as File;
    return pdfBytes;
  }
}

customElements.define("pdf-to-office", PdfToOffice);
