import { logger } from "../utils/logger.ts";
import { pdfjsLib } from "../utils/pdfConfig.ts";
import { convertPdfToImages } from "../utils/pdfEngine.ts";
import { persistence } from "../utils/persistence.ts";
import { generateOutputFilename } from "../utils/pdfUtils.ts";
import { BaseComponent } from "./BaseComponent.ts";
import JSZip from "jszip";

export class PdfToImage extends BaseComponent {
  protected toolKey = "pdf-to-image";
  private selectedPages: Set<number> = new Set();
  private format: "png" | "jpeg" = "png";
  private scale = 2.0;

  render() {
    this.innerHTML = `
      <div class="tool-view">
        ${this.getBackButton()}

        <h1>PDF to Image</h1>
        <p class="subtitle">Convert PDF pages into high-quality PNG or JPG images.</p>

        ${this.getDropZone("your PDF", "file-up")}

        <div id="fileInfo" class="file-list-item hidden" style="margin-bottom: 2rem; cursor: default;">
          <div class="file-item-details">
            <span id="fileName" class="file-name">document.pdf</span>
            <span id="fileSize" class="file-size">0 MB</span>
          </div>
        </div>

        <div id="mainLayout" class="layout-grid hidden">
          <div class="layout-left">
            <div class="preview-container" style="max-height: 500px; overflow-y: auto; padding: 1rem;">
              <div id="thumbnailGrid" class="page-grid">
                <!-- Thumbnails will be injected here -->
              </div>
            </div>
          </div>

          <div class="layout-right">
            <div class="controls">
              <div class="control-group">
                <label>Image Format</label>
                <div class="presets-grid">
                  <button class="preset-btn active" id="pngBtn">
                    <span class="preset-name">PNG</span>
                    <span class="preset-desc">Lossless, transparent</span>
                  </button>
                  <button class="preset-btn" id="jpgBtn">
                    <span class="preset-name">JPG</span>
                    <span class="preset-desc">Compressed, smaller</span>
                  </button>
                </div>
              </div>

              <div class="control-group">
                <label for="scaleInput">Quality (Scale)</label>
                <input type="number" id="scaleInput" value="2" min="1" max="5" step="0.5" />
                <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem;">Higher scale means higher resolution but larger file size.</p>
              </div>

              <div class="actions-row" style="flex-direction: column; align-items: stretch; gap: 1rem;">
                <button id="convertBtn" class="btn btn-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                  Convert & Download ZIP
                </button>
                <button id="downloadSelectedBtn" class="btn btn-secondary" disabled>
                  Download Selected
                </button>
              </div>

              ${this.getProgressSection("Converting pages...")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    this.setupBaseListeners();

    const pngBtn = this.querySelector("#pngBtn") as HTMLElement;
    const jpgBtn = this.querySelector("#jpgBtn") as HTMLElement;
    const scaleInput = this.querySelector("#scaleInput") as HTMLInputElement;
    const convertBtn = this.querySelector("#convertBtn") as HTMLButtonElement;
    const downloadSelectedBtn = this.querySelector("#downloadSelectedBtn") as HTMLButtonElement;

    pngBtn.onclick = () => {
      this.format = "png";
      pngBtn.classList.add("active");
      jpgBtn.classList.remove("active");
    };

    jpgBtn.onclick = () => {
      this.format = "jpeg";
      jpgBtn.classList.add("active");
      pngBtn.classList.remove("active");
    };

    scaleInput.onchange = () => {
      this.scale = parseFloat(scaleInput.value) || 2.0;
    };

    convertBtn.onclick = () => this.handleConvert(false);
    downloadSelectedBtn.onclick = () => this.handleConvert(true);

    // Resume session bind
    const resumeBtn = this.querySelector("#resumeBtn") as HTMLButtonElement;
    if (resumeBtn) {
      resumeBtn.onclick = () => this.restoreSession();
    }

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
    const savedFile = await persistence.get<File>(this.toolKey);
    if (savedFile) {
      this.handleFiles([savedFile] as unknown as FileList);
    }
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

    this.renderThumbnails();
  }

  async renderThumbnails() {
    if (!this.selectedFile) return;
    const thumbnailGrid = this.querySelector("#thumbnailGrid") as HTMLElement;
    thumbnailGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center;">Loading pages...</p>';

    try {
      const data = await this.selectedFile.arrayBuffer();
      this.currentPdfDoc = await pdfjsLib.getDocument({ data }).promise;
      thumbnailGrid.innerHTML = "";

      for (let i = 1; i <= this.currentPdfDoc.numPages; i++) {
        const pageItem = document.createElement("div");
        pageItem.className = "page-item";
        pageItem.dataset.page = i.toString();
        pageItem.innerHTML = `
          <canvas></canvas>
          <div class="page-number">${i}</div>
          <div class="selection-badge">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
        `;

        thumbnailGrid.appendChild(pageItem);

        const page = await this.currentPdfDoc.getPage(i);
        const canvas = pageItem.querySelector("canvas") as HTMLCanvasElement;
        const viewport = page.getViewport({ scale: 0.3 });
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: canvas.getContext("2d") as any, viewport }).promise;

        pageItem.onclick = () => {
          if (this.selectedPages.has(i)) {
            this.selectedPages.delete(i);
            pageItem.classList.remove("selected");
          } else {
            this.selectedPages.add(i);
            pageItem.classList.add("selected");
          }
          (this.querySelector("#downloadSelectedBtn") as HTMLButtonElement).disabled = this.selectedPages.size === 0;
        };
      }
    } catch (err) {
      logger.error("Failed to render thumbnails", err);
      this.showErrorDialog("Failed to load PDF preview.");
    }
  }

  async handleConvert(onlySelected: boolean) {
    if (!this.selectedFile) return;

    const convertBtn = this.querySelector("#convertBtn") as HTMLButtonElement;
    const progressSection = this.querySelector("#progressSection") as HTMLElement;
    
    convertBtn.disabled = true;
    progressSection.classList.remove("hidden");
    this.updateProgress(10, "Converting pages to images...");

    try {
      const pdfData = new Uint8Array(await this.selectedFile.arrayBuffer());
      const allImages = await convertPdfToImages(pdfData, { format: this.format, scale: this.scale });
      
      const imagesToExport = onlySelected 
        ? allImages.filter((_, i) => this.selectedPages.has(i + 1))
        : allImages;

      if (imagesToExport.length === 0) {
        throw new Error("No pages selected for export");
      }

      this.updateProgress(80, "Creating ZIP file...");

      const zip = new JSZip();
      const baseName = this.selectedFile.name.replace(".pdf", "");
      
      imagesToExport.forEach((blob, i) => {
        const pageNum = onlySelected ? Array.from(this.selectedPages)[i] : i + 1;
        zip.file(`${baseName}_page_${pageNum}.${this.format}`, blob);
      });

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const outputName = generateOutputFilename(this.selectedFile.name, "_images.zip");

      // We use simple download for ZIP
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = outputName;
      link.click();
      URL.revokeObjectURL(url);

      this.updateProgress(100, "Done!");
      this.showSuccessDialog(`Successfully converted ${imagesToExport.length} pages.`);
      
      await this.recordJob("PDF to Image", outputName, new Uint8Array(await zipBlob.arrayBuffer()), {
        pageCount: imagesToExport.length,
        format: this.format
      });

    } catch (err: any) {
      logger.error("Conversion failed", err);
      this.showErrorDialog(`Conversion failed: ${err.message}`);
    } finally {
      convertBtn.disabled = false;
      progressSection.classList.add("hidden");
    }
  }
}

customElements.define("pdf-to-image", PdfToImage);
