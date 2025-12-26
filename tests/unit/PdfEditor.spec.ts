import { describe, it, expect, beforeEach, vi } from "vitest";
// @ts-ignore
import { PdfEditor } from "../../components/pdf-editor/PdfEditor";

// Mock persistence
vi.mock("../../utils/persistence", () => ({
  persistence: {
    estimateUsage: vi.fn().mockResolvedValue(0),
    getJobs: vi.fn().mockResolvedValue([]),
    getStorageUsage: vi.fn().mockResolvedValue({ usage: 0, quota: 1000 }),
  }
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
      item: (index: number) => file,
    } as unknown as FileList;

    await editor.handleFiles(fileList);
    
    expect(loadPdf).toHaveBeenCalled();
    // Since handleFiles is async void, we might need to wait, but the mock is resolved immediately.
    // However, the component method is async.
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // We expect it to render 2 pages (from mock)
    expect(renderPage).toHaveBeenCalledTimes(2);
  });

  it("should navigate back to dashboard when back button is clicked", async () => {
    const dispatchSpy = vi.spyOn(editor, "dispatchEvent");
    const backBtn = editor.querySelector("#backToDash") as HTMLElement;
    expect(backBtn).toBeTruthy();

    backBtn.click();
    
    const backEvents = dispatchSpy.mock.calls.filter(
      call => call[0]?.type === "back-to-dashboard"
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
    await new Promise(resolve => setTimeout(resolve, 0));

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
      clientY: 100
    });
    pageWrapper.dispatchEvent(clickEvent);

    // handleSmartMatch is async
    await new Promise(resolve => setTimeout(resolve, 50));

    // 4. Verify annotation was added to manager
    // We need to check if the component has an annotationManager property
    const annotations = (editor as any).annotationManager.getAllAnnotations();
    expect(annotations.length).toBe(1);
    expect(annotations[0].type).toBe('text');
  });

  it("should create a rectangle annotation when clicking page with Rectangle tool active", async () => {
    const file = new File(["dummy"], "test.pdf", { type: "application/pdf" });
    await editor.handleFiles({ 0: file, length: 1, item: () => file } as any);
    await new Promise(resolve => setTimeout(resolve, 0));

    // Select Rectangle tool
    const addRectBtn = editor.querySelector("#addRectBtn") as HTMLElement;
    addRectBtn.click();

    // Simulate click on a page
    const pdfContainer = editor.querySelector("#pdfContainer") as HTMLElement;
    const pageWrapper = pdfContainer.querySelector(".pdf-page-wrapper") as HTMLElement;
    
    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      clientX: 50,
      clientY: 50
    });
    pageWrapper.dispatchEvent(clickEvent);

    const annotations = (editor as any).annotationManager.getAllAnnotations();
    expect(annotations.find((a: any) => a.type === 'rectangle')).toBeDefined();
  });
});
