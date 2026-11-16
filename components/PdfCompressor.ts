import { describeFailure, mapError } from "../utils/errorMapper.ts";
import { logger } from "../utils/logger.ts";
import { compressPdf } from "../utils/pdfCompression.ts";
import { getPdfPreviewErrorMessage, PdfPreviewController } from "../utils/pdfPreview.ts";
import { calculateSavingsPercent, generateOutputFilename } from "../utils/pdfUtils.ts";
import { persistence } from "../utils/persistence.ts";
import { BaseComponent } from "./BaseComponent.ts";

export class PdfCompressor extends BaseComponent {
  /** 1 GB. Pages are compressed one at a time, so the file is the main memory cost. */
  static readonly MAX_FILE_SIZE_MB = 1024;

  private selectedRatio: number | null = 0.4;
  private previewController: PdfPreviewController | null = null;
  /** True while a compression runs; it reads the preview's document, so that must stay put. */
  private isCompressing = false;
  protected toolKey = "pdf-compressor";

  disconnectedCallback() {
    // The preview holds the whole file (up to 1 GB) in a pdf.js worker.
    void this.previewController?.destroy();
    this.previewController = null;
  }

  private async showBusyMessage(action: string) {
    await this.showDialog({
      title: "Compression in progress",
      message: `Wait for the current compression to finish before you ${action}.`,
      type: "info",
    });
  }

  async clearFullStorage(toolKey?: string) {
    if (this.isCompressing) {
      await this.showBusyMessage("clear saved progress");
      return;
    }
    await super.clearFullStorage(toolKey);
  }

  render() {
    this.innerHTML = `
      <div class="tool-view">
        ${this.getBackButton()}

        <h1>Compress PDF</h1>
        <p class="subtitle">Shrink PDF file size while maintaining visual quality.</p>

        ${this.getDropZone("your PDF", "file-up")}

        <div id="fileInfo" class="file-list-item hidden" style="margin-bottom: 2rem; cursor: default;">
          <div class="file-item-details">
            <span id="fileName" class="file-name">document.pdf</span>
            <span id="fileSize" class="file-size">2.4 MB</span>
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
              <label>Compression Level</label>
              <div class="presets-grid">
                <button class="preset-btn" data-ratio="0.1">
                  <span class="preset-name">Extreme</span>
                </button>
                <button class="preset-btn active" data-ratio="0.4">
                  <span class="preset-name">Medium</span>
                </button>
                <button class="preset-btn" data-ratio="0.7">
                  <span class="preset-name">Low</span>
                </button>
                <button class="preset-btn" id="customPresetBtn">
                  <span class="preset-name">Custom</span>
                </button>
              </div>

              <div id="targetSizeGroup" class="control-group hidden">
                <label for="targetSize">Target Size (KB)</label>
                <input type="number" id="targetSize" placeholder="e.g., 500" min="10" />
              </div>

              <div id="estSizeInfo" class="file-info hidden" style="margin-top: 0; background: none; padding: 0; font-size: 0.85rem;">
                <span style="color: var(--text-muted);">Estimated Target:</span>
                <span id="estSizeValue" style="color: var(--accent); font-weight: 600;">0 KB</span>
              </div>

              <div id="qualityWarning" class="warning hidden">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                <span>Target size is low.</span>
              </div>

              <button id="compressBtn" class="btn btn-primary" disabled>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m8 17 4 4 4-4"/></svg>
                Compress PDF
              </button>

              ${this.getProgressSection("Compressing...")}

              <div id="successMessage" class="success-message hidden">
                <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">\ud83c\udf89 Compression Complete!</p>
                <div id="statsInfo" style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.6;">
                  <div>Final Size: <span id="finalSizeValue" style="color: var(--text); font-weight: 600;">0 KB</span></div>
                  <div>Reduced by: <span id="savedPercentValue" style="color: var(--accent); font-weight: 700;">0%</span></div>
                </div>
                <button id="downloadLink" class="btn btn-primary">Download</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    this.setupBaseListeners();
    const compressBtn = this.querySelector("#compressBtn") as HTMLButtonElement;
    const presetBtns = this.querySelectorAll(".preset-btn");
    const targetSizeInput = this.querySelector("#targetSize") as HTMLInputElement;

    presetBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        presetBtns.forEach((p) => {
          p.classList.remove("active");
        });
        (btn as HTMLElement).classList.add("active");
        this.updatePreset(btn as HTMLElement);
      });
    });

    targetSizeInput.addEventListener("input", () => {
      this.updateCompressionButtonState();
      this.checkWarning();
    });

    compressBtn.addEventListener("click", () => this.startCompression());

    // A re-render (for example after clearing storage) replaces the old
    // preview, so close its document first.
    void this.previewController?.destroy();
    this.previewController = this.createPreviewController();

    // Resume session bind
    const resumeBtn = this.querySelector("#resumeBtn") as HTMLButtonElement;
    if (resumeBtn) {
      resumeBtn.onclick = () => this.restoreSession();
    }

    // Check for existing session and show prompt if found
    this.checkExistingSession();
  }

  async checkExistingSession() {
    try {
      const savedFile = await persistence.get<File>(this.toolKey);
      if (savedFile) {
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
          resumeBtn.appendChild(
            document.createTextNode(
              `Resume ${savedFile.name} (${this.formatBytes(savedFile.size)})`,
            ),
          );
        }
      }
    } catch (err) {
      logger.error("Failed to check for existing session", err);
    }
  }

  async restoreSession() {
    try {
      const savedFile = await persistence.get<File>(this.toolKey);
      if (savedFile) {
        logger.info("Restoring compressor session", { name: savedFile.name });
        this.handleFiles([savedFile] as unknown as FileList);
      }
    } catch (err) {
      logger.error("Failed to restore compressor session", err);
    }
  }

  async saveSession() {
    try {
      if (this.selectedFile) {
        await persistence.set(this.toolKey, this.selectedFile);
        this.checkStorageUsage();
      }
    } catch (err) {
      logger.error("Failed to save compressor session", err);
    }
  }

  updatePreset(btn: HTMLElement) {
    const targetSizeGroup = this.querySelector("#targetSizeGroup") as HTMLElement;
    const estSizeInfo = this.querySelector("#estSizeInfo") as HTMLElement;

    if (btn.id === "customPresetBtn") {
      targetSizeGroup.classList.remove("hidden");
      estSizeInfo.classList.add("hidden");
      this.selectedRatio = null;
    } else {
      targetSizeGroup.classList.add("hidden");
      this.selectedRatio = parseFloat(btn.dataset.ratio as string);
      this.showPresetEstimate();
    }
    this.updateCompressionButtonState();
    this.checkWarning();
  }

  /** Fills the target size from the selected preset and shows it. */
  private showPresetEstimate() {
    if (!this.selectedFile || this.selectedRatio === null) return;

    const estKb = Math.round((this.selectedFile.size / 1024) * this.selectedRatio);
    (this.querySelector("#targetSize") as HTMLInputElement).value = String(estKb);
    (this.querySelector("#estSizeValue") as HTMLElement).textContent = this.formatBytes(
      estKb * 1024,
    );
    (this.querySelector("#estSizeInfo") as HTMLElement).classList.remove("hidden");
  }

  async handleFiles(files: FileList) {
    if (this.isCompressing) {
      await this.showBusyMessage("open another file");
      return;
    }
    const file = files[0];
    const isValid = await this.validateFile(file, {
      maxSizeMB: PdfCompressor.MAX_FILE_SIZE_MB,
      allowedTypes: ["application/pdf"],
    });
    if (!isValid) return;

    this.selectedFile = file;
    logger.info("File loaded for compression", { name: file.name, size: file.size });

    if (!this.previewController) {
      this.previewController = this.createPreviewController();
    }

    (this.querySelector("#fileName") as HTMLElement).textContent = this.selectedFile.name;
    (this.querySelector("#fileSize") as HTMLElement).textContent = this.formatBytes(
      this.selectedFile.size,
    );
    this.updateTargetSizeLimit();
    (this.querySelector("#fileInfo") as HTMLElement).classList.remove("hidden");
    (this.querySelector("#dropZone") as HTMLElement).classList.add("hidden");
    (this.querySelector("#mainLayout") as HTMLElement).classList.remove("hidden");

    this.saveSession();

    try {
      await this.previewController?.load(this.selectedFile);
    } catch (err) {
      logger.error("Preview load error", err);
      // Name the cause when it is known (password, damaged file, memory).
      this.showErrorDialog(mapError(err, getPdfPreviewErrorMessage("preview")));
    }

    this.showPresetEstimate();
    this.updateCompressionButtonState();
    this.checkWarning();
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

  async checkWarning() {
    const targetSizeInput = this.querySelector("#targetSize") as HTMLInputElement;
    const qualityWarning = this.querySelector("#qualityWarning") as HTMLElement;
    if (this.selectedFile && targetSizeInput.value) {
      const currentSizeKb = this.selectedFile.size / 1024;
      const targetSizeKb = parseFloat(targetSizeInput.value);
      let message = "";

      if (!Number.isFinite(targetSizeKb) || targetSizeKb <= 0)
        message = "Enter a valid target size.";
      else if (targetSizeKb >= currentSizeKb)
        message = "Enter a target smaller than the original file size.";
      else if (targetSizeKb < currentSizeKb * 0.1)
        message = "Target size is extremely low. Text might become illegible.";
      else if (targetSizeKb < currentSizeKb * 0.3)
        message = "Target size is low. Quality will be noticeably reduced.";

      if (message) {
        (qualityWarning.querySelector("span") as HTMLElement).textContent = message;
        qualityWarning.classList.remove("hidden");
      } else {
        qualityWarning.classList.add("hidden");
      }
    } else {
      qualityWarning.classList.add("hidden");
    }
  }

  private updateTargetSizeLimit() {
    const targetSizeInput = this.querySelector("#targetSize") as HTMLInputElement | null;
    if (!targetSizeInput || !this.selectedFile) return;

    targetSizeInput.max = String(Math.max(1, Math.floor(this.selectedFile.size / 1024)));
  }

  private getTargetSizeKb() {
    const targetSizeInput = this.querySelector("#targetSize") as HTMLInputElement;
    return parseFloat(targetSizeInput.value);
  }

  private isTargetSizeValid(targetSizeKb = this.getTargetSizeKb()) {
    if (!this.selectedFile) return false;
    if (!Number.isFinite(targetSizeKb) || targetSizeKb <= 0) return false;
    return targetSizeKb < this.selectedFile.size / 1024;
  }

  private updateCompressionButtonState() {
    const compressBtn = this.querySelector("#compressBtn") as HTMLButtonElement | null;
    if (!compressBtn) return;
    compressBtn.disabled = !this.isTargetSizeValid();
  }

  private getTargetRatio(targetSizeKb: number) {
    if (this.selectedRatio !== null) return this.selectedRatio;
    if (!this.selectedFile) return undefined;
    return Math.min(0.95, Math.max(0.01, targetSizeKb / (this.selectedFile.size / 1024)));
  }

  async startCompression() {
    const targetSizeInput = this.querySelector("#targetSize") as HTMLInputElement;
    const progressSection = this.querySelector("#progressSection") as HTMLElement;
    const compressBtn = this.querySelector("#compressBtn") as HTMLButtonElement;
    const targetSizeKb = parseFloat(targetSizeInput.value);

    const file = this.selectedFile;
    if (!file) {
      logger.warn("Start compression called without a selected file");
      return;
    }
    if (this.isCompressing) return;

    if (!this.isTargetSizeValid(targetSizeKb)) {
      this.updateCompressionButtonState();
      await this.checkWarning();
      return;
    }

    compressBtn.disabled = true;
    progressSection.classList.remove("hidden");
    this.isCompressing = true;

    logger.info("Starting PDF compression", { targetSizeKb });

    try {
      const compressedBytes = await compressPdf(
        file,
        targetSizeKb,
        (percent, status) => {
          this.updateProgress(percent, status);
        },
        {
          targetRatio: this.getTargetRatio(targetSizeKb),
          // Reuse the preview's copy of the file rather than loading it again.
          document: this.previewController?.document,
        },
      );

      const savedPercent = calculateSavingsPercent(file.size, compressedBytes.length);

      (this.querySelector("#finalSizeValue") as HTMLElement).textContent = this.formatBytes(
        compressedBytes.length,
      );
      (this.querySelector("#savedPercentValue") as HTMLElement).textContent = `${savedPercent}%`;

      const fileName = generateOutputFilename(file.name, "_compressed");
      await this.recordJob("Compress", fileName, compressedBytes, {
        originalSize: file.size,
        finalSize: compressedBytes.length,
        savedPercent: savedPercent,
      });

      this.showSuccess(compressedBytes, file.name, "_compressed");
      this.showSuccessDialog(`Compression complete! Your file was reduced by ${savedPercent}%.`);
    } catch (error) {
      logger.error("Compression error", error);
      this.showErrorDialog(describeFailure("Compression failed.", error));
    } finally {
      this.isCompressing = false;
      compressBtn.disabled = false;
    }
  }
}

customElements.define("pdf-compressor", PdfCompressor);
