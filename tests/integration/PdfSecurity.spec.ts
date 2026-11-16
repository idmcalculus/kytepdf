import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdfSecurity } from "../../components/PdfSecurity";
import {
  getPdfSecurityState,
  INVALID_PDF_ERROR,
  protectPdf,
  unprotectPdf,
} from "../../utils/pdfSecurity";
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

vi.mock("../../utils/pdfSecurity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/pdfSecurity")>();
  return {
    ...actual,
    getPdfSecurityState: vi.fn().mockResolvedValue("password-required"),
    protectPdf: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    unprotectPdf: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
  };
});

describe("PdfSecurity", () => {
  let component: PdfSecurity;
  let createObjectURLMock: ReturnType<typeof vi.fn>;
  let revokeObjectURLMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
    // mockReset also drops queued *Once values a previous test left unused.
    (getPdfSecurityState as any).mockReset().mockResolvedValue("password-required");
    (protectPdf as any).mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
    (unprotectPdf as any).mockReset().mockResolvedValue(new Uint8Array([4, 5, 6]));
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
    const fileA = new File(["a"], "a.pdf", { type: "application/pdf" });
    const fileB = new File(["b"], "b.pdf", { type: "application/pdf" });
    await component.handleFiles(asFileList(fileA, fileB));

    expect((component as any).normalizeSavedFiles(null)).toEqual([]);
    expect((component as any).normalizeSavedFiles(fileA)).toEqual([fileA]);
    expect((component as any).normalizeSavedFiles([fileA, fileB])).toEqual([fileA, fileB]);

    (component as any).unlockStates = ["restriction-only", "unprotected"];
    expect((component as any).getUnlockCounts()).toMatchObject({
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

  it("does not execute HTML/JS embedded in a resumed filename (stored XSS regression)", async () => {
    const maliciousName = "<img src=x onerror=window.__resumeXss=1>.pdf";
    const saved = new File(["saved"], maliciousName, { type: "application/pdf" });
    (persistence.get as any).mockResolvedValue(saved);
    (window as any).__resumeXss = undefined;

    await (component as any).checkExistingSession();

    const resumeBtn = component.querySelector("#resumeBtn") as HTMLElement;
    expect(resumeBtn.querySelector("img")).toBeNull();
    expect((window as any).__resumeXss).toBeUndefined();
    // Shown as typed: not run as markup and not escaped twice.
    expect(resumeBtn.textContent?.trim()).toBe(
      `Resume ${maliciousName} (${component.formatBytes(saved.size)})`,
    );

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
    // An inspection that throws means the file could not be read, not that it needs a password.
    expect((component as any).unlockStates[0]).toBe("invalid");

    (getPdfSecurityState as any).mockResolvedValueOnce("restriction-only");
    (component as any).mode = "protect";
    await (component as any).refreshUnlockStates();
    expect((component as any).mode).toBe("protect");
  });

  it("reports batch failure variants without successful output", async () => {
    const locked = new File(["locked"], "locked.pdf", { type: "application/pdf" });

    await (component as any).showBatchResults(
      "unprotect",
      [],
      [],
      [],
      [
        {
          fileName: locked.name,
          message:
            "The current password is incorrect. Enter the password that opens this PDF and try again.",
        },
      ],
    );
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.stringContaining("incorrect") }),
    );

    await (component as any).showBatchResults(
      "unprotect",
      [],
      [],
      [],
      [
        {
          fileName: locked.name,
          message: "This PDF requires its current password before Kyte can unlock it.",
        },
      ],
    );
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.stringContaining("requires") }),
    );

    await (component as any).showBatchResults(
      "unprotect",
      [],
      [],
      [],
      [{ fileName: locked.name, message: "This PDF is not password-protected." }],
    );
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "This PDF is not password-protected." }),
    );

    await (component as any).showBatchResults(
      "unprotect",
      [],
      [],
      [],
      [
        { fileName: locked.name, message: "First failure" },
        { fileName: "x.pdf", message: "Second failure" },
      ],
    );
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenLastCalledWith({
      title: "Batch failed",
      message: "locked.pdf: First failure\nx.pdf: Second failure",
      type: "error",
    });
  });

  it("reports partial batch results with skipped and failed files", async () => {
    const result = {
      fileName: "ok.pdf",
      outputName: "ok_unprotected.pdf",
      outputBytes: new Uint8Array([1, 2, 3]),
      resultType: "password-removed" as const,
    };
    const skipped = ["skip.pdf"];
    const failures = [
      { fileName: "bad.pdf", message: "Bad password" },
      { fileName: "bad2.pdf", message: "Bad owner" },
      { fileName: "bad3.pdf", message: "Bad third" },
      { fileName: "bad4.pdf", message: "Bad fourth" },
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

    await (component as any).showBatchResults("unprotect", [result], skipped, [], failures);

    expect(anchorClick).toHaveBeenCalled();
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "warning",
        message: expect.stringContaining("bad.pdf: Bad password\nbad2.pdf: Bad owner"),
      }),
    );
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.stringContaining("+ 1 more") }),
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

  describe("unlock states, copy and outcomes", () => {
    const pdf = (name: string, body = "x") => new File([body], name, { type: "application/pdf" });
    const text = (selector: string) => component.querySelector(selector)?.textContent?.trim();
    const dialogShow = () => (document.getElementById("globalDialog") as any).show;
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    const switchToUnlock = async () => {
      const radio = component.querySelector(
        'input[name="securityMode"][value="unprotect"]',
      ) as HTMLInputElement;
      radio.checked = true;
      radio.dispatchEvent(new Event("change"));
      await flush();
    };

    /** Loads files in unlock mode, inspecting them as the given states in order. */
    const loadUnlockFiles = async (states: string[], names?: string[]) => {
      await switchToUnlock();
      for (const state of states) {
        (getPdfSecurityState as any).mockResolvedValueOnce(state);
      }
      const files = states.map((_, index) => pdf(names?.[index] ?? `file-${index + 1}.pdf`));
      await component.handleFiles(asFileList(...files));
      return files;
    };

    const enterCurrentPassword = (value: string) => {
      const input = component.querySelector("#currentPassword") as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event("input"));
    };

    it("marks a corrupt PDF as invalid and refuses to unlock it", async () => {
      await loadUnlockFiles(["invalid"], ["broken.pdf"]);

      expect(component.querySelector("#fileList")?.textContent).toContain("Invalid file");
      expect(text("#unlockHelpText")).toBe(
        "This PDF appears to be corrupted or contains non-standard security headers. Try re-exporting it with a standard PDF tool (e.g. your browser's Print to PDF, Adobe Acrobat, or macOS Preview).",
      );
      const summary =
        "This PDF cannot be processed. It may be corrupted or contain non-standard security headers.";
      expect(text("#actionSummary")).toBe(summary);
      expect((component.querySelector("#securityActionBtn") as HTMLButtonElement).disabled).toBe(
        true,
      );
      expect(text("#fileListMeta")).toBe("1 PDF cannot be processed (invalid)");

      await (component as any).runSecurityAction();

      expect(unprotectPdf).not.toHaveBeenCalled();
      expect(dialogShow()).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: "error", message: summary }),
      );
    });

    it("treats a structural error during inspection as an invalid file", async () => {
      await switchToUnlock();
      (getPdfSecurityState as any).mockRejectedValueOnce(new Error("Bad xref table"));

      await component.handleFiles(asFileList(pdf("damaged.pdf")));

      expect((component as any).unlockStates).toEqual(["invalid"]);
    });

    it("explains a batch where every file is invalid", async () => {
      await loadUnlockFiles(["invalid", "invalid"]);

      expect(text("#actionSummary")).toBe(
        "None of the selected PDFs can be processed. They may be corrupted or contain non-standard security headers.",
      );
      expect(text("#unlockHelpText")).toContain("These PDFs appear to be corrupted");
      expect(text("#fileListMeta")).toBe("2 PDFs cannot be processed (invalid) • One ZIP archive");
    });

    it("unlocks the good files in a batch and reports the invalid one as skipped", async () => {
      const [locked] = await loadUnlockFiles(
        ["password-required", "invalid"],
        ["locked.pdf", "broken.pdf"],
      );
      enterCurrentPassword("secret123");

      expect(text("#unlockHelpText")).toBe(
        "Use one current password to unlock all selected PDFs that share it. Invalid files that cannot be processed will be skipped.",
      );
      expect(text("#actionSummary")).toBe(
        "Ready to process 2 PDFs. 1 PDF will have the known password removed. 1 PDF will be skipped because it cannot be processed (corrupted or invalid).",
      );
      expect(text("#fileListMeta")).toBe(
        "1 PDF needs the shared password • 1 PDF cannot be processed (invalid) • One ZIP archive",
      );

      await (component as any).runSecurityAction();

      expect(unprotectPdf).toHaveBeenCalledTimes(1);
      expect(unprotectPdf).toHaveBeenCalledWith(locked, "secret123");
      expect(zipMock.file).toHaveBeenCalledTimes(1);
      expect(zipMock.file).toHaveBeenCalledWith("locked_unprotected.pdf", expect.any(Uint8Array));
      // Announced as skipped before the run, so reported as skipped after it.
      expect(dialogShow()).toHaveBeenLastCalledWith({
        title: "Batch complete",
        type: "success",
        message:
          "1 PDF is ready in one ZIP archive. 1 PDF had the known password removed. 1 PDF was skipped because it cannot be processed (corrupted or invalid).",
      });
      expect(persistence.addJob).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ invalidCount: 1, failedCount: 0 }),
        }),
      );
    });

    it("notes skipped invalid files in mixed restriction and password batches", async () => {
      await loadUnlockFiles(["restriction-only", "invalid"]);
      expect(text("#unlockHelpText")).toBe(
        "These PDFs already open without a password but still have owner restrictions. Kyte can export unrestricted copies with no password entry. Invalid files that cannot be processed will be skipped.",
      );

      await (component as any).applySelectedFiles(
        [pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")],
        false,
      );
      (component as any).unlockStates = ["restriction-only", "password-required", "invalid"];
      (component as any).updateUnlockUi();
      expect(text("#unlockHelpText")).toBe(
        "Kyte will use the current password for files that need it, and it will also export unrestricted copies for files that already open without one. Invalid files that cannot be processed will be skipped.",
      );
    });

    it("shows the invalid-file error when unlocking throws it", async () => {
      await loadUnlockFiles(["password-required"]);
      enterCurrentPassword("secret123");
      (unprotectPdf as any).mockRejectedValueOnce(new Error(INVALID_PDF_ERROR));

      await (component as any).runSecurityAction();

      expect(dialogShow()).toHaveBeenLastCalledWith({
        title: "Error",
        message: INVALID_PDF_ERROR,
        type: "error",
      });
    });

    it("shows checking copy while files are still being inspected", async () => {
      await switchToUnlock();
      let finish!: (state: string) => void;
      (getPdfSecurityState as any).mockImplementationOnce(
        () => new Promise((resolve) => (finish = resolve)),
      );

      const loading = component.handleFiles(asFileList(pdf("slow.pdf")));
      await flush();

      expect(text("#actionSummary")).toBe("Checking whether this PDF requires a known password...");
      expect(text("#unlockHelpText")).toBe(
        "Kyte is checking whether this PDF only has owner restrictions or requires its current password.",
      );
      expect(text("#fileListMeta")).toBe("Inspecting 1 PDF for passwords and owner restrictions.");
      expect(component.querySelector("#fileList")?.textContent).toContain("Checking");
      expect((component.querySelector("#actionSummary") as HTMLElement).style.color).toBe(
        "var(--text-muted)",
      );

      finish("restriction-only");
      await loading;
      expect(text("#fileList .file-name")).toBe("slow.pdf");
      expect(component.querySelector("#fileList")?.textContent).toContain("Restrictions only");
    });

    it("asks for the password and describes the rest of a mixed batch", async () => {
      await loadUnlockFiles(["password-required", "restriction-only", "unprotected"]);

      expect(text("#actionSummary")).toBe(
        "Enter the current password to unlock 1 PDF. 1 PDF will only have owner restrictions removed. 1 PDF will be skipped because it is already unprotected.",
      );
      expect((component.querySelector("#actionSummary") as HTMLElement).style.color).toBe(
        "rgb(245, 158, 11)",
      );
      expect(component.querySelector("#fileList")?.textContent).toContain("Already open");
      expect(text("#securityActionBtn")).toBe("Unlock PDFs");
    });

    it("labels unlock actions and help for single files and empty selections", async () => {
      await loadUnlockFiles(["password-required"]);
      expect(text("#securityActionBtn")).toBe("Remove Known Password");
      expect(text("#unlockHelpText")).toBe(
        "Unlock removes a known password from the selected PDF.",
      );

      (component.querySelector("#clearSelectionBtn") as HTMLButtonElement).click();
      expect(text("#securityActionBtn")).toBe("Unlock PDF");
      expect(text("#unlockHelpText")).toBe(
        "Select one or more PDFs in the left pane to choose the files Kyte should unlock.",
      );
      expect(component.querySelector("#currentPasswordGroup")?.classList.contains("hidden")).toBe(
        true,
      );
    });

    it("describes files that need no change", async () => {
      await loadUnlockFiles(["unprotected", "unprotected"]);

      expect(text("#unlockHelpText")).toBe(
        "Kyte will skip PDFs that already open normally and only process the files that still carry passwords or owner restrictions.",
      );
      expect(text("#actionSummary")).toBe(
        "None of the selected PDFs currently have a password or owner restrictions.",
      );
      expect(text("#fileListMeta")).toBe("2 PDFs already open • One ZIP archive");

      (component as any).unlockStates = ["unprotected"];
      (component as any).files = [pdf("one.pdf")];
      (component as any).fileSelections = [true];
      (component as any).updateUnlockUi();
      expect(text("#unlockHelpText")).toBe(
        "This PDF does not currently need a password or owner-restriction removal.",
      );
    });

    it("summarises plural states, separate downloads and partial selections", async () => {
      await loadUnlockFiles([
        "password-required",
        "password-required",
        "restriction-only",
        "restriction-only",
      ]);
      const individual = component.querySelector(
        'input[name="securityDownloadMode"][value="individual"]',
      ) as HTMLInputElement;
      individual.checked = true;
      individual.dispatchEvent(new Event("change"));
      (component as any).updateFileList();
      expect(text("#fileListMeta")).toBe(
        "2 PDFs need the shared password • 2 PDFs are restriction-only • Separate downloads",
      );

      const checkboxes = component.querySelectorAll<HTMLInputElement>(".security-file-checkbox");
      checkboxes[3].dispatchEvent(new Event("change"));
      expect(text("#fileListMeta")).toBe(
        "3 of 4 selected • 2 PDFs need the shared password • 1 PDF is restriction-only • Separate downloads",
      );
      expect(text("#fileListTitle")).toBe("Selected PDFs (3 of 4)");
      expect(text("#fileSize")).toBe("3 Bytes selected of 4 Bytes total");

      enterCurrentPassword("pw");
      expect(text("#actionSummary")).toBe(
        "Ready to process 3 PDFs. 2 PDFs will have the known password removed. 1 PDF will have owner restrictions removed.",
      );
    });

    it("drops unlock badges and help when switching back to protect with files loaded", async () => {
      await loadUnlockFiles(["restriction-only"]);
      expect(component.querySelector("#fileList")?.textContent).toContain("Restrictions only");

      const protectRadio = component.querySelector(
        'input[name="securityMode"][value="protect"]',
      ) as HTMLInputElement;
      protectRadio.checked = true;
      protectRadio.dispatchEvent(new Event("change"));
      await flush();

      expect((component as any).unlockStates).toEqual(["unprotected"]);
      expect(component.querySelector("#fileList")?.textContent).not.toContain("Restrictions only");
      expect(text("#securityActionBtn")).toBe("Protect PDF");
      expect(text("#actionSummary")).toBe("Enter a password to protect the selected PDFs.");
    });

    it("stops updating the list when the mode changes during an inspection", async () => {
      await switchToUnlock();
      let finish!: (state: string) => void;
      (getPdfSecurityState as any).mockImplementationOnce(
        () => new Promise((resolve) => (finish = resolve)),
      );
      const loading = component.handleFiles(asFileList(pdf("slow.pdf")));
      await flush();

      const protectRadio = component.querySelector(
        'input[name="securityMode"][value="protect"]',
      ) as HTMLInputElement;
      protectRadio.checked = true;
      protectRadio.dispatchEvent(new Event("change"));
      await flush();
      finish("password-required");
      await loading;

      expect(text("#securityTitle")).toBe("Protect PDF");
      expect(component.querySelector("#fileList")?.textContent).not.toContain("Needs password");
      expect(text("#securityActionBtn")).toBe("Protect PDF");
    });

    it("reports a batch failure thrown as a plain string", async () => {
      await loadUnlockFiles(["password-required", "password-required"], ["a.pdf", "b.pdf"]);
      enterCurrentPassword("pw");
      (unprotectPdf as any).mockRejectedValueOnce("worker crashed");

      await (component as any).runSecurityAction();

      expect(dialogShow()).toHaveBeenLastCalledWith(
        expect.objectContaining({ message: expect.stringContaining("a.pdf: worker crashed") }),
      );
    });

    it("finishes inspecting the remaining files when one is removed mid-check", async () => {
      await switchToUnlock();
      let finishFirst!: (state: string) => void;
      (getPdfSecurityState as any)
        .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
        .mockResolvedValueOnce("restriction-only");
      const loading = component.handleFiles(
        asFileList(pdf("big.pdf"), pdf("b.pdf"), pdf("wrong.pdf")),
      );
      await flush();

      // Remove wrong.pdf while big.pdf is still being read.
      component.querySelectorAll<HTMLButtonElement>(".action-btn.remove")[2].click();
      finishFirst("password-required");
      await loading;

      expect((component as any).files.map((file: File) => file.name)).toEqual(["big.pdf", "b.pdf"]);
      expect((component as any).unlockStates).toEqual(["password-required", "restriction-only"]);
      expect(getPdfSecurityState).toHaveBeenCalledTimes(2);
      expect(text("#actionSummary")).toBe(
        "Enter the current password to unlock 1 PDF. 1 PDF will only have owner restrictions removed.",
      );
    });

    it("finishes inspecting the next file when the file being read is removed", async () => {
      await switchToUnlock();
      let finishFirst!: (state: string) => void;
      (getPdfSecurityState as any)
        .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
        .mockResolvedValueOnce("restriction-only");
      const loading = component.handleFiles(asFileList(pdf("big.pdf"), pdf("b.pdf")));
      await flush();

      component.querySelectorAll<HTMLButtonElement>(".action-btn.remove")[0].click();
      finishFirst("password-required");
      await loading;

      expect((component as any).unlockStates).toEqual(["restriction-only"]);
      expect((component.querySelector("#securityActionBtn") as HTMLButtonElement).disabled).toBe(
        false,
      );
    });

    it("does not write an old file's result into a new list loaded mid-check", async () => {
      await switchToUnlock();
      let finishOld!: (state: string) => void;
      (getPdfSecurityState as any).mockImplementationOnce(
        () => new Promise((resolve) => (finishOld = resolve)),
      );
      const oldLoad = component.handleFiles(asFileList(pdf("old.pdf")));
      await flush();

      await (component as any).clearSelectedFiles();
      (getPdfSecurityState as any).mockResolvedValueOnce("restriction-only");
      await component.handleFiles(asFileList(pdf("new.pdf")));
      finishOld("password-required");
      await oldLoad;

      expect((component as any).unlockStates).toEqual(["restriction-only"]);
      expect(text("#fileList .file-name")).toBe("new.pdf");
    });

    it("locks the list and mode while a batch runs and uses the states it started with", async () => {
      const [locked, restricted] = await loadUnlockFiles(
        ["password-required", "restriction-only"],
        ["locked.pdf", "restricted.pdf"],
      );
      enterCurrentPassword("pw");
      let finishFirst!: (bytes: Uint8Array) => void;
      (unprotectPdf as any).mockImplementationOnce(
        () => new Promise((resolve) => (finishFirst = resolve)),
      );

      const run = (component as any).runSecurityAction();
      await flush();

      // Attempts to change the batch while it runs are ignored.
      component.querySelectorAll<HTMLButtonElement>(".action-btn.remove")[0].click();
      component
        .querySelectorAll<HTMLInputElement>(".security-file-checkbox")[1]
        .dispatchEvent(new Event("change"));
      const protectRadio = component.querySelector(
        'input[name="securityMode"][value="protect"]',
      ) as HTMLInputElement;
      protectRadio.checked = true;
      protectRadio.dispatchEvent(new Event("change"));
      await component.handleFiles(asFileList(pdf("late.pdf")));
      expect((component.querySelector("#securityActionBtn") as HTMLButtonElement).disabled).toBe(
        true,
      );
      expect(protectRadio.checked).toBe(false);
      expect(
        (
          component.querySelector(
            'input[name="securityMode"][value="unprotect"]',
          ) as HTMLInputElement
        ).checked,
      ).toBe(true);
      expect((component as any).files).toHaveLength(2);
      // A second click does not start a second run.
      await (component as any).runSecurityAction();
      expect(unprotectPdf).toHaveBeenCalledTimes(1);

      finishFirst(new Uint8Array([1]));
      await run;

      expect(text("#securityTitle")).toBe("Unlock PDF");
      expect(protectPdf).not.toHaveBeenCalled();
      expect(unprotectPdf).toHaveBeenNthCalledWith(1, locked, "pw");
      expect(unprotectPdf).toHaveBeenNthCalledWith(2, restricted, "");
      expect(zipMock.file.mock.calls.map(([name]: any[]) => name)).toEqual([
        "locked_unprotected.pdf",
        "restricted_unrestricted.pdf",
      ]);
      expect((component.querySelector("#securityActionBtn") as HTMLButtonElement).disabled).toBe(
        false,
      );
    });

    it("ignores out-of-range selection toggles and select-all with no files", () => {
      expect(() => (component as any).toggleFileSelection(5)).not.toThrow();
      (component as any).setAllFileSelections(true);
      expect((component as any).fileSelections).toEqual([]);
    });

    it("titles single unlock results by what was removed", async () => {
      const [restricted] = await loadUnlockFiles(["restriction-only"], ["restricted.pdf"]);
      await (component as any).runSecurityAction();

      expect(unprotectPdf).toHaveBeenCalledWith(restricted, "");
      expect(text("#successTitle")).toBe("Restrictions Removed!");
      expect(text("#successDetails")).toBe(
        "The exported copy opens normally and no longer carries owner restrictions.",
      );
      expect(persistence.addJob).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: "restricted_unrestricted.pdf",
          metadata: { restrictionsRemoved: true, passwordRemoved: false },
        }),
      );
      expect(dialogShow()).toHaveBeenLastCalledWith(
        expect.objectContaining({ message: "Owner restrictions were removed from your PDF." }),
      );

      await (component as any).applySelectedFiles([pdf("locked.pdf")], false);
      (component as any).unlockStates = ["password-required"];
      enterCurrentPassword("pw");
      await (component as any).runSecurityAction();
      expect(text("#successTitle")).toBe("Password Removed!");
      expect(text("#successDetails")).toBe(
        "The exported copy opens without asking for a password.",
      );
      expect(dialogShow()).toHaveBeenLastCalledWith(
        expect.objectContaining({ message: "The password was removed from your PDF." }),
      );
    });

    it("names an all-restriction batch archive accordingly", async () => {
      await loadUnlockFiles(["restriction-only", "restriction-only"]);

      await (component as any).runSecurityAction();

      expect(persistence.addJob).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: "unrestricted_pdfs.zip",
          metadata: expect.objectContaining({ restrictionsRemoved: 2, passwordRemoved: 0 }),
        }),
      );
      expect(text("#successDetails")).toBe(
        "2 PDFs are ready in one ZIP archive. 2 PDFs had owner restrictions removed.",
      );
      expect(dialogShow()).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: "Success!", type: "success" }),
      );
    });

    it("forgets the saved session when the last file is removed", async () => {
      await loadUnlockFiles(["password-required"]);
      vi.mocked(persistence.delete).mockClear();

      (component.querySelector(".action-btn.remove") as HTMLButtonElement).click();
      await flush();

      expect(persistence.delete).toHaveBeenCalledWith("pdf-unprotect");
      expect(component.querySelector("#dropZone")?.classList.contains("hidden")).toBe(false);
      expect(text("#actionSummary")).toBe("Upload one or more PDFs to continue.");
    });
  });

  describe("protect mode copy and outcomes", () => {
    const pdf = (name: string) => new File(["x"], name, { type: "application/pdf" });
    const text = (selector: string) => component.querySelector(selector)?.textContent?.trim();

    it.each([
      ["", "", "Enter a password to protect the selected PDFs."],
      ["abc", "abc", "Use at least 4 characters for the open password."],
      ["secret", "", "Confirm the password to continue."],
      ["secret", "secreT", "Passwords must match."],
    ])("explains what is missing for open %j and confirm %j", async (open, confirm, message) => {
      await component.handleFiles(asFileList(pdf("a.pdf")));
      setProtectPasswords(open, confirm);

      expect(text("#actionSummary")).toBe(message);
      expect(component.querySelector("#passwordMismatch")?.classList.contains("hidden")).toBe(
        message !== "Passwords must match.",
      );
    });

    it("asks for files, then for a selection, in the selection panel", async () => {
      await component.handleFiles(asFileList(pdf("a.pdf"), pdf("b.pdf")));
      (component.querySelector("#clearSelectionBtn") as HTMLButtonElement).click();
      expect(text("#fileListMeta")).toBe(
        "Select at least one PDF from the 2 PDFs loaded in this batch.",
      );
      expect(text("#actionSummary")).toBe("Select at least one PDF to continue.");
    });

    it("counts enabled viewer permissions in the ready message", async () => {
      await component.handleFiles(asFileList(pdf("a.pdf")));
      setProtectPasswords();
      expect(text("#actionSummary")).toBe(
        "Ready to protect 1 PDF with 1 viewer permission enabled.",
      );

      const printing = component.querySelector("#allowPrinting") as HTMLInputElement;
      printing.checked = false;
      printing.dispatchEvent(new Event("change"));
      expect(text("#actionSummary")).toBe(
        "Ready to protect 1 PDF with all editing permissions disabled.",
      );
    });

    it("describes protect batches and partial selections", async () => {
      await component.handleFiles(asFileList(pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")));
      expect(text("#fileListMeta")).toBe(
        "Each PDF will be protected individually and packaged together when the batch completes.",
      );
      expect(text("#securityActionBtn")).toBe("Protect PDFs");

      const individual = component.querySelector(
        'input[name="securityDownloadMode"][value="individual"]',
      ) as HTMLInputElement;
      individual.checked = true;
      individual.dispatchEvent(new Event("change"));
      (component as any).updateFileList();
      expect(text("#fileListMeta")).toBe(
        "Each PDF will be protected individually and downloaded as a separate file.",
      );

      const checkboxes = component.querySelectorAll<HTMLInputElement>(".security-file-checkbox");
      checkboxes[1].dispatchEvent(new Event("change"));
      component
        .querySelectorAll<HTMLInputElement>(".security-file-checkbox")[2]
        .dispatchEvent(new Event("change"));
      expect(text("#fileListMeta")).toBe(
        "1 of 3 selected. This PDF will be exported as a separately protected copy.",
      );
    });

    it("protects a batch into one archive with a protect-specific summary", async () => {
      await component.handleFiles(asFileList(pdf("a.pdf"), pdf("b.pdf")));
      setProtectPasswords();

      await (component as any).runSecurityAction();

      expect(text("#successTitle")).toBe("Batch Protected!");
      expect(text("#successDetails")).toBe("2 PDFs are ready in one ZIP archive.");
      expect(persistence.addJob).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: "Protect Batch",
          fileName: "protected_pdfs.zip",
          metadata: { batch: true, fileCount: 2, permissionsRestricted: 3 },
        }),
      );
    });

    it("reports a single protected file with its own title", async () => {
      await component.handleFiles(asFileList(pdf("a.pdf")));
      setProtectPasswords();

      await (component as any).runSecurityAction();

      expect(text("#successTitle")).toBe("PDF Protected!");
      expect(text("#successDetails")).toBe("The exported copy now requires the password you set.");
    });

    it("opens straight into unlock mode from its attribute", () => {
      document.body.innerHTML = '<div id="globalDialog"></div>';
      (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
      const unlockTool = new PdfSecurity();
      unlockTool.setAttribute("mode", "unprotect");
      document.body.appendChild(unlockTool);

      expect(unlockTool.querySelector("#securityTitle")?.textContent).toBe("Unlock PDF");
      expect(
        (unlockTool.querySelector('input[value="unprotect"]') as HTMLInputElement).checked,
      ).toBe(true);
    });

    it("resumes several saved files and hides resume when nothing is saved", async () => {
      (persistence.get as any).mockResolvedValueOnce([pdf("a.pdf"), pdf("b.pdf")]);
      await (component as any).checkExistingSession();
      expect(text("#resumeBtn")).toBe("Resume 2 PDFs");

      (persistence.get as any).mockResolvedValueOnce(null);
      await (component as any).checkExistingSession();
      expect(component.querySelector("#resumeContainer")?.classList.contains("hidden")).toBe(true);
      expect(text("#resumeBtn")).toBe("Resume Session");

      (persistence.get as any).mockResolvedValueOnce(undefined);
      await (component as any).restoreSession();
      expect((component as any).files).toEqual([]);
    });

    it("still protects with default permissions when optional markup is missing", async () => {
      for (const selector of [
        "#fileName",
        "#fileSize",
        "#fileListTitle",
        "#fileListMeta",
        "#selectAllFilesBtn",
        "#clearSelectionBtn",
        "#downloadModeGroup",
        "#unlockHelpText",
        "#currentPasswordGroup",
        "#actionSummary",
        "#passwordMismatch",
        "#successTitle",
        "#successDetails",
        "#downloadLink",
        "#progressSection",
        "#allowPrinting",
        "#allowCopying",
        "#allowModifying",
        "#allowAnnotating",
      ]) {
        component.querySelector(selector)?.remove();
      }

      await component.handleFiles(asFileList(pdf("a.pdf"), pdf("b.pdf")));
      setProtectPasswords();
      await (component as any).runSecurityAction();

      expect(protectPdf).toHaveBeenCalledTimes(2);
      expect(protectPdf).toHaveBeenCalledWith(expect.any(File), {
        userPassword: "secret123",
        ownerPassword: "",
        permissions: {
          allowPrinting: true,
          allowCopying: false,
          allowModifying: false,
          allowAnnotating: false,
        },
      });
      expect(persistence.addJob).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: "protected_pdfs.zip" }),
      );

      await (component as any).applySelectedFiles([pdf("one.pdf")], false);
      await (component as any).runSecurityAction();
      expect(persistence.addJob).toHaveBeenLastCalledWith(
        expect.objectContaining({ fileName: "one_protected.pdf" }),
      );

      for (const selector of [
        "#openPassword",
        "#confirmPassword",
        "#ownerPassword",
        "#currentPassword",
      ]) {
        component.querySelector(selector)?.remove();
      }
      component.resetState();
      expect(component.querySelector("#dropZone")?.classList.contains("hidden")).toBe(false);
    });

    it("keeps both copies when two inputs share a name", async () => {
      await component.handleFiles(asFileList(pdf("invoice.pdf"), pdf("invoice.pdf")));
      setProtectPasswords();

      await (component as any).runSecurityAction();

      expect(zipMock.file.mock.calls.map(([name]: any[]) => name)).toEqual([
        "invoice_protected.pdf",
        "invoice_protected (2).pdf",
      ]);
    });

    it("shows a plain message instead of parser text for a damaged file in a batch", async () => {
      await component.handleFiles(asFileList(pdf("good.pdf"), pdf("broken.pdf"), pdf("old.pdf")));
      setProtectPasswords();
      (protectPdf as any)
        .mockResolvedValueOnce(new Uint8Array([1]))
        .mockRejectedValueOnce(
          new Error(
            "Failed to parse PDF document (line:21 col:804 offset=16): Failed to parse invalid PDF object",
          ),
        )
        .mockRejectedValueOnce(
          new Error(
            "This PDF is already password-protected. Remove the current password before adding a new one.",
          ),
        );

      await (component as any).runSecurityAction();

      const { message } = (document.getElementById("globalDialog") as any).show.mock.calls.at(
        -1,
      )[0];
      expect(message).toContain(`broken.pdf: ${INVALID_PDF_ERROR}`);
      // The tool's own messages stay word for word.
      expect(message).toContain(
        "old.pdf: This PDF is already password-protected. Remove the current password before adding a new one.",
      );
      expect(message).not.toContain("Failed to parse");
    });

    it("shows the invalid-file message when a single damaged file fails", async () => {
      await component.handleFiles(asFileList(pdf("broken.pdf")));
      setProtectPasswords();
      (protectPdf as any).mockRejectedValueOnce(
        new Error("Failed to parse PDF document (line:0 col:6 offset=6): Expected next byte"),
      );

      await (component as any).runSecurityAction();

      expect((document.getElementById("globalDialog") as any).show).toHaveBeenLastCalledWith({
        title: "Error",
        message: INVALID_PDF_ERROR,
        type: "error",
      });
    });

    it("runs the action and restores a session from their buttons", async () => {
      await component.handleFiles(asFileList(pdf("a.pdf")));
      setProtectPasswords();

      (component.querySelector("#securityActionBtn") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(protectPdf).toHaveBeenCalledTimes(1);

      (persistence.get as any).mockResolvedValueOnce(pdf("saved.pdf"));
      await (component as any).clearSelectedFiles();
      (persistence.get as any).mockResolvedValueOnce(pdf("saved.pdf"));
      (component.querySelector("#resumeBtn") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(text("#fileName")).toBe("saved.pdf");
    });

    it("ignores files that are not PDFs and actions with nothing selected", async () => {
      await component.handleFiles(asFileList(new File(["x"], "notes.txt", { type: "text/plain" })));
      expect((component as any).files).toEqual([]);
      expect(persistence.set).not.toHaveBeenCalled();

      await (component as any).runSecurityAction();
      await (component as any).clearSelectedFiles();
      expect(protectPdf).not.toHaveBeenCalled();
      expect((document.getElementById("globalDialog") as any).show).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: "Confirm" }),
      );
    });

    it("reports an empty batch and a lone non-security failure as a batch failure", async () => {
      await (component as any).showBatchResults("protect", [], [], [], []);
      expect((document.getElementById("globalDialog") as any).show).toHaveBeenLastCalledWith(
        expect.objectContaining({
          title: "Batch failed",
          message: "No files were processed in this batch.",
        }),
      );

      await (component as any).showBatchResults(
        "unprotect",
        [],
        ["skipped.pdf"],
        [],
        [{ fileName: "bad.pdf", message: INVALID_PDF_ERROR }],
      );
      expect((document.getElementById("globalDialog") as any).show).toHaveBeenLastCalledWith(
        expect.objectContaining({ message: `bad.pdf: ${INVALID_PDF_ERROR}` }),
      );
    });

    it("downloads a single individual result without waiting between files", async () => {
      const anchorClick = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => undefined);
      (component as any).downloadMode = "individual";
      (component as any).mode = "protect";

      await (component as any).showBatchResults(
        "protect",
        [
          {
            fileName: "a.pdf",
            outputName: "a_protected.pdf",
            outputBytes: new Uint8Array([1]),
            resultType: "protected",
          },
        ],
        [],
        [],
        [],
      );

      expect(anchorClick).toHaveBeenCalledTimes(1);
      expect((document.getElementById("globalDialog") as any).show).toHaveBeenLastCalledWith({
        title: "Success!",
        message: "1 PDF was downloaded individually.",
        type: "success",
      });
      anchorClick.mockRestore();
    });
  });
});
