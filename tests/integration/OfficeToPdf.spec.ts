import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cloudConversionService: {
    convertFile: vi.fn(),
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

vi.mock("../../utils/CloudConversionService.ts", () => ({
  cloudConversionService: mocks.cloudConversionService,
}));

vi.mock("../../utils/persistence.ts", () => ({
  persistence: mocks.persistence,
}));

import { OfficeToPdf } from "../../components/OfficeToPdf";

const asFileList = (files: File[]) => files as unknown as FileList;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("OfficeToPdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cloudConversionService.convertFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
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

  it("renders and configures Office file input", async () => {
    const component = await mount();

    expect(component.textContent).toContain("Office to PDF");
    expect((component.querySelector("#fileInput") as HTMLInputElement).accept).toBe(
      ".docx,.doc,.pptx,.ppt,.xlsx,.xls",
    );
    expect((window as any).lucide.createIcons).toHaveBeenCalled();
  });

  it("rejects unsupported files and accepts supported Office files", async () => {
    const component = await mount();
    const invalid = new File(["txt"], "notes.txt", { type: "text/plain" });

    await component.handleFiles(asFileList([invalid]));
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Error", type: "error" }),
    );
    expect(mocks.persistence.set).not.toHaveBeenCalled();

    const officeFile = new File(["doc"], "proposal.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await component.handleFiles(asFileList([officeFile]));

    expect(mocks.persistence.set).toHaveBeenCalledWith("office-to-pdf", officeFile);
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

  it("converts the selected Office file and records history", async () => {
    const component = await mount();
    const officeFile = new File(["sheet"], "budget.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    await component.handleFiles(asFileList([officeFile]));

    await component.handleConvert();

    expect(mocks.cloudConversionService.convertFile).toHaveBeenCalledWith(officeFile, "pdf");
    expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(false);
    expect(mocks.persistence.addJob).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "budget.xlsx_converted.pdf",
        metadata: { originalFormat: "xlsx" },
        tool: "Office to PDF",
      }),
    );
  });

  it("does nothing without a file and recovers after conversion errors", async () => {
    const component = await mount();
    await component.handleConvert();
    expect(mocks.cloudConversionService.convertFile).not.toHaveBeenCalled();

    await component.handleFiles(
      asFileList([
        new File(["doc"], "bad.doc", {
          type: "application/msword",
        }),
      ]),
    );
    mocks.cloudConversionService.convertFile.mockRejectedValueOnce(new Error("gateway down"));

    await component.handleConvert();

    expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Error", type: "error" }),
    );
    expect((component.querySelector("#convertBtn") as HTMLButtonElement).disabled).toBe(false);
    expect(component.querySelector("#progressSection")?.classList.contains("hidden")).toBe(true);
  });
});
