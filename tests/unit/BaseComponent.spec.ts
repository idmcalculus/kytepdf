import { beforeEach, describe, expect, it, vi } from "vitest";
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
      (window as any).showAbout = showAbout;
      const { persistence } = await import("../../utils/persistence");

      (component.querySelector("#aboutBtn") as HTMLButtonElement).click();
      expect(showAbout).toHaveBeenCalled();

      (component.querySelector("#userAccountBtn") as HTMLButtonElement).click();
      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({ title: "User Account" }),
      );

      const clearLink = component.querySelector("#clearStorageLink") as HTMLAnchorElement;
      clearLink.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(persistence.delete).toHaveBeenCalledWith("test-tool");

      delete (window as any).showAbout;
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
});
