/**
 * pdfSecurityWorkflow.ts
 *
 * Pure, DOM-free business logic extracted from components/PdfSecurity.ts.
 * All functions are deterministic and can be unit-tested without jsdom.
 *
 * The Web Component remains as the thin shell that renders HTML,
 * binds DOM events, and delegates decisions to functions here.
 */

import type { PdfSecurityState } from "./pdfSecurity.ts";

// ---------------------------------------------------------------------------
// Types (mirrored from PdfSecurity component, kept local to avoid coupling)
// ---------------------------------------------------------------------------

export type SecurityMode = "protect" | "unprotect";
export type UnlockInspectionState = PdfSecurityState | "checking";
export type SecurityResultType = "protected" | "password-removed" | "restrictions-removed";
export type DownloadMode = "individual" | "zip";

export interface UnlockCounts {
  checking: number;
  restrictionOnly: number;
  passwordRequired: number;
  unprotected: number;
}

export interface BatchSuccessResult {
  fileName: string;
  outputName: string;
  resultType: SecurityResultType;
}

export interface BatchFailureResult {
  fileName: string;
  message: string;
}

export interface ProtectValidationInput {
  openPassword: string;
  confirmPassword: string;
  ownerPassword: string;
  fileCount: number;
  selectedCount: number;
  permissionsAllowedCount: number;
}

export interface UnprotectValidationInput {
  fileCount: number;
  totalFileCount: number;
  selectedCount: number;
  currentPassword: string;
  counts: UnlockCounts;
  firstFileName?: string;
  firstFileState?: UnlockInspectionState;
}

// ---------------------------------------------------------------------------
// File label helper
// ---------------------------------------------------------------------------

/**
 * Returns a count + noun phrase, switching between singular and plural.
 * e.g. getFileLabel(1) → "1 PDF", getFileLabel(3) → "3 PDFs"
 */
export function getFileLabel(count: number, singular = "PDF", plural = "PDFs"): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

// ---------------------------------------------------------------------------
// Tool key helpers
// ---------------------------------------------------------------------------

export function getToolKey(mode: SecurityMode): string {
  return mode === "protect" ? "pdf-protect" : "pdf-unprotect";
}

export function getOppositeToolKey(mode: SecurityMode): string {
  return getToolKey(mode === "protect" ? "unprotect" : "protect");
}

// ---------------------------------------------------------------------------
// Unlock state aggregation
// ---------------------------------------------------------------------------

/**
 * Counts how many files are in each unlock inspection state.
 * Works on any subset of the full file list (used for both "all" and "selected" views).
 */
export function countUnlockStates(states: UnlockInspectionState[]): UnlockCounts {
  return states.reduce<UnlockCounts>(
    (acc, state) => {
      if (state === "checking") acc.checking += 1;
      else if (state === "restriction-only") acc.restrictionOnly += 1;
      else if (state === "password-required") acc.passwordRequired += 1;
      else if (state === "unprotected") acc.unprotected += 1;
      return acc;
    },
    { checking: 0, restrictionOnly: 0, passwordRequired: 0, unprotected: 0 },
  );
}

// ---------------------------------------------------------------------------
// Selection panel meta text
// ---------------------------------------------------------------------------

/**
 * Returns the descriptive text shown under the "Selected PDFs" heading in the
 * left panel. Pure: depends only on counts and mode.
 */
export function getSelectionPanelMeta(
  mode: SecurityMode,
  totalCount: number,
  selectedCount: number,
  downloadMode: DownloadMode,
  counts: UnlockCounts,
): string {
  if (totalCount === 0) {
    return "Upload one or more PDFs to begin.";
  }

  if (selectedCount === 0) {
    return `Select at least one PDF from the ${getFileLabel(totalCount)} loaded in this batch.`;
  }

  if (mode === "protect") {
    const baseMessage =
      selectedCount === 1
        ? "This PDF will be exported as a separately protected copy."
        : downloadMode === "individual"
          ? "Each PDF will be protected individually and downloaded as a separate file."
          : "Each PDF will be protected individually and packaged together when the batch completes.";

    return selectedCount === totalCount
      ? baseMessage
      : `${selectedCount} of ${totalCount} selected. ${baseMessage}`;
  }

  if (counts.checking > 0) {
    return `Inspecting ${getFileLabel(selectedCount)} for passwords and owner restrictions.`;
  }

  const parts: string[] = [];

  if (counts.passwordRequired > 0) {
    parts.push(
      `${getFileLabel(counts.passwordRequired)} ${counts.passwordRequired === 1 ? "needs" : "need"} the shared password`,
    );
  }

  if (counts.restrictionOnly > 0) {
    parts.push(
      `${getFileLabel(counts.restrictionOnly)} ${counts.restrictionOnly === 1 ? "is" : "are"} restriction-only`,
    );
  }

  if (counts.unprotected > 0) {
    parts.push(
      `${getFileLabel(counts.unprotected)} ${counts.unprotected === 1 ? "already opens" : "already open"}`,
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
      ? downloadMode === "individual"
        ? " • Separate downloads"
        : " • One ZIP archive"
      : "";

  return selectedCount === totalCount
    ? `${summary}${delivery}`
    : `${selectedCount} of ${totalCount} selected • ${summary}${delivery}`;
}

// ---------------------------------------------------------------------------
// Validation / action state
// ---------------------------------------------------------------------------

/**
 * Returns a validation message for protect mode.
 * Message starts with "Ready" when the action can proceed.
 */
export function getProtectValidationMessage(input: ProtectValidationInput): string {
  const {
    openPassword,
    confirmPassword,
    ownerPassword,
    fileCount,
    selectedCount,
    permissionsAllowedCount,
  } = input;

  if (selectedCount === 0) {
    return fileCount === 0
      ? "Upload one or more PDFs to continue."
      : "Select at least one PDF to continue.";
  }

  if (!openPassword) return "Enter a password to protect the selected PDFs.";
  if (openPassword.length < 4) return "Use at least 4 characters for the open password.";
  if (!confirmPassword) return "Confirm the password to continue.";
  if (openPassword !== confirmPassword) return "Passwords must match.";
  if (ownerPassword && ownerPassword === openPassword) {
    return "Owner password must be different or left blank.";
  }

  return permissionsAllowedCount > 0
    ? `Ready to protect ${getFileLabel(fileCount)} with ${permissionsAllowedCount} viewer permission${permissionsAllowedCount === 1 ? "" : "s"} enabled.`
    : `Ready to protect ${getFileLabel(fileCount)} with all editing permissions disabled.`;
}

/**
 * Returns a validation message for unprotect mode.
 * Message starts with "Ready" when the action can proceed.
 */
export function getUnprotectValidationMessage(input: UnprotectValidationInput): string {
  const {
    fileCount,
    totalFileCount,
    selectedCount,
    currentPassword,
    counts,
    firstFileName,
    firstFileState,
  } = input;

  if (selectedCount === 0) {
    return totalFileCount === 0
      ? "Upload one or more PDFs to continue."
      : "Select at least one PDF to continue.";
  }

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

  if (counts.passwordRequired > 0 && !currentPassword) {
    const passwordLabel =
      counts.passwordRequired === fileCount
        ? getFileLabel(fileCount)
        : getFileLabel(counts.passwordRequired);
    const extraDetails: string[] = [];

    if (counts.restrictionOnly > 0) {
      extraDetails.push(
        `${getFileLabel(counts.restrictionOnly)} will only have owner restrictions removed.`,
      );
    }
    if (counts.unprotected > 0) {
      extraDetails.push(
        `${getFileLabel(counts.unprotected)} ${counts.unprotected === 1 ? "will be" : "will be"} skipped because ${counts.unprotected === 1 ? "it is" : "they are"} already unprotected.`,
      );
    }

    return `Enter the current password to unlock ${passwordLabel}.${extraDetails.length > 0 ? ` ${extraDetails.join(" ")}` : ""}`;
  }

  if (fileCount === 1 && firstFileName && firstFileState) {
    if (firstFileState === "restriction-only") {
      return `Ready to remove owner restrictions from ${firstFileName}. No password required.`;
    }
    return `Ready to remove the known password from ${firstFileName}.`;
  }

  const readyParts: string[] = [];
  if (counts.passwordRequired > 0) {
    readyParts.push(
      `${getFileLabel(counts.passwordRequired)} will have the known password removed.`,
    );
  }
  if (counts.restrictionOnly > 0) {
    readyParts.push(
      `${getFileLabel(counts.restrictionOnly)} will have owner restrictions removed.`,
    );
  }
  if (counts.unprotected > 0) {
    readyParts.push(
      `${getFileLabel(counts.unprotected)} will be skipped because ${counts.unprotected === 1 ? "it is" : "they are"} already unprotected.`,
    );
  }

  return `Ready to process ${getFileLabel(fileCount)}. ${readyParts.join(" ")}`;
}

/**
 * Returns whether the action button should be enabled.
 */
export function isActionReady(validationMessage: string, hasActiveFiles: boolean): boolean {
  return hasActiveFiles && validationMessage.startsWith("Ready");
}

/**
 * Returns whether the protect-mode password mismatch warning should be shown.
 */
export function shouldShowPasswordMismatch(
  mode: SecurityMode,
  openPassword: string,
  confirmPassword: string,
): boolean {
  return mode === "protect" && !!confirmPassword && openPassword !== confirmPassword;
}

// ---------------------------------------------------------------------------
// Unlock UI help text (shown inside the "Unlock" controls panel)
// ---------------------------------------------------------------------------

export function getUnlockHelpText(
  mode: SecurityMode,
  fileCount: number,
  counts: UnlockCounts,
): string {
  if (mode !== "unprotect") {
    return "Unlock removes a known password. If a PDF already opens without one, Kyte can also export an unrestricted copy without asking for a password.";
  }

  if (fileCount === 0) {
    return "Select one or more PDFs in the left pane to choose the files Kyte should unlock.";
  }

  const needsKnownPassword = counts.passwordRequired > 0;
  const hasRestrictionOnly = counts.restrictionOnly > 0;

  if (counts.checking > 0) {
    return fileCount > 1
      ? "Kyte is checking each selected PDF to see whether it needs the current password or only has owner restrictions."
      : "Kyte is checking whether this PDF only has owner restrictions or requires its current password.";
  }

  if (needsKnownPassword && hasRestrictionOnly) {
    return "Kyte will use the current password for files that need it, and it will also export unrestricted copies for files that already open without one.";
  }

  if (needsKnownPassword) {
    return fileCount > 1
      ? "Use one current password to unlock all selected PDFs that share it."
      : "Unlock removes a known password from the selected PDF.";
  }

  if (hasRestrictionOnly) {
    return fileCount > 1
      ? "These PDFs already open without a password but still have owner restrictions. Kyte can export unrestricted copies with no password entry."
      : "This PDF already opens without a password but still has owner restrictions. Kyte can export an unrestricted copy with no password entry.";
  }

  return fileCount > 1
    ? "Kyte will skip PDFs that already open normally and only process the files that still carry passwords or owner restrictions."
    : "This PDF does not currently need a password or owner-restriction removal.";
}

// ---------------------------------------------------------------------------
// Unlock action button label
// ---------------------------------------------------------------------------

export function getUnlockActionLabel(fileCount: number, counts: UnlockCounts): string {
  if (fileCount === 0) return "Unlock PDF";
  const needsKnownPassword = counts.passwordRequired > 0;
  if (needsKnownPassword) {
    return fileCount > 1 ? "Unlock PDFs" : "Remove Known Password";
  }
  return "Remove Restrictions";
}

// ---------------------------------------------------------------------------
// Batch success summary builders
// ---------------------------------------------------------------------------

/**
 * Builds the detail string shown in the success panel after a batch operation.
 * Pure: no DOM, no side effects.
 */
export function buildBatchSuccessDetails(
  mode: SecurityMode,
  downloadMode: DownloadMode,
  results: BatchSuccessResult[],
  skipped: string[],
  failures: BatchFailureResult[],
): string {
  const passwordRemovedCount = results.filter((r) => r.resultType === "password-removed").length;
  const restrictionsRemovedCount = results.filter(
    (r) => r.resultType === "restrictions-removed",
  ).length;
  const protectedCount = results.filter((r) => r.resultType === "protected").length;
  const parts: string[] = [];

  const deliveryText =
    downloadMode === "individual"
      ? `${getFileLabel(results.length)} ${results.length === 1 ? "was" : "were"} downloaded individually.`
      : `${getFileLabel(results.length)} ${results.length === 1 ? "is" : "are"} ready in one ZIP archive.`;

  if (mode === "protect") {
    parts.push(
      downloadMode === "individual"
        ? `${getFileLabel(protectedCount)} ${protectedCount === 1 ? "was" : "were"} downloaded individually.`
        : `${getFileLabel(protectedCount)} ${protectedCount === 1 ? "is" : "are"} ready in one ZIP archive.`,
    );
  } else {
    parts.push(deliveryText);
    if (passwordRemovedCount > 0) {
      parts.push(`${getFileLabel(passwordRemovedCount)} had the known password removed.`);
    }
    if (restrictionsRemovedCount > 0) {
      parts.push(`${getFileLabel(restrictionsRemovedCount)} had owner restrictions removed.`);
    }
  }

  if (skipped.length > 0) {
    parts.push(
      `${getFileLabel(skipped.length)} ${skipped.length === 1 ? "was" : "were"} skipped because ${skipped.length === 1 ? "it is" : "they are"} already unprotected.`,
    );
  }

  if (failures.length > 0) {
    parts.push(
      `${getFileLabel(failures.length, "file", "files")} failed and ${failures.length === 1 ? "was" : "were"} left out of the archive.`,
    );
  }

  return parts.join(" ");
}

/**
 * Returns the ZIP archive filename for a batch operation.
 */
export function buildBatchArchiveName(mode: SecurityMode, results: BatchSuccessResult[]): string {
  if (mode === "protect") return "protected_pdfs.zip";
  return results.every((r) => r.resultType === "restrictions-removed")
    ? "unrestricted_pdfs.zip"
    : "unlocked_pdfs.zip";
}

/**
 * Returns the full completion message shown in the dialog after a batch.
 */
export function buildBatchCompletionMessage(
  mode: SecurityMode,
  downloadMode: DownloadMode,
  results: BatchSuccessResult[],
  skipped: string[],
  failures: BatchFailureResult[],
): string {
  const summary = buildBatchSuccessDetails(mode, downloadMode, results, skipped, failures);
  if (failures.length === 0) return summary;

  const failurePreview = failures
    .slice(0, 3)
    .map((f) => `${f.fileName}: ${f.message}`)
    .join("\n");

  return `${summary}\n\n${failurePreview}${failures.length > 3 ? `\n+ ${failures.length - 3} more` : ""}`;
}

/**
 * Returns whether all failures share the same error message.
 * Used to surface a single, unified error dialog instead of a list.
 */
export function areAllFailuresSameMessage(
  failures: BatchFailureResult[],
  message: string,
): boolean {
  return failures.length > 0 && failures.every((f) => f.message === message);
}

// ---------------------------------------------------------------------------
// Single-file success state helpers
// ---------------------------------------------------------------------------

export function getSingleSuccessTitle(mode: SecurityMode, state: UnlockInspectionState): string {
  if (mode === "protect") return "PDF Protected!";
  if (state === "restriction-only") return "Restrictions Removed!";
  return "Password Removed!";
}

export function getSingleSuccessDetail(mode: SecurityMode, state: UnlockInspectionState): string {
  if (mode === "protect") return "The exported copy now requires the password you set.";
  if (state === "restriction-only") {
    return "The exported copy opens normally and no longer carries owner restrictions.";
  }
  return "The exported copy opens without asking for a password.";
}

// ---------------------------------------------------------------------------
// File selection state helpers
// ---------------------------------------------------------------------------

/**
 * Initializes a selection array for a list of files.
 * When appending, existing selections are preserved.
 */
export function initFileSelections(
  existingSelections: boolean[],
  newCount: number,
  append: boolean,
): boolean[] {
  const newSelections = Array.from<boolean>({ length: newCount }).fill(true);
  return append ? [...existingSelections, ...newSelections] : newSelections;
}

/**
 * Initializes unlock states when files are loaded.
 * In protect mode, all files are "unprotected" (no inspection needed).
 * In unprotect mode, all files start as "checking".
 */
export function initUnlockStates(count: number, mode: SecurityMode): UnlockInspectionState[] {
  return Array.from<UnlockInspectionState>({ length: count }).fill(
    mode === "unprotect" ? "checking" : "unprotected",
  );
}

/**
 * Toggles one file's selection state immutably.
 */
export function toggleFileSelection(selections: boolean[], index: number): boolean[] {
  if (index < 0 || index >= selections.length) return selections;
  const next = [...selections];
  next[index] = !next[index];
  return next;
}

/**
 * Sets all file selections to the given value.
 */
export function setAllFileSelections(count: number, selected: boolean): boolean[] {
  return Array.from<boolean>({ length: count }).fill(selected);
}

/**
 * Removes a file at the given index from all parallel arrays.
 */
export function removeFileAtIndex<T>(items: T[], index: number): T[] {
  return items.filter((_, i) => i !== index);
}
