import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdfSecurity } from "../../components/PdfSecurity";
import { getPdfSecurityState, protectPdf, unprotectPdf } from "../../utils/pdfSecurity";
import { persistence } from "../../utils/persistence";

const zipMock = vi.hoisted(() => ({
  file: vi.fn(),
  generateAsync: vi.fn().mockResolvedValue(new Uint8Array([9, 9, 9])),
  JSZipMock: function JSZipMock(this: {
    file: typeof zipMock.file;
    generateAsync: typeof zipMock.generateAsync;
  }) {
    this.file = zipMock.file;
    this.generateAsync = zipMock.generateAsync;
  },
}));

vi.mock("jszip", () => ({
  default: zipMock.JSZipMock,
}));

vi.mock("../../utils/persistence", () => ({
  persistence: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    getJobs: vi.fn().mockResolvedValue([]),
    estimateUsage: vi.fn().mockResolvedValue(0),
    getStorageUsage: vi.fn().mockResolvedValue({ usage: 0, quota: 1000 }),
    addJob: vi.fn().mockResolvedValue(1),
  },
}));

vi.mock("../../utils/pdfSecurity", () => ({
  ALREADY_PROTECTED_ERROR:
    "This PDF is already password-protected. Remove the current password before adding a new one.",
  INCORRECT_PASSWORD_ERROR:
    "The current password is incorrect. Enter the password that opens this PDF and try again.",
  KNOWN_PASSWORD_REQUIRED_ERROR:
    "This PDF requires its current password before Kyte can unlock it.",
  NOT_PROTECTED_ERROR: "This PDF is not password-protected.",
  getPdfSecurityState: vi.fn().mockResolvedValue("password-required"),
  protectPdf: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  unprotectPdf: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
}));

describe("PdfSecurity", () => {
  let component: PdfSecurity;
  let createObjectURLMock: ReturnType<typeof vi.fn>;
  let revokeObjectURLMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
    (getPdfSecurityState as any).mockResolvedValue("password-required");
    createObjectURLMock = vi.fn(() => "blob:test");
    revokeObjectURLMock = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectURLMock,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectURLMock,
    });

    component = new PdfSecurity();
    document.body.appendChild(component);
  });

  const asFileList = (...files: File[]) =>
    ({
      ...files,
      length: files.length,
      item: (index: number) => files[index] ?? null,
    }) as unknown as FileList;

  const setProtectPasswords = (open = "secret123", confirm = open, owner = "") => {
    const openPassword = component.querySelector("#openPassword") as HTMLInputElement;
    const confirmPassword = component.querySelector("#confirmPassword") as HTMLInputElement;
    const ownerPassword = component.querySelector("#ownerPassword") as HTMLInputElement;
    openPassword.value = open;
    confirmPassword.value = confirm;
    ownerPassword.value = owner;
    openPassword.dispatchEvent(new Event("input"));
    confirmPassword.dispatchEvent(new Event("input"));
    ownerPassword.dispatchEvent(new Event("input"));
  };

  it("renders in protect mode by default", () => {
    expect(component.querySelector("#securityTitle")?.textContent).toBe("Protect PDF");
    expect(component.querySelector("#protectControls")?.classList.contains("hidden")).toBe(false);
  });

  it("switches into unlock mode", () => {
    const unlockRadio = component.querySelector(
      'input[name="securityMode"][value="unprotect"]',
    ) as HTMLInputElement;

    unlockRadio.checked = true;
    unlockRadio.dispatchEvent(new Event("change"));

    expect(component.querySelector("#securityTitle")?.textContent).toBe("Unlock PDF");
    expect(component.querySelector("#unprotectControls")?.classList.contains("hidden")).toBe(false);
  });

  it("enables protect action when passwords match", async () => {
    const file = new File(["test"], "secure.pdf", { type: "application/pdf" });
    await component.handleFiles([file] as unknown as FileList);

    const openPassword = component.querySelector("#openPassword") as HTMLInputElement;
    const confirmPassword = component.querySelector("#confirmPassword") as HTMLInputElement;
    const actionBtn = component.querySelector("#securityActionBtn") as HTMLButtonElement;

    openPassword.value = "secret123";
    confirmPassword.value = "secret123";
    openPassword.dispatchEvent(new Event("input"));
    confirmPassword.dispatchEvent(new Event("input"));

    expect(actionBtn.disabled).toBe(false);
  });

  it("protects a PDF and records the job", async () => {
    const file = new File(["test"], "secure.pdf", { type: "application/pdf" });
    await component.handleFiles([file] as unknown as FileList);

    const openPassword = component.querySelector("#openPassword") as HTMLInputElement;
    const confirmPassword = component.querySelector("#confirmPassword") as HTMLInputElement;
    openPassword.value = "secret123";
    confirmPassword.value = "secret123";
    openPassword.dispatchEvent(new Event("input"));
    confirmPassword.dispatchEvent(new Event("input"));

    await (component as any).runSecurityAction();

    expect(protectPdf).toHaveBeenCalled();
    expect(persistence.addJob).toHaveBeenCalled();
    expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(false);
  });

  it("unprotects a PDF in unlock mode", async () => {
    const unlockRadio = component.querySelector(
      'input[name="securityMode"][value="unprotect"]',
    ) as HTMLInputElement;
    unlockRadio.checked = true;
    unlockRadio.dispatchEvent(new Event("change"));

    const file = new File(["test"], "locked.pdf", { type: "application/pdf" });
    await component.handleFiles([file] as unknown as FileList);

    const password = component.querySelector("#currentPassword") as HTMLInputElement;
    password.value = "secret123";
    password.dispatchEvent(new Event("input"));

    await (component as any).runSecurityAction();

    expect(unprotectPdf).toHaveBeenCalledWith(file, "secret123");
    expect(persistence.addJob).toHaveBeenCalled();
  });

  it("surfaces restriction-only messaging and allows removing restrictions without a password", async () => {
    (getPdfSecurityState as any).mockResolvedValueOnce("restriction-only");

    const unlockRadio = component.querySelector(
      'input[name="securityMode"][value="unprotect"]',
    ) as HTMLInputElement;
    unlockRadio.checked = true;
    unlockRadio.dispatchEvent(new Event("change"));

    const file = new File(["test"], "restricted.pdf", { type: "application/pdf" });
    await component.handleFiles([file] as unknown as FileList);

    expect(component.querySelector("#currentPasswordGroup")?.classList.contains("hidden")).toBe(
      true,
    );
    expect(component.querySelector("#actionSummary")?.textContent).toContain(
      "No password required",
    );

    await (component as any).runSecurityAction();

    expect(unprotectPdf).toHaveBeenCalledWith(file, "");
    expect(persistence.addJob).toHaveBeenCalled();
  });

  it("batches multiple unlocks into one zip archive", async () => {
    const unlockRadio = component.querySelector(
      'input[name="securityMode"][value="unprotect"]',
    ) as HTMLInputElement;
    unlockRadio.checked = true;
    unlockRadio.dispatchEvent(new Event("change"));

    const fileA = new File(["a"], "locked-a.pdf", { type: "application/pdf" });
    const fileB = new File(["b"], "locked-b.pdf", { type: "application/pdf" });
    await component.handleFiles([fileA, fileB] as unknown as FileList);

    const password = component.querySelector("#currentPassword") as HTMLInputElement;
    password.value = "secret123";
    password.dispatchEvent(new Event("input"));

    await (component as any).runSecurityAction();

    expect(unprotectPdf).toHaveBeenNthCalledWith(1, fileA, "secret123");
    expect(unprotectPdf).toHaveBeenNthCalledWith(2, fileB, "secret123");
    expect(zipMock.file).toHaveBeenCalledWith(
      "locked-a_unprotected.pdf",
      new Uint8Array([4, 5, 6]),
    );
    expect(zipMock.file).toHaveBeenCalledWith(
      "locked-b_unprotected.pdf",
      new Uint8Array([4, 5, 6]),
    );
    expect(zipMock.generateAsync).toHaveBeenCalledWith({ type: "uint8array" });
    expect(component.querySelector("#downloadLink")?.textContent).toBe("Download ZIP Archive");
    expect(persistence.addJob).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "Unprotect Batch",
        fileName: "unlocked_pdfs.zip",
        data: new Uint8Array([9, 9, 9]),
      }),
    );
  });

  it("shows batch download options only when more than one file is actively selected", async () => {
    const fileA = new File(["a"], "locked-a.pdf", { type: "application/pdf" });
    const fileB = new File(["b"], "locked-b.pdf", { type: "application/pdf" });
    await component.handleFiles([fileA, fileB] as unknown as FileList);

    expect(component.querySelector("#downloadModeGroup")?.classList.contains("hidden")).toBe(false);

    const checkboxes = component.querySelectorAll(
      ".security-file-checkbox",
    ) as NodeListOf<HTMLInputElement>;
    checkboxes[1].checked = false;
    checkboxes[1].dispatchEvent(new Event("change"));

    expect(component.querySelector("#downloadModeGroup")?.classList.contains("hidden")).toBe(true);
  });

  it("downloads batch results as individual files when that mode is selected", async () => {
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    const fileA = new File(["a"], "locked-a.pdf", { type: "application/pdf" });
    const fileB = new File(["b"], "locked-b.pdf", { type: "application/pdf" });
    await component.handleFiles([fileA, fileB] as unknown as FileList);

    const individualMode = component.querySelector(
      'input[name="securityDownloadMode"][value="individual"]',
    ) as HTMLInputElement;
    individualMode.checked = true;
    individualMode.dispatchEvent(new Event("change"));

    const openPassword = component.querySelector("#openPassword") as HTMLInputElement;
    const confirmPassword = component.querySelector("#confirmPassword") as HTMLInputElement;
    openPassword.value = "secret123";
    confirmPassword.value = "secret123";
    openPassword.dispatchEvent(new Event("input"));
    confirmPassword.dispatchEvent(new Event("input"));

    await (component as any).runSecurityAction();

    expect(protectPdf).toHaveBeenNthCalledWith(
      1,
      fileA,
      expect.objectContaining({ userPassword: "secret123" }),
    );
    expect(protectPdf).toHaveBeenNthCalledWith(
      2,
      fileB,
      expect.objectContaining({ userPassword: "secret123" }),
    );
    expect(zipMock.generateAsync).not.toHaveBeenCalled();
    expect(createObjectURLMock).toHaveBeenCalledTimes(2);
    expect(anchorClick).toHaveBeenCalledTimes(2);
    expect(persistence.addJob).not.toHaveBeenCalled();

    anchorClick.mockRestore();
  });

  it("uses the left pane selection state as the active batch", async () => {
    const fileA = new File(["a"], "locked-a.pdf", { type: "application/pdf" });
    const fileB = new File(["b"], "locked-b.pdf", { type: "application/pdf" });
    await component.handleFiles([fileA, fileB] as unknown as FileList);

    expect(component.querySelector("#fileInfo")?.classList.contains("hidden")).toBe(false);
    expect(component.querySelector("#mainLayout")?.classList.contains("hidden")).toBe(false);

    const checkboxes = component.querySelectorAll(
      ".security-file-checkbox",
    ) as NodeListOf<HTMLInputElement>;
    expect(checkboxes).toHaveLength(2);

    checkboxes[1].checked = false;
    checkboxes[1].dispatchEvent(new Event("change"));

    expect(component.querySelector("#fileName")?.textContent).toBe("1 of 2 PDFs selected");

    const openPassword = component.querySelector("#openPassword") as HTMLInputElement;
    const confirmPassword = component.querySelector("#confirmPassword") as HTMLInputElement;
    openPassword.value = "secret123";
    confirmPassword.value = "secret123";
    openPassword.dispatchEvent(new Event("input"));
    confirmPassword.dispatchEvent(new Event("input"));

    await (component as any).runSecurityAction();

    expect(protectPdf).toHaveBeenCalledTimes(1);
    expect(protectPdf).toHaveBeenCalledWith(
      fileA,
      expect.objectContaining({
        userPassword: "secret123",
      }),
    );
  });

  it("uses the shared password only for files that need it in a mixed batch", async () => {
    (getPdfSecurityState as any)
      .mockResolvedValueOnce("restriction-only")
      .mockResolvedValueOnce("password-required");

    const unlockRadio = component.querySelector(
      'input[name="securityMode"][value="unprotect"]',
    ) as HTMLInputElement;
    unlockRadio.checked = true;
    unlockRadio.dispatchEvent(new Event("change"));

    const fileA = new File(["a"], "restricted.pdf", { type: "application/pdf" });
    const fileB = new File(["b"], "locked.pdf", { type: "application/pdf" });
    await component.handleFiles([fileA, fileB] as unknown as FileList);

    const passwordGroup = component.querySelector("#currentPasswordGroup") as HTMLElement;
    expect(passwordGroup.classList.contains("hidden")).toBe(false);

    const password = component.querySelector("#currentPassword") as HTMLInputElement;
    password.value = "secret123";
    password.dispatchEvent(new Event("input"));

    await (component as any).runSecurityAction();

    expect(unprotectPdf).toHaveBeenNthCalledWith(1, fileA, "");
    expect(unprotectPdf).toHaveBeenNthCalledWith(2, fileB, "secret123");
  });

  it("wires file action buttons and reset state", async () => {
    const fileInput = component.querySelector("#fileInput") as HTMLInputElement;
    const fileInputClick = vi.spyOn(fileInput, "click");
    (component.querySelector("#addMoreBtn") as HTMLButtonElement).click();
    expect(fileInputClick).toHaveBeenCalled();

    const fileA = new File(["a"], "a.pdf", { type: "application/pdf" });
    const fileB = new File(["b"], "b.pdf", { type: "application/pdf" });
    await component.handleFiles(asFileList(fileA, fileB));

    (component.querySelector("#clearSelectionBtn") as HTMLButtonElement).click();
    expect(component.querySelector("#actionSummary")?.textContent).toContain("Select at least one");

    (component.querySelector("#selectAllFilesBtn") as HTMLButtonElement).click();
    expect(component.querySelector("#fileName")?.textContent).toBe("2 PDFs selected");

    const removeButtons = component.querySelectorAll(".action-btn.remove");
    (removeButtons[0] as HTMLButtonElement).click();
    expect(component.querySelector("#fileName")?.textContent).toBe("b.pdf");

    setProtectPasswords("secret123", "secret123", "owner123");
    (component.querySelector("#allowPrinting") as HTMLInputElement).checked = false;
    component.resetState();

    expect((component.querySelector("#openPassword") as HTMLInputElement).value).toBe("");
    expect((component.querySelector("#allowPrinting") as HTMLInputElement).checked).toBe(true);
    expect(component.querySelector("#dropZone")?.classList.contains("hidden")).toBe(false);
  });

  it("clears selected files only after confirmation", async () => {
    const file = new File(["a"], "a.pdf", { type: "application/pdf" });
    await component.handleFiles(asFileList(file));

    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValueOnce(false);
    (component.querySelector("#clearFilesBtn") as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(component.querySelector("#fileInfo")?.classList.contains("hidden")).toBe(false);

    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValueOnce(true);
    (component.querySelector("#clearFilesBtn") as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(component.querySelector("#fileInfo")?.classList.contains("hidden")).toBe(true);
    expect(persistence.delete).toHaveBeenCalledWith("pdf-protect");
  });

  it("covers validation summaries for owner password and unprotected unlock batches", async () => {
    const fileA = new File(["a"], "a.pdf", { type: "application/pdf" });
    await component.handleFiles(asFileList(fileA));
    setProtectPasswords("secret123", "secret123", "secret123");
    expect(component.querySelector("#actionSummary")?.textContent).toContain(
      "Owner password must be different",
    );

    (component as any).runSecurityAction();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" }),
    );

    const unlockRadio = component.querySelector(
      'input[name="securityMode"][value="unprotect"]',
    ) as HTMLInputElement;
    unlockRadio.checked = true;
    unlockRadio.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    (component as any).unlockStates = ["unprotected"];
    (component as any).updateUnlockUi();
    (component as any).updateActionState();
    expect(component.querySelector("#actionSummary")?.textContent).toContain(
      "does not currently have a password",
    );

    const fileB = new File(["b"], "b.pdf", { type: "application/pdf" });
    await (component as any).applySelectedFiles([fileA, fileB], false);
    (component as any).unlockStates = ["password-required", "unprotected"];
    (component.querySelector("#currentPassword") as HTMLInputElement).value = "secret123";
    (component as any).updateUnlockUi();
    (component as any).updateActionState();
    expect(component.querySelector("#actionSummary")?.textContent).toContain("will be skipped");
  });

  it("exposes pure state helpers for selection metadata and saved files", async () => {
    expect((component as any).getSelectionPanelMeta(0, 0)).toContain("Upload");
    expect((component as any).getSelectionPanelMeta(3, 0)).toContain("Select at least one");

    const fileA = new File(["a"], "a.pdf", { type: "application/pdf" });
    const fileB = new File(["b"], "b.pdf", { type: "application/pdf" });
    await component.handleFiles(asFileList(fileA, fileB));

    expect((component as any).normalizeSavedFiles(null)).toEqual([]);
    expect((component as any).normalizeSavedFiles(fileA)).toEqual([fileA]);
    expect((component as any).normalizeSavedFiles([fileA, fileB])).toEqual([fileA, fileB]);

    (component as any).unlockStates = ["restriction-only", "unprotected"];
    expect((component as any).getUnlockCounts(false)).toMatchObject({
      restrictionOnly: 1,
      unprotected: 1,
    });
  });

  it("handles saved-session restore states and persistence failures", async () => {
    const saved = new File(["saved"], "saved.pdf", { type: "application/pdf" });

    (persistence.get as any).mockResolvedValue(saved);
    await (component as any).checkExistingSession();
    expect(component.querySelector("#resumeContainer")?.classList.contains("hidden")).toBe(false);
    expect(component.querySelector("#resumeBtn")?.textContent).toContain("saved.pdf");

    await (component as any).restoreSession();
    expect(component.querySelector("#fileName")?.textContent).toBe("saved.pdf");

    (persistence.set as any).mockRejectedValueOnce(new Error("set failed"));
    await expect((component as any).saveSession()).resolves.toBeUndefined();

    (persistence.get as any).mockRejectedValueOnce(new Error("get failed"));
    await expect((component as any).checkExistingSession()).resolves.toBeUndefined();

    (persistence.get as any).mockRejectedValueOnce(new Error("restore failed"));
    await expect((component as any).restoreSession()).resolves.toBeUndefined();

    (persistence.get as any).mockResolvedValue(null);
  });

  it("surfaces unlock inspection failures and stops refreshing when mode changes", async () => {
    const unlockRadio = component.querySelector(
      'input[name="securityMode"][value="unprotect"]',
    ) as HTMLInputElement;
    unlockRadio.checked = true;
    unlockRadio.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    (getPdfSecurityState as any).mockRejectedValueOnce(new Error("inspection failed"));
    const file = new File(["locked"], "locked.pdf", { type: "application/pdf" });
    await component.handleFiles(asFileList(file));
    expect((component as any).unlockStates[0]).toBe("password-required");

    (getPdfSecurityState as any).mockResolvedValueOnce("restriction-only");
    (component as any).mode = "protect";
    await (component as any).refreshUnlockStates();
    expect((component as any).mode).toBe("protect");
  });

  it("reports batch failure variants without successful output", async () => {
    const locked = new File(["locked"], "locked.pdf", { type: "application/pdf" });

    await (component as any).showBatchResults(
      [],
      [],
      [
        {
          file: locked,
          message:
            "The current password is incorrect. Enter the password that opens this PDF and try again.",
        },
      ],
    );
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.stringContaining("incorrect") }),
    );

    await (component as any).showBatchResults(
      [],
      [],
      [
        {
          file: locked,
          message: "This PDF requires its current password before Kyte can unlock it.",
        },
      ],
    );
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.stringContaining("requires") }),
    );

    await (component as any).showBatchResults(
      [],
      [],
      [{ file: locked, message: "This PDF is not password-protected." }],
    );
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "This PDF is not password-protected." }),
    );

    await (component as any).showBatchResults(
      [],
      [],
      [
        { file: locked, message: "First failure" },
        { file: new File(["x"], "x.pdf", { type: "application/pdf" }), message: "Second failure" },
      ],
    );
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Batch failed" }),
    );
  });

  it("reports partial batch results with skipped and failed files", async () => {
    const result = {
      file: new File(["ok"], "ok.pdf", { type: "application/pdf" }),
      outputName: "ok_unprotected.pdf",
      outputBytes: new Uint8Array([1, 2, 3]),
      resultType: "password-removed" as const,
    };
    const skipped = [new File(["skip"], "skip.pdf", { type: "application/pdf" })];
    const failures = [
      { file: new File(["bad"], "bad.pdf", { type: "application/pdf" }), message: "Bad password" },
      { file: new File(["bad2"], "bad2.pdf", { type: "application/pdf" }), message: "Bad owner" },
      { file: new File(["bad3"], "bad3.pdf", { type: "application/pdf" }), message: "Bad third" },
      { file: new File(["bad4"], "bad4.pdf", { type: "application/pdf" }), message: "Bad fourth" },
    ];

    (component as any).downloadMode = "individual";
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:batch"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    await (component as any).showBatchResults([result], skipped, failures);

    expect(anchorClick).toHaveBeenCalled();
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "warning", message: expect.stringContaining("+ 1 more") }),
    );

    anchorClick.mockRestore();
  });

  it("continues batch processing around skipped files and per-file failures", async () => {
    const unlockRadio = component.querySelector(
      'input[name="securityMode"][value="unprotect"]',
    ) as HTMLInputElement;
    unlockRadio.checked = true;
    unlockRadio.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    (getPdfSecurityState as any)
      .mockResolvedValueOnce("unprotected")
      .mockResolvedValueOnce("password-required");
    (unprotectPdf as any).mockRejectedValueOnce(new Error("bad password"));

    const fileA = new File(["a"], "open.pdf", { type: "application/pdf" });
    const fileB = new File(["b"], "locked.pdf", { type: "application/pdf" });
    await component.handleFiles(asFileList(fileA, fileB));
    (component as any).unlockStates = ["unprotected", "password-required"];
    const currentPassword = component.querySelector("#currentPassword") as HTMLInputElement;
    currentPassword.value = "secret123";
    currentPassword.dispatchEvent(new Event("input"));
    (component as any).updateActionState();

    await (component as any).runSecurityAction();

    expect(unprotectPdf).toHaveBeenCalledWith(fileB, "secret123");
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Batch failed" }),
    );
  });

  it("handles top-level security action errors", async () => {
    const file = new File(["a"], "a.pdf", { type: "application/pdf" });
    await component.handleFiles(asFileList(file));
    setProtectPasswords();

    (protectPdf as any).mockRejectedValueOnce(
      new Error(
        "This PDF is already password-protected. Remove the current password before adding a new one.",
      ),
    );
    await (component as any).runSecurityAction();
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.stringContaining("already password-protected") }),
    );

    (protectPdf as any).mockRejectedValueOnce(new Error("unexpected failure"));
    await (component as any).runSecurityAction();
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "error" }),
    );
  });
});
