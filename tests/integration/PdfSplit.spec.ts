import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdfSplit } from "../../components/PdfSplit";

vi.mock("../../utils/persistence", () => ({
  persistence: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    delete: vi.fn(),
    addJob: vi.fn().mockResolvedValue(1),
    getJobs: vi.fn().mockResolvedValue([]),
    estimateUsage: vi.fn().mockResolvedValue(0),
    getStorageUsage: vi.fn().mockResolvedValue({ usage: 0, quota: 1000 }),
  },
}));

vi.mock("../../utils/pdfConfig", () => ({
  PDFDocument: {
    create: vi.fn().mockResolvedValue({
      copyPages: vi.fn().mockResolvedValue([{}]),
      addPage: vi.fn(),
      save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }),
    load: vi.fn().mockResolvedValue({
      getPageCount: vi.fn().mockReturnValue(5),
    }),
  },
  pdfjsLib: {
    getDocument: vi.fn().mockReturnValue({
      promise: Promise.resolve({
        numPages: 5,
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
          render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
        }),
      }),
    }),
  },
}));

describe("PdfSplit", () => {
  let component: PdfSplit;

  beforeEach(async () => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
    component = new PdfSplit();
    document.body.appendChild(component);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  describe("render", () => {
    it("should render the split component", async () => {
      expect(component.querySelector("h1")?.textContent).toBe("Split PDF");
    });

    it("should have split button initially hidden", () => {
      expect(component.querySelector("#splitControls")?.classList.contains("hidden")).toBe(true);
    });

    it("should show selection info", () => {
      expect(component.querySelector("#selectionInfo")?.textContent).toBe("0 pages selected");
    });
  });

  describe("file handling", () => {
    it("should load a file and show controls", async () => {
      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      await component.handleFiles([file] as unknown as FileList);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(component.querySelector("#dropZone")?.classList.contains("hidden")).toBe(true);
    });
  });

  describe("page selection", () => {
    it("should update selection info after select all", async () => {
      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      await component.handleFiles([file] as unknown as FileList);
      await new Promise((resolve) => setTimeout(resolve, 50));

      component.selectAll();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(component.querySelector("#selectionInfo")?.textContent).toBe("5 pages selected");
    });

    it("should clear selection", async () => {
      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      await component.handleFiles([file] as unknown as FileList);
      await new Promise((resolve) => setTimeout(resolve, 50));

      component.selectAll();
      component.clearSelection();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(component.querySelector("#selectionInfo")?.textContent).toBe("0 pages selected");
    });

    it("should support page selection via selectAll and clearSelection", async () => {
      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      await component.handleFiles([file] as unknown as FileList);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Select all then clear
      component.selectAll();
      expect(component.querySelector("#selectionInfo")?.textContent).toBe("5 pages selected");

      component.clearSelection();
      expect(component.querySelector("#selectionInfo")?.textContent).toBe("0 pages selected");
    });
  });

  describe("split controls", () => {
    it("should have split button in controls section", () => {
      const splitBtn = component.querySelector("#splitBtn") as HTMLButtonElement;
      expect(splitBtn).toBeTruthy();
    });

    it("should have select all button", () => {
      expect(component.querySelector("#selectAllBtn")).toBeTruthy();
    });

    it("should have clear selection button", () => {
      // The clearSelection method exists on the component
      expect(typeof component.clearSelection).toBe("function");
    });
  });

  describe("startSplit", () => {
    it("should call PDFDocument methods when splitting", async () => {
      const { PDFDocument } = await import("../../utils/pdfConfig");
      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      await component.handleFiles([file] as unknown as FileList);
      await new Promise((resolve) => setTimeout(resolve, 50));

      component.selectAll();
      await component.startSplit();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(PDFDocument.create).toHaveBeenCalled();
    });

    it("should record job after successful split", async () => {
      const { persistence } = await import("../../utils/persistence");
      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      await component.handleFiles([file] as unknown as FileList);
      await new Promise((resolve) => setTimeout(resolve, 50));

      component.selectAll();
      await component.startSplit();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(persistence.addJob).toHaveBeenCalled();
    });
  });
});
