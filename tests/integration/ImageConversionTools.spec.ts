import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearPreviewLoadingState: vi.fn(),
  convertImagesToPdf: vi.fn(),
  convertPdfToImages: vi.fn(),
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
  convertPdfToImages: mocks.convertPdfToImages,
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
    mocks.convertPdfToImages.mockResolvedValue([
      new Blob(["page-1"], { type: "image/png" }),
      new Blob(["page-2"], { type: "image/png" }),
    ]);
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

      component.handleFiles(asFileList(files));
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
      component.handleFiles(asFileList([one, two, three]));

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
      component.handleFiles(asFileList([new File(["a"], "one.png", { type: "image/png" })]));

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

      component.handleFiles(asFileList([new File(["a"], "one.png", { type: "image/png" })]));
      mocks.convertImagesToPdf.mockRejectedValueOnce(new Error("bad image"));

      await component.startConversion();

      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Error", type: "error" }),
      );
      expect((component.querySelector("#convertBtn") as HTMLButtonElement).disabled).toBe(false);
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
      expect(mocks.convertPdfToImages).not.toHaveBeenCalled();
    });

    it("exports all pages as a ZIP and records the job", async () => {
      const component = await mountPdfToImage();
      await component.handleFiles(
        asFileList([new File(["pdf"], "sample.pdf", { type: "application/pdf" })]),
      );

      await component.handleConvert();

      expect(mocks.convertPdfToImages).toHaveBeenCalledWith(expect.any(Uint8Array), {
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

      expect(mocks.convertPdfToImages).toHaveBeenCalledWith(expect.any(Uint8Array), {
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

      mocks.convertPdfToImages.mockRejectedValueOnce(new Error("button failure"));
      (component.querySelector("#convertBtn") as HTMLButtonElement).click();
      await flush();
      expect(mocks.convertPdfToImages).toHaveBeenCalled();

      mocks.convertPdfToImages.mockResolvedValueOnce([]);
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
        expect.objectContaining({ message: "An unexpected error occurred.", type: "error" }),
      );

      mocks.convertPdfToImages.mockRejectedValueOnce(new Error("render failed"));
      await component.handleConvert();
      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "An unexpected error occurred.",
          title: "Error",
          type: "error",
        }),
      );
    });
  });
});
