import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdfCompressor } from "../../components/PdfCompressor";
import { compressPdf } from "../../utils/pdfEngine";
import { persistence } from "../../utils/persistence";

const previewMocks = vi.hoisted(() => ({
  getPdfPreviewErrorMessage: vi.fn(() => "Preview failed"),
  load: vi.fn().mockResolvedValue(undefined),
  next: vi.fn(),
  prev: vi.fn(),
}));

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

vi.mock("../../utils/pdfPreview.ts", () => ({
  getPdfPreviewErrorMessage: previewMocks.getPdfPreviewErrorMessage,
  PdfPreviewController: class {
    load = previewMocks.load;
    next = previewMocks.next;
    prev = previewMocks.prev;
  },
}));

const asFileList = (files: File[]) => files as unknown as FileList;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const pdfFile = (name = "test.pdf", size = 12) =>
  new File([new Uint8Array(size)], name, { type: "application/pdf" });

describe("PdfCompressor", () => {
  let component: PdfCompressor;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(persistence.get).mockResolvedValue(null);
    vi.mocked(persistence.set).mockResolvedValue(undefined);
    vi.mocked(persistence.getJobs).mockResolvedValue([]);
    vi.mocked(persistence.estimateUsage).mockResolvedValue(0);
    vi.mocked(persistence.getStorageUsage).mockResolvedValue({ usage: 0, quota: 1000 });
    vi.mocked(persistence.addJob).mockResolvedValue(1);
    vi.mocked(compressPdf).mockResolvedValue(new Uint8Array([1, 2, 3]));
    previewMocks.load.mockResolvedValue(undefined);
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
    await component.handleFiles(asFileList([file]));

    expect(component.querySelector("#fileName")?.textContent).toBe("test.pdf");
    expect(component.querySelector("#mainLayout")?.classList.contains("hidden")).toBe(false);
    expect(persistence.set).toHaveBeenCalled();
  });

  it("should update target size when preset is changed", async () => {
    const file = new File([new ArrayBuffer(100 * 1024)], "test.pdf", { type: "application/pdf" });
    await component.handleFiles(asFileList([file]));

    const extremeBtn = component.querySelector('.preset-btn[data-ratio="0.1"]') as HTMLElement;
    extremeBtn.click();

    const targetSizeInput = component.querySelector("#targetSize") as HTMLInputElement;
    // 100KB * 0.1 = 10KB
    expect(targetSizeInput.value).toBe("10");
  });

  it("should start compression and show success", async () => {
    const file = new File(["test content"], "test.pdf", { type: "application/pdf" });
    await component.handleFiles(asFileList([file]));

    const _compressBtn = component.querySelector("#compressBtn") as HTMLButtonElement;
    vi.mocked(compressPdf).mockImplementationOnce(async (_file, _targetSizeKb, onProgress) => {
      onProgress(42, "Optimizing pages...");
      return new Uint8Array([1, 2, 3]);
    });
    await component.startCompression();

    expect(compressPdf).toHaveBeenCalled();
    expect(component.querySelector("#percentText")?.textContent).toBe("42%");
    expect(component.querySelector("#statusText")?.textContent).toBe("Optimizing pages...");
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
      await component.handleFiles(asFileList([file]));

      const lightBtn = component.querySelector('.preset-btn[data-ratio="0.7"]') as HTMLElement;
      lightBtn.click();

      expect(lightBtn.classList.contains("active")).toBe(true);
    });

    it("should update target size based on preset ratio", async () => {
      const file = new File([new ArrayBuffer(200 * 1024)], "big.pdf", { type: "application/pdf" });
      await component.handleFiles(asFileList([file]));

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
      await component.handleFiles(asFileList([file]));

      const fileName = component.querySelector("#fileName");
      expect(fileName?.textContent).toContain("test.pdf");
    });
  });

  describe("results display", () => {
    it("should show final size after compression", async () => {
      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      await component.handleFiles(asFileList([file]));
      await component.startCompression();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const finalSize = component.querySelector("#finalSizeValue");
      expect(finalSize).toBeTruthy();
    });

    it("should show saved percentage", async () => {
      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      await component.handleFiles(asFileList([file]));
      await component.startCompression();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const savedPercent = component.querySelector("#savedPercentValue");
      expect(savedPercent).toBeTruthy();
    });
  });

  describe("session and preview recovery", () => {
    it("shows a resume prompt when a saved compressor session exists", async () => {
      const savedFile = pdfFile("saved.pdf", 2048);
      vi.mocked(persistence.get).mockResolvedValueOnce(savedFile);

      await component.checkExistingSession();

      expect(component.querySelector("#resumeContainer")?.classList.contains("hidden")).toBe(false);
      expect(component.querySelector("#resumeBtn")?.textContent).toContain("Resume saved.pdf");

      vi.mocked(persistence.get).mockRejectedValueOnce(new Error("read failed"));
      await expect(component.checkExistingSession()).resolves.toBeUndefined();
    });

    it("restores a saved session and ignores missing or failed saved sessions", async () => {
      const savedFile = pdfFile("restored.pdf");
      const handleFiles = vi.spyOn(component, "handleFiles").mockResolvedValue(undefined);

      vi.mocked(persistence.get).mockResolvedValueOnce(savedFile);
      await component.restoreSession();

      expect(handleFiles).toHaveBeenCalledWith([savedFile]);

      handleFiles.mockClear();
      vi.mocked(persistence.get).mockResolvedValueOnce(null);
      await component.restoreSession();
      expect(handleFiles).not.toHaveBeenCalled();

      vi.mocked(persistence.get).mockRejectedValueOnce(new Error("read failed"));
      await expect(component.restoreSession()).resolves.toBeUndefined();
    });

    it("handles session save failures without interrupting the user flow", async () => {
      (component as any).selectedFile = pdfFile("autosave.pdf");
      vi.mocked(persistence.set).mockRejectedValueOnce(new Error("quota"));

      await expect(component.saveSession()).resolves.toBeUndefined();

      expect(persistence.set).toHaveBeenCalledWith("pdf-compressor", expect.any(File));
    });

    it("recreates the preview controller and reports preview load failures", async () => {
      const dialog = document.getElementById("globalDialog") as any;
      previewMocks.load.mockRejectedValueOnce(new Error("preview exploded"));
      (component as any).previewController = null;

      await component.handleFiles(asFileList([pdfFile("broken-preview.pdf")]));

      expect(previewMocks.load).toHaveBeenCalledWith(expect.any(File));
      expect(dialog.show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "An unexpected error occurred.",
          title: "Error",
          type: "error",
        }),
      );
    });

    it("wires preview navigation buttons to the controller", () => {
      (component.querySelector("#prevPage") as HTMLButtonElement).click();
      (component.querySelector("#nextPage") as HTMLButtonElement).click();

      expect(previewMocks.prev).toHaveBeenCalled();
      expect(previewMocks.next).toHaveBeenCalled();
    });
  });

  describe("custom target handling and compression failures", () => {
    it("shows custom size controls, disables empty custom submissions, and warns on aggressive targets", async () => {
      await component.handleFiles(asFileList([pdfFile("large.pdf", 100 * 1024)]));

      (component.querySelector("#customPresetBtn") as HTMLButtonElement).click();

      const targetSizeGroup = component.querySelector("#targetSizeGroup") as HTMLElement;
      const estSizeInfo = component.querySelector("#estSizeInfo") as HTMLElement;
      const targetSizeInput = component.querySelector("#targetSize") as HTMLInputElement;
      const compressBtn = component.querySelector("#compressBtn") as HTMLButtonElement;
      const warning = component.querySelector("#qualityWarning") as HTMLElement;

      expect(targetSizeGroup.classList.contains("hidden")).toBe(false);
      expect(estSizeInfo.classList.contains("hidden")).toBe(true);

      targetSizeInput.value = "";
      targetSizeInput.dispatchEvent(new Event("input"));
      expect(compressBtn.disabled).toBe(true);

      targetSizeInput.value = "5";
      targetSizeInput.dispatchEvent(new Event("input"));
      await flush();
      expect(warning.textContent).toContain("extremely low");

      targetSizeInput.value = "20";
      targetSizeInput.dispatchEvent(new Event("input"));
      await flush();
      expect(warning.textContent).toContain("noticeably reduced");

      targetSizeInput.value = "50";
      targetSizeInput.dispatchEvent(new Event("input"));
      await flush();
      expect(warning.classList.contains("hidden")).toBe(true);
    });

    it("returns early when compression starts without a selected file", async () => {
      await component.startCompression();

      expect(compressPdf).not.toHaveBeenCalled();
    });

    it("reports missing compressor output and thrown compression failures", async () => {
      await component.handleFiles(asFileList([pdfFile("failure.pdf", 64 * 1024)]));
      const dialog = document.getElementById("globalDialog") as any;

      vi.mocked(compressPdf).mockResolvedValueOnce(null as any);
      await component.startCompression();
      expect(dialog.show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "An unexpected error occurred.",
          title: "Error",
          type: "error",
        }),
      );

      dialog.show.mockClear();
      vi.mocked(compressPdf).mockRejectedValueOnce(new Error("engine unavailable"));
      await component.startCompression();
      expect(dialog.show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "An unexpected error occurred.",
          title: "Error",
          type: "error",
        }),
      );
    });
  });
});
