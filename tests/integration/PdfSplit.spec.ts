import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sourcePdf = {
    getPageCount: vi.fn().mockReturnValue(5),
    getPageIndices: vi.fn().mockReturnValue([0, 1, 2, 3, 4]),
  };
  const newPdf = {
    addPage: vi.fn(),
    copyPages: vi.fn().mockResolvedValue([{}, {}, {}]),
    save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  };

  return {
    clearPreviewLoadingState: vi.fn((container: HTMLElement) => {
      container.removeAttribute("aria-busy");
    }),
    getPdfPreviewErrorMessage: vi.fn(() => "Preview error message"),
    loadPdfDocument: vi.fn().mockResolvedValue({ numPages: 5 }),
    loadProcessablePdf: vi.fn().mockResolvedValue({ pdfDoc: sourcePdf, restrictionOnly: false }),
    newPdf,
    observeThumbnail: vi.fn(),
    persistence: {
      addJob: vi.fn().mockResolvedValue(1),
      delete: vi.fn().mockResolvedValue(undefined),
      estimateUsage: vi.fn().mockResolvedValue(0),
      get: vi.fn().mockResolvedValue(null),
      getJobs: vi.fn().mockResolvedValue([]),
      getStorageUsage: vi.fn().mockResolvedValue({ usage: 0, quota: 1000 }),
      set: vi.fn().mockResolvedValue(undefined),
    },
    setPreviewLoadingState: vi.fn((container: HTMLElement) => {
      container.setAttribute("aria-busy", "true");
      container.textContent = "Loading pages...";
    }),
    sourcePdf,
    thumbnailDestroy: vi.fn(),
  };
});

vi.mock("../../utils/persistence", () => ({
  persistence: mocks.persistence,
}));

vi.mock("../../utils/pdfConfig", () => ({
  PDFDocument: {
    create: vi.fn().mockResolvedValue(mocks.newPdf),
  },
}));

vi.mock("../../utils/pdfPreview.ts", () => ({
  clearPreviewLoadingState: mocks.clearPreviewLoadingState,
  getPdfPreviewErrorMessage: mocks.getPdfPreviewErrorMessage,
  loadPdfDocument: mocks.loadPdfDocument,
  PdfThumbnailGridController: class {
    destroy = mocks.thumbnailDestroy;
    observe = mocks.observeThumbnail;
  },
  setPreviewLoadingState: mocks.setPreviewLoadingState,
}));

vi.mock("../../utils/pdfSecurity.ts", () => ({
  loadProcessablePdf: mocks.loadProcessablePdf,
}));

import { PdfSplit } from "../../components/PdfSplit";
import { PDFDocument } from "../../utils/pdfConfig";
import { loadProcessablePdf } from "../../utils/pdfSecurity";
import { persistence } from "../../utils/persistence";

const asFileList = (files: File[]) => files as unknown as FileList;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const pdfFile = (name = "test.pdf", size = 12) =>
  new File([new Uint8Array(size)], name, { type: "application/pdf" });

describe("PdfSplit", () => {
  let component: PdfSplit;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.persistence.get.mockResolvedValue(null);
    mocks.persistence.set.mockResolvedValue(undefined);
    mocks.persistence.delete.mockResolvedValue(undefined);
    mocks.persistence.addJob.mockResolvedValue(1);
    mocks.persistence.estimateUsage.mockResolvedValue(0);
    mocks.persistence.getJobs.mockResolvedValue([]);
    mocks.persistence.getStorageUsage.mockResolvedValue({ usage: 0, quota: 1000 });
    mocks.loadPdfDocument.mockResolvedValue({ numPages: 5 });
    mocks.loadProcessablePdf.mockResolvedValue({
      pdfDoc: mocks.sourcePdf,
      restrictionOnly: false,
    });
    mocks.newPdf.copyPages.mockResolvedValue([{}, {}, {}]);
    mocks.newPdf.save.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(PDFDocument.create).mockResolvedValue(mocks.newPdf);

    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
    URL.createObjectURL = vi.fn(() => "blob:split");
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();

    component = new PdfSplit();
    document.body.appendChild(component);
    await flush();
  });

  const loadFile = async (file = pdfFile()) => {
    await component.handleFiles(asFileList([file]));
    await flush();
    return file;
  };

  describe("render", () => {
    it("renders the split component with hidden controls", () => {
      expect(component.querySelector("h1")?.textContent).toBe("Split PDF");
      expect(component.querySelector("#splitControls")?.classList.contains("hidden")).toBe(true);
      expect(component.querySelector("#selectionInfo")?.textContent).toBe("0 pages selected");
    });
  });

  describe("file handling and sessions", () => {
    it("loads a file, renders thumbnails, and saves the session", async () => {
      const file = await loadFile(pdfFile("pages.pdf", 50 * 1024));

      expect(component.querySelector("#fileNameLabel")?.textContent).toBe("pages.pdf");
      expect(component.querySelector("#dropZone")?.classList.contains("hidden")).toBe(true);
      expect(component.querySelector("#splitControls")?.classList.contains("hidden")).toBe(false);
      expect(component.querySelectorAll(".page-item")).toHaveLength(5);
      expect(mocks.setPreviewLoadingState).toHaveBeenCalled();
      expect(mocks.clearPreviewLoadingState).toHaveBeenCalled();
      expect(mocks.observeThumbnail).toHaveBeenCalledTimes(5);
      expect(persistence.set).toHaveBeenCalledWith("pdf-split", file);
    });

    it("destroys the previous thumbnail controller when a new PDF is loaded", async () => {
      await loadFile(pdfFile("first.pdf"));
      await loadFile(pdfFile("second.pdf"));

      expect(mocks.thumbnailDestroy).toHaveBeenCalled();
    });

    it("ignores invalid files and reports PDF load failures", async () => {
      await component.handleFiles(
        asFileList([new File(["txt"], "notes.txt", { type: "text/plain" })]),
      );
      expect(component.querySelectorAll(".page-item")).toHaveLength(0);

      mocks.loadPdfDocument.mockRejectedValueOnce(new Error("cannot parse"));
      await component.handleFiles(asFileList([pdfFile("broken.pdf")]));

      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "An unexpected error occurred.",
          title: "Error",
          type: "error",
        }),
      );
    });

    it("shows, restores, ignores, and tolerates saved split sessions", async () => {
      const savedFile = pdfFile("saved.pdf", 2048);
      mocks.persistence.get.mockResolvedValueOnce(savedFile);

      await component.checkExistingSession();

      expect(component.querySelector("#resumeContainer")?.classList.contains("hidden")).toBe(false);
      expect(component.querySelector("#resumeBtn")?.textContent).toContain("Resume saved.pdf");

      const handleFiles = vi.spyOn(component, "handleFiles").mockResolvedValue(undefined);
      mocks.persistence.get.mockResolvedValueOnce(savedFile);
      await component.restoreSession();
      expect(handleFiles).toHaveBeenCalledWith([savedFile]);

      handleFiles.mockClear();
      mocks.persistence.get.mockResolvedValueOnce(null);
      await component.restoreSession();
      expect(handleFiles).not.toHaveBeenCalled();

      mocks.persistence.get.mockRejectedValueOnce(new Error("restore failed"));
      await expect(component.restoreSession()).resolves.toBeUndefined();

      mocks.persistence.get.mockRejectedValueOnce(new Error("check failed"));
      await expect(component.checkExistingSession()).resolves.toBeUndefined();
    });

    it("handles save-session failures without blocking the component", async () => {
      (component as any).selectedFile = pdfFile("autosave.pdf");
      mocks.persistence.set.mockRejectedValueOnce(new Error("quota"));

      await expect(component.saveSession()).resolves.toBeUndefined();

      expect(persistence.set).toHaveBeenCalledWith("pdf-split", expect.any(File));
    });
  });

  describe("page selection", () => {
    it("toggles individual pages and updates split button state", async () => {
      await loadFile();
      const firstPage = component.querySelector(".page-item") as HTMLElement;
      const splitBtn = component.querySelector("#splitBtn") as HTMLButtonElement;

      firstPage.click();
      expect(firstPage.classList.contains("selected")).toBe(true);
      expect(component.querySelector("#selectionInfo")?.textContent).toBe("1 page selected");
      expect(splitBtn.disabled).toBe(false);

      firstPage.click();
      expect(firstPage.classList.contains("selected")).toBe(false);
      expect(component.querySelector("#selectionInfo")?.textContent).toBe("0 pages selected");
      expect(splitBtn.disabled).toBe(true);
    });

    it("selects and clears all pages through controls and direct methods", async () => {
      component.selectAll();
      expect(component.querySelector("#selectionInfo")?.textContent).toBe("0 pages selected");

      await loadFile();

      (component.querySelector("#selectAllBtn") as HTMLButtonElement).click();
      expect(component.querySelector("#selectionInfo")?.textContent).toBe("5 pages selected");
      expect(
        Array.from(component.querySelectorAll(".page-item")).every((el) =>
          el.classList.contains("selected"),
        ),
      ).toBe(true);

      (component.querySelector("#clearSelectionBtn") as HTMLButtonElement).click();
      expect(component.querySelector("#selectionInfo")?.textContent).toBe("0 pages selected");
      expect(
        Array.from(component.querySelectorAll(".page-item")).every(
          (el) => !el.classList.contains("selected"),
        ),
      ).toBe(true);
    });
  });

  describe("startSplit", () => {
    it("returns early without a file or selection", async () => {
      await component.startSplit();

      expect(PDFDocument.create).not.toHaveBeenCalled();
    });

    it("extracts selected pages, updates progress, records history, and shows success", async () => {
      const file = await loadFile(pdfFile("source.pdf"));
      component.selectAll();

      await component.startSplit();

      expect(loadProcessablePdf).toHaveBeenCalledWith(expect.any(ArrayBuffer));
      expect(PDFDocument.create).toHaveBeenCalled();
      expect(mocks.newPdf.copyPages).toHaveBeenCalledWith(mocks.sourcePdf, [0, 1, 2, 3, 4]);
      expect(mocks.newPdf.addPage).toHaveBeenCalledTimes(3);
      expect(mocks.newPdf.save).toHaveBeenCalled();
      expect(persistence.addJob).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: "source_extracted.pdf",
          metadata: { pagesExtracted: 5 },
          tool: "Split",
        }),
      );
      expect(component.querySelector("#percentText")?.textContent).toBe("100%");
      expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(false);
      expect(file.name).toBe("source.pdf");
    });

    it("extracts only explicitly selected pages in sorted order", async () => {
      await loadFile();
      const pages = component.querySelectorAll(".page-item") as NodeListOf<HTMLElement>;
      pages[3].click();
      pages[1].click();

      await component.startSplit();

      expect(mocks.newPdf.copyPages).toHaveBeenCalledWith(mocks.sourcePdf, [1, 3]);
      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({ type: "success" }),
      );
    });

    it("reports split failures and re-enables the split button", async () => {
      await loadFile();
      component.selectAll();
      mocks.loadProcessablePdf.mockRejectedValueOnce(new Error("locked"));

      await component.startSplit();

      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "An unexpected error occurred.",
          title: "Error",
          type: "error",
        }),
      );
      expect((component.querySelector("#splitBtn") as HTMLButtonElement).disabled).toBe(false);
    });

    it("starts splitting from the split button click handler", async () => {
      await loadFile();
      component.selectAll();
      vi.mocked(PDFDocument.create).mockClear();

      (component.querySelector("#splitBtn") as HTMLButtonElement).click();
      await flush();

      expect(PDFDocument.create).toHaveBeenCalled();
    });
  });
});
