import { BaseComponent } from "./BaseComponent.ts";
import { logger } from "../utils/logger.ts";
import { loadPdf, renderPage } from "../utils/pdfRenderer.ts";
import { AnnotationManager, type Annotation } from "../utils/AnnotationManager.ts";
import { embedAllAnnotations } from "../utils/pdfEngine.ts";

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
              <input type="file" id="imageInput" class="hidden" accept="image/png,image/jpeg" />
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
        if (btn.id === "addImageBtn") {
          const imageInput = this.querySelector("#imageInput") as HTMLInputElement;
          imageInput.click();
          return;
        }
        toolBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.activeTool = btn.id;
        logger.debug("Tool selected", { id: btn.id });
      });
    });

    const imageInput = this.querySelector("#imageInput") as HTMLInputElement;
    imageInput.addEventListener("change", (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        this.handleImageUpload(file);
      }
    });

    // Save button logic
    const saveBtn = this.querySelector("#saveBtn");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => this.handleSave());
    }

    // Keyboard support for deletion
    window.addEventListener("keydown", (e) => {
      if ((e.key === "Delete" || e.key === "Backspace") && this.selectedAnnotationId) {
        const activeEl = document.activeElement as HTMLElement;
        if (activeEl.isContentEditable) return;
        this.removeAnnotation(this.selectedAnnotationId);
      }
    });

    // Delegate clicks on pages to create annotations
    this.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const pageWrapper = target.closest(".pdf-page-wrapper") as HTMLElement;
      
      if (pageWrapper) {
        if (this.activeTool === "addTextBtn") {
          if (target.classList.contains("pdf-page-canvas") || target.classList.contains("pdf-page-wrapper")) {
            const rect = pageWrapper.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const pageIndex = parseInt(pageWrapper.dataset.index || "0", 10);
            this.addTextAnnotation(pageIndex, x, y);
          }
        } else if (this.activeTool === "addRectBtn") {
          if (target.classList.contains("pdf-page-canvas") || target.classList.contains("pdf-page-wrapper")) {
            const rect = pageWrapper.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const pageIndex = parseInt(pageWrapper.dataset.index || "0", 10);
            this.addRectAnnotation(pageIndex, x, y);
          }
        }
      }
    });
  }

  private async handleImageUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      this.showErrorDialog("Please select an image file (PNG/JPG).");
      return;
    }

    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      // Default to adding on first page if not specified? 
      // Better: ask user to click where they want it, or just center it.
      // For now, center it on the first visible page or just first page.
      this.addImageAnnotation(0, 50, 50, dataUrl);
    } catch (err) {
      logger.error("Failed to read image", err);
    }
  }

  private addImageAnnotation(pageIndex: number, x: number, y: number, dataUrl: string) {
    const id = this.annotationManager.addAnnotation({
      type: "image",
      pageIndex,
      x,
      y,
      width: 150, // Default width
      height: 150,
      content: dataUrl
    });
    
    this.renderAnnotation(id);
    logger.info("Image annotation added", { id, pageIndex, x, y });
  }

  private addRectAnnotation(pageIndex: number, x: number, y: number) {
    const id = this.annotationManager.addAnnotation({
      type: "rectangle",
      pageIndex,
      x,
      y,
      width: 100,
      height: 50,
      style: { color: "#ffffff", strokeWidth: 0 } // Default white-out
    });
    
    this.renderAnnotation(id);
    logger.info("Rectangle annotation added", { id, pageIndex, x, y });
  }

  private removeAnnotation(id: string) {
    const el = this.querySelector(`.annotation[data-id="${id}"]`);
    if (el) el.remove();
    this.annotationManager.removeAnnotation(id);
    if (this.selectedAnnotationId === id) this.selectedAnnotationId = null;
    logger.info("Annotation removed", { id });
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
    el.className = `annotation annotation-${ann.type}`;
    el.dataset.id = id;
    el.style.position = "absolute";
    el.style.left = `${ann.x}px`;
    el.style.top = `${ann.y}px`;
    el.style.zIndex = "100";

    const deleteBtn = document.createElement("button");
    deleteBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    `;
    deleteBtn.className = "ann-delete-btn";
    deleteBtn.style.position = "absolute";
    deleteBtn.style.top = "-10px";
    deleteBtn.style.right = "-10px";
    deleteBtn.style.width = "20px";
    deleteBtn.style.height = "20px";
    deleteBtn.style.borderRadius = "50%";
    deleteBtn.style.backgroundColor = "#ef4444";
    deleteBtn.style.color = "white";
    deleteBtn.style.border = "none";
    deleteBtn.style.display = "none";
    deleteBtn.style.cursor = "pointer";
    deleteBtn.style.zIndex = "110";
    deleteBtn.style.padding = "0";
    deleteBtn.style.display = "none"; // Reset display logic
    deleteBtn.style.alignItems = "center";
    deleteBtn.style.justifyContent = "center";

    if (ann.type === "text") {
      const textEl = document.createElement("div");
      textEl.contentEditable = "true";
      textEl.innerText = ann.content || "";
      textEl.style.color = ann.style?.color || "black";
      textEl.style.fontSize = `${ann.style?.fontSize || 16}px`;
      textEl.style.cursor = "move";
      textEl.style.padding = "2px 4px";
      textEl.style.minWidth = "20px";
      textEl.style.outline = "none";
      textEl.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
      textEl.style.borderRadius = "4px";
      textEl.style.border = "1px solid transparent";

      el.appendChild(textEl);
      textEl.addEventListener("mousedown", (e) => this.startDragging(e, id));
      textEl.addEventListener("input", () => {
        this.annotationManager.updateAnnotation(id, { content: textEl.innerText });
      });
      textEl.addEventListener("focus", () => {
        this.selectedAnnotationId = id;
        textEl.style.borderColor = "var(--primary)";
        textEl.style.backgroundColor = "rgba(255, 255, 255, 0.8)";
        deleteBtn.style.display = "flex";
      });
      textEl.addEventListener("blur", () => {
        setTimeout(() => {
          if (document.activeElement !== textEl) {
            deleteBtn.style.display = "none";
            textEl.style.borderColor = "transparent";
            textEl.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
          }
        }, 200);
      });
    } else if (ann.type === "rectangle") {
      el.style.width = `${ann.width || 100}px`;
      el.style.height = `${ann.height || 50}px`;
      el.style.backgroundColor = ann.style?.color || "white";
      el.style.border = `${ann.style?.strokeWidth || 0}px solid black`;
      el.style.cursor = "move";

      // Resizer handle
      const resizer = document.createElement("div");
      resizer.style.width = "10px";
      resizer.style.height = "10px";
      resizer.style.backgroundColor = "var(--primary)";
      resizer.style.position = "absolute";
      resizer.style.right = "-5px";
      resizer.style.bottom = "-5px";
      resizer.style.cursor = "nwse-resize";
      resizer.style.borderRadius = "50%";
      resizer.style.display = "none";
      el.appendChild(resizer);

      el.addEventListener("mousedown", (e) => {
        if (e.target === resizer) {
          this.startResizing(e, id);
        } else {
          this.startDragging(e, id);
        }
      });

      el.tabIndex = 0; // Make focusable
      el.addEventListener("focus", () => {
        this.selectedAnnotationId = id;
        el.style.boxShadow = "0 0 0 2px var(--primary)";
        deleteBtn.style.display = "flex";
        resizer.style.display = "block";
      });
      el.addEventListener("blur", () => {
        setTimeout(() => {
          if (document.activeElement !== el) {
            el.style.boxShadow = "none";
            deleteBtn.style.display = "none";
            resizer.style.display = "none";
          }
        }, 200);
      });
    } else if (ann.type === "image") {
      el.style.width = `${ann.width || 150}px`;
      el.style.height = `${ann.height || 150}px`;
      el.style.cursor = "move";

      const img = document.createElement("img");
      img.src = ann.content || "";
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "contain";
      img.style.pointerEvents = "none";
      el.appendChild(img);

      // Resizer handle
      const resizer = document.createElement("div");
      resizer.style.width = "10px";
      resizer.style.height = "10px";
      resizer.style.backgroundColor = "var(--primary)";
      resizer.style.position = "absolute";
      resizer.style.right = "-5px";
      resizer.style.bottom = "-5px";
      resizer.style.cursor = "nwse-resize";
      resizer.style.borderRadius = "50%";
      resizer.style.display = "none";
      el.appendChild(resizer);

      el.addEventListener("mousedown", (e) => {
        if (e.target === resizer) {
          this.startResizing(e, id);
        } else {
          this.startDragging(e, id);
        }
      });

      el.tabIndex = 0; 
      el.addEventListener("focus", () => {
        this.selectedAnnotationId = id;
        el.style.boxShadow = "0 0 0 2px var(--primary)";
        deleteBtn.style.display = "flex";
        resizer.style.display = "block";
      });
      el.addEventListener("blur", () => {
        setTimeout(() => {
          if (document.activeElement !== el) {
            el.style.boxShadow = "none";
            deleteBtn.style.display = "none";
            resizer.style.display = "none";
          }
        }, 200);
      });
    }

    el.appendChild(deleteBtn);
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.removeAnnotation(id);
    });

    pageWrapper.appendChild(el);
    if (ann.type === "text") {
      const textEl = el.querySelector("div[contenteditable]");
      setTimeout(() => (textEl as HTMLElement)?.focus(), 50);
    } else {
      setTimeout(() => el.focus(), 50);
    }
  }

  private startResizing(e: MouseEvent, id: string) {
    e.stopPropagation();
    e.preventDefault();
    const el = this.querySelector(`.annotation[data-id="${id}"]`) as HTMLElement;
    const startX = e.clientX;
    const startY = e.clientY;
    const initialWidth = el.offsetWidth;
    const initialHeight = el.offsetHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dw = moveEvent.clientX - startX;
      const dh = moveEvent.clientY - startY;
      const newW = Math.max(10, initialWidth + dw);
      const newH = Math.max(10, initialHeight + dh);
      
      el.style.width = `${newW}px`;
      el.style.height = `${newH}px`;
      this.annotationManager.updateAnnotation(id, { width: newW, height: newH });
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  private startDragging(e: MouseEvent, id: string) {
    e.stopPropagation();
    const annElement = this.querySelector(`.annotation[data-id="${id}"]`) as HTMLElement;
    const startX = e.clientX;
    const startY = e.clientY;
    const initialLeft = parseFloat(annElement.style.left);
    const initialTop = parseFloat(annElement.style.top);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const newX = initialLeft + dx;
      const newY = initialTop + dy;
      
      annElement.style.left = `${newX}px`;
      annElement.style.top = `${newY}px`;
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
          width: ann.width ? ann.width / scale : undefined,
          height: ann.height ? ann.height / scale : undefined,
          style: {
            ...ann.style,
            fontSize: (ann.style?.fontSize || 16) / scale,
          }
        });
      }

      this.updateProgress(50, "Embedding all annotations...");
      const modifiedPdfBytes = await embedAllAnnotations(pdfBytes, scaledAnnotations);

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
      pageWrapper.style.position = "relative";
      
      const canvas = document.createElement("canvas");
      canvas.className = "pdf-page-canvas";
      
      pageWrapper.appendChild(canvas);
      container.appendChild(pageWrapper);

      const page = await this.currentPdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: 1.0 });
      const scale = 800 / viewport.width;

      await renderPage(this.currentPdfDoc, i, canvas, scale);
    }
  }
}

customElements.define("pdf-editor", PdfEditor);