import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  anydocEngine: {
    convert: vi.fn(),
  },
  persistence: {
    addJob: vi.fn().mockResolvedValue(1),
    delete: vi.fn().mockResolvedValue(undefined),
    estimateUsage: vi.fn().mockResolvedValue(0),
    get: vi.fn().mockResolvedValue(undefined),
    getJobs: vi.fn().mockResolvedValue([]),
    getStorageUsage: vi.fn().mockResolvedValue({ quota: 1000, usage: 0 }),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../utils/anydocEngine.ts", () => ({
  AnydocError: class AnydocError extends Error {
    reason: string;
    constructor(failure: { reason: string; message: string }) {
      super(failure.message);
      this.name = "AnydocError";
      this.reason = failure.reason;
    }
  },
  anydocEngine: mocks.anydocEngine,
}));

vi.mock("../../utils/persistence.ts", () => ({
  persistence: mocks.persistence,
}));

import { OfficeToPdf } from "../../components/OfficeToPdf";

const asFileList = (files: File[]) => files as unknown as FileList;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("OfficeToPdf (Office to Markdown)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.anydocEngine.convert.mockResolvedValue({
      format: "docx",
      sourceMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      markdown: "# Hello",
      warnings: [],
      engine: "anydoc-wasm",
      engineVersion: "0.1.8",
      processingTimeMs: 1,
    });
    mocks.persistence.get.mockResolvedValue(undefined);
    mocks.persistence.estimateUsage.mockResolvedValue(0);
    mocks.persistence.getStorageUsage.mockResolvedValue({ quota: 1000, usage: 0 });
    mocks.persistence.getJobs.mockResolvedValue([]);
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
    (window as any).lucide = { createIcons: vi.fn() };
  });

  const mount = async () => {
    const component = new OfficeToPdf();
    document.body.appendChild(component);
    await flush();
    return component;
  };

  it("renders as Office to Markdown", async () => {
    const component = await mount();
    expect(component.textContent).toContain("Office to Markdown");
    expect((window as any).lucide.createIcons).toHaveBeenCalled();
  });

  it("rejects PDFs and accepts supported Office files", async () => {
    const component = await mount();
    const pdf = new File(["%PDF"], "notes.pdf", { type: "application/pdf" });

    await component.handleFiles(asFileList([pdf]));
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Error", type: "error" }),
    );
    expect(mocks.persistence.set).not.toHaveBeenCalled();

    const officeFile = new File(["doc"], "proposal.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await component.handleFiles(asFileList([officeFile]));

    expect(mocks.persistence.set).toHaveBeenCalledWith("office-to-markdown", officeFile);
    expect(component.querySelector("#fileName")?.textContent).toBe("proposal.docx");
    expect(component.querySelector("#mainLayout")?.classList.contains("hidden")).toBe(false);
  });

  it("shows and restores saved sessions", async () => {
    const saved = new File(["ppt"], "deck.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    mocks.persistence.get.mockResolvedValue(saved);
    const component = await mount();

    await component.checkExistingSession();
    expect(component.querySelector("#resumeContainer")?.classList.contains("hidden")).toBe(false);
    expect(component.querySelector("#resumeBtn")?.textContent).toContain("Resume deck.pptx");

    await component.restoreSession();
    expect(component.querySelector("#fileName")?.textContent).toBe("deck.pptx");
  });

  it("converts the selected Office file to Markdown and records history", async () => {
    const component = await mount();
    const officeFile = new File(["sheet"], "budget.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    await component.handleFiles(asFileList([officeFile]));

    await component.handleConvert();

    expect(mocks.anydocEngine.convert).toHaveBeenCalled();
    expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(false);
    expect(mocks.persistence.addJob).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "budget_extracted.md",
        metadata: expect.objectContaining({
          originalFormat: "xlsx",
          mode: "local",
          engine: "anydoc-wasm",
        }),
        tool: "Office to Markdown",
      }),
    );
  });

  it("passes an explicit format for every advertised extension, especially CSV", async () => {
    const component = await mount();
    const csvFile = new File(["a,b\n1,2"], "table.csv", { type: "text/csv" });
    await component.handleFiles(asFileList([csvFile]));

    await component.handleConvert();

    expect(mocks.anydocEngine.convert).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({ format: "csv", sourceName: "table.csv" }),
    );
  });

  it("derives format from extension for formats with ambiguous byte signatures", async () => {
    const component = await mount();
    const rtfFile = new File(["{\\rtf1}"], "letter.rtf", { type: "application/rtf" });
    await component.handleFiles(asFileList([rtfFile]));

    await component.handleConvert();

    expect(mocks.anydocEngine.convert).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({ format: "rtf", sourceName: "letter.rtf" }),
    );
  });

  it("does not execute HTML/JS embedded in a resumed filename (stored XSS regression)", async () => {
    const maliciousName = "<img src=x onerror=window.__resumeXss=1>.docx";
    const saved = new File(["doc"], maliciousName, {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    mocks.persistence.get.mockResolvedValue(saved);
    (window as any).__resumeXss = undefined;

    const component = await mount();
    await component.checkExistingSession();

    const resumeBtn = component.querySelector("#resumeBtn") as HTMLElement;
    // No injected <img> element should exist in the resume button.
    expect(resumeBtn.querySelector("img")).toBeNull();
    // The payload must never have executed.
    expect((window as any).__resumeXss).toBeUndefined();
    // The filename should still be visible to the user as plain text.
    expect(resumeBtn.textContent).toContain(".docx");
  });

  it("does nothing without a file and recovers after conversion errors", async () => {
    const component = await mount();
    await component.handleConvert();
    expect(mocks.anydocEngine.convert).not.toHaveBeenCalled();

    await component.handleFiles(
      asFileList([
        new File(["doc"], "bad.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      ]),
    );
    mocks.anydocEngine.convert.mockRejectedValueOnce(new Error("engine down"));

    await component.handleConvert();

    expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Error", type: "error" }),
    );
    expect((component.querySelector("#convertBtn") as HTMLButtonElement).disabled).toBe(false);
    expect(component.querySelector("#progressSection")?.classList.contains("hidden")).toBe(true);
  });
});

describe("OfficeToPdf (Office to Markdown) edge cases", () => {
  const docx = (name = "proposal.docx") =>
    new File(["doc"], name, {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  const dialog = () => (document.getElementById("globalDialog") as any).show;
  const lastDialog = () => dialog().mock.calls.at(-1)?.[0];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.anydocEngine.convert.mockReset().mockResolvedValue({
      format: "docx",
      sourceMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      markdown: "# Proposal\n\nBody",
      warnings: [],
      engine: "anydoc-wasm",
      engineVersion: "0.1.8",
      processingTimeMs: 1,
    });
    mocks.persistence.get.mockResolvedValue(undefined);
    mocks.persistence.estimateUsage.mockResolvedValue(0);
    mocks.persistence.getStorageUsage.mockResolvedValue({ quota: 1000, usage: 0 });
    mocks.persistence.getJobs.mockResolvedValue([]);
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
  });

  const mount = async () => {
    const component = new OfficeToPdf();
    document.body.appendChild(component);
    await flush();
    return component;
  };

  it("limits the file picker to the formats it can convert", async () => {
    const component = await mount();

    const accept = (component.querySelector("#fileInput") as HTMLInputElement).accept;
    expect(accept.split(",")).toEqual(
      expect.arrayContaining([".docx", ".xlsx", ".pptx", ".csv", ".epub"]),
    );
    expect(accept).not.toContain(".pdf");
  });

  it("converts from the button and saves the Markdown it produced", async () => {
    const component = await mount();
    await component.handleFiles(asFileList([docx()]));

    (component.querySelector("#convertBtn") as HTMLButtonElement).click();

    await vi.waitFor(() => expect(mocks.persistence.addJob).toHaveBeenCalled());
    const job = mocks.persistence.addJob.mock.calls.at(-1)?.[0];
    expect(new TextDecoder().decode(job.data)).toBe("# Proposal\n\nBody");
    expect(job.fileName).toBe("proposal_extracted.md");
    expect(lastDialog()).toMatchObject({ type: "success", message: "Markdown ready (docx)." });
  });

  it("passes the converter's warnings on to the user", async () => {
    mocks.anydocEngine.convert.mockResolvedValue({
      format: "csv",
      sourceMime: "text/csv",
      markdown: "| a | b |",
      warnings: ["Some cells were merged."],
      engine: "anydoc-wasm",
      engineVersion: "0.1.8",
      processingTimeMs: 1,
    });
    const component = await mount();
    await component.handleFiles(asFileList([new File(["a,b"], "data.csv", { type: "text/csv" })]));

    await component.handleConvert();

    expect(lastDialog().message).toBe("Markdown ready (csv; Some cells were merged.).");
  });

  it("reports an empty conversion instead of offering an empty file", async () => {
    mocks.anydocEngine.convert.mockResolvedValue({
      format: "docx",
      sourceMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      markdown: "  \n",
      warnings: ["The document parser produced no text."],
      engine: "anydoc-wasm",
      engineVersion: "0.1.8",
      processingTimeMs: 1,
    });
    const component = await mount();
    await component.handleFiles(asFileList([docx("empty.docx")]));

    await component.handleConvert();

    expect(lastDialog()).toMatchObject({
      type: "error",
      title: "No text found",
      message:
        "No text was found in this document. It may be empty, or use an encoding the converter cannot read.",
    });
    expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(true);
    expect(mocks.persistence.addJob).not.toHaveBeenCalled();
  });

  it.each([
    ["data.csv", "application/vnd.ms-excel"],
    ["data.csv", "text/plain"],
    ["letter.rtf", "text/rtf"],
  ])("accepts %s when the browser labels it %s", async (name, type) => {
    const component = await mount();

    await component.handleFiles(asFileList([new File(["x"], name, { type })]));

    expect(mocks.persistence.set).toHaveBeenCalled();
    expect(component.querySelector("#fileName")?.textContent).toBe(name);
  });

  it("converts the bytes, format and name of the file picked when the run started", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.anydocEngine.convert.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const component = await mount();
    await component.handleFiles(asFileList([docx("first.docx")]));

    const run = component.handleConvert();
    await flush();
    await component.handleFiles(
      asFileList([new File(["a,b"], "second.csv", { type: "text/csv" })]),
    );
    finish({
      format: "docx",
      sourceMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      markdown: "# First",
      warnings: [],
      engine: "anydoc-wasm",
      engineVersion: "0.1.8",
      processingTimeMs: 1,
    });
    await run;

    expect(mocks.anydocEngine.convert).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({ format: "docx", sourceName: "first.docx" }),
    );
    expect(mocks.persistence.addJob.mock.calls.at(-1)?.[0].fileName).toBe("first_extracted.md");
    expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(true);
  });

  it("hides a finished result when another file is chosen", async () => {
    const component = await mount();
    await component.handleFiles(asFileList([docx("first.docx")]));
    await component.handleConvert();
    expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(false);

    await component.handleFiles(asFileList([docx("second.docx")]));

    expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(true);
    expect((component.querySelector("#downloadLink") as HTMLElement).onclick).toBeNull();
  });

  it("refuses files over the size limit", async () => {
    const component = await mount();
    const big = docx("huge.docx");
    Object.defineProperty(big, "size", { value: 101 * 1024 * 1024 });

    await component.handleFiles(asFileList([big]));

    expect(lastDialog()).toMatchObject({ type: "error" });
    expect(lastDialog().message).toContain("This file is too large");
    expect(mocks.persistence.set).not.toHaveBeenCalled();
    expect(component.querySelector("#mainLayout")?.classList.contains("hidden")).toBe(true);
  });

  it("refuses a supported extension whose type says it is something else", async () => {
    const component = await mount();

    await component.handleFiles(
      asFileList([new File(["png"], "photo.docx", { type: "image/png" })]),
    );

    expect(lastDialog().message).toContain("Invalid file type: image/png");
    expect(mocks.persistence.set).not.toHaveBeenCalled();
  });

  it.each([
    [
      "encrypted",
      "This document is password-protected. Remove the password in the app that created it, then try again.",
    ],
    ["malformed", "This file is damaged, or its contents do not match its file type."],
    [
      "missingPart",
      "This file is incomplete: part of the document is missing. Save it again from the app that created it, then try again.",
    ],
    ["unsupported", "This document uses a format or feature the converter does not support."],
    [
      "resourceLimit",
      "This document is too large or complex to convert in the browser. Try a smaller file.",
    ],
    [
      "engine-unavailable",
      "The document converter could not load. Check your connection, reload the page and try again.",
    ],
    ["unknown", "Extraction failed. Please try again."],
  ])("explains a %s failure in plain words", async (reason, message) => {
    const { AnydocError } = await import("../../utils/anydocEngine");
    mocks.anydocEngine.convert.mockRejectedValue(
      new AnydocError({ reason: reason as never, message: "anydoc wasm fetch failed: 503" }),
    );
    const component = await mount();
    await component.handleFiles(asFileList([docx("locked.docx")]));

    await component.handleConvert();

    expect(lastDialog()).toMatchObject({ type: "error", message });
    // Neither internal codes nor engine detail reach the user.
    expect(lastDialog().message).not.toContain(`(${reason})`);
    expect(lastDialog().message).not.toContain("wasm");
    expect(mocks.persistence.addJob).not.toHaveBeenCalled();
  });

  it("does nothing when there is no saved file, and survives storage errors", async () => {
    const component = await mount();

    await component.restoreSession();
    expect(component.querySelector("#mainLayout")?.classList.contains("hidden")).toBe(true);

    mocks.persistence.get.mockRejectedValueOnce(new Error("IndexedDB unavailable"));
    await expect(component.checkExistingSession()).resolves.toBeUndefined();
    expect(component.querySelector("#resumeContainer")?.classList.contains("hidden")).toBe(true);
  });

  it("registers both the current and the legacy tag", () => {
    expect(customElements.get("office-to-markdown")).toBe(OfficeToPdf);
    const legacy = document.createElement("office-to-pdf");
    expect(legacy).toBeInstanceOf(OfficeToPdf);
  });
});

describe("OfficeToPdf recent files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persistence.get.mockResolvedValue(undefined);
    mocks.persistence.estimateUsage.mockResolvedValue(0);
    mocks.persistence.getStorageUsage.mockResolvedValue({ quota: 1000, usage: 0 });
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
  });

  const job = (id: number, fileName: string, mimeType?: string) => ({
    id,
    tool: "test",
    fileName,
    fileSize: 3,
    timestamp: id,
    data: new Uint8Array([1, 2, 3]),
    ...(mimeType ? { mimeType } : {}),
  });

  it("offers recent Office files but not PDFs or Markdown results", async () => {
    mocks.persistence.getJobs.mockResolvedValue([
      job(1, "report.pdf", "application/pdf"),
      job(2, "proposal_extracted.md", "text/markdown"),
      job(3, "budget.xlsx"),
      job(4, "proposal.docx"),
    ]);
    const component = new OfficeToPdf();
    document.body.appendChild(component);
    await flush();

    const chips = [...component.querySelectorAll(".recent-file-chip")].map((chip) =>
      chip.getAttribute("title"),
    );
    expect(chips).toEqual(["budget.xlsx", "proposal.docx"]);
    expect(component.querySelector("#recentFilesContainer")?.classList.contains("hidden")).toBe(
      false,
    );

    (component.querySelector('.recent-file-chip[data-id="4"]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(component.querySelector("#fileName")?.textContent).toBe("proposal.docx"),
    );
  });

  it("hides the recent list when nothing in history can be converted", async () => {
    mocks.persistence.getJobs.mockResolvedValue([
      job(1, "report.pdf", "application/pdf"),
      job(2, "notes.md"),
    ]);
    const component = new OfficeToPdf();
    document.body.appendChild(component);
    await flush();

    expect(component.querySelectorAll(".recent-file-chip")).toHaveLength(0);
    expect(component.querySelector("#recentFilesContainer")?.classList.contains("hidden")).toBe(
      true,
    );
  });
});
