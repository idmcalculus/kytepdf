import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCloudService, mockLocalConverter } = vi.hoisted(() => ({
  mockLocalConverter: {
    pdfToWord: vi.fn(),
    pdfToExcel: vi.fn(),
  },
  mockCloudService: {
    convertFile: vi.fn(),
  },
}));

vi.mock("../../utils/LocalConverter.ts", () => ({
  localConverter: mockLocalConverter,
}));

vi.mock("../../utils/CloudConversionService.ts", () => ({
  cloudConversionService: mockCloudService,
}));

import { PdfToOffice } from "../../components/PdfToOffice";

const createPdfFile = () => new File(["%PDF-1.4 mock"], "sample.pdf", { type: "application/pdf" });

describe("PdfToOffice hybrid conversion flow", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="main-container"></div><div id="globalDialog"></div>';
    const dialog = document.getElementById("globalDialog") as any;
    if (dialog) {
      dialog.show = vi.fn().mockResolvedValue(true);
    }
    mockLocalConverter.pdfToWord.mockReset();
    mockLocalConverter.pdfToExcel.mockReset();
    mockCloudService.convertFile.mockReset();
    (window as any).ensureCloudConsent = vi.fn().mockResolvedValue(true);
  });

  it("selects local mode and runs local conversion", async () => {
    mockLocalConverter.pdfToWord.mockResolvedValue({
      success: true,
      data: new Uint8Array([1, 2, 3]),
      quality: "good",
      warnings: [],
    });

    const el = new PdfToOffice("docx");
    document.getElementById("main-container")?.appendChild(el);
    (el as any).selectedFile = createPdfFile();

    const modeCloudBtn = el.querySelector("#modeCloudBtn") as HTMLButtonElement;
    const modeLocalBtn = el.querySelector("#modeLocalBtn") as HTMLButtonElement;
    modeCloudBtn.click();
    modeLocalBtn.click();

    await (el as any).handleConvert();

    expect(mockLocalConverter.pdfToWord).toHaveBeenCalledTimes(1);
    expect(mockCloudService.convertFile).not.toHaveBeenCalled();
  });

  it("requests consent before cloud conversion", async () => {
    (window as any).ensureCloudConsent = vi.fn().mockResolvedValue(false);
    mockCloudService.convertFile.mockResolvedValue(new Uint8Array([9, 9, 9]));

    const el = new PdfToOffice("docx");
    document.getElementById("main-container")?.appendChild(el);
    (el as any).selectedFile = createPdfFile();

    const modeCloudBtn = el.querySelector("#modeCloudBtn") as HTMLButtonElement;
    modeCloudBtn.click();

    await (el as any).handleConvert();

    expect((window as any).ensureCloudConsent).toHaveBeenCalledTimes(1);
    expect(mockCloudService.convertFile).not.toHaveBeenCalled();
  });

  it("shows quality warning after poor local conversion", async () => {
    mockLocalConverter.pdfToWord.mockResolvedValue({
      success: true,
      data: new Uint8Array([7, 7, 7]),
      quality: "poor",
      warnings: ["Low text coverage."],
    });

    const el = new PdfToOffice("docx");
    document.getElementById("main-container")?.appendChild(el);
    (el as any).selectedFile = createPdfFile();

    await (el as any).handleConvert();

    const warning = el.querySelector("#qualityWarning") as HTMLElement;
    expect(warning.classList.contains("hidden")).toBe(false);
  });
});
