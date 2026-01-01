import { beforeEach, describe, expect, it, vi } from "vitest";
import { BaseComponent } from "../../components/BaseComponent";

// Mock persistence
vi.mock("../../utils/persistence", () => ({
  persistence: {
    delete: vi.fn(),
    addJob: vi.fn().mockResolvedValue(1),
    clearSessions: vi.fn(),
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
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
    component = new TestComponent();
    document.body.appendChild(component);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

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
    it("should accept valid PDF files", () => {
      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      expect(component.validateFile(file)).toBe(true);
    });

    it("should reject non-PDF files", () => {
      const file = new File(["test"], "test.txt", { type: "text/plain" });
      expect(component.validateFile(file)).toBe(false);
    });

    it("should reject files over size limit", () => {
      const file = new File(["test"], "large.pdf", { type: "application/pdf" });
      Object.defineProperty(file, "size", { value: 200 * 1024 * 1024 });
      expect(component.validateFile(file)).toBe(false);
    });

    it("should reject null file", () => {
      expect(component.validateFile(null as any)).toBe(false);
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
  });

  describe("recordJob", () => {
    it("should call persistence.addJob", async () => {
      const { persistence } = await import("../../utils/persistence");
      const pdfBytes = new Uint8Array([1, 2, 3]);

      await component.recordJob("Test", "test.pdf", pdfBytes, { test: true });

      expect(persistence.addJob).toHaveBeenCalled();
    });
  });

  describe("getBackButton", () => {
    it("should render back button element", () => {
      const backSection = component.querySelector(".back-btn");
      expect(backSection).toBeTruthy();
    });
  });
});
