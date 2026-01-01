import { logger } from "../utils/logger.ts";
import { PDFDocument } from "../utils/pdfConfig.ts";
import { moveArrayItem, swapArrayItems } from "../utils/pdfUtils.ts";
import { persistence } from "../utils/persistence.ts";
import { BaseComponent } from "./BaseComponent.ts";

export class PdfMerge extends BaseComponent {
  protected files: File[] = [];

  render() {
    this.innerHTML = `
      <div class="tool-view">
        ${this.getBackButton()}

        <h1>Merge PDF</h1>
        <p class="subtitle">Combine multiple PDF files into one document.</p>

        ${this.getDropZone("your PDFs", "plus-square", true)}

        <div id="fileListContainer" class="hidden" style="margin-top: 2rem;">
          <div class="file-list-header">
            <h3>Selected Files</h3>
            <button id="addMoreBtn" class="btn btn-secondary btn-sm">
               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
               Add More
            </button>
          </div>
          <div id="fileList" class="file-list"></div>
          
          <div class="actions-row">
             <button id="mergeBtn" class="btn btn-primary">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 12H9m12 0-9 9-9-9"/><path d="M12 3v18"/></svg>
                Merge PDFs
             </button>
          </div>
        </div>

        ${this.getProgressSection("Merging...")}

        <div id="successMessage" class="success-message hidden" style="margin-top: 2rem;">
          <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">🎉 Merge Complete!</p>
          <div id="statsInfo" style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.6;">
            Your files have been successfully merged.
          </div>
          <button id="downloadLink" class="btn btn-primary">Download Merged PDF</button>
        </div>
      </div>
    `;
  }

  protected toolKey = "pdf-merge";

  setupEventListeners() {
    this.setupBaseListeners();
    const mergeBtn = this.querySelector("#mergeBtn") as HTMLButtonElement;
    const addMoreBtn = this.querySelector("#addMoreBtn") as HTMLButtonElement;
    const fileInput = this.querySelector("#fileInput") as HTMLInputElement;

    addMoreBtn.addEventListener("click", () => fileInput.click());
    mergeBtn.addEventListener("click", () => this.startMerge());

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
      const saved = await persistence.get<File[]>(this.toolKey);
      if (saved && saved.length > 0) {
        const resumeContainer = this.querySelector("#resumeContainer");
        const resumeBtn = this.querySelector("#resumeBtn");
        if (resumeContainer && resumeBtn) {
          resumeContainer.classList.remove("hidden");
          resumeBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
            Resume ${saved.length} files
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
        logger.info("Restoring merge session", { count: saved.length });
        this.files = saved;
        this.updateFileList();
        (this.querySelector("#dropZone") as HTMLElement).classList.add("hidden");
        (this.querySelector("#fileListContainer") as HTMLElement).classList.remove("hidden");
        this.checkStorageUsage(); // Update usage display
      }
    } catch (err) {
      logger.error("Failed to restore session", err);
    }
  }

  async saveSession() {
    try {
      // Files in IndexedDB can be stored as File/Blob objects directly
      await persistence.set("pdf-merge", this.files);
      this.checkStorageUsage();
    } catch (err) {
      logger.error("Failed to save session", err);
    }
  }

  handleFiles(newFiles: FileList) {
    const validFiles = Array.from(newFiles).filter((file) => this.validateFile(file));

    if (validFiles.length > 0) {
      this.files = [...this.files, ...validFiles];
      logger.info("Files added for merging", {
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

      // Desktop Drag & Drop
      item.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData("text/plain", String(index));
        item.classList.add("dragging");
      });

      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        item.classList.add("drag-over");
      });

      item.addEventListener("dragleave", () => {
        item.classList.remove("drag-over");
      });

      item.addEventListener("drop", (e) => {
        e.preventDefault();
        item.classList.remove("drag-over");
        const fromIndex = parseInt(e.dataTransfer?.getData("text/plain") || "0", 10);
        const toIndex = parseInt(item.dataset.index || "0", 10);

        if (fromIndex !== toIndex) {
          this.swapFiles(fromIndex, toIndex);
        }
      });

      item.addEventListener("dragend", () => {
        item.classList.remove("dragging");
      });

      item.addEventListener(
        "touchstart",
        (e) => {
          if ((e.target as HTMLElement).closest(".drag-handle")) {
            item.classList.add("dragging");
          }
        },
        { passive: false },
      );

      item.addEventListener(
        "touchmove",
        (e) => {
          if (!item.classList.contains("dragging")) return;
          e.preventDefault();

          const touch = e.touches[0];
          const target = document.elementFromPoint(touch.clientX, touch.clientY);
          const dropItem = target?.closest(".file-list-item") as HTMLElement | null;

          // Remove previous indicators
          fileList.querySelectorAll(".file-list-item").forEach((el) => {
            el.classList.remove("drag-over");
          });

          if (dropItem && dropItem !== item) {
            dropItem.classList.add("drag-over");
          }
        },
        { passive: false },
      );

      item.addEventListener("touchend", (e) => {
        if (!item.classList.contains("dragging")) return;
        item.classList.remove("dragging");

        const touch = e.changedTouches[0];
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        const dropItem = target?.closest(".file-list-item") as HTMLElement | null;

        fileList.querySelectorAll(".file-list-item").forEach((el) => {
          el.classList.remove("drag-over");
        });

        if (dropItem && dropItem !== item) {
          const fromIndex = parseInt(item.dataset.index || "0", 10);
          const toIndex = parseInt(dropItem.dataset.index || "0", 10);
          this.swapFiles(fromIndex, toIndex);
        }
      });

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
    (this.querySelector("#mergeBtn") as HTMLButtonElement).disabled = this.files.length < 2;
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
      persistence.delete("pdf-merge");
      this.checkStorageUsage();
    } else {
      this.updateFileList();
      this.saveSession();
    }
  }

  async startMerge() {
    const mergeBtn = this.querySelector("#mergeBtn") as HTMLButtonElement;
    const progressSection = this.querySelector("#progressSection") as HTMLElement;

    if (this.files.length < 2) {
      logger.warn("Start merge called with fewer than 2 files");
      return;
    }

    logger.info("Starting PDF merge", { fileCount: this.files.length });

    try {
      mergeBtn.disabled = true;
      progressSection.classList.remove("hidden");
      const mergedPdf = await PDFDocument.create();

      for (let i = 0; i < this.files.length; i++) {
        const file = this.files[i];
        const percent = Math.round(((i + 1) / this.files.length) * 100);
        this.updateProgress(percent, `Processing: ${file.name}...`);

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await PDFDocument.load(arrayBuffer);
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        copiedPages.forEach((page) => {
          mergedPdf.addPage(page);
        });
      }

      this.updateProgress(100, "Finalizing...");
      const mergedPdfBytes = await mergedPdf.save();
      const totalPages = mergedPdf.getPageCount();

      await this.recordJob("Merge", "merged_document.pdf", mergedPdfBytes, {
        fileCount: this.files.length,
        pageCount: totalPages,
      });
      this.showSuccess(mergedPdfBytes, "merged_document.pdf", "");
      this.showSuccessDialog("All files have been merged successfully into a single document.");
    } catch (error: any) {
      logger.error("Merge error", error);
      this.showErrorDialog(
        "Failed to merge PDFs. Please ensure all files are valid and not password protected.",
      );
    } finally {
      mergeBtn.disabled = false;
    }
  }
}

customElements.define("pdf-merge", PdfMerge);
