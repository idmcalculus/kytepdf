import { describe, it, expect, beforeEach, vi } from "vitest";
// @ts-ignore
import { PdfEditor } from "../../components/PdfEditor";

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
});
