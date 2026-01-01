import { BaseComponent } from "../BaseComponent.ts";
import { logger } from "../../utils/logger.ts";
import { loadPdf, renderPage } from "../../utils/pdfRenderer.ts";
import { AnnotationManager, type Annotation } from "../../utils/AnnotationManager.ts";
import { embedAllAnnotations } from "../../utils/pdfEngine.ts";

import { TextEditor } from "./TextEditor";
import { RectangleToolEditor } from "./RectangleToolEditor";
import { ImageEditor } from "./ImageEditor";
import type { EditorTool } from "./types";

const TARGET_WIDTH = 800;

export class PdfEditor extends BaseComponent {
  protected toolKey = "edit-pdf";
  private annotationManager: AnnotationManager = new AnnotationManager();
  private activeTool: EditorTool | null = null;
  private tools: Map<string, EditorTool> = new Map();
  private selectedAnnotationId: string | null = null;

  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();
  }

  private initTools() {
    const context = {
      container: this,
      annotationManager: this.annotationManager,
      pdfDoc: this.currentPdfDoc,
      renderAnnotation: (id: string) => this.renderAnnotation(id),
      showProperties: (id: string) => this.showPropertiesPanel(id)
    };

    this.tools.set("addTextBtn", new TextEditor(context));
    this.tools.set("addRectBtn", new RectangleToolEditor(context));
    this.tools.set("addImageBtn", new ImageEditor(context));
  }

  render() {
    this.innerHTML = `
      <div class="tool-view">
        ${this.getBackButton()}
        
        <div id="editorDropZoneContainer">
          ${this.getDropZone("your PDF to edit", "edit-3")}
        </div>

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

          <div id="propertiesPanel" class="properties-panel hidden">
            <div class="panel-header">
              <span>Properties</span>
              <button id="closePanelBtn" class="btn-close">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            <div class="panel-content">
              <div id="textProperties" class="prop-section hidden">
                <div class="prop-row">
                  <label>Font</label>
                  <select id="fontFamilySelect">
                    <option value="Helvetica">Helvetica</option>
                    <option value="Times-Roman">Times Roman</option>
                    <option value="Courier">Courier</option>
                  </select>
                </div>
                <div class="prop-row">
                  <label>Size</label>
                  <input type="number" id="fontSizeInput" min="6" max="72" value="16">
                </div>
                <div class="prop-row">
                  <label>Color</label>
                  <input type="color" id="colorPicker" value="#000000">
                </div>
              </div>
              <div id="shapeProperties" class="prop-section hidden">
                <div class="prop-row">
                  <label>Fill</label>
                  <input type="color" id="shapeFillPicker" value="#ffffff">
                </div>
                <div class="prop-row">
                  <label>Border</label>
                  <input type="number" id="shapeBorderInput" min="0" max="10" value="0">
                </div>
                <div class="prop-row">
                  <label>Opacity</label>
                  <input type="range" id="shapeOpacityInput" min="0" max="1" step="0.1" value="1">
                </div>
              </div>
              <div id="imageProperties" class="prop-section hidden">
                <div class="prop-row">
                  <label>Opacity</label>
                  <input type="range" id="imageOpacityInput" min="0" max="1" step="0.1" value="1">
                </div>
                <div class="prop-row">
                  <label>Rotation</label>
                  <div class="icon-btn-group">
                    <button id="rotateLeftBtn" class="icon-btn" title="Rotate Left">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                    </button>
                    <button id="rotateRightBtn" class="icon-btn" title="Rotate Right">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
                    </button>
                  </div>
                </div>
                <div class="prop-row">
                  <label>Size</label>
                  <div class="icon-btn-group">
                    <button id="zoomOutBtn" class="icon-btn" title="Zoom Out">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                    </button>
                    <button id="zoomInBtn" class="icon-btn" title="Zoom In">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                    </button>
                  </div>
                </div>
                <div class="prop-row" style="margin-top: 0.5rem;">
                  <button id="resetImageBtn" class="btn btn-secondary btn-sm" style="width: 100%; font-size: 0.75rem;">
                    Reset Transform
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        ${this.getProgressSection("Loading PDF...")}
      </div>
    `;
  }

  setupEventListeners() {
    this.setupBaseListeners("#dropZone", "#fileInput");

    const toolBtns = this.querySelectorAll(".tool-btn");
    const workspace = this.querySelector(".editor-workspace") as HTMLElement;

    toolBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const tool = this.tools.get(btn.id);
        if (btn.id === "addImageBtn") {
          const imageInput = this.querySelector("#imageInput") as HTMLInputElement;
          imageInput.click();
          return;
        }

        if (this.activeTool) this.activeTool.onDeactivate();
        toolBtns.forEach(b => b.classList.remove("active"));
        
        if (tool) {
          btn.classList.add("active");
          this.activeTool = tool;
          tool.onActivate();
          
          workspace.className = "editor-workspace";
          if (btn.id === "addTextBtn") workspace.classList.add("cursor-text-tool");
          else if (btn.id === "addRectBtn") workspace.classList.add("cursor-crosshair");
        }
      });
    });

    const imageInput = this.querySelector("#imageInput") as HTMLInputElement;
    imageInput?.addEventListener("change", (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const imgTool = this.tools.get("addImageBtn") as ImageEditor;
        imgTool.handleUpload(file);
      }
    });

    this.querySelector("#saveBtn")?.addEventListener("click", () => this.handleSave());
    this.querySelector("#closePanelBtn")?.addEventListener("click", () => {
      this.querySelector("#propertiesPanel")?.classList.add("hidden");
    });

    // Property Listeners
    const fontSelect = this.querySelector("#fontFamilySelect") as HTMLSelectElement;
    const fontSizeInput = this.querySelector("#fontSizeInput") as HTMLInputElement;
    const colorPicker = this.querySelector("#colorPicker") as HTMLInputElement;
    const shapeFillPicker = this.querySelector("#shapeFillPicker") as HTMLInputElement;
    const shapeBorderInput = this.querySelector("#shapeBorderInput") as HTMLInputElement;
    const shapeOpacityInput = this.querySelector("#shapeOpacityInput") as HTMLInputElement;
    const imageOpacityInput = this.querySelector("#imageOpacityInput") as HTMLInputElement;
    
    const rotateLeftBtn = this.querySelector("#rotateLeftBtn");
    const rotateRightBtn = this.querySelector("#rotateRightBtn");
    const zoomInBtn = this.querySelector("#zoomInBtn");
    const zoomOutBtn = this.querySelector("#zoomOutBtn");
    const resetImageBtn = this.querySelector("#resetImageBtn");

    fontSelect?.addEventListener("change", () => this.updateSelectedAnnotation({ font: fontSelect.value }));
    fontSizeInput?.addEventListener("input", () => this.updateSelectedAnnotation({ fontSize: parseInt(fontSizeInput.value, 10) }));
    colorPicker?.addEventListener("input", () => this.updateSelectedAnnotation({ color: colorPicker.value }));
    shapeFillPicker?.addEventListener("input", () => this.updateSelectedAnnotation({ color: shapeFillPicker.value }));
    shapeBorderInput?.addEventListener("input", () => this.updateSelectedAnnotation({ strokeWidth: parseInt(shapeBorderInput.value, 10) }));
    shapeOpacityInput?.addEventListener("input", () => this.updateSelectedAnnotation({ opacity: parseFloat(shapeOpacityInput.value) }));
    imageOpacityInput?.addEventListener("input", () => this.updateSelectedAnnotation({ opacity: parseFloat(imageOpacityInput.value) }));

    rotateLeftBtn?.addEventListener("click", () => {
      const ann = this.annotationManager.getAnnotation(this.selectedAnnotationId!);
      const current = ann?.style?.rotation || 0;
      this.updateSelectedAnnotation({ rotation: (current - 90 + 360) % 360 });
    });

    rotateRightBtn?.addEventListener("click", () => {
      const ann = this.annotationManager.getAnnotation(this.selectedAnnotationId!);
      const current = ann?.style?.rotation || 0;
      this.updateSelectedAnnotation({ rotation: (current + 90) % 360 });
    });

    zoomInBtn?.addEventListener("click", () => {
      this.updateSelectedAnnotation({ scale: 1.1 }); // Incremental scale
    });

    zoomOutBtn?.addEventListener("click", () => {
      this.updateSelectedAnnotation({ scale: 0.9 }); // Incremental scale
    });

    resetImageBtn?.addEventListener("click", () => {
      this.updateSelectedAnnotation({ rotation: 0, scale: 1.0, reset: true });
    });

    window.addEventListener("keydown", (e) => {
      if ((e.key === "Delete" || e.key === "Backspace") && this.selectedAnnotationId) {
        if ((document.activeElement as HTMLElement).isContentEditable) return;
        this.removeAnnotation(this.selectedAnnotationId);
      }
    });

    this.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const pageWrapper = target.closest(".pdf-page-wrapper") as HTMLElement;
      if (pageWrapper && this.activeTool) {
        if (target.classList.contains("pdf-page-canvas") || target.classList.contains("pdf-page-wrapper")) {
          const rect = pageWrapper.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const pageIndex = parseInt(pageWrapper.dataset.index || "0", 10);
          this.activeTool.onPageClick(pageIndex, x, y);
        }
      }
    });
  }

  private updateSelectedAnnotation(props: any) {
    if (!this.selectedAnnotationId) return;
    const ann = this.annotationManager.getAnnotation(this.selectedAnnotationId);
    if (!ann) return;

    const el = this.querySelector(`.annotation[data-id="${this.selectedAnnotationId}"]`) as HTMLElement;
    if (!el) return;

    if (ann.type === "text") {
      const textEl = el.querySelector("div[contenteditable]") as HTMLElement;
      if (props.fontSize) {
        textEl.style.fontSize = `${props.fontSize}px`;
        this.annotationManager.updateAnnotation(ann.id, { style: { ...ann.style, fontSize: props.fontSize } });
      }
      if (props.color) {
        textEl.style.color = props.color;
        this.annotationManager.updateAnnotation(ann.id, { style: { ...ann.style, color: props.color } });
      }
      if (props.font) {
        textEl.style.fontFamily = props.font;
        this.annotationManager.updateAnnotation(ann.id, { style: { ...ann.style, font: props.font } });
      }
    } else if (ann.type === "rectangle") {
      if (props.color) {
        el.style.backgroundColor = props.color;
        this.annotationManager.updateAnnotation(ann.id, { style: { ...ann.style, color: props.color } });
      }
      if (props.strokeWidth !== undefined) {
        el.style.borderWidth = `${props.strokeWidth}px`;
        this.annotationManager.updateAnnotation(ann.id, { style: { ...ann.style, strokeWidth: props.strokeWidth } });
      }
      if (props.opacity !== undefined) {
        el.style.opacity = props.opacity.toString();
        this.annotationManager.updateAnnotation(ann.id, { style: { ...ann.style, opacity: props.opacity } });
      }
    } else if (ann.type === "image") {
      if (props.opacity !== undefined) {
        el.style.opacity = props.opacity.toString();
        this.annotationManager.updateAnnotation(ann.id, { style: { ...ann.style, opacity: props.opacity } });
      }
      if (props.rotation !== undefined) {
        el.style.transform = `rotate(${props.rotation}deg)`;
        this.annotationManager.updateAnnotation(ann.id, { style: { ...ann.style, rotation: props.rotation } });
      }
      if (props.scale !== undefined) {
        // If it's a reset, we use the initial stored dimensions if we have them
        // or just hardcoded 150 for now. 
        // For incremental, we multiply existing width.
        const currentW = parseFloat(el.style.width);
        const currentH = parseFloat(el.style.height);
        
        let newW, newH;
        if (props.reset) {
          newW = 150; newH = 150;
        } else {
          newW = currentW * props.scale;
          newH = currentH * props.scale;
        }

        // Limit size
        newW = Math.max(20, Math.min(800, newW));
        newH = Math.max(20, Math.min(800, newH));

        el.style.width = `${newW}px`;
        el.style.height = `${newH}px`;
        this.annotationManager.updateAnnotation(ann.id, { width: newW, height: newH });
      }
    }
  }

  private showPropertiesPanel(id: string) {
    const ann = this.annotationManager.getAnnotation(id);
    if (!ann) return;

    const panel = this.querySelector("#propertiesPanel");
    const sections = this.querySelectorAll(".prop-section");
    panel?.classList.remove("hidden");
    sections.forEach(s => s.classList.add("hidden"));

    if (ann.type === "text") {
      this.querySelector("#textProperties")?.classList.remove("hidden");
      (this.querySelector("#fontSizeInput") as HTMLInputElement).value = (ann.style?.fontSize || 16).toString();
      (this.querySelector("#colorPicker") as HTMLInputElement).value = ann.style?.color || "#000000";
      (this.querySelector("#fontFamilySelect") as HTMLSelectElement).value = ann.style?.font || "Helvetica";
    } else if (ann.type === "rectangle") {
      this.querySelector("#shapeProperties")?.classList.remove("hidden");
      (this.querySelector("#shapeFillPicker") as HTMLInputElement).value = ann.style?.color || "#ffffff";
      (this.querySelector("#shapeBorderInput") as HTMLInputElement).value = (ann.style?.strokeWidth || 0).toString();
      (this.querySelector("#shapeOpacityInput") as HTMLInputElement).value = (ann.style?.opacity ?? 1).toString();
    } else if (ann.type === "image") {
      this.querySelector("#imageProperties")?.classList.remove("hidden");
      (this.querySelector("#imageOpacityInput") as HTMLInputElement).value = (ann.style?.opacity ?? 1).toString();
    }
  }

  private removeAnnotation(id: string) {
    const el = this.querySelector(`.annotation[data-id="${id}"]`);
    if (el) el.remove();
    this.annotationManager.removeAnnotation(id);
    if (this.selectedAnnotationId === id) {
      this.selectedAnnotationId = null;
      this.querySelector("#propertiesPanel")?.classList.add("hidden");
    }
    logger.info("Annotation removed", { id });
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
    deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
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
    deleteBtn.style.alignItems = "center";
    deleteBtn.style.justifyContent = "center";

    if (ann.type === "text") {
      const textEl = document.createElement("div");
      textEl.contentEditable = "true";
      textEl.innerText = ann.content || "";
      textEl.style.color = ann.style?.color || "black";
      textEl.style.fontSize = `${ann.style?.fontSize || 16}px`;
      textEl.style.fontFamily = ann.style?.font || "Helvetica";
      textEl.style.cursor = "move";
      textEl.style.padding = "2px 4px";
      textEl.style.minWidth = "20px";
      textEl.style.outline = "none";
      textEl.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
      textEl.style.borderRadius = "4px";
      textEl.style.border = "1px solid transparent";

      el.appendChild(textEl);
      textEl.addEventListener("mousedown", (e) => this.startDragging(e, id));
      textEl.addEventListener("input", () => this.annotationManager.updateAnnotation(id, { content: textEl.innerText }));
      textEl.addEventListener("focus", () => {
        this.selectedAnnotationId = id;
        textEl.style.borderColor = "var(--primary)";
        textEl.style.backgroundColor = "rgba(255, 255, 255, 0.8)";
        deleteBtn.style.display = "flex";
        this.showPropertiesPanel(id);
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
    } else if (ann.type === "rectangle" || ann.type === "image") {
      el.style.width = `${ann.width}px`;
      el.style.height = `${ann.height}px`;
      el.style.cursor = "move";
      el.style.opacity = (ann.style?.opacity ?? 1).toString();
      if (ann.style?.rotation) {
        el.style.transform = `rotate(${ann.style.rotation}deg)`;
      }

      if (ann.type === "rectangle") {
        el.style.backgroundColor = ann.style?.color || "white";
        el.style.border = `${ann.style?.strokeWidth || 0}px solid black`;
      } else {
        const img = document.createElement("img");
        img.src = ann.content || "";
        img.style.width = "100%"; img.style.height = "100%"; img.style.objectFit = "contain"; img.style.pointerEvents = "none";
        el.appendChild(img);
      }

      const resizer = document.createElement("div");
      resizer.className = "resizer";
      resizer.style.width = "10px"; resizer.style.height = "10px"; resizer.style.backgroundColor = "var(--primary)";
      resizer.style.position = "absolute"; resizer.style.right = "-5px"; resizer.style.bottom = "-5px";
      resizer.style.cursor = "nwse-resize"; resizer.style.borderRadius = "50%"; resizer.style.display = "none";
      el.appendChild(resizer);

      el.addEventListener("mousedown", (e) => {
        if (e.target === resizer) this.startResizing(e, id);
        else this.startDragging(e, id);
      });

      el.tabIndex = 0;
      el.addEventListener("focus", () => {
        this.selectedAnnotationId = id;
        el.style.boxShadow = "0 0 0 2px var(--primary)";
        deleteBtn.style.display = "flex";
        resizer.style.display = "block";
        this.showPropertiesPanel(id);
      });
      el.addEventListener("blur", () => {
        setTimeout(() => {
          if (document.activeElement !== el) {
            el.style.boxShadow = "none"; deleteBtn.style.display = "none"; resizer.style.display = "none";
          }
        }, 200);
      });
    }

    el.appendChild(deleteBtn);
    deleteBtn.addEventListener("click", (e) => { e.stopPropagation(); this.removeAnnotation(id); });
    pageWrapper.appendChild(el);
    if (ann.type === "text") {
      const textEl = el.querySelector("div[contenteditable]");
      setTimeout(() => (textEl as HTMLElement)?.focus(), 50);
    } else {
      setTimeout(() => el.focus(), 50);
    }
  }

  private startResizing(e: MouseEvent, id: string) {
    e.stopPropagation(); e.preventDefault();
    const el = this.querySelector(`.annotation[data-id="${id}"]`) as HTMLElement;
    const startX = e.clientX; const startY = e.clientY;
    const initialWidth = el.offsetWidth; const initialHeight = el.offsetHeight;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dw = moveEvent.clientX - startX; const dh = moveEvent.clientY - startY;
      const newW = Math.max(10, initialWidth + dw); const newH = Math.max(10, initialHeight + dh);
      el.style.width = `${newW}px`; el.style.height = `${newH}px`;
      this.annotationManager.updateAnnotation(id, { width: newW, height: newH });
    };
    const handleMouseUp = () => { document.removeEventListener("mousemove", handleMouseMove); document.removeEventListener("mouseup", handleMouseUp); };
    document.addEventListener("mousemove", handleMouseMove); document.addEventListener("mouseup", handleMouseUp);
  }

  private startDragging(e: MouseEvent, id: string) {
    e.stopPropagation();
    const annElement = this.querySelector(`.annotation[data-id="${id}"]`) as HTMLElement;
    const startX = e.clientX; const startY = e.clientY;
    const initialLeft = parseFloat(annElement.style.left); const initialTop = parseFloat(annElement.style.top);
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX; const dy = moveEvent.clientY - startY;
      const newX = initialLeft + dx; const newY = initialTop + dy;
      annElement.style.left = `${newX}px`; annElement.style.top = `${newY}px`;
      this.annotationManager.updateAnnotation(id, { x: newX, y: newY });
    };
    const handleMouseUp = () => { document.removeEventListener("mousemove", handleMouseMove); document.removeEventListener("mouseup", handleMouseUp); };
    document.addEventListener("mousemove", handleMouseMove); document.addEventListener("mouseup", handleMouseUp);
  }

  async handleSave() {
    if (!this.selectedFile || !this.currentPdfDoc) return;
    try {
      this.updateProgress(10, "Preparing PDF...");
      const arrayBuffer = await this.selectedFile.arrayBuffer();
      const pdfBytes = new Uint8Array(arrayBuffer);
      const annotations = this.annotationManager.getAllAnnotations();
      const scaledAnnotations: Annotation[] = [];
      for (const ann of annotations) {
        const page = await this.currentPdfDoc.getPage(ann.pageIndex + 1);
        const viewport = page.getViewport({ scale: 1.0 });
        const scale = TARGET_WIDTH / viewport.width;
        
        // We pass the raw DOM coordinates to the engine, and let the engine handle the PDF origin inversion
        // OR we do it here. The engine currently does: pdfY = height - ann.y - ...
        // So we just need to scale the DOM pixels to PDF points.
        
        scaledAnnotations.push({
          ...ann,
          x: ann.x / scale,
          y: ann.y / scale,
          width: ann.width ? ann.width / scale : undefined,
          height: ann.height ? ann.height / scale : undefined,
          style: { ...ann.style, fontSize: (ann.style?.fontSize || 16) / scale }
        });
      }
      this.updateProgress(50, "Embedding all annotations...");
      const modifiedPdfBytes = await embedAllAnnotations(pdfBytes, scaledAnnotations);
      this.updateProgress(90, "Saving...");
      const success = await this.savePdf(modifiedPdfBytes, this.selectedFile.name, "_edited");
      if (success) {
        await this.recordJob("Edit", this.selectedFile.name, modifiedPdfBytes, { annotationCount: annotations.length });
        this.updateProgress(100, "Saved!");
      } else { this.updateProgress(0, "Save cancelled"); }
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
      this.initTools();
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
            const scale = TARGET_WIDTH / viewport.width;
      
            await renderPage(this.currentPdfDoc, i, canvas, scale);
    }
  }
}

customElements.define("pdf-editor", PdfEditor);
