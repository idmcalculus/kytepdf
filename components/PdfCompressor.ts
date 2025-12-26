import { logger } from "../utils/logger.ts";
import { pdfjsLib } from "../utils/pdfConfig.ts";
import { compressPdf } from "../utils/pdfEngine.ts";
import { persistence } from "../utils/persistence.ts";
import { calculateSavingsPercent, generateOutputFilename } from "../utils/pdfUtils.ts";
import { BaseComponent } from "./BaseComponent.ts";

export class PdfCompressor extends BaseComponent {
  private selectedRatio: number | null = 0.4;
  protected toolKey = "pdf-compressor";

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
      compressBtn.disabled = !this.selectedFile || !targetSizeInput.value;
      this.checkWarning();
    });

    compressBtn.addEventListener("click", () => this.startCompression());
    (this.querySelector("#prevPage") as HTMLElement).addEventListener("click", () =>
      this.changePage(-1),
    );
    (this.querySelector("#nextPage") as HTMLElement).addEventListener("click", () =>
      this.changePage(1),
    );

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
          resumeBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
            Resume ${savedFile.name} (${this.formatBytes(savedFile.size)})
          `;
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
    const estSizeValue = this.querySelector("#estSizeValue") as HTMLElement;
    const targetSizeInput = this.querySelector("#targetSize") as HTMLInputElement;

    if (btn.id === "customPresetBtn") {
      targetSizeGroup.classList.remove("hidden");
      estSizeInfo.classList.add("hidden");
      this.selectedRatio = null;
    } else {
      targetSizeGroup.classList.add("hidden");
      this.selectedRatio = parseFloat(btn.dataset.ratio as string);
      if (this.selectedFile) {
        const estKb = Math.round((this.selectedFile.size / 1024) * this.selectedRatio);
        targetSizeInput.value = String(estKb);
        estSizeValue.textContent = `${estKb} KB`;
        estSizeInfo.classList.remove("hidden");
      }
    }
    this.checkWarning();
  }

  async handleFiles(files: FileList) {
    const file = files[0];
    if (!this.validateFile(file)) return;

    this.selectedFile = file;
    logger.info("File loaded for compression", { name: file.name, size: file.size });

    (this.querySelector("#fileName") as HTMLElement).textContent = this.selectedFile.name;
    (this.querySelector("#fileSize") as HTMLElement).textContent = this.formatBytes(
      this.selectedFile.size,
    );
    (this.querySelector("#fileInfo") as HTMLElement).classList.remove("hidden");
    (this.querySelector("#dropZone") as HTMLElement).classList.add("hidden");
    (this.querySelector("#mainLayout") as HTMLElement).classList.remove("hidden");

    this.saveSession();

    try {
      const arrayBuffer = await this.selectedFile.arrayBuffer();
      this.currentPdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      this.currentPageNum = 1;
      await this.renderPage(this.currentPageNum);
    } catch (err) {
      logger.error("Preview load error", err);
      this.showErrorDialog(
        "Could not load PDF preview. The file might be corrupted, protected, or too complex for the browser.",
      );
    }

    if (this.selectedRatio !== null) {
      const estKb = Math.round((this.selectedFile.size / 1024) * this.selectedRatio);
      (this.querySelector("#targetSize") as HTMLInputElement).value = String(estKb);
      (this.querySelector("#estSizeValue") as HTMLElement).textContent = `${estKb} KB`;
      (this.querySelector("#estSizeInfo") as HTMLElement).classList.remove("hidden");
    }

    (this.querySelector("#compressBtn") as HTMLButtonElement).disabled = !(
      this.querySelector("#targetSize") as HTMLInputElement
    ).value;
    this.checkWarning();
  }

  async renderPage(pageNum: number) {
    if (!this.currentPdfDoc) return;
    const page = await this.currentPdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 0.8 });
    const canvas = this.querySelector("#previewCanvas") as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvasContext: context as any, viewport, canvas }).promise;
    (this.querySelector("#pageIndicator") as HTMLElement).textContent =
      `Page ${pageNum} of ${this.currentPdfDoc.numPages}`;

    (this.querySelector("#prevPage") as HTMLButtonElement).disabled = pageNum <= 1;
    (this.querySelector("#nextPage") as HTMLButtonElement).disabled =
      pageNum >= this.currentPdfDoc.numPages;
  }

  changePage(offset: number) {
    if (!this.currentPdfDoc) return;
    const newPage = this.currentPageNum + offset;
    if (newPage >= 1 && newPage <= this.currentPdfDoc.numPages) {
      this.currentPageNum = newPage;
      this.renderPage(this.currentPageNum);
    }
  }

  async checkWarning() {
    const targetSizeInput = this.querySelector("#targetSize") as HTMLInputElement;
    const qualityWarning = this.querySelector("#qualityWarning") as HTMLElement;
    if (this.selectedFile && targetSizeInput.value) {
      const currentSizeKb = this.selectedFile.size / 1024;
      const targetSizeKb = parseFloat(targetSizeInput.value);
      let message = "";
      if (targetSizeKb < currentSizeKb * 0.1)
        message = "Target size is extremely low. Text might become illegible.";
      else if (targetSizeKb < currentSizeKb * 0.3)
        message = "Target size is low. Quality will be noticeably reduced.";

      if (message) {
        (qualityWarning.querySelector("span") as HTMLElement).textContent = message;
        qualityWarning.classList.remove("hidden");
      } else {
        qualityWarning.classList.add("hidden");
      }
    }
  }

  async startCompression() {
    const targetSizeInput = this.querySelector("#targetSize") as HTMLInputElement;
    const progressSection = this.querySelector("#progressSection") as HTMLElement;
    const compressBtn = this.querySelector("#compressBtn") as HTMLButtonElement;
    const targetSizeKb = parseFloat(targetSizeInput.value);

    if (!this.selectedFile) {
      logger.warn("Start compression called without a selected file");
      return;
    }

    compressBtn.disabled = true;
    progressSection.classList.remove("hidden");

    logger.info("Starting PDF compression", { targetSizeKb });

    try {
      const compressedBytes = await compressPdf(
        this.selectedFile,
        targetSizeKb,
        (percent, status) => {
          this.updateProgress(percent, status);
        },
      );

      if (!compressedBytes) throw new Error("Compression failed to produce output");

      const finalSizeKb = compressedBytes.length / 1024;
      const originalSizeKb = this.selectedFile.size / 1024;
      const savedPercent = calculateSavingsPercent(this.selectedFile.size, compressedBytes.length);

      (this.querySelector("#finalSizeValue") as HTMLElement).textContent =
        `${finalSizeKb.toFixed(1)} KB`;
      (this.querySelector("#savedPercentValue") as HTMLElement).textContent = `${savedPercent}%`;

      const fileName = generateOutputFilename(this.selectedFile.name, "_compressed");
      await this.recordJob("Compress", fileName, compressedBytes, {
        originalSize: this.selectedFile.size,
        finalSize: compressedBytes.length,
        savedPercent: savedPercent,
      });

      this.showSuccess(compressedBytes, this.selectedFile.name, "_compressed");
      this.showSuccessDialog(`Compression complete! Your file was reduced by ${savedPercent}%.`);
    } catch (error: any) {
      logger.error("Compression error", error);
      this.showErrorDialog(`An error occurred during compression. ${error.message}`);
    } finally {
      compressBtn.disabled = false;
    }
  }
}

customElements.define("pdf-compressor", PdfCompressor);
