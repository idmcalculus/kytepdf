import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cloudConversionService: {
    convertFile: vi.fn(),
  },
  localConverter: {
    pdfToExcel: vi.fn(),
    pdfToWord: vi.fn(),
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
  preview: {
    load: vi.fn().mockResolvedValue(undefined),
    next: vi.fn(),
    prev: vi.fn(),
  },
}));

vi.mock("../../utils/CloudConversionService.ts", () => ({
  cloudConversionService: mocks.cloudConversionService,
}));

vi.mock("../../utils/LocalConverter.ts", () => ({
  localConverter: mocks.localConverter,
}));

vi.mock("../../utils/pdfPreview.ts", () => ({
  getPdfPreviewErrorMessage: vi.fn(() => "Preview error message"),
  PdfPreviewController: class {
    load = mocks.preview.load;
    next = mocks.preview.next;
    prev = mocks.preview.prev;
  },
}));

vi.mock("../../utils/persistence.ts", () => ({
  persistence: mocks.persistence,
}));

import { PdfToOffice } from "../../components/PdfToOffice";

const asFileList = (files: File[]) => files as unknown as FileList;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const pdfFile = (name = "sample.pdf") =>
  new File(["%PDF-1.4 mock"], name, { type: "application/pdf" });

describe("PdfToOffice extended behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cloudConversionService.convertFile.mockResolvedValue(new Uint8Array([9, 9, 9]));
    mocks.localConverter.pdfToWord.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      quality: "good",
      success: true,
      warnings: [],
    });
    mocks.localConverter.pdfToExcel.mockResolvedValue({
      data: new Uint8Array([4, 5, 6]),
      quality: "fair",
      success: true,
      warnings: ["Some layout fidelity may be reduced in local mode."],
    });
    mocks.persistence.get.mockResolvedValue(undefined);
    mocks.persistence.estimateUsage.mockResolvedValue(0);
    mocks.persistence.getStorageUsage.mockResolvedValue({ quota: 1000, usage: 0 });
    mocks.persistence.getJobs.mockResolvedValue([]);
    mocks.preview.load.mockResolvedValue(undefined);
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
    (window as any).ensureCloudConsent = vi.fn().mockResolvedValue(true);
    (window as any).lucide = { createIcons: vi.fn() };
  });

  const mount = async (format: "docx" | "pptx" | "xlsx" | "pdf" = "docx") => {
    const component = new PdfToOffice(format);
    document.body.appendChild(component);
    await flush();
    return component;
  };

  it("maps format labels and local support", async () => {
    const word = new PdfToOffice("docx");
    expect(word.formatLabel).toBe("Word");
    expect(word.supportsLocal).toBe(true);

    const powerpoint = new PdfToOffice("pptx");
    expect(powerpoint.formatLabel).toBe("PowerPoint");
    expect(powerpoint.supportsLocal).toBe(false);

    const excel = new PdfToOffice("xlsx");
    expect(excel.formatLabel).toBe("Excel (Sheets)");
    expect(excel.supportsLocal).toBe(true);

    const pdf = new PdfToOffice("pdf");
    expect(pdf.formatLabel).toBe("PDF");
  });

  it("uses the format attribute and disables unavailable local mode", async () => {
    const component = new PdfToOffice();
    component.setAttribute("format", "pptx");
    document.body.appendChild(component);
    await flush();

    expect(component.querySelector("h1")?.textContent).toContain("PDF to PowerPoint");
    expect((component.querySelector("#modeLocalBtn") as HTMLButtonElement).disabled).toBe(true);

    (component as any).setConversionMode("local");
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Error", type: "error" }),
    );
  });

  it("loads previews, handles preview failures, and restores sessions", async () => {
    const component = await mount("docx");
    const file = pdfFile();

    await component.handleFiles(asFileList([file]));
    expect(mocks.persistence.set).toHaveBeenCalledWith("pdf-to-docx", file);
    expect(mocks.preview.load).toHaveBeenCalledWith(file);
    expect(component.querySelector("#mainLayout")?.classList.contains("hidden")).toBe(false);

    mocks.preview.load.mockRejectedValueOnce(new Error("preview failed"));
    await component.handleFiles(asFileList([pdfFile("bad.pdf")]));
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
      expect.objectContaining({ message: "An unexpected error occurred.", type: "error" }),
    );

    const saved = pdfFile("saved.pdf");
    mocks.persistence.get.mockResolvedValue(saved);
    await component.checkExistingSession();
    expect(component.querySelector("#resumeContainer")?.classList.contains("hidden")).toBe(false);
    await component.restoreSession();
    expect(component.querySelector("#fileName")?.textContent).toBe("saved.pdf");
  });

  it("runs local Word and Excel conversions and reuses cached PDF bytes", async () => {
    const word = await mount("docx");
    const file = pdfFile();
    await word.handleFiles(asFileList([file]));

    await word.handleConvert();
    await word.handleConvert();

    expect(mocks.localConverter.pdfToWord).toHaveBeenCalledTimes(2);
    expect((word as any).cachedPdfBytes).toBeInstanceOf(Uint8Array);
    expect(mocks.persistence.addJob).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ mode: "local", quality: "good" }),
        tool: "PDF to Word",
      }),
    );

    word.remove();
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
    const excel = await mount("xlsx");
    await excel.handleFiles(asFileList([pdfFile("table.pdf")]));
    await excel.handleConvert();

    expect(mocks.localConverter.pdfToExcel).toHaveBeenCalled();
    expect(mocks.persistence.addJob).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ format: "xlsx", mode: "local", quality: "fair" }),
        tool: "PDF to Excel (Sheets)",
      }),
    );
  });

  it("handles local conversion failures and missing files", async () => {
    const component = await mount("docx");
    await component.handleConvert();
    expect(mocks.localConverter.pdfToWord).not.toHaveBeenCalled();

    await component.handleFiles(asFileList([pdfFile()]));
    mocks.localConverter.pdfToWord.mockResolvedValueOnce({
      data: null,
      quality: "poor",
      success: false,
      warnings: [],
    });

    await component.handleConvert();

    expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Error", type: "error" }),
    );

    await expect((component as any).getCachedPdfBytes.call({ selectedFile: null })).rejects.toThrow(
      "No file selected",
    );
  });

  it("runs cloud conversion with OCR, consent handling, and gateway failures", async () => {
    const component = await mount("docx");
    await component.handleFiles(asFileList([pdfFile()]));
    (component.querySelector("#ocrToggle") as HTMLInputElement).checked = true;
    (component.querySelector("#ocrToggle") as HTMLInputElement).dispatchEvent(new Event("change"));
    (component.querySelector("#modeCloudBtn") as HTMLButtonElement).click();

    await component.handleConvert();

    expect((window as any).ensureCloudConsent).toHaveBeenCalled();
    expect(mocks.cloudConversionService.convertFile).toHaveBeenCalledWith(
      expect.any(File),
      "docx",
      { ocr: true },
    );
    expect(mocks.persistence.addJob).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ mode: "cloud", ocr: true }),
      }),
    );

    (window as any).ensureCloudConsent = vi.fn().mockResolvedValue(false);
    mocks.cloudConversionService.convertFile.mockClear();
    await component.handleConvert();
    expect(mocks.cloudConversionService.convertFile).not.toHaveBeenCalled();

    delete (window as any).ensureCloudConsent;
    mocks.cloudConversionService.convertFile.mockRejectedValueOnce(new Error("gateway failed"));
    await component.handleConvert();
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Error", type: "error" }),
    );
  });
});
