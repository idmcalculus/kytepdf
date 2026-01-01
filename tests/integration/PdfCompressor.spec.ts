import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdfCompressor } from "../../components/PdfCompressor";
import { compressPdf } from "../../utils/pdfEngine";
import { persistence } from "../../utils/persistence";

// Mock dependencies
vi.mock("../../utils/persistence", () => ({
  persistence: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    getJobs: vi.fn().mockResolvedValue([]),
    estimateUsage: vi.fn().mockResolvedValue(0),
    getStorageUsage: vi.fn().mockResolvedValue({ usage: 0, quota: 1000 }),
    addJob: vi.fn().mockResolvedValue(1),
  },
}));

vi.mock("../../utils/pdfConfig", () => ({
  pdfjsLib: {
    getDocument: vi.fn().mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
          render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
        }),
      }),
    }),
  },
}));

vi.mock("../../utils/pdfEngine", () => ({
  compressPdf: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}));

describe("PdfCompressor", () => {
  let component: PdfCompressor;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn();

    // Polyfill File/Blob.arrayBuffer for jsdom
    if (!File.prototype.arrayBuffer) {
      File.prototype.arrayBuffer = () => Promise.resolve(new ArrayBuffer(0));
    }

    component = new PdfCompressor();
    document.body.appendChild(component);
  });

  it("should render and show dropzone initially", () => {
    expect(component.querySelector("h1")?.textContent).toBe("Compress PDF");
    expect(component.querySelector("#dropZone")?.classList.contains("hidden")).toBe(false);
  });

  it("should handle file selection", async () => {
    const file = new File(["test content"], "test.pdf", { type: "application/pdf" });
    await component.handleFiles([file] as unknown as FileList);

    expect(component.querySelector("#fileName")?.textContent).toBe("test.pdf");
    expect(component.querySelector("#mainLayout")?.classList.contains("hidden")).toBe(false);
    expect(persistence.set).toHaveBeenCalled();
  });

  it("should update target size when preset is changed", async () => {
    const file = new File([new ArrayBuffer(100 * 1024)], "test.pdf", { type: "application/pdf" });
    await component.handleFiles([file] as unknown as FileList);

    const extremeBtn = component.querySelector('.preset-btn[data-ratio="0.1"]') as HTMLElement;
    extremeBtn.click();

    const targetSizeInput = component.querySelector("#targetSize") as HTMLInputElement;
    // 100KB * 0.1 = 10KB
    expect(targetSizeInput.value).toBe("10");
  });

  it("should start compression and show success", async () => {
    const file = new File(["test content"], "test.pdf", { type: "application/pdf" });
    await component.handleFiles([file] as unknown as FileList);

    const _compressBtn = component.querySelector("#compressBtn") as HTMLButtonElement;
    await component.startCompression();

    expect(compressPdf).toHaveBeenCalled();
    expect(persistence.addJob).toHaveBeenCalled();
    expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(false);
  });

  describe("preset buttons", () => {
    it("should have all preset buttons", () => {
      const presets = component.querySelectorAll(".preset-btn");
      expect(presets.length).toBeGreaterThanOrEqual(4);
    });

    it("should mark clicked preset as active", async () => {
      const file = new File([new ArrayBuffer(100 * 1024)], "test.pdf", { type: "application/pdf" });
      await component.handleFiles([file] as unknown as FileList);

      const lightBtn = component.querySelector('.preset-btn[data-ratio="0.7"]') as HTMLElement;
      lightBtn.click();

      expect(lightBtn.classList.contains("active")).toBe(true);
    });

    it("should update target size based on preset ratio", async () => {
      const file = new File([new ArrayBuffer(200 * 1024)], "big.pdf", { type: "application/pdf" });
      await component.handleFiles([file] as unknown as FileList);

      // Use an existing preset button
      const extremeBtn = component.querySelector('.preset-btn[data-ratio="0.1"]') as HTMLElement;
      if (extremeBtn) {
        extremeBtn.click();
        const targetSizeInput = component.querySelector("#targetSize") as HTMLInputElement;
        // 200KB * 0.1 = 20KB
        expect(targetSizeInput.value).toBe("20");
      }
    });
  });

  describe("compression controls", () => {
    it("should have compress button", () => {
      const btn = component.querySelector("#compressBtn");
      expect(btn).toBeTruthy();
    });

    it("should have target size input", () => {
      const input = component.querySelector("#targetSize");
      expect(input).toBeTruthy();
    });
  });

  describe("file info display", () => {
    it("should display file name after loading", async () => {
      const file = new File([new ArrayBuffer(50 * 1024)], "test.pdf", { type: "application/pdf" });
      await component.handleFiles([file] as unknown as FileList);

      const fileName = component.querySelector("#fileName");
      expect(fileName?.textContent).toContain("test.pdf");
    });
  });

  describe("results display", () => {
    it("should show final size after compression", async () => {
      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      await component.handleFiles([file] as unknown as FileList);
      await component.startCompression();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const finalSize = component.querySelector("#finalSizeValue");
      expect(finalSize).toBeTruthy();
    });

    it("should show saved percentage", async () => {
      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      await component.handleFiles([file] as unknown as FileList);
      await component.startCompression();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const savedPercent = component.querySelector("#savedPercentValue");
      expect(savedPercent).toBeTruthy();
    });
  });
});
