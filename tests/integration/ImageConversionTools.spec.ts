import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearPreviewLoadingState: vi.fn(),
  convertImagesToPdf: vi.fn(),
  renderPdfPagesToImages: vi.fn(),
  destroyThumbnails: vi.fn().mockResolvedValue(undefined),
  getPdfPreviewErrorMessage: vi.fn(() => "Preview failed"),
  loadPdfDocument: vi.fn(),
  observeThumbnail: vi.fn(),
  persistence: {
    addJob: vi.fn().mockResolvedValue(1),
    delete: vi.fn().mockResolvedValue(undefined),
    estimateUsage: vi.fn().mockResolvedValue(0),
    get: vi.fn().mockResolvedValue(undefined),
    getJobs: vi.fn().mockResolvedValue([]),
    getStorageUsage: vi.fn().mockResolvedValue({ quota: 1000, usage: 0 }),
    set: vi.fn().mockResolvedValue(undefined),
  },
  setPreviewLoadingState: vi.fn(),
}));

vi.mock("../../utils/pdfEngine.ts", () => ({
  convertImagesToPdf: mocks.convertImagesToPdf,
  renderPdfPagesToImages: mocks.renderPdfPagesToImages,
}));

vi.mock("../../utils/pdfPreview.ts", () => ({
  clearPreviewLoadingState: mocks.clearPreviewLoadingState,
  getPdfPreviewErrorMessage: mocks.getPdfPreviewErrorMessage,
  loadPdfDocument: mocks.loadPdfDocument,
  PdfThumbnailGridController: class {
    destroy = mocks.destroyThumbnails;
    observe = mocks.observeThumbnail;
  },
  setPreviewLoadingState: mocks.setPreviewLoadingState,
}));

vi.mock("../../utils/persistence.ts", () => ({
  persistence: mocks.persistence,
}));

import { ImageToPdf } from "../../components/ImageToPdf";
import { PdfToImage } from "../../components/PdfToImage";

const asFileList = (files: File[]) => files as unknown as FileList;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("image conversion components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persistence.get.mockResolvedValue(undefined);
    mocks.persistence.estimateUsage.mockResolvedValue(0);
    mocks.persistence.getJobs.mockResolvedValue([]);
    mocks.persistence.getStorageUsage.mockResolvedValue({ quota: 1000, usage: 0 });
    mocks.convertImagesToPdf.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.renderPdfPagesToImages.mockImplementation(
      async (_data: Uint8Array, { pages }: { pages?: number[] }) =>
        (pages ?? [1, 2]).map((pageNumber) => ({
          pageNumber,
          blob: new Blob([`page-${pageNumber}`], { type: "image/png" }),
        })),
    );
    mocks.loadPdfDocument.mockResolvedValue({ numPages: 2 });

    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
    (window as any).showAbout = vi.fn();
    URL.createObjectURL = vi.fn(() => "blob:download");
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  const mountImageToPdf = async () => {
    const component = new ImageToPdf();
    document.body.appendChild(component);
    await flush();
    return component;
  };

  const mountPdfToImage = async () => {
    const component = new PdfToImage();
    document.body.appendChild(component);
    await flush();
    return component;
  };

  describe("ImageToPdf", () => {
    it("adds valid images, renders controls, and saves the session", async () => {
      const component = await mountImageToPdf();
      const files = [
        new File(["a"], "one.png", { type: "image/png" }),
        new File(["b"], "two.jpg", { type: "image/jpeg" }),
        new File(["c"], "notes.txt", { type: "text/plain" }),
      ];

      await component.handleFiles(asFileList(files));
      await flush();

      expect((component as any).files).toHaveLength(2);
      expect(component.querySelectorAll(".file-list-item")).toHaveLength(2);
      expect(component.querySelector("#dropZone")?.classList.contains("hidden")).toBe(true);
      expect(component.querySelector("#fileListContainer")?.classList.contains("hidden")).toBe(
        false,
      );
      expect(mocks.persistence.set).toHaveBeenCalledWith("image-to-pdf", (component as any).files);
    });

    it("restores a saved image session", async () => {
      const saved = [new File(["a"], "saved.png", { type: "image/png" })];
      mocks.persistence.get.mockResolvedValue(saved);
      const component = await mountImageToPdf();

      await component.restoreSession();
      await flush();

      expect((component as any).files).toEqual(saved);
      expect(component.querySelector("#fileList")?.textContent).toContain("saved.png");
      expect(component.querySelector("#fileListContainer")?.classList.contains("hidden")).toBe(
        false,
      );
    });

    it("moves, swaps, and removes files while keeping persistence in sync", async () => {
      const component = await mountImageToPdf();
      const one = new File(["a"], "one.png", { type: "image/png" });
      const two = new File(["b"], "two.png", { type: "image/png" });
      const three = new File(["c"], "three.png", { type: "image/png" });
      await component.handleFiles(asFileList([one, two, three]));

      component.moveFile(2, -1);
      expect((component as any).files.map((file: File) => file.name)).toEqual([
        "one.png",
        "three.png",
        "two.png",
      ]);

      component.swapFiles(0, 2);
      expect((component as any).files.map((file: File) => file.name)).toEqual([
        "three.png",
        "two.png",
        "one.png",
      ]);

      component.removeFile(2);
      component.removeFile(1);
      component.removeFile(0);

      expect((component as any).files).toHaveLength(0);
      expect(component.querySelector("#dropZone")?.classList.contains("hidden")).toBe(false);
      expect(mocks.persistence.delete).toHaveBeenCalledWith("image-to-pdf");
    });

    it("handles image list button and drag interactions", async () => {
      const component = await mountImageToPdf();
      const fileInput = component.querySelector("#fileInput") as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, "click");

      (component.querySelector("#addMoreBtn") as HTMLButtonElement).click();
      expect(clickSpy).toHaveBeenCalled();

      component.handleFiles(
        asFileList([
          new File(["a"], "a.png", { type: "image/png" }),
          new File(["b"], "b.png", { type: "image/png" }),
        ]),
      );
      await flush();

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
      items[1].dispatchEvent(drop);

      expect((component as any).files.map((file: File) => file.name)).toEqual(["b.png", "a.png"]);

      const refreshedItems = component.querySelectorAll(
        ".file-list-item",
      ) as NodeListOf<HTMLElement>;
      refreshedItems[0].dispatchEvent(new Event("dragend", { bubbles: true }));
      expect(refreshedItems[0].classList.contains("dragging")).toBe(false);
    });

    it("restores from the resume button and runs conversion from the primary button", async () => {
      const saved = [new File(["a"], "resume.png", { type: "image/png" })];
      mocks.persistence.get.mockResolvedValue(saved);
      const component = await mountImageToPdf();

      await component.checkExistingSession();
      (component.querySelector("#resumeBtn") as HTMLButtonElement).click();
      await flush();

      expect((component as any).files).toEqual(saved);

      (component.querySelector("#convertBtn") as HTMLButtonElement).click();
      await flush();

      expect(mocks.convertImagesToPdf).toHaveBeenCalled();
    });

    it("tolerates image session lookup, restore, and save failures", async () => {
      const component = await mountImageToPdf();

      mocks.persistence.get.mockRejectedValueOnce(new Error("lookup failed"));
      await expect(component.checkExistingSession()).resolves.toBeUndefined();

      mocks.persistence.get.mockRejectedValueOnce(new Error("restore failed"));
      await expect(component.restoreSession()).resolves.toBeUndefined();

      mocks.persistence.set.mockRejectedValueOnce(new Error("save failed"));
      await expect(component.saveSession()).resolves.toBeUndefined();
    });

    it("converts images to a PDF and records the job", async () => {
      const component = await mountImageToPdf();
      await component.handleFiles(asFileList([new File(["a"], "one.png", { type: "image/png" })]));

      await component.startConversion();

      expect(mocks.convertImagesToPdf).toHaveBeenCalledWith((component as any).files);
      expect(mocks.persistence.addJob).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: "converted_images.pdf",
          tool: "Image to PDF",
        }),
      );
      expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(false);
      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({ type: "success" }),
      );
    });

    it("does nothing without files and shows an error when conversion fails", async () => {
      const component = await mountImageToPdf();
      await component.startConversion();
      expect(mocks.convertImagesToPdf).not.toHaveBeenCalled();

      await component.handleFiles(asFileList([new File(["a"], "one.png", { type: "image/png" })]));
      mocks.convertImagesToPdf.mockRejectedValueOnce(new Error("bad image"));

      await component.startConversion();

      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Error", type: "error" }),
      );
      expect((component.querySelector("#convertBtn") as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe("ImageToPdf inputs and list controls", () => {
    it("offers only saved images, not PDFs or other results, under Reuse a recent file", async () => {
      mocks.persistence.getJobs.mockResolvedValue([
        { id: 1, fileName: "converted_images.pdf", data: new Uint8Array([1]) },
        { id: 2, fileName: "scan.png", data: new Uint8Array([2]) },
        { id: 3, fileName: "notes.md", data: new Uint8Array([3]) },
        { id: 4, fileName: "photo", mimeType: "image/jpeg", data: new Uint8Array([4]) },
      ]);

      const component = await mountImageToPdf();

      const chips = Array.from(
        component.querySelectorAll<HTMLButtonElement>(".recent-file-chip"),
        (chip) => chip.textContent?.trim(),
      );
      expect(chips).toEqual(["scan.png", "photo"]);
    });

    it("hides Reuse a recent file when history holds only PDFs", async () => {
      mocks.persistence.getJobs.mockResolvedValue([
        { id: 1, fileName: "merged_document.pdf", data: new Uint8Array([1]) },
      ]);

      const component = await mountImageToPdf();

      expect(component.querySelector("#recentFilesContainer")?.classList.contains("hidden")).toBe(
        true,
      );
      expect(component.querySelectorAll(".recent-file-chip")).toHaveLength(0);
    });

    it("shows a hostile image name as text instead of markup", async () => {
      const component = await mountImageToPdf();
      const name = '<img src=x onerror="alert(1)">.png';

      await component.handleFiles(asFileList([new File(["a"], name, { type: "image/png" })]));

      const fileName = component.querySelector("#fileList .file-name") as HTMLElement;
      expect(component.querySelector("#fileList img")).toBeNull();
      expect(fileName.textContent).toBe(name);
      expect(fileName.getAttribute("title")).toBe(name);
    });

    it("reorders and removes images from the list buttons", async () => {
      const component = await mountImageToPdf();
      await component.handleFiles(
        asFileList([
          new File(["a"], "a.png", { type: "image/png" }),
          new File(["b"], "b.png", { type: "image/png" }),
          new File(["c"], "c.png", { type: "image/png" }),
        ]),
      );
      const names = () => (component as any).files.map((file: File) => file.name);
      const button = (selector: string, index: number) =>
        component.querySelectorAll<HTMLButtonElement>(selector)[index];

      button(".move-up", 1).click();
      expect(names()).toEqual(["b.png", "a.png", "c.png"]);

      button(".move-down", 0).click();
      expect(names()).toEqual(["a.png", "b.png", "c.png"]);

      button(".remove", 1).click();
      expect(names()).toEqual(["a.png", "c.png"]);
      expect(component.querySelectorAll(".file-list-item")).toHaveLength(2);
    });

    it("ignores moves past either end and drops onto the same item", async () => {
      const component = await mountImageToPdf();
      await component.handleFiles(
        asFileList([
          new File(["a"], "a.png", { type: "image/png" }),
          new File(["b"], "b.png", { type: "image/png" }),
        ]),
      );
      mocks.persistence.set.mockClear();

      component.moveFile(0, -1);
      component.moveFile(1, 1);

      const items = component.querySelectorAll<HTMLElement>(".file-list-item");
      const selfDrop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(selfDrop, "dataTransfer", { value: { getData: () => "1" } });
      items[1].dispatchEvent(selfDrop);

      // A drop without transfer data is read as coming from the first item.
      const bareDrop = new Event("drop", { bubbles: true, cancelable: true });
      items[0].dispatchEvent(bareDrop);

      expect((component as any).files.map((file: File) => file.name)).toEqual(["a.png", "b.png"]);
      expect(mocks.persistence.set).not.toHaveBeenCalled();
    });

    it("stays on the drop zone when nothing valid is added or nothing is saved", async () => {
      const component = await mountImageToPdf();

      await component.handleFiles(
        asFileList([new File(["%PDF-"], "doc.pdf", { type: "application/pdf" })]),
      );
      await component.restoreSession();

      expect((component as any).files).toEqual([]);
      expect(component.querySelector("#dropZone")?.classList.contains("hidden")).toBe(false);
      expect(mocks.persistence.set).not.toHaveBeenCalled();
    });

    it("tolerates resume markup being absent", async () => {
      mocks.persistence.get.mockResolvedValue([new File(["a"], "a.png", { type: "image/png" })]);
      const component = new ImageToPdf();
      component.render = function (this: ImageToPdf) {
        ImageToPdf.prototype.render.call(this);
        this.querySelector("#resumeContainer")?.remove();
      };
      document.body.appendChild(component);
      await flush();

      await expect(component.checkExistingSession()).resolves.toBeUndefined();
      expect(component.querySelector("#resumeBtn")).toBeNull();
    });
  });

  describe("PdfToImage", () => {
    it("loads a PDF, renders thumbnails, and toggles page selection", async () => {
      const component = await mountPdfToImage();
      const file = new File(["pdf"], "sample.pdf", { type: "application/pdf" });

      await component.handleFiles(asFileList([file]));

      expect(mocks.persistence.set).toHaveBeenCalledWith("pdf-to-image", file);
      expect(mocks.loadPdfDocument).toHaveBeenCalledWith(file);
      expect(component.querySelectorAll(".page-item")).toHaveLength(2);
      expect(mocks.observeThumbnail).toHaveBeenCalledTimes(2);

      const firstPage = component.querySelector(".page-item") as HTMLElement;
      firstPage.click();
      expect(firstPage.classList.contains("selected")).toBe(true);
      firstPage.click();
      expect(firstPage.classList.contains("selected")).toBe(false);
    });

    it("restores a saved PDF session", async () => {
      const saved = new File(["pdf"], "saved.pdf", { type: "application/pdf" });
      mocks.persistence.get.mockResolvedValue(saved);
      const component = await mountPdfToImage();

      await component.restoreSession();

      expect(mocks.persistence.get).toHaveBeenCalledWith("pdf-to-image");
      expect(component.querySelector("#fileName")?.textContent).toBe("saved.pdf");
    });

    it("warns when selected-page mode has no selected pages", async () => {
      const component = await mountPdfToImage();
      await component.handleFiles(
        asFileList([new File(["pdf"], "sample.pdf", { type: "application/pdf" })]),
      );

      const selectedMode = component.querySelector(
        'input[name="downloadMode"][value="selected-zip"]',
      ) as HTMLInputElement;
      selectedMode.checked = true;
      selectedMode.dispatchEvent(new Event("change", { bubbles: true }));

      await component.handleConvert();

      expect(component.querySelector("#selectionWarning")?.classList.contains("hidden")).toBe(
        false,
      );
      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error" }),
      );
      expect(mocks.renderPdfPagesToImages).not.toHaveBeenCalled();
    });

    it("exports all pages as a ZIP and records the job", async () => {
      const component = await mountPdfToImage();
      await component.handleFiles(
        asFileList([new File(["pdf"], "sample.pdf", { type: "application/pdf" })]),
      );

      await component.handleConvert();

      expect(mocks.renderPdfPagesToImages).toHaveBeenCalledWith(expect.any(Uint8Array), {
        format: "png",
        scale: 2,
      });
      expect(mocks.persistence.addJob).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: "sample_images.zip",
          metadata: expect.objectContaining({ format: "png", pageCount: 2 }),
          tool: "PDF to Image",
        }),
      );
      expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(false);
    });

    it("exports chosen pages in page order as a JPEG ZIP named after the selection", async () => {
      mocks.loadPdfDocument.mockResolvedValue({ numPages: 3 });
      const zipFile = vi.spyOn(JSZip.prototype, "file");
      const component = await mountPdfToImage();
      await component.handleFiles(
        asFileList([new File(["pdf"], "sample.pdf", { type: "application/pdf" })]),
      );

      (component.querySelector("#jpgBtn") as HTMLButtonElement).click();
      const pages = component.querySelectorAll<HTMLElement>(".page-item");
      pages[2].click();
      pages[0].click();
      const mode = component.querySelector(
        'input[name="downloadMode"][value="selected-zip"]',
      ) as HTMLInputElement;
      mode.checked = true;
      mode.dispatchEvent(new Event("change", { bubbles: true }));

      try {
        await component.handleConvert();

        expect(zipFile.mock.calls.map(([name]) => name)).toEqual([
          "sample_page_1.jpg",
          "sample_page_3.jpg",
        ]);
        // Only the chosen pages are rendered, in page order.
        expect(mocks.renderPdfPagesToImages).toHaveBeenCalledWith(expect.any(Uint8Array), {
          format: "jpeg",
          scale: 2,
          pages: [1, 3],
        });
        expect(mocks.persistence.addJob).toHaveBeenCalledWith(
          expect.objectContaining({ fileName: "sample_selected_images.zip" }),
        );
      } finally {
        zipFile.mockRestore();
      }
    });

    it("forgets the page selection when another PDF is loaded", async () => {
      const component = await mountPdfToImage();
      await component.handleFiles(
        asFileList([new File(["pdf"], "a.pdf", { type: "application/pdf" })]),
      );
      const mode = component.querySelector(
        'input[name="downloadMode"][value="selected-zip"]',
      ) as HTMLInputElement;
      mode.checked = true;
      mode.dispatchEvent(new Event("change", { bubbles: true }));
      component.querySelectorAll<HTMLElement>(".page-item")[1].click();

      await component.handleFiles(
        asFileList([new File(["pdf"], "other.pdf", { type: "application/pdf" })]),
      );
      expect(component.querySelector("#selectionWarning")?.classList.contains("hidden")).toBe(
        false,
      );

      await component.handleConvert();
      // Page 2 was chosen in a.pdf, not in other.pdf, so nothing is exported.
      expect(mocks.renderPdfPagesToImages).not.toHaveBeenCalled();
      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Please select at least one page from the gallery." }),
      );
    });

    it("closes the previous document when another PDF is loaded and when the tool closes", async () => {
      // A document that fails to close must not stop the next one loading.
      const first = { numPages: 2, destroy: vi.fn().mockRejectedValue(new Error("worker gone")) };
      const second = { numPages: 2, destroy: vi.fn().mockResolvedValue(undefined) };
      mocks.loadPdfDocument.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
      const component = await mountPdfToImage();

      await component.handleFiles(
        asFileList([new File(["pdf"], "a.pdf", { type: "application/pdf" })]),
      );
      await flush();
      await component.handleFiles(
        asFileList([new File(["pdf"], "b.pdf", { type: "application/pdf" })]),
      );
      await flush();
      expect(first.destroy).toHaveBeenCalledTimes(1);
      expect(second.destroy).not.toHaveBeenCalled();

      mocks.destroyThumbnails.mockClear();
      component.remove();
      expect(second.destroy).toHaveBeenCalledTimes(1);
      expect(mocks.destroyThumbnails).toHaveBeenCalledTimes(1);
    });

    it("drops an upper-case .PDF extension from image names", async () => {
      const zipFile = vi.spyOn(JSZip.prototype, "file");
      const component = await mountPdfToImage();
      await component.handleFiles(
        asFileList([new File(["pdf"], "Scan.PDF", { type: "application/pdf" })]),
      );

      try {
        await component.handleConvert();
        expect(zipFile.mock.calls.map(([name]) => name)).toEqual([
          "Scan_page_1.png",
          "Scan_page_2.png",
        ]);
      } finally {
        zipFile.mockRestore();
      }
    });

    it("names each image by its own page and reports pages that failed", async () => {
      mocks.loadPdfDocument.mockResolvedValue({ numPages: 3 });
      mocks.renderPdfPagesToImages.mockResolvedValueOnce([
        { pageNumber: 1, blob: new Blob(["p1"]) },
        { pageNumber: 2, blob: null },
        { pageNumber: 3, blob: new Blob(["p3"]) },
      ]);
      const zipFile = vi.spyOn(JSZip.prototype, "file");
      const component = await mountPdfToImage();
      await component.handleFiles(
        asFileList([new File(["pdf"], "sample.pdf", { type: "application/pdf" })]),
      );

      try {
        await component.handleConvert();

        expect(zipFile.mock.calls.map(([name]) => name)).toEqual([
          "sample_page_1.png",
          "sample_page_3.png",
        ]);
        expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "success",
            message:
              "Successfully converted 2 pages to ZIP. Page 2 could not be converted and was left out.",
          }),
        );
        expect(mocks.persistence.addJob).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({ pageCount: 2, failedPages: [2] }),
          }),
        );
      } finally {
        zipFile.mockRestore();
      }
    });

    it("downloads individual images with a proper extension and lists failed pages", async () => {
      mocks.loadPdfDocument.mockResolvedValue({ numPages: 4 });
      mocks.renderPdfPagesToImages.mockResolvedValueOnce([
        { pageNumber: 1, blob: null },
        { pageNumber: 2, blob: new Blob(["p2"]) },
        { pageNumber: 3, blob: null },
        { pageNumber: 4, blob: null },
      ]);
      const names: string[] = [];
      HTMLAnchorElement.prototype.click = vi.fn(function (this: HTMLAnchorElement) {
        names.push(this.download);
      });
      const component = await mountPdfToImage();
      await component.handleFiles(
        asFileList([new File(["pdf"], "sample.pdf", { type: "application/pdf" })]),
      );
      const mode = component.querySelector(
        'input[name="downloadMode"][value="all-individual"]',
      ) as HTMLInputElement;
      mode.checked = true;
      mode.dispatchEvent(new Event("change", { bubbles: true }));

      await component.handleConvert();

      expect(names).toEqual(["sample_page_2.png"]);
      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            "Successfully triggered download for 1 image. Pages 1, 3 and 4 could not be converted and were left out.",
        }),
      );
    });

    it("explains which pages failed when none could be converted", async () => {
      mocks.renderPdfPagesToImages.mockResolvedValueOnce([
        { pageNumber: 1, blob: null },
        { pageNumber: 2, blob: null },
      ]);
      const component = await mountPdfToImage();
      await component.handleFiles(
        asFileList([new File(["pdf"], "sample.pdf", { type: "application/pdf" })]),
      );

      await component.handleConvert();

      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          message: "Conversion failed. Your browser could not create an image of pages 1 and 2.",
        }),
      );
      expect(mocks.persistence.addJob).not.toHaveBeenCalled();
    });

    it("falls back to scale 2 for an unreadable scale and ignores bad input", async () => {
      const component = await mountPdfToImage();
      const scaleInput = component.querySelector("#scaleInput") as HTMLInputElement;
      scaleInput.value = "";
      scaleInput.dispatchEvent(new Event("change"));

      await component.handleConvert();
      expect(mocks.renderPdfPagesToImages).not.toHaveBeenCalled();

      await component.handleFiles(
        asFileList([new File(["x"], "notes.txt", { type: "text/plain" })]),
      );
      expect(mocks.persistence.set).not.toHaveBeenCalled();

      await component.handleFiles(
        asFileList([new File(["pdf"], "sample.pdf", { type: "application/pdf" })]),
      );
      await component.handleConvert();
      expect(mocks.renderPdfPagesToImages).toHaveBeenCalledWith(expect.any(Uint8Array), {
        format: "png",
        scale: 2,
      });
    });

    it("exports selected pages as individual JPEG files", async () => {
      const component = await mountPdfToImage();
      await component.handleFiles(
        asFileList([new File(["pdf"], "sample.pdf", { type: "application/pdf" })]),
      );

      (component.querySelector("#jpgBtn") as HTMLButtonElement).click();
      const firstPage = component.querySelector(".page-item") as HTMLElement;
      firstPage.click();
      const selectedMode = component.querySelector(
        'input[name="downloadMode"][value="selected-individual"]',
      ) as HTMLInputElement;
      selectedMode.checked = true;
      selectedMode.dispatchEvent(new Event("change", { bubbles: true }));

      await component.handleConvert();

      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:download");
      expect(mocks.persistence.addJob).not.toHaveBeenCalledWith(
        expect.objectContaining({ tool: "PDF to Image" }),
      );
    });

    it("updates controls and exports all pages as individual files", async () => {
      const component = await mountPdfToImage();
      await component.handleFiles(
        asFileList([new File(["pdf"], "sample.pdf", { type: "application/pdf" })]),
      );

      (component.querySelector("#jpgBtn") as HTMLButtonElement).click();
      expect(component.querySelector("#jpgBtn")?.classList.contains("active")).toBe(true);

      (component.querySelector("#pngBtn") as HTMLButtonElement).click();
      expect(component.querySelector("#pngBtn")?.classList.contains("active")).toBe(true);

      const scaleInput = component.querySelector("#scaleInput") as HTMLInputElement;
      scaleInput.value = "3";
      scaleInput.dispatchEvent(new Event("change", { bubbles: true }));

      const allIndividual = component.querySelector(
        'input[name="downloadMode"][value="all-individual"]',
      ) as HTMLInputElement;
      allIndividual.checked = true;
      allIndividual.dispatchEvent(new Event("change", { bubbles: true }));

      await component.handleConvert();

      expect(mocks.renderPdfPagesToImages).toHaveBeenCalledWith(expect.any(Uint8Array), {
        format: "png",
        scale: 3,
      });
      expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    });

    it("re-renders thumbnails, handles empty exports, and converts from the button handler", async () => {
      const component = await mountPdfToImage();
      const file = new File(["pdf"], "sample.pdf", { type: "application/pdf" });
      await component.handleFiles(asFileList([file]));

      await component.renderThumbnails();
      expect(mocks.destroyThumbnails).toHaveBeenCalled();

      (component as any).selectedFile = null;
      await expect(component.renderThumbnails()).resolves.toBeUndefined();
      (component as any).selectedFile = file;

      mocks.renderPdfPagesToImages.mockRejectedValueOnce(new Error("button failure"));
      (component.querySelector("#convertBtn") as HTMLButtonElement).click();
      await flush();
      expect(mocks.renderPdfPagesToImages).toHaveBeenCalled();

      mocks.renderPdfPagesToImages.mockResolvedValueOnce([]);
      await component.handleConvert();
      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Error", type: "error" }),
      );
    });

    it("shows and restores existing PDF-to-image sessions", async () => {
      const saved = new File(["pdf"], "saved.pdf", { type: "application/pdf" });
      mocks.persistence.get.mockResolvedValue(saved);
      const component = await mountPdfToImage();

      await component.checkExistingSession();
      expect(component.querySelector("#resumeContainer")?.classList.contains("hidden")).toBe(false);

      (component.querySelector("#resumeBtn") as HTMLButtonElement).click();
      await flush();
      expect(component.querySelector("#fileName")?.textContent).toBe("saved.pdf");
    });

    it("does not execute HTML/JS embedded in a resumed filename (stored XSS regression)", async () => {
      const maliciousName = "<img src=x onerror=window.__resumeXss=1>.pdf";
      const saved = new File(["pdf"], maliciousName, { type: "application/pdf" });
      mocks.persistence.get.mockResolvedValue(saved);
      const component = await mountPdfToImage();
      (window as any).__resumeXss = undefined;

      await component.checkExistingSession();

      const resumeBtn = component.querySelector("#resumeBtn") as HTMLElement;
      expect(resumeBtn.querySelector("img")).toBeNull();
      expect((window as any).__resumeXss).toBeUndefined();
      // Shown as typed: not run as markup and not escaped twice.
      expect(resumeBtn.textContent?.trim()).toBe(
        `Resume ${maliciousName} (${component.formatBytes(saved.size)})`,
      );
    });

    it("tolerates PDF-to-image session lookup failures", async () => {
      const component = await mountPdfToImage();

      mocks.persistence.get.mockRejectedValueOnce(new Error("lookup failed"));
      await expect(component.checkExistingSession()).resolves.toBeUndefined();
    });

    it("handles thumbnail and conversion failures", async () => {
      mocks.loadPdfDocument.mockRejectedValueOnce(new Error("preview failed"));
      const component = await mountPdfToImage();

      await component.handleFiles(
        asFileList([new File(["pdf"], "sample.pdf", { type: "application/pdf" })]),
      );
      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Preview failed", type: "error" }),
      );

      mocks.renderPdfPagesToImages.mockRejectedValueOnce(new Error("render failed"));
      await component.handleConvert();
      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Conversion failed. Please try again.",
          title: "Error",
          type: "error",
        }),
      );
    });
  });
});
