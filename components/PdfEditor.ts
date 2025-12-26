import { BaseComponent } from "./BaseComponent.ts";
import { logger } from "../utils/logger.ts";
import { loadPdf, renderPage } from "../utils/pdfRenderer.ts";

export class PdfEditor extends BaseComponent {
  protected toolKey = "edit-pdf";

  connectedCallback() {
    super.connectedCallback();
    this.render();
  }

  render() {
    this.innerHTML = `
      <div class="tool-view">
        ${this.getBackButton()}
        
        <!-- Initial Drop Zone -->
        <div id="editorDropZoneContainer">
          ${this.getDropZone("your PDF to edit", "edit-3")}
        </div>

        <!-- Editor Interface (Initially Hidden) -->
        <div id="editorInterface" class="editor-interface hidden">
          <div class="editor-toolbar">
            <!-- Tools will go here -->
            <div class="toolbar-group">
              <button id="addTextBtn" class="tool-btn" title="Add Text">
                <i data-lucide="type"></i>
              </button>
              <button id="addImageBtn" class="tool-btn" title="Add Image">
                <i data-lucide="image"></i>
              </button>
              <button id="addRectBtn" class="tool-btn" title="Add Rectangle">
                <i data-lucide="square"></i>
              </button>
            </div>
            
            <div class="toolbar-spacer"></div>
            
            <div class="toolbar-group">
              <button id="saveBtn" class="btn btn-primary btn-sm">
                Save & Download
              </button>
            </div>
          </div>

          <div class="editor-workspace">
             <!-- PDF Canvas Container -->
             <div id="pdfContainer" class="pdf-container"></div>
          </div>
        </div>

        ${this.getProgressSection("Loading PDF...")}
      </div>
    `;
    
    // Initialize icons if Lucide is available
    if ((window as any).lucide) {
      (window as any).lucide.createIcons();
    }
  }

  setupEventListeners() {
    this.setupBaseListeners("#dropZone", "#fileInput");
  }

  async handleFiles(files: FileList) {
    if (files.length === 0) return;
    const file = files[0];
    
    if (this.validateFile(file)) {
      this.selectedFile = file;
      logger.info("File loaded for editing", { name: file.name, size: file.size });
      
      // Hide dropzone, show editor
      const dropZoneContainer = this.querySelector("#editorDropZoneContainer");
      const editorInterface = this.querySelector("#editorInterface");
      
      if (dropZoneContainer) dropZoneContainer.classList.add("hidden");
      if (editorInterface) editorInterface.classList.remove("hidden");

      await this.loadAndRender(file);
    }
  }

  async loadAndRender(file: File) {
    try {
      this.updateProgress(10, "Loading PDF...");
      const arrayBuffer = await file.arrayBuffer();
      this.currentPdfDoc = await loadPdf(arrayBuffer);
      await this.renderPages();
      this.updateProgress(100, "Ready");
      // Hide progress after short delay
      setTimeout(() => {
        const progressSection = this.querySelector("#progressSection");
        if (progressSection) progressSection.classList.add("hidden");
      }, 500);
    } catch (err) {
      logger.error("Failed to load PDF", err);
      this.showErrorDialog("Failed to load PDF document.");
    }
  }

  async renderPages() {
    const container = this.querySelector("#pdfContainer");
    if (!container || !this.currentPdfDoc) return;
    
    container.innerHTML = ""; // Clear existing

    for (let i = 1; i <= this.currentPdfDoc.numPages; i++) {
      const pageWrapper = document.createElement("div");
      pageWrapper.className = "pdf-page-wrapper";
      pageWrapper.style.position = "relative";
      pageWrapper.style.marginBottom = "20px";
      pageWrapper.style.boxShadow = "var(--shadow-md)";
      
      const canvas = document.createElement("canvas");
      canvas.className = "pdf-page-canvas";
      canvas.style.display = "block";
      
      pageWrapper.appendChild(canvas);
      container.appendChild(pageWrapper);

      // Render page
      await renderPage(this.currentPdfDoc, i, canvas);
    }
  }
}

customElements.define("pdf-editor", PdfEditor);
