import {
  type Annotation,
  AnnotationManager,
  type ExtractedSource,
} from "../../utils/AnnotationManager.ts";
import { type HistoryAction, HistoryManager } from "../../utils/HistoryManager.ts";
import { type ExtractedImage, imageExtractor } from "../../utils/ImageExtractor.ts";
import { logger } from "../../utils/logger.ts";
import { destroyPdfDocument } from "../../utils/pdfDocument.ts";
import { EXTRACTED_WHITEOUT_PADDING_PT, embedAllAnnotations } from "../../utils/pdfEngine.ts";
import { loadPdf, renderPage } from "../../utils/pdfRenderer.ts";
import { nearestEditorFont, sanitizeRichText, toPdfFontSizes } from "../../utils/richText.ts";
import { type TextBlock, textBlockExtractor } from "../../utils/TextBlockExtractor.ts";
import { yieldToMain } from "../../utils/taskScheduler.ts";
import { BaseComponent } from "../BaseComponent.ts";
import {
  type FormattingChangeCallback,
  FormattingToolbar,
  fontOptionsHtml,
} from "./FormattingToolbar";
import { FreehandEditor } from "./FreehandEditor";
import { HighlighterEditor } from "./HighlighterEditor";
import { ImageEditor } from "./ImageEditor";
import { RectangleToolEditor } from "./RectangleToolEditor";
import { StrikethroughEditor } from "./StrikethroughEditor";
import { TextEditor } from "./TextEditor";
import type { EditorTool } from "./types";
import { UnderlineEditor } from "./UnderlineEditor";

const TARGET_WIDTH = 800;
/** How much wider a text block's box is drawn than the block, for its padding. */
const TEXT_BLOCK_PADDING = 6;
/** Keystrokes in one text box closer together than this form one undo step. */
const TYPING_PAUSE_MS = 1000;
/** Input events from execCommand formatting (the toolbar, Ctrl+B and so on). */
const FORMATTING_INPUT = /^(format|insert(?:Ordered|Unordered)List$)/;
/** Input types the user types text into (they have their own undo). */
const TEXT_INPUT_TYPES = new Set(["text", "search", "number", "email", "url", "tel", "password"]);

type TextSelectionSnapshot = {
  annotationId: string;
  start: number;
  end: number;
};

type TextAlignment = NonNullable<NonNullable<Annotation["style"]>["textAlign"]>;

/** JSON with object keys sorted, so equal values always compare equal. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}
type AnnotationStyle = NonNullable<Annotation["style"]>;

/** Keystrokes in one text box that are still being added to a single undo step. */
type TypingBurst = {
  annotationId: string;
  action: HistoryAction;
  lastInputAt: number;
};

/** History that tells the editor whenever any step is recorded. */
class EditorHistory extends HistoryManager {
  constructor(private readonly onPush: () => void) {
    super();
  }

  push(action: HistoryAction): void {
    this.onPush();
    super.push(action);
  }
}

export class PdfEditor extends BaseComponent {
  protected toolKey = "edit-pdf";
  private typingBurst: TypingBurst | null = null;
  /** The browser's formatting step for the toolbar click being handled. */
  private formattingStep: { annotationId: string; action: HistoryAction } | null = null;
  // Any other recorded step ends the current typing burst.
  private historyManager: HistoryManager = new EditorHistory(() => {
    this.typingBurst = null;
    this.formattingStep = null;
  });
  private annotationManager: AnnotationManager = new AnnotationManager(this.historyManager);
  /** Editor pixels per PDF point, per page index. */
  private pageScales: Map<number, number> = new Map();
  private activeTool: EditorTool | null = null;
  private tools: Map<string, EditorTool> = new Map();
  private selectedAnnotationId: string | null = null;
  private pendingTextSelection: TextSelectionSnapshot | null = null;
  private pointerActiveTool: EditorTool | null = null;
  private pointerPageWrapper: HTMLElement | null = null;
  private suppressNextClick = false;
  private formattingToolbar: FormattingToolbar | null = null;
  private extractedBlocks: Map<number, TextBlock[]> = new Map();
  /** How each extracted text block and image looked when extracted (see recordExtracted). */
  private extractedSnapshots: Map<string, { kind: "text" | "image"; state: string }> = new Map();
  /** Whether the user has been told that covered text stays in the saved file. */
  private coveredTextNoticeShown = false;

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    this.formattingToolbar?.destroy();
    this.formattingToolbar = null;
    // Free the parsed document and its pdf.js worker; page loops still
    // running for it stop at their next page.
    this.releasePdfDocument();
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("mousemove", this.handlePointerMove);
    window.removeEventListener("mouseup", this.handlePointerUp);
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

          <div id="formattingToolbarContainer" class="formatting-toolbar-container"></div>

          <div id="editorNotice" class="warning hidden" role="status"></div>

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
                    ${fontOptionsHtml()}
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
        // Undo and redo share the tool-btn class but are not drawing tools;
        // they must not switch off the tool the user has selected.
        if (!tool) return;

        const wasActive = this.activeTool === tool;
        this.deactivateTool();
        // Clicking the active tool again switches it off.
        if (wasActive) return;

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

    window.addEventListener("keydown", this.handleKeyDown);

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
        if (this.isPageSurface(target)) {
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
    if (!this.isPageSurface(target)) return;

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

  /**
   * Where a page tool may draw or place: the page itself, or an image
   * extracted from it (a scanned page is one big extracted image).
   */
  private isPageSurface(target: HTMLElement): boolean {
    return (
      target.classList.contains("pdf-page-canvas") ||
      target.classList.contains("pdf-page-wrapper") ||
      Boolean(target.closest('.annotation-image[data-extracted="true"]'))
    );
  }

  /** Switch the active page tool off, if one is on. */
  private deactivateTool() {
    this.activeTool?.onDeactivate();
    this.activeTool = null;
    for (const b of this.querySelectorAll(".tool-btn")) b.classList.remove("active");
    const workspace = this.querySelector(".editor-workspace");
    if (workspace) workspace.className = "editor-workspace";
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (this.handleHistoryShortcut(e)) return;
    const activeElement = document.activeElement as HTMLElement | null;
    if (e.key === "Escape" && this.activeTool && !this.isTextEntry(activeElement)) {
      this.deactivateTool();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && this.selectedAnnotationId) {
      // Delete only what has focus: not a box the user has clicked away
      // from, and not while typing or choosing in a field.
      const selectedEl = this.querySelector(`.annotation[data-id="${this.selectedAnnotationId}"]`);
      if (!selectedEl?.contains(activeElement)) return;
      if (this.isFormField(activeElement)) return;
      this.removeAnnotation(this.selectedAnnotationId);
    }
  };

  private handleHistoryShortcut(event: KeyboardEvent): boolean {
    if (!(event.ctrlKey || event.metaKey)) return false;
    if (event.key.toLowerCase() !== "z") return false;
    // Text fields have their own undo; sliders, colour pickers and lists do
    // not, so the editor's undo applies there.
    if (this.isTextEntry(document.activeElement as HTMLElement | null)) return false;

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

  /** A field the user types text into, which has its own undo. */
  private isTextEntry(el: HTMLElement | null): boolean {
    if (!el) return false;
    if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
    if (el.getAttribute("role") === "textbox") return true;
    return el.tagName === "INPUT" && TEXT_INPUT_TYPES.has((el as HTMLInputElement).type);
  }

  /** Any form control or text field, where Delete and Backspace act on the field. */
  private isFormField(el: HTMLElement | null): boolean {
    if (!el) return false;
    return this.isTextEntry(el) || ["INPUT", "SELECT", "BUTTON"].includes(el.tagName);
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
    this.typingBurst = null;
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
    this.typingBurst = null;
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
    // Undo must give back the earlier state exactly: a field it did not have
    // yet (say richContent, added by the first edit) is cleared, not kept.
    const current = this.annotationManager.getAnnotation(state.id) ?? {};
    for (const key of Object.keys(current)) {
      if (key !== "id" && key !== "pageIndex" && !(key in updates)) {
        (updates as Record<string, unknown>)[key] = undefined;
      }
    }
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

  /**
   * Store an edit typed into a text box. Keystrokes in the same box join the
   * undo step already on the stack until the user pauses, leaves the box, or
   * does anything else that records history (which ends the burst).
   */
  private recordTyping(id: string, updates: Partial<Omit<Annotation, "id" | "pageIndex">>) {
    const before = this.annotationManager.getAnnotation(id);
    if (!before) return;
    const now = Date.now();
    const burst = this.typingBurst;
    const continuing =
      burst !== null && burst.annotationId === id && now - burst.lastInputAt < TYPING_PAUSE_MS;
    const previousState = continuing ? null : this.cloneAnnotationState(before);

    this.annotationManager.updateAnnotation(id, updates, { recordHistory: false });
    const after = this.cloneAnnotationState(this.annotationManager.getAnnotation(id) as Annotation);

    if (continuing) {
      // The step is still the newest one on the undo stack (any other push
      // would have ended the burst), so widening it in place is safe.
      burst.action.newState = after;
      burst.lastInputAt = now;
      return;
    }

    const action: HistoryAction = {
      type: "update",
      annotationId: id,
      previousState,
      newState: after,
      timestamp: now,
    };
    this.historyManager.push(action);
    this.typingBurst = { annotationId: id, action, lastInputAt: now };
  }

  /**
   * Store a formatting change the browser made (an execCommand from the
   * toolbar, or a shortcut such as Ctrl+B) as its own undo step. The toolbar
   * reports the same click straight after, and applyToolbarFormatting widens
   * this step rather than adding a second one.
   */
  private recordFormatting(id: string, updates: Partial<Omit<Annotation, "id" | "pageIndex">>) {
    const before = this.annotationManager.getAnnotation(id);
    if (!before) return;
    const previousState = this.cloneAnnotationState(before);
    this.annotationManager.updateAnnotation(id, updates, { recordHistory: false });
    const action: HistoryAction = {
      type: "update",
      annotationId: id,
      previousState,
      newState: this.cloneAnnotationState(this.annotationManager.getAnnotation(id) as Annotation),
      timestamp: Date.now(),
    };
    this.historyManager.push(action);
    this.formattingStep = { annotationId: id, action };
    // Only the toolbar's report of this same click may widen the step.
    queueMicrotask(() => {
      if (this.formattingStep?.action === action) this.formattingStep = null;
    });
  }

  /**
   * Once focus has left the annotation, the properties panel and the
   * formatting toolbar, nothing is selected: Delete, the panel and the
   * toolbar must not act on a box the user has clicked away from.
   */
  private releaseSelectionIfFocusLeft(id: string) {
    if (this.selectedAnnotationId !== id) return;
    const active = document.activeElement;
    const stillEditing = [
      `.annotation[data-id="${id}"]`,
      "#propertiesPanel",
      ".formatting-toolbar",
    ].some((selector) => this.querySelector(selector)?.contains(active));
    if (stillEditing) return;
    this.selectedAnnotationId = null;
    this.querySelector("#propertiesPanel")?.classList.add("hidden");
  }

  /** Space above the text: the box's own 2px top padding plus the spacing. */
  private applyParagraphSpacing(textEl: HTMLElement, spacing: number) {
    textEl.style.paddingTop = `${2 + spacing}px`;
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

    // Gather every change into one update, so properties applied together all
    // survive and undo as a single step.
    const style: AnnotationStyle = { ...ann.style };
    const updates: Partial<Omit<Annotation, "id" | "pageIndex">> = {};
    let styleChanged = false;
    const setStyle = (changes: Partial<AnnotationStyle>) => {
      Object.assign(style, changes);
      styleChanged = true;
    };
    const isText = ann.type === "text" || ann.type === "textblock";

    if (isText) {
      const textEl = el.querySelector("div[contenteditable]") as HTMLElement;
      if (props.fontSize) {
        textEl.style.fontSize = `${props.fontSize}px`;
        setStyle({ fontSize: props.fontSize });
      }
      if (props.color) {
        textEl.style.color = props.color;
        setStyle({ color: props.color });
      }
      if (props.font) {
        const font = nearestEditorFont(props.font);
        textEl.style.fontFamily = font.css;
        setStyle({ font: font.value });
      }
      if (props.textAlign) {
        textEl.style.textAlign = props.textAlign;
        setStyle({ textAlign: props.textAlign });
      }
      if (props.lineHeight) {
        textEl.style.lineHeight = props.lineHeight.toString();
        setStyle({ lineHeight: props.lineHeight });
      }
      if (props.bold !== undefined) {
        textEl.style.fontWeight = props.bold ? "bold" : "normal";
        setStyle({ bold: props.bold });
      }
      if (props.italic !== undefined) {
        textEl.style.fontStyle = props.italic ? "italic" : "normal";
        setStyle({ italic: props.italic });
      }
    } else if (ann.type === "rectangle") {
      if (props.color) {
        el.style.backgroundColor = props.color;
        setStyle({ color: props.color });
      }
      if (props.strokeWidth !== undefined) {
        el.style.borderWidth = `${props.strokeWidth}px`;
        setStyle({ strokeWidth: props.strokeWidth });
      }
      if (props.opacity !== undefined) {
        el.style.opacity = props.opacity.toString();
        setStyle({ opacity: props.opacity });
      }
    } else if (ann.type === "image") {
      if (props.opacity !== undefined) {
        el.style.opacity = props.opacity.toString();
        setStyle({ opacity: props.opacity });
      }
      if (props.rotation !== undefined) {
        el.style.transform = `rotate(${props.rotation}deg)`;
        setStyle({ rotation: props.rotation });
      }
      if (props.scale !== undefined) {
        // A reset returns to the default 150px box; otherwise scale the
        // current size, kept between 20px and 800px.
        const currentW = parseFloat(el.style.width);
        const currentH = parseFloat(el.style.height);
        const newW = Math.max(20, Math.min(800, props.reset ? 150 : currentW * props.scale));
        const newH = Math.max(20, Math.min(800, props.reset ? 150 : currentH * props.scale));
        el.style.width = `${newW}px`;
        el.style.height = `${newH}px`;
        updates.width = newW;
        updates.height = newH;
      }
    } else if (ann.type === "highlight") {
      if (props.color) el.style.backgroundColor = props.color;
      if (props.opacity !== undefined) el.style.opacity = props.opacity.toString();
      if (props.color || props.opacity !== undefined) {
        setStyle({
          color: props.color ?? style.color,
          opacity: props.opacity ?? style.opacity,
        });
      }
    } else if (ann.type === "freehand") {
      const path = el.querySelector("path") as SVGPathElement | null;
      if (props.color && path) path.setAttribute("stroke", props.color);
      if (props.strokeWidth !== undefined && path) {
        path.setAttribute("stroke-width", props.strokeWidth.toString());
      }
      if (props.opacity !== undefined && path) {
        path.setAttribute("opacity", props.opacity.toString());
      }
      if (props.color || props.strokeWidth !== undefined || props.opacity !== undefined) {
        setStyle({
          color: props.color ?? style.color,
          strokeWidth: props.strokeWidth ?? style.strokeWidth,
          opacity: props.opacity ?? style.opacity,
        });
      }
    } else if (ann.type === "strikethrough" || ann.type === "underline") {
      const lineEl = el.querySelector(".line-annotation") as HTMLElement | null;
      if (props.color && lineEl) lineEl.style.backgroundColor = props.color;
      if (props.opacity !== undefined && lineEl) {
        lineEl.style.opacity = props.opacity.toString();
      }
      if (props.strokeWidth !== undefined && lineEl) {
        lineEl.style.height = `${props.strokeWidth}px`;
      }
      const strokeWidth = props.strokeWidth ?? style.strokeWidth ?? 2;
      const containerHeight = parseFloat(el.style.height) || ann.height || strokeWidth;
      const lineTop =
        ann.type === "underline"
          ? Math.max(0, containerHeight - strokeWidth)
          : Math.max(0, containerHeight / 2 - strokeWidth / 2);
      if (lineEl) lineEl.style.top = `${lineTop}px`;
      if (props.color || props.strokeWidth !== undefined || props.opacity !== undefined) {
        setStyle({
          color: props.color ?? style.color,
          strokeWidth,
          opacity: props.opacity ?? style.opacity,
        });
      }
    }

    if (styleChanged) updates.style = style;
    if (Object.keys(updates).length > 0) {
      this.annotationManager.updateAnnotation(ann.id, updates);
    }
    if (isText) {
      // Keep the formatting toolbar showing what the properties panel set.
      this.syncFormattingToolbar(ann.id);
    }
    this.updateHistoryControls();
  }

  /** Show the given text box's current style in the formatting toolbar. */
  private syncFormattingToolbar(id: string) {
    const ann = this.annotationManager.getAnnotation(id);
    if (!ann || !this.formattingToolbar) return;
    this.formattingToolbar.updateFromAnnotation(ann.style, this.getPageScale(ann.pageIndex));
  }

  /** Editor pixels per PDF point on a page (1 until the page is rendered). */
  private getPageScale(pageIndex: number): number {
    return this.pageScales.get(pageIndex) ?? 1;
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

    if (ann.type === "text" || ann.type === "textblock") {
      this.querySelector("#textProperties")?.classList.remove("hidden");
      (this.querySelector("#fontSizeInput") as HTMLInputElement).value = (
        ann.style?.fontSize || 16
      ).toString();
      (this.querySelector("#colorPicker") as HTMLInputElement).value =
        ann.style?.color || "#000000";
      (this.querySelector("#fontFamilySelect") as HTMLSelectElement).value = nearestEditorFont(
        ann.style?.font,
      ).value;
      this.syncFormattingToolbar(id);
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

  /**
   * Draw an annotation on its page. By default it takes focus (and so the
   * selection) shortly afterwards; pass `focus: false` for content the user
   * did not just create, such as text and images extracted on load.
   */
  private renderAnnotation(id: string, options: { focus?: boolean } = {}) {
    const ann = this.annotationManager.getAnnotation(id);
    if (!ann) return;

    const pageWrapper = this.querySelector(`.pdf-page-wrapper[data-index="${ann.pageIndex}"]`);
    if (!pageWrapper) return;

    const el = document.createElement("div");
    el.className = `annotation annotation-${ann.type}`;
    el.dataset.id = id;
    if (ann.extracted) el.dataset.extracted = "true";
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

    if (ann.type === "text" || ann.type === "textblock") {
      const isTextBlock = ann.type === "textblock";
      el.style.cursor = "default";
      const textEl = document.createElement("div");
      textEl.contentEditable = "true";
      textEl.setAttribute("contenteditable", "true");

      if (ann.richContent) {
        // Stored rich text is replayed as live markup, so re-sanitize on the
        // way out as well as on the way in — older sessions may hold content
        // persisted before capture-side sanitizing existed.
        textEl.innerHTML = sanitizeRichText(ann.richContent);
      } else {
        // biome-ignore lint/performance/useDomNodeTextContent: innerText turns the content's line breaks into <br>; textContent would not.
        textEl.innerText = ann.content || "";
      }

      textEl.style.color = ann.style?.color || "black";
      textEl.style.fontSize = `${ann.style?.fontSize || 16}px`;
      // Shown with the CSS stack of the family the PDF export draws it with.
      textEl.style.fontFamily = nearestEditorFont(ann.style?.font).css;
      textEl.style.cursor = "text";
      textEl.style.minWidth = "20px";
      textEl.style.outline = "none";
      textEl.style.borderRadius = "2px";
      textEl.style.lineHeight = `${ann.style?.lineHeight || 1.4}`;
      textEl.style.wordWrap = "break-word";
      textEl.style.whiteSpace = "pre-wrap";

      if (isTextBlock) {
        // Extracted text blocks get FULLY OPAQUE white background to completely cover canvas text
        textEl.style.backgroundColor = "white";
        textEl.style.border = "1px dashed transparent";
        textEl.style.padding = "2px 3px";
        textEl.style.margin = "0";
        textEl.style.boxSizing = "border-box";

        // Set precise dimensions matching the extracted text area
        if (ann.width) {
          el.style.width = `${ann.width + TEXT_BLOCK_PADDING}px`; // Small padding compensation
          textEl.style.width = "100%";
        }
        if (ann.height) {
          textEl.style.minHeight = `${ann.height}px`;
        }
        if (ann.style?.textAlign) {
          textEl.style.textAlign = ann.style.textAlign;
        }
        if (ann.style?.bold && !ann.richContent) {
          textEl.style.fontWeight = "bold";
        }
        if (ann.style?.italic && !ann.richContent) {
          textEl.style.fontStyle = "italic";
        }
      } else {
        textEl.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
        textEl.style.border = "1px solid transparent";
        textEl.style.padding = "2px 4px";
      }
      if (ann.style?.paragraphSpacing) {
        this.applyParagraphSpacing(textEl, ann.style.paragraphSpacing);
      }

      el.appendChild(textEl);
      el.addEventListener("mousemove", (e) => {
        if (this.isAnnotationControl(e.target)) return;
        this.updateTextBoxCursor(e, el, textEl);
      });
      el.addEventListener("mouseleave", () => {
        el.style.cursor = "default";
        textEl.style.cursor = "text";
      });
      el.addEventListener("mousedown", (e) => {
        if (this.isAnnotationControl(e.target)) return;
        if (!this.isTextDragEdge(e, el)) return;

        e.preventDefault();
        this.startDragging(e, id);
      });

      textEl.addEventListener("input", (event) => {
        // Both kinds of text box keep their formatting, so it survives undo
        // and reaches the saved PDF.
        const updates = {
          // Pasted markup lands here verbatim; strip it to the allowlisted
          // formatting subset before it is persisted.
          richContent: sanitizeRichText(textEl.innerHTML),
          // biome-ignore lint/performance/useDomNodeTextContent: innerText keeps the line breaks between a box's lines; textContent joins them.
          content: textEl.innerText,
        };
        // Formatting by execCommand (the toolbar, or Ctrl+B) is its own undo
        // step, never merged with typing.
        if (FORMATTING_INPUT.test((event as InputEvent).inputType ?? "")) {
          this.recordFormatting(id, updates);
        } else {
          this.recordTyping(id, updates);
        }
        // The edit was recorded in history, so Undo must become clickable.
        this.updateHistoryControls();
      });

      textEl.addEventListener("focus", () => {
        this.selectedAnnotationId = id;
        textEl.style.borderColor = "var(--primary)";
        if (isTextBlock) {
          textEl.style.borderStyle = "dashed";
          textEl.style.backgroundColor = "rgba(255, 255, 255, 1)";
          textEl.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
        } else {
          textEl.style.backgroundColor = "rgba(255, 255, 255, 0.8)";
        }
        deleteBtn.style.display = "flex";
        // showPropertiesPanel also fills the toolbar from the box's current style.
        this.formattingToolbar?.show();
        this.showPropertiesPanel(id);
        this.updateMeasurementGuides(pageWrapper as HTMLElement, el);
      });

      textEl.addEventListener("blur", () => {
        // Leaving the box ends its typing burst: typing again is a new undo step.
        if (this.typingBurst?.annotationId === id) this.typingBurst = null;
        setTimeout(() => {
          if (document.activeElement !== textEl) {
            deleteBtn.style.display = "none";
            if (isTextBlock) {
              textEl.style.borderColor = "transparent";
              textEl.style.borderStyle = "dashed";
              textEl.style.backgroundColor = "white"; // Keep fully opaque
              textEl.style.boxShadow = "none";
            } else {
              textEl.style.borderColor = "transparent";
              textEl.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
            }
            this.clearMeasurementGuides(pageWrapper as HTMLElement);
            this.releaseSelectionIfFocusLeft(id);
          }
        }, 200);
      });

      // Handle hover to show dashed border (like pdfFiller)
      if (isTextBlock) {
        textEl.addEventListener("mouseenter", () => {
          if (this.selectedAnnotationId !== id) {
            textEl.style.borderColor = "rgba(99, 102, 241, 0.5)";
          }
        });
        textEl.addEventListener("mouseleave", () => {
          if (this.selectedAnnotationId !== id) {
            textEl.style.borderColor = "transparent";
          }
        });

        // Add resize handles for text blocks (all corners + edges)
        const resizeHandles = this.createResizeHandles(el, id);
        for (const handle of resizeHandles) {
          el.appendChild(handle);
        }

        // Show/hide resize handles on focus/blur
        textEl.addEventListener("focus", () => {
          for (const h of el.querySelectorAll(".textblock-resize-handle")) {
            (h as HTMLElement).style.display = "block";
          }
        });
        textEl.addEventListener("blur", () => {
          setTimeout(() => {
            if (document.activeElement !== textEl) {
              for (const h of el.querySelectorAll(".textblock-resize-handle")) {
                (h as HTMLElement).style.display = "none";
              }
            }
          }, 200);
        });
      }
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
        // With a page tool on, an image extracted from the page is part of the
        // page: the press goes to the tool (a scan covers the whole page).
        if (ann.extracted && ann.type === "image" && this.activeTool) {
          e.preventDefault();
          return;
        }
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
            this.releaseSelectionIfFocusLeft(id);
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
    if (options.focus !== false && !this.pendingTextSelection) {
      if (ann.type === "text") {
        const textEl = el.querySelector("div[contenteditable]");
        setTimeout(() => (textEl as HTMLElement)?.focus(), 50);
      } else {
        setTimeout(() => el.focus(), 50);
      }
    }
    this.updateHistoryControls();
  }

  private isAnnotationControl(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      Boolean(target.closest(".textblock-resize-handle, .resizer, .ann-delete-btn"))
    );
  }

  private isTextDragEdge(event: MouseEvent, annotationEl: HTMLElement): boolean {
    const rect = annotationEl.getBoundingClientRect();
    const width = rect.width || annotationEl.offsetWidth;
    const height = rect.height || annotationEl.offsetHeight;
    if (width <= 0 || height <= 0) return false;

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const edgeSize = Math.min(8, width / 3, height / 3);

    return x <= edgeSize || y <= edgeSize || width - x <= edgeSize || height - y <= edgeSize;
  }

  private updateTextBoxCursor(event: MouseEvent, annotationEl: HTMLElement, textEl: HTMLElement) {
    const cursor = this.isTextDragEdge(event, annotationEl) ? "move" : "text";
    annotationEl.style.cursor = cursor === "move" ? "move" : "default";
    textEl.style.cursor = cursor;
  }

  /**
   * Create resize handles for text block annotations (corners + edges).
   */
  private createResizeHandles(containerEl: HTMLElement, annotationId: string): HTMLElement[] {
    const handles: HTMLElement[] = [];
    const positions = [
      { cursor: "nw-resize", top: "-4px", left: "-4px", dir: "nw" },
      { cursor: "ne-resize", top: "-4px", right: "-4px", dir: "ne" },
      { cursor: "sw-resize", bottom: "-4px", left: "-4px", dir: "sw" },
      { cursor: "se-resize", bottom: "-4px", right: "-4px", dir: "se" },
      { cursor: "n-resize", top: "-4px", left: "50%", transform: "translateX(-50%)", dir: "n" },
      {
        cursor: "s-resize",
        bottom: "-4px",
        left: "50%",
        transform: "translateX(-50%)",
        dir: "s",
      },
      { cursor: "e-resize", right: "-4px", top: "50%", transform: "translateY(-50%)", dir: "e" },
      { cursor: "w-resize", left: "-4px", top: "50%", transform: "translateY(-50%)", dir: "w" },
    ];

    for (const pos of positions) {
      const handle = document.createElement("div");
      handle.className = "textblock-resize-handle";
      handle.dataset.dir = pos.dir;
      handle.style.position = "absolute";
      handle.style.width = "8px";
      handle.style.height = "8px";
      handle.style.background = "var(--primary, #6366f1)";
      handle.style.border = "1px solid white";
      handle.style.borderRadius = "2px";
      handle.style.cursor = pos.cursor;
      handle.style.zIndex = "120";
      handle.style.display = "none";

      if ("top" in pos && pos.top) handle.style.top = pos.top;
      if ("bottom" in pos && pos.bottom) handle.style.bottom = pos.bottom;
      if ("left" in pos && pos.left) handle.style.left = pos.left;
      if ("right" in pos && pos.right) handle.style.right = pos.right;
      if ("transform" in pos && pos.transform) handle.style.transform = pos.transform;

      handle.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.startTextBlockResize(e, annotationId, containerEl, pos.dir);
      });

      handles.push(handle);
    }

    return handles;
  }

  /**
   * Handle text block resize from any direction.
   */
  private startTextBlockResize(e: MouseEvent, id: string, el: HTMLElement, direction: string) {
    const initialState = this.annotationManager.getAnnotation(id);
    const beforeState = initialState ? this.cloneAnnotationState(initialState) : null;
    const pageWrapper = el.closest(".pdf-page-wrapper") as HTMLElement | null;
    const startX = e.clientX;
    const startY = e.clientY;
    const initialWidth = el.offsetWidth;
    const initialHeight = el.offsetHeight;
    const initialLeft = parseFloat(el.style.left) || 0;
    const initialTop = parseFloat(el.style.top) || 0;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      let newWidth = initialWidth;
      let newHeight = initialHeight;
      let newLeft = initialLeft;
      let newTop = initialTop;

      // Horizontal resizing
      if (direction.includes("e")) {
        newWidth = Math.max(40, initialWidth + dx);
      }
      // When shrinking from the left or top, move that edge only as far as
      // the size actually shrank, so a clamped box keeps its opposite edge.
      if (direction.includes("w")) {
        newWidth = Math.max(40, initialWidth - dx);
        newLeft = initialLeft + (initialWidth - newWidth);
      }

      // Vertical resizing
      if (direction.includes("s")) {
        newHeight = Math.max(20, initialHeight + dy);
      }
      if (direction.includes("n")) {
        newHeight = Math.max(20, initialHeight - dy);
        newTop = initialTop + (initialHeight - newHeight);
      }

      el.style.width = `${newWidth}px`;
      el.style.left = `${newLeft}px`;
      el.style.top = `${newTop}px`;

      // Update the text element height
      const textEl = el.querySelector("[contenteditable]") as HTMLElement;
      if (textEl) {
        textEl.style.minHeight = `${newHeight}px`;
      }

      this.annotationManager.updateAnnotation(
        id,
        // The box is drawn TEXT_BLOCK_PADDING wider than the text block it
        // holds (see renderAnnotation), so store the block's own width.
        { width: newWidth - TEXT_BLOCK_PADDING, height: newHeight, x: newLeft, y: newTop },
        { recordHistory: false },
      );
      this.updateMeasurementGuides(pageWrapper, el);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      this.updateMeasurementGuides(pageWrapper, el);
      const afterState = this.annotationManager.getAnnotation(id);
      this.recordTransformHistory("resize", beforeState, afterState);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
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

    // Get alignment targets from other annotations on the same page
    const ann = this.annotationManager.getAnnotation(id);
    const pageIndex = ann?.pageIndex ?? 0;
    const pageWrapper = annElement.closest(".pdf-page-wrapper") as HTMLElement;
    const alignTargets = this.getAlignmentTargets(id, pageIndex);
    const snapThreshold = 5; // px threshold for snapping

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      let newX = initialLeft + dx;
      const newY = initialTop + dy;
      const elWidth = annElement.offsetWidth;

      // Calculate edges and center of the dragged element
      const dragLeft = newX;
      const dragCenter = newX + elWidth / 2;
      const dragRight = newX + elWidth;

      // Check alignment against all targets and snap if within threshold
      let snappedX: number | null = null;
      const activeGuides: number[] = [];

      for (const target of alignTargets) {
        // Left edge aligns with target left
        if (Math.abs(dragLeft - target.left) < snapThreshold) {
          snappedX = target.left;
          activeGuides.push(target.left);
        }
        // Left edge aligns with target center
        if (Math.abs(dragLeft - target.center) < snapThreshold) {
          snappedX = target.center;
          activeGuides.push(target.center);
        }
        // Left edge aligns with target right
        if (Math.abs(dragLeft - target.right) < snapThreshold) {
          snappedX = target.right;
          activeGuides.push(target.right);
        }
        // Center aligns with target left
        if (Math.abs(dragCenter - target.left) < snapThreshold) {
          snappedX = target.left - elWidth / 2;
          activeGuides.push(target.left);
        }
        // Center aligns with target center
        if (Math.abs(dragCenter - target.center) < snapThreshold) {
          snappedX = target.center - elWidth / 2;
          activeGuides.push(target.center);
        }
        // Center aligns with target right
        if (Math.abs(dragCenter - target.right) < snapThreshold) {
          snappedX = target.right - elWidth / 2;
          activeGuides.push(target.right);
        }
        // Right edge aligns with target left
        if (Math.abs(dragRight - target.left) < snapThreshold) {
          snappedX = target.left - elWidth;
          activeGuides.push(target.left);
        }
        // Right edge aligns with target center
        if (Math.abs(dragRight - target.center) < snapThreshold) {
          snappedX = target.center - elWidth;
          activeGuides.push(target.center);
        }
        // Right edge aligns with target right
        if (Math.abs(dragRight - target.right) < snapThreshold) {
          snappedX = target.right - elWidth;
          activeGuides.push(target.right);
        }
      }

      // Apply snap if found
      if (snappedX !== null) {
        newX = snappedX;
      }

      annElement.style.left = `${newX}px`;
      annElement.style.top = `${newY}px`;
      this.annotationManager.updateAnnotation(id, { x: newX, y: newY }, { recordHistory: false });

      // Show/update alignment guide lines
      this.updateAlignmentGuides(pageWrapper, activeGuides);
      this.updateMeasurementGuides(pageWrapper, annElement);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      // Remove all alignment guides
      this.clearAlignmentGuides(pageWrapper);
      this.updateMeasurementGuides(pageWrapper, annElement);
      const afterState = this.annotationManager.getAnnotation(id);
      this.recordTransformHistory("move", beforeState, afterState);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  /**
   * Get alignment targets (left, center, right x-positions) of all annotations
   * on the same page, excluding the one being dragged.
   */
  private getAlignmentTargets(
    excludeId: string,
    pageIndex: number,
  ): Array<{ left: number; center: number; right: number }> {
    const annotations = this.annotationManager.getAnnotations(pageIndex);
    const targets: Array<{ left: number; center: number; right: number }> = [];

    for (const ann of annotations) {
      if (ann.id === excludeId) continue;
      const el = this.querySelector(`.annotation[data-id="${ann.id}"]`) as HTMLElement;
      if (!el) continue;

      const left = parseFloat(el.style.left) || ann.x;
      const width = el.offsetWidth || ann.width || 100;
      targets.push({
        left,
        center: left + width / 2,
        right: left + width,
      });
    }

    return targets;
  }

  /**
   * Show vertical alignment guide lines on the page wrapper.
   * Guides are red dotted vertical lines spanning the full page height.
   */
  private updateAlignmentGuides(pageWrapper: HTMLElement | null, positions: number[]) {
    if (!pageWrapper) return;

    // Remove existing guides
    this.clearAlignmentGuides(pageWrapper);

    if (positions.length === 0) return;

    // Deduplicate positions (within 1px)
    const uniquePositions: number[] = [];
    for (const pos of positions) {
      if (!uniquePositions.some((p) => Math.abs(p - pos) < 1)) {
        uniquePositions.push(pos);
      }
    }

    // Create guide lines
    for (const x of uniquePositions) {
      const guide = document.createElement("div");
      guide.className = "alignment-guide";
      guide.style.position = "absolute";
      guide.style.left = `${x}px`;
      guide.style.top = "0";
      guide.style.width = "0";
      guide.style.height = "100%";
      guide.style.borderLeft = "1.5px dashed #ef4444";
      guide.style.pointerEvents = "none";
      guide.style.zIndex = "200";
      guide.style.opacity = "0.8";
      pageWrapper.appendChild(guide);
    }
  }

  /**
   * Remove all alignment guide lines from a page wrapper.
   */
  private clearAlignmentGuides(pageWrapper: HTMLElement | null) {
    if (!pageWrapper) return;
    const guides = pageWrapper.querySelectorAll(".alignment-guide");
    for (const g of guides) g.remove();
  }

  private getAnnotationBounds(el: HTMLElement) {
    const left = parseFloat(el.style.left) || el.offsetLeft || 0;
    const top = parseFloat(el.style.top) || el.offsetTop || 0;
    const textEl = el.querySelector("[contenteditable]") as HTMLElement | null;
    const width =
      el.offsetWidth ||
      parseFloat(el.style.width) ||
      textEl?.offsetWidth ||
      parseFloat(textEl?.style.width || "") ||
      0;
    const height =
      el.offsetHeight ||
      parseFloat(el.style.height) ||
      textEl?.offsetHeight ||
      parseFloat(textEl?.style.minHeight || "") ||
      parseFloat(textEl?.style.height || "") ||
      0;

    return {
      bottom: top + height,
      height,
      left,
      right: left + width,
      top,
      width,
    };
  }

  private updateMeasurementGuides(pageWrapper: HTMLElement | null, activeEl: HTMLElement | null) {
    if (!pageWrapper || !activeEl) return;

    this.clearMeasurementGuides(pageWrapper);
    this.drawTextBoxSpacingGuides(pageWrapper, activeEl);
    this.drawLineHeightGuide(pageWrapper, activeEl);
  }

  private clearMeasurementGuides(pageWrapper: HTMLElement | null = null) {
    const root = pageWrapper ?? this;
    const guides = root.querySelectorAll(".spacing-guide, .line-height-guide");
    for (const guide of guides) guide.remove();
  }

  private drawTextBoxSpacingGuides(pageWrapper: HTMLElement, activeEl: HTMLElement) {
    const activeBounds = this.getAnnotationBounds(activeEl);
    if (activeBounds.height <= 0 || activeBounds.width <= 0) return;

    const candidates = Array.from(
      pageWrapper.querySelectorAll<HTMLElement>(".annotation-text, .annotation-textblock"),
    ).filter((el) => el !== activeEl);

    let nearestAbove: { el: HTMLElement; gap: number } | null = null;
    let nearestBelow: { el: HTMLElement; gap: number } | null = null;

    for (const candidate of candidates) {
      const bounds = this.getAnnotationBounds(candidate);
      if (bounds.height <= 0 || bounds.width <= 0) continue;

      if (bounds.bottom <= activeBounds.top) {
        const gap = activeBounds.top - bounds.bottom;
        if (!nearestAbove || gap < nearestAbove.gap) nearestAbove = { el: candidate, gap };
      } else if (bounds.top >= activeBounds.bottom) {
        const gap = bounds.top - activeBounds.bottom;
        if (!nearestBelow || gap < nearestBelow.gap) nearestBelow = { el: candidate, gap };
      }
    }

    if (nearestAbove) {
      const otherBounds = this.getAnnotationBounds(nearestAbove.el);
      this.drawSpacingGuide(
        pageWrapper,
        Math.max(4, Math.min(activeBounds.left, otherBounds.left) - 18),
        otherBounds.bottom,
        nearestAbove.gap,
      );
    }

    if (nearestBelow) {
      const otherBounds = this.getAnnotationBounds(nearestBelow.el);
      this.drawSpacingGuide(
        pageWrapper,
        Math.max(4, Math.min(activeBounds.left, otherBounds.left) - 18),
        activeBounds.bottom,
        nearestBelow.gap,
      );
    }
  }

  private drawSpacingGuide(pageWrapper: HTMLElement, x: number, y: number, height: number) {
    if (height < 1) return;

    const guide = document.createElement("div");
    guide.className = "spacing-guide";
    guide.style.left = `${x}px`;
    guide.style.top = `${y}px`;
    guide.style.height = `${height}px`;

    const label = document.createElement("span");
    label.className = "measurement-guide-label";
    label.textContent = `${Math.round(height)}px`;
    guide.appendChild(label);
    pageWrapper.appendChild(guide);
  }

  private drawLineHeightGuide(pageWrapper: HTMLElement, activeEl: HTMLElement) {
    const textEl = activeEl.querySelector("[contenteditable]") as HTMLElement | null;
    if (!textEl) return;

    const bounds = this.getAnnotationBounds(activeEl);
    if (bounds.height <= 0 || bounds.width <= 0) return;

    const computed = window.getComputedStyle(textEl);
    const fontSize = parseFloat(computed.fontSize) || parseFloat(textEl.style.fontSize) || 16;
    const unitlessLineHeight = parseFloat(textEl.style.lineHeight || "");
    let lineHeight = parseFloat(computed.lineHeight);
    if (!Number.isFinite(lineHeight) || computed.lineHeight === "normal" || lineHeight <= 4) {
      lineHeight = fontSize * (Number.isFinite(unitlessLineHeight) ? unitlessLineHeight : 1.2);
    }
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;

    const guide = document.createElement("div");
    guide.className = "line-height-guide";
    const preferredX = bounds.left + bounds.width + 10;
    const fallbackX = Math.max(bounds.left + bounds.width - 8, bounds.left + 4);
    const maxX = pageWrapper.clientWidth ? pageWrapper.clientWidth - 32 : preferredX;
    guide.style.left = `${Math.min(preferredX, Math.max(fallbackX, maxX))}px`;
    guide.style.top = `${bounds.top}px`;
    guide.style.height = `${lineHeight}px`;

    const label = document.createElement("span");
    label.className = "measurement-guide-label";
    label.textContent = `${Math.round(lineHeight)}px line`;
    guide.appendChild(label);
    pageWrapper.appendChild(guide);
  }

  private normalizeTextAlignment(value: string | null | undefined): TextAlignment | undefined {
    if (!value) return undefined;

    const normalized = value.toLowerCase();
    if (normalized === "left" || normalized === "start") return "left";
    if (normalized === "center" || normalized === "-webkit-center") return "center";
    if (normalized === "right" || normalized === "end") return "right";
    if (normalized === "justify") return "justify";

    return undefined;
  }

  async handleSave() {
    if (!this.selectedFile || !this.currentPdfDoc) return;
    try {
      this.updateProgress(10, "Preparing PDF...");
      const arrayBuffer = await this.selectedFile.arrayBuffer();
      const pdfBytes = new Uint8Array(arrayBuffer);
      const annotations = this.annotationManager.getAllAnnotations();
      const scaledAnnotations: Annotation[] = [];
      // Extracted text and images the user left as they were stay in the
      // page as the original content: not covered, not redrawn.
      const untouched = new Set<string>();

      for (const ann of annotations) {
        const snapshot = this.extractedSnapshots.get(ann.id);
        if (ann.extracted && snapshot?.state === this.extractedState(ann)) {
          untouched.add(ann.id);
          continue;
        }
        const scale = await this.getUnitScale(ann.pageIndex);

        let scaledStyle = ann.style ? { ...ann.style } : undefined;
        if (scaledStyle?.fontSize) scaledStyle.fontSize = scaledStyle.fontSize / scale;
        if (typeof scaledStyle?.strokeWidth === "number") {
          scaledStyle.strokeWidth = scaledStyle.strokeWidth / scale;
        }
        if (typeof scaledStyle?.paragraphSpacing === "number") {
          scaledStyle.paragraphSpacing = scaledStyle.paragraphSpacing / scale;
        }

        // For textblock annotations, get the latest richContent from the DOM element
        let richContent = ann.richContent;
        let content = ann.content;
        if (ann.type === "textblock" || ann.type === "text") {
          const el = this.querySelector(`.annotation[data-id="${ann.id}"]`);
          const textEl = el?.querySelector("[contenteditable]") as HTMLElement;
          if (textEl) {
            richContent = sanitizeRichText(textEl.innerHTML);
            // biome-ignore lint/performance/useDomNodeTextContent: innerText keeps the line breaks between a box's lines; textContent joins them.
            content = textEl.innerText;
            const domTextAlign = this.normalizeTextAlignment(
              textEl.style.textAlign || window.getComputedStyle(textEl).textAlign,
            );
            if (domTextAlign) {
              scaledStyle = { ...scaledStyle, textAlign: domTextAlign };
            }
          }
        }

        // Sizes the toolbar wrote into the markup are editor pixels too.
        if (richContent) richContent = toPdfFontSizes(richContent, scale);

        scaledAnnotations.push({
          ...ann,
          x: ann.x / scale,
          y: ann.y / scale,
          width: ann.width ? ann.width / scale : undefined,
          height: ann.height ? ann.height / scale : undefined,
          content,
          richContent,
          points: ann.points
            ? ann.points.map((point) => ({ x: point.x / scale, y: point.y / scale }))
            : undefined,
          style: scaledStyle,
        });
      }

      this.updateProgress(50, "Embedding all annotations...");

      // Scale extracted source regions to PDF coordinates
      const allExtractedSources = this.annotationManager.getAllExtractedSources();
      const scaledSources: ExtractedSource[] = [];
      let coversOriginalText = false;
      for (const src of allExtractedSources) {
        // The original of an unchanged block or image is kept as it is.
        if (src.annotationId && untouched.has(src.annotationId)) continue;
        if (src.annotationId && this.extractedSnapshots.get(src.annotationId)?.kind === "text") {
          coversOriginalText = true;
        }
        const scale = await this.getUnitScale(src.pageIndex);
        scaledSources.push({
          pageIndex: src.pageIndex,
          x: src.x / scale,
          y: src.y / scale,
          width: src.width / scale,
          height: src.height / scale,
        });
      }

      let replacedCharacters = 0;
      const modifiedPdfBytes = await embedAllAnnotations(
        pdfBytes,
        scaledAnnotations,
        scaledSources,
        {
          onCharactersReplaced: (count) => {
            replacedCharacters += count;
          },
        },
      );
      this.updateProgress(90, "Saving...");
      const success = await this.savePdf(modifiedPdfBytes, this.selectedFile.name, "_edited");
      if (success) {
        await this.recordJob("Edit", this.selectedFile.name, modifiedPdfBytes, {
          annotationCount: annotations.length,
        });
        this.updateProgress(100, "Saved!");
        this.explainSavedFile(coversOriginalText, replacedCharacters);
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
      // The text block extractor tells bold and italic from each font's real
      // name, which pdf.js sends only with fontExtraProperties.
      const pdfDoc = await loadPdf(arrayBuffer, { fontExtraProperties: true });
      // A file opened before stays in memory, with its worker, until destroyed.
      this.releasePdfDocument();
      if (!this.isConnected) {
        void destroyPdfDocument(pdfDoc).catch(() => undefined);
        return;
      }
      this.currentPdfDoc = pdfDoc;
      this.initTools();
      this.initFormattingToolbar();
      await this.renderPages();
      this.updateProgress(60, "Extracting text blocks...");
      await this.extractAndRenderTextBlocks();
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

  private initFormattingToolbar() {
    const container = this.querySelector("#formattingToolbarContainer") as HTMLElement;
    if (!container) return;

    this.formattingToolbar?.destroy();
    container.innerHTML = "";

    this.formattingToolbar = new FormattingToolbar(container, (state) =>
      this.applyToolbarFormatting(state),
    );

    const toolbarEl = this.formattingToolbar.render();
    container.appendChild(toolbarEl);
  }

  /** Apply a formatting toolbar change to the selected text box and store it. */
  private applyToolbarFormatting(state: Parameters<FormattingChangeCallback>[0]) {
    if (!this.selectedAnnotationId) return;
    const ann = this.annotationManager.getAnnotation(this.selectedAnnotationId);
    if (!ann || (ann.type !== "textblock" && ann.type !== "text")) return;
    const el = this.querySelector(`.annotation[data-id="${ann.id}"]`);
    const textEl = el?.querySelector("[contenteditable]") as HTMLElement | null;
    if (!textEl) return;

    const style: AnnotationStyle = { ...ann.style };
    if (state.textAlign) {
      textEl.style.textAlign = state.textAlign;
      style.textAlign = state.textAlign;
    }
    // The font, line-spacing and space-above selects hold focus when they
    // change, so the toolbar cannot reach the text box. They apply to the
    // whole box: set them here and store them so the saved PDF uses them.
    if (state.fontFamily) {
      const font = nearestEditorFont(state.fontFamily);
      textEl.style.fontFamily = font.css;
      style.font = font.value;
      // Keep the properties panel's font in step with the toolbar.
      (this.querySelector("#fontFamilySelect") as HTMLSelectElement).value = font.value;
    }
    if (state.lineHeight) {
      textEl.style.lineHeight = state.lineHeight.toString();
      style.lineHeight = state.lineHeight;
    }
    if (state.paragraphSpacing !== undefined) {
      this.applyParagraphSpacing(textEl, state.paragraphSpacing);
      style.paragraphSpacing = state.paragraphSpacing;
    }

    // Selection formatting (bold, size, colour, lists...) lives in the markup.
    const updates = { richContent: sanitizeRichText(textEl.innerHTML), style };
    const step = this.formattingStep;
    this.formattingStep = null;
    if (step?.annotationId === ann.id) {
      // The browser already recorded this click's formatting: widen that
      // step, so one toolbar action is one undo step.
      this.annotationManager.updateAnnotation(ann.id, updates, { recordHistory: false });
      step.action.newState = this.cloneAnnotationState(
        this.annotationManager.getAnnotation(ann.id) as Annotation,
      );
    } else if (
      updates.richContent !== (ann.richContent ?? "") ||
      stableJson(style) !== stableJson(ann.style ?? {})
    ) {
      this.annotationManager.updateAnnotation(ann.id, updates);
    }
    this.updateHistoryControls();
  }

  /**
   * Extract text and images from all PDF pages and create editable elements.
   * After extraction, the entire canvas is whited-out to create a clean white page,
   * with text boxes and images placed as interactive elements on top.
   */
  private async extractAndRenderTextBlocks() {
    const pdfDoc = this.currentPdfDoc;
    if (!pdfDoc) return;

    try {
      const results = await textBlockExtractor.extractAllPages(pdfDoc);
      const pagesWithAngledText: number[] = [];

      for (let pageIdx = 0; pageIdx < results.length; pageIdx++) {
        // Stop once the editor is closed or another file was opened.
        if (!this.isCurrentDocument(pdfDoc)) return;
        const { blocks, angledTextCount } = results[pageIdx];
        // Text that is turned or upside down cannot become a text box; it
        // stays visible as part of the page.
        if (angledTextCount > 0) pagesWithAngledText.push(pageIdx + 1);
        this.extractedBlocks.set(pageIdx, blocks);

        // Extract images from this page BEFORE whiting out the canvas
        const pageWrapper = this.querySelector(
          `.pdf-page-wrapper[data-index="${pageIdx}"]`,
        ) as HTMLElement;
        const canvas = pageWrapper?.querySelector(".pdf-page-canvas") as HTMLCanvasElement;

        let extractedImages: ExtractedImage[] = [];
        if (canvas) {
          extractedImages = await imageExtractor.extractPageImages(pdfDoc, pageIdx, canvas);
          if (!this.isCurrentDocument(pdfDoc)) return;
        }

        // Clear only what became editable: the rest of the page (rules,
        // charts, turned text) stays visible, as it stays in the saved PDF.
        this.whiteOutRegions(pageIdx, [
          ...extractedImages,
          ...blocks.flatMap((block) => this.textRegionsOf(block)),
        ]);

        // Render extracted images as movable annotations
        for (const img of extractedImages) {
          const imgId = this.annotationManager.addAnnotation(
            {
              type: "image",
              pageIndex: img.pageIndex,
              x: img.x,
              y: img.y,
              width: img.width,
              height: img.height,
              content: img.dataUrl,
              extracted: true,
              style: { opacity: 1 },
            },
            { recordHistory: false },
          );
          this.renderAnnotation(imgId, { focus: false });
          this.recordExtracted(imgId, "image", img.pageIndex, [img]);
        }

        // Render text blocks
        for (const block of blocks) {
          const id = this.annotationManager.addAnnotation(
            {
              type: "textblock",
              pageIndex: block.pageIndex,
              x: block.x,
              y: block.y,
              width: block.width,
              height: block.height,
              content: block.content,
              richContent: block.richContent,
              extracted: true,
              style: {
                fontSize: block.fontSize,
                font: this.mapPdfFont(block.fontName),
                color: block.color,
                bold: block.bold,
                italic: block.italic,
                textAlign: block.textAlign,
                lineHeight: block.lineHeight,
              },
            },
            { recordHistory: false },
          );

          this.renderAnnotation(id, { focus: false });
          this.recordExtracted(id, "text", block.pageIndex, this.textRegionsOf(block));
        }

        await yieldToMain();
      }

      if (pagesWithAngledText.length > 0) {
        const pages = pagesWithAngledText.join(", ");
        const label = pagesWithAngledText.length === 1 ? "page" : "pages";
        this.showEditorNotice(
          `Some text on ${label} ${pages} is turned or upside down. It stays as it is and cannot be edited.`,
        );
      }

      logger.info("Text blocks extracted", {
        pages: results.length,
        totalBlocks: results.reduce((sum, r) => sum + r.blocks.length, 0),
      });
    } catch (err) {
      logger.warn("Text block extraction failed, editor still usable", err);
    }
  }

  /**
   * Remember where an extracted text block or image came from (its source
   * region, cleared on save once the user changes or deletes it) and how it
   * looked when extracted, so that save can leave it alone while unchanged.
   */
  private recordExtracted(
    id: string,
    kind: "text" | "image",
    pageIndex: number,
    regions: Array<{ x: number; y: number; width: number; height: number }>,
  ) {
    for (const { x, y, width, height } of regions) {
      this.annotationManager.addExtractedSource({
        pageIndex,
        x,
        y,
        width,
        height,
        annotationId: id,
      });
    }
    const ann = this.annotationManager.getAnnotation(id) as Annotation;
    this.extractedSnapshots.set(id, { kind, state: this.extractedState(ann) });
  }

  /**
   * Where a text block's original text is drawn: one box per line, from the
   * font's ascent to its descent, so clearing it spares whatever lies between
   * and around the lines. The block's own box if the lines are not known.
   */
  private textRegionsOf(block: TextBlock) {
    return block.glyphBoxes?.length ? block.glyphBoxes : [block];
  }

  /**
   * The parts of an extracted annotation that save compares with how it was
   * extracted: place, size, style and, for text, the markup as shown.
   */
  private extractedState(ann: Annotation): string {
    let richContent: string | undefined;
    if (ann.type !== "image") {
      const textEl = this.querySelector(
        `.annotation[data-id="${ann.id}"] [contenteditable]`,
      ) as HTMLElement | null;
      richContent = sanitizeRichText(
        textEl ? textEl.innerHTML : (ann.richContent ?? ann.content ?? ""),
      );
    }
    const { x, y, width, height } = ann;
    return stableJson({ x, y, width, height, style: ann.style ?? {}, richContent });
  }

  /**
   * Tell the user, plainly, what saving did not do: changed or deleted text
   * is only covered (once per session), and characters the standard PDF
   * fonts cannot draw were replaced.
   */
  private explainSavedFile(coversOriginalText: boolean, replacedCharacters: number) {
    if (coversOriginalText && !this.coveredTextNoticeShown) {
      this.coveredTextNoticeShown = true;
      this.showEditorNotice(
        "Text you changed or deleted is covered on the page, not removed. The old text is still in the saved file, where it can be searched and copied. This is not redaction.",
      );
    }
    if (replacedCharacters > 0) {
      const what = replacedCharacters === 1 ? "1 character" : `${replacedCharacters} characters`;
      this.showEditorNotice(
        `${what} in your text could not be drawn with the PDF's standard fonts and ${replacedCharacters === 1 ? "was" : "were"} replaced in the saved file.`,
      );
    }
  }

  /** Show a short note above the pages, once per message. */
  private showEditorNotice(message: string) {
    const notice = this.querySelector("#editorNotice");
    if (!notice) return;
    const shown = Array.from(notice.querySelectorAll("p")).some((p) => p.textContent === message);
    if (!shown) {
      const line = document.createElement("p");
      line.textContent = message;
      notice.appendChild(line);
    }
    notice.classList.remove("hidden");
  }

  /**
   * White-out the given regions of a page's canvas (editor pixels): the
   * places whose content became editable text and images. Padded like the
   * export's white-out, so the editor shows what the saved PDF will.
   */
  private whiteOutRegions(
    pageIndex: number,
    regions: Array<{ x: number; y: number; width: number; height: number }>,
  ) {
    const canvas = this.querySelector(
      `.pdf-page-wrapper[data-index="${pageIndex}"] .pdf-page-canvas`,
    ) as HTMLCanvasElement | null;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;

    // The export's white-out padding, in PDF units, so the editor clears the
    // same area the saved PDF will.
    const padding = EXTRACTED_WHITEOUT_PADDING_PT * this.getPageScale(pageIndex);
    ctx.fillStyle = "white";
    for (const region of regions) {
      ctx.fillRect(
        region.x - padding,
        region.y - padding,
        region.width + padding * 2,
        region.height + padding * 2,
      );
    }
  }

  /** True while the editor is on the page and still showing this document. */
  private isCurrentDocument(pdfDoc: unknown): boolean {
    return this.isConnected && this.currentPdfDoc === pdfDoc;
  }

  /** Destroy the open pdf.js document (and its worker) and forget it. */
  private releasePdfDocument() {
    const pdfDoc = this.currentPdfDoc;
    this.currentPdfDoc = null;
    void destroyPdfDocument(pdfDoc).catch(() => undefined);
  }

  /** The editor font (one of the three the export can draw) nearest a PDF font. */
  private mapPdfFont(fontName: string): string {
    return nearestEditorFont(fontName).value;
  }

  /**
   * Editor pixels per PDF unit on a page. pdf.js sizes the viewport by the
   * page's /UserUnit, so one PDF unit shows that many times larger.
   */
  private async getUnitScale(pageIndex: number): Promise<number> {
    const page = await this.currentPdfDoc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1.0 });
    return (TARGET_WIDTH / viewport.width) * (page.userUnit || 1);
  }

  async renderPages() {
    const container = this.querySelector("#pdfContainer");
    const pdfDoc = this.currentPdfDoc;
    if (!container || !pdfDoc) return;
    container.innerHTML = "";
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      // Stop once the editor is closed or another file was opened.
      if (!this.isCurrentDocument(pdfDoc)) return;
      const pageWrapper = document.createElement("div");
      pageWrapper.className = "pdf-page-wrapper";
      pageWrapper.dataset.index = (i - 1).toString();
      pageWrapper.style.position = "relative";
      const canvas = document.createElement("canvas");
      canvas.className = "pdf-page-canvas";
      pageWrapper.appendChild(canvas);
      container.appendChild(pageWrapper);
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: 1.0 });
      const scale = TARGET_WIDTH / viewport.width;
      this.pageScales.set(i - 1, scale * (page.userUnit || 1));

      await renderPage(pdfDoc, i, canvas, scale);
      await yieldToMain();
    }
  }
}

customElements.define("pdf-editor", PdfEditor);
