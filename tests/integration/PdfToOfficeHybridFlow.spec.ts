import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLocalConverter } = vi.hoisted(() => ({
  mockLocalConverter: {
    pdfToWord: vi.fn(),
    pdfToExcel: vi.fn(),
    pdfToWordFromEnvelope: vi.fn(),
    pdfToExcelFromEnvelope: vi.fn(),
  },
}));

vi.mock("../../utils/LocalConverter.ts", () => ({
  localConverter: mockLocalConverter,
}));

vi.mock("../../utils/pdfInspectorEngine.ts", () => ({
  PdfInspectorError: class PdfInspectorError extends Error {
    reason: string;
    constructor(failure: { reason: string; message: string }) {
      super(failure.message);
      this.name = "PdfInspectorError";
      this.reason = failure.reason;
    }
  },
  pdfInspectorEngine: {
    analyze: vi.fn().mockRejectedValue(new Error("unavailable in test")),
  },
}));

import { PdfToOffice } from "../../components/PdfToOffice";

const createPdfFile = () => new File(["%PDF-1.4 mock"], "sample.pdf", { type: "application/pdf" });

describe("PdfToOffice local conversion flow", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="main-container"></div><div id="globalDialog"></div>';
    const dialog = document.getElementById("globalDialog") as any;
    if (dialog) {
      dialog.show = vi.fn().mockResolvedValue(true);
    }
    mockLocalConverter.pdfToWord.mockReset();
    mockLocalConverter.pdfToExcel.mockReset();
    mockLocalConverter.pdfToWordFromEnvelope.mockReset();
    mockLocalConverter.pdfToExcelFromEnvelope.mockReset();
  });

  it("runs local conversion without cloud", async () => {
    mockLocalConverter.pdfToWord.mockResolvedValue({
      success: true,
      data: new Uint8Array([1, 2, 3]),
      quality: "good",
      warnings: [],
    });

    const el = new PdfToOffice("docx");
    document.getElementById("main-container")?.appendChild(el);
    (el as any).selectedFile = createPdfFile();

    expect(el.querySelector("#modeCloudBtn")).toBeNull();

    await (el as any).handleConvert();

    expect(mockLocalConverter.pdfToWord).toHaveBeenCalledTimes(1);
  });

  it("blocks unsupported local formats", async () => {
    const el = new PdfToOffice("pptx");
    document.getElementById("main-container")?.appendChild(el);
    (el as any).selectedFile = createPdfFile();

    await (el as any).handleConvert();

    expect(mockLocalConverter.pdfToWord).not.toHaveBeenCalled();
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Error", type: "error" }),
    );
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
