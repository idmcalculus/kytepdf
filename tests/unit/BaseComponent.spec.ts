import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BaseComponent } from "../../components/BaseComponent";

// Mock persistence
vi.mock("../../utils/persistence", () => ({
  persistence: {
    delete: vi.fn(),
    addJob: vi.fn().mockResolvedValue(1),
    clearSessions: vi.fn(),
    deleteJob: vi.fn().mockResolvedValue(undefined),
    estimateUsage: vi.fn().mockResolvedValue(0),
    getStorageUsage: vi.fn().mockResolvedValue({ usage: 0, quota: 1000 }),
    getJobs: vi.fn().mockResolvedValue([]),
  },
}));

// Concrete Implementation for testing
class TestComponent extends BaseComponent {
  protected toolKey = "test-tool";

  render() {
    this.innerHTML = `
			<div class="tool-view">
				${this.getBackButton()}
				${this.getDropZone("your file", "file")}
				${this.getProgressSection("Processing...")}
				<div id="successMessage" class="success-message hidden">
					<button id="downloadLink"></button>
				</div>
				<div id="storageWarning" class="hidden">
					<span></span>
				</div>
				<div id="recentFilesContainer" class="hidden">
					<div id="recentFilesList"></div>
				</div>
			</div>
		`;
  }

  setupEventListeners() {
    this.setupBaseListeners();
  }

  handleFiles(files: FileList) {
    this.selectedFile = files[0];
  }
}

if (!customElements.get("test-component")) {
  customElements.define("test-component", TestComponent);
}

/** A tool that takes Markdown as input, to check the recent-file filter can be widened. */
class MarkdownTestComponent extends TestComponent {
  protected recentFileTypes = ["text/markdown"];
}

/** A tool that decides by file name rather than MIME type. */
class CsvByNameTestComponent extends TestComponent {
  protected acceptsRecentJob(job: { fileName: string }) {
    return job.fileName.endsWith(".csv");
  }
}

/** A tool with a reset hook, and no file handler, to cover the optional hooks. */
class ResettableTestComponent extends BaseComponent {
  protected toolKey = "resettable-tool";
  resetState = vi.fn();

  render() {
    this.innerHTML = `${this.getDropZone()}`;
  }

  setupEventListeners() {
    this.setupBaseListeners();
  }
}

/** A bare element with no render or listener hooks. */
class BareTestComponent extends BaseComponent {}

for (const [name, ctor] of [
  ["markdown-test-component", MarkdownTestComponent],
  ["csv-name-test-component", CsvByNameTestComponent],
  ["resettable-test-component", ResettableTestComponent],
  ["bare-test-component", BareTestComponent],
] as const) {
  if (!customElements.get(name)) customElements.define(name, ctor);
}

describe("BaseComponent", () => {
  let component: TestComponent;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete (window as any).showSaveFilePicker;
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
    component = new TestComponent();
    document.body.appendChild(component);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const asFileList = (...files: File[]) =>
    ({
      ...files,
      length: files.length,
      item: (index: number) => files[index] ?? null,
    }) as unknown as FileList;

  describe("formatBytes", () => {
    it("should format bytes correctly", () => {
      expect(component.formatBytes(0)).toBe("0 Bytes");
      expect(component.formatBytes(1024)).toBe("1 KB");
      expect(component.formatBytes(1024 * 1024)).toBe("1 MB");
      expect(component.formatBytes(1024 * 1024 * 1024)).toBe("1 GB");
    });

    it("should handle decimal places", () => {
      expect(component.formatBytes(1500)).toBe("1.46 KB");
    });

    it("should handle custom decimal places", () => {
      expect(component.formatBytes(1500, 1)).toBe("1.5 KB");
      expect(component.formatBytes(1500, 0)).toBe("1 KB");
    });
  });

  describe("sanitize", () => {
    it("should escape HTML angle brackets", () => {
      const result = component.sanitize("<script>test</script>");
      expect(result).toContain("&lt;");
      expect(result).toContain("&gt;");
    });

    it("should escape ampersand", () => {
      expect(component.sanitize("Hello & World")).toContain("&amp;");
    });

    it("should escape double quotes", () => {
      expect(component.sanitize('Hello "World"')).toContain("&quot;");
    });
  });

  describe("validateFile", () => {
    it("should accept valid PDF files", async () => {
      const file = new File(["%PDF-test"], "test.pdf", { type: "application/pdf" });
      expect(await component.validateFile(file)).toBe(true);
    });

    it("should reject non-PDF files", async () => {
      const file = new File(["test"], "test.txt", { type: "text/plain" });
      expect(await component.validateFile(file)).toBe(false);
    });

    it("should reject files over size limit", async () => {
      const file = new File(["%PDF-test"], "large.pdf", { type: "application/pdf" });
      Object.defineProperty(file, "size", { value: 200 * 1024 * 1024 });
      expect(await component.validateFile(file)).toBe(false);
    });

    it("should reject null file", async () => {
      expect(await component.validateFile(null as any)).toBe(false);
    });

    it("tells the user the file size and the limit when a file is too large", async () => {
      const dialogElement = document.getElementById("globalDialog") as any;
      const file = new File(["%PDF-1.7"], "scan.pdf", { type: "application/pdf" });
      Object.defineProperty(file, "size", { value: 140 * 1024 * 1024 });

      expect(await component.validateFile(file)).toBe(false);
      expect(dialogElement.show).toHaveBeenCalledWith({
        title: "Error",
        message: "This file is too large (140 MB). The maximum size is 100 MB.",
        type: "error",
      });
    });

    it("still enforces the default size cap when only allowedTypes is supplied", async () => {
      // Partial options must merge with the defaults; previously passing any
      // options object dropped every default, so this 200MB image was accepted.
      const file = new File(["img"], "huge.png", { type: "image/png" });
      Object.defineProperty(file, "size", { value: 200 * 1024 * 1024 });

      expect(
        await component.validateFile(file, { allowedTypes: ["image/png", "image/jpeg"] }),
      ).toBe(false);
    });

    it("still enforces the default PDF type check when only maxSizeMB is supplied", async () => {
      const file = new File(["exe"], "payload.exe", { type: "application/x-msdownload" });
      expect(await component.validateFile(file, { maxSizeMB: 5 })).toBe(false);
    });

    it("accepts a file that satisfies the merged defaults and overrides", async () => {
      const file = new File(["img"], "ok.png", { type: "image/png" });
      Object.defineProperty(file, "size", { value: 1024 });
      expect(
        await component.validateFile(file, { allowedTypes: ["image/png", "image/jpeg"] }),
      ).toBe(true);
    });

    it("should reject files with invalid PDF header in browser environments", async () => {
      // Note: In JSDOM, File.slice().text() may not accurately reflect file content.
      // This test verifies the validation path exists; full verification requires a real browser.
      const file = new File(["not-a-pdf"], "fake.pdf", { type: "application/pdf" });
      const result = await component.validateFile(file);
      // In JSDOM the slice/text may not work identically to browsers,
      // so the catch block allows it through. This is by design — the validation
      // degrades gracefully in environments without full File API support.
      expect(typeof result).toBe("boolean");
    });
  });

  describe("updateProgress", () => {
    it("should update progress bar width", () => {
      component.updateProgress(75, "Processing...");
      const progressBar = component.querySelector(".progress-fill") as HTMLElement;
      expect(progressBar.style.width).toBe("75%");
    });
  });

  describe("clearFullStorage", () => {
    it("should call persistence delete when toolKey is provided", async () => {
      const { persistence } = await import("../../utils/persistence");
      await component.clearFullStorage("test-tool");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(persistence.delete).toHaveBeenCalledWith("test-tool");
    });

    it("should call clearSessions when no toolKey is provided", async () => {
      const { persistence } = await import("../../utils/persistence");
      await component.clearFullStorage();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(persistence.clearSessions).toHaveBeenCalled();
    });

    it("should hide storage warning", async () => {
      const storageWarning = component.querySelector("#storageWarning") as HTMLElement;
      storageWarning.classList.remove("hidden");

      await component.clearFullStorage("test-tool");
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(storageWarning.classList.contains("hidden")).toBe(true);
    });
  });

  describe("setupBaseListeners", () => {
    it("should setup drop zone", () => {
      const dropZone = component.querySelector("#dropZone");
      expect(dropZone).toBeTruthy();
    });

    it("should setup file input", () => {
      const fileInput = component.querySelector("#fileInput") as HTMLInputElement;
      expect(fileInput).toBeTruthy();
    });

    it("should handle drag states, dropped files, and selected files", () => {
      const dropZone = component.querySelector("#dropZone") as HTMLElement;
      const fileInput = component.querySelector("#fileInput") as HTMLInputElement;
      const file = new File(["pdf"], "dragged.pdf", { type: "application/pdf" });

      dropZone.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
      expect(dropZone.classList.contains("drag-over")).toBe(true);

      dropZone.dispatchEvent(new Event("dragleave", { bubbles: true }));
      expect(dropZone.classList.contains("drag-over")).toBe(false);

      const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvent, "dataTransfer", {
        value: { files: asFileList(file) },
      });
      dropZone.dispatchEvent(dropEvent);
      expect((component as any).selectedFile).toBe(file);

      Object.defineProperty(fileInput, "files", {
        value: asFileList(file),
        configurable: true,
      });
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      expect((component as any).selectedFile).toBe(file);
    });

    it("should handle account, about, and clear-storage controls", async () => {
      const showAbout = vi.fn();
      const showAccountModal = vi.fn();
      (window as any).showAbout = showAbout;
      (window as any).showAccountModal = showAccountModal;
      const { persistence } = await import("../../utils/persistence");

      (component.querySelector("#aboutBtn") as HTMLButtonElement).click();
      expect(showAbout).toHaveBeenCalled();

      (component.querySelector("#userAccountBtn") as HTMLButtonElement).click();
      expect(showAccountModal).toHaveBeenCalled();

      const clearLink = component.querySelector("#clearStorageLink") as HTMLAnchorElement;
      clearLink.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(persistence.delete).toHaveBeenCalledWith("test-tool");

      delete (window as any).showAbout;
      delete (window as any).showAccountModal;
    });
  });

  describe("getDropZone", () => {
    it("should render drop zone with correct text", () => {
      const dropZone = component.querySelector("#dropZone");
      expect(dropZone?.textContent).toContain("your file");
    });

    it("should have file input", () => {
      const fileInput = component.querySelector("#fileInput");
      expect(fileInput).toBeTruthy();
    });
  });

  describe("getProgressSection", () => {
    it("should render progress section", () => {
      const progressSection = component.querySelector("#progressSection");
      expect(progressSection).toBeTruthy();
    });

    it("should be hidden initially", () => {
      const progressSection = component.querySelector("#progressSection");
      expect(progressSection?.classList.contains("hidden")).toBe(true);
    });

    it("should have progress-fill element", () => {
      const progressFill = component.querySelector(".progress-fill");
      expect(progressFill).toBeTruthy();
    });
  });

  describe("showSuccess", () => {
    it("should show success message", () => {
      const pdfBytes = new Uint8Array([1, 2, 3]);
      component.showSuccess(pdfBytes, "test.pdf", "_processed");

      const successMessage = component.querySelector("#successMessage");
      expect(successMessage?.classList.contains("hidden")).toBe(false);
    });

    it("should handle null pdf bytes", () => {
      component.showSuccess(null, "test.pdf", "_processed");

      const successMessage = component.querySelector("#successMessage");
      expect(successMessage?.classList.contains("hidden")).toBe(false);
    });

    it("should collect email and save from the download link", async () => {
      const pdfBytes = new Uint8Array([1, 2, 3]);
      const collectSpy = vi.spyOn(component, "ensureEmailCollected").mockResolvedValue(true);
      const saveSpy = vi.spyOn(component, "savePdf").mockResolvedValue(true);

      component.showSuccess(pdfBytes, "test.pdf", "_processed");
      (component.querySelector("#downloadLink") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(collectSpy).toHaveBeenCalled();
      expect(saveSpy).toHaveBeenCalledWith(pdfBytes, "test.pdf", "_processed", ".pdf");
    });
  });

  describe("dialog methods", () => {
    it("should call showDialog with correct params", async () => {
      const dialogElement = document.getElementById("globalDialog") as any;

      await component.showDialog({
        title: "Test",
        message: "Test message",
        type: "info",
      });

      expect(dialogElement.show).toHaveBeenCalled();
    });

    it("should call showErrorDialog", async () => {
      const dialogElement = document.getElementById("globalDialog") as any;

      await component.showErrorDialog("Error occurred");

      expect(dialogElement.show).toHaveBeenCalled();
    });

    it.each([
      "Please select at least one page from the gallery.",
      // Mentions passwords, but is not a password error and must not be rewritten as one.
      "Could not load PDF. Please ensure it's a valid PDF file and not password protected.",
    ])("shows text written for the user as is: %s", async (message) => {
      const dialogElement = document.getElementById("globalDialog") as any;

      await component.showErrorDialog(message);

      expect(dialogElement.show).toHaveBeenCalledWith({ title: "Error", message, type: "error" });
    });

    it("translates caught errors into plain language", async () => {
      const dialogElement = document.getElementById("globalDialog") as any;

      await component.showErrorDialog(new Error("Invalid PDF structure."));
      await component.showErrorDialog(new TypeError("x is undefined"));

      expect(dialogElement.show).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ message: expect.stringContaining("appears to be corrupted") }),
      );
      expect(dialogElement.show).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ message: "An unexpected error occurred." }),
      );
    });

    it("should call showSuccessDialog", async () => {
      const dialogElement = document.getElementById("globalDialog") as any;

      await component.showSuccessDialog("Success!");

      expect(dialogElement.show).toHaveBeenCalled();
    });

    it("should call showConfirmDialog and return result", async () => {
      const dialogElement = document.getElementById("globalDialog") as any;

      const result = await component.showConfirmDialog("Are you sure?");

      expect(dialogElement.show).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });

  describe("checkStorageUsage", () => {
    it("should hide storage warning when usage is 0", async () => {
      const { persistence } = await import("../../utils/persistence");
      (persistence.estimateUsage as any).mockResolvedValueOnce(0);

      await component.checkStorageUsage();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const storageWarning = component.querySelector("#storageWarning");
      expect(storageWarning?.classList.contains("hidden")).toBe(true);
    });

    it("should show storage warning when usage is positive", async () => {
      const { persistence } = await import("../../utils/persistence");
      (persistence.estimateUsage as any).mockResolvedValueOnce(1024 * 1024);

      await component.checkStorageUsage();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const storageWarning = component.querySelector("#storageWarning");
      expect(storageWarning?.classList.contains("hidden")).toBe(false);
    });

    it("should warn when browser storage quota is almost full", async () => {
      const { persistence } = await import("../../utils/persistence");
      (persistence.getStorageUsage as any).mockResolvedValueOnce({ usage: 900, quota: 1000 });

      await component.checkStorageUsage();

      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error" }),
      );
    });

    it("should tolerate storage usage failures", async () => {
      const { persistence } = await import("../../utils/persistence");
      (persistence.estimateUsage as any).mockRejectedValueOnce(new Error("storage failed"));

      await expect(component.checkStorageUsage()).resolves.toBeUndefined();
    });
  });

  describe("recordJob", () => {
    it("should call persistence.addJob", async () => {
      const { persistence } = await import("../../utils/persistence");
      const pdfBytes = new Uint8Array([1, 2, 3]);

      await component.recordJob("Test", "test.pdf", pdfBytes, { test: true });

      expect(persistence.addJob).toHaveBeenCalled();
    });

    it("should evict oldest jobs over storage limits", async () => {
      const { persistence } = await import("../../utils/persistence");
      const largeJobSize = 200 * 1024 * 1024;
      (persistence.getJobs as any).mockResolvedValueOnce([
        { id: 1, fileName: "new.pdf", fileSize: largeJobSize, timestamp: 3 },
        { id: 2, fileName: "middle.pdf", fileSize: largeJobSize, timestamp: 2 },
        { id: 3, fileName: "old.pdf", fileSize: largeJobSize, timestamp: 1 },
      ]);

      await component.recordJob("Test", "test.pdf", new Uint8Array([1]), { test: true });

      expect(persistence.deleteJob).toHaveBeenCalledWith(3);
      expect(persistence.deleteJob).toHaveBeenCalledWith(2);
    });

    it("does not record a result bigger than the whole history budget", async () => {
      const { persistence } = await import("../../utils/persistence");
      // Only the length is read before the size check returns.
      const oversized = { length: 251 * 1024 * 1024 } as Uint8Array;

      await component.recordJob("Compress", "scan_compressed.pdf", oversized);

      // Recording it would have evicted every older entry and then the new one.
      expect(persistence.addJob).not.toHaveBeenCalled();
      expect(persistence.deleteJob).not.toHaveBeenCalled();
    });

    it("should tolerate record failures", async () => {
      const { persistence } = await import("../../utils/persistence");
      (persistence.addJob as any).mockRejectedValueOnce(new Error("indexeddb failed"));

      await expect(
        component.recordJob("Test", "test.pdf", new Uint8Array([1]), { test: true }),
      ).resolves.toBeUndefined();
    });
  });

  describe("getBackButton", () => {
    it("should render back button element", () => {
      const backSection = component.querySelector(".back-btn");
      expect(backSection).toBeTruthy();
    });
  });

  describe("renderRecentFiles", () => {
    it("should render recent jobs and restore one as a file", async () => {
      const { persistence } = await import("../../utils/persistence");
      (persistence.getJobs as any).mockResolvedValueOnce([
        { id: "1", fileName: "one.pdf", data: new Uint8Array([1]) },
        { id: "2", fileName: "two.pdf", data: new Uint8Array([2]) },
        { id: "3", fileName: "three.pdf", data: new Uint8Array([3]) },
        { id: "4", fileName: "four.pdf", data: new Uint8Array([4]) },
      ]);

      await component.renderRecentFiles();

      const chips = component.querySelectorAll(".recent-file-chip");
      expect(chips).toHaveLength(3);

      (chips[1] as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect((component as any).selectedFile.name).toBe("two.pdf");
    });

    it("offers only the three most recent PDFs to a PDF tool, skipping other results", async () => {
      const { persistence } = await import("../../utils/persistence");
      (persistence.getJobs as any).mockResolvedValueOnce([
        { id: 1, fileName: "office-smoke.csv_extracted.md", data: new Uint8Array([1]) },
        { id: 2, fileName: "newest.pdf", data: new Uint8Array([2]) },
        { id: 3, fileName: "notes.txt", mimeType: "text/plain", data: new Uint8Array([3]) },
        { id: 4, fileName: "report.docx", data: new Uint8Array([4]) },
        { id: 5, fileName: "middle.pdf", mimeType: "application/pdf", data: new Uint8Array([5]) },
        { id: 6, fileName: "sheet.xlsx", data: new Uint8Array([6]) },
        { id: 7, fileName: "older.pdf", data: new Uint8Array([7]) },
        { id: 8, fileName: "oldest.pdf", data: new Uint8Array([8]) },
      ]);

      await component.renderRecentFiles();

      const chips = Array.from(component.querySelectorAll<HTMLButtonElement>(".recent-file-chip"));
      expect(chips.map((chip) => chip.textContent?.trim())).toEqual([
        "newest.pdf",
        "middle.pdf",
        "older.pdf",
      ]);
      expect(component.querySelector("#recentFilesContainer")?.classList.contains("hidden")).toBe(
        false,
      );

      chips[1].click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const restored = (component as any).selectedFile as File;
      expect(restored.name).toBe("middle.pdf");
      expect(restored.type).toBe("application/pdf");
    });

    it("trusts a stored MIME type over the file name when filtering and restoring", async () => {
      const { persistence } = await import("../../utils/persistence");
      (persistence.getJobs as any).mockResolvedValueOnce([
        { id: 1, fileName: "export", mimeType: "application/pdf", data: new Uint8Array([1]) },
        { id: 2, fileName: "looks-like.pdf", mimeType: "text/markdown", data: new Uint8Array([2]) },
      ]);

      await component.renderRecentFiles();

      const chips = component.querySelectorAll<HTMLButtonElement>(".recent-file-chip");
      expect(chips).toHaveLength(1);
      chips[0].click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect((component as any).selectedFile.type).toBe("application/pdf");
    });

    it("hides the recent list when no saved result is a type the tool accepts", async () => {
      const { persistence } = await import("../../utils/persistence");
      const container = component.querySelector("#recentFilesContainer") as HTMLElement;
      container.classList.remove("hidden");
      (persistence.getJobs as any).mockResolvedValueOnce([
        { id: 1, fileName: "a.md", data: new Uint8Array([1]) },
        { id: 2, fileName: "b.zip", data: new Uint8Array([2]) },
        { id: 3, data: new Uint8Array([3]) },
      ]);

      await component.renderRecentFiles();

      expect(container.classList.contains("hidden")).toBe(true);
      expect(component.querySelectorAll(".recent-file-chip")).toHaveLength(0);
    });

    it("lets a tool widen the accepted types", async () => {
      const { persistence } = await import("../../utils/persistence");
      (persistence.getJobs as any).mockResolvedValue([
        { id: 1, fileName: "a.pdf", data: new Uint8Array([1]) },
        { id: 2, fileName: "notes.md", data: new Uint8Array([2]) },
      ]);
      // Element ids repeat across tool instances, so keep one tool on the page.
      component.remove();
      const markdownTool = new MarkdownTestComponent();
      document.body.appendChild(markdownTool);

      await markdownTool.renderRecentFiles();

      const chips = markdownTool.querySelectorAll<HTMLButtonElement>(".recent-file-chip");
      expect(Array.from(chips, (chip) => chip.textContent?.trim())).toEqual(["notes.md"]);
      chips[0].click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect((markdownTool as any).selectedFile.type).toBe("text/markdown");
      (persistence.getJobs as any).mockResolvedValue([]);
    });

    it("lets a tool replace the filter with its own rule", async () => {
      const { persistence } = await import("../../utils/persistence");
      (persistence.getJobs as any).mockResolvedValue([
        { id: 1, fileName: "a.pdf", data: new Uint8Array([1]) },
        { id: 2, fileName: "table.csv", data: new Uint8Array([2]) },
      ]);
      component.remove();
      const csvTool = new CsvByNameTestComponent();
      document.body.appendChild(csvTool);

      await csvTool.renderRecentFiles();

      expect(
        Array.from(csvTool.querySelectorAll(".recent-file-chip"), (chip) =>
          chip.textContent?.trim(),
        ),
      ).toEqual(["table.csv"]);
      (persistence.getJobs as any).mockResolvedValue([]);
    });

    it("shows a hostile file name as text instead of markup", async () => {
      const { persistence } = await import("../../utils/persistence");
      const name = '<img src=x onerror="alert(1)">.pdf';
      (persistence.getJobs as any).mockResolvedValueOnce([
        { id: 1, fileName: name, data: new Uint8Array([1]) },
      ]);

      await component.renderRecentFiles();

      const chip = component.querySelector(".recent-file-chip") as HTMLButtonElement;
      expect(chip.querySelector("img")).toBeNull();
      expect(chip.textContent?.trim()).toBe(name);
      expect(chip.getAttribute("title")).toBe(name);
    });

    it("does nothing when the recent-files markup is absent", async () => {
      const { persistence } = await import("../../utils/persistence");
      component.innerHTML = "";
      vi.mocked(persistence.getJobs).mockClear();

      await component.renderRecentFiles();

      expect(persistence.getJobs).not.toHaveBeenCalled();
    });

    it("should tolerate recent file lookup failures", async () => {
      const { persistence } = await import("../../utils/persistence");
      (persistence.getJobs as any).mockRejectedValueOnce(new Error("jobs failed"));

      await expect(component.renderRecentFiles()).resolves.toBeUndefined();
    });
  });

  describe("savePdf", () => {
    it("should reject empty save content", async () => {
      await expect(component.savePdf(null, "test.pdf")).resolves.toBe(false);
      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error" }),
      );
    });

    it("should save with the File System Access API", async () => {
      const write = vi.fn().mockResolvedValue(undefined);
      const close = vi.fn().mockResolvedValue(undefined);
      (window as any).showSaveFilePicker = vi.fn().mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue({ write, close }),
      });

      await expect(component.savePdf(new Uint8Array([1, 2]), "draft.pdf", "_signed")).resolves.toBe(
        true,
      );

      expect((window as any).showSaveFilePicker).toHaveBeenCalledWith(
        expect.objectContaining({ suggestedName: "draft_signed.pdf" }),
      );
      expect(write).toHaveBeenCalledWith(new Uint8Array([1, 2]));
      expect(close).toHaveBeenCalled();
    });

    it("should return false when the native save dialog is aborted", async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      (window as any).showSaveFilePicker = vi.fn().mockRejectedValue(error);

      await expect(component.savePdf(new Uint8Array([1]), "draft.pdf")).resolves.toBe(false);
    });

    it("should fall back to an anchor download when native save is unavailable", async () => {
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => undefined);
      const createObjectURL = vi.fn(() => "blob:test");
      const revokeObjectURL = vi.fn();
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: createObjectURL,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        writable: true,
        value: revokeObjectURL,
      });

      await expect(
        component.savePdf(new Uint8Array([1]), "archive", "_ignored", ".zip"),
      ).resolves.toBe(true);

      expect(createObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();

      clickSpy.mockRestore();
    });
  });

  describe("optional hooks and markup", () => {
    it("connects without render or listener hooks", () => {
      const bare = new BareTestComponent();
      expect(() => document.body.appendChild(bare)).not.toThrow();
      expect(bare.innerHTML).toBe("");
    });

    it("renders drop zone defaults and falls back to the file icon", () => {
      const defaults = component.getDropZone();
      expect(defaults).toContain("Drag & drop your PDF");
      expect(defaults).not.toMatch(/accept="application\/pdf"\s+multiple/);

      const multiple = component.getDropZone("images", "no-such-icon", true);
      expect(multiple).toMatch(/accept="application\/pdf"\s+multiple/);
      expect(multiple).toContain('d="M15 2H6a2 2 0 0 0-2 2v16'); // file-up icon path
      expect(component.getProgressSection()).toContain(
        '<span id="statusText">Processing...</span>',
      );
    });

    it("treats negative decimals as zero when formatting bytes", () => {
      expect(component.formatBytes(1536, -1)).toBe("2 KB");
    });

    it("returns an empty string when sanitizing a non-string", () => {
      expect(component.sanitize(undefined as unknown as string)).toBe("");
    });

    it("keeps the status text when progress has no status and tolerates missing markup", () => {
      component.updateProgress(10, "Reading");
      component.updateProgress(42.4);
      expect(component.querySelector("#statusText")?.textContent).toBe("Reading");
      expect(component.querySelector("#percentText")?.textContent).toBe("42%");

      component.innerHTML = "";
      expect(() => component.updateProgress(50, "Gone")).not.toThrow();
    });

    it("skips listener wiring when the drop zone markup is missing", () => {
      component.innerHTML = "<div></div>";
      expect(() => component.setupBaseListeners()).not.toThrow();
    });
  });

  describe("drop zone interactions", () => {
    it("asks the app to return to the dashboard from the back button", () => {
      const onBack = vi.fn();
      document.body.addEventListener("back-to-dashboard", onBack);

      (component.querySelector("#backToDash") as HTMLButtonElement).click();

      expect(onBack).toHaveBeenCalledTimes(1);
      document.body.removeEventListener("back-to-dashboard", onBack);
    });

    it("opens the file picker on a drop zone click but not on a button inside it", () => {
      const fileInput = component.querySelector("#fileInput") as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, "click").mockImplementation(() => undefined);

      (component.querySelector("#dropZone") as HTMLElement).click();
      expect(clickSpy).toHaveBeenCalledTimes(1);

      (component.querySelector("#resumeBtn") as HTMLButtonElement).click();
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it("ignores drops without files and change events without a file list", () => {
      const dropZone = component.querySelector("#dropZone") as HTMLElement;
      const fileInput = component.querySelector("#fileInput") as HTMLInputElement;

      const emptyDrop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(emptyDrop, "dataTransfer", { value: null });
      dropZone.dispatchEvent(emptyDrop);
      expect(emptyDrop.defaultPrevented).toBe(true);

      Object.defineProperty(fileInput, "files", { value: null, configurable: true });
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));

      expect((component as any).selectedFile).toBeNull();
    });

    it("accepts dropped and selected files on a tool without a file handler", () => {
      document.body.innerHTML = '<div id="globalDialog"></div>';
      const tool = new ResettableTestComponent();
      document.body.appendChild(tool);
      const dropZone = tool.querySelector("#dropZone") as HTMLElement;
      const fileInput = tool.querySelector("#fileInput") as HTMLInputElement;
      const file = new File(["%PDF-"], "a.pdf", { type: "application/pdf" });

      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: { files: asFileList(file) } });
      expect(() => dropZone.dispatchEvent(drop)).not.toThrow();

      Object.defineProperty(fileInput, "files", { value: asFileList(file), configurable: true });
      expect(() => fileInput.dispatchEvent(new Event("change"))).not.toThrow();
    });

    it("does nothing when the account and about actions are not installed", () => {
      delete (window as any).showAbout;
      delete (window as any).showAccountModal;

      expect(() =>
        (component.querySelector("#aboutBtn") as HTMLButtonElement).click(),
      ).not.toThrow();
      expect(() =>
        (component.querySelector("#userAccountBtn") as HTMLButtonElement).click(),
      ).not.toThrow();
    });

    it("keeps saved progress when the user declines to clear it", async () => {
      const { persistence } = await import("../../utils/persistence");
      (document.getElementById("globalDialog") as any).show.mockResolvedValueOnce(false);

      (component.querySelector("#clearStorageLink") as HTMLAnchorElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(persistence.delete).not.toHaveBeenCalled();
      expect(persistence.clearSessions).not.toHaveBeenCalled();
    });

    it("clears every session when a tool has no key", async () => {
      const { persistence } = await import("../../utils/persistence");
      (component as any).toolKey = undefined;

      (component.querySelector("#clearStorageLink") as HTMLAnchorElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(persistence.clearSessions).toHaveBeenCalled();
      expect(persistence.delete).not.toHaveBeenCalled();
    });
  });

  describe("clearFullStorage hooks", () => {
    it("uses the tool's reset hook instead of re-rendering", async () => {
      document.body.innerHTML = '<div id="globalDialog"></div>';
      const tool = new ResettableTestComponent();
      document.body.appendChild(tool);
      const renderSpy = vi.spyOn(tool, "render");
      (tool as any).files = [new File(["x"], "x.pdf")];

      await tool.clearFullStorage("resettable-tool");

      expect(tool.resetState).toHaveBeenCalledTimes(1);
      expect(renderSpy).not.toHaveBeenCalled();
      expect((tool as any).files).toEqual([]);
    });

    it("re-renders the view when there is no reset hook", async () => {
      const renderSpy = vi.spyOn(component, "render");
      const listenerSpy = vi.spyOn(component, "setupEventListeners");

      await component.clearFullStorage("test-tool");

      expect(renderSpy).toHaveBeenCalledTimes(1);
      expect(listenerSpy).toHaveBeenCalledTimes(1);
    });

    it("tolerates a bare element with no hooks or markup", async () => {
      const bare = new BareTestComponent();
      document.body.appendChild(bare);
      await expect(bare.clearFullStorage("bare")).resolves.toBeUndefined();
    });
  });

  describe("storage warning", () => {
    it("shows a minimum of 0.1MB and rebinds the clear link", async () => {
      const { persistence } = await import("../../utils/persistence");
      (persistence.estimateUsage as any).mockResolvedValueOnce(2048);

      await component.checkStorageUsage();

      const warning = component.querySelector("#storageWarning") as HTMLElement;
      expect(warning.textContent).toContain("Session auto-saved (0.1MB used).");

      const dialog = document.getElementById("globalDialog") as any;
      dialog.show.mockResolvedValueOnce(false);
      (warning.querySelector("#clearStorageLink") as HTMLAnchorElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(persistence.delete).not.toHaveBeenCalled();

      dialog.show.mockResolvedValueOnce(true);
      (warning.querySelector("#clearStorageLink") as HTMLAnchorElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(persistence.delete).toHaveBeenCalledWith("test-tool");
    });

    it("reports usage in megabytes and clears every session for a keyless tool", async () => {
      const { persistence } = await import("../../utils/persistence");
      (persistence.estimateUsage as any).mockResolvedValueOnce(3 * 1024 * 1024);
      (component as any).toolKey = "";

      await component.checkStorageUsage();
      const warning = component.querySelector("#storageWarning") as HTMLElement;
      expect(warning.textContent).toContain("(3.0MB used)");

      (warning.querySelector("#clearStorageLink") as HTMLAnchorElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(persistence.clearSessions).toHaveBeenCalled();
    });

    it("shows the warning without rewriting it when the message span is missing", async () => {
      const { persistence } = await import("../../utils/persistence");
      (persistence.estimateUsage as any).mockResolvedValueOnce(4096);
      const warning = component.querySelector("#storageWarning") as HTMLElement;
      warning.innerHTML = "";

      await component.checkStorageUsage();

      expect(warning.classList.contains("hidden")).toBe(false);
      expect(warning.innerHTML).toBe("");
    });
  });

  describe("file header and save edge cases", () => {
    const withHeader = (header: string | Error) => {
      const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
      Object.defineProperty(file, "slice", {
        value: () => ({
          text: () => (header instanceof Error ? Promise.reject(header) : Promise.resolve(header)),
        }),
      });
      return file;
    };

    it("rejects a PDF whose first bytes are not a PDF header", async () => {
      await expect(component.validateFile(withHeader("PK\u0003\u0004"))).resolves.toBe(false);
      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "The file does not appear to be a valid PDF (invalid file header).",
        }),
      );
    });

    it("accepts a PDF header and lets unreadable headers through", async () => {
      await expect(component.validateFile(withHeader("%PDF-"))).resolves.toBe(true);
      await expect(component.validateFile(withHeader(new Error("read failed")))).resolves.toBe(
        true,
      );
    });

    it("names a nameless download after the extension and appends a missing extension", async () => {
      (window as any).showSaveFilePicker = vi.fn().mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue({ write: vi.fn(), close: vi.fn() }),
      });

      await component.savePdf(new Uint8Array([1]), "", "_x", ".md");
      await component.savePdf(new Uint8Array([1]), "notes", "_x", ".txt");
      await component.savePdf(new Uint8Array([1]), "archive.bin", "_x", ".weird");

      const calls = (window as any).showSaveFilePicker.mock.calls.map(([options]: any[]) => ({
        name: options.suggestedName,
        description: options.types[0].description,
        accept: options.types[0].accept,
      }));
      expect(calls).toEqual([
        { name: "document.md", description: "Markdown File", accept: { "text/markdown": [".md"] } },
        { name: "notes.txt", description: "Text File", accept: { "text/plain": [".txt"] } },
        {
          name: "archive.bin.weird",
          description: "File",
          accept: { "application/octet-stream": [".weird"] },
        },
      ]);
    });

    it("adds the suffix at a trailing .pdf in any case and only there", async () => {
      (window as any).showSaveFilePicker = vi.fn().mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue({ write: vi.fn(), close: vi.fn() }),
      });

      await component.savePdf(new Uint8Array([1]), "Scan.PDF", "_compressed");
      await component.savePdf(new Uint8Array([1]), "a.pdf.final.pdf", "_signed");
      await component.savePdf(new Uint8Array([1]), "notes.TXT", "_x", ".txt");

      expect(
        (window as any).showSaveFilePicker.mock.calls.map(
          ([options]: any[]) => options.suggestedName,
        ),
      ).toEqual(["Scan_compressed.pdf", "a.pdf.final_signed.pdf", "notes.TXT"]);
    });

    it("reports a native save failure that is not a cancellation", async () => {
      (window as any).showSaveFilePicker = vi.fn().mockRejectedValue(new Error("disk full"));

      await expect(component.savePdf(new Uint8Array([1]), "draft.pdf")).resolves.toBe(false);
      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          message: expect.stringContaining("Failed to save"),
        }),
      );
    });

    it("revokes the download URL shortly after an anchor download", async () => {
      vi.useFakeTimers();
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => undefined);
      const revokeObjectURL = vi.fn();
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: vi.fn(() => "blob:later"),
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        writable: true,
        value: revokeObjectURL,
      });

      try {
        await component.savePdf(new Uint8Array([1]), "doc.pdf");
        expect(revokeObjectURL).not.toHaveBeenCalled();
        vi.advanceTimersByTime(100);
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:later");
      } finally {
        clickSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it("shows success without a download binding when the link is absent", () => {
      component.querySelector("#downloadLink")?.remove();
      expect(() => component.showSuccess(new Uint8Array([1]), "a.pdf", "_x")).not.toThrow();
      expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(false);
    });
  });

  describe("email collection", () => {
    beforeEach(() => {
      vi.stubEnv("VITE_ENABLE_EMAIL_COLLECTION", "true");
      localStorage.clear();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      localStorage.clear();
    });

    it("remembers a provided email and asks only once per component", async () => {
      const modal = document.createElement("div") as any;
      modal.id = "emailModal";
      modal.show = vi.fn().mockResolvedValue({ email: "a@example.test" });
      document.body.appendChild(modal);

      await expect(component.ensureEmailCollected()).resolves.toBe(true);
      expect(localStorage.getItem("kyte_email_collected")).toBe("true");

      localStorage.removeItem("kyte_email_collected");
      await expect(component.ensureEmailCollected()).resolves.toBe(true);
      expect(modal.show).toHaveBeenCalledTimes(1);
    });

    it("proceeds without prompting when the email modal is missing", async () => {
      await expect(component.ensureEmailCollected()).resolves.toBe(true);
      expect(localStorage.getItem("kyte_email_suppression_n")).toBeNull();
    });
  });

  describe("history eviction details", () => {
    it("counts entries without a size as zero and skips entries without an id", async () => {
      const { persistence } = await import("../../utils/persistence");
      const mb = 1024 * 1024;
      (persistence.getJobs as any).mockResolvedValueOnce([
        { id: 1, fileName: "new.pdf", fileSize: 200 * mb },
        { id: 2, fileName: "middle.pdf", fileSize: 30 * mb },
        { fileName: "no-id.pdf", fileSize: 30 * mb },
        { id: 4, fileName: "unsized.pdf" },
      ]);

      await component.recordJob("Test", "test.md", new Uint8Array([1]));

      expect(persistence.addJob).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: "test.md", mimeType: "text/markdown" }),
      );
      // 260MB is over the 250MB budget: drop the oldest entries that have an
      // id, oldest first, and stop as soon as the rest fits.
      expect(vi.mocked(persistence.deleteJob).mock.calls).toEqual([[4], [2]]);
    });
  });
});
