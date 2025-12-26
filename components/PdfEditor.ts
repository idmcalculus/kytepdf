import { BaseComponent } from "./BaseComponent.ts";
import { logger } from "../utils/logger.ts";
import { loadPdf, renderPage } from "../utils/pdfRenderer.ts";
import { AnnotationManager, type Annotation } from "../utils/AnnotationManager.ts";
import { embedTextAnnotations } from "../utils/pdfEngine.ts";

export class PdfEditor extends BaseComponent {
  protected toolKey = "edit-pdf";
  private annotationManager: AnnotationManager = new AnnotationManager();
  private activeTool: string | null = null;
  private selectedAnnotationId: string | null = null;

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
        this.activeTool = btn.id;
        logger.debug("Tool selected", { id: btn.id });
      });
    });

    // Save button logic
    const saveBtn = this.querySelector("#saveBtn");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => this.handleSave());
    }

    // Delegate clicks on pages to create annotations
    this.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const pageWrapper = target.closest(".pdf-page-wrapper") as HTMLElement;
      
      if (pageWrapper && this.activeTool === "addTextBtn") {
        // Only add if we clicked on the canvas or the wrapper itself, not an existing annotation
        if (target.classList.contains("pdf-page-canvas") || target.classList.contains("pdf-page-wrapper")) {
          const rect = pageWrapper.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const pageIndex = parseInt(pageWrapper.dataset.index || "0", 10);
          
          this.addTextAnnotation(pageIndex, x, y);
        }
      }
    });
  }

  private addTextAnnotation(pageIndex: number, x: number, y: number) {
    const id = this.annotationManager.addAnnotation({
      type: "text",
      pageIndex,
      x,
      y,
      content: "New Text",
      style: { fontSize: 16, color: "#000000" }
    });
    
    this.renderAnnotation(id);
    logger.info("Text annotation added", { id, pageIndex, x, y });
  }

  private renderAnnotation(id: string) {
    const ann = this.annotationManager.getAnnotation(id);
    if (!ann) return;

    const pageWrapper = this.querySelector(`.pdf-page-wrapper[data-index="${ann.pageIndex}"]`);
    if (!pageWrapper) return;

    const el = document.createElement("div");
    el.className = "annotation annotation-text";
    el.dataset.id = id;
    el.contentEditable = "true";
    el.innerText = ann.content || "";
    el.style.position = "absolute";
    el.style.left = `${ann.x}px`;
    el.style.top = `${ann.y}px`;
    el.style.color = ann.style?.color || "black";
    el.style.fontSize = `${ann.style?.fontSize || 16}px`;
    el.style.cursor = "move";
    el.style.border = "1px dashed transparent";
    el.style.padding = "2px 4px";
    el.style.minWidth = "20px";
    el.style.zIndex = "100";
    el.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
    el.style.borderRadius = "4px";

    el.addEventListener("mousedown", (e) => this.startDragging(e, id));
    el.addEventListener("input", () => {
      this.annotationManager.updateAnnotation(id, { content: el.innerText });
    });
    el.addEventListener("focus", () => {
      el.style.borderColor = "var(--primary)";
      el.style.backgroundColor = "rgba(255, 255, 255, 0.8)";
      el.style.color = "black";
    });
    el.addEventListener("blur", () => {
      el.style.borderColor = "transparent";
      el.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
      el.style.color = ann.style?.color || "black";
    });

    pageWrapper.appendChild(el);
    
    // Focus immediately if new
    setTimeout(() => el.focus(), 50);
  }

  private startDragging(e: MouseEvent, id: string) {
    // Only drag if not editing? Or drag by edge? 
    // For now, let's allow dragging if Ctrl is held or just if we move enough.
    // Simpler: if we are in a tool that is NOT addTextBtn, or just always.
    if (this.activeTool !== null && this.activeTool !== "addTextBtn") {
       // Maybe dragging is disabled when another tool is active?
    }

    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startY = e.clientY;
    const initialLeft = parseFloat(el.style.left);
    const initialTop = parseFloat(el.style.top);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const newX = initialLeft + dx;
      const newY = initialTop + dy;
      
      el.style.left = `${newX}px`;
      el.style.top = `${newY}px`;
      this.annotationManager.updateAnnotation(id, { x: newX, y: newY });
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  async handleSave() {
    if (!this.selectedFile || !this.currentPdfDoc) return;

    try {
      this.updateProgress(10, "Preparing PDF...");
      const arrayBuffer = await this.selectedFile.arrayBuffer();
      const pdfBytes = new Uint8Array(arrayBuffer);

      // Convert annotations to PDF points
      const annotations = this.annotationManager.getAllAnnotations();
      const scaledAnnotations: Annotation[] = [];

      for (const ann of annotations) {
        const page = await this.currentPdfDoc.getPage(ann.pageIndex + 1);
        const viewport = page.getViewport({ scale: 1.0 });
        const scale = 800 / viewport.width;

        scaledAnnotations.push({
          ...ann,
          x: ann.x / scale,
          y: ann.y / scale,
          style: {
            ...ann.style,
            fontSize: (ann.style?.fontSize || 16) / scale,
          }
        });
      }

      this.updateProgress(50, "Embedding annotations...");
      const modifiedPdfBytes = await embedTextAnnotations(pdfBytes, scaledAnnotations);

      this.updateProgress(90, "Saving...");
      const success = await this.savePdf(modifiedPdfBytes, this.selectedFile.name, "_edited");
      
      if (success) {
        await this.recordJob("Edit", this.selectedFile.name, modifiedPdfBytes, {
          annotationCount: annotations.length
        });
        this.updateProgress(100, "Saved!");
      } else {
        this.updateProgress(0, "Save cancelled");
      }

      setTimeout(() => {
        const progressSection = this.querySelector("#progressSection");
        if (progressSection) progressSection.classList.add("hidden");
      }, 1500);

    } catch (err) {
      logger.error("Failed to save edited PDF", err);
      this.showErrorDialog("An error occurred while saving the PDF.");
      this.updateProgress(0, "Error");
    }
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
      pageWrapper.dataset.index = (i - 1).toString();
      
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
