import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdfSign } from "../../components/PdfSign";

vi.mock("../../utils/persistence", () => ({
  persistence: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    addJob: vi.fn().mockResolvedValue(1),
    getJobs: vi.fn().mockResolvedValue([]),
    estimateUsage: vi.fn().mockResolvedValue(0),
    getStorageUsage: vi.fn().mockResolvedValue({ usage: 0, quota: 1000 }),
  },
}));

vi.mock("../../utils/pdfConfig", () => ({
  pdfjsLib: {
    getDocument: vi.fn().mockReturnValue({
      promise: Promise.resolve({
        numPages: 3,
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
          render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
        }),
      }),
    }),
  },
  PDFDocument: {
    load: vi.fn().mockResolvedValue({
      embedPng: vi.fn().mockResolvedValue({}),
      getPages: vi.fn().mockReturnValue([
        {
          getSize: vi.fn().mockReturnValue({ width: 612, height: 792 }),
          drawImage: vi.fn(),
        },
      ]),
      save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }),
  },
}));

describe("PdfSign", () => {
  let component: PdfSign;

  beforeEach(async () => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
    component = new PdfSign();
    document.body.appendChild(component);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const asFileList = (file: File) =>
    ({
      0: file,
      length: 1,
      item: (_index: number) => file,
    }) as unknown as FileList;

  const loadPdfForSigning = async () => {
    const file = new File(["test"], "test.pdf", { type: "application/pdf" });
    await component.handleFiles(asFileList(file));
    await new Promise((resolve) => setTimeout(resolve, 100));
    return file;
  };

  describe("render", () => {
    it("should render the sign component", async () => {
      expect(component.querySelector("h1")?.textContent).toBe("Sign PDF");
    });

    it("should render subtitle", () => {
      expect(component.querySelector(".subtitle")?.textContent).toContain("signature");
    });

    it("should have signature controls hidden initially", () => {
      expect(component.querySelector("#signLayout")?.classList.contains("hidden")).toBe(true);
    });

    it("should have drop zone visible", () => {
      expect(component.querySelector("#dropZone")).toBeTruthy();
    });
  });

  describe("finalize button", () => {
    it("should have finalize button disabled initially", () => {
      const finalizeBtn = component.querySelector("#finalizeBtn") as HTMLButtonElement;
      expect(finalizeBtn.disabled).toBe(true);
    });
  });

  describe("tab switching", () => {
    it("should switch to type tab", async () => {
      const typeTab = component.querySelector('.tab-btn[data-tab="type"]') as HTMLElement;
      typeTab.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(component.querySelector("#typeSection")?.classList.contains("hidden")).toBe(false);
      expect(component.querySelector("#drawSection")?.classList.contains("hidden")).toBe(true);
    });

    it("should switch back to draw tab", async () => {
      const typeTab = component.querySelector('.tab-btn[data-tab="type"]') as HTMLElement;
      const drawTab = component.querySelector('.tab-btn[data-tab="draw"]') as HTMLElement;

      typeTab.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      drawTab.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(component.querySelector("#drawSection")?.classList.contains("hidden")).toBe(false);
      expect(component.querySelector("#typeSection")?.classList.contains("hidden")).toBe(true);
    });

    it("should mark active tab correctly", async () => {
      const typeTab = component.querySelector('.tab-btn[data-tab="type"]') as HTMLElement;
      typeTab.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(typeTab.classList.contains("active")).toBe(true);
    });
  });

  describe("signature actions", () => {
    it("should clear signature canvas and reset state", async () => {
      const clearBtn = component.querySelector("#clearSigBtn") as HTMLButtonElement;
      clearBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(component.querySelector("#signaturePreview")?.classList.contains("hidden")).toBe(true);
      expect(component.querySelector("#signStatus")?.classList.contains("hidden")).toBe(true);
    });

    it("should save drawn signature", async () => {
      const saveSigBtn = component.querySelector("#saveSigBtn") as HTMLButtonElement;
      saveSigBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(component.querySelector("#signStatus")?.classList.contains("hidden")).toBe(false);
    });
  });

  describe("status indicators", () => {
    it("should have signature status hidden initially", () => {
      expect(component.querySelector("#signStatus")?.classList.contains("hidden")).toBe(true);
    });

    it("should have step badge visible", () => {
      expect(component.querySelector(".step-badge")?.textContent).toContain("Phase 1");
    });
  });

  describe("page navigation", () => {
    it("should have page navigation buttons", () => {
      expect(component.querySelector("#prevPage")).toBeTruthy();
      expect(component.querySelector("#nextPage")).toBeTruthy();
    });

    it("should show page indicator", () => {
      expect(component.querySelector("#pageIndicator")?.textContent).toContain("Page");
    });
  });

  describe("type signature", () => {
    it("should have name input field", () => {
      const nameInput = component.querySelector("#nameInput") as HTMLInputElement;
      expect(nameInput).toBeTruthy();
      expect(nameInput.placeholder).toContain("name");
    });

    it("should have font selector buttons", () => {
      const fontBtns = component.querySelectorAll(".font-btn");
      expect(fontBtns.length).toBe(4);
    });

    it("should switch active font on click", async () => {
      const fontBtns = component.querySelectorAll(".font-btn");
      const secondBtn = fontBtns[1] as HTMLElement;

      secondBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(secondBtn.classList.contains("active")).toBe(true);
    });

    it("should unmark previous active font", async () => {
      const fontBtns = component.querySelectorAll(".font-btn");
      const firstBtn = fontBtns[0] as HTMLElement;
      const secondBtn = fontBtns[1] as HTMLElement;

      secondBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(firstBtn.classList.contains("active")).toBe(false);
    });
  });

  describe("draw signature", () => {
    it("should have signature canvas", () => {
      const sigCanvas = component.querySelector("#sigCanvas") as HTMLCanvasElement;
      expect(sigCanvas).toBeTruthy();
    });

    it("should have save signature button", () => {
      expect(component.querySelector("#saveSigBtn")).toBeTruthy();
    });

    it("should have clear button", () => {
      expect(component.querySelector("#clearSigBtn")).toBeTruthy();
    });
  });

  describe("PDF preview", () => {
    it("should have pdf canvas", () => {
      expect(component.querySelector("#pdfCanvas")).toBeTruthy();
    });

    it("should have signature preview element", () => {
      expect(component.querySelector("#signaturePreview")).toBeTruthy();
    });
  });

  describe("controls card", () => {
    it("should have controls card", () => {
      expect(component.querySelector(".controls-card")).toBeTruthy();
    });

    it("should have signature tabs", () => {
      expect(component.querySelector(".signature-tabs")).toBeTruthy();
    });
  });

  describe("file handling", () => {
    it("should load PDF file and show sign layout", async () => {
      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      await component.handleFiles([file] as unknown as FileList);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(component.querySelector("#dropZone")?.classList.contains("hidden")).toBe(true);
      expect(component.querySelector("#signLayout")?.classList.contains("hidden")).toBe(false);
    });

    it("should update page indicator when file loads", async () => {
      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      await component.handleFiles([file] as unknown as FileList);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(component.querySelector("#pageIndicator")?.textContent).toContain("Page 1 of 3");
    });

    it("should recreate a missing preview controller before loading", async () => {
      (component as any).previewController = null;

      await loadPdfForSigning();

      expect((component as any).previewController).toBeTruthy();
    });
  });

  describe("page navigation after file load", () => {
    it("should navigate to next page", async () => {
      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      await component.handleFiles([file] as unknown as FileList);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const nextBtn = component.querySelector("#nextPage") as HTMLButtonElement;
      nextBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(component.querySelector("#pageIndicator")?.textContent).toContain("Page 2 of 3");
    });

    it("should navigate to previous page", async () => {
      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      await component.handleFiles([file] as unknown as FileList);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Go to page 2 first
      const nextBtn = component.querySelector("#nextPage") as HTMLButtonElement;
      nextBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Then go back
      const prevBtn = component.querySelector("#prevPage") as HTMLButtonElement;
      prevBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(component.querySelector("#pageIndicator")?.textContent).toContain("Page 1 of 3");
    });
  });

  describe("typed signature", () => {
    it("should update name input value", async () => {
      const nameInput = component.querySelector("#nameInput") as HTMLInputElement;
      nameInput.value = "John Doe";
      nameInput.dispatchEvent(new Event("input"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(nameInput.value).toBe("John Doe");
    });

    it("should save typed signature when button clicked", async () => {
      // Switch to type tab first
      const typeTab = component.querySelector('.tab-btn[data-tab="type"]') as HTMLElement;
      typeTab.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const nameInput = component.querySelector("#nameInput") as HTMLInputElement;
      nameInput.value = "Test Name";
      nameInput.dispatchEvent(new Event("input"));

      const saveBtn = component.querySelector("#saveTypedSigBtn") as HTMLButtonElement;
      saveBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(component.querySelector("#signStatus")?.classList.contains("hidden")).toBe(false);
    });

    it("should ignore empty typed signatures", async () => {
      const typeTab = component.querySelector('.tab-btn[data-tab="type"]') as HTMLElement;
      typeTab.click();

      const nameInput = component.querySelector("#nameInput") as HTMLInputElement;
      nameInput.value = "   ";
      const saveBtn = component.querySelector("#saveTypedSigBtn") as HTMLButtonElement;
      saveBtn.click();

      expect(component.querySelector("#signStatus")?.classList.contains("hidden")).toBe(true);
    });

    it("should handle an unavailable canvas context for typed signatures", async () => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      const typeTab = component.querySelector('.tab-btn[data-tab="type"]') as HTMLElement;
      typeTab.click();
      (component.querySelector("#nameInput") as HTMLInputElement).value = "No Context";

      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValueOnce(null) as any;
      (component.querySelector("#saveTypedSigBtn") as HTMLButtonElement).click();

      expect(component.querySelector("#signStatus")?.classList.contains("hidden")).toBe(true);
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    });
  });

  describe("startFinalize", () => {
    it("should call PDFDocument.load when finalizing", async () => {
      const { PDFDocument } = await import("../../utils/pdfConfig");
      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      await component.handleFiles([file] as unknown as FileList);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create signature
      const saveSigBtn = component.querySelector("#saveSigBtn") as HTMLButtonElement;
      saveSigBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Place signature by calling placeSignature directly
      const canvas = component.querySelector("#pdfCanvas") as HTMLCanvasElement;
      const event = new MouseEvent("click", {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      canvas.dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Enable finalize button manually since we mocked placement
      const finalizeBtn = component.querySelector("#finalizeBtn") as HTMLButtonElement;
      finalizeBtn.disabled = false;

      await component.startFinalize();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(PDFDocument.load).toHaveBeenCalled();
    });

    it("should return early when finalize data is incomplete", async () => {
      const finalizeBtn = component.querySelector("#finalizeBtn") as HTMLButtonElement;
      finalizeBtn.disabled = false;

      await component.startFinalize();

      expect(finalizeBtn.disabled).toBe(false);
      expect(component.querySelector("#progressSection")?.classList.contains("hidden")).toBe(true);
    });

    it("should surface signing errors and re-enable the finalize button", async () => {
      const { PDFDocument } = await import("../../utils/pdfConfig");
      await loadPdfForSigning();
      (component as any).signatureImage = "data:image/png;base64,abc";
      (component as any).sigPlacement = { page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
      (PDFDocument.load as any).mockRejectedValueOnce(new Error("broken pdf"));

      const finalizeBtn = component.querySelector("#finalizeBtn") as HTMLButtonElement;
      await component.startFinalize();

      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error" }),
      );
      expect(finalizeBtn.disabled).toBe(false);
    });
  });

  describe("signature clearing", () => {
    it("should hide signature preview on clear", async () => {
      const clearBtn = component.querySelector("#clearSigBtn") as HTMLButtonElement;
      clearBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(component.querySelector("#signaturePreview")?.classList.contains("hidden")).toBe(true);
    });

    it("should disable finalize button on clear", async () => {
      const clearBtn = component.querySelector("#clearSigBtn") as HTMLButtonElement;
      clearBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const finalizeBtn = component.querySelector("#finalizeBtn") as HTMLButtonElement;
      expect(finalizeBtn.disabled).toBe(true);
    });
  });

  describe("canvas elements", () => {
    it("should have signature canvas with correct attributes", () => {
      const sigCanvas = component.querySelector("#sigCanvas") as HTMLCanvasElement;
      expect(sigCanvas).toBeTruthy();
      expect(sigCanvas.width).toBeGreaterThan(0);
    });

    it("should have PDF canvas", () => {
      const pdfCanvas = component.querySelector("#pdfCanvas") as HTMLCanvasElement;
      expect(pdfCanvas).toBeTruthy();
    });
  });

  describe("methods", () => {
    it("should have startDrawing method", () => {
      expect(typeof (component as any).startDrawing).toBe("function");
    });

    it("should have stopDrawing method", () => {
      expect(typeof (component as any).stopDrawing).toBe("function");
    });

    it("should have renderPage method", () => {
      expect(typeof (component as any).renderPage).toBe("function");
    });

    it("should have handleFiles method", () => {
      expect(typeof component.handleFiles).toBe("function");
    });

    it("should delegate renderPage to the preview controller", async () => {
      const render = vi.fn().mockResolvedValue(undefined);
      (component as any).previewController = { render };

      await component.renderPage(2);

      expect(render).toHaveBeenCalledWith(2);
    });
  });

  describe("drawing and placement interactions", () => {
    it("should draw with mouse and touch input", () => {
      const sigCanvas = component.querySelector("#sigCanvas") as HTMLCanvasElement;
      Object.defineProperty(sigCanvas, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ left: 10, top: 20, width: 400, height: 200 }),
      });
      const sigContext = {
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
      };
      (component as any).sigContext = sigContext;

      component.startDrawing(new MouseEvent("mousedown", { clientX: 110, clientY: 70 }));
      component.draw(new MouseEvent("mousemove", { clientX: 210, clientY: 120 }));
      window.dispatchEvent(new MouseEvent("mouseup"));

      expect(sigContext.beginPath).toHaveBeenCalled();
      expect(sigContext.moveTo).toHaveBeenCalledWith(100, 50);
      expect(sigContext.lineTo).toHaveBeenCalledWith(200, 100);
      expect((component as any).isDrawing).toBe(false);

      const touchStart = new Event("touchstart", { bubbles: true, cancelable: true });
      Object.defineProperty(touchStart, "touches", {
        value: [{ clientX: 120, clientY: 80 }],
      });
      sigCanvas.dispatchEvent(touchStart);
      expect((component as any).isDrawing).toBe(true);

      const touchMove = new Event("touchmove", { bubbles: true, cancelable: true });
      Object.defineProperty(touchMove, "touches", {
        value: [{ clientX: 140, clientY: 90 }],
      });
      sigCanvas.dispatchEvent(touchMove);
      sigCanvas.dispatchEvent(new Event("touchend"));
      expect((component as any).isDrawing).toBe(false);
    });

    it("should place, drag, resize, and hide a signature preview on page changes", async () => {
      await loadPdfForSigning();
      (component as any).signatureImage = "data:image/png;base64,abc";
      (component as any).sigAspectRatio = 3;

      const canvas = component.querySelector("#pdfCanvas") as HTMLCanvasElement;
      const preview = component.querySelector("#signaturePreview") as HTMLElement;
      const wrapper = component.querySelector(".pdf-page-wrapper") as HTMLElement;
      Object.defineProperty(canvas, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ left: 0, top: 0, width: 300, height: 400 }),
      });
      Object.defineProperty(wrapper, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ left: 0, top: 0, width: 300, height: 400 }),
      });
      Object.defineProperty(preview, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          left: parseFloat(preview.style.left) || 60,
          top: parseFloat(preview.style.top) || 80,
          width: parseFloat(preview.style.width) || 180,
          height: parseFloat(preview.style.height) || 60,
        }),
      });

      canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 150, clientY: 200 }));
      expect(preview.classList.contains("hidden")).toBe(false);
      expect((component.querySelector("#finalizeBtn") as HTMLButtonElement).disabled).toBe(false);

      preview.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 100, clientY: 120 }),
      );
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 125, clientY: 150 }));
      expect(preview.style.cursor).toBe("grabbing");
      expect((component as any).sigPlacement).toMatchObject({ page: 1 });
      window.dispatchEvent(new MouseEvent("mouseup"));
      expect(preview.style.cursor).toBe("grab");

      const handle = preview.querySelector(".resize-handle") as HTMLElement;
      handle.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 100, clientY: 120 }),
      );
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 150, clientY: 150 }));
      expect(parseFloat(preview.style.width)).toBeGreaterThanOrEqual(30);

      component.changePage(1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(preview.classList.contains("hidden")).toBe(true);
    });

    it("should pan the PDF container and ignore panning from interactive targets", () => {
      const container = component.querySelector(".pdf-container") as HTMLElement;
      const canvas = component.querySelector("#pdfCanvas") as HTMLCanvasElement;
      Object.defineProperty(container, "offsetLeft", { configurable: true, value: 0 });
      Object.defineProperty(container, "offsetTop", { configurable: true, value: 0 });
      container.scrollLeft = 30;
      container.scrollTop = 40;

      canvas.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }),
      );
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 40, clientY: 40 }));
      expect(container.scrollLeft).toBe(30);

      container.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: 20, clientY: 25 }),
      );
      expect(container.style.cursor).toBe("grabbing");
      expect(container.scrollLeft).toBe(10);
      expect(container.scrollTop).toBe(10);

      window.dispatchEvent(new Event("mouseleave"));
      expect(container.style.cursor).toBe("crosshair");
    });
  });

  describe("session and error handling", () => {
    it("should show and restore a saved signing session", async () => {
      const { persistence } = await import("../../utils/persistence");
      const saved = new File(["saved"], "saved.pdf", { type: "application/pdf" });
      (persistence.get as any).mockResolvedValueOnce(saved);

      await component.checkExistingSession();

      expect(component.querySelector("#resumeContainer")?.classList.contains("hidden")).toBe(false);
      expect(component.querySelector("#resumeBtn")?.textContent).toContain("saved.pdf");

      (persistence.get as any).mockResolvedValueOnce(saved);
      const handleSpy = vi.spyOn(component, "handleFiles").mockResolvedValue(undefined);
      await component.restoreSession();

      expect(handleSpy).toHaveBeenCalledWith([saved]);
    });

    it("should tolerate session lookup, restore, and save failures", async () => {
      const { persistence } = await import("../../utils/persistence");

      (persistence.get as any).mockRejectedValueOnce(new Error("lookup failed"));
      await expect(component.checkExistingSession()).resolves.toBeUndefined();

      (persistence.get as any).mockRejectedValueOnce(new Error("restore failed"));
      await expect(component.restoreSession()).resolves.toBeUndefined();

      (component as any).selectedFile = new File(["pdf"], "state.pdf", { type: "application/pdf" });
      (persistence.set as any).mockRejectedValueOnce(new Error("save failed"));
      await expect(component.saveSession()).resolves.toBeUndefined();
    });

    it("should ignore saveSession when no PDF is selected", async () => {
      const { persistence } = await import("../../utils/persistence");
      await component.saveSession();

      expect(persistence.set).not.toHaveBeenCalledWith("pdf-sign", expect.any(File));
    });

    it("should reject invalid files and show preview load errors", async () => {
      const { pdfjsLib } = await import("../../utils/pdfConfig");
      const invalid = new File(["text"], "notes.txt", { type: "text/plain" });
      await component.handleFiles(asFileList(invalid));
      expect((component as any).selectedFile).toBeNull();

      (pdfjsLib.getDocument as any).mockReturnValueOnce({
        promise: Promise.reject(new Error("preview failed")),
      });
      await component.handleFiles(
        asFileList(new File(["pdf"], "broken.pdf", { type: "application/pdf" })),
      );

      expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error" }),
      );
    });

    it("should return null when preview controller targets are missing", () => {
      component.querySelector("#pdfCanvas")?.remove();

      expect((component as any).createPreviewController()).toBeNull();
    });
  });
});
