import { logger } from "../utils/logger.ts";
import { convertImagesToPdf } from "../utils/pdfEngine.ts";
import { moveArrayItem, swapArrayItems } from "../utils/pdfUtils.ts";
import { persistence } from "../utils/persistence.ts";
import { BaseComponent } from "./BaseComponent.ts";

export class ImageToPdf extends BaseComponent {
  protected files: File[] = [];
  protected toolKey = "image-to-pdf";

  render() {
    this.innerHTML = `
      <div class="tool-view">
        ${this.getBackButton()}

        <h1>Image to PDF</h1>
        <p class="subtitle">Convert one or more images into a single PDF document.</p>

        ${this.getDropZone("your images (JPG, PNG)", "plus-square", true)}

        <div id="fileListContainer" class="hidden" style="margin-top: 2rem;">
          <div class="file-list-header">
            <h3>Selected Images</h3>
            <button id="addMoreBtn" class="btn btn-secondary btn-sm">
               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
               Add More
            </button>
          </div>
          <div id="fileList" class="file-list"></div>
          
          <div class="actions-row">
             <button id="convertBtn" class="btn btn-primary">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                Create PDF
             </button>
          </div>
        </div>

        ${this.getProgressSection("Converting...")}

        <div id="successMessage" class="success-message hidden" style="margin-top: 2rem;">
          <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">🎉 PDF Created!</p>
          <div id="statsInfo" style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.6;">
            Your images have been successfully converted into a PDF.
          </div>
          <button id="downloadLink" class="btn btn-primary">Download PDF</button>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    this.setupBaseListeners();
    // Override the click listener for drop zone to accept images
    const fileInput = this.querySelector("#fileInput") as HTMLInputElement;
    fileInput.accept = "image/png,image/jpeg";

    const convertBtn = this.querySelector("#convertBtn") as HTMLButtonElement;
    const addMoreBtn = this.querySelector("#addMoreBtn") as HTMLButtonElement;

    addMoreBtn.addEventListener("click", () => fileInput.click());
    convertBtn.addEventListener("click", () => this.startConversion());

    const resumeBtn = this.querySelector("#resumeBtn") as HTMLButtonElement;
    if (resumeBtn) {
      resumeBtn.onclick = () => this.restoreSession();
    }

    this.checkExistingSession();
  }

  async checkExistingSession() {
    try {
      const saved = await persistence.get<File[]>(this.toolKey);
      if (saved && saved.length > 0) {
        const resumeContainer = this.querySelector("#resumeContainer");
        const resumeBtn = this.querySelector("#resumeBtn");
        if (resumeContainer && resumeBtn) {
          resumeContainer.classList.remove("hidden");
          resumeBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
            Resume ${saved.length} images
          `;
        }
      }
    } catch (err) {
      logger.error("Failed to check for existing session", err);
    }
  }

  async restoreSession() {
    try {
      const saved = await persistence.get<File[]>(this.toolKey);
      if (saved && saved.length > 0) {
        logger.info("Restoring image-to-pdf session", { count: saved.length });
        this.files = saved;
        this.updateFileList();
        (this.querySelector("#dropZone") as HTMLElement).classList.add("hidden");
        (this.querySelector("#fileListContainer") as HTMLElement).classList.remove("hidden");
        this.checkStorageUsage();
      }
    } catch (err) {
      logger.error("Failed to restore session", err);
    }
  }

  async saveSession() {
    try {
      await persistence.set(this.toolKey, this.files);
      this.checkStorageUsage();
    } catch (err) {
      logger.error("Failed to save session", err);
    }
  }

  handleFiles(newFiles: FileList) {
    const validFiles = Array.from(newFiles).filter((file) =>
      this.validateFile(file, { allowedTypes: ["image/png", "image/jpeg"] }),
    );

    if (validFiles.length > 0) {
      this.files = [...this.files, ...validFiles];
      logger.info("Images added for conversion", {
        count: validFiles.length,
        total: this.files.length,
      });
      this.updateFileList();
      (this.querySelector("#dropZone") as HTMLElement).classList.add("hidden");
      (this.querySelector("#fileListContainer") as HTMLElement).classList.remove("hidden");
      this.saveSession();
    }
  }

  updateFileList() {
    const fileList = this.querySelector("#fileList") as HTMLElement;
    fileList.innerHTML = "";

    this.files.forEach((file, index) => {
      const item = document.createElement("div");
      item.className = "file-list-item";
      item.draggable = true;
      item.dataset.index = String(index);
      item.innerHTML = `
        <div class="drag-handle">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
        </div>
        <div class="file-item-details">
          <span class="file-name" title="${file.name}">${file.name}</span>
          <span class="file-size">${this.formatBytes(file.size)}</span>
        </div>
        <div class="file-item-actions">
          <button class="action-btn move-up" ${index === 0 ? "disabled" : ""} data-index="${index}">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
          </button>
          <button class="action-btn move-down" ${index === this.files.length - 1 ? "disabled" : ""} data-index="${index}">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <button class="action-btn remove" data-index="${index}">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      `;

      item.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData("text/plain", String(index));
        item.classList.add("dragging");
      });

      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        item.classList.add("drag-over");
      });

      item.addEventListener("dragleave", () => item.classList.remove("drag-over"));

      item.addEventListener("drop", (e) => {
        e.preventDefault();
        item.classList.remove("drag-over");
        const fromIndex = parseInt(e.dataTransfer?.getData("text/plain") || "0", 10);
        const toIndex = parseInt(item.dataset.index || "0", 10);
        if (fromIndex !== toIndex) this.swapFiles(fromIndex, toIndex);
      });

      item.addEventListener("dragend", () => item.classList.remove("dragging"));

      fileList.appendChild(item);
    });

    fileList.querySelectorAll<HTMLElement>(".move-up").forEach((btn) => {
      btn.onclick = () => this.moveFile(parseInt(btn.dataset.index!, 10), -1);
    });
    fileList.querySelectorAll<HTMLElement>(".move-down").forEach((btn) => {
      btn.onclick = () => this.moveFile(parseInt(btn.dataset.index!, 10), 1);
    });
    fileList.querySelectorAll<HTMLElement>(".remove").forEach((btn) => {
      btn.onclick = () => this.removeFile(parseInt(btn.dataset.index!, 10));
    });
    (this.querySelector("#convertBtn") as HTMLButtonElement).disabled = this.files.length === 0;
  }

  swapFiles(fromIndex: number, toIndex: number) {
    this.files = swapArrayItems(this.files, fromIndex, toIndex);
    this.updateFileList();
    this.saveSession();
  }

  moveFile(index: number, direction: number) {
    const moved = moveArrayItem(this.files, index, direction);
    if (moved !== this.files) {
      this.files = moved;
      this.updateFileList();
      this.saveSession();
    }
  }

  removeFile(index: number) {
    this.files.splice(index, 1);
    if (this.files.length === 0) {
      (this.querySelector("#dropZone") as HTMLElement).classList.remove("hidden");
      (this.querySelector("#fileListContainer") as HTMLElement).classList.add("hidden");
      persistence.delete(this.toolKey);
      this.checkStorageUsage();
    } else {
      this.updateFileList();
      this.saveSession();
    }
  }

  async startConversion() {
    const convertBtn = this.querySelector("#convertBtn") as HTMLButtonElement;
    const progressSection = this.querySelector("#progressSection") as HTMLElement;

    if (this.files.length === 0) return;

    logger.info("Starting image-to-pdf conversion", { fileCount: this.files.length });

    try {
      convertBtn.disabled = true;
      progressSection.classList.remove("hidden");
      this.updateProgress(10, "Initializing PDF...");

      const pdfBytes = await convertImagesToPdf(this.files);

      this.updateProgress(100, "Done!");

      const fileName = "converted_images.pdf";
      await this.recordJob("Image to PDF", fileName, pdfBytes, {
        imageCount: this.files.length,
      });

      this.showSuccess(pdfBytes, fileName, "");
      this.showSuccessDialog("Images have been successfully converted into a PDF.");
    } catch (error: any) {
      logger.error("Conversion error", error);
      this.showErrorDialog("Failed to convert images to PDF.");
    } finally {
      convertBtn.disabled = false;
    }
  }
}

customElements.define("image-to-pdf", ImageToPdf);
