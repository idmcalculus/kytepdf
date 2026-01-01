import { cloudConversionService } from "../utils/CloudConversionService.ts";
import { logger } from "../utils/logger.ts";
import { generateOutputFilename } from "../utils/pdfUtils.ts";
import { persistence } from "../utils/persistence.ts";
import { BaseComponent } from "./BaseComponent.ts";

export class OfficeToPdf extends BaseComponent {
  protected toolKey = "office-to-pdf";

  render() {
    this.innerHTML = `
      <div class="tool-view">
        ${this.getBackButton()}

        <h1>Office to PDF</h1>
        <p class="subtitle">Convert Word, PowerPoint, or Excel files into professional PDFs.</p>

        ${this.getDropZone(`your Office file (DOCX, PPTX, XLSX)`, "file-up")}

        <div id="fileInfo" class="file-list-item hidden" style="margin-bottom: 2rem; cursor: default;">
          <div class="file-item-details">
            <span id="fileName" class="file-name">document.docx</span>
            <span id="fileSize" class="file-size">0 MB</span>
          </div>
        </div>

        <div id="mainLayout" class="layout-grid hidden">
          <div class="layout-left">
             <div class="preview-container" style="display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.2); border-radius: 1rem; min-height: 300px;">
                <div style="text-align: center; color: var(--text-muted);">
                  <i data-lucide="file-up" style="width: 64px; height: 64px; margin-bottom: 1rem; opacity: 0.5;"></i>
                  <p>Ready to convert to PDF</p>
                </div>
             </div>
          </div>

          <div class="layout-right">
            <div class="controls">
              <div class="actions-row">
                <button id="convertBtn" class="btn btn-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a3.5 3.5 0 0 0 .5-6.91V11a5 5 0 0 0-10 0v1.09a3.5 3.5 0 0 0 .5 6.91Z"/><path d="M12 13v4"/><path d="m10 15 2 2 2-2"/></svg>
                  Convert to PDF
                </button>
              </div>

              ${this.getProgressSection("Uploading to cloud...")}

              <div id="successMessage" class="success-message hidden">
                <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">🎉 Conversion Complete!</p>
                <button id="downloadLink" class="btn btn-primary">Download PDF</button>
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
    const fileInput = this.querySelector("#fileInput") as HTMLInputElement;
    fileInput.accept = ".docx,.doc,.pptx,.ppt,.xlsx,.xls";

    const convertBtn = this.querySelector("#convertBtn") as HTMLButtonElement;
    convertBtn.onclick = () => this.handleConvert();

    this.checkExistingSession();
  }

  async handleFiles(files: FileList) {
    const file = files[0];
    // Custom validation for Office types
    const allowed = [".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls"];
    const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;

    if (!allowed.includes(ext)) {
      this.showErrorDialog(`Invalid file type: ${ext}. Supported formats: Word, PPT, Excel.`);
      return;
    }

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
      this.updateProgress(20, "Sending to secure cloud...");

      const resultBytes = await cloudConversionService.convertFile(this.selectedFile, "pdf");

      this.updateProgress(100, "PDF created!");

      const outputName = generateOutputFilename(this.selectedFile.name, "_converted", ".pdf");

      this.showSuccess(resultBytes, outputName, "", ".pdf");
      this.showSuccessDialog(`Your PDF document is ready.`);

      await this.recordJob(`Office to PDF`, outputName, resultBytes, {
        originalFormat: this.selectedFile.name.split(".").pop(),
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

customElements.define("office-to-pdf", OfficeToPdf);
