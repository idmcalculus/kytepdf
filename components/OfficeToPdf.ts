import { AnydocError, anydocEngine } from "../utils/anydocEngine.ts";
import {
  ANYDOC_ACCEPT,
  ANYDOC_ALLOWED_MIMES,
  ANYDOC_FORMAT_LABEL,
  getAnydocFormat,
  isAnydocCandidate,
} from "../utils/anydocTypes.ts";
import { describeFailure } from "../utils/errorMapper.ts";
import { logger } from "../utils/logger.ts";
import { generateOutputFilename } from "../utils/pdfUtils.ts";
import { type Job, persistence } from "../utils/persistence.ts";
import { BaseComponent } from "./BaseComponent.ts";

/**
 * Local office-document tool. Cloud Word→PDF rendering was retired; this tool
 * converts supported Office formats to Markdown in the browser via anydoc-wasm.
 */
export class OfficeToPdf extends BaseComponent {
  protected toolKey = "office-to-markdown";

  /** Offers only recent files this tool can convert, never PDFs or its own Markdown. */
  protected acceptsRecentJob(job: Job) {
    return isAnydocCandidate(job.fileName ?? "");
  }

  render() {
    this.innerHTML = `
      <div class="tool-view">
        ${this.getBackButton()}

        <h1>Office to Markdown</h1>
        <p class="subtitle">Extract text and structure from ${ANYDOC_FORMAT_LABEL} — entirely in your browser. This is semantic extraction, not a visual PDF render.</p>

        ${this.getDropZone(`your Office file (${ANYDOC_FORMAT_LABEL})`, "file-up")}

        <div id="fileInfo" class="file-list-item hidden" style="margin-bottom: 2rem; cursor: default;">
          <div class="file-item-details">
            <span id="fileName" class="file-name">document.docx</span>
            <span id="fileSize" class="file-size">0 MB</span>
          </div>
        </div>

        <div id="mainLayout" class="layout-grid hidden">
          <div class="layout-left">
             <div class="preview-container" style="display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.2); border-radius: 1rem; min-height: 300px;">
                <div style="text-align: center; color: var(--text-muted);">
                  <i data-lucide="file-up" style="width: 64px; height: 64px; margin-bottom: 1rem; opacity: 0.5;"></i>
                  <p>Ready to extract Markdown</p>
                </div>
             </div>
          </div>

          <div class="layout-right">
            <div class="controls">
              <div class="control-group">
                <div class="warning" style="border-color: var(--primary-glow); background: rgba(6, 182, 212, 0.05);">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--primary);"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  <span>PDFs are handled by PDF to Text / PDF to Word. This tool is for non-PDF documents only.</span>
                </div>
              </div>
              <div class="actions-row">
                <button id="convertBtn" class="btn btn-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a3.5 3.5 0 0 0 .5-6.91V11a5 5 0 0 0-10 0v1.09a3.5 3.5 0 0 0 .5 6.91Z"/><path d="M12 13v4"/><path d="m10 15 2 2 2-2"/></svg>
                  Extract Markdown
                </button>
              </div>

              ${this.getProgressSection("Extracting locally...")}

              <div id="successMessage" class="success-message hidden">
                <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">Extraction Complete!</p>
                <button id="downloadLink" class="btn btn-primary">Download Markdown</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    if ((window as any).lucide) (window as any).lucide.createIcons();
  }

  setupEventListeners() {
    this.setupBaseListeners();
    const fileInput = this.querySelector("#fileInput") as HTMLInputElement;
    fileInput.accept = ANYDOC_ACCEPT;

    const convertBtn = this.querySelector("#convertBtn") as HTMLButtonElement;
    convertBtn.onclick = () => this.handleConvert();

    this.checkExistingSession();
  }

  async handleFiles(files: FileList) {
    const file = files[0];
    if (!isAnydocCandidate(file.name) || file.name.toLowerCase().endsWith(".pdf")) {
      this.showErrorDialog(
        `Unsupported file type. Use a non-PDF office document (${ANYDOC_FORMAT_LABEL}).`,
      );
      return;
    }

    if (
      !(await this.validateFile(file, {
        maxSizeMB: 100,
        allowedTypes: ANYDOC_ALLOWED_MIMES,
      }))
    ) {
      return;
    }

    this.selectedFile = file;
    // A result belongs to the file it came from; don't offer it for this one.
    this.clearResult();
    await persistence.set(this.toolKey, file);

    (this.querySelector("#fileName") as HTMLElement).textContent = file.name;
    (this.querySelector("#fileSize") as HTMLElement).textContent = this.formatBytes(file.size);
    (this.querySelector("#fileInfo") as HTMLElement).classList.remove("hidden");
    (this.querySelector("#dropZone") as HTMLElement).classList.add("hidden");
    (this.querySelector("#mainLayout") as HTMLElement).classList.remove("hidden");
  }

  async checkExistingSession() {
    try {
      const saved = await persistence.get<File>(this.toolKey);
      if (saved) {
        const resumeContainer = this.querySelector("#resumeContainer");
        const resumeBtn = this.querySelector("#resumeBtn");
        if (resumeContainer && resumeBtn) {
          resumeContainer.classList.remove("hidden");
          resumeBtn.innerHTML = "";

          // Static trusted icon
          const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          icon.setAttribute("width", "14");
          icon.setAttribute("height", "14");
          icon.setAttribute("viewBox", "0 0 24 24");
          icon.setAttribute("fill", "none");
          icon.setAttribute("stroke", "currentColor");
          icon.setAttribute("stroke-width", "2");
          icon.setAttribute("stroke-linecap", "round");
          icon.setAttribute("stroke-linejoin", "round");
          icon.style.marginRight = "4px";
          icon.innerHTML = `<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>`;
          resumeBtn.appendChild(icon);

          // User-controlled text via textContent (safe)
          const label = document.createTextNode(`Resume ${this.sanitize(saved.name)}`);
          resumeBtn.appendChild(label);
        }
      }
    } catch (err) {
      logger.error("Failed to check for existing session", err);
    }
  }

  async restoreSession() {
    const saved = await persistence.get<File>(this.toolKey);
    if (saved) {
      await this.handleFiles([saved] as unknown as FileList);
    }
  }

  /** Hides a finished result so its download can't be taken for another file. */
  private clearResult() {
    const successMsg = this.querySelector("#successMessage") as HTMLElement | null;
    const downloadLink = this.querySelector("#downloadLink") as HTMLElement | null;
    successMsg?.classList.add("hidden");
    if (downloadLink) downloadLink.onclick = null;
  }

  async handleConvert() {
    // Read the file once: the user can pick another while this runs, and the
    // bytes, format and output name must all come from the same file.
    const file = this.selectedFile;
    if (!file) return;

    const convertBtn = this.querySelector("#convertBtn") as HTMLButtonElement;
    const progressSection = this.querySelector("#progressSection") as HTMLElement;
    const successMsg = this.querySelector("#successMessage") as HTMLElement;

    try {
      convertBtn.disabled = true;
      progressSection.classList.remove("hidden");
      successMsg.classList.add("hidden");
      this.updateProgress(20, "Loading document engine...");

      const bytes = new Uint8Array(await file.arrayBuffer());
      this.updateProgress(50, "Extracting Markdown...");
      // The converter reads the format from the bytes first. The extension
      // covers formats with no byte signature, such as CSV.
      const envelope = await anydocEngine.convert(bytes, {
        format: getAnydocFormat(file.name),
        sourceName: file.name,
      });

      if (!envelope.markdown.trim()) {
        // Nothing to save: don't offer a download that can only fail.
        this.showErrorDialog(
          "No text was found in this document. It may be empty, or use an encoding the converter cannot read.",
          "No text found",
        );
        return;
      }

      this.updateProgress(100, "Done!");
      const data = new TextEncoder().encode(envelope.markdown);
      const outputName = generateOutputFilename(file.name, "_extracted", ".md");

      // A result for a file that is no longer selected goes to history only.
      if (this.selectedFile === file) {
        this.showSuccess(data, outputName, "", ".md");
        this.showSuccessDialog(
          `Markdown ready (${envelope.format}${envelope.warnings.length ? `; ${envelope.warnings.join("; ")}` : ""}).`,
        );
      }

      await this.recordJob(`Office to Markdown`, outputName, data, {
        originalFormat: file.name.split(".").pop(),
        engine: envelope.engine,
        engineVersion: envelope.engineVersion,
        format: envelope.format,
        mode: "local",
      });
    } catch (err: any) {
      logger.error("Office extraction failed", err);
      const message =
        err instanceof AnydocError
          ? this.describeAnydocFailure(err)
          : describeFailure("Extraction failed.", err);
      this.showErrorDialog(message);
    } finally {
      convertBtn.disabled = false;
      progressSection.classList.add("hidden");
    }
  }

  /** Plain words for each converter failure; internal codes never reach the user. */
  private describeAnydocFailure(err: AnydocError): string {
    switch (err.reason) {
      case "encrypted":
        return "This document is password-protected. Remove the password in the app that created it, then try again.";
      case "malformed":
        return "This file is damaged, or its contents do not match its file type.";
      case "missingPart":
        return "This file is incomplete: part of the document is missing. Save it again from the app that created it, then try again.";
      case "unsupported":
        return "This document uses a format or feature the converter does not support.";
      case "resourceLimit":
        return "This document is too large or complex to convert in the browser. Try a smaller file.";
      case "needsOcr":
        // The converter reads the bytes, so a PDF saved with an Office name lands here.
        return "This file is really a PDF with scanned pages, which hold no text to convert. Open it in the PDF to Text tool, which reads scanned pages with OCR.";
      case "engine-unavailable":
        return "The document converter could not load. Check your connection, reload the page and try again.";
      default:
        return "Extraction failed. Please try again.";
    }
  }
}

if (!customElements.get("office-to-markdown")) {
  customElements.define("office-to-markdown", OfficeToPdf);
}
// Back-compat alias: constructors may only bind to one tag name.
class OfficeToPdfLegacyAlias extends OfficeToPdf {}
if (!customElements.get("office-to-pdf")) {
  customElements.define("office-to-pdf", OfficeToPdfLegacyAlias);
}
