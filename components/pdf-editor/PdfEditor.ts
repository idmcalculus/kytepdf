import { type Annotation, AnnotationManager } from "../../utils/AnnotationManager.ts";
import { type HistoryAction, HistoryManager } from "../../utils/HistoryManager.ts";
import { logger } from "../../utils/logger.ts";
import { embedAllAnnotations } from "../../utils/pdfEngine.ts";
import { loadPdf, renderPage } from "../../utils/pdfRenderer.ts";
import { yieldToMain } from "../../utils/taskScheduler.ts";
import { BaseComponent } from "../BaseComponent.ts";
import { FreehandEditor } from "./FreehandEditor";
import { HighlighterEditor } from "./HighlighterEditor";
import { ImageEditor } from "./ImageEditor";
import { RectangleToolEditor } from "./RectangleToolEditor";
import { StrikethroughEditor } from "./StrikethroughEditor";
import { TextEditor } from "./TextEditor";
import type { EditorTool } from "./types";
import { UnderlineEditor } from "./UnderlineEditor";

const TARGET_WIDTH = 800;

type TextSelectionSnapshot = {
  annotationId: string;
  start: number;
  end: number;
};

export class PdfEditor extends BaseComponent {
  protected toolKey = "edit-pdf";
  private historyManager: HistoryManager = new HistoryManager();
  private annotationManager: AnnotationManager = new AnnotationManager(this.historyManager);
  private activeTool: EditorTool | null = null;
  private tools: Map<string, EditorTool> = new Map();
  private selectedAnnotationId: string | null = null;
  private pendingTextSelection: TextSelectionSnapshot | null = null;
  private pointerActiveTool: EditorTool | null = null;
  private pointerPageWrapper: HTMLElement | null = null;
  private suppressNextClick = false;

  connectedCallback() {
    super.connectedCallback();
  }

  private initTools() {
    const context = {
      container: this,
      annotationManager: this.annotationManager,
      pdfDoc: this.currentPdfDoc,
      renderAnnotation: (id: string) => this.renderAnnotation(id),
      showProperties: (id: string) => this.showPropertiesPanel(id),
    };

    this.tools.set("addTextBtn", new TextEditor(context));
    this.tools.set("addRectBtn", new RectangleToolEditor(context));
    this.tools.set("addImageBtn", new ImageEditor(context));
    this.tools.set("addFreehandBtn", new FreehandEditor(context));
    this.tools.set("addHighlightBtn", new HighlighterEditor(context));
    this.tools.set("addStrikeBtn", new StrikethroughEditor(context));
    this.tools.set("addUnderlineBtn", new UnderlineEditor(context));
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
              <button id="addFreehandBtn" class="tool-btn" title="Freehand Draw">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19 7-7 3 3-7 7-3-3z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="m2 2 5 2.5"/><path d="m16 14.5 5 2.5"/></svg>
              </button>
              <button id="addHighlightBtn" class="tool-btn" title="Highlight">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11 6 6"/><path d="m12 8 4-4 4 4-4 4-4-4z"/><path d="M2 20h6"/><path d="M7 20l4-4"/></svg>
              </button>
              <button id="addStrikeBtn" class="tool-btn" title="Strikethrough">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12"/><path d="M7 6h10"/><path d="M7 18h6"/></svg>
              </button>
              <button id="addUnderlineBtn" class="tool-btn" title="Underline">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" y1="20" x2="20" y2="20"/></svg>
              </button>
              <input type="file" id="imageInput" class="hidden" accept="image/png,image/jpeg" />
            </div>
            
            <div class="toolbar-spacer"></div>

            <div class="toolbar-group">
              <button id="undoBtn" class="tool-btn" title="Undo" aria-label="Undo" disabled>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-4"/></svg>
              </button>
              <button id="redoBtn" class="tool-btn" title="Redo" aria-label="Redo" disabled>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h4"/></svg>
              </button>
            </div>
            
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
              <div id="lineProperties" class="prop-section hidden">
                <div class="prop-row">
                  <label>Color</label>
                  <input type="color" id="lineColorPicker" value="#000000">
                </div>
                <div class="prop-row">
                  <label>Width</label>
                  <input type="number" id="lineWidthInput" min="1" max="12" value="2">
                </div>
                <div class="prop-row">
                  <label>Opacity</label>
                  <input type="range" id="lineOpacityInput" min="0" max="1" step="0.1" value="1">
                </div>
              </div>
              <div id="highlightProperties" class="prop-section hidden">
                <div class="prop-row">
                  <label>Color</label>
                  <input type="color" id="highlightColorPicker" value="#ffff00">
                </div>
                <div class="prop-row">
                  <label>Opacity</label>
                  <input type="range" id="highlightOpacityInput" min="0" max="1" step="0.1" value="0.3">
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

    toolBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tool = this.tools.get(btn.id);
        if (btn.id === "addImageBtn") {
          const imageInput = this.querySelector("#imageInput") as HTMLInputElement;
          imageInput.click();
          return;
        }

        if (this.activeTool) this.activeTool.onDeactivate();
        for (const b of toolBtns) {
          b.classList.remove("active");
        }

        if (tool) {
          btn.classList.add("active");
          this.activeTool = tool;
          tool.onActivate();

          workspace.className = "editor-workspace";
          if (btn.id === "addTextBtn") {
            workspace.classList.add("cursor-text-tool");
          } else if (
            btn.id === "addRectBtn" ||
            btn.id === "addFreehandBtn" ||
            btn.id === "addHighlightBtn" ||
            btn.id === "addStrikeBtn" ||
            btn.id === "addUnderlineBtn"
          ) {
            workspace.classList.add("cursor-crosshair");
          }
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
    const lineColorPicker = this.querySelector("#lineColorPicker") as HTMLInputElement;
    const lineWidthInput = this.querySelector("#lineWidthInput") as HTMLInputElement;
    const lineOpacityInput = this.querySelector("#lineOpacityInput") as HTMLInputElement;
    const highlightColorPicker = this.querySelector("#highlightColorPicker") as HTMLInputElement;
    const highlightOpacityInput = this.querySelector("#highlightOpacityInput") as HTMLInputElement;

    const rotateLeftBtn = this.querySelector("#rotateLeftBtn");
    const rotateRightBtn = this.querySelector("#rotateRightBtn");
    const zoomInBtn = this.querySelector("#zoomInBtn");
    const zoomOutBtn = this.querySelector("#zoomOutBtn");
    const resetImageBtn = this.querySelector("#resetImageBtn");
    const undoBtn = this.querySelector("#undoBtn") as HTMLButtonElement | null;
    const redoBtn = this.querySelector("#redoBtn") as HTMLButtonElement | null;

    fontSelect?.addEventListener("change", () =>
      this.updateSelectedAnnotation({ font: fontSelect.value }),
    );
    fontSizeInput?.addEventListener("input", () =>
      this.updateSelectedAnnotation({ fontSize: parseInt(fontSizeInput.value, 10) }),
    );
    colorPicker?.addEventListener("input", () =>
      this.updateSelectedAnnotation({ color: colorPicker.value }),
    );
    shapeFillPicker?.addEventListener("input", () =>
      this.updateSelectedAnnotation({ color: shapeFillPicker.value }),
    );
    shapeBorderInput?.addEventListener("input", () =>
      this.updateSelectedAnnotation({ strokeWidth: parseInt(shapeBorderInput.value, 10) }),
    );
    shapeOpacityInput?.addEventListener("input", () =>
      this.updateSelectedAnnotation({ opacity: parseFloat(shapeOpacityInput.value) }),
    );
    imageOpacityInput?.addEventListener("input", () =>
      this.updateSelectedAnnotation({ opacity: parseFloat(imageOpacityInput.value) }),
    );
    lineColorPicker?.addEventListener("input", () =>
      this.updateSelectedAnnotation({ color: lineColorPicker.value }),
    );
    lineWidthInput?.addEventListener("input", () =>
      this.updateSelectedAnnotation({ strokeWidth: parseInt(lineWidthInput.value, 10) }),
    );
    lineOpacityInput?.addEventListener("input", () =>
      this.updateSelectedAnnotation({ opacity: parseFloat(lineOpacityInput.value) }),
    );
    highlightColorPicker?.addEventListener("input", () =>
      this.updateSelectedAnnotation({ color: highlightColorPicker.value }),
    );
    highlightOpacityInput?.addEventListener("input", () =>
      this.updateSelectedAnnotation({ opacity: parseFloat(highlightOpacityInput.value) }),
    );

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

    const preserveTextSelection = (event: MouseEvent) => {
      const snapshot = this.captureTextSelectionSnapshot();
      if (!snapshot) return;
      this.pendingTextSelection = snapshot;
      event.preventDefault();
    };

    undoBtn?.addEventListener("mousedown", preserveTextSelection);
    redoBtn?.addEventListener("mousedown", preserveTextSelection);
    undoBtn?.addEventListener("click", () => this.handleUndo());
    redoBtn?.addEventListener("click", () => this.handleRedo());
    this.updateHistoryControls();

    window.addEventListener("keydown", (e) => {
      if (this.handleHistoryShortcut(e)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && this.selectedAnnotationId) {
        const activeElement = document.activeElement as HTMLElement | null;
        if (activeElement?.isContentEditable) return;
        this.removeAnnotation(this.selectedAnnotationId);
      }
    });

    this.addEventListener("mousedown", (e) => {
      this.handlePointerDown(e);
    });

    this.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const pageWrapper = target.closest(".pdf-page-wrapper") as HTMLElement;
      if (pageWrapper && this.activeTool) {
        if (this.suppressNextClick) {
          this.suppressNextClick = false;
          return;
        }
        if (
          target.classList.contains("pdf-page-canvas") ||
          target.classList.contains("pdf-page-wrapper")
        ) {
          const rect = pageWrapper.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const pageIndex = parseInt(pageWrapper.dataset.index || "0", 10);
          this.activeTool.onPageClick(pageIndex, x, y);
        }
      }
    });
  }

  private handlePointerDown(event: MouseEvent) {
    const pointerTool = this.activeTool;
    if (!pointerTool?.onPointerDown) return;
    const target = event.target as HTMLElement;
    const pageWrapper = target.closest(".pdf-page-wrapper") as HTMLElement | null;
    if (!pageWrapper) return;
    if (
      !target.classList.contains("pdf-page-canvas") &&
      !target.classList.contains("pdf-page-wrapper")
    ) {
      return;
    }

    event.preventDefault();
    const rect = pageWrapper.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const pageIndex = parseInt(pageWrapper.dataset.index || "0", 10);

    this.pointerActiveTool = pointerTool;
    this.pointerPageWrapper = pageWrapper;
    this.suppressNextClick = true;
    pointerTool.onPointerDown(pageIndex, x, y, event);

    window.addEventListener("mousemove", this.handlePointerMove);
    window.addEventListener("mouseup", this.handlePointerUp);
  }

  private handlePointerMove = (event: MouseEvent) => {
    const pointerTool = this.pointerActiveTool;
    if (!pointerTool?.onPointerMove || !this.pointerPageWrapper) return;
    const rect = this.pointerPageWrapper.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const pageIndex = parseInt(this.pointerPageWrapper.dataset.index || "0", 10);
    pointerTool.onPointerMove(pageIndex, x, y, event);
  };

  private handlePointerUp = (event: MouseEvent) => {
    const pointerTool = this.pointerActiveTool;
    if (pointerTool?.onPointerUp && this.pointerPageWrapper) {
      const rect = this.pointerPageWrapper.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const pageIndex = parseInt(this.pointerPageWrapper.dataset.index || "0", 10);
      pointerTool.onPointerUp(pageIndex, x, y, event);
    }

    window.removeEventListener("mousemove", this.handlePointerMove);
    window.removeEventListener("mouseup", this.handlePointerUp);
    this.pointerActiveTool = null;
    this.pointerPageWrapper = null;
    if (this.suppressNextClick) {
      setTimeout(() => {
        this.suppressNextClick = false;
      }, 0);
    }
  };

  private handleHistoryShortcut(event: KeyboardEvent): boolean {
    if (!(event.ctrlKey || event.metaKey)) return false;
    if (event.key.toLowerCase() !== "z") return false;
    if (this.shouldIgnoreHistoryShortcut()) return false;

    const snapshot = this.captureTextSelectionSnapshot();
    if (snapshot) this.pendingTextSelection = snapshot;

    event.preventDefault();
    if (event.shiftKey) {
      this.handleRedo();
    } else {
      this.handleUndo();
    }
    return true;
  }

  private shouldIgnoreHistoryShortcut(): boolean {
    const activeElement = document.activeElement as HTMLElement | null;
    if (!activeElement) return false;
    if (activeElement.isContentEditable) return true;
    const tagName = activeElement.tagName;
    return (
      tagName === "INPUT" ||
      tagName === "TEXTAREA" ||
      activeElement.getAttribute("role") === "textbox"
    );
  }

  private captureTextSelectionSnapshot(): TextSelectionSnapshot | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    const textElement = this.getContentEditableElement(range);
    if (!textElement) return null;

    const annotationElement = textElement.closest(".annotation") as HTMLElement | null;
    const annotationId = annotationElement?.dataset.id;
    if (!annotationId) return null;

    if (!textElement.contains(range.startContainer) || !textElement.contains(range.endContainer)) {
      return null;
    }

    return {
      annotationId,
      start: this.getTextOffset(textElement, range.startContainer, range.startOffset),
      end: this.getTextOffset(textElement, range.endContainer, range.endOffset),
    };
  }

  private restorePendingTextSelection() {
    if (!this.pendingTextSelection) return;
    const snapshot = this.pendingTextSelection;
    this.pendingTextSelection = null;
    setTimeout(() => this.restoreTextSelection(snapshot), 0);
  }

  private restoreTextSelection(snapshot: TextSelectionSnapshot) {
    const annotationElement = this.querySelector(
      `.annotation[data-id="${snapshot.annotationId}"]`,
    ) as HTMLElement | null;
    const textElement = annotationElement?.querySelector(
      "div[contenteditable]",
    ) as HTMLElement | null;
    if (!textElement) return;

    const textLength = textElement.textContent?.length ?? 0;
    const start = Math.min(snapshot.start, textLength);
    const end = Math.min(snapshot.end, textLength);

    textElement.focus({ preventScroll: true });

    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    this.setRangeByOffsets(textElement, range, start, end);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  private getContentEditableElement(range: Range): HTMLElement | null {
    const startElement =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const endElement =
      range.endContainer.nodeType === Node.ELEMENT_NODE
        ? (range.endContainer as Element)
        : range.endContainer.parentElement;
    const startEditable = startElement?.closest("[contenteditable]");
    const endEditable = endElement?.closest("[contenteditable]");
    if (!startEditable || startEditable !== endEditable) return null;
    if (!(startEditable as HTMLElement).isContentEditable) return null;
    return startEditable as HTMLElement;
  }

  private getTextOffset(root: HTMLElement, node: Node, offset: number): number {
    const range = document.createRange();
    range.setStart(root, 0);
    range.setEnd(node, offset);
    return range.toString().length;
  }

  private setRangeByOffsets(root: HTMLElement, range: Range, start: number, end: number) {
    const textNodes = this.getTextNodes(root);
    if (textNodes.length === 0) {
      range.setStart(root, 0);
      range.setEnd(root, 0);
      return;
    }

    const [startNode, startOffset] = this.findNodeForOffset(textNodes, start);
    const [endNode, endOffset] = this.findNodeForOffset(textNodes, end);
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
  }

  private getTextNodes(root: Node): Text[] {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      nodes.push(current as Text);
      current = walker.nextNode();
    }
    return nodes;
  }

  private findNodeForOffset(nodes: Text[], offset: number): [Text, number] {
    let remaining = offset;
    for (const node of nodes) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) {
        return [node, remaining];
      }
      remaining -= length;
    }
    const last = nodes[nodes.length - 1];
    return [last, last.textContent?.length ?? 0];
  }

  private handleUndo() {
    if (!this.pendingTextSelection) {
      const snapshot = this.captureTextSelectionSnapshot();
      if (snapshot) this.pendingTextSelection = snapshot;
    }
    const action = this.historyManager.undo();
    if (action) this.applyHistoryAction(action, "undo");
    this.updateHistoryControls();
    this.restorePendingTextSelection();
  }

  private handleRedo() {
    if (!this.pendingTextSelection) {
      const snapshot = this.captureTextSelectionSnapshot();
      if (snapshot) this.pendingTextSelection = snapshot;
    }
    const action = this.historyManager.redo();
    if (action) this.applyHistoryAction(action, "redo");
    this.updateHistoryControls();
    this.restorePendingTextSelection();
  }

  private applyHistoryAction(action: HistoryAction, direction: "undo" | "redo") {
    if (action.type === "add") {
      if (direction === "undo") {
        this.removeAnnotation(action.annotationId, { recordHistory: false });
      } else {
        this.restoreAnnotation(action.newState);
      }
      return;
    }

    if (action.type === "remove") {
      if (direction === "undo") {
        this.restoreAnnotation(action.previousState);
      } else {
        this.removeAnnotation(action.annotationId, { recordHistory: false });
      }
      return;
    }

    const targetState = direction === "undo" ? action.previousState : action.newState;
    if (!targetState) return;

    this.annotationManager.updateAnnotation(
      action.annotationId,
      this.getAnnotationUpdates(targetState),
      { recordHistory: false },
    );
    this.refreshAnnotation(action.annotationId);
    this.updateHistoryControls();
  }

  private refreshAnnotation(id: string) {
    const existing = this.querySelector(`.annotation[data-id="${id}"]`);
    if (existing) existing.remove();
    if (this.annotationManager.getAnnotation(id)) {
      this.renderAnnotation(id);
    }
  }

  private restoreAnnotation(state: Annotation | null) {
    if (!state) return;
    const cloned = this.cloneAnnotationState(state);
    const { id, ...ann } = cloned;
    this.annotationManager.addAnnotation(ann, { id, recordHistory: false });
    this.refreshAnnotation(id);
  }

  private cloneAnnotationState(state: Annotation): Annotation {
    return {
      ...state,
      style: state.style ? { ...state.style } : undefined,
      points: state.points ? state.points.map((point) => ({ ...point })) : undefined,
    };
  }

  private getAnnotationUpdates(state: Annotation): Partial<Omit<Annotation, "id" | "pageIndex">> {
    const { id: _id, pageIndex: _pageIndex, ...updates } = this.cloneAnnotationState(state);
    return updates;
  }

  private recordTransformHistory(
    kind: "move" | "resize",
    before: Annotation | null,
    after: Annotation | undefined,
  ) {
    if (!before || !after) return;
    const changed =
      kind === "move"
        ? before.x !== after.x || before.y !== after.y
        : before.width !== after.width || before.height !== after.height;
    if (!changed) return;
    this.historyManager.push({
      type: "update",
      annotationId: after.id,
      previousState: before,
      newState: this.cloneAnnotationState(after),
      timestamp: Date.now(),
    });
    this.updateHistoryControls();
  }

  private updateHistoryControls() {
    const undoBtn = this.querySelector("#undoBtn") as HTMLButtonElement | null;
    const redoBtn = this.querySelector("#redoBtn") as HTMLButtonElement | null;
    if (undoBtn) undoBtn.disabled = !this.historyManager.canUndo();
    if (redoBtn) redoBtn.disabled = !this.historyManager.canRedo();
  }

  private updateSelectedAnnotation(props: any) {
    if (!this.selectedAnnotationId) return;
    const ann = this.annotationManager.getAnnotation(this.selectedAnnotationId);
    if (!ann) return;

    const el = this.querySelector(
      `.annotation[data-id="${this.selectedAnnotationId}"]`,
    ) as HTMLElement;
    if (!el) return;

    if (ann.type === "text") {
      const textEl = el.querySelector("div[contenteditable]") as HTMLElement;
      if (props.fontSize) {
        textEl.style.fontSize = `${props.fontSize}px`;
        this.annotationManager.updateAnnotation(ann.id, {
          style: { ...ann.style, fontSize: props.fontSize },
        });
      }
      if (props.color) {
        textEl.style.color = props.color;
        this.annotationManager.updateAnnotation(ann.id, {
          style: { ...ann.style, color: props.color },
        });
      }
      if (props.font) {
        textEl.style.fontFamily = props.font;
        this.annotationManager.updateAnnotation(ann.id, {
          style: { ...ann.style, font: props.font },
        });
      }
    } else if (ann.type === "rectangle") {
      if (props.color) {
        el.style.backgroundColor = props.color;
        this.annotationManager.updateAnnotation(ann.id, {
          style: { ...ann.style, color: props.color },
        });
      }
      if (props.strokeWidth !== undefined) {
        el.style.borderWidth = `${props.strokeWidth}px`;
        this.annotationManager.updateAnnotation(ann.id, {
          style: { ...ann.style, strokeWidth: props.strokeWidth },
        });
      }
      if (props.opacity !== undefined) {
        el.style.opacity = props.opacity.toString();
        this.annotationManager.updateAnnotation(ann.id, {
          style: { ...ann.style, opacity: props.opacity },
        });
      }
    } else if (ann.type === "image") {
      if (props.opacity !== undefined) {
        el.style.opacity = props.opacity.toString();
        this.annotationManager.updateAnnotation(ann.id, {
          style: { ...ann.style, opacity: props.opacity },
        });
      }
      if (props.rotation !== undefined) {
        el.style.transform = `rotate(${props.rotation}deg)`;
        this.annotationManager.updateAnnotation(ann.id, {
          style: { ...ann.style, rotation: props.rotation },
        });
      }
      if (props.scale !== undefined) {
        // If it's a reset, we use the initial stored dimensions if we have them
        // or just hardcoded 150 for now.
        // For incremental, we multiply existing width.
        const currentW = parseFloat(el.style.width);
        const currentH = parseFloat(el.style.height);

        let newW: number;
        let newH: number;
        if (props.reset) {
          newW = 150;
          newH = 150;
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
    } else if (ann.type === "highlight") {
      if (props.color) {
        el.style.backgroundColor = props.color;
      }
      if (props.opacity !== undefined) {
        el.style.opacity = props.opacity.toString();
      }
      this.annotationManager.updateAnnotation(ann.id, {
        style: {
          ...ann.style,
          color: props.color ?? ann.style?.color,
          opacity: props.opacity ?? ann.style?.opacity,
        },
      });
    } else if (ann.type === "freehand") {
      const path = el.querySelector("path") as SVGPathElement | null;
      if (props.color && path) path.setAttribute("stroke", props.color);
      if (props.strokeWidth !== undefined && path) {
        path.setAttribute("stroke-width", props.strokeWidth.toString());
      }
      if (props.opacity !== undefined && path) {
        path.setAttribute("opacity", props.opacity.toString());
      }
      this.annotationManager.updateAnnotation(ann.id, {
        style: {
          ...ann.style,
          color: props.color ?? ann.style?.color,
          strokeWidth: props.strokeWidth ?? ann.style?.strokeWidth,
          opacity: props.opacity ?? ann.style?.opacity,
        },
      });
    } else if (ann.type === "strikethrough" || ann.type === "underline") {
      const lineEl = el.querySelector(".line-annotation") as HTMLElement | null;
      if (props.color && lineEl) lineEl.style.backgroundColor = props.color;
      if (props.opacity !== undefined && lineEl) {
        lineEl.style.opacity = props.opacity.toString();
      }
      if (props.strokeWidth !== undefined && lineEl) {
        lineEl.style.height = `${props.strokeWidth}px`;
      }
      const strokeWidth = props.strokeWidth ?? ann.style?.strokeWidth ?? 2;
      const containerHeight = parseFloat(el.style.height) || ann.height || strokeWidth;
      const lineTop =
        ann.type === "underline"
          ? Math.max(0, containerHeight - strokeWidth)
          : Math.max(0, containerHeight / 2 - strokeWidth / 2);
      if (lineEl) lineEl.style.top = `${lineTop}px`;
      this.annotationManager.updateAnnotation(ann.id, {
        style: {
          ...ann.style,
          color: props.color ?? ann.style?.color,
          strokeWidth,
          opacity: props.opacity ?? ann.style?.opacity,
        },
      });
    }
    this.updateHistoryControls();
  }

  private showPropertiesPanel(id: string) {
    const ann = this.annotationManager.getAnnotation(id);
    if (!ann) return;

    const panel = this.querySelector("#propertiesPanel");
    const sections = this.querySelectorAll(".prop-section");
    panel?.classList.remove("hidden");
    for (const s of sections) {
      s.classList.add("hidden");
    }

    if (ann.type === "text") {
      this.querySelector("#textProperties")?.classList.remove("hidden");
      (this.querySelector("#fontSizeInput") as HTMLInputElement).value = (
        ann.style?.fontSize || 16
      ).toString();
      (this.querySelector("#colorPicker") as HTMLInputElement).value =
        ann.style?.color || "#000000";
      (this.querySelector("#fontFamilySelect") as HTMLSelectElement).value =
        ann.style?.font || "Helvetica";
    } else if (ann.type === "rectangle") {
      this.querySelector("#shapeProperties")?.classList.remove("hidden");
      (this.querySelector("#shapeFillPicker") as HTMLInputElement).value =
        ann.style?.color || "#ffffff";
      (this.querySelector("#shapeBorderInput") as HTMLInputElement).value = (
        ann.style?.strokeWidth || 0
      ).toString();
      (this.querySelector("#shapeOpacityInput") as HTMLInputElement).value = (
        ann.style?.opacity ?? 1
      ).toString();
    } else if (ann.type === "image") {
      this.querySelector("#imageProperties")?.classList.remove("hidden");
      (this.querySelector("#imageOpacityInput") as HTMLInputElement).value = (
        ann.style?.opacity ?? 1
      ).toString();
    } else if (ann.type === "highlight") {
      this.querySelector("#highlightProperties")?.classList.remove("hidden");
      (this.querySelector("#highlightColorPicker") as HTMLInputElement).value =
        ann.style?.color || "#ffff00";
      (this.querySelector("#highlightOpacityInput") as HTMLInputElement).value = (
        ann.style?.opacity ?? 0.3
      ).toString();
    } else if (
      ann.type === "freehand" ||
      ann.type === "strikethrough" ||
      ann.type === "underline"
    ) {
      this.querySelector("#lineProperties")?.classList.remove("hidden");
      (this.querySelector("#lineColorPicker") as HTMLInputElement).value =
        ann.style?.color || "#000000";
      (this.querySelector("#lineWidthInput") as HTMLInputElement).value = (
        ann.style?.strokeWidth || 2
      ).toString();
      (this.querySelector("#lineOpacityInput") as HTMLInputElement).value = (
        ann.style?.opacity ?? 1
      ).toString();
    }
  }

  private removeAnnotation(id: string, options: { recordHistory?: boolean } = {}) {
    const el = this.querySelector(`.annotation[data-id="${id}"]`);
    if (el) el.remove();
    this.annotationManager.removeAnnotation(id, options);
    this.updateHistoryControls();
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
      textEl.addEventListener("input", () =>
        this.annotationManager.updateAnnotation(id, { content: textEl.innerText }),
      );
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
    } else {
      let width = ann.width ?? 100;
      let height = ann.height ?? 50;
      if (ann.type === "image") {
        width = ann.width ?? 150;
        height = ann.height ?? 150;
      } else if (ann.type === "highlight") {
        width = ann.width ?? 120;
        height = ann.height ?? 24;
      } else if (ann.type === "strikethrough" || ann.type === "underline") {
        width = ann.width ?? 120;
        height = ann.height ?? 12;
      } else if (ann.type === "freehand") {
        width = ann.width ?? 120;
        height = ann.height ?? 80;
      }

      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      el.style.cursor = "move";

      if (ann.type === "rectangle") {
        el.style.backgroundColor = ann.style?.color || "white";
        el.style.border = `${ann.style?.strokeWidth || 0}px solid black`;
        el.style.opacity = (ann.style?.opacity ?? 1).toString();
      } else if (ann.type === "image") {
        el.style.opacity = (ann.style?.opacity ?? 1).toString();
        if (ann.style?.rotation) {
          el.style.transform = `rotate(${ann.style.rotation}deg)`;
        }
        const img = document.createElement("img");
        img.src = ann.content || "";
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "contain";
        img.style.pointerEvents = "none";
        el.appendChild(img);
      } else if (ann.type === "highlight") {
        el.style.backgroundColor = ann.style?.color || "#ffff00";
        el.style.opacity = (ann.style?.opacity ?? 0.3).toString();
        el.style.borderRadius = "2px";
      } else if (ann.type === "freehand") {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", `${width}`);
        svg.setAttribute("height", `${height}`);
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        svg.style.width = "100%";
        svg.style.height = "100%";

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const points = ann.points ?? [];
        if (points.length > 0) {
          const d = points
            .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
            .join(" ");
          path.setAttribute("d", d);
        }
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", ann.style?.color || "#111827");
        path.setAttribute("stroke-width", `${ann.style?.strokeWidth ?? 2}`);
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("opacity", `${ann.style?.opacity ?? 1}`);
        svg.appendChild(path);
        el.appendChild(svg);
      } else if (ann.type === "strikethrough" || ann.type === "underline") {
        const line = document.createElement("div");
        line.className = "line-annotation";
        line.style.position = "absolute";
        line.style.left = "0";
        line.style.right = "0";
        const strokeWidth = ann.style?.strokeWidth ?? 2;
        line.style.height = `${strokeWidth}px`;
        line.style.backgroundColor = ann.style?.color || "#111827";
        line.style.opacity = (ann.style?.opacity ?? 1).toString();
        const lineTop =
          ann.type === "underline"
            ? Math.max(0, height - strokeWidth)
            : Math.max(0, height / 2 - strokeWidth / 2);
        line.style.top = `${lineTop}px`;
        el.appendChild(line);
      }

      const allowResize =
        ann.type === "rectangle" || ann.type === "image" || ann.type === "highlight";
      let resizer: HTMLDivElement | null = null;
      if (allowResize) {
        resizer = document.createElement("div");
        resizer.className = "resizer";
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
      }

      el.addEventListener("mousedown", (e) => {
        if (resizer && e.target === resizer) this.startResizing(e, id);
        else this.startDragging(e, id);
      });

      el.tabIndex = 0;
      el.addEventListener("focus", () => {
        this.selectedAnnotationId = id;
        el.style.boxShadow = "0 0 0 2px var(--primary)";
        deleteBtn.style.display = "flex";
        if (resizer) resizer.style.display = "block";
        this.showPropertiesPanel(id);
      });
      el.addEventListener("blur", () => {
        setTimeout(() => {
          if (typeof document === "undefined") return;
          if (document.activeElement !== el) {
            el.style.boxShadow = "none";
            deleteBtn.style.display = "none";
            if (resizer) resizer.style.display = "none";
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
    if (!this.pendingTextSelection) {
      if (ann.type === "text") {
        const textEl = el.querySelector("div[contenteditable]");
        setTimeout(() => (textEl as HTMLElement)?.focus(), 50);
      } else {
        setTimeout(() => el.focus(), 50);
      }
    }
    this.updateHistoryControls();
  }

  private startResizing(e: MouseEvent, id: string) {
    e.stopPropagation();
    e.preventDefault();
    const el = this.querySelector(`.annotation[data-id="${id}"]`) as HTMLElement;
    const initialState = this.annotationManager.getAnnotation(id);
    const beforeState = initialState ? this.cloneAnnotationState(initialState) : null;
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
      this.annotationManager.updateAnnotation(
        id,
        { width: newW, height: newH },
        { recordHistory: false },
      );
    };
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      const afterState = this.annotationManager.getAnnotation(id);
      this.recordTransformHistory("resize", beforeState, afterState);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  private startDragging(e: MouseEvent, id: string) {
    e.stopPropagation();
    const annElement = this.querySelector(`.annotation[data-id="${id}"]`) as HTMLElement;
    const initialState = this.annotationManager.getAnnotation(id);
    const beforeState = initialState ? this.cloneAnnotationState(initialState) : null;
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
      this.annotationManager.updateAnnotation(id, { x: newX, y: newY }, { recordHistory: false });
    };
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      const afterState = this.annotationManager.getAnnotation(id);
      this.recordTransformHistory("move", beforeState, afterState);
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
      const annotations = this.annotationManager.getAllAnnotations();
      const scaledAnnotations: Annotation[] = [];
      for (const ann of annotations) {
        const page = await this.currentPdfDoc.getPage(ann.pageIndex + 1);
        const viewport = page.getViewport({ scale: 1.0 });
        const scale = TARGET_WIDTH / viewport.width;

        const scaledStyle = ann.style ? { ...ann.style } : undefined;
        if (scaledStyle?.fontSize) scaledStyle.fontSize = scaledStyle.fontSize / scale;
        if (typeof scaledStyle?.strokeWidth === "number") {
          scaledStyle.strokeWidth = scaledStyle.strokeWidth / scale;
        }

        // We pass the raw DOM coordinates to the engine, and let the engine handle the PDF origin inversion
        // OR we do it here. The engine currently does: pdfY = height - ann.y - ...
        // So we just need to scale the DOM pixels to PDF points.

        scaledAnnotations.push({
          ...ann,
          x: ann.x / scale,
          y: ann.y / scale,
          width: ann.width ? ann.width / scale : undefined,
          height: ann.height ? ann.height / scale : undefined,
          points: ann.points
            ? ann.points.map((point) => ({ x: point.x / scale, y: point.y / scale }))
            : undefined,
          style: scaledStyle,
        });
      }
      this.updateProgress(50, "Embedding all annotations...");
      const modifiedPdfBytes = await embedAllAnnotations(pdfBytes, scaledAnnotations);
      this.updateProgress(90, "Saving...");
      const success = await this.savePdf(modifiedPdfBytes, this.selectedFile.name, "_edited");
      if (success) {
        await this.recordJob("Edit", this.selectedFile.name, modifiedPdfBytes, {
          annotationCount: annotations.length,
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
    if (await this.validateFile(file)) {
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
      await yieldToMain();
    }
  }
}

customElements.define("pdf-editor", PdfEditor);
