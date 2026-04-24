import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  areAllFailuresSameMessage,
  type BatchFailureResult,
  type BatchSuccessResult,
  buildBatchArchiveName,
  buildBatchCompletionMessage,
  buildBatchSuccessDetails,
  countUnlockStates,
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
  removeFileAtIndex,
  setAllFileSelections,
  shouldShowPasswordMismatch,
  toggleFileSelection,
  type UnlockCounts,
} from "../../utils/pdfSecurityWorkflow.ts";

// ---------------------------------------------------------------------------
// getFileLabel
// ---------------------------------------------------------------------------

describe("getFileLabel", () => {
  it("singular for count 1", () => {
    expect(getFileLabel(1)).toBe("1 PDF");
  });

  it("plural for count > 1", () => {
    expect(getFileLabel(3)).toBe("3 PDFs");
  });

  it("accepts custom singular and plural", () => {
    expect(getFileLabel(1, "file", "files")).toBe("1 file");
    expect(getFileLabel(5, "file", "files")).toBe("5 files");
  });
});

// ---------------------------------------------------------------------------
// getToolKey / getOppositeToolKey
// ---------------------------------------------------------------------------

describe("getToolKey", () => {
  it("returns pdf-protect for protect mode", () => {
    expect(getToolKey("protect")).toBe("pdf-protect");
  });

  it("returns pdf-unprotect for unprotect mode", () => {
    expect(getToolKey("unprotect")).toBe("pdf-unprotect");
  });
});

describe("getOppositeToolKey", () => {
  it("returns unprotect key when in protect mode", () => {
    expect(getOppositeToolKey("protect")).toBe("pdf-unprotect");
  });

  it("returns protect key when in unprotect mode", () => {
    expect(getOppositeToolKey("unprotect")).toBe("pdf-protect");
  });
});

// ---------------------------------------------------------------------------
// countUnlockStates
// ---------------------------------------------------------------------------

describe("countUnlockStates", () => {
  it("counts each state correctly", () => {
    const states = [
      "checking",
      "restriction-only",
      "password-required",
      "unprotected",
      "checking",
    ] as const;
    const counts = countUnlockStates([...states]);
    expect(counts.checking).toBe(2);
    expect(counts.restrictionOnly).toBe(1);
    expect(counts.passwordRequired).toBe(1);
    expect(counts.unprotected).toBe(1);
  });

  it("returns all zeros for empty array", () => {
    const counts = countUnlockStates([]);
    expect(counts).toEqual({
      checking: 0,
      restrictionOnly: 0,
      passwordRequired: 0,
      unprotected: 0,
    });
  });

  it("property: sum of counts equals input length", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom("checking", "restriction-only", "password-required", "unprotected"),
          { minLength: 0, maxLength: 20 },
        ),
        (states) => {
          const counts = countUnlockStates(states as any);
          const total =
            counts.checking + counts.restrictionOnly + counts.passwordRequired + counts.unprotected;
          expect(total).toBe(states.length);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// getSelectionPanelMeta
// ---------------------------------------------------------------------------

describe("getSelectionPanelMeta", () => {
  const zeroCounts: UnlockCounts = {
    checking: 0,
    restrictionOnly: 0,
    passwordRequired: 0,
    unprotected: 0,
  };

  it("returns upload prompt when totalCount is 0", () => {
    const text = getSelectionPanelMeta("protect", 0, 0, "zip", zeroCounts);
    expect(text).toContain("Upload");
  });

  it("returns select-at-least-one when selected is 0 but total > 0", () => {
    const text = getSelectionPanelMeta("protect", 3, 0, "zip", zeroCounts);
    expect(text).toContain("Select at least one");
  });

  it("protect mode — 1 selected returns singular copy message", () => {
    const text = getSelectionPanelMeta("protect", 1, 1, "zip", zeroCounts);
    expect(text).toContain("separately protected copy");
  });

  it("protect mode — multiple, zip download mode", () => {
    const text = getSelectionPanelMeta("protect", 3, 3, "zip", zeroCounts);
    expect(text).toContain("packaged together");
  });

  it("protect mode — multiple, individual download mode", () => {
    const text = getSelectionPanelMeta("protect", 3, 3, "individual", zeroCounts);
    expect(text).toContain("separate file");
  });

  it("unprotect mode — checking in progress", () => {
    const counts: UnlockCounts = { ...zeroCounts, checking: 2 };
    const text = getSelectionPanelMeta("unprotect", 2, 2, "zip", counts);
    expect(text).toContain("Inspecting");
  });

  it("unprotect mode — mixed password-required and restriction-only", () => {
    const counts: UnlockCounts = {
      checking: 0,
      restrictionOnly: 1,
      passwordRequired: 1,
      unprotected: 0,
    };
    const text = getSelectionPanelMeta("unprotect", 2, 2, "zip", counts);
    expect(text).toContain("needs the shared password");
    expect(text).toContain("restriction-only");
  });

  it("unprotect mode — all already open", () => {
    const counts: UnlockCounts = {
      checking: 0,
      restrictionOnly: 0,
      passwordRequired: 0,
      unprotected: 2,
    };
    const text = getSelectionPanelMeta("unprotect", 2, 2, "zip", counts);
    expect(text).toContain("already open");
  });

  it("unprotect mode — partial selection info in prefix", () => {
    const counts: UnlockCounts = {
      checking: 0,
      restrictionOnly: 0,
      passwordRequired: 1,
      unprotected: 0,
    };
    const text = getSelectionPanelMeta("unprotect", 3, 1, "zip", counts);
    expect(text).toContain("1 of 3 selected");
  });
});

// ---------------------------------------------------------------------------
// getProtectValidationMessage
// ---------------------------------------------------------------------------

describe("getProtectValidationMessage", () => {
  const base = {
    openPassword: "",
    confirmPassword: "",
    ownerPassword: "",
    fileCount: 1,
    selectedCount: 1,
    permissionsAllowedCount: 2,
  };

  it("prompts to upload when fileCount 0", () => {
    const msg = getProtectValidationMessage({ ...base, fileCount: 0, selectedCount: 0 });
    expect(msg).toContain("Upload");
  });

  it("prompts to select when selectedCount 0", () => {
    const msg = getProtectValidationMessage({ ...base, selectedCount: 0 });
    expect(msg).toContain("Select at least one");
  });

  it("prompts for password when openPassword empty", () => {
    const msg = getProtectValidationMessage(base);
    expect(msg).toContain("Enter a password");
  });

  it("rejects short password < 4 chars", () => {
    const msg = getProtectValidationMessage({ ...base, openPassword: "abc" });
    expect(msg).toContain("at least 4 characters");
  });

  it("prompts to confirm when confirmPassword empty", () => {
    const msg = getProtectValidationMessage({ ...base, openPassword: "abc123" });
    expect(msg).toContain("Confirm the password");
  });

  it("reports mismatch", () => {
    const msg = getProtectValidationMessage({
      ...base,
      openPassword: "abc123",
      confirmPassword: "different",
    });
    expect(msg).toContain("must match");
  });

  it("rejects same open and owner password", () => {
    const msg = getProtectValidationMessage({
      ...base,
      openPassword: "abc123",
      confirmPassword: "abc123",
      ownerPassword: "abc123",
    });
    expect(msg).toContain("Owner password must be different");
  });

  it("returns Ready with permissions count", () => {
    const msg = getProtectValidationMessage({
      ...base,
      openPassword: "abc123",
      confirmPassword: "abc123",
      permissionsAllowedCount: 2,
    });
    expect(msg).toMatch(/^Ready/);
    expect(msg).toContain("2 viewer permissions");
  });

  it("returns Ready with zero permissions message", () => {
    const msg = getProtectValidationMessage({
      ...base,
      openPassword: "abc123",
      confirmPassword: "abc123",
      permissionsAllowedCount: 0,
    });
    expect(msg).toMatch(/^Ready/);
    expect(msg).toContain("all editing permissions disabled");
  });

  it("Ready uses singular for 1 permission", () => {
    const msg = getProtectValidationMessage({
      ...base,
      openPassword: "abc123",
      confirmPassword: "abc123",
      permissionsAllowedCount: 1,
    });
    expect(msg).toContain("1 viewer permission");
    expect(msg).not.toContain("permissions enabled.");
  });
});

// ---------------------------------------------------------------------------
// getUnprotectValidationMessage
// ---------------------------------------------------------------------------

describe("getUnprotectValidationMessage", () => {
  const baseCounts: UnlockCounts = {
    checking: 0,
    restrictionOnly: 0,
    passwordRequired: 1,
    unprotected: 0,
  };

  it("upload prompt when no files", () => {
    const msg = getUnprotectValidationMessage({
      fileCount: 0,
      totalFileCount: 0,
      selectedCount: 0,
      currentPassword: "",
      counts: baseCounts,
    });
    expect(msg).toContain("Upload");
  });

  it("select prompt when selected 0 but total > 0", () => {
    const msg = getUnprotectValidationMessage({
      fileCount: 0,
      totalFileCount: 2,
      selectedCount: 0,
      currentPassword: "",
      counts: baseCounts,
    });
    expect(msg).toContain("Select at least one");
  });

  it("checking message when counts.checking > 0", () => {
    const counts: UnlockCounts = { ...baseCounts, checking: 1, passwordRequired: 0 };
    const msg = getUnprotectValidationMessage({
      fileCount: 1,
      totalFileCount: 1,
      selectedCount: 1,
      currentPassword: "",
      counts,
    });
    expect(msg).toContain("Checking");
  });

  it("no-protection message when nothing to do", () => {
    const nothingCounts: UnlockCounts = {
      checking: 0,
      restrictionOnly: 0,
      passwordRequired: 0,
      unprotected: 1,
    };
    const msg = getUnprotectValidationMessage({
      fileCount: 1,
      totalFileCount: 1,
      selectedCount: 1,
      currentPassword: "",
      counts: nothingCounts,
    });
    expect(msg).toContain("does not currently have");
  });

  it("prompts for password when passwordRequired > 0 and no password given", () => {
    const msg = getUnprotectValidationMessage({
      fileCount: 1,
      totalFileCount: 1,
      selectedCount: 1,
      currentPassword: "",
      counts: baseCounts,
    });
    expect(msg).toContain("Enter the current password");
  });

  it("Ready for single restriction-only file", () => {
    const counts: UnlockCounts = {
      checking: 0,
      restrictionOnly: 1,
      passwordRequired: 0,
      unprotected: 0,
    };
    const msg = getUnprotectValidationMessage({
      fileCount: 1,
      totalFileCount: 1,
      selectedCount: 1,
      currentPassword: "",
      counts,
      firstFileName: "doc.pdf",
      firstFileState: "restriction-only",
    });
    expect(msg).toMatch(/^Ready/);
    expect(msg).toContain("No password required");
  });

  it("Ready for single password-required file with password given", () => {
    const msg = getUnprotectValidationMessage({
      fileCount: 1,
      totalFileCount: 1,
      selectedCount: 1,
      currentPassword: "secret",
      counts: baseCounts,
      firstFileName: "doc.pdf",
      firstFileState: "password-required",
    });
    expect(msg).toMatch(/^Ready/);
    expect(msg).toContain("known password");
  });

  it("Ready for batch with mixed states", () => {
    const counts: UnlockCounts = {
      checking: 0,
      restrictionOnly: 1,
      passwordRequired: 1,
      unprotected: 0,
    };
    const msg = getUnprotectValidationMessage({
      fileCount: 2,
      totalFileCount: 2,
      selectedCount: 2,
      currentPassword: "pass",
      counts,
    });
    expect(msg).toMatch(/^Ready/);
    expect(msg).toContain("known password removed");
    expect(msg).toContain("restrictions removed");
  });
});

// ---------------------------------------------------------------------------
// isActionReady / shouldShowPasswordMismatch
// ---------------------------------------------------------------------------

describe("isActionReady", () => {
  it("returns true when message starts with Ready and files present", () => {
    expect(isActionReady("Ready to protect 1 PDF.", true)).toBe(true);
  });

  it("returns false when no active files", () => {
    expect(isActionReady("Ready to protect.", false)).toBe(false);
  });

  it("returns false when message does not start with Ready", () => {
    expect(isActionReady("Enter a password.", true)).toBe(false);
  });
});

describe("shouldShowPasswordMismatch", () => {
  it("true in protect mode with filled mismatched passwords", () => {
    expect(shouldShowPasswordMismatch("protect", "abc123", "different")).toBe(true);
  });

  it("false when passwords match", () => {
    expect(shouldShowPasswordMismatch("protect", "abc123", "abc123")).toBe(false);
  });

  it("false in unprotect mode even when passwords differ", () => {
    expect(shouldShowPasswordMismatch("unprotect", "abc123", "different")).toBe(false);
  });

  it("false when confirmPassword is empty", () => {
    expect(shouldShowPasswordMismatch("protect", "abc123", "")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getUnlockHelpText
// ---------------------------------------------------------------------------

describe("getUnlockHelpText", () => {
  const zero: UnlockCounts = {
    checking: 0,
    restrictionOnly: 0,
    passwordRequired: 0,
    unprotected: 0,
  };

  it("protect mode always returns the standard unlock note", () => {
    const text = getUnlockHelpText("protect", 1, zero);
    expect(text).toContain("Kyte can also export an unrestricted copy");
  });

  it("unprotect no files — prompts to select", () => {
    const text = getUnlockHelpText("unprotect", 0, zero);
    expect(text).toContain("left pane");
  });

  it("still checking", () => {
    const counts: UnlockCounts = { ...zero, checking: 2 };
    const text = getUnlockHelpText("unprotect", 2, counts);
    expect(text).toContain("checking");
  });

  it("needs password + has restriction-only — mixed message", () => {
    const counts: UnlockCounts = {
      checking: 0,
      restrictionOnly: 1,
      passwordRequired: 1,
      unprotected: 0,
    };
    const text = getUnlockHelpText("unprotect", 2, counts);
    expect(text).toContain("current password");
    expect(text).toContain("unrestricted copies");
  });

  it("needs password only", () => {
    const counts: UnlockCounts = {
      checking: 0,
      restrictionOnly: 0,
      passwordRequired: 1,
      unprotected: 0,
    };
    const text = getUnlockHelpText("unprotect", 1, counts);
    expect(text).toContain("known password");
  });

  it("restriction only", () => {
    const counts: UnlockCounts = {
      checking: 0,
      restrictionOnly: 1,
      passwordRequired: 0,
      unprotected: 0,
    };
    const text = getUnlockHelpText("unprotect", 1, counts);
    expect(text).toContain("owner restrictions");
  });

  it("all already unprotected", () => {
    const counts: UnlockCounts = {
      checking: 0,
      restrictionOnly: 0,
      passwordRequired: 0,
      unprotected: 2,
    };
    const text = getUnlockHelpText("unprotect", 2, counts);
    expect(text).toContain("skip PDFs");
  });
});

// ---------------------------------------------------------------------------
// getUnlockActionLabel
// ---------------------------------------------------------------------------

describe("getUnlockActionLabel", () => {
  const zero: UnlockCounts = {
    checking: 0,
    restrictionOnly: 0,
    passwordRequired: 0,
    unprotected: 0,
  };

  it("returns 'Unlock PDF' when no files", () => {
    expect(getUnlockActionLabel(0, zero)).toBe("Unlock PDF");
  });

  it("returns 'Unlock PDFs' when multiple need password", () => {
    const counts: UnlockCounts = { ...zero, passwordRequired: 2 };
    expect(getUnlockActionLabel(2, counts)).toBe("Unlock PDFs");
  });

  it("returns 'Remove Known Password' for single file needing password", () => {
    const counts: UnlockCounts = { ...zero, passwordRequired: 1 };
    expect(getUnlockActionLabel(1, counts)).toBe("Remove Known Password");
  });

  it("returns 'Remove Restrictions' when only restriction-only files", () => {
    const counts: UnlockCounts = { ...zero, restrictionOnly: 1 };
    expect(getUnlockActionLabel(1, counts)).toBe("Remove Restrictions");
  });
});

// ---------------------------------------------------------------------------
// buildBatchSuccessDetails
// ---------------------------------------------------------------------------

describe("buildBatchSuccessDetails", () => {
  const makeResult = (type: BatchSuccessResult["resultType"]): BatchSuccessResult => ({
    fileName: "doc.pdf",
    outputName: "doc_out.pdf",
    resultType: type,
  });

  it("protect mode — zip — reports file count", () => {
    const results = [makeResult("protected"), makeResult("protected")];
    const text = buildBatchSuccessDetails("protect", "zip", results, [], []);
    expect(text).toContain("2 PDFs");
    expect(text).toContain("ZIP archive");
  });

  it("protect mode — individual — reports individual downloads", () => {
    const results = [makeResult("protected")];
    const text = buildBatchSuccessDetails("protect", "individual", results, [], []);
    expect(text).toContain("downloaded individually");
  });

  it("unprotect mode — reports password-removed count", () => {
    const results = [makeResult("password-removed"), makeResult("restrictions-removed")];
    const text = buildBatchSuccessDetails("unprotect", "zip", results, [], []);
    expect(text).toContain("had the known password removed");
    expect(text).toContain("had owner restrictions removed");
  });

  it("includes skipped count", () => {
    const results = [makeResult("password-removed")];
    const text = buildBatchSuccessDetails("unprotect", "zip", results, ["skip.pdf"], []);
    expect(text).toContain("skipped");
  });

  it("includes failure count", () => {
    const results = [makeResult("password-removed")];
    const failures: BatchFailureResult[] = [{ fileName: "fail.pdf", message: "Error" }];
    const text = buildBatchSuccessDetails("unprotect", "zip", results, [], failures);
    expect(text).toContain("failed");
  });
});

// ---------------------------------------------------------------------------
// buildBatchArchiveName
// ---------------------------------------------------------------------------

describe("buildBatchArchiveName", () => {
  it("returns protected_pdfs.zip for protect mode", () => {
    expect(buildBatchArchiveName("protect", [])).toBe("protected_pdfs.zip");
  });

  it("returns unrestricted_pdfs.zip when all restriction-only", () => {
    const results: BatchSuccessResult[] = [
      { fileName: "a.pdf", outputName: "a_out.pdf", resultType: "restrictions-removed" },
    ];
    expect(buildBatchArchiveName("unprotect", results)).toBe("unrestricted_pdfs.zip");
  });

  it("returns unlocked_pdfs.zip for mixed results", () => {
    const results: BatchSuccessResult[] = [
      { fileName: "a.pdf", outputName: "a_out.pdf", resultType: "restrictions-removed" },
      { fileName: "b.pdf", outputName: "b_out.pdf", resultType: "password-removed" },
    ];
    expect(buildBatchArchiveName("unprotect", results)).toBe("unlocked_pdfs.zip");
  });
});

// ---------------------------------------------------------------------------
// buildBatchCompletionMessage
// ---------------------------------------------------------------------------

describe("buildBatchCompletionMessage", () => {
  it("no failures — just the summary", () => {
    const results: BatchSuccessResult[] = [
      { fileName: "a.pdf", outputName: "a_out.pdf", resultType: "protected" },
    ];
    const msg = buildBatchCompletionMessage("protect", "zip", results, [], []);
    expect(msg).not.toContain("\n\n");
  });

  it("with failures — appends failure preview", () => {
    const results: BatchSuccessResult[] = [
      { fileName: "a.pdf", outputName: "a_out.pdf", resultType: "protected" },
    ];
    const failures: BatchFailureResult[] = [{ fileName: "fail.pdf", message: "Wrong password" }];
    const msg = buildBatchCompletionMessage("protect", "zip", results, [], failures);
    expect(msg).toContain("\n\n");
    expect(msg).toContain("fail.pdf: Wrong password");
  });

  it("truncates after 3 failures with '+ N more'", () => {
    const results: BatchSuccessResult[] = [
      { fileName: "a.pdf", outputName: "a_out.pdf", resultType: "protected" },
    ];
    const failures: BatchFailureResult[] = Array.from({ length: 5 }, (_, i) => ({
      fileName: `f${i}.pdf`,
      message: "Error",
    }));
    const msg = buildBatchCompletionMessage("protect", "zip", results, [], failures);
    expect(msg).toContain("+ 2 more");
  });
});

// ---------------------------------------------------------------------------
// areAllFailuresSameMessage
// ---------------------------------------------------------------------------

describe("areAllFailuresSameMessage", () => {
  it("returns true when all failures share the message", () => {
    const failures: BatchFailureResult[] = [
      { fileName: "a.pdf", message: "Incorrect password" },
      { fileName: "b.pdf", message: "Incorrect password" },
    ];
    expect(areAllFailuresSameMessage(failures, "Incorrect password")).toBe(true);
  });

  it("returns false when failures have mixed messages", () => {
    const failures: BatchFailureResult[] = [
      { fileName: "a.pdf", message: "Incorrect password" },
      { fileName: "b.pdf", message: "Different error" },
    ];
    expect(areAllFailuresSameMessage(failures, "Incorrect password")).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(areAllFailuresSameMessage([], "Incorrect password")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getSingleSuccessTitle / getSingleSuccessDetail
// ---------------------------------------------------------------------------

describe("getSingleSuccessTitle", () => {
  it("protect mode", () => {
    expect(getSingleSuccessTitle("protect", "unprotected")).toBe("PDF Protected!");
  });

  it("restriction-only unprotect", () => {
    expect(getSingleSuccessTitle("unprotect", "restriction-only")).toBe("Restrictions Removed!");
  });

  it("password-required unprotect", () => {
    expect(getSingleSuccessTitle("unprotect", "password-required")).toBe("Password Removed!");
  });
});

describe("getSingleSuccessDetail", () => {
  it("protect mode", () => {
    const detail = getSingleSuccessDetail("protect", "unprotected");
    expect(detail).toContain("password you set");
  });

  it("restriction-only unprotect", () => {
    const detail = getSingleSuccessDetail("unprotect", "restriction-only");
    expect(detail).toContain("owner restrictions");
  });

  it("password-required unprotect", () => {
    const detail = getSingleSuccessDetail("unprotect", "password-required");
    expect(detail).toContain("without asking for a password");
  });
});

// ---------------------------------------------------------------------------
// initFileSelections
// ---------------------------------------------------------------------------

describe("initFileSelections", () => {
  it("creates fresh selections on non-append", () => {
    const result = initFileSelections([false, true], 3, false);
    expect(result).toEqual([true, true, true]);
  });

  it("appends to existing selections", () => {
    const result = initFileSelections([false, true], 2, true);
    expect(result).toEqual([false, true, true, true]);
  });
});

// ---------------------------------------------------------------------------
// initUnlockStates
// ---------------------------------------------------------------------------

describe("initUnlockStates", () => {
  it("protect mode — all unprotected", () => {
    const states = initUnlockStates(3, "protect");
    expect(states).toEqual(["unprotected", "unprotected", "unprotected"]);
  });

  it("unprotect mode — all checking", () => {
    const states = initUnlockStates(2, "unprotect");
    expect(states).toEqual(["checking", "checking"]);
  });

  it("empty list", () => {
    expect(initUnlockStates(0, "protect")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// toggleFileSelection
// ---------------------------------------------------------------------------

describe("toggleFileSelection", () => {
  it("flips true to false", () => {
    const result = toggleFileSelection([true, true], 0);
    expect(result[0]).toBe(false);
  });

  it("flips false to true", () => {
    const result = toggleFileSelection([false, false], 1);
    expect(result[1]).toBe(true);
  });

  it("returns unchanged array for out-of-bounds index", () => {
    const selections = [true];
    const result = toggleFileSelection(selections, 5);
    expect(result).toBe(selections);
  });

  it("does not mutate original", () => {
    const original = [true, false];
    toggleFileSelection(original, 0);
    expect(original[0]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setAllFileSelections
// ---------------------------------------------------------------------------

describe("setAllFileSelections", () => {
  it("sets all to true", () => {
    expect(setAllFileSelections(3, true)).toEqual([true, true, true]);
  });

  it("sets all to false", () => {
    expect(setAllFileSelections(3, false)).toEqual([false, false, false]);
  });

  it("empty", () => {
    expect(setAllFileSelections(0, true)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// removeFileAtIndex
// ---------------------------------------------------------------------------

describe("removeFileAtIndex", () => {
  it("removes the item at the given index", () => {
    expect(removeFileAtIndex(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });

  it("removes the first item", () => {
    expect(removeFileAtIndex(["a", "b"], 0)).toEqual(["b"]);
  });

  it("removes the last item", () => {
    expect(removeFileAtIndex(["a", "b"], 1)).toEqual(["a"]);
  });

  it("does not mutate the original", () => {
    const arr = ["x", "y"];
    removeFileAtIndex(arr, 0);
    expect(arr).toEqual(["x", "y"]);
  });

  it("property: length decreases by 1", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { minLength: 1, maxLength: 10 }), (arr) => {
        const idx = Math.floor(arr.length / 2);
        const result = removeFileAtIndex(arr, idx);
        expect(result.length).toBe(arr.length - 1);
      }),
    );
  });
});
