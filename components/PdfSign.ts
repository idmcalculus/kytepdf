import { logger } from "../utils/logger.ts";
import { PDFDocument, pdfjsLib } from "../utils/pdfConfig.ts";
import { calculateSignaturePlacement } from "../utils/pdfUtils.ts";
import { persistence } from "../utils/persistence.ts";
import { BaseComponent } from "./BaseComponent.ts";

interface SigPlacement {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class PdfSign extends BaseComponent {
  private signatureImage: string | null = null;
  private isDrawing: boolean = false;
  private sigContext: CanvasRenderingContext2D | null = null;
  private lastPos = { x: 0, y: 0 };
  private sigAspectRatio = 2;
  private sigPlacement: SigPlacement | null = null;

  render() {
    this.innerHTML = `
      <div class="tool-view">
        ${this.getBackButton()}

        <h1>Sign PDF</h1>
        <p class="subtitle">Draw or upload your signature and place it on your PDF.</p>

        ${this.getDropZone("your PDF", "pen-tool")}

        <div id="signLayout" class="layout-grid hidden">
          <div class="layout-left">
            <div class="preview-container">
              <div class="preview-viewport" id="pdfViewport">
                <div class="pdf-container">
                  <div class="pdf-page-wrapper">
                    <canvas id="pdfCanvas"></canvas>
                    <div id="signaturePreview" class="signature-overlay hidden">
                      <div class="resize-handle"></div>
                    </div>
                  </div>
                </div>
                
                <button id="prevPage" class="nav-btn prev">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                </button>
                <button id="nextPage" class="nav-btn next">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                </button>
              </div>
              <div class="preview-info">
                <span id="pageIndicator">Page 1 of 1</span>
              </div>
            </div>
          </div>

          <div class="layout-right">
            <div class="controls-card">
              <div class="step-badge">Phase 1: Draw Signature</div>
              <div class="signature-tabs">
                <button class="tab-btn active" data-tab="draw">Draw</button>
                <button class="tab-btn" data-tab="type">Type</button>
              </div>

              <div class="signature-pad-container" id="drawSection">
                <canvas id="sigCanvas" width="400" height="200"></canvas>
                <div class="sig-actions">
                  <button id="clearSigBtn" class="btn btn-secondary btn-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    Clear
                  </button>
                  <button id="saveSigBtn" class="btn btn-primary btn-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Use Signature
                  </button>
                </div>
              </div>

              <div class="signature-type-container hidden" id="typeSection">
                <input type="text" id="nameInput" placeholder="Type your name or initials..." class="name-input" maxlength="30" />
                <div class="font-selector">
                  <button class="font-btn active" style="font-family: 'Dancing Script', cursive;" data-font="'Dancing Script', cursive">Signature 1</button>
                  <button class="font-btn" style="font-family: 'Great Vibes', cursive;" data-font="'Great Vibes', cursive">Signature 2</button>
                  <button class="font-btn" style="font-family: 'Sacramento', cursive;" data-font="'Sacramento', cursive">Signature 3</button>
                  <button class="font-btn" style="font-family: 'Alex Brush', cursive;" data-font="'Alex Brush', cursive">Signature 4</button>
                </div>
                <div class="sig-actions">
                  <button id="saveTypedSigBtn" class="btn btn-primary btn-sm" style="width: 100%;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Use Typed Signature
                  </button>
                </div>
              </div>

              <div id="signStatus" class="status-alert hidden">
                 <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--secondary);"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                 <span>Phase 2: Click on document to place.</span>
              </div>

              <button id="finalizeBtn" class="btn btn-primary finalize-btn" disabled>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                Finalize & Save
              </button>

              ${this.getProgressSection("Processing...")}

              <div id="successMessage" class="success-message hidden">
                <div class="success-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                </div>
                <p style="font-size: 1.2rem; font-weight: 700; margin-bottom: 1rem;">PDF Signed Successfully!</p>
                <button id="downloadLink" class="btn btn-primary">Download Document</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>
        .controls-card {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--glass-border);
          border-radius: 1.5rem;
          padding: 2rem;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        @media (max-width: 768px) {
          .controls-card {
            padding: 1.25rem;
            gap: 1rem;
          }
        }
        .step-badge {
          background: var(--primary-glow);
          color: var(--primary);
          padding: 0.4rem 1rem;
          border-radius: 99px;
          font-size: 0.85rem;
          font-weight: 700;
          display: inline-block;
          width: fit-content;
        }
        .signature-tabs {
          display: flex;
          gap: 0.3rem;
          background: rgba(255, 255, 255, 0.05);
          padding: 0.3rem;
          border-radius: 0.75rem;
        }
        .tab-btn {
          flex: 1;
          background: none;
          border: none;
          color: var(--text-muted);
          padding: 0.5rem;
          border-radius: 0.5rem;
          cursor: pointer;
          font-weight: 600;
          font-size: 0.9rem;
          transition: all 0.2s;
        }
        .tab-btn.active {
          background: var(--primary);
          color: white;
        }
        .signature-type-container {
          background: rgba(255, 255, 255, 0.05);
          border: 2px solid var(--glass-border);
          border-radius: 1.25rem;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .name-input {
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid var(--glass-border);
          color: white;
          padding: 1rem;
          border-radius: 0.75rem;
          font-size: 1.25rem;
          width: 100%;
          outline: none;
          transition: border-color 0.2s;
        }
        .name-input:focus {
          border-color: var(--primary);
        }
        .font-selector {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.75rem;
        }
        .font-btn {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--glass-border);
          color: white;
          padding: 0.75rem;
          border-radius: 0.75rem;
          cursor: pointer;
          font-size: 1.1rem;
          text-align: center;
          transition: all 0.2s;
        }
        .font-btn.active {
          border-color: var(--primary);
          background: var(--primary-glow);
        }
        .signature-pad-container {
          background: rgba(255, 255, 255, 0.05);
          border: 2px solid var(--glass-border);
          border-radius: 1.25rem;
          padding: 1.5rem;
          transition: all 0.3s ease;
        }
        .signature-pad-container:focus-within {
          border-color: var(--primary);
          box-shadow: 0 0 20px var(--primary-glow);
        }
        #sigCanvas {
          background: #fff;
          border-radius: 0.75rem;
          width: 100%;
          height: auto;
          cursor: crosshair;
          touch-action: none;
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
        }
        .sig-actions {
          display: flex;
          justify-content: flex-end;
          margin-top: 1.25rem;
          gap: 0.75rem;
        }
        @media (max-width: 480px) {
          .sig-actions {
            flex-direction: column-reverse; /* Stack buttons, Save primary on top */
          }
          .sig-actions .btn {
            width: 100%;
          }
        }
        .status-alert {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 1rem;
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.2);
          border-radius: 1rem;
          color: var(--secondary);
          font-size: 0.95rem;
          font-weight: 500;
          animation: fadeIn 0.4s ease;
        }
        .signature-overlay {
          position: absolute;
          border: 2px dashed var(--primary);
          background: rgba(6, 182, 212, 0.15);
          cursor: grab;
          z-index: 5;
          box-shadow: 0 0 15px var(--primary-glow);
          transform: translate(-50%, -50%); /* Start centered */
          pointer-events: auto;
        }
        .signature-overlay:active {
          cursor: grabbing;
        }
        .resize-handle {
          position: absolute;
          bottom: -6px;
          right: -6px;
          width: 12px;
          height: 12px;
          background: var(--primary);
          border: 2px solid white;
          border-radius: 50%;
          cursor: nwse-resize;
          z-index: 10;
        }
        .finalize-btn {
          margin-top: 0.5rem;
          height: 3.5rem;
        }
        .success-icon {
          color: var(--secondary);
          margin: 0 auto 1.5rem;
          filter: drop-shadow(0 0 10px var(--secondary-glow));
        }

        .preview-viewport {
          height: 650px !important;
          max-height: 80vh;
          overflow: hidden;
          background: #020617 !important;
          border-radius: 1.5rem !important;
          padding: 0 !important;
          position: relative;
        }
        @media (max-width: 768px) {
          .preview-viewport {
            height: 400px !important;
          }
        }

        .pdf-container {
          width: 100%;
          height: 100%;
          overflow: auto;
          display: flex;
          padding: 3rem;
          scrollbar-width: thin;
          scrollbar-color: var(--primary) transparent;
          background: radial-gradient(circle at center, #0f172a 0%, #020617 100%);
        }
        @media (max-width: 768px) {
          .pdf-container {
            padding: 1rem;
          }
        }

        .pdf-page-wrapper {
          position: relative;
          box-shadow: 0 20px 50px rgba(0,0,0,0.6);
          border-radius: 8px;
          background: white;
          width: fit-content;
          height: fit-content;
          margin: auto;
          flex-shrink: 0;
        }

        #pdfCanvas {
          display: block;
          max-width: none !important;
          max-height: none !important;
          cursor: crosshair;
          border-radius: 8px;
        }

        .pdf-container::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .pdf-container::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.03);
          border-radius: 10px;
        }
        .pdf-container::-webkit-scrollbar-thumb {
          background: var(--primary);
          border-radius: 10px;
          border: 3px solid #020617;
        }
        .pdf-container::-webkit-scrollbar-thumb:hover {
          background: var(--secondary);
        }
      </style>
    `;
  }

  protected toolKey = "pdf-sign";

  setupEventListeners() {
    this.setupBaseListeners();
    const clearSigBtn = this.querySelector("#clearSigBtn") as HTMLButtonElement;
    const saveSigBtn = this.querySelector("#saveSigBtn") as HTMLButtonElement;
    const finalizeBtn = this.querySelector("#finalizeBtn") as HTMLButtonElement;
    const pdfCanvas = this.querySelector("#pdfCanvas") as HTMLCanvasElement;
    const sigCanvas = this.querySelector("#sigCanvas") as HTMLCanvasElement;
    const signaturePreview = this.querySelector("#signaturePreview") as HTMLElement;
    const pdfContainer = this.querySelector(".pdf-container") as HTMLElement;
    const pdfPageWrapper = this.querySelector(".pdf-page-wrapper") as HTMLElement;

    this.sigContext = sigCanvas.getContext("2d");
    if (this.sigContext) {
      this.sigContext.strokeStyle = "#000";
      this.sigContext.lineWidth = 2;
      this.sigContext.lineCap = "round";
    }

    // Sig Pad Logic
    sigCanvas.addEventListener("mousedown", (e) => this.startDrawing(e));
    sigCanvas.addEventListener("mousemove", (e) => this.draw(e));
    window.addEventListener("mouseup", () => this.stopDrawing());

    sigCanvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      this.startDrawing(touch as unknown as MouseEvent);
    });
    sigCanvas.addEventListener("touchmove", (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      this.draw(touch as unknown as MouseEvent);
    });
    sigCanvas.addEventListener("touchend", () => this.stopDrawing());

    clearSigBtn.addEventListener("click", () => {
      if (this.sigContext) this.sigContext.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
      this.signatureImage = null;
      (this.querySelector("#signStatus") as HTMLElement).classList.add("hidden");
      (this.querySelector("#signaturePreview") as HTMLElement).classList.add("hidden");
      finalizeBtn.disabled = true;
    });

    saveSigBtn.addEventListener("click", () => {
      this.signatureImage = sigCanvas.toDataURL("image/png");
      this.sigAspectRatio = sigCanvas.width / sigCanvas.height;
      logger.debug("Drawn signature saved", { aspectRatio: this.sigAspectRatio });
      (this.querySelector("#signStatus") as HTMLElement).classList.remove("hidden");
    });

    // Tab Switching Logic
    const tabBtns = this.querySelectorAll(".tab-btn");
    const drawSection = this.querySelector("#drawSection") as HTMLElement;
    const typeSection = this.querySelector("#typeSection") as HTMLElement;

    tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        tabBtns.forEach((b) => {
          b.classList.remove("active");
        });
        (btn as HTMLElement).classList.add("active");
        const tab = (btn as HTMLElement).dataset.tab;
        if (tab === "draw") {
          drawSection.classList.remove("hidden");
          typeSection.classList.add("hidden");
        } else {
          drawSection.classList.add("hidden");
          typeSection.classList.remove("hidden");
        }
      });
    });

    // Typed Signature Logic
    const nameInput = this.querySelector("#nameInput") as HTMLInputElement;
    const fontBtns = this.querySelectorAll(".font-btn");
    const saveTypedSigBtn = this.querySelector("#saveTypedSigBtn") as HTMLButtonElement;
    let selectedFont = "'Dancing Script', cursive";

    fontBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        fontBtns.forEach((b) => {
          b.classList.remove("active");
        });
        (btn as HTMLElement).classList.add("active");
        selectedFont = (btn as HTMLElement).dataset.font || selectedFont;
      });
    });

    saveTypedSigBtn.addEventListener("click", () => {
      const text = this.sanitize(nameInput.value.trim());
      if (!text) {
        logger.warn("Empty typed signature");
        return;
      }

      logger.info("Creating typed signature", { textLength: text.length, font: selectedFont });

      const tempCanvas = document.createElement("canvas");
      const tCtx = tempCanvas.getContext("2d");
      if (!tCtx) return;

      const fontSize = 120;
      tCtx.font = `italic ${fontSize}px ${selectedFont}`;
      const metrics = tCtx.measureText(text);
      const textWidth = Math.ceil(metrics.width);
      const padding = 60;

      tempCanvas.width = textWidth + padding;
      tempCanvas.height = fontSize * 1.5;

      tCtx.font = `italic ${fontSize}px ${selectedFont}`;
      tCtx.fillStyle = "black";
      tCtx.textAlign = "center";
      tCtx.textBaseline = "middle";
      tCtx.fillText(text, tempCanvas.width / 2, tempCanvas.height / 2);

      this.signatureImage = tempCanvas.toDataURL("image/png");
      this.sigAspectRatio = tempCanvas.width / tempCanvas.height;
      (this.querySelector("#signStatus") as HTMLElement).classList.remove("hidden");
    });

    pdfCanvas.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).id === "pdfCanvas") {
        this.placeSignature(e);
      }
    });

    // Signature Drag & Resize Logic
    let isDragging = false;
    let isResizing = false;
    let startX: number,
      startY: number,
      initialLeft: number,
      initialTop: number,
      initialWidth: number,
      initialHeight: number;

    signaturePreview.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).classList.contains("resize-handle")) {
        isResizing = true;
      } else {
        isDragging = true;
        signaturePreview.style.cursor = "grabbing";
      }
      e.stopPropagation();
      startX = e.clientX;
      startY = e.clientY;

      const rect = signaturePreview.getBoundingClientRect();
      const wrapperRect = pdfPageWrapper.getBoundingClientRect();

      initialLeft = rect.left - wrapperRect.left;
      initialTop = rect.top - wrapperRect.top;
      initialWidth = rect.width;
      initialHeight = rect.height;

      signaturePreview.style.transform = "none";
      signaturePreview.style.left = `${initialLeft}px`;
      signaturePreview.style.top = `${initialTop}px`;
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDragging && !isResizing) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (isDragging) {
        const newLeft = initialLeft + dx;
        const newTop = initialTop + dy;
        signaturePreview.style.left = `${newLeft}px`;
        signaturePreview.style.top = `${newTop}px`;
      } else if (isResizing) {
        const newWidth = Math.max(30, initialWidth + dx);
        const newHeight = Math.max(15, initialHeight + dy);
        signaturePreview.style.width = `${newWidth}px`;
        signaturePreview.style.height = `${newHeight}px`;
      }

      const rect = signaturePreview.getBoundingClientRect();
      const wrapperRect = pdfPageWrapper.getBoundingClientRect();

      this.sigPlacement = {
        page: this.currentPageNum,
        x: (rect.left - wrapperRect.left) / wrapperRect.width,
        y: (rect.top - wrapperRect.top) / wrapperRect.height,
        w: rect.width / wrapperRect.width,
        h: rect.height / wrapperRect.height,
      };
    });

    window.addEventListener("mouseup", () => {
      isDragging = false;
      isResizing = false;
      signaturePreview.style.cursor = "grab";
    });

    // Grab content to pan logic
    let isPanning = false;
    let panStartX: number, panStartY: number, scrollLeft: number, scrollTop: number;

    pdfContainer.addEventListener("mousedown", (e) => {
      if (
        (e.target as HTMLElement).id === "pdfCanvas" ||
        (e.target as HTMLElement).id === "signaturePreview" ||
        (e.target as HTMLElement).classList.contains("resize-handle")
      )
        return;
      isPanning = true;
      pdfContainer.style.cursor = "grabbing";
      panStartX = e.pageX - pdfContainer.offsetLeft;
      panStartY = e.pageY - pdfContainer.offsetTop;
      scrollLeft = pdfContainer.scrollLeft;
      scrollTop = pdfContainer.scrollTop;
    });

    window.addEventListener("mousemove", (e) => {
      if (!isPanning) return;
      e.preventDefault();
      const x = e.pageX - pdfContainer.offsetLeft;
      const y = e.pageY - pdfContainer.offsetTop;
      const walkX = (x - panStartX) * 2;
      const walkY = (y - panStartY) * 2;
      pdfContainer.scrollLeft = scrollLeft - walkX;
      pdfContainer.scrollTop = scrollTop - walkY;
    });

    window.addEventListener("mouseleave", () => {
      isPanning = false;
      pdfContainer.style.cursor = "crosshair";
    });

    (this.querySelector("#prevPage") as HTMLElement).addEventListener("click", () =>
      this.changePage(-1),
    );
    (this.querySelector("#nextPage") as HTMLElement).addEventListener("click", () =>
      this.changePage(1),
    );
    finalizeBtn.addEventListener("click", () => this.startFinalize());

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
    try {
      const savedFile = await persistence.get<File>(this.toolKey);
      if (savedFile) {
        logger.info("Restoring sign session", { name: savedFile.name });
        this.handleFiles([savedFile] as unknown as FileList);
      }
    } catch (err) {
      logger.error("Failed to restore sign session", err);
    }
  }

  async saveSession() {
    try {
      if (this.selectedFile) {
        await persistence.set("pdf-sign", this.selectedFile);
        this.checkStorageUsage();
      }
    } catch (err) {
      logger.error("Failed to save sign session", err);
    }
  }

  startDrawing(e: MouseEvent) {
    const canvas = this.querySelector("#sigCanvas") as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    this.isDrawing = true;
    this.lastPos = {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  draw(e: MouseEvent) {
    if (!this.isDrawing || !this.sigContext) return;
    const canvas = this.querySelector("#sigCanvas") as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    this.sigContext.beginPath();
    this.sigContext.moveTo(this.lastPos.x, this.lastPos.y);
    this.sigContext.lineTo(x, y);
    this.sigContext.stroke();
    this.lastPos = { x, y };
  }

  stopDrawing() {
    this.isDrawing = false;
  }

  async handleFiles(files: FileList) {
    const file = files[0];
    if (!this.validateFile(file)) return;

    try {
      this.selectedFile = file;
      logger.info("File loaded for signing", { name: file.name });
      (this.querySelector("#dropZone") as HTMLElement).classList.add("hidden");
      (this.querySelector("#signLayout") as HTMLElement).classList.remove("hidden");

      this.saveSession();

      const arrayBuffer = await file.arrayBuffer();
      this.currentPdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      this.currentPageNum = 1;
      this.renderPage(1);
    } catch (err) {
      logger.error("Sign load error", err);
      this.showErrorDialog(
        "Failed to load PDF. Please ensure it's a valid document and not password protected.",
      );
    }
  }

  async renderPage(pageNum: number) {
    if (!this.currentPdfDoc) return;
    const page = await this.currentPdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 0.3 });
    const canvas = this.querySelector("#pdfCanvas") as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvasContext: context as any, viewport, canvas }).promise;
    (this.querySelector("#pageIndicator") as HTMLElement).textContent =
      `Page ${pageNum} of ${this.currentPdfDoc.numPages}`;

    (this.querySelector("#prevPage") as HTMLButtonElement).disabled = pageNum <= 1;
    (this.querySelector("#nextPage") as HTMLButtonElement).disabled =
      pageNum >= this.currentPdfDoc.numPages;
    (this.querySelector("#signaturePreview") as HTMLElement).classList.add("hidden");
  }

  changePage(offset: number) {
    if (!this.currentPdfDoc) return;
    const newPage = this.currentPageNum + offset;
    if (newPage >= 1 && newPage <= this.currentPdfDoc.numPages) {
      this.currentPageNum = newPage;
      this.renderPage(newPage);
    }
  }

  placeSignature(e: MouseEvent) {
    if (!this.signatureImage) return;

    const canvas = this.querySelector("#pdfCanvas") as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const preview = this.querySelector("#signaturePreview") as HTMLElement;
    const ratio = this.sigAspectRatio || 2;
    const height = 60;
    const width = height * ratio;

    preview.style.left = `${x}px`;
    preview.style.top = `${y}px`;
    preview.style.width = `${width}px`;
    preview.style.height = `${height}px`;
    preview.style.transform = "translate(-50%, -50%)";
    preview.style.backgroundImage = `url(${this.signatureImage})`;
    preview.style.backgroundSize = "contain";
    preview.style.backgroundRepeat = "no-repeat";
    preview.style.backgroundPosition = "center";
    preview.classList.remove("hidden");

    const placement = calculateSignaturePlacement(x, y, rect.width, rect.height, width, height);
    this.sigPlacement = {
      page: this.currentPageNum,
      ...placement,
    };

    (this.querySelector("#finalizeBtn") as HTMLButtonElement).disabled = false;
  }

  async startFinalize() {
    const finalizeBtn = this.querySelector("#finalizeBtn") as HTMLButtonElement;
    const progressSection = this.querySelector("#progressSection") as HTMLElement;

    if (!this.selectedFile || !this.signatureImage || !this.sigPlacement) {
      logger.warn("Start finalize called without necessary data");
      return;
    }

    finalizeBtn.disabled = true;
    progressSection.classList.remove("hidden");
    (this.querySelector("#successMessage") as HTMLElement).classList.add("hidden");

    logger.info("Starting PDF signing / finalized", { page: this.sigPlacement.page });

    try {
      this.updateProgress(20, "Preparing document...");
      const arrayBuffer = await this.selectedFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);

      this.updateProgress(50, "Embedding signature...");
      const sigImage = await pdfDoc.embedPng(this.signatureImage);
      const pages = pdfDoc.getPages();
      const targetPage = pages[this.sigPlacement.page - 1];
      const { width, height } = targetPage.getSize();

      targetPage.drawImage(sigImage, {
        x: this.sigPlacement.x * width,
        y: (1 - this.sigPlacement.y - this.sigPlacement.h) * height,
        width: this.sigPlacement.w * width,
        height: this.sigPlacement.h * height,
      });

      this.updateProgress(80, "Saving...");
      const pdfBytes = await pdfDoc.save();
      this.updateProgress(100, "Complete!");

      const fileName = this.selectedFile.name.replace(".pdf", "_signed.pdf");
      await this.recordJob("Sign", fileName, pdfBytes, {
        pageNumber: this.sigPlacement.page,
      });

      this.showSuccess(pdfBytes, this.selectedFile.name, "_signed");
      this.showSuccessDialog("Your signature has been embedded into the document.");
    } catch (error: any) {
      logger.error("Sign error", error);
      this.showErrorDialog(`Failed to sign PDF. ${error.message}`);
    } finally {
      finalizeBtn.disabled = false;
    }
  }
}

customElements.define("pdf-sign", PdfSign);
