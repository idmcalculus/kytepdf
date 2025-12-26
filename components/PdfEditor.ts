import { BaseComponent } from "./BaseComponent.ts";
import { logger } from "../utils/logger.ts";
import { loadPdf, renderPage } from "../utils/pdfRenderer.ts";

export class PdfEditor extends BaseComponent {
  protected toolKey = "edit-pdf";

  connectedCallback() {
    super.connectedCallback();
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
            <div class="toolbar-group">
              <button id="addTextBtn" class="tool-btn" title="Add Text">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>
              </button>
              <button id="addImageBtn" class="tool-btn" title="Add Image">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
              </button>
              <button id="addRectBtn" class="tool-btn" title="Add Rectangle">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/></svg>
              </button>
            </div>
            
            <div class="toolbar-spacer"></div>
            
            <div class="toolbar-group">
              <button id="saveBtn" class="btn btn-primary btn-sm" style="width: auto;">
                Save PDF
              </button>
            </div>
          </div>

          <div class="editor-workspace">
             <div id="pdfContainer" class="pdf-container"></div>
          </div>
        </div>

        ${this.getProgressSection("Loading PDF...")}
      </div>
    `;
  }

  setupEventListeners() {
    this.setupBaseListeners("#dropZone", "#fileInput");

    // Tool selection logic
    const toolBtns = this.querySelectorAll(".tool-btn");
    toolBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        toolBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        logger.debug("Tool selected", { id: btn.id });
      });
    });
  }

  async handleFiles(files: FileList) {
    if (files.length === 0) return;
    const file = files[0];
    
    if (this.validateFile(file)) {
      this.selectedFile = file;
      logger.info("File loaded for editing", { name: file.name, size: file.size });
      
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
    
    container.innerHTML = ""; 

    for (let i = 1; i <= this.currentPdfDoc.numPages; i++) {
      const pageWrapper = document.createElement("div");
      pageWrapper.className = "pdf-page-wrapper";
      
      const canvas = document.createElement("canvas");
      canvas.className = "pdf-page-canvas";
      
      pageWrapper.appendChild(canvas);
      container.appendChild(pageWrapper);

      // Render page with standard scale for 800px width
      // We calculate scale based on viewport width vs 800px target
      const page = await this.currentPdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: 1.0 });
      const scale = 800 / viewport.width;

      await renderPage(this.currentPdfDoc, i, canvas, scale);
    }
  }
}

customElements.define("pdf-editor", PdfEditor);
