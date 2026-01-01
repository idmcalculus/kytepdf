import { beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error
import { PdfEditor } from "../../components/pdf-editor/PdfEditor";

// Mock persistence
vi.mock("../../utils/persistence", () => ({
  persistence: {
    estimateUsage: vi.fn().mockResolvedValue(0),
    getJobs: vi.fn().mockResolvedValue([]),
    getStorageUsage: vi.fn().mockResolvedValue({ usage: 0, quota: 1000 }),
  },
}));

// Mock pdfRenderer
vi.mock("../../utils/pdfRenderer", () => ({
  loadPdf: vi.fn().mockResolvedValue({
    numPages: 2,
    getPage: vi.fn().mockResolvedValue({
      getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
    }),
  }),
  renderPage: vi.fn(),
}));

describe("PdfEditor", () => {
  let editor: PdfEditor;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);

    // We assume customElements.define has run because we import the file
    editor = new PdfEditor();
    document.body.appendChild(editor);
  });

  it("should be defined", () => {
    expect(editor).toBeDefined();
  });

  it("should load and render PDF on file handle", async () => {
    const { loadPdf, renderPage } = await import("../../utils/pdfRenderer");

    const file = new File(["dummy content"], "test.pdf", { type: "application/pdf" });
    const fileList = {
      0: file,
      length: 1,
      item: (_index: number) => file,
    } as unknown as FileList;

    await editor.handleFiles(fileList);

    expect(loadPdf).toHaveBeenCalled();
    // Since handleFiles is async void, we might need to wait, but the mock is resolved immediately.
    // However, the component method is async.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // We expect it to render 2 pages (from mock)
    expect(renderPage).toHaveBeenCalledTimes(2);
  });

  it("should navigate back to dashboard when back button is clicked", async () => {
    const dispatchSpy = vi.spyOn(editor, "dispatchEvent");
    const backBtn = editor.querySelector("#backToDash") as HTMLElement;
    expect(backBtn).toBeTruthy();

    backBtn.click();

    const backEvents = dispatchSpy.mock.calls.filter(
      (call) => call[0]?.type === "back-to-dashboard",
    );
    expect(backEvents.length).toBe(1);
  });

  it("should trigger file input when drop zone is clicked", async () => {
    const fileInput = editor.querySelector("#fileInput") as HTMLInputElement;
    const dropZone = editor.querySelector("#dropZone") as HTMLElement;
    expect(fileInput).toBeTruthy();
    expect(dropZone).toBeTruthy();

    const clickSpy = vi.spyOn(fileInput, "click");
    dropZone.click();

    expect(clickSpy).toHaveBeenCalled();
  });

  it("should create a text annotation when clicking page with Add Text tool active", async () => {
    // 1. Load file to show editor interface
    const file = new File(["dummy"], "test.pdf", { type: "application/pdf" });
    await editor.handleFiles({ 0: file, length: 1, item: () => file } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 2. Select Add Text tool
    const addTextBtn = editor.querySelector("#addTextBtn") as HTMLElement;
    addTextBtn.click();

    // 3. Simulate click on a page
    const pdfContainer = editor.querySelector("#pdfContainer") as HTMLElement;
    const pageWrapper = pdfContainer.querySelector(".pdf-page-wrapper") as HTMLElement;
    expect(pageWrapper).toBeTruthy();

    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      clientX: 100,
      clientY: 100,
    });
    pageWrapper.dispatchEvent(clickEvent);

    // handleSmartMatch is async
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 4. Verify annotation was added to manager
    // We need to check if the component has an annotationManager property
    const annotations = (editor as any).annotationManager.getAllAnnotations();
    expect(annotations.length).toBe(1);
    expect(annotations[0].type).toBe("text");
  });

  it("should create a rectangle annotation when clicking page with Rectangle tool active", async () => {
    const file = new File(["dummy"], "test.pdf", { type: "application/pdf" });
    await editor.handleFiles({ 0: file, length: 1, item: () => file } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Select Rectangle tool
    const addRectBtn = editor.querySelector("#addRectBtn") as HTMLElement;
    addRectBtn.click();

    // Simulate click on a page
    const pdfContainer = editor.querySelector("#pdfContainer") as HTMLElement;
    const pageWrapper = pdfContainer.querySelector(".pdf-page-wrapper") as HTMLElement;

    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      clientX: 50,
      clientY: 50,
    });
    pageWrapper.dispatchEvent(clickEvent);

    const annotations = (editor as any).annotationManager.getAllAnnotations();
    expect(annotations.find((a: any) => a.type === "rectangle")).toBeDefined();
  });

  it("should create a freehand annotation when drawing with Freehand tool active", async () => {
    const file = new File(["dummy"], "test.pdf", { type: "application/pdf" });
    await editor.handleFiles({ 0: file, length: 1, item: () => file } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const freehandBtn = editor.querySelector("#addFreehandBtn") as HTMLElement;
    freehandBtn.click();

    const pdfContainer = editor.querySelector("#pdfContainer") as HTMLElement;
    const pageWrapper = pdfContainer.querySelector(".pdf-page-wrapper") as HTMLElement;

    pageWrapper.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 20, clientY: 20 }),
    );
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 60, clientY: 40 }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 80, clientY: 50 }));

    const annotations = (editor as any).annotationManager.getAllAnnotations();
    expect(annotations.find((a: any) => a.type === "freehand")).toBeDefined();
  });

  it("should create a highlight annotation when drawing with Highlight tool active", async () => {
    const file = new File(["dummy"], "test.pdf", { type: "application/pdf" });
    await editor.handleFiles({ 0: file, length: 1, item: () => file } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const highlightBtn = editor.querySelector("#addHighlightBtn") as HTMLElement;
    highlightBtn.click();

    const pdfContainer = editor.querySelector("#pdfContainer") as HTMLElement;
    const pageWrapper = pdfContainer.querySelector(".pdf-page-wrapper") as HTMLElement;

    pageWrapper.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 30, clientY: 30 }),
    );
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 90, clientY: 50 }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 90, clientY: 50 }));

    const annotations = (editor as any).annotationManager.getAllAnnotations();
    expect(annotations.find((a: any) => a.type === "highlight")).toBeDefined();
  });

  it("should update highlight color via properties panel", async () => {
    const file = new File(["dummy"], "test.pdf", { type: "application/pdf" });
    await editor.handleFiles({ 0: file, length: 1, item: () => file } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const highlightBtn = editor.querySelector("#addHighlightBtn") as HTMLElement;
    highlightBtn.click();

    const pdfContainer = editor.querySelector("#pdfContainer") as HTMLElement;
    const pageWrapper = pdfContainer.querySelector(".pdf-page-wrapper") as HTMLElement;

    pageWrapper.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 30, clientY: 30 }),
    );
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 90, clientY: 50 }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 90, clientY: 50 }));

    const highlightEl = editor.querySelector(".annotation-highlight") as HTMLElement;
    highlightEl.focus();

    const colorPicker = editor.querySelector("#highlightColorPicker") as HTMLInputElement;
    colorPicker.value = "#ff0000";
    colorPicker.dispatchEvent(new Event("input", { bubbles: true }));

    const annotations = (editor as any).annotationManager.getAllAnnotations();
    const highlight = annotations.find((a: any) => a.type === "highlight");
    expect(highlight?.style?.color).toBe("#ff0000");
  });

  it("should create a strikethrough annotation when drawing with Strikethrough tool active", async () => {
    const file = new File(["dummy"], "test.pdf", { type: "application/pdf" });
    await editor.handleFiles({ 0: file, length: 1, item: () => file } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const strikeBtn = editor.querySelector("#addStrikeBtn") as HTMLElement;
    strikeBtn.click();

    const pdfContainer = editor.querySelector("#pdfContainer") as HTMLElement;
    const pageWrapper = pdfContainer.querySelector(".pdf-page-wrapper") as HTMLElement;

    pageWrapper.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 40, clientY: 40 }),
    );
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 120, clientY: 42 }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 120, clientY: 42 }));

    const annotations = (editor as any).annotationManager.getAllAnnotations();
    expect(annotations.find((a: any) => a.type === "strikethrough")).toBeDefined();
  });

  it("should create an underline annotation when drawing with Underline tool active", async () => {
    const file = new File(["dummy"], "test.pdf", { type: "application/pdf" });
    await editor.handleFiles({ 0: file, length: 1, item: () => file } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const underlineBtn = editor.querySelector("#addUnderlineBtn") as HTMLElement;
    underlineBtn.click();

    const pdfContainer = editor.querySelector("#pdfContainer") as HTMLElement;
    const pageWrapper = pdfContainer.querySelector(".pdf-page-wrapper") as HTMLElement;

    pageWrapper.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 45, clientY: 60 }),
    );
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 140, clientY: 62 }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 140, clientY: 62 }));

    const annotations = (editor as any).annotationManager.getAllAnnotations();
    expect(annotations.find((a: any) => a.type === "underline")).toBeDefined();
  });

  it("should trigger undo on Ctrl+Z", () => {
    const historyManager = (editor as any).historyManager;
    const undoSpy = vi.spyOn(historyManager, "undo").mockReturnValue(null);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));

    expect(undoSpy).toHaveBeenCalledTimes(1);
  });

  it("should trigger redo on Ctrl+Shift+Z", () => {
    const historyManager = (editor as any).historyManager;
    const redoSpy = vi.spyOn(historyManager, "redo").mockReturnValue(null);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true }));

    expect(redoSpy).toHaveBeenCalledTimes(1);
  });

  it("should support Cmd shortcuts for undo and redo", () => {
    const historyManager = (editor as any).historyManager;
    const undoSpy = vi.spyOn(historyManager, "undo").mockReturnValue(null);
    const redoSpy = vi.spyOn(historyManager, "redo").mockReturnValue(null);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, shiftKey: true }));

    expect(undoSpy).toHaveBeenCalledTimes(1);
    expect(redoSpy).toHaveBeenCalledTimes(1);
  });
});
