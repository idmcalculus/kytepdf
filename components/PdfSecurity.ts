import JSZip from "jszip";
import { mapError } from "../utils/errorMapper.ts";
import { logger } from "../utils/logger.ts";
import {
  ALREADY_PROTECTED_ERROR,
  getPdfSecurityState,
  INCORRECT_PASSWORD_ERROR,
  INVALID_PDF_ERROR,
  isPdfStructureError,
  KNOWN_PASSWORD_REQUIRED_ERROR,
  NOT_PROTECTED_ERROR,
  type PdfProtectionPermissions,
  type PdfSecurityState,
  protectPdf,
  unprotectPdf,
} from "../utils/pdfSecurity.ts";
import {
  areAllFailuresSameMessage,
  type BatchFailureResult,
  type BatchSuccessResult,
  buildBatchArchiveName,
  buildBatchCompletionMessage,
  buildBatchSuccessDetails,
  countUnlockStates,
  type DownloadMode,
  getFileLabel,
  getOppositeToolKey,
  getProtectValidationMessage,
  getSelectionPanelMeta,
  getSingleSuccessDetail,
  getSingleSuccessTitle,
  getToolKey,
  getUnlockActionLabel,
  getUnlockHelpText,
  getUnprotectValidationMessage,
  initFileSelections,
  initUnlockStates,
  isActionReady,
  makeUniqueArchiveNames,
  removeFileAtIndex,
  type SecurityMode,
  setAllFileSelections,
  shouldShowPasswordMismatch,
  toggleFileSelection,
  type UnlockInspectionState,
} from "../utils/pdfSecurityWorkflow.ts";
import { generateOutputFilename } from "../utils/pdfUtils.ts";
import { persistence } from "../utils/persistence.ts";
import { BaseComponent } from "./BaseComponent.ts";

/** A finished batch item: the workflow's result plus the bytes to save. */
interface BatchOutput extends BatchSuccessResult {
  outputBytes: Uint8Array;
}

/** What a run does to one file, read once when the run starts. */
interface RunEntry {
  file: File;
  state: UnlockInspectionState;
}

/** The passwords and permissions a run uses, read once when it starts. */
interface RunSettings {
  userPassword: string;
  ownerPassword: string;
  currentPassword: string;
  permissions: PdfProtectionPermissions;
}

/** Messages this tool writes for the user, shown as they are. */
const KNOWN_SECURITY_ERRORS = [
  ALREADY_PROTECTED_ERROR,
  NOT_PROTECTED_ERROR,
  INCORRECT_PASSWORD_ERROR,
  KNOWN_PASSWORD_REQUIRED_ERROR,
  INVALID_PDF_ERROR,
];

/**
 * The message for a file the tool could not process: its own security
 * messages as they are, and a damaged file as INVALID_PDF_ERROR rather than
 * the parser's text. Null for anything else.
 */
function getSecurityErrorMessage(error: unknown): string | null {
  if (error instanceof Error && KNOWN_SECURITY_ERRORS.includes(error.message)) {
    return error.message;
  }
  return isPdfStructureError(error) ? INVALID_PDF_ERROR : null;
}

const DEFAULT_PERMISSIONS: PdfProtectionPermissions = {
  allowPrinting: true,
  allowCopying: false,
  allowModifying: false,
  allowAnnotating: false,
};

export class PdfSecurity extends BaseComponent {
  protected toolKey = "pdf-protect";
  private mode: SecurityMode = "protect";
  private unlockStates: UnlockInspectionState[] = [];
  private fileSelections: boolean[] = [];
  private downloadMode: DownloadMode = "zip";
  /** Bumped whenever the file list is replaced, so an older inspection loop stops. */
  private unlockRun = 0;
  /** True while a protect or unlock run is in progress; the list is locked meanwhile. */
  private isProcessing = false;

  render() {
    this.mode = this.getAttribute("mode") === "unprotect" ? "unprotect" : "protect";
    this.toolKey = getToolKey(this.mode);

    this.innerHTML = `
      <div class="tool-view">
        ${this.getBackButton()}

        <h1 id="securityTitle">Protect PDF</h1>
        <p id="securitySubtitle" class="subtitle">Add a password and control what viewers can do with your file.</p>

        <div class="mode-selection" style="margin-bottom: 2rem;">
          <label class="mode-option">
            <input type="radio" name="securityMode" value="protect" ${this.mode === "protect" ? "checked" : ""} />
            <span class="mode-card">
              <span class="mode-title">Protect</span>
              <span class="mode-desc">Set an open password and viewer restrictions.</span>
            </span>
          </label>
          <label class="mode-option">
            <input type="radio" name="securityMode" value="unprotect" ${this.mode === "unprotect" ? "checked" : ""} />
            <span class="mode-card">
              <span class="mode-title">Unlock</span>
              <span class="mode-desc">Remove a known password, or strip owner restrictions when no password is required to open.</span>
            </span>
          </label>
        </div>

        ${this.getDropZone("your PDF files", "file-up", true)}

        <div id="fileInfo" class="file-list-item security-file-info hidden">
          <div class="file-item-details">
            <div style="min-width: 0; display: flex; flex-direction: column; gap: 0.35rem;">
              <span id="fileName" class="file-name">Selected PDFs</span>
              <span id="fileSize" class="file-size">0 MB</span>
            </div>
          </div>
          <div class="file-item-actions">
            <button id="addMoreBtn" class="btn btn-secondary btn-sm" type="button">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
              Add More
            </button>
            <button id="clearFilesBtn" class="btn btn-secondary btn-sm" type="button">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              Clear All
            </button>
          </div>
        </div>

        <div id="mainLayout" class="layout-grid hidden">
          <div class="layout-left">
            <div class="preview-container security-selection-panel">
              <div class="file-list-header security-selection-header">
                <div class="security-selection-heading">
                  <h3 id="fileListTitle">Selected PDFs</h3>
                  <p id="fileListMeta" class="security-selection-meta">Each PDF in this batch is processed as a separate output.</p>
                </div>
                <div class="header-actions">
                  <button id="selectAllFilesBtn" class="btn btn-secondary btn-sm" type="button">Select All</button>
                  <button id="clearSelectionBtn" class="btn btn-secondary btn-sm" type="button">Clear Selection</button>
                </div>
              </div>
              <div class="security-selection-body">
                <div id="fileList" class="file-list security-file-list"></div>
              </div>
            </div>
          </div>

          <div class="layout-right">
            <div class="controls">
            <div id="protectControls">
              <div class="control-group">
                <label for="openPassword">Open Password</label>
                <input type="password" id="openPassword" placeholder="Required to open the PDF" />
              </div>

              <div class="control-group">
                <label for="confirmPassword">Confirm Password</label>
                <input type="password" id="confirmPassword" placeholder="Re-enter the password" />
              </div>

              <div class="control-group">
                <label for="ownerPassword">Owner Password (Optional)</label>
                <input type="password" id="ownerPassword" placeholder="Leave blank to auto-generate one" />
              </div>

              <div class="warning" style="margin-top: 0;">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>
                <span>If you leave the owner password blank, Kyte creates one automatically so viewer restrictions stay enforced.</span>
              </div>

              <div class="control-group">
                <label>Viewer Permissions</label>
                <div style="display: grid; gap: 0.85rem; margin-top: 0.75rem;">
                  <label style="display: flex; gap: 0.75rem; align-items: center; margin-bottom: 0;">
                    <input type="checkbox" id="allowPrinting" checked />
                    <span>Allow printing</span>
                  </label>
                  <label style="display: flex; gap: 0.75rem; align-items: center; margin-bottom: 0;">
                    <input type="checkbox" id="allowCopying" />
                    <span>Allow copying text and images</span>
                  </label>
                  <label style="display: flex; gap: 0.75rem; align-items: center; margin-bottom: 0;">
                    <input type="checkbox" id="allowModifying" />
                    <span>Allow editing pages and content</span>
                  </label>
                  <label style="display: flex; gap: 0.75rem; align-items: center; margin-bottom: 0;">
                    <input type="checkbox" id="allowAnnotating" />
                    <span>Allow comments, markups, and form changes</span>
                  </label>
                </div>
              </div>
            </div>

            <div id="unprotectControls" class="hidden">
              <div id="currentPasswordGroup" class="control-group">
                <label for="currentPassword">Current Password</label>
                <input type="password" id="currentPassword" placeholder="Enter the password that opens these PDFs" />
              </div>

              <div id="unlockHelp" class="warning" style="margin-top: 0;">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>
                <span id="unlockHelpText">Unlock removes a known password. If a PDF already opens without one, Kyte can also export an unrestricted copy without asking for a password.</span>
              </div>
            </div>

            <div id="downloadModeGroup" class="control-group hidden">
              <label>Download Mode</label>
              <div class="mode-selection">
                <label class="mode-option">
                  <input type="radio" name="securityDownloadMode" value="individual" />
                  <span class="mode-card">
                    <span class="mode-title">Individual Files</span>
                    <span class="mode-desc">Separate downloads</span>
                  </span>
                </label>
                <label class="mode-option">
                  <input type="radio" name="securityDownloadMode" value="zip" checked />
                  <span class="mode-card">
                    <span class="mode-title">Single ZIP</span>
                    <span class="mode-desc">One archive</span>
                  </span>
                </label>
              </div>
            </div>

            <div id="passwordMismatch" class="warning hidden">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>
              <span>Passwords must match before you can protect the PDFs.</span>
            </div>

            <div class="actions-row" style="margin-top: 0.5rem;">
              <span id="actionSummary" style="color: var(--text-muted);">Upload one or more PDFs to continue.</span>
              <button id="securityActionBtn" class="btn btn-primary" style="min-width: 220px;" disabled>
                Protect PDF
              </button>
            </div>

            ${this.getProgressSection("Securing PDF...")}

            <div id="successMessage" class="success-message hidden">
              <p id="successTitle" style="font-size: 1.1rem; margin-bottom: 0.5rem;">PDF Ready!</p>
              <div id="successDetails" style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.6;">
                Your processed file is ready to download.
              </div>
              <button id="downloadLink" class="btn btn-primary">Download PDF</button>
            </div>
          </div>
          </div>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    this.setupBaseListeners();

    this.querySelectorAll<HTMLInputElement>('input[name="securityMode"]').forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked) return;
        if (this.isProcessing) {
          // The mode cannot change under a running batch; put the radio back.
          input.checked = false;
          const current = this.querySelector<HTMLInputElement>(
            `input[name="securityMode"][value="${this.mode}"]`,
          );
          if (current) current.checked = true;
          return;
        }
        void this.applyMode(input.value as SecurityMode);
      });
    });

    const fileInput = this.querySelector("#fileInput") as HTMLInputElement | null;
    const addMoreBtn = this.querySelector("#addMoreBtn") as HTMLButtonElement | null;
    const clearFilesBtn = this.querySelector("#clearFilesBtn") as HTMLButtonElement | null;
    const selectAllFilesBtn = this.querySelector("#selectAllFilesBtn") as HTMLButtonElement | null;
    const clearSelectionBtn = this.querySelector("#clearSelectionBtn") as HTMLButtonElement | null;
    const actionBtn = this.querySelector("#securityActionBtn") as HTMLButtonElement | null;
    const resumeBtn = this.querySelector("#resumeBtn") as HTMLButtonElement | null;

    addMoreBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      fileInput?.click();
    });

    clearFilesBtn?.addEventListener("click", async (event) => {
      event.preventDefault();
      await this.clearSelectedFiles();
    });

    selectAllFilesBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      this.setAllFileSelections(true);
    });

    clearSelectionBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      this.setAllFileSelections(false);
    });

    this.querySelectorAll<HTMLInputElement>('input[name="securityDownloadMode"]').forEach(
      (input) => {
        input.addEventListener("change", () => {
          if (input.checked) {
            this.downloadMode = input.value === "individual" ? "individual" : "zip";
            this.updateDownloadModeUi();
          }
        });
      },
    );

    actionBtn?.addEventListener("click", () => this.runSecurityAction());
    resumeBtn?.addEventListener("click", () => this.restoreSession());

    [
      "#openPassword",
      "#confirmPassword",
      "#ownerPassword",
      "#currentPassword",
      "#allowPrinting",
      "#allowCopying",
      "#allowModifying",
      "#allowAnnotating",
    ].forEach((selector) => {
      const element = this.querySelector(selector) as HTMLInputElement | null;
      element?.addEventListener("input", () => this.updateActionState());
      element?.addEventListener("change", () => this.updateActionState());
    });

    void this.applyMode(this.mode);
    void this.checkExistingSession();
  }

  resetState() {
    this.unlockRun += 1;
    this.files = [];
    this.selectedFile = null;
    this.unlockStates = [];
    this.fileSelections = [];
    this.downloadMode = "zip";

    const dropZone = this.querySelector("#dropZone") as HTMLElement | null;
    const fileInfo = this.querySelector("#fileInfo") as HTMLElement | null;
    const mainLayout = this.querySelector("#mainLayout") as HTMLElement | null;
    const successMessage = this.querySelector("#successMessage") as HTMLElement | null;
    const progressSection = this.querySelector("#progressSection") as HTMLElement | null;

    dropZone?.classList.remove("hidden");
    fileInfo?.classList.add("hidden");
    mainLayout?.classList.add("hidden");
    successMessage?.classList.add("hidden");
    progressSection?.classList.add("hidden");

    const openPassword = this.querySelector("#openPassword") as HTMLInputElement | null;
    const confirmPassword = this.querySelector("#confirmPassword") as HTMLInputElement | null;
    const ownerPassword = this.querySelector("#ownerPassword") as HTMLInputElement | null;
    const currentPassword = this.querySelector("#currentPassword") as HTMLInputElement | null;

    if (openPassword) openPassword.value = "";
    if (confirmPassword) confirmPassword.value = "";
    if (ownerPassword) ownerPassword.value = "";
    if (currentPassword) currentPassword.value = "";

    const allowPrinting = this.querySelector("#allowPrinting") as HTMLInputElement | null;
    const allowCopying = this.querySelector("#allowCopying") as HTMLInputElement | null;
    const allowModifying = this.querySelector("#allowModifying") as HTMLInputElement | null;
    const allowAnnotating = this.querySelector("#allowAnnotating") as HTMLInputElement | null;

    if (allowPrinting) allowPrinting.checked = DEFAULT_PERMISSIONS.allowPrinting;
    if (allowCopying) allowCopying.checked = DEFAULT_PERMISSIONS.allowCopying;
    if (allowModifying) allowModifying.checked = DEFAULT_PERMISSIONS.allowModifying;
    if (allowAnnotating) allowAnnotating.checked = DEFAULT_PERMISSIONS.allowAnnotating;

    this.setDownloadButtonLabel("Download PDF");
    this.updateProgress(0, this.mode === "protect" ? "Securing PDF..." : "Unlocking PDF...");
    this.updateFileList();
    this.updateUnlockUi();
    this.updateDownloadModeUi();
    this.updateActionState();
    void this.checkExistingSession();
  }

  async handleFiles(fileList: FileList) {
    await this.applySelectedFiles(Array.from(fileList), true);
  }

  private getSelectedFiles() {
    return this.files;
  }

  private isFileSelected(index: number) {
    return this.fileSelections[index] ?? true;
  }

  private getActiveFileEntries() {
    return this.getSelectedFiles()
      .map((file, index) => ({ file, index }))
      .filter(({ index }) => this.isFileSelected(index));
  }

  private getTotalFileSize(files: File[]) {
    return files.reduce((total, file) => total + file.size, 0);
  }

  private normalizeSavedFiles(saved: File | File[] | null | undefined) {
    if (!saved) return [];
    return Array.isArray(saved) ? saved : [saved];
  }

  private getUnlockState(index: number): UnlockInspectionState {
    return this.unlockStates[index] ?? "checking";
  }

  /** How many of the files ticked for processing are in each unlock state. */
  private getUnlockCounts() {
    return countUnlockStates(
      this.getActiveFileEntries().map(({ index }) => this.getUnlockState(index)),
    );
  }

  private getUnlockBadgeMarkup(index: number) {
    if (this.mode !== "unprotect") return "";

    const state = this.getUnlockState(index);
    const meta =
      state === "checking"
        ? {
            label: "Checking",
            background: "rgba(148, 163, 184, 0.12)",
            color: "#cbd5e1",
          }
        : state === "restriction-only"
          ? {
              label: "Restrictions only",
              background: "rgba(6, 182, 212, 0.12)",
              color: "#67e8f9",
            }
          : state === "password-required"
            ? {
                label: "Needs password",
                background: "rgba(245, 158, 11, 0.16)",
                color: "#fcd34d",
              }
            : state === "invalid"
              ? {
                  label: "Invalid file",
                  background: "rgba(239, 68, 68, 0.16)",
                  color: "#fca5a5",
                }
              : {
                  label: "Already open",
                  background: "rgba(148, 163, 184, 0.12)",
                  color: "#cbd5e1",
                };

    return `
      <span style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.18rem 0.6rem; border-radius: 999px; background: ${meta.background}; color: ${meta.color}; font-size: 0.78rem; font-weight: 600;">
        ${meta.label}
      </span>
    `;
  }

  private updateFileList() {
    const files = this.getSelectedFiles();
    const fileInfo = this.querySelector("#fileInfo") as HTMLElement | null;
    const mainLayout = this.querySelector("#mainLayout") as HTMLElement | null;
    const fileName = this.querySelector("#fileName") as HTMLElement | null;
    const fileSize = this.querySelector("#fileSize") as HTMLElement | null;
    const fileList = this.querySelector("#fileList") as HTMLElement | null;
    const fileListTitle = this.querySelector("#fileListTitle") as HTMLElement | null;
    const fileListMeta = this.querySelector("#fileListMeta") as HTMLElement | null;
    const selectAllBtn = this.querySelector("#selectAllFilesBtn") as HTMLButtonElement | null;
    const clearSelectionBtn = this.querySelector("#clearSelectionBtn") as HTMLButtonElement | null;
    const dropZone = this.querySelector("#dropZone") as HTMLElement | null;

    if (!fileInfo || !mainLayout || !fileList || !dropZone) return;

    if (files.length === 0) {
      fileList.innerHTML = "";
      fileInfo.classList.add("hidden");
      mainLayout.classList.add("hidden");
      dropZone.classList.remove("hidden");
      return;
    }

    const totalSize = this.getTotalFileSize(files);
    const selectedEntries = this.getActiveFileEntries();
    const selectedSize = this.getTotalFileSize(selectedEntries.map(({ file }) => file));
    const selectedCount = selectedEntries.length;
    dropZone.classList.add("hidden");
    fileInfo.classList.remove("hidden");
    mainLayout.classList.remove("hidden");

    if (fileName) {
      if (files.length === 1) {
        fileName.textContent = files[0].name;
      } else if (selectedCount === files.length) {
        fileName.textContent = `${getFileLabel(files.length)} selected`;
      } else {
        fileName.textContent = `${selectedCount} of ${files.length} PDFs selected`;
      }
    }

    if (fileSize) {
      if (files.length === 1) {
        fileSize.textContent = this.formatBytes(files[0].size);
      } else if (selectedCount === files.length) {
        fileSize.textContent = `${this.formatBytes(totalSize)} total`;
      } else {
        fileSize.textContent = `${this.formatBytes(selectedSize)} selected of ${this.formatBytes(totalSize)} total`;
      }
    }

    if (fileListTitle) {
      if (files.length === 1) {
        fileListTitle.textContent = "Selected PDF";
      } else if (selectedCount === files.length) {
        fileListTitle.textContent = `Selected PDFs (${files.length})`;
      } else {
        fileListTitle.textContent = `Selected PDFs (${selectedCount} of ${files.length})`;
      }
    }

    if (fileListMeta) {
      fileListMeta.textContent = getSelectionPanelMeta(
        this.mode,
        files.length,
        selectedCount,
        this.downloadMode,
        this.getUnlockCounts(),
      );
    }

    this.updateDownloadModeUi();

    if (selectAllBtn) {
      selectAllBtn.disabled = selectedCount === files.length;
    }

    if (clearSelectionBtn) {
      clearSelectionBtn.disabled = selectedCount === 0;
    }

    fileList.innerHTML = files
      .map((file, index) => {
        const safeName = this.sanitize(file.name);
        const isSelected = this.isFileSelected(index);
        return `
          <div class="file-list-item security-file-item ${isSelected ? "is-selected" : "is-unselected"}" style="cursor: default;">
            <div class="file-item-details">
              <label class="security-file-select" title="${isSelected ? "Included in this batch" : "Excluded from this batch"}">
                <input class="security-file-checkbox" data-index="${index}" type="checkbox" ${isSelected ? "checked" : ""} aria-label="Include ${safeName} in this batch" />
              </label>
              <div style="min-width: 0; display: flex; flex-direction: column; gap: 0.4rem;">
                <span class="file-name" title="${safeName}">${safeName}</span>
                <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem;">
                  <span class="file-size">${this.formatBytes(file.size)}</span>
                  ${this.getUnlockBadgeMarkup(index)}
                </div>
              </div>
            </div>
            <div class="file-item-actions">
              <button class="action-btn remove" data-index="${index}" type="button" aria-label="Remove ${safeName}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    fileList.querySelectorAll<HTMLInputElement>(".security-file-checkbox").forEach((checkbox) => {
      checkbox.onchange = () =>
        this.toggleFileSelection(parseInt(checkbox.dataset.index || "0", 10));
    });

    fileList.querySelectorAll<HTMLElement>(".remove").forEach((btn) => {
      btn.onclick = () => this.removeFile(parseInt(btn.dataset.index || "0", 10));
    });
  }

  private async applySelectedFiles(incomingFiles: File[], append: boolean) {
    if (this.isProcessing) {
      logger.info("Ignoring new files while a PDF security run is in progress");
      return;
    }
    const validFiles: File[] = [];
    for (const file of incomingFiles) {
      if (await this.validateFile(file)) {
        validFiles.push(file);
      }
    }
    if (validFiles.length === 0) return;

    const nextFiles = append ? [...this.getSelectedFiles(), ...validFiles] : [...validFiles];
    this.files = nextFiles;
    this.selectedFile = nextFiles[0] ?? null;
    this.unlockStates = initUnlockStates(nextFiles.length, this.mode);
    this.fileSelections = initFileSelections(this.fileSelections, validFiles.length, append);

    logger.info("Files loaded for PDF security", {
      count: validFiles.length,
      total: nextFiles.length,
      mode: this.mode,
    });

    this.updateFileList();
    await this.saveSession();
    this.hideSuccess();

    if (this.mode === "unprotect") {
      await this.refreshUnlockStates();
    } else {
      this.updateUnlockUi();
      this.updateActionState();
    }
  }

  private async applyMode(mode: SecurityMode) {
    this.unlockRun += 1;
    this.mode = mode;
    this.toolKey = getToolKey(mode);
    this.unlockStates = initUnlockStates(this.getSelectedFiles().length, mode);

    const title = this.querySelector("#securityTitle") as HTMLElement | null;
    const subtitle = this.querySelector("#securitySubtitle") as HTMLElement | null;
    const protectControls = this.querySelector("#protectControls") as HTMLElement | null;
    const unprotectControls = this.querySelector("#unprotectControls") as HTMLElement | null;

    if (title) title.textContent = mode === "protect" ? "Protect PDF" : "Unlock PDF";
    if (subtitle) {
      subtitle.textContent =
        mode === "protect"
          ? "Add a password and control what viewers can do with your file."
          : "Remove a known password from one or more PDFs. If a PDF already opens without one, Kyte can also remove owner restrictions.";
    }

    protectControls?.classList.toggle("hidden", mode !== "protect");
    unprotectControls?.classList.toggle("hidden", mode !== "unprotect");

    this.hideSuccess();
    this.updateFileList();

    if (this.getSelectedFiles().length > 0) {
      await this.saveSession();
      if (mode === "unprotect") {
        await this.refreshUnlockStates();
      } else {
        this.updateUnlockUi();
        this.updateActionState();
      }
    } else {
      this.updateUnlockUi();
      this.updateActionState();
      void this.checkExistingSession();
    }
  }

  private hideSuccess() {
    const successMessage = this.querySelector("#successMessage") as HTMLElement | null;
    successMessage?.classList.add("hidden");
  }

  private setDownloadButtonLabel(label: string) {
    const downloadLink = this.querySelector("#downloadLink") as HTMLButtonElement | null;
    if (downloadLink) {
      downloadLink.textContent = label;
    }
  }

  private updateDownloadModeUi() {
    const activeCount = this.getActiveFileEntries().length;
    const downloadModeGroup = this.querySelector("#downloadModeGroup") as HTMLElement | null;
    const individualRadio = this.querySelector(
      'input[name="securityDownloadMode"][value="individual"]',
    ) as HTMLInputElement | null;
    const zipRadio = this.querySelector(
      'input[name="securityDownloadMode"][value="zip"]',
    ) as HTMLInputElement | null;

    if (!downloadModeGroup) return;

    const isBatch = activeCount > 1;
    downloadModeGroup.classList.toggle("hidden", !isBatch);

    if (!isBatch) {
      this.downloadMode = "zip";
      if (zipRadio) zipRadio.checked = true;
      if (individualRadio) individualRadio.checked = false;
      return;
    }

    if (individualRadio) individualRadio.checked = this.downloadMode === "individual";
    if (zipRadio) zipRadio.checked = this.downloadMode === "zip";
  }

  private async showSecurityError(message: string) {
    await this.showDialog({
      title: "Error",
      message,
      type: "error",
    });
  }

  private getPasswordInputs() {
    return {
      openPassword: this.querySelector("#openPassword") as HTMLInputElement | null,
      confirmPassword: this.querySelector("#confirmPassword") as HTMLInputElement | null,
      ownerPassword: this.querySelector("#ownerPassword") as HTMLInputElement | null,
      currentPassword: this.querySelector("#currentPassword") as HTMLInputElement | null,
    };
  }

  private getPermissions(): PdfProtectionPermissions {
    return {
      allowPrinting:
        (this.querySelector("#allowPrinting") as HTMLInputElement | null)?.checked ??
        DEFAULT_PERMISSIONS.allowPrinting,
      allowCopying:
        (this.querySelector("#allowCopying") as HTMLInputElement | null)?.checked ??
        DEFAULT_PERMISSIONS.allowCopying,
      allowModifying:
        (this.querySelector("#allowModifying") as HTMLInputElement | null)?.checked ??
        DEFAULT_PERMISSIONS.allowModifying,
      allowAnnotating:
        (this.querySelector("#allowAnnotating") as HTMLInputElement | null)?.checked ??
        DEFAULT_PERMISSIONS.allowAnnotating,
    };
  }

  private updateUnlockUi() {
    const fileCount = this.getActiveFileEntries().length;
    const actionBtn = this.querySelector("#securityActionBtn") as HTMLButtonElement | null;
    const currentPasswordGroup = this.querySelector("#currentPasswordGroup") as HTMLElement | null;
    const unlockHelpText = this.querySelector("#unlockHelpText") as HTMLElement | null;
    const counts = this.getUnlockCounts();

    if (unlockHelpText) {
      unlockHelpText.textContent = getUnlockHelpText(this.mode, fileCount, counts);
    }

    if (this.mode !== "unprotect") {
      if (actionBtn) {
        actionBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          ${fileCount > 1 ? "Protect PDFs" : "Protect PDF"}
        `;
      }
      currentPasswordGroup?.classList.remove("hidden");
      return;
    }

    currentPasswordGroup?.classList.toggle("hidden", counts.passwordRequired === 0);

    if (actionBtn) {
      actionBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
        ${getUnlockActionLabel(fileCount, counts)}
      `;
    }
  }

  private async refreshUnlockStates() {
    const files = [...this.getSelectedFiles()];
    if (files.length === 0 || this.mode !== "unprotect") return;

    const run = ++this.unlockRun;
    this.unlockStates = files.map(() => "checking");
    this.updateFileList();
    this.updateUnlockUi();
    this.updateActionState();

    for (const file of files) {
      // A file removed while an earlier one was being checked is skipped.
      if (!this.files.includes(file)) continue;

      let state: UnlockInspectionState;
      try {
        state = await getPdfSecurityState(file);
      } catch (error) {
        // getPdfSecurityState reports every password case as a state, so
        // anything it throws means the file itself could not be read.
        logger.error("Failed to inspect PDF security state", { error, fileName: file.name });
        state = "invalid";
      }

      // A newer list, a clear or a mode change has replaced this run.
      if (run !== this.unlockRun) return;

      // Write by identity: files may have been removed while this one was read.
      const index = this.files.indexOf(file);
      if (index !== -1) this.unlockStates[index] = state;

      this.updateFileList();
      this.updateUnlockUi();
      this.updateActionState();
    }
  }

  private getValidationMessage() {
    const activeEntries = this.getActiveFileEntries();
    const { openPassword, confirmPassword, ownerPassword, currentPassword } =
      this.getPasswordInputs();
    const totalFileCount = this.getSelectedFiles().length;
    const selectedCount = activeEntries.length;

    if (this.mode === "protect") {
      return getProtectValidationMessage({
        openPassword: openPassword?.value || "",
        confirmPassword: confirmPassword?.value || "",
        ownerPassword: ownerPassword?.value || "",
        totalFileCount,
        selectedCount,
        permissionsAllowedCount: Object.values(this.getPermissions()).filter(Boolean).length,
      });
    }

    const [first] = activeEntries;
    return getUnprotectValidationMessage({
      totalFileCount,
      selectedCount,
      currentPassword: currentPassword?.value || "",
      counts: this.getUnlockCounts(),
      firstFileName: first?.file.name,
      firstFileState: first ? this.getUnlockState(first.index) : undefined,
    });
  }

  private updateActionState() {
    const actionBtn = this.querySelector("#securityActionBtn") as HTMLButtonElement | null;
    const summary = this.querySelector("#actionSummary") as HTMLElement | null;
    const mismatchWarning = this.querySelector("#passwordMismatch") as HTMLElement | null;
    const { openPassword, confirmPassword } = this.getPasswordInputs();

    const validationMessage = this.getValidationMessage();
    const protectMismatch = shouldShowPasswordMismatch(
      this.mode,
      openPassword?.value || "",
      confirmPassword?.value || "",
    );
    const hasActiveFiles = this.getActiveFileEntries().length > 0;
    const isReady = isActionReady(validationMessage, hasActiveFiles);
    const isChecking = validationMessage.startsWith("Checking");

    mismatchWarning?.classList.toggle("hidden", !protectMismatch);

    if (summary) {
      summary.textContent = validationMessage;
      summary.style.color =
        this.getSelectedFiles().length > 0 && !isReady && !isChecking
          ? "#f59e0b"
          : "var(--text-muted)";
    }

    if (!actionBtn) return;
    actionBtn.disabled = this.isProcessing || !isReady || protectMismatch;
  }

  private async saveSession() {
    try {
      const files = this.getSelectedFiles();
      if (files.length === 0) return;
      await persistence.set(this.toolKey, files);
      await persistence.delete(getOppositeToolKey(this.mode));
      await this.checkStorageUsage();
    } catch (error) {
      logger.error("Failed to save PDF security session", error);
    }
  }

  private async checkExistingSession() {
    try {
      const savedValue = await persistence.get<File | File[]>(this.toolKey);
      const savedFiles = this.normalizeSavedFiles(savedValue);
      const resumeContainer = this.querySelector("#resumeContainer") as HTMLElement | null;
      const resumeBtn = this.querySelector("#resumeBtn") as HTMLButtonElement | null;

      if (!resumeContainer || !resumeBtn || this.getSelectedFiles().length > 0) return;

      if (savedFiles.length === 0) {
        resumeContainer.classList.add("hidden");
        resumeBtn.textContent = "Resume Session";
        return;
      }

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
      const resumeLabel =
        savedFiles.length === 1
          ? `${savedFiles[0].name} (${this.formatBytes(savedFiles[0].size)})`
          : getFileLabel(savedFiles.length);
      resumeBtn.appendChild(document.createTextNode(`Resume ${resumeLabel}`));
    } catch (error) {
      logger.error("Failed to check for PDF security session", error);
    }
  }

  private async restoreSession() {
    try {
      const savedValue = await persistence.get<File | File[]>(this.toolKey);
      const savedFiles = this.normalizeSavedFiles(savedValue);
      if (savedFiles.length === 0) return;

      logger.info("Restoring PDF security session", {
        count: savedFiles.length,
        mode: this.mode,
      });

      await this.applySelectedFiles(savedFiles, false);
    } catch (error) {
      logger.error("Failed to restore PDF security session", error);
    }
  }

  private removeFile(index: number) {
    if (this.isProcessing) return;
    this.files = removeFileAtIndex(this.files, index);
    this.unlockStates = removeFileAtIndex(this.unlockStates, index);
    this.fileSelections = removeFileAtIndex(this.fileSelections, index);
    this.selectedFile = this.files[0] ?? null;
    this.hideSuccess();

    if (this.files.length === 0) {
      void persistence.delete(this.toolKey);
      this.updateFileList();
      this.updateUnlockUi();
      this.updateActionState();
      void this.checkStorageUsage();
      void this.checkExistingSession();
      return;
    }

    this.updateFileList();
    this.updateUnlockUi();
    this.updateActionState();
    void this.saveSession();
  }

  private async clearSelectedFiles() {
    if (this.isProcessing || this.getSelectedFiles().length === 0) return;

    const confirmed = await this.showConfirmDialog("Clear the selected PDFs from this session?");
    if (!confirmed) return;

    this.unlockRun += 1;
    this.files = [];
    this.selectedFile = null;
    this.unlockStates = [];
    this.fileSelections = [];
    this.hideSuccess();
    await persistence.delete(this.toolKey);
    this.updateFileList();
    this.updateUnlockUi();
    this.updateActionState();
    await this.checkStorageUsage();
    await this.checkExistingSession();
  }

  private async downloadBatchFiles(results: BatchOutput[]) {
    await this.ensureEmailCollected();

    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const normalizedBytes = new Uint8Array(result.outputBytes);
      const blob = new Blob([normalizedBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = result.outputName;
      link.click();

      URL.revokeObjectURL(url);

      if (results.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  private toggleFileSelection(index: number) {
    if (this.isProcessing) return;
    const next = toggleFileSelection(this.fileSelections, index);
    if (next === this.fileSelections) return;
    this.fileSelections = next;
    this.hideSuccess();
    this.updateFileList();
    this.updateUnlockUi();
    this.updateActionState();
  }

  private setAllFileSelections(selected: boolean) {
    if (this.isProcessing || this.getSelectedFiles().length === 0) return;
    this.fileSelections = setAllFileSelections(this.getSelectedFiles().length, selected);
    this.hideSuccess();
    this.updateFileList();
    this.updateUnlockUi();
    this.updateActionState();
  }

  private setSingleSuccessState(
    mode: SecurityMode,
    outputBytes: Uint8Array,
    outputName: string,
    state: PdfSecurityState,
  ) {
    const successTitle = this.querySelector("#successTitle") as HTMLElement | null;
    const successDetails = this.querySelector("#successDetails") as HTMLElement | null;

    if (successTitle) successTitle.textContent = getSingleSuccessTitle(mode, state);
    if (successDetails) successDetails.textContent = getSingleSuccessDetail(mode, state);

    this.setDownloadButtonLabel("Download PDF");
    this.showSuccess(outputBytes, outputName, "", ".pdf");
  }

  private async showBatchResults(
    mode: SecurityMode,
    results: BatchOutput[],
    skipped: string[],
    invalid: string[],
    failures: BatchFailureResult[],
  ) {
    if (results.length === 0) {
      if (areAllFailuresSameMessage(failures, INCORRECT_PASSWORD_ERROR)) {
        await this.showSecurityError(INCORRECT_PASSWORD_ERROR);
        return;
      }

      if (areAllFailuresSameMessage(failures, KNOWN_PASSWORD_REQUIRED_ERROR)) {
        await this.showSecurityError(KNOWN_PASSWORD_REQUIRED_ERROR);
        return;
      }

      if (failures.length === 1 && skipped.length === 0 && invalid.length === 0) {
        const failure = failures[0];
        if (KNOWN_SECURITY_ERRORS.includes(failure.message)) {
          await this.showSecurityError(failure.message);
          return;
        }
      }

      await this.showDialog({
        title: "Batch failed",
        message:
          failures.length > 0
            ? failures
                .slice(0, 3)
                .map((failure) => `${failure.fileName}: ${failure.message}`)
                .join("\n")
            : "No files were processed in this batch.",
        type: "error",
      });
      return;
    }

    const completion = {
      title:
        failures.length > 0 || skipped.length > 0 || invalid.length > 0
          ? "Batch complete"
          : "Success!",
      message: buildBatchCompletionMessage(
        mode,
        this.downloadMode,
        results,
        skipped,
        invalid,
        failures,
      ),
      type: (failures.length > 0 ? "warning" : "success") as "warning" | "success",
    };

    if (this.downloadMode === "individual") {
      this.updateProgress(96, "Downloading files...");
      await this.downloadBatchFiles(results);

      await persistence.delete(getToolKey("protect"));
      await persistence.delete(getToolKey("unprotect"));

      await this.showDialog(completion);
      return;
    }

    this.updateProgress(96, "Packing batch download...");
    const zip = new JSZip();
    // Two inputs with the same name would give two outputs with the same
    // name, and the archive would keep only the last.
    const entryNames = makeUniqueArchiveNames(results.map((result) => result.outputName));
    results.forEach((result, index) => {
      zip.file(entryNames[index], result.outputBytes);
    });

    const archiveBytes = await zip.generateAsync({ type: "uint8array" });
    const archiveName = buildBatchArchiveName(mode, results);

    const successTitle = this.querySelector("#successTitle") as HTMLElement | null;
    const successDetails = this.querySelector("#successDetails") as HTMLElement | null;

    if (successTitle) {
      successTitle.textContent = mode === "protect" ? "Batch Protected!" : "Batch Ready!";
    }

    if (successDetails) {
      successDetails.textContent = buildBatchSuccessDetails(
        mode,
        this.downloadMode,
        results,
        skipped,
        invalid,
        failures,
      );
    }

    this.setDownloadButtonLabel("Download ZIP Archive");
    this.showSuccess(archiveBytes, archiveName, "", ".zip");

    await this.recordJob(
      mode === "protect" ? "Protect Batch" : "Unprotect Batch",
      archiveName,
      archiveBytes,
      mode === "protect"
        ? {
            batch: true,
            fileCount: results.length,
            permissionsRestricted: Object.values(this.getPermissions()).filter((value) => !value)
              .length,
          }
        : {
            batch: true,
            fileCount: results.length,
            skippedCount: skipped.length,
            invalidCount: invalid.length,
            failedCount: failures.length,
            restrictionsRemoved: results.filter(
              (result) => result.resultType === "restrictions-removed",
            ).length,
            passwordRemoved: results.filter((result) => result.resultType === "password-removed")
              .length,
          },
    );

    await persistence.delete(getToolKey("protect"));
    await persistence.delete(getToolKey("unprotect"));

    await this.showDialog(completion);
  }

  private async processFile(mode: SecurityMode, entry: RunEntry, settings: RunSettings) {
    if (mode === "protect") {
      return await protectPdf(entry.file, {
        userPassword: settings.userPassword,
        ownerPassword: settings.ownerPassword,
        permissions: settings.permissions,
      });
    }
    return await unprotectPdf(
      entry.file,
      entry.state === "restriction-only" ? "" : settings.currentPassword,
    );
  }

  private getOutputSuffix(mode: SecurityMode, state: UnlockInspectionState) {
    if (mode === "protect") return "_protected";
    return state === "restriction-only" ? "_unrestricted" : "_unprotected";
  }

  private async runSingle(mode: SecurityMode, entry: RunEntry, settings: RunSettings) {
    const state: PdfSecurityState = entry.state === "checking" ? "password-required" : entry.state;

    this.updateProgress(
      15,
      mode === "protect"
        ? "Reading PDF..."
        : state === "restriction-only"
          ? "Removing owner restrictions..."
          : "Verifying password...",
    );

    const outputBytes = await this.processFile(mode, { ...entry, state }, settings);

    this.updateProgress(100, mode === "protect" ? "Protection applied." : "Password removed.");

    const outputName = generateOutputFilename(entry.file.name, this.getOutputSuffix(mode, state));

    this.setSingleSuccessState(mode, outputBytes, outputName, state);
    await this.recordJob(
      mode === "protect" ? "Protect" : "Unprotect",
      outputName,
      outputBytes,
      mode === "protect"
        ? {
            permissionsRestricted: Object.values(settings.permissions).filter((value) => !value)
              .length,
          }
        : {
            restrictionsRemoved: state === "restriction-only",
            passwordRemoved: state !== "restriction-only",
          },
    );

    await persistence.delete(getToolKey("protect"));
    await persistence.delete(getToolKey("unprotect"));

    await this.showSuccessDialog(
      mode === "protect"
        ? "Your PDF is now password-protected."
        : state === "restriction-only"
          ? "Owner restrictions were removed from your PDF."
          : "The password was removed from your PDF.",
    );
  }

  private async runBatch(mode: SecurityMode, entries: RunEntry[], settings: RunSettings) {
    const batchResults: BatchOutput[] = [];
    const batchFailures: BatchFailureResult[] = [];
    const skippedFiles: string[] = [];
    const invalidFiles: string[] = [];
    const totalFiles = entries.length;

    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex];
      const { file, state } = entry;
      const currentPercent = Math.round((entryIndex / totalFiles) * 85);

      if (mode === "unprotect" && state === "unprotected") {
        skippedFiles.push(file.name);
        this.updateProgress(
          currentPercent,
          `Skipping ${file.name} because it already opens without restrictions...`,
        );
        continue;
      }

      if (mode === "unprotect" && state === "invalid") {
        // Announced as skipped before the run, so reported as skipped after it.
        invalidFiles.push(file.name);
        this.updateProgress(
          currentPercent,
          `Skipping ${file.name} — file is corrupted or invalid...`,
        );
        continue;
      }

      this.updateProgress(
        Math.max(8, currentPercent),
        mode === "protect"
          ? `Protecting ${entryIndex + 1} of ${totalFiles}: ${file.name}`
          : state === "restriction-only"
            ? `Removing restrictions from ${entryIndex + 1} of ${totalFiles}: ${file.name}`
            : `Unlocking ${entryIndex + 1} of ${totalFiles}: ${file.name}`,
      );

      try {
        const outputBytes = await this.processFile(mode, entry, settings);
        batchResults.push({
          fileName: file.name,
          outputName: generateOutputFilename(file.name, this.getOutputSuffix(mode, state)),
          outputBytes,
          resultType:
            mode === "protect"
              ? "protected"
              : state === "restriction-only"
                ? "restrictions-removed"
                : "password-removed",
        });
      } catch (error) {
        logger.error("PDF security batch item failed", { error, fileName: file.name, mode });
        batchFailures.push({
          fileName: file.name,
          message: getSecurityErrorMessage(error) ?? mapError(error, ""),
        });
      }
    }

    this.updateProgress(100, "Batch processing complete.");
    await this.showBatchResults(mode, batchResults, skippedFiles, invalidFiles, batchFailures);
  }

  private async runSecurityAction() {
    if (this.isProcessing) return;
    const selectedEntries = this.getActiveFileEntries();
    if (selectedEntries.length === 0) return;

    const validationMessage = this.getValidationMessage();
    if (!validationMessage.startsWith("Ready")) {
      await this.showSecurityError(validationMessage);
      return;
    }

    const actionBtn = this.querySelector("#securityActionBtn") as HTMLButtonElement | null;
    const progressSection = this.querySelector("#progressSection") as HTMLElement | null;
    if (!actionBtn) return;

    // Read everything the run depends on once, so nothing that changes on the
    // page while it runs can change what happens to the files already queued.
    const mode = this.mode;
    const { openPassword, ownerPassword, currentPassword } = this.getPasswordInputs();
    const settings: RunSettings = {
      userPassword: openPassword?.value || "",
      ownerPassword: ownerPassword?.value || "",
      currentPassword: currentPassword?.value || "",
      permissions: this.getPermissions(),
    };
    const entries: RunEntry[] = selectedEntries.map(({ file, index }) => ({
      file,
      state: mode === "unprotect" ? this.getUnlockState(index) : "unprotected",
    }));

    this.isProcessing = true;
    try {
      this.hideSuccess();
      actionBtn.disabled = true;
      progressSection?.classList.remove("hidden");
      this.updateProgress(0, mode === "protect" ? "Securing PDF..." : "Unlocking PDF...");

      if (entries.length === 1) {
        await this.runSingle(mode, entries[0], settings);
      } else {
        await this.runBatch(mode, entries, settings);
      }
    } catch (error) {
      logger.error("PDF security action failed", { error, mode });
      const message = getSecurityErrorMessage(error);
      if (message) {
        await this.showSecurityError(message);
      } else {
        await this.showErrorDialog(error);
      }
    } finally {
      this.isProcessing = false;
      progressSection?.classList.add("hidden");
      this.updateActionState();
    }
  }
}

customElements.define("pdf-security", PdfSecurity);
