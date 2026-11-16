import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdfCompressor } from "../../components/PdfCompressor";
import { UserFacingError } from "../../utils/errorMapper";
import { compressPdf } from "../../utils/pdfCompression";
import { persistence } from "../../utils/persistence";

/** Writes a %PDF- header into a fixture's bytes so it passes the PDF header check. */
const withPdfHeader = (bytes: Uint8Array) => {
  bytes.set(new TextEncoder().encode("%PDF-1.7").subarray(0, bytes.length));
  return bytes;
};

const previewMocks = vi.hoisted(() => ({
  destroy: vi.fn().mockResolvedValue(undefined),
  getPdfPreviewErrorMessage: vi.fn(() => "Preview failed"),
  load: vi.fn().mockResolvedValue(undefined),
  next: vi.fn(),
  prev: vi.fn(),
  document: null as unknown,
}));

// Mock dependencies
vi.mock("../../utils/persistence", () => ({
  persistence: {
    delete: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../../utils/pdfCompression", () => ({
  compressPdf: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}));

vi.mock("../../utils/pdfPreview.ts", () => ({
  getPdfPreviewErrorMessage: previewMocks.getPdfPreviewErrorMessage,
  PdfPreviewController: class {
    destroy = previewMocks.destroy;
    load = previewMocks.load;
    next = previewMocks.next;
    prev = previewMocks.prev;
    get document() {
      return previewMocks.document;
    }
  },
}));

const asFileList = (files: File[]) => files as unknown as FileList;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const pdfFile = (name = "test.pdf", size = 12) =>
  new File([withPdfHeader(new Uint8Array(size))], name, { type: "application/pdf" });
/** A small PDF that reports `size` bytes, so size limits can be tested without allocating them. */
const pdfFileReportingSize = (name: string, size: number) => {
  const file = new File(["%PDF-1.7"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
};
const MB = 1024 * 1024;

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
    previewMocks.document = null;
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
    const file = new File(["%PDF-1.7\ntest content"], "test.pdf", { type: "application/pdf" });
    await component.handleFiles(asFileList([file]));

    expect(component.querySelector("#fileName")?.textContent).toBe("test.pdf");
    expect(component.querySelector("#mainLayout")?.classList.contains("hidden")).toBe(false);
    expect(persistence.set).toHaveBeenCalled();
  });

  it("should update target size when preset is changed", async () => {
    const file = new File([withPdfHeader(new Uint8Array(100 * 1024))], "test.pdf", {
      type: "application/pdf",
    });
    await component.handleFiles(asFileList([file]));

    const extremeBtn = component.querySelector('.preset-btn[data-ratio="0.1"]') as HTMLElement;
    extremeBtn.click();

    const targetSizeInput = component.querySelector("#targetSize") as HTMLInputElement;
    // 100KB * 0.1 = 10KB
    expect(targetSizeInput.value).toBe("10");
    expect(component.querySelector("#estSizeValue")?.textContent).toBe("10 KB");
  });

  it("should start compression and show success", async () => {
    const file = new File([withPdfHeader(new Uint8Array(100 * 1024))], "test.pdf", {
      type: "application/pdf",
    });
    await component.handleFiles(asFileList([file]));

    const _compressBtn = component.querySelector("#compressBtn") as HTMLButtonElement;
    vi.mocked(compressPdf).mockImplementationOnce(async (_file, _targetSizeKb, onProgress) => {
      onProgress(42, "Optimizing pages...");
      return new Uint8Array([1, 2, 3]);
    });
    await component.startCompression();

    expect(compressPdf).toHaveBeenCalledWith(
      expect.any(File),
      expect.any(Number),
      expect.any(Function),
      expect.objectContaining({ targetRatio: 0.4 }),
    );
    expect(component.querySelector("#percentText")?.textContent).toBe("42%");
    expect(component.querySelector("#statusText")?.textContent).toBe("Optimizing pages...");
    expect(persistence.addJob).toHaveBeenCalled();
    expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(false);
    expect(component.querySelector("#finalSizeValue")?.textContent).toBe("3 Bytes");
  });

  it("reuses the preview's open document instead of loading the file again", async () => {
    const previewDocument = { numPages: 1 };
    previewMocks.document = previewDocument;
    await component.handleFiles(asFileList([pdfFile("shared.pdf", 100 * 1024)]));

    await component.startCompression();

    expect(compressPdf).toHaveBeenCalledWith(
      expect.any(File),
      expect.any(Number),
      expect.any(Function),
      expect.objectContaining({ document: previewDocument }),
    );
  });

  describe("file size limit", () => {
    it.each([
      [140 * MB, "140 MB"],
      [1024 * MB, "1 GB"],
    ])("accepts a %i-byte file, above the general 100 MB limit", async (size, label) => {
      const dialog = document.getElementById("globalDialog") as any;

      await component.handleFiles(asFileList([pdfFileReportingSize("scan.pdf", size)]));

      expect(dialog.show).not.toHaveBeenCalled();
      expect(component.querySelector("#fileName")?.textContent).toBe("scan.pdf");
      expect(component.querySelector("#fileSize")?.textContent).toBe(label);
    });

    it("rejects files over 1 GB and says why", async () => {
      const dialog = document.getElementById("globalDialog") as any;

      await component.handleFiles(asFileList([pdfFileReportingSize("huge.pdf", 1536 * MB)]));

      expect(dialog.show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "This file is too large (1.5 GB). The maximum size is 1 GB.",
          type: "error",
        }),
      );
      expect(component.querySelector("#mainLayout")?.classList.contains("hidden")).toBe(true);
    });

    it("still rejects files that are not PDFs", async () => {
      const dialog = document.getElementById("globalDialog") as any;
      const notes = new File(["hello"], "notes.txt", { type: "text/plain" });

      await component.handleFiles(asFileList([notes]));

      expect(dialog.show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Invalid file type: text/plain. Expected: application/pdf",
          type: "error",
        }),
      );
      expect(component.querySelector("#mainLayout")?.classList.contains("hidden")).toBe(true);
    });
  });

  describe("preset buttons", () => {
    it("should have all preset buttons", () => {
      const presets = component.querySelectorAll(".preset-btn");
      expect(presets.length).toBeGreaterThanOrEqual(4);
    });

    it("should mark clicked preset as active", async () => {
      const file = new File([withPdfHeader(new Uint8Array(100 * 1024))], "test.pdf", {
        type: "application/pdf",
      });
      await component.handleFiles(asFileList([file]));

      const lightBtn = component.querySelector('.preset-btn[data-ratio="0.7"]') as HTMLElement;
      lightBtn.click();

      expect(lightBtn.classList.contains("active")).toBe(true);
    });

    it("should update target size based on preset ratio", async () => {
      const file = new File([withPdfHeader(new Uint8Array(200 * 1024))], "big.pdf", {
        type: "application/pdf",
      });
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
      const file = new File([withPdfHeader(new Uint8Array(50 * 1024))], "test.pdf", {
        type: "application/pdf",
      });
      await component.handleFiles(asFileList([file]));

      const fileName = component.querySelector("#fileName");
      expect(fileName?.textContent).toContain("test.pdf");
    });
  });

  describe("results display", () => {
    it("should show final size after compression", async () => {
      const file = new File(["%PDF-1.7\ntest"], "test.pdf", { type: "application/pdf" });
      await component.handleFiles(asFileList([file]));
      await component.startCompression();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const finalSize = component.querySelector("#finalSizeValue");
      expect(finalSize).toBeTruthy();
    });

    it("should show saved percentage", async () => {
      const file = new File(["%PDF-1.7\ntest"], "test.pdf", { type: "application/pdf" });
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

    it("does not execute HTML/JS embedded in a resumed filename (stored XSS regression)", async () => {
      const maliciousName = "<img src=x onerror=window.__resumeXss=1>.pdf";
      const savedFile = pdfFile(maliciousName);
      vi.mocked(persistence.get).mockResolvedValueOnce(savedFile);
      (window as any).__resumeXss = undefined;

      await component.checkExistingSession();

      const resumeBtn = component.querySelector("#resumeBtn") as HTMLElement;
      expect(resumeBtn.querySelector("img")).toBeNull();
      expect((window as any).__resumeXss).toBeUndefined();
      // Shown as typed: not run as markup and not escaped twice.
      expect(resumeBtn.textContent?.trim()).toBe(
        `Resume ${maliciousName} (${component.formatBytes(savedFile.size)})`,
      );
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
          message: "Preview failed",
          title: "Error",
          type: "error",
        }),
      );
    });

    it("names a known cause when the preview fails to load", async () => {
      const dialog = document.getElementById("globalDialog") as any;
      previewMocks.load.mockRejectedValueOnce(new Error("No password given"));

      await component.handleFiles(asFileList([pdfFile("locked.pdf")]));

      expect(dialog.show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "This PDF is password-protected. Please remove the password and try again.",
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

    it("caps custom targets below the original file size", async () => {
      await component.handleFiles(asFileList([pdfFile("large.pdf", 100 * 1024)]));

      (component.querySelector("#customPresetBtn") as HTMLButtonElement).click();

      const targetSizeInput = component.querySelector("#targetSize") as HTMLInputElement;
      const compressBtn = component.querySelector("#compressBtn") as HTMLButtonElement;
      const warning = component.querySelector("#qualityWarning") as HTMLElement;

      expect(targetSizeInput.max).toBe("100");

      targetSizeInput.value = "101";
      targetSizeInput.dispatchEvent(new Event("input"));
      await flush();

      expect(compressBtn.disabled).toBe(true);
      expect(warning.textContent).toContain("smaller than the original");

      await component.startCompression();
      expect(compressPdf).not.toHaveBeenCalled();
    });

    it("keeps the compress button off when a preset is chosen before any file", () => {
      (component.querySelector('.preset-btn[data-ratio="0.1"]') as HTMLButtonElement).click();

      expect((component.querySelector("#targetSize") as HTMLInputElement).value).toBe("");
      expect(component.querySelector("#estSizeInfo")?.classList.contains("hidden")).toBe(true);
      expect((component.querySelector("#compressBtn") as HTMLButtonElement).disabled).toBe(true);
    });

    it("compresses from the button and restores from the resume button", async () => {
      await component.handleFiles(asFileList([pdfFile("clicked.pdf", 64 * 1024)]));
      (component.querySelector("#compressBtn") as HTMLButtonElement).click();
      await flush();
      expect(compressPdf).toHaveBeenCalledTimes(1);

      const restore = vi.spyOn(component, "restoreSession").mockResolvedValue(undefined);
      (component.querySelector("#resumeBtn") as HTMLButtonElement).click();
      expect(restore).toHaveBeenCalledTimes(1);
    });

    it("keeps the running job's file when another file is picked mid-compression", async () => {
      await component.handleFiles(asFileList([pdfFile("first.pdf", 64 * 1024)]));
      let finish!: (bytes: Uint8Array) => void;
      vi.mocked(compressPdf).mockImplementationOnce(
        () => new Promise((resolve) => (finish = resolve)),
      );
      const dialog = document.getElementById("globalDialog") as any;

      const running = component.startCompression();
      await flush();
      previewMocks.load.mockClear();
      await component.handleFiles(asFileList([pdfFile("other.pdf", 8 * 1024)]));

      expect(dialog.show).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Compression in progress",
          message: "Wait for the current compression to finish before you open another file.",
        }),
      );
      expect(previewMocks.load).not.toHaveBeenCalled();
      expect(component.querySelector("#fileName")?.textContent).toBe("first.pdf");

      // A second start while running does nothing.
      await component.startCompression();
      expect(compressPdf).toHaveBeenCalledTimes(1);

      finish(new Uint8Array(1024));
      await running;

      expect(persistence.addJob).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: "first_compressed.pdf",
          metadata: expect.objectContaining({ originalSize: 64 * 1024 }),
        }),
      );
    });

    it("refuses to clear saved progress mid-compression", async () => {
      await component.handleFiles(asFileList([pdfFile("first.pdf", 64 * 1024)]));
      let finish!: (bytes: Uint8Array) => void;
      vi.mocked(compressPdf).mockImplementationOnce(
        () => new Promise((resolve) => (finish = resolve)),
      );
      const dialog = document.getElementById("globalDialog") as any;
      const running = component.startCompression();
      await flush();

      await component.clearFullStorage("pdf-compressor");

      expect(dialog.show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Wait for the current compression to finish before you clear saved progress.",
        }),
      );
      expect((component as any).selectedFile?.name).toBe("first.pdf");

      finish(new Uint8Array(1024));
      await running;
      expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(false);

      // Once it has finished, clearing works again.
      await component.clearFullStorage("pdf-compressor");
      expect((component as any).selectedFile).toBeNull();
    });

    it("closes the preview document when the tool closes or re-renders", () => {
      component.setupEventListeners();
      expect(previewMocks.destroy).toHaveBeenCalledTimes(1);

      component.remove();
      expect(previewMocks.destroy).toHaveBeenCalledTimes(2);
      expect((component as any).previewController).toBeNull();
    });

    it("returns early when compression starts without a selected file", async () => {
      await component.startCompression();

      expect(compressPdf).not.toHaveBeenCalled();
    });

    it.each([
      [new Error("engine unavailable"), "Compression failed. Please try again."],
      [
        new RangeError("Array buffer allocation failed"),
        "Compression failed. The file is too large or complex for your browser's memory. Try a smaller file.",
      ],
      [
        new UserFacingError("Your browser could not encode page 3."),
        "Compression failed. Your browser could not encode page 3.",
      ],
    ])("explains compression failures: %s", async (error, message) => {
      await component.handleFiles(asFileList([pdfFile("failure.pdf", 64 * 1024)]));
      const dialog = document.getElementById("globalDialog") as any;
      const compressBtn = component.querySelector("#compressBtn") as HTMLButtonElement;

      vi.mocked(compressPdf).mockRejectedValueOnce(error);
      await component.startCompression();

      expect(dialog.show).toHaveBeenCalledWith(
        expect.objectContaining({ message, title: "Error", type: "error" }),
      );
      expect(compressBtn.disabled).toBe(false);
    });
  });
});
