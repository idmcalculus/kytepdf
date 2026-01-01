import { logger } from "../utils/logger.ts";
import { PDFDocument, pdfjsLib } from "../utils/pdfConfig.ts";
import { formatSelectionInfo } from "../utils/pdfUtils.ts";
import { persistence } from "../utils/persistence.ts";
import { BaseComponent } from "./BaseComponent.ts";

export class PdfSplit extends BaseComponent {
  private selectedPages: Set<number> = new Set();

  render() {
    this.innerHTML = `
      <div class="tool-view">
        ${this.getBackButton()}

        <h1>Split PDF</h1>
        <p class="subtitle">Extract specific pages or ranges from your PDF.</p>

        ${this.getDropZone("your PDF", "scissors")}

        <div id="splitControls" class="hidden" style="margin-top: 2rem;">
          <div class="file-list-header">
            <div id="fileNameContainer" class="file-name-chip">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
              <h3 id="fileNameLabel" style="margin-bottom: 0; font-size: 1rem;">Selected File</h3>
            </div>
            <div class="header-actions">
               <button id="selectAllBtn" class="btn btn-secondary btn-sm">Select All</button>
               <button id="clearSelectionBtn" class="btn btn-secondary btn-sm">Clear</button>
            </div>
          </div>
          
          <div id="pageGrid" class="page-grid"></div>

          <div class="actions-row">
             <span id="selectionInfo" style="color: var(--text-muted); font-size: 0.9rem;">0 pages selected</span>
             <button id="splitBtn" class="btn btn-primary" style="min-width: 180px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h4V6"/><path d="M21 14h-4v4"/><path d="M3 14h4v4"/><path d="M21 10h-4V6"/><path d="M14 3v4h4"/><path d="M10 21v-4H6"/><path d="M10 3v4H6"/><path d="M14 21v-4h4"/></svg>
                Extract Pages
             </button>
          </div>
        </div>

        ${this.getProgressSection("Extracting...")}

        <div id="successMessage" class="success-message hidden" style="margin-top: 2rem;">
          <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">🎉 Extraction Complete!</p>
          <div id="statsInfo" style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.6;">
            The selected pages have been saved to a new file.
          </div>
          <button id="downloadLink" class="btn btn-primary">Download New PDF</button>
        </div>
      </div>
    `;
  }

  protected toolKey = "pdf-split";

  setupEventListeners() {
    this.setupBaseListeners();
    const splitBtn = this.querySelector("#splitBtn") as HTMLButtonElement;
    const selectAllBtn = this.querySelector("#selectAllBtn") as HTMLButtonElement;
    const clearSelectionBtn = this.querySelector("#clearSelectionBtn") as HTMLButtonElement;

    selectAllBtn.addEventListener("click", () => this.selectAll());
    clearSelectionBtn.addEventListener("click", () => this.clearSelection());
    splitBtn.addEventListener("click", () => this.startSplit());

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
        logger.info("Restoring split session", { name: savedFile.name });
        this.handleFiles([savedFile] as unknown as FileList);
      }
    } catch (err) {
      logger.error("Failed to restore split session", err);
    }
  }

  async saveSession() {
    try {
      if (this.selectedFile) {
        await persistence.set("pdf-split", this.selectedFile);
        this.checkStorageUsage();
      }
    } catch (err) {
      logger.error("Failed to save split session", err);
    }
  }

  async handleFiles(files: FileList) {
    const file = files[0];
    if (!this.validateFile(file)) return;

    try {
      this.selectedFile = file;
      logger.info("File loaded for splitting", { name: file.name, size: file.size });

      (this.querySelector("#fileNameLabel") as HTMLElement).textContent = file.name;
      (this.querySelector("#dropZone") as HTMLElement).classList.add("hidden");
      (this.querySelector("#splitControls") as HTMLElement).classList.remove("hidden");

      this.saveSession();

      const arrayBuffer = await file.arrayBuffer();
      this.currentPdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      this.selectedPages.clear();
      this.renderPageGrid();
    } catch (err) {
      logger.error("Split load error", err);
      this.showErrorDialog(
        "Could not load PDF. Please ensure it's a valid PDF file and not password protected.",
      );
    }
  }

  async renderPageGrid() {
    const pageGrid = this.querySelector("#pageGrid") as HTMLElement;
    pageGrid.innerHTML = "";
    const numPages = this.currentPdfDoc.numPages;

    for (let i = 1; i <= numPages; i++) {
      const pageWrapper = document.createElement("div");
      pageWrapper.className = "page-item";
      pageWrapper.dataset.pageNum = String(i - 1);
      pageWrapper.innerHTML = `
        <canvas id="page-canvas-${i}"></canvas>
        <div class="page-number">${i}</div>
        <div class="selection-badge">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
      `;
      pageGrid.appendChild(pageWrapper);

      pageWrapper.addEventListener("click", () => this.togglePage(i - 1, pageWrapper));
      this.renderThumbnail(i, `page-canvas-${i}`);
    }
    this.updateSelectionInfo();
  }

  async renderThumbnail(pageNum: number, canvasId: string) {
    if (!this.currentPdfDoc) return;
    const page = await this.currentPdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 0.3 });
    const canvas = this.querySelector(`#${canvasId}`) as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvasContext: context as any, viewport, canvas }).promise;
  }

  togglePage(pageNum: number, element: HTMLElement) {
    if (this.selectedPages.has(pageNum)) {
      this.selectedPages.delete(pageNum);
      element.classList.remove("selected");
    } else {
      this.selectedPages.add(pageNum);
      element.classList.add("selected");
    }
    this.updateSelectionInfo();
  }

  selectAll() {
    if (!this.currentPdfDoc) return;
    const numPages = this.currentPdfDoc.numPages;
    for (let i = 0; i < numPages; i++) {
      this.selectedPages.add(i);
    }
    this.querySelectorAll(".page-item").forEach((el) => {
      el.classList.add("selected");
    });
    this.updateSelectionInfo();
  }

  clearSelection() {
    this.selectedPages.clear();
    this.querySelectorAll(".page-item").forEach((el) => {
      el.classList.remove("selected");
    });
    this.updateSelectionInfo();
  }

  updateSelectionInfo() {
    const count = this.selectedPages.size;
    (this.querySelector("#selectionInfo") as HTMLElement).textContent = formatSelectionInfo(count);
    (this.querySelector("#splitBtn") as HTMLButtonElement).disabled = count === 0;
  }

  async startSplit() {
    const splitBtn = this.querySelector("#splitBtn") as HTMLButtonElement;
    const progressSection = this.querySelector("#progressSection") as HTMLElement;

    if (!this.selectedFile || this.selectedPages.size === 0) {
      logger.warn("Start split called without a file or selected pages");
      return;
    }

    logger.info("Starting PDF split/extraction", { selectedPages: this.selectedPages.size });

    try {
      splitBtn.disabled = true;
      progressSection.classList.remove("hidden");
      const arrayBuffer = await this.selectedFile.arrayBuffer();
      const originalPdf = await PDFDocument.load(arrayBuffer);
      const newPdf = await PDFDocument.create();

      const pagesToExtract = Array.from(this.selectedPages).sort((a, b) => a - b);
      this.updateProgress(10, "Starting extraction...");

      const copiedPages = await newPdf.copyPages(originalPdf, pagesToExtract);

      for (let i = 0; i < copiedPages.length; i++) {
        newPdf.addPage(copiedPages[i]);
        const percent = 10 + Math.round(((i + 1) / copiedPages.length) * 80);
        this.updateProgress(percent, `Processing page ${i + 1} of ${copiedPages.length}...`);
      }

      this.updateProgress(100, "Finalizing...");
      const newPdfBytes = await newPdf.save();

      const fileName = this.selectedFile.name.replace(".pdf", "_extracted.pdf");
      await this.recordJob("Split", fileName, newPdfBytes, {
        pagesExtracted: pagesToExtract.length,
      });

      this.showSuccess(newPdfBytes, this.selectedFile.name, "_split");
      this.showSuccessDialog(`Successfully extracted ${pagesToExtract.length} pages.`);
    } catch (error: any) {
      logger.error("Split error", error);
      this.showErrorDialog(`Failed to extract pages. ${error.message}`);
    } finally {
      splitBtn.disabled = false;
    }
  }
}

customElements.define("pdf-split", PdfSplit);
