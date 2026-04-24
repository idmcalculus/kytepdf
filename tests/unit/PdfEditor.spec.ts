import { beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error
import { PdfEditor } from "../../components/pdf-editor/PdfEditor";
import { embedAllAnnotations } from "../../utils/pdfEngine";
import { loadPdf } from "../../utils/pdfRenderer";

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

vi.mock("../../utils/pdfEngine", () => ({
  embedAllAnnotations: vi.fn().mockResolvedValue(new Uint8Array([9, 8, 7])),
}));

vi.mock("../../utils/taskScheduler", () => ({
  yieldToMain: vi.fn().mockResolvedValue(undefined),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const pdfFile = () => new File(["dummy content"], "test.pdf", { type: "application/pdf" });

const asFileList = (file: File) =>
  ({
    0: file,
    length: 1,
    item: (_index: number) => file,
  }) as unknown as FileList;

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

  const loadEditor = async () => {
    const file = pdfFile();
    await editor.handleFiles(asFileList(file));
    await flush();
    return file;
  };

  const addRenderedAnnotation = async (annotation: any) => {
    await loadEditor();
    const id = (editor as any).annotationManager.addAnnotation(annotation, {
      recordHistory: false,
    });
    (editor as any).renderAnnotation(id);
    await flush();
    return id;
  };

  const setInputValue = (selector: string, value: string, eventName = "input") => {
    const input = editor.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
    input.value = value;
    input.dispatchEvent(new Event(eventName, { bubbles: true }));
    return input;
  };

  it("should be defined", () => {
    expect(editor).toBeDefined();
  });

  it("should load and render PDF on file handle", async () => {
    const { loadPdf, renderPage } = await import("../../utils/pdfRenderer");

    const file = pdfFile();

    await editor.handleFiles(asFileList(file));

    expect(loadPdf).toHaveBeenCalled();
    // Since handleFiles is async void, we might need to wait, but the mock is resolved immediately.
    // However, the component method is async.
    await flush();

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
    await loadEditor();

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
    await loadEditor();

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
    await loadEditor();

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
    await loadEditor();

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
    await loadEditor();

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
    await loadEditor();

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
    await loadEditor();

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

  it("should route image upload through the image tool and update image properties", async () => {
    await loadEditor();

    const imageInput = editor.querySelector("#imageInput") as HTMLInputElement;
    const imageInputClick = vi.spyOn(imageInput, "click");
    (editor.querySelector("#addImageBtn") as HTMLButtonElement).click();
    expect(imageInputClick).toHaveBeenCalled();

    const upload = new File(["image"], "stamp.png", { type: "image/png" });
    Object.defineProperty(imageInput, "files", {
      value: asFileList(upload),
      configurable: true,
    });
    imageInput.dispatchEvent(new Event("change", { bubbles: true }));
    await (editor as any).tools.get("addImageBtn").handleUpload(upload);
    await flush();

    const image = (editor as any).annotationManager
      .getAllAnnotations()
      .find((annotation: any) => annotation.type === "image");
    expect(image).toBeDefined();

    const imageEl = editor.querySelector(`.annotation[data-id="${image.id}"]`) as HTMLElement;
    imageEl.focus();

    setInputValue("#imageOpacityInput", "0.4");
    (editor.querySelector("#rotateLeftBtn") as HTMLButtonElement).click();
    (editor.querySelector("#rotateRightBtn") as HTMLButtonElement).click();
    (editor.querySelector("#zoomInBtn") as HTMLButtonElement).click();
    (editor.querySelector("#zoomOutBtn") as HTMLButtonElement).click();
    (editor.querySelector("#resetImageBtn") as HTMLButtonElement).click();

    const updated = (editor as any).annotationManager.getAnnotation(image.id);
    expect(updated.style.opacity).toBe(0.4);
    expect(updated.style.rotation).toBe(0);
    expect(updated.width).toBe(150);
    expect(updated.height).toBe(150);

    (editor.querySelector("#closePanelBtn") as HTMLButtonElement).click();
    expect(editor.querySelector("#propertiesPanel")?.classList.contains("hidden")).toBe(true);
  });

  it("should update text, rectangle, line, and highlight annotations from property controls", async () => {
    await loadEditor();
    const manager = (editor as any).annotationManager;

    const textId = manager.addAnnotation(
      {
        type: "text",
        pageIndex: 0,
        x: 10,
        y: 10,
        content: "Hello",
        style: { fontSize: 12, color: "#111111", font: "Helvetica" },
      },
      { recordHistory: false },
    );
    (editor as any).renderAnnotation(textId);
    const textEl = editor.querySelector(`.annotation[data-id="${textId}"]`)
      ?.firstElementChild as HTMLElement;
    textEl.setAttribute("contenteditable", "true");
    textEl.focus();
    (editor as any).selectedAnnotationId = textId;
    setInputValue("#fontFamilySelect", "Courier", "change");
    setInputValue("#fontSizeInput", "22");
    setInputValue("#colorPicker", "#123456");
    expect(manager.getAnnotation(textId).style).toMatchObject({
      font: "Courier",
      fontSize: 22,
      color: "#123456",
    });

    const rectangleId = manager.addAnnotation(
      {
        type: "rectangle",
        pageIndex: 0,
        x: 20,
        y: 20,
        width: 100,
        height: 50,
        style: { color: "#ffffff", strokeWidth: 1, opacity: 1 },
      },
      { recordHistory: false },
    );
    (editor as any).renderAnnotation(rectangleId);
    (editor.querySelector(`.annotation[data-id="${rectangleId}"]`) as HTMLElement).focus();
    setInputValue("#shapeFillPicker", "#00ff00");
    setInputValue("#shapeBorderInput", "4");
    setInputValue("#shapeOpacityInput", "0.6");
    expect(manager.getAnnotation(rectangleId).style).toMatchObject({
      color: "#00ff00",
      strokeWidth: 4,
      opacity: 0.6,
    });

    const freehandId = manager.addAnnotation(
      {
        type: "freehand",
        pageIndex: 0,
        x: 30,
        y: 30,
        width: 80,
        height: 50,
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 10 },
        ],
        style: { color: "#111827", strokeWidth: 2, opacity: 1 },
      },
      { recordHistory: false },
    );
    (editor as any).renderAnnotation(freehandId);
    (editor.querySelector(`.annotation[data-id="${freehandId}"]`) as HTMLElement).focus();
    setInputValue("#lineColorPicker", "#ff00ff");
    setInputValue("#lineWidthInput", "5");
    setInputValue("#lineOpacityInput", "0.5");
    expect(manager.getAnnotation(freehandId).style).toMatchObject({
      color: "#ff00ff",
      strokeWidth: 5,
      opacity: 0.5,
    });

    const underlineId = manager.addAnnotation(
      {
        type: "underline",
        pageIndex: 0,
        x: 40,
        y: 40,
        width: 80,
        height: 12,
        style: { color: "#111827", strokeWidth: 2, opacity: 1 },
      },
      { recordHistory: false },
    );
    (editor as any).renderAnnotation(underlineId);
    (editor.querySelector(`.annotation[data-id="${underlineId}"]`) as HTMLElement).focus();
    setInputValue("#lineWidthInput", "6");
    expect(manager.getAnnotation(underlineId).style.strokeWidth).toBe(6);

    const highlightId = manager.addAnnotation(
      {
        type: "highlight",
        pageIndex: 0,
        x: 50,
        y: 50,
        width: 100,
        height: 24,
        style: { color: "#ffff00", opacity: 0.3 },
      },
      { recordHistory: false },
    );
    (editor as any).renderAnnotation(highlightId);
    (editor.querySelector(`.annotation[data-id="${highlightId}"]`) as HTMLElement).focus();
    setInputValue("#highlightColorPicker", "#00ffff");
    setInputValue("#highlightOpacityInput", "0.7");
    expect(manager.getAnnotation(highlightId).style).toMatchObject({
      color: "#00ffff",
      opacity: 0.7,
    });
  });

  it("should apply history actions for add, remove, and update operations", async () => {
    await loadEditor();
    const manager = (editor as any).annotationManager;
    const state = {
      id: "history-text",
      type: "text",
      pageIndex: 0,
      x: 10,
      y: 10,
      content: "Before",
      style: { fontSize: 12, color: "#000000" },
    };
    const updatedState = {
      ...state,
      x: 30,
      y: 40,
      content: "After",
      style: { fontSize: 16, color: "#333333" },
    };

    manager.addAnnotation(state, { id: state.id, recordHistory: false });
    (editor as any).renderAnnotation(state.id);

    (editor as any).applyHistoryAction(
      {
        type: "add",
        annotationId: state.id,
        previousState: null,
        newState: state,
        timestamp: Date.now(),
      },
      "undo",
    );
    expect(manager.getAnnotation(state.id)).toBeUndefined();

    (editor as any).applyHistoryAction(
      {
        type: "add",
        annotationId: state.id,
        previousState: null,
        newState: state,
        timestamp: Date.now(),
      },
      "redo",
    );
    expect(manager.getAnnotation(state.id)).toBeDefined();

    (editor as any).applyHistoryAction(
      {
        type: "remove",
        annotationId: state.id,
        previousState: state,
        newState: null,
        timestamp: Date.now(),
      },
      "redo",
    );
    expect(manager.getAnnotation(state.id)).toBeUndefined();

    (editor as any).applyHistoryAction(
      {
        type: "remove",
        annotationId: state.id,
        previousState: state,
        newState: null,
        timestamp: Date.now(),
      },
      "undo",
    );
    expect(manager.getAnnotation(state.id)).toBeDefined();

    (editor as any).applyHistoryAction(
      {
        type: "update",
        annotationId: state.id,
        previousState: state,
        newState: updatedState,
        timestamp: Date.now(),
      },
      "redo",
    );
    expect(manager.getAnnotation(state.id)).toMatchObject({
      x: 30,
      y: 40,
      content: "After",
    });

    (editor as any).applyHistoryAction(
      {
        type: "update",
        annotationId: state.id,
        previousState: null,
        newState: null,
        timestamp: Date.now(),
      },
      "redo",
    );
    expect(manager.getAnnotation(state.id).content).toBe("After");
  });

  it("should preserve and restore text selection around history controls", async () => {
    const id = await addRenderedAnnotation({
      type: "text",
      pageIndex: 0,
      x: 10,
      y: 10,
      content: "Selection text",
      style: { fontSize: 12, color: "#000000" },
    });

    const textEl = editor.querySelector(`.annotation[data-id="${id}"]`)
      ?.firstElementChild as HTMLElement;
    textEl.textContent = "Selection text";
    textEl.setAttribute("contenteditable", "true");
    Object.defineProperty(textEl, "isContentEditable", { value: true, configurable: true });
    const range = document.createRange();
    range.setStart(textEl.firstChild as Node, 0);
    range.setEnd(textEl.firstChild as Node, 9);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    const snapshot = (editor as any).captureTextSelectionSnapshot();
    expect(snapshot).toMatchObject({ annotationId: id, start: 0, end: 9 });

    (editor.querySelector("#undoBtn") as HTMLButtonElement).dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    expect((editor as any).pendingTextSelection).toMatchObject({ annotationId: id });

    (editor as any).restorePendingTextSelection();
    await flush();
    expect(window.getSelection()?.toString()).toBe("Selection");

    textEl.textContent = "";
    const emptyRange = document.createRange();
    (editor as any).setRangeByOffsets(textEl, emptyRange, 0, 0);
    expect(emptyRange.startContainer).toBe(textEl);
  });

  it("should ignore history shortcuts while typing in form fields", () => {
    const historyManager = (editor as any).historyManager;
    const undoSpy = vi.spyOn(historyManager, "undo").mockReturnValue(null);
    const input = editor.querySelector("#fontSizeInput") as HTMLInputElement;
    input.focus();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));

    expect(undoSpy).not.toHaveBeenCalled();
  });

  it("should remove selected annotations from delete shortcuts and delete buttons", async () => {
    const id = await addRenderedAnnotation({
      type: "rectangle",
      pageIndex: 0,
      x: 10,
      y: 10,
      width: 80,
      height: 40,
      style: { color: "#ffffff", strokeWidth: 1, opacity: 1 },
    });

    const annotationEl = editor.querySelector(`.annotation[data-id="${id}"]`) as HTMLElement;
    annotationEl.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
    expect((editor as any).annotationManager.getAnnotation(id)).toBeUndefined();

    const secondId = (editor as any).annotationManager.addAnnotation(
      {
        type: "rectangle",
        pageIndex: 0,
        x: 10,
        y: 10,
        width: 80,
        height: 40,
        style: { color: "#ffffff", strokeWidth: 1, opacity: 1 },
      },
      { recordHistory: false },
    );
    (editor as any).renderAnnotation(secondId);
    (
      editor.querySelector(
        `.annotation[data-id="${secondId}"] .ann-delete-btn`,
      ) as HTMLButtonElement
    ).click();
    expect((editor as any).annotationManager.getAnnotation(secondId)).toBeUndefined();
  });

  it("should record drag and resize history for transformed annotations", async () => {
    const id = await addRenderedAnnotation({
      type: "rectangle",
      pageIndex: 0,
      x: 10,
      y: 10,
      width: 80,
      height: 40,
      style: { color: "#ffffff", strokeWidth: 1, opacity: 1 },
    });

    const annotationEl = editor.querySelector(`.annotation[data-id="${id}"]`) as HTMLElement;
    Object.defineProperty(annotationEl, "offsetWidth", { value: 80, configurable: true });
    Object.defineProperty(annotationEl, "offsetHeight", { value: 40, configurable: true });

    const resizer = annotationEl.querySelector(".resizer") as HTMLElement;
    resizer.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 30, clientY: 25 }));
    document.dispatchEvent(new MouseEvent("mouseup"));
    expect((editor as any).annotationManager.getAnnotation(id)).toMatchObject({
      width: 100,
      height: 55,
    });

    annotationEl.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }),
    );
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 25, clientY: 35 }));
    document.dispatchEvent(new MouseEvent("mouseup"));
    expect((editor as any).annotationManager.getAnnotation(id)).toMatchObject({
      x: 25,
      y: 35,
    });
    expect((editor as any).historyManager.canUndo()).toBe(true);
  });

  it("should save embedded annotations and report cancellation or failures", async () => {
    const file = await loadEditor();
    const manager = (editor as any).annotationManager;
    manager.addAnnotation(
      {
        type: "text",
        pageIndex: 0,
        x: 160,
        y: 80,
        width: 120,
        height: 30,
        content: "Scaled text",
        style: { fontSize: 20, color: "#000000", strokeWidth: 4 },
      },
      { recordHistory: false },
    );
    manager.addAnnotation(
      {
        type: "freehand",
        pageIndex: 0,
        x: 40,
        y: 40,
        width: 40,
        height: 20,
        points: [{ x: 20, y: 10 }],
        style: { color: "#111111", strokeWidth: 2 },
      },
      { recordHistory: false },
    );
    const savePdf = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const recordJob = vi.fn().mockResolvedValue(undefined);
    (editor as any).savePdf = savePdf;
    (editor as any).recordJob = recordJob;

    await editor.handleSave();

    expect(embedAllAnnotations).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.arrayContaining([
        expect.objectContaining({
          x: 20,
          y: 10,
          style: expect.objectContaining({ fontSize: 2.5, strokeWidth: 0.5 }),
        }),
      ]),
    );
    expect(savePdf).toHaveBeenCalledWith(new Uint8Array([9, 8, 7]), file.name, "_edited");
    expect(recordJob).toHaveBeenCalledWith("Edit", file.name, new Uint8Array([9, 8, 7]), {
      annotationCount: 2,
    });

    await editor.handleSave();
    expect((editor.querySelector("#statusText") as HTMLElement).textContent).toBe("Save cancelled");

    vi.mocked(embedAllAnnotations).mockRejectedValueOnce(new Error("embed failed"));
    await editor.handleSave();
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" }),
    );
  });

  it("should handle empty, invalid, and failed loads without rendering", async () => {
    await editor.handleFiles({ length: 0 } as FileList);
    expect((editor as any).selectedFile).toBeNull();

    const invalid = new File(["text"], "notes.txt", { type: "text/plain" });
    await editor.handleFiles(asFileList(invalid));
    expect((editor as any).selectedFile).toBeNull();

    vi.mocked(loadPdf).mockRejectedValueOnce(new Error("bad pdf"));
    await editor.handleFiles(asFileList(pdfFile()));
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" }),
    );

    const container = editor.querySelector("#pdfContainer") as HTMLElement;
    container.remove();
    await (editor as any).renderPages();
    expect(container.isConnected).toBe(false);
  });
});
