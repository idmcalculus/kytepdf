import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdfMerge } from "../../components/PdfMerge";

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
      getPageCount: vi.fn().mockReturnValue(2),
    }),
    load: vi.fn().mockResolvedValue({
      getPageIndices: vi.fn().mockReturnValue([0]),
    }),
  },
  pdfjsLib: {
    getDocument: vi.fn().mockReturnValue({
      promise: Promise.resolve({ numPages: 1 }),
    }),
  },
}));

describe("PdfMerge", () => {
  let component: PdfMerge;

  beforeEach(async () => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
    component = new PdfMerge();
    document.body.appendChild(component);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const asFileList = (...files: File[]) =>
    ({
      ...files,
      length: files.length,
      item: (index: number) => files[index] ?? null,
    }) as unknown as FileList;

  const loadFiles = async (...files: File[]) => {
    component.handleFiles(asFileList(...files));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("should render the merge component", async () => {
    expect(component.querySelector("h1")?.textContent).toBe("Merge PDF");
  });

  it("should handle file selection", async () => {
    const files = [
      new File(["f1"], "f1.pdf", { type: "application/pdf" }),
      new File(["f2"], "f2.pdf", { type: "application/pdf" }),
    ];
    await component.handleFiles(files as unknown as FileList);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(component.querySelectorAll(".file-list-item").length).toBe(2);
  });

  it("should trigger add-more file input and ignore invalid selections", async () => {
    const fileInput = component.querySelector("#fileInput") as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, "click");

    (component.querySelector("#addMoreBtn") as HTMLButtonElement).click();
    expect(clickSpy).toHaveBeenCalled();

    component.handleFiles(asFileList(new File(["txt"], "notes.txt", { type: "text/plain" })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(component.querySelectorAll(".file-list-item")).toHaveLength(0);
  });

  it("should disable merge button with less than 2 files", async () => {
    const files = [new File(["f1"], "f1.pdf", { type: "application/pdf" })];
    await component.handleFiles(files as unknown as FileList);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const mergeBtn = component.querySelector("#mergeBtn") as HTMLButtonElement;
    expect(mergeBtn.disabled).toBe(true);
  });

  it("should enable merge button with 2+ files", async () => {
    const files = [
      new File(["f1"], "f1.pdf", { type: "application/pdf" }),
      new File(["f2"], "f2.pdf", { type: "application/pdf" }),
    ];
    await component.handleFiles(files as unknown as FileList);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const mergeBtn = component.querySelector("#mergeBtn") as HTMLButtonElement;
    expect(mergeBtn.disabled).toBe(false);
  });

  it("should move files up/down in list", async () => {
    const files = [
      new File(["f1"], "first.pdf", { type: "application/pdf" }),
      new File(["f2"], "second.pdf", { type: "application/pdf" }),
    ];
    await component.handleFiles(files as unknown as FileList);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Move first file down
    component.moveFile(0, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const fileNames = Array.from(component.querySelectorAll(".file-name")).map(
      (el) => el.textContent,
    );
    expect(fileNames[0]).toBe("second.pdf");
    expect(fileNames[1]).toBe("first.pdf");
  });

  it("should wire merge, resume, move, and remove buttons", async () => {
    const files = [
      new File(["f1"], "first.pdf", { type: "application/pdf" }),
      new File(["f2"], "second.pdf", { type: "application/pdf" }),
      new File(["f3"], "third.pdf", { type: "application/pdf" }),
    ];
    await loadFiles(...files);

    const mergeSpy = vi.spyOn(component, "startMerge").mockResolvedValue(undefined);
    const restoreSpy = vi.spyOn(component, "restoreSession").mockResolvedValue(undefined);

    (component.querySelector("#mergeBtn") as HTMLButtonElement).click();
    (component.querySelector("#resumeBtn") as HTMLButtonElement).click();
    (component.querySelectorAll(".move-down")[0] as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    (component.querySelectorAll(".move-up")[1] as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    (component.querySelector(".remove") as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mergeSpy).toHaveBeenCalled();
    expect(restoreSpy).toHaveBeenCalled();
    expect(component.querySelectorAll(".file-list-item")).toHaveLength(2);
  });

  it("should remove files from list", async () => {
    const files = [
      new File(["f1"], "f1.pdf", { type: "application/pdf" }),
      new File(["f2"], "f2.pdf", { type: "application/pdf" }),
    ];
    await component.handleFiles(files as unknown as FileList);
    await new Promise((resolve) => setTimeout(resolve, 0));

    component.removeFile(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(component.querySelectorAll(".file-list-item").length).toBe(1);
  });

  it("should swap files", async () => {
    const files = [
      new File(["f1"], "a.pdf", { type: "application/pdf" }),
      new File(["f2"], "b.pdf", { type: "application/pdf" }),
      new File(["f3"], "c.pdf", { type: "application/pdf" }),
    ];
    await component.handleFiles(files as unknown as FileList);
    await new Promise((resolve) => setTimeout(resolve, 0));

    component.swapFiles(0, 2);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const fileNames = Array.from(component.querySelectorAll(".file-name")).map(
      (el) => el.textContent,
    );
    expect(fileNames[0]).toBe("b.pdf");
    expect(fileNames[1]).toBe("c.pdf");
    expect(fileNames[2]).toBe("a.pdf");
  });

  it("should support drag-and-drop and touch reordering", async () => {
    const files = [
      new File(["f1"], "a.pdf", { type: "application/pdf" }),
      new File(["f2"], "b.pdf", { type: "application/pdf" }),
      new File(["f3"], "c.pdf", { type: "application/pdf" }),
    ];
    await loadFiles(...files);

    const items = component.querySelectorAll(".file-list-item") as NodeListOf<HTMLElement>;
    const dragStart = new Event("dragstart", { bubbles: true });
    Object.defineProperty(dragStart, "dataTransfer", {
      value: { setData: vi.fn() },
    });
    items[0].dispatchEvent(dragStart);
    expect(items[0].classList.contains("dragging")).toBe(true);

    items[1].dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    expect(items[1].classList.contains("drag-over")).toBe(true);
    items[1].dispatchEvent(new Event("dragleave", { bubbles: true }));
    expect(items[1].classList.contains("drag-over")).toBe(false);

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { getData: vi.fn(() => "0") },
    });
    items[2].dispatchEvent(drop);
    expect(Array.from(component.querySelectorAll(".file-name"))[2].textContent).toBe("a.pdf");

    const refreshedItems = component.querySelectorAll(".file-list-item") as NodeListOf<HTMLElement>;
    refreshedItems[0].dispatchEvent(new Event("dragend", { bubbles: true }));

    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => refreshedItems[1]),
    });
    const touchStart = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(touchStart, "target", {
      value: refreshedItems[0].querySelector(".drag-handle"),
    });
    refreshedItems[0].dispatchEvent(touchStart);
    expect(refreshedItems[0].classList.contains("dragging")).toBe(true);

    const touchMove = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(touchMove, "touches", {
      value: [{ clientX: 1, clientY: 1 }],
    });
    refreshedItems[0].dispatchEvent(touchMove);
    expect(refreshedItems[1].classList.contains("drag-over")).toBe(true);

    const touchEnd = new Event("touchend", { bubbles: true });
    Object.defineProperty(touchEnd, "changedTouches", {
      value: [{ clientX: 1, clientY: 1 }],
    });
    refreshedItems[0].dispatchEvent(touchEnd);
    expect(component.querySelectorAll(".file-list-item")).toHaveLength(3);

    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: originalElementFromPoint,
    });
  });

  describe("session management", () => {
    it("should check for existing session on load", async () => {
      const { persistence } = await import("../../utils/persistence");
      expect(persistence.get).toHaveBeenCalled();
    });

    it("should save session when files are added", async () => {
      const { persistence } = await import("../../utils/persistence");
      const files = [new File(["f1"], "f1.pdf", { type: "application/pdf" })];
      await component.handleFiles(files as unknown as FileList);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(persistence.set).toHaveBeenCalled();
    });

    it("should call persistence.delete when all files removed", async () => {
      const { persistence } = await import("../../utils/persistence");
      const files = [new File(["f1"], "f1.pdf", { type: "application/pdf" })];
      await component.handleFiles(files as unknown as FileList);
      await new Promise((resolve) => setTimeout(resolve, 0));

      component.removeFile(0);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(persistence.delete).toHaveBeenCalledWith("pdf-merge");
    });

    it("should restore session when files are present", async () => {
      const { persistence } = await import("../../utils/persistence");
      const mockFiles = [new File(["test"], "restored.pdf", { type: "application/pdf" })];
      (persistence.get as any).mockResolvedValueOnce(mockFiles);

      await component.restoreSession();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should have restored the file
      expect(component.querySelectorAll(".file-list-item").length).toBe(1);
    });

    it("should show, ignore, and tolerate session restore failures", async () => {
      const { persistence } = await import("../../utils/persistence");
      const mockFiles = [new File(["test"], "restored.pdf", { type: "application/pdf" })];

      (persistence.get as any).mockResolvedValueOnce(mockFiles);
      await component.checkExistingSession();
      expect(component.querySelector("#resumeContainer")?.classList.contains("hidden")).toBe(false);

      (persistence.get as any).mockResolvedValueOnce([]);
      await expect(component.restoreSession()).resolves.toBeUndefined();

      (persistence.get as any).mockRejectedValueOnce(new Error("restore failed"));
      await expect(component.restoreSession()).resolves.toBeUndefined();

      (persistence.get as any).mockRejectedValueOnce(new Error("check failed"));
      await expect(component.checkExistingSession()).resolves.toBeUndefined();

      (persistence.set as any).mockRejectedValueOnce(new Error("save failed"));
      await expect(component.saveSession()).resolves.toBeUndefined();
    });
  });

  describe("startMerge", () => {
    it("should call PDFDocument methods when merging", async () => {
      const { PDFDocument } = await import("../../utils/pdfConfig");
      const files = [
        new File(["f1"], "f1.pdf", { type: "application/pdf" }),
        new File(["f2"], "f2.pdf", { type: "application/pdf" }),
      ];
      await component.handleFiles(files as unknown as FileList);
      await new Promise((resolve) => setTimeout(resolve, 0));

      await component.startMerge();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(PDFDocument.create).toHaveBeenCalled();
      expect(PDFDocument.load).toHaveBeenCalled();
    });

    it("should record job after successful merge", async () => {
      const { persistence } = await import("../../utils/persistence");
      const files = [
        new File(["f1"], "f1.pdf", { type: "application/pdf" }),
        new File(["f2"], "f2.pdf", { type: "application/pdf" }),
      ];
      await component.handleFiles(files as unknown as FileList);
      await new Promise((resolve) => setTimeout(resolve, 0));

      await component.startMerge();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(persistence.addJob).toHaveBeenCalled();
    });

    it("should show success message after merge", async () => {
      const files = [
        new File(["f1"], "f1.pdf", { type: "application/pdf" }),
        new File(["f2"], "f2.pdf", { type: "application/pdf" }),
      ];
      await component.handleFiles(files as unknown as FileList);
      await new Promise((resolve) => setTimeout(resolve, 0));

      await component.startMerge();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(false);
    });

    it("should return early with fewer than two files and report merge failures", async () => {
      const { PDFDocument } = await import("../../utils/pdfConfig");
      component.startMerge();
      expect(PDFDocument.create).not.toHaveBeenCalled();

      const files = [
        new File(["f1"], "f1.pdf", { type: "application/pdf" }),
        new File(["f2"], "f2.pdf", { type: "application/pdf" }),
      ];
      await loadFiles(...files);
      (PDFDocument.create as any).mockRejectedValueOnce(new Error("merge failed"));

      await component.startMerge();

      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error" }),
      );
      expect((component.querySelector("#mergeBtn") as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe("file list UI", () => {
    it("should display file names in list", async () => {
      const files = [
        new File(["f1"], "document1.pdf", { type: "application/pdf" }),
        new File(["f2"], "document2.pdf", { type: "application/pdf" }),
      ];
      await component.handleFiles(files as unknown as FileList);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const fileNames = component.querySelectorAll(".file-name");
      expect(fileNames.length).toBe(2);
      expect(fileNames[0].textContent).toBe("document1.pdf");
      expect(fileNames[1].textContent).toBe("document2.pdf");
    });

    it("should display file list items", async () => {
      const files = [
        new File(["f1"], "f1.pdf", { type: "application/pdf" }),
        new File(["f2"], "f2.pdf", { type: "application/pdf" }),
      ];
      await component.handleFiles(files as unknown as FileList);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const listItems = component.querySelectorAll(".file-list-item");
      expect(listItems.length).toBe(2);
    });
  });
});
