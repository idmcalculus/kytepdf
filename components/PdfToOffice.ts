import { logger } from "../utils/logger.ts";
import { cloudConversionService, type ConversionFormat } from "../utils/CloudConversionService.ts";
import { persistence } from "../utils/persistence.ts";
import { generateOutputFilename } from "../utils/pdfUtils.ts";
import { BaseComponent } from "./BaseComponent.ts";

export class PdfToOffice extends BaseComponent {
  protected toolKey = "pdf-to-office";
  private targetFormat: ConversionFormat = "docx";
  private ocrEnabled = false;

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
      case "docx": return "Word";
      case "pptx": return "PowerPoint";
      case "xlsx": return "Excel (Sheets)";
      default: return this.targetFormat.toUpperCase();
    }
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
             <div class="preview-container" style="display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.2); border-radius: 1rem; min-height: 300px;">
                <div style="text-align: center; color: var(--text-muted);">
                  <i data-lucide="file-text" style="width: 64px; height: 64px; margin-bottom: 1rem; opacity: 0.5;"></i>
                  <p>Ready to convert to ${this.formatLabel}</p>
                </div>
             </div>
          </div>

          <div class="layout-right">
            <div class="controls">
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
                  Start Cloud Conversion
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

    ocrToggle.onchange = () => {
      this.ocrEnabled = ocrToggle.checked;
    };

    convertBtn.onclick = () => this.handleConvert();

    this.checkExistingSession();
  }

  async handleFiles(files: FileList) {
    const file = files[0];
    if (!this.validateFile(file)) return;

    this.selectedFile = file;
    await persistence.set(this.toolKey, file);

    (this.querySelector("#fileName") as HTMLElement).textContent = file.name;
    (this.querySelector("#fileSize") as HTMLElement).textContent = this.formatBytes(file.size);
    (this.querySelector("#fileInfo") as HTMLElement).classList.remove("hidden");
    (this.querySelector("#dropZone") as HTMLElement).classList.add("hidden");
    (this.querySelector("#mainLayout") as HTMLElement).classList.remove("hidden");
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
      this.handleFiles([saved] as unknown as FileList);
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
      this.updateProgress(20, "Uploading to secure cloud...");

      const resultBytes = await cloudConversionService.convertFile(
        this.selectedFile,
        this.targetFormat,
        { ocr: this.ocrEnabled }
      );

      this.updateProgress(100, "Conversion complete!");
      
      const ext = `.${this.targetFormat}`;
      const outputName = generateOutputFilename(this.selectedFile.name, "_converted", ext);

      this.showSuccess(resultBytes, outputName, "", ext);
      this.showSuccessDialog(`Your ${this.formatLabel} file is ready.`);

      await this.recordJob(`PDF to ${this.formatLabel}`, outputName, resultBytes, {
        ocr: this.ocrEnabled,
        format: this.targetFormat
      });

    } catch (err: any) {
      logger.error("Cloud conversion failed", err);
      this.showErrorDialog(`Conversion failed: ${err.message}`);
    } finally {
      convertBtn.disabled = false;
      progressSection.classList.add("hidden");
    }
  }
}

customElements.define("pdf-to-office", PdfToOffice);
