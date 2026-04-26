import JSZip from "jszip";
import { logger } from "../utils/logger.ts";
import {
  ALREADY_PROTECTED_ERROR,
  getPdfSecurityState,
  INCORRECT_PASSWORD_ERROR,
  KNOWN_PASSWORD_REQUIRED_ERROR,
  NOT_PROTECTED_ERROR,
  type PdfProtectionPermissions,
  type PdfSecurityState,
  protectPdf,
  unprotectPdf,
} from "../utils/pdfSecurity.ts";
import { generateOutputFilename } from "../utils/pdfUtils.ts";
import { persistence } from "../utils/persistence.ts";
import { BaseComponent } from "./BaseComponent.ts";

type SecurityMode = "protect" | "unprotect";
type UnlockInspectionState = PdfSecurityState | "checking";
type SecurityResultType = "protected" | "password-removed" | "restrictions-removed";

interface BatchSuccessResult {
  file: File;
  outputName: string;
  outputBytes: Uint8Array;
  resultType: SecurityResultType;
}

interface BatchFailureResult {
  file: File;
  message: string;
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
  private downloadMode: "individual" | "zip" = "zip";

  render() {
    this.mode = this.getAttribute("mode") === "unprotect" ? "unprotect" : "protect";
    this.toolKey = this.getToolKey(this.mode);

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
        if (input.checked) {
          void this.applyMode(input.value as SecurityMode);
        }
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

  private getToolKey(mode: SecurityMode) {
    return mode === "protect" ? "pdf-protect" : "pdf-unprotect";
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

  private getFileLabel(fileCount: number, singular = "PDF", plural = "PDFs") {
    return `${fileCount} ${fileCount === 1 ? singular : plural}`;
  }

  private getTotalFileSize(files: File[]) {
    return files.reduce((total, file) => total + file.size, 0);
  }

  private getSelectionPanelMeta(totalCount: number, selectedCount: number) {
    if (totalCount === 0) {
      return "Upload one or more PDFs to begin.";
    }

    if (selectedCount === 0) {
      return `Select at least one PDF from the ${this.getFileLabel(totalCount)} loaded in this batch.`;
    }

    if (this.mode === "protect") {
      const baseMessage =
        selectedCount === 1
          ? "This PDF will be exported as a separately protected copy."
          : this.downloadMode === "individual"
            ? "Each PDF will be protected individually and downloaded as a separate file."
            : "Each PDF will be protected individually and packaged together when the batch completes.";

      return selectedCount === totalCount
        ? baseMessage
        : `${selectedCount} of ${totalCount} selected. ${baseMessage}`;
    }

    const counts = this.getUnlockCounts(true);
    if (counts.checking > 0) {
      return `Inspecting ${this.getFileLabel(selectedCount)} for passwords and owner restrictions.`;
    }

    const parts: string[] = [];

    if (counts.passwordRequired > 0) {
      parts.push(
        `${this.getFileLabel(counts.passwordRequired)} ${counts.passwordRequired === 1 ? "needs" : "need"} the shared password`,
      );
    }

    if (counts.restrictionOnly > 0) {
      parts.push(
        `${this.getFileLabel(counts.restrictionOnly)} ${counts.restrictionOnly === 1 ? "is" : "are"} restriction-only`,
      );
    }

    if (counts.unprotected > 0) {
      parts.push(
        `${this.getFileLabel(counts.unprotected)} ${counts.unprotected === 1 ? "already opens" : "already open"}`,
      );
    }

    if (parts.length === 0) {
      const baseMessage =
        selectedCount === 1
          ? "This PDF does not currently need a password or restriction change."
          : "These PDFs do not currently need a password or restriction change.";

      return selectedCount === totalCount
        ? baseMessage
        : `${selectedCount} of ${totalCount} selected. ${baseMessage}`;
    }

    const summary = parts.join(" • ");
    const delivery =
      selectedCount > 1
        ? this.downloadMode === "individual"
          ? " • Separate downloads"
          : " • One ZIP archive"
        : "";

    return selectedCount === totalCount
      ? `${summary}${delivery}`
      : `${selectedCount} of ${totalCount} selected • ${summary}${delivery}`;
  }

  private normalizeSavedFiles(saved: File | File[] | null | undefined) {
    if (!saved) return [];
    return Array.isArray(saved) ? saved : [saved];
  }

  private getUnlockState(index: number): UnlockInspectionState {
    return this.unlockStates[index] ?? "checking";
  }

  private getUnlockCounts(selectedOnly = false) {
    const counts = {
      checking: 0,
      restrictionOnly: 0,
      passwordRequired: 0,
      unprotected: 0,
    };

    const entries = selectedOnly
      ? this.getActiveFileEntries()
      : this.getSelectedFiles().map((file, index) => ({ file, index }));

    entries.forEach(({ index }) => {
      const state = this.getUnlockState(index);
      if (state === "checking") counts.checking += 1;
      if (state === "restriction-only") counts.restrictionOnly += 1;
      if (state === "password-required") counts.passwordRequired += 1;
      if (state === "unprotected") counts.unprotected += 1;
    });

    return counts;
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
        fileName.textContent = `${this.getFileLabel(files.length)} selected`;
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
      fileListMeta.textContent = this.getSelectionPanelMeta(files.length, selectedCount);
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
    this.unlockStates = nextFiles.map(() =>
      this.mode === "unprotect" ? "checking" : "unprotected",
    );
    this.fileSelections = append
      ? [...this.fileSelections, ...validFiles.map(() => true)]
      : validFiles.map(() => true);

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
    this.mode = mode;
    this.toolKey = this.getToolKey(mode);
    this.unlockStates = this.getSelectedFiles().map(() =>
      mode === "unprotect" ? "checking" : "unprotected",
    );

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
    const counts = this.getUnlockCounts(true);

    if (this.mode !== "unprotect") {
      if (actionBtn) {
        actionBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          ${fileCount > 1 ? "Protect PDFs" : "Protect PDF"}
        `;
      }
      currentPasswordGroup?.classList.remove("hidden");
      if (unlockHelpText) {
        unlockHelpText.textContent =
          "Unlock removes a known password. If a PDF already opens without one, Kyte can also export an unrestricted copy without asking for a password.";
      }
      return;
    }

    if (fileCount === 0) {
      currentPasswordGroup?.classList.add("hidden");
      if (actionBtn) {
        actionBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
          Unlock PDF
        `;
      }
      if (unlockHelpText) {
        unlockHelpText.textContent =
          "Select one or more PDFs in the left pane to choose the files Kyte should unlock.";
      }
      return;
    }

    const needsKnownPassword = counts.passwordRequired > 0;
    const hasRestrictionOnly = counts.restrictionOnly > 0;
    currentPasswordGroup?.classList.toggle("hidden", !needsKnownPassword);

    if (actionBtn) {
      const label = needsKnownPassword
        ? fileCount > 1
          ? "Unlock PDFs"
          : "Remove Known Password"
        : "Remove Restrictions";

      actionBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
        ${label}
      `;
    }

    if (unlockHelpText) {
      if (counts.checking > 0) {
        unlockHelpText.textContent =
          fileCount > 1
            ? "Kyte is checking each selected PDF to see whether it needs the current password or only has owner restrictions."
            : "Kyte is checking whether this PDF only has owner restrictions or requires its current password.";
      } else if (needsKnownPassword && hasRestrictionOnly) {
        unlockHelpText.textContent =
          "Kyte will use the current password for files that need it, and it will also export unrestricted copies for files that already open without one.";
      } else if (needsKnownPassword) {
        unlockHelpText.textContent =
          fileCount > 1
            ? "Use one current password to unlock all selected PDFs that share it."
            : "Unlock removes a known password from the selected PDF.";
      } else if (hasRestrictionOnly) {
        unlockHelpText.textContent =
          fileCount > 1
            ? "These PDFs already open without a password but still have owner restrictions. Kyte can export unrestricted copies with no password entry."
            : "This PDF already opens without a password but still has owner restrictions. Kyte can export an unrestricted copy with no password entry.";
      } else {
        unlockHelpText.textContent =
          fileCount > 1
            ? "Kyte will skip PDFs that already open normally and only process the files that still carry passwords or owner restrictions."
            : "This PDF does not currently need a password or owner-restriction removal.";
      }
    }
  }

  private async refreshUnlockStates() {
    const files = [...this.getSelectedFiles()];
    if (files.length === 0 || this.mode !== "unprotect") return;

    this.unlockStates = files.map(() => "checking");
    this.updateFileList();
    this.updateUnlockUi();
    this.updateActionState();

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];

      try {
        this.unlockStates[index] = await getPdfSecurityState(file);
      } catch (error) {
        logger.error("Failed to inspect PDF security state", { error, fileName: file.name });
        this.unlockStates[index] = "password-required";
      }

      if (this.mode !== "unprotect") {
        return;
      }

      this.updateFileList();
      this.updateUnlockUi();
      this.updateActionState();
    }
  }

  private getValidationMessage() {
    const activeEntries = this.getActiveFileEntries();
    const files = activeEntries.map(({ file }) => file);
    const { openPassword, confirmPassword, ownerPassword, currentPassword } =
      this.getPasswordInputs();
    const fileCount = files.length;

    if (fileCount === 0) {
      return this.getSelectedFiles().length === 0
        ? "Upload one or more PDFs to continue."
        : "Select at least one PDF to continue.";
    }

    if (this.mode === "protect") {
      const openValue = openPassword?.value || "";
      const confirmValue = confirmPassword?.value || "";
      const ownerValue = ownerPassword?.value || "";

      if (!openValue) return "Enter a password to protect the selected PDFs.";
      if (openValue.length < 4) return "Use at least 4 characters for the open password.";
      if (!confirmValue) return "Confirm the password to continue.";
      if (openValue !== confirmValue) return "Passwords must match.";
      if (ownerValue && ownerValue === openValue) {
        return "Owner password must be different or left blank.";
      }

      const permissions = this.getPermissions();
      const allowed = Object.values(permissions).filter(Boolean).length;
      return allowed > 0
        ? `Ready to protect ${this.getFileLabel(fileCount)} with ${allowed} viewer permission${allowed === 1 ? "" : "s"} enabled.`
        : `Ready to protect ${this.getFileLabel(fileCount)} with all editing permissions disabled.`;
    }

    const counts = this.getUnlockCounts(true);
    if (counts.checking > 0) {
      return fileCount > 1
        ? "Checking selected PDFs for passwords and owner restrictions..."
        : "Checking whether this PDF requires a known password...";
    }

    if (counts.passwordRequired === 0 && counts.restrictionOnly === 0) {
      return fileCount > 1
        ? "None of the selected PDFs currently have a password or owner restrictions."
        : "This PDF does not currently have a password or owner restrictions.";
    }

    if (counts.passwordRequired > 0 && !currentPassword?.value) {
      const passwordLabel =
        counts.passwordRequired === fileCount
          ? this.getFileLabel(fileCount)
          : this.getFileLabel(counts.passwordRequired);
      const extraDetails: string[] = [];

      if (counts.restrictionOnly > 0) {
        extraDetails.push(
          `${this.getFileLabel(counts.restrictionOnly)} ${counts.restrictionOnly === 1 ? "will" : "will"} only have owner restrictions removed.`,
        );
      }

      if (counts.unprotected > 0) {
        extraDetails.push(
          `${this.getFileLabel(counts.unprotected)} ${counts.unprotected === 1 ? "will be" : "will be"} skipped because ${counts.unprotected === 1 ? "it is" : "they are"} already unprotected.`,
        );
      }

      return `Enter the current password to unlock ${passwordLabel}.${extraDetails.length > 0 ? ` ${extraDetails.join(" ")}` : ""}`;
    }

    if (fileCount === 1) {
      const state = this.getUnlockState(activeEntries[0].index);
      if (state === "restriction-only") {
        return `Ready to remove owner restrictions from ${files[0].name}. No password required.`;
      }

      return `Ready to remove the known password from ${files[0].name}.`;
    }

    const readyParts: string[] = [];
    if (counts.passwordRequired > 0) {
      readyParts.push(
        `${this.getFileLabel(counts.passwordRequired)} will have the known password removed.`,
      );
    }
    if (counts.restrictionOnly > 0) {
      readyParts.push(
        `${this.getFileLabel(counts.restrictionOnly)} will have owner restrictions removed.`,
      );
    }
    if (counts.unprotected > 0) {
      readyParts.push(
        `${this.getFileLabel(counts.unprotected)} will be skipped because ${counts.unprotected === 1 ? "it is" : "they are"} already unprotected.`,
      );
    }

    return `Ready to process ${this.getFileLabel(fileCount)}. ${readyParts.join(" ")}`;
  }

  private updateActionState() {
    const actionBtn = this.querySelector("#securityActionBtn") as HTMLButtonElement | null;
    const summary = this.querySelector("#actionSummary") as HTMLElement | null;
    const mismatchWarning = this.querySelector("#passwordMismatch") as HTMLElement | null;
    const { openPassword, confirmPassword } = this.getPasswordInputs();

    const validationMessage = this.getValidationMessage();
    const protectMismatch =
      this.mode === "protect" &&
      !!confirmPassword?.value &&
      openPassword?.value !== confirmPassword?.value;
    const isReady = validationMessage.startsWith("Ready");
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
    actionBtn.disabled = this.getActiveFileEntries().length === 0 || !isReady || protectMismatch;
  }

  private async saveSession() {
    try {
      const files = this.getSelectedFiles();
      if (files.length === 0) return;
      await persistence.set(this.toolKey, files);
      await persistence.delete(this.getToolKey(this.mode === "protect" ? "unprotect" : "protect"));
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
      resumeBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
        Resume ${savedFiles.length === 1 ? `${savedFiles[0].name} (${this.formatBytes(savedFiles[0].size)})` : this.getFileLabel(savedFiles.length)}
      `;
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
    this.files.splice(index, 1);
    this.unlockStates.splice(index, 1);
    this.fileSelections.splice(index, 1);
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
    if (this.getSelectedFiles().length === 0) return;

    const confirmed = await this.showConfirmDialog("Clear the selected PDFs from this session?");
    if (!confirmed) return;

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

  private async downloadBatchFiles(results: BatchSuccessResult[]) {
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
    if (index < 0 || index >= this.fileSelections.length) return;
    this.fileSelections[index] = !this.isFileSelected(index);
    this.hideSuccess();
    this.updateFileList();
    this.updateUnlockUi();
    this.updateActionState();
  }

  private setAllFileSelections(selected: boolean) {
    if (this.getSelectedFiles().length === 0) return;
    this.fileSelections = this.getSelectedFiles().map(() => selected);
    this.hideSuccess();
    this.updateFileList();
    this.updateUnlockUi();
    this.updateActionState();
  }

  private setSingleSuccessState(
    outputBytes: Uint8Array,
    outputName: string,
    state: PdfSecurityState,
  ) {
    const successTitle = this.querySelector("#successTitle") as HTMLElement | null;
    const successDetails = this.querySelector("#successDetails") as HTMLElement | null;

    if (successTitle) {
      successTitle.textContent =
        this.mode === "protect"
          ? "PDF Protected!"
          : state === "restriction-only"
            ? "Restrictions Removed!"
            : "Password Removed!";
    }

    if (successDetails) {
      successDetails.textContent =
        this.mode === "protect"
          ? "The exported copy now requires the password you set."
          : state === "restriction-only"
            ? "The exported copy opens normally and no longer carries owner restrictions."
            : "The exported copy opens without asking for a password.";
    }

    this.setDownloadButtonLabel("Download PDF");
    this.showSuccess(outputBytes, outputName, "", ".pdf");
  }

  private buildBatchArchiveName(results: BatchSuccessResult[]) {
    if (this.mode === "protect") {
      return "protected_pdfs.zip";
    }

    return results.every((result) => result.resultType === "restrictions-removed")
      ? "unrestricted_pdfs.zip"
      : "unlocked_pdfs.zip";
  }

  private buildBatchSuccessDetails(
    results: BatchSuccessResult[],
    skipped: File[],
    failures: BatchFailureResult[],
  ) {
    const passwordRemovedCount = results.filter(
      (result) => result.resultType === "password-removed",
    ).length;
    const restrictionsRemovedCount = results.filter(
      (result) => result.resultType === "restrictions-removed",
    ).length;
    const protectedCount = results.filter((result) => result.resultType === "protected").length;
    const parts: string[] = [];
    const deliveryText =
      this.downloadMode === "individual"
        ? `${this.getFileLabel(results.length)} ${results.length === 1 ? "was" : "were"} downloaded individually.`
        : `${this.getFileLabel(results.length)} ${results.length === 1 ? "is" : "are"} ready in one ZIP archive.`;

    if (this.mode === "protect") {
      parts.push(
        this.downloadMode === "individual"
          ? `${this.getFileLabel(protectedCount)} ${protectedCount === 1 ? "was" : "were"} downloaded individually.`
          : `${this.getFileLabel(protectedCount)} ${protectedCount === 1 ? "is" : "are"} ready in one ZIP archive.`,
      );
    } else {
      parts.push(deliveryText);
      if (passwordRemovedCount > 0) {
        parts.push(`${this.getFileLabel(passwordRemovedCount)} had the known password removed.`);
      }
      if (restrictionsRemovedCount > 0) {
        parts.push(
          `${this.getFileLabel(restrictionsRemovedCount)} had owner restrictions removed.`,
        );
      }
    }

    if (skipped.length > 0) {
      parts.push(
        `${this.getFileLabel(skipped.length)} ${skipped.length === 1 ? "was" : "were"} skipped because ${skipped.length === 1 ? "it is" : "they are"} already unprotected.`,
      );
    }

    if (failures.length > 0) {
      parts.push(
        `${this.getFileLabel(failures.length, "file", "files")} failed and ${failures.length === 1 ? "was" : "were"} left out of the archive.`,
      );
    }

    return parts.join(" ");
  }

  private buildBatchCompletionMessage(
    results: BatchSuccessResult[],
    skipped: File[],
    failures: BatchFailureResult[],
  ) {
    const summary = this.buildBatchSuccessDetails(results, skipped, failures);
    if (failures.length === 0) return summary;

    const failurePreview = failures
      .slice(0, 3)
      .map((failure) => `${failure.file.name}: ${failure.message}`)
      .join("\n");

    return `${summary}\n\n${failurePreview}${failures.length > 3 ? `\n+ ${failures.length - 3} more` : ""}`;
  }

  private areAllFailuresSameMessage(failures: BatchFailureResult[], message: string) {
    return failures.length > 0 && failures.every((failure) => failure.message === message);
  }

  private async showBatchResults(
    results: BatchSuccessResult[],
    skipped: File[],
    failures: BatchFailureResult[],
  ) {
    if (results.length === 0) {
      if (this.areAllFailuresSameMessage(failures, INCORRECT_PASSWORD_ERROR)) {
        await this.showSecurityError(INCORRECT_PASSWORD_ERROR);
        return;
      }

      if (this.areAllFailuresSameMessage(failures, KNOWN_PASSWORD_REQUIRED_ERROR)) {
        await this.showSecurityError(KNOWN_PASSWORD_REQUIRED_ERROR);
        return;
      }

      if (failures.length === 1 && skipped.length === 0) {
        const failure = failures[0];
        if (
          [
            ALREADY_PROTECTED_ERROR,
            NOT_PROTECTED_ERROR,
            INCORRECT_PASSWORD_ERROR,
            KNOWN_PASSWORD_REQUIRED_ERROR,
          ].includes(failure.message)
        ) {
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
                .map((failure) => `${failure.file.name}: ${failure.message}`)
                .join("\n")
            : "No files were processed in this batch.",
        type: "error",
      });
      return;
    }

    if (this.downloadMode === "individual") {
      this.updateProgress(96, "Downloading files...");
      await this.downloadBatchFiles(results);

      await persistence.delete(this.getToolKey("protect"));
      await persistence.delete(this.getToolKey("unprotect"));

      await this.showDialog({
        title: failures.length > 0 || skipped.length > 0 ? "Batch complete" : "Success!",
        message: this.buildBatchCompletionMessage(results, skipped, failures),
        type: failures.length > 0 ? "warning" : "success",
      });
      return;
    }

    this.updateProgress(96, "Packing batch download...");
    const zip = new JSZip();
    results.forEach((result) => {
      zip.file(result.outputName, result.outputBytes);
    });

    const archiveBytes = await zip.generateAsync({ type: "uint8array" });
    const archiveName = this.buildBatchArchiveName(results);

    const successTitle = this.querySelector("#successTitle") as HTMLElement | null;
    const successDetails = this.querySelector("#successDetails") as HTMLElement | null;

    if (successTitle) {
      successTitle.textContent = this.mode === "protect" ? "Batch Protected!" : "Batch Ready!";
    }

    if (successDetails) {
      successDetails.textContent = this.buildBatchSuccessDetails(results, skipped, failures);
    }

    this.setDownloadButtonLabel("Download ZIP Archive");
    this.showSuccess(archiveBytes, archiveName, "", ".zip");

    await this.recordJob(
      this.mode === "protect" ? "Protect Batch" : "Unprotect Batch",
      archiveName,
      archiveBytes,
      this.mode === "protect"
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
            failedCount: failures.length,
            restrictionsRemoved: results.filter(
              (result) => result.resultType === "restrictions-removed",
            ).length,
            passwordRemoved: results.filter((result) => result.resultType === "password-removed")
              .length,
          },
    );

    await persistence.delete(this.getToolKey("protect"));
    await persistence.delete(this.getToolKey("unprotect"));

    await this.showDialog({
      title: failures.length > 0 || skipped.length > 0 ? "Batch complete" : "Success!",
      message: this.buildBatchCompletionMessage(results, skipped, failures),
      type: failures.length > 0 ? "warning" : "success",
    });
  }

  private async runSecurityAction() {
    const selectedEntries = this.getActiveFileEntries();
    const files = selectedEntries.map(({ file }) => file);
    if (files.length === 0) return;

    const validationMessage = this.getValidationMessage();
    if (!validationMessage.startsWith("Ready")) {
      await this.showSecurityError(validationMessage);
      return;
    }

    const actionBtn = this.querySelector("#securityActionBtn") as HTMLButtonElement | null;
    const progressSection = this.querySelector("#progressSection") as HTMLElement | null;
    const { openPassword, ownerPassword, currentPassword } = this.getPasswordInputs();
    const isBatch = files.length > 1;

    try {
      if (!actionBtn) return;

      this.hideSuccess();
      actionBtn.disabled = true;
      progressSection?.classList.remove("hidden");
      this.updateProgress(0, this.mode === "protect" ? "Securing PDF..." : "Unlocking PDF...");

      if (!isBatch) {
        const [{ file, index: sourceIndex }] = selectedEntries;
        const state = this.mode === "unprotect" ? this.getUnlockState(sourceIndex) : "unprotected";
        const resolvedState: PdfSecurityState = state === "checking" ? "password-required" : state;

        this.updateProgress(
          15,
          this.mode === "protect"
            ? "Reading PDF..."
            : resolvedState === "restriction-only"
              ? "Removing owner restrictions..."
              : "Verifying password...",
        );

        const outputBytes =
          this.mode === "protect"
            ? await protectPdf(file, {
                userPassword: openPassword?.value || "",
                ownerPassword: ownerPassword?.value || "",
                permissions: this.getPermissions(),
              })
            : await unprotectPdf(
                file,
                resolvedState === "restriction-only" ? "" : currentPassword?.value || "",
              );

        this.updateProgress(
          100,
          this.mode === "protect" ? "Protection applied." : "Password removed.",
        );

        const outputName = generateOutputFilename(
          file.name,
          this.mode === "protect"
            ? "_protected"
            : resolvedState === "restriction-only"
              ? "_unrestricted"
              : "_unprotected",
        );

        this.setSingleSuccessState(outputBytes, outputName, resolvedState);
        await this.recordJob(
          this.mode === "protect" ? "Protect" : "Unprotect",
          outputName,
          outputBytes,
          this.mode === "protect"
            ? {
                permissionsRestricted: Object.values(this.getPermissions()).filter(
                  (value) => !value,
                ).length,
              }
            : {
                restrictionsRemoved: resolvedState === "restriction-only",
                passwordRemoved: resolvedState !== "restriction-only",
              },
        );

        await persistence.delete(this.getToolKey("protect"));
        await persistence.delete(this.getToolKey("unprotect"));

        await this.showSuccessDialog(
          this.mode === "protect"
            ? "Your PDF is now password-protected."
            : resolvedState === "restriction-only"
              ? "Owner restrictions were removed from your PDF."
              : "The password was removed from your PDF.",
        );

        return;
      }

      const batchResults: BatchSuccessResult[] = [];
      const batchFailures: BatchFailureResult[] = [];
      const skippedFiles: File[] = [];
      const activePassword = currentPassword?.value || "";
      const totalFiles = selectedEntries.length;

      for (let entryIndex = 0; entryIndex < selectedEntries.length; entryIndex += 1) {
        const { file, index: sourceIndex } = selectedEntries[entryIndex];
        const state = this.mode === "unprotect" ? this.getUnlockState(sourceIndex) : "unprotected";
        const currentPercent = Math.round((entryIndex / totalFiles) * 85);

        if (this.mode === "unprotect" && state === "unprotected") {
          skippedFiles.push(file);
          this.updateProgress(
            currentPercent,
            `Skipping ${file.name} because it already opens without restrictions...`,
          );
          continue;
        }

        this.updateProgress(
          Math.max(8, currentPercent),
          this.mode === "protect"
            ? `Protecting ${entryIndex + 1} of ${totalFiles}: ${file.name}`
            : state === "restriction-only"
              ? `Removing restrictions from ${entryIndex + 1} of ${totalFiles}: ${file.name}`
              : `Unlocking ${entryIndex + 1} of ${totalFiles}: ${file.name}`,
        );

        try {
          const outputBytes =
            this.mode === "protect"
              ? await protectPdf(file, {
                  userPassword: openPassword?.value || "",
                  ownerPassword: ownerPassword?.value || "",
                  permissions: this.getPermissions(),
                })
              : await unprotectPdf(file, state === "restriction-only" ? "" : activePassword);

          batchResults.push({
            file,
            outputName: generateOutputFilename(
              file.name,
              this.mode === "protect"
                ? "_protected"
                : state === "restriction-only"
                  ? "_unrestricted"
                  : "_unprotected",
            ),
            outputBytes,
            resultType:
              this.mode === "protect"
                ? "protected"
                : state === "restriction-only"
                  ? "restrictions-removed"
                  : "password-removed",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          batchFailures.push({ file, message });
        }
      }

      this.updateProgress(100, "Batch processing complete.");
      await this.showBatchResults(batchResults, skippedFiles, batchFailures);
    } catch (error) {
      logger.error("PDF security action failed", { error, mode: this.mode });
      if (
        error instanceof Error &&
        [
          ALREADY_PROTECTED_ERROR,
          NOT_PROTECTED_ERROR,
          INCORRECT_PASSWORD_ERROR,
          KNOWN_PASSWORD_REQUIRED_ERROR,
        ].includes(error.message)
      ) {
        await this.showSecurityError(error.message);
      } else {
        await this.showErrorDialog(error);
      }
    } finally {
      progressSection?.classList.add("hidden");
      this.updateActionState();
    }
  }
}

customElements.define("pdf-security", PdfSecurity);
