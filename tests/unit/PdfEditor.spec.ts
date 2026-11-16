import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error
import { PdfEditor } from "../../components/pdf-editor/PdfEditor";
import { imageExtractor } from "../../utils/ImageExtractor";
import { embedAllAnnotations } from "../../utils/pdfEngine";
import { loadPdf, renderPage } from "../../utils/pdfRenderer";
import { EDITOR_FONTS } from "../../utils/richText";
import { type TextBlock, textBlockExtractor } from "../../utils/TextBlockExtractor";

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
      getViewport: vi.fn().mockReturnValue({
        width: 100,
        height: 100,
        convertToPdfPoint: (x: number, y: number) => [x, 100 - y],
      }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
    }),
  }),
  renderPage: vi.fn(),
}));

vi.mock("../../utils/pdfEngine", () => ({
  embedAllAnnotations: vi.fn().mockResolvedValue(new Uint8Array([9, 8, 7])),
  EXTRACTED_WHITEOUT_PADDING_PT: 1,
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

  it("should only drag text boxes from their edges", async () => {
    const id = await addRenderedAnnotation({
      type: "textblock",
      pageIndex: 0,
      x: 10,
      y: 10,
      width: 120,
      height: 50,
      content: "Editable text",
      richContent: "Editable text",
      style: { fontSize: 12, color: "#000000", lineHeight: 1.2 },
    });

    const annotationEl = editor.querySelector(`.annotation[data-id="${id}"]`) as HTMLElement;
    const textEl = annotationEl.querySelector("[contenteditable]") as HTMLElement;
    Object.defineProperty(annotationEl, "offsetWidth", { value: 120, configurable: true });
    Object.defineProperty(annotationEl, "offsetHeight", { value: 50, configurable: true });
    Object.defineProperty(annotationEl, "getBoundingClientRect", {
      value: () => ({
        bottom: 60,
        height: 50,
        left: 10,
        right: 130,
        top: 10,
        width: 120,
        x: 10,
        y: 10,
        toJSON: () => ({}),
      }),
      configurable: true,
    });

    textEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 70, clientY: 35 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 55 }));
    document.dispatchEvent(new MouseEvent("mouseup"));
    expect((editor as any).annotationManager.getAnnotation(id)).toMatchObject({ x: 10, y: 10 });

    textEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 12, clientY: 12 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 42, clientY: 32 }));
    document.dispatchEvent(new MouseEvent("mouseup"));
    expect((editor as any).annotationManager.getAnnotation(id)).toMatchObject({ x: 40, y: 30 });
  });

  it("should render text box spacing and line-height guides while editing", async () => {
    await loadEditor();
    const manager = (editor as any).annotationManager;
    const firstId = manager.addAnnotation(
      {
        type: "textblock",
        pageIndex: 0,
        x: 80,
        y: 80,
        width: 160,
        height: 48,
        content: "First line\nSecond line",
        richContent: "First line<br>Second line",
        style: { fontSize: 12, color: "#000000", lineHeight: 1.5 },
      },
      { recordHistory: false },
    );
    const secondId = manager.addAnnotation(
      {
        type: "textblock",
        pageIndex: 0,
        x: 80,
        y: 180,
        width: 160,
        height: 48,
        content: "Second box",
        richContent: "Second box",
        style: { fontSize: 12, color: "#000000", lineHeight: 1.5 },
      },
      { recordHistory: false },
    );

    (editor as any).renderAnnotation(firstId);
    (editor as any).renderAnnotation(secondId);
    await flush();

    const firstTextEl = editor.querySelector(
      `.annotation[data-id="${firstId}"] [contenteditable]`,
    ) as HTMLElement;
    firstTextEl.dispatchEvent(new FocusEvent("focus", { bubbles: false }));

    expect(editor.querySelector(".spacing-guide")).toBeTruthy();
    expect(editor.querySelector(".line-height-guide")).toBeTruthy();
  });

  it.each([
    "left",
    "center",
    "right",
    "justify",
  ] as const)("should capture %s text box alignment from the edited DOM when saving", async (textAlign) => {
    await loadEditor();
    const manager = (editor as any).annotationManager;
    const id = manager.addAnnotation(
      {
        type: "textblock",
        pageIndex: 0,
        x: 80,
        y: 80,
        width: 200,
        height: 60,
        content: "Aligned text",
        richContent: "Aligned text",
        style: { fontSize: 12, color: "#000000", lineHeight: 1.4 },
      },
      { recordHistory: false },
    );
    (editor as any).renderAnnotation(id);
    await flush();

    const textEl = editor.querySelector(
      `.annotation[data-id="${id}"] [contenteditable]`,
    ) as HTMLElement;
    textEl.style.textAlign = textAlign;
    (editor as any).savePdf = vi.fn().mockResolvedValue(true);
    (editor as any).recordJob = vi.fn().mockResolvedValue(undefined);

    await editor.handleSave();

    expect(embedAllAnnotations).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.arrayContaining([
        expect.objectContaining({
          id,
          style: expect.objectContaining({ textAlign }),
        }),
      ]),
      [],
      expect.anything(),
    );
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
      [], // No extracted sources in this test (no text/image extraction was performed)
      expect.anything(),
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

  describe("editing behaviour", () => {
    const pageEl = (index = 0) =>
      editor.querySelector(`.pdf-page-wrapper[data-index="${index}"]`) as HTMLElement;
    const canvasOf = (index = 0) => pageEl(index).querySelector(".pdf-page-canvas") as HTMLElement;
    const annEl = (id: string) =>
      editor.querySelector(`.annotation[data-id="${id}"]`) as HTMLElement;
    const textOf = (id: string) => annEl(id).querySelector("[contenteditable]") as HTMLElement;
    const manager = () => (editor as any).annotationManager;
    const history = () => (editor as any).historyManager;
    const button = (selector: string) => editor.querySelector(selector) as HTMLButtonElement;
    const toolbarButton = (command: string) =>
      editor.querySelector(`.formatting-toolbar [data-command="${command}"]`) as HTMLButtonElement;
    const panelHidden = (selector = "#propertiesPanel") =>
      editor.querySelector(selector)?.classList.contains("hidden");
    const key = (init: KeyboardEventInit) =>
      window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, ...init }));
    const mouse = (target: EventTarget, type: string, clientX = 0, clientY = 0) =>
      target.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY }),
      );
    const sizeEl = (el: HTMLElement, width: number, height: number) => {
      Object.defineProperty(el, "offsetWidth", { value: width, configurable: true });
      Object.defineProperty(el, "offsetHeight", { value: height, configurable: true });
    };
    const selectText = (node: Node, start: number, endNode: Node, end: number) => {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(endNode, end);
      const selection = window.getSelection() as Selection;
      selection.removeAllRanges();
      selection.addRange(range);
    };
    const focusText = (id: string) => {
      const el = textOf(id);
      el.tabIndex = 0; // jsdom only focuses elements with a tab index
      el.focus();
      return el;
    };
    const addAndRender = (annotation: any) => {
      const id = manager().addAnnotation(annotation, { recordHistory: false });
      (editor as any).renderAnnotation(id);
      return id as string;
    };
    const stubSave = () => {
      (editor as any).savePdf = vi.fn().mockResolvedValue(true);
      (editor as any).recordJob = vi.fn().mockResolvedValue(undefined);
    };
    const saved = () =>
      vi.mocked(embedAllAnnotations).mock.calls.at(-1) as unknown as [Uint8Array, any[], any[]];
    const savedAnnotation = (id: string) => saved()[1].find((ann) => ann.id === id);
    const textBlock = (overrides: Record<string, unknown> = {}) => ({
      type: "textblock",
      pageIndex: 0,
      x: 10,
      y: 10,
      width: 120,
      height: 50,
      content: "Hello world",
      richContent: "Hello world",
      style: { fontSize: 12, color: "#000000", lineHeight: 1.2 },
      ...overrides,
    });
    const rect = (overrides: Record<string, unknown> = {}) => ({
      type: "rectangle",
      pageIndex: 0,
      x: 10,
      y: 10,
      width: 80,
      height: 40,
      style: { color: "#ffffff", strokeWidth: 1, opacity: 1 },
      ...overrides,
    });
    const SERIF_CSS = EDITOR_FONTS[1].css;
    const MONOSPACE_CSS = EDITOR_FONTS[2].css;
    const block = (overrides: Partial<TextBlock> = {}): TextBlock => ({
      pageIndex: 0,
      lines: [],
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      fontSize: 12,
      fontName: "Helvetica",
      bold: false,
      italic: false,
      color: "#000000",
      textAlign: "left",
      type: "paragraph",
      content: "text",
      richContent: "text",
      lineHeight: 1.4,
      glyphBoxes: [],
      ...overrides,
    });
    const pageResult = (blocks: TextBlock[]) => ({
      blocks,
      pageWidth: 800,
      pageHeight: 800,
      scale: 8,
    });

    beforeAll(() => {
      // jsdom has neither isContentEditable nor innerText; browsers have both.
      Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
        configurable: true,
        get(this: HTMLElement) {
          return Boolean(this.closest('[contenteditable="true"]'));
        },
      });
      Object.defineProperty(HTMLElement.prototype, "innerText", {
        configurable: true,
        get(this: HTMLElement) {
          return this.textContent ?? "";
        },
        set(this: HTMLElement, value: string) {
          this.textContent = value;
        },
      });
    });

    afterAll(() => {
      delete (HTMLElement.prototype as any).isContentEditable;
      delete (HTMLElement.prototype as any).innerText;
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
      delete (document as any).execCommand;
      window.getSelection()?.removeAllRanges();
    });

    describe("tools and pointer input", () => {
      it("switches tools and keeps the chosen tool through undo and redo", async () => {
        await loadEditor();
        const workspace = editor.querySelector(".editor-workspace") as HTMLElement;
        const tools = (editor as any).tools;

        button("#addTextBtn").click();
        expect(workspace.classList.contains("cursor-text-tool")).toBe(true);

        button("#addRectBtn").click();
        expect(tools.get("addTextBtn").active).toBe(false);
        expect(workspace.classList.contains("cursor-text-tool")).toBe(false);
        expect(workspace.classList.contains("cursor-crosshair")).toBe(true);

        button("#addHighlightBtn").click();
        mouse(canvasOf(), "mousedown", 10, 10);
        mouse(window, "mousemove", 60, 40);
        mouse(window, "mouseup", 60, 40);
        expect(manager().getAllAnnotations()).toHaveLength(1);

        button("#undoBtn").click();
        expect(manager().getAllAnnotations()).toHaveLength(0);
        button("#redoBtn").click();
        expect(manager().getAllAnnotations()).toHaveLength(1);

        expect(button("#addHighlightBtn").classList.contains("active")).toBe(true);
        expect(tools.get("addHighlightBtn").active).toBe(true);
        mouse(canvasOf(), "mousedown", 100, 100);
        mouse(window, "mouseup", 150, 130);
        expect(manager().getAllAnnotations()).toHaveLength(2);
      });

      it("does not treat the click that ends a drag as a separate page click", async () => {
        await loadEditor();
        button("#addHighlightBtn").click();
        const onPageClick = vi.spyOn((editor as any).tools.get("addHighlightBtn"), "onPageClick");

        mouse(canvasOf(), "mousedown", 10, 10);
        mouse(window, "mouseup", 50, 30);
        mouse(canvasOf(), "click", 50, 30);
        expect(onPageClick).not.toHaveBeenCalled();

        mouse(canvasOf(), "click", 70, 80);
        expect(onPageClick).toHaveBeenCalledWith(0, 70, 80);
      });

      it("only starts drawing or placing text from the page itself", async () => {
        const id = await addRenderedAnnotation(textBlock());

        button("#addFreehandBtn").click();
        mouse(textOf(id), "mousedown", 20, 20);
        mouse(editor.querySelector(".editor-toolbar") as HTMLElement, "mousedown", 5, 5);
        expect(pageEl().querySelector(".annotation-freehand")).toBeNull();

        button("#addTextBtn").click();
        mouse(textOf(id), "mousedown", 20, 20);
        mouse(textOf(id), "click", 20, 20);
        await flush();
        expect(
          manager()
            .getAllAnnotations()
            .map((ann: any) => ann.type),
        ).toEqual(["textblock"]);
      });

      it("lets tools open the properties panel for an annotation", async () => {
        const id = await addRenderedAnnotation(rect());
        const tool = (editor as any).tools.get("addRectBtn");

        tool.showProperties("missing");
        expect(panelHidden()).toBe(true);

        tool.showProperties(id);
        expect(panelHidden()).toBe(false);
        expect(panelHidden("#shapeProperties")).toBe(false);
        expect(panelHidden("#textProperties")).toBe(true);
      });
    });

    describe("keyboard", () => {
      it("keeps the selected annotation when Backspace edits a properties field", async () => {
        const id = await addRenderedAnnotation(rect());
        annEl(id).focus();
        (editor.querySelector("#shapeBorderInput") as HTMLInputElement).focus();

        key({ key: "Backspace" });
        expect(manager().getAnnotation(id)).toBeDefined();

        annEl(id).focus();
        key({ key: "Backspace" });
        expect(manager().getAnnotation(id)).toBeUndefined();
        expect(panelHidden()).toBe(true);
      });

      it("lets Delete edit the text inside a text box instead of removing the box", async () => {
        const id = await addRenderedAnnotation(textBlock());
        focusText(id);

        key({ key: "Delete" });

        expect(manager().getAnnotation(id)).toBeDefined();
      });

      it("ignores keys that are not undo or redo shortcuts, and shortcuts typed into fields", () => {
        const undo = vi.spyOn(history(), "undo");
        const redo = vi.spyOn(history(), "redo");

        key({ key: "y", ctrlKey: true });
        key({ key: "z" });
        key({ key: "Delete" });

        const textbox = document.createElement("div");
        textbox.setAttribute("role", "textbox");
        textbox.tabIndex = 0;
        document.body.appendChild(textbox);
        textbox.focus();
        key({ key: "z", ctrlKey: true });

        const area = document.createElement("textarea");
        document.body.appendChild(area);
        area.focus();
        key({ key: "Z", metaKey: true, shiftKey: true });

        expect(undo).not.toHaveBeenCalled();
        expect(redo).not.toHaveBeenCalled();
      });

      it("restores a deleted annotation with Ctrl+Z and removes it again with Ctrl+Shift+Z", async () => {
        await loadEditor();
        button("#addRectBtn").click();
        mouse(canvasOf(), "click", 40, 60);
        const [created] = manager().getAllAnnotations();
        expect(button("#undoBtn").disabled).toBe(false);

        (annEl(created.id).querySelector(".ann-delete-btn") as HTMLButtonElement).click();
        expect(annEl(created.id)).toBeNull();

        key({ key: "z", ctrlKey: true });
        expect(manager().getAnnotation(created.id)).toMatchObject({ x: 40, y: 60 });
        expect(annEl(created.id)).not.toBeNull();
        expect(button("#redoBtn").disabled).toBe(false);

        key({ key: "z", ctrlKey: true, shiftKey: true });
        expect(manager().getAnnotation(created.id)).toBeUndefined();
        expect(annEl(created.id)).toBeNull();

        key({ key: "z", ctrlKey: true });
        key({ key: "z", ctrlKey: true });
        expect(manager().getAllAnnotations()).toHaveLength(0);
        expect(button("#undoBtn").disabled).toBe(true);
      });

      it("stops reacting to the keyboard once removed from the page", async () => {
        await loadEditor();
        const undo = vi.spyOn(history(), "undo");
        expect(editor.querySelector(".formatting-toolbar")).not.toBeNull();

        editor.remove();
        key({ key: "z", ctrlKey: true });

        expect(undo).not.toHaveBeenCalled();
        expect(editor.querySelector(".formatting-toolbar")).toBeNull();
      });
    });

    describe("undo, redo and text selection", () => {
      it("undoes and redoes a font size change made in the properties panel", async () => {
        const id = await addRenderedAnnotation(textBlock());
        focusText(id);
        setInputValue("#fontSizeInput", "22");
        expect(textOf(id).style.fontSize).toBe("22px");

        button("#undoBtn").click();
        expect(manager().getAnnotation(id).style.fontSize).toBe(12);
        expect(textOf(id).style.fontSize).toBe("12px");

        button("#redoBtn").click();
        expect(manager().getAnnotation(id).style.fontSize).toBe(22);
        expect(textOf(id).style.fontSize).toBe("22px");
      });

      it("puts the text selection back after undo re-renders the text box", async () => {
        const id = await addRenderedAnnotation(
          textBlock({ richContent: "<b>Bold</b> plain", content: "Bold plain" }),
        );
        focusText(id);
        setInputValue("#colorPicker", "#ff0000");
        const plain = textOf(id).childNodes[1] as Node;
        selectText(plain, 1, plain, 6);

        button("#undoBtn").click();
        expect(manager().getAnnotation(id).style.color).toBe("#000000");
        await flush();

        expect(window.getSelection()?.toString()).toBe("plain");
        expect(textOf(id).contains(window.getSelection()?.anchorNode as Node)).toBe(true);
      });

      it("only remembers selections that sit inside one annotation's text box", async () => {
        const id = await addRenderedAnnotation(textBlock());
        const other = addAndRender(textBlock({ y: 200 }));
        const capture = () => (editor as any).captureTextSelectionSnapshot();

        expect(capture()).toBeNull();

        const loose = document.createElement("div");
        loose.setAttribute("contenteditable", "true");
        loose.textContent = "loose text";
        document.body.appendChild(loose);
        selectText(loose.firstChild as Node, 0, loose.firstChild as Node, 5);
        expect(capture()).toBeNull();

        selectText(textOf(id).firstChild as Node, 0, textOf(other).firstChild as Node, 2);
        expect(capture()).toBeNull();

        textOf(id).setAttribute("contenteditable", "false");
        selectText(textOf(id).firstChild as Node, 0, textOf(id).firstChild as Node, 2);
        expect(capture()).toBeNull();

        window.getSelection()?.removeAllRanges();
        (editor as any).restoreTextSelection({ annotationId: "gone", start: 0, end: 1 });
        expect(window.getSelection()?.rangeCount).toBe(0);
      });

      it("moves a drawn stroke and undo puts it back with its shape intact", async () => {
        await loadEditor();
        button("#addFreehandBtn").click();
        mouse(canvasOf(), "mousedown", 20, 20);
        mouse(window, "mousemove", 60, 40);
        mouse(window, "mouseup", 80, 50);
        const [stroke] = manager().getAllAnnotations();

        mouse(annEl(stroke.id), "mousedown", 30, 30);
        mouse(document, "mousemove", 130, 80);
        mouse(document, "mouseup", 130, 80);
        expect(manager().getAnnotation(stroke.id)).toMatchObject({ x: 120, y: 70 });

        button("#undoBtn").click();
        expect(manager().getAnnotation(stroke.id)).toMatchObject({
          x: 20,
          y: 20,
          points: stroke.points,
        });
        expect(annEl(stroke.id).querySelector("path")?.getAttribute("d")).toBe(
          "M 0 0 L 40 20 L 60 30",
        );
      });

      it("does not record a move when an annotation is clicked without being dragged", async () => {
        const id = await addRenderedAnnotation(rect());

        mouse(annEl(id), "mousedown", 20, 20);
        mouse(document, "mouseup", 20, 20);

        expect(history().canUndo()).toBe(false);
        expect(button("#undoBtn").disabled).toBe(true);
      });
    });

    describe("properties", () => {
      it("ignores property edits when the selection is missing or stale", async () => {
        const id = await addRenderedAnnotation(rect());
        setInputValue("#shapeFillPicker", "#123456");
        expect(manager().getAnnotation(id).style.color).toBe("#ffffff");

        (editor as any).selectedAnnotationId = "missing";
        setInputValue("#shapeFillPicker", "#123456");

        const offscreen = manager().addAnnotation(rect(), { recordHistory: false });
        (editor as any).selectedAnnotationId = offscreen;
        setInputValue("#shapeFillPicker", "#123456");

        expect(manager().getAnnotation(offscreen).style.color).toBe("#ffffff");
        expect(history().canUndo()).toBe(false);
      });

      it("applies paragraph styles to the selected text box", async () => {
        const id = await addRenderedAnnotation(textBlock());
        focusText(id);
        const update = (props: Record<string, unknown>) =>
          (editor as any).updateSelectedAnnotation(props);

        update({ textAlign: "right" });
        update({ lineHeight: 1.8 });
        update({ bold: true });
        update({ italic: true });
        expect(textOf(id).style.fontWeight).toBe("bold");
        expect(textOf(id).style.fontStyle).toBe("italic");
        update({ bold: false });
        update({ italic: false });

        expect(textOf(id).style.textAlign).toBe("right");
        expect(textOf(id).style.lineHeight).toBe("1.8");
        expect(textOf(id).style.fontWeight).toBe("normal");
        expect(textOf(id).style.fontStyle).toBe("normal");
        expect(manager().getAnnotation(id).style).toMatchObject({
          textAlign: "right",
          lineHeight: 1.8,
          bold: false,
          italic: false,
        });
      });

      it("recolours, fades and re-centres a strikethrough line", async () => {
        const id = await addRenderedAnnotation({
          type: "strikethrough",
          pageIndex: 0,
          x: 10,
          y: 10,
          width: 100,
          height: 20,
          style: { color: "#111827", strokeWidth: 2, opacity: 1 },
        });
        annEl(id).focus();

        setInputValue("#lineColorPicker", "#ff0000");
        setInputValue("#lineOpacityInput", "0.5");
        setInputValue("#lineWidthInput", "6");

        const line = annEl(id).querySelector(".line-annotation") as HTMLElement;
        expect(line.style.backgroundColor).toBe("rgb(255, 0, 0)");
        expect(line.style.opacity).toBe("0.5");
        expect(line.style.height).toBe("6px");
        expect(line.style.top).toBe("7px");
        expect(manager().getAnnotation(id).style).toEqual({
          color: "#ff0000",
          strokeWidth: 6,
          opacity: 0.5,
        });
      });

      it("draws unstyled annotations with defaults and shows those defaults in the panel", async () => {
        await loadEditor();
        const ids = {
          text: addAndRender({ type: "text", pageIndex: 0, x: 1, y: 1 }),
          rectangle: addAndRender({ type: "rectangle", pageIndex: 0, x: 1, y: 1 }),
          image: addAndRender({ type: "image", pageIndex: 0, x: 1, y: 1 }),
          rotated: addAndRender({
            type: "image",
            pageIndex: 0,
            x: 1,
            y: 1,
            style: { rotation: 90 },
          }),
          highlight: addAndRender({ type: "highlight", pageIndex: 0, x: 1, y: 1 }),
          freehand: addAndRender({ type: "freehand", pageIndex: 0, x: 1, y: 1 }),
          underline: addAndRender({ type: "underline", pageIndex: 0, x: 1, y: 1 }),
          strike: addAndRender({ type: "strikethrough", pageIndex: 0, x: 1, y: 1 }),
        };

        const text = textOf(ids.text);
        expect(text.style.color).toBe("black");
        expect(text.style.fontSize).toBe("16px");
        expect(text.textContent).toBe("");
        expect(annEl(ids.rectangle).style).toMatchObject({
          width: "100px",
          height: "50px",
          backgroundColor: "white",
          opacity: "1",
        });
        expect(annEl(ids.image).style).toMatchObject({ width: "150px", height: "150px" });
        expect(annEl(ids.image).style.transform).toBe("");
        expect(annEl(ids.rotated).style.transform).toBe("rotate(90deg)");
        expect(annEl(ids.highlight).style).toMatchObject({
          width: "120px",
          height: "24px",
          opacity: "0.3",
        });
        const path = annEl(ids.freehand).querySelector("path") as SVGPathElement;
        expect(path.getAttribute("d")).toBeNull();
        expect(path.getAttribute("stroke")).toBe("#111827");
        expect(path.getAttribute("stroke-width")).toBe("2");
        expect(path.getAttribute("opacity")).toBe("1");
        const underline = annEl(ids.underline).querySelector(".line-annotation") as HTMLElement;
        const strike = annEl(ids.strike).querySelector(".line-annotation") as HTMLElement;
        expect(underline.style.top).toBe("10px");
        expect(strike.style.top).toBe("5px");

        const value = (selector: string) =>
          (editor.querySelector(selector) as HTMLInputElement).value;
        focusText(ids.text);
        expect([
          value("#fontSizeInput"),
          value("#colorPicker"),
          value("#fontFamilySelect"),
        ]).toEqual(["16", "#000000", "Helvetica"]);
        annEl(ids.rectangle).focus();
        expect([
          value("#shapeFillPicker"),
          value("#shapeBorderInput"),
          value("#shapeOpacityInput"),
        ]).toEqual(["#ffffff", "0", "1"]);
        annEl(ids.image).focus();
        expect(value("#imageOpacityInput")).toBe("1");
        annEl(ids.highlight).focus();
        expect([value("#highlightColorPicker"), value("#highlightOpacityInput")]).toEqual([
          "#ffff00",
          "0.3",
        ]);
        annEl(ids.freehand).focus();
        expect([
          value("#lineColorPicker"),
          value("#lineWidthInput"),
          value("#lineOpacityInput"),
        ]).toEqual(["#000000", "2", "1"]);

        annEl(ids.underline).focus();
        setInputValue("#lineColorPicker", "#00ff00");
        expect(manager().getAnnotation(ids.underline).style).toMatchObject({
          color: "#00ff00",
          strokeWidth: 2,
        });
      });

      it("does not draw annotations that are unknown or whose page is not shown", async () => {
        await loadEditor();

        (editor as any).renderAnnotation("unknown");
        addAndRender(rect({ pageIndex: 7 }));

        expect(editor.querySelectorAll(".annotation")).toHaveLength(0);
      });
    });

    describe("text boxes", () => {
      it("styles a text block from its stored style unless rich markup carries it", async () => {
        await loadEditor();
        const plain = addAndRender(
          textBlock({
            richContent: undefined,
            style: { fontSize: 12, bold: true, italic: true, textAlign: "center" },
          }),
        );
        const rich = addAndRender(
          textBlock({ y: 200, richContent: "<b>Hi</b>", style: { bold: true, italic: true } }),
        );
        const unsized = addAndRender(textBlock({ y: 300, width: undefined, height: undefined }));

        expect(textOf(plain).style).toMatchObject({
          fontWeight: "bold",
          fontStyle: "italic",
          textAlign: "center",
        });
        expect(textOf(plain).textContent).toBe("Hello world");
        expect(textOf(rich).style.fontWeight).toBe("");
        expect(textOf(rich).innerHTML).toBe("<b>Hi</b>");
        expect(annEl(unsized).style.width).toBe("");
        expect(textOf(unsized).style.minHeight).toBe("");
      });

      it("re-sanitizes stored rich text before showing it", async () => {
        const id = await addRenderedAnnotation(
          textBlock({ richContent: '<i>safe</i><img src="x" onerror="window.__xss = 1">' }),
        );

        expect(textOf(id).innerHTML).toBe("<i>safe</i>");
      });

      it("stores typed text and strips unsafe pasted markup from text blocks", async () => {
        await loadEditor();
        const blockId = addAndRender(textBlock());
        const noteId = addAndRender({
          type: "text",
          pageIndex: 0,
          x: 300,
          y: 300,
          content: "Note",
        });

        textOf(blockId).innerHTML = '<b>Bold</b> <img src="x" onerror="window.__xss = 1">tail';
        textOf(blockId).dispatchEvent(new Event("input"));
        textOf(noteId).textContent = "Edited note";
        textOf(noteId).dispatchEvent(new Event("input"));

        expect(manager().getAnnotation(blockId)).toMatchObject({
          richContent: "<b>Bold</b> tail",
          content: "Bold tail",
        });
        expect(manager().getAnnotation(noteId)).toMatchObject({
          content: "Edited note",
          richContent: "Edited note",
        });

        // Typing is recorded in history, so Undo must be available straight away.
        expect(button("#undoBtn").disabled).toBe(false);
        button("#undoBtn").click();
        expect(manager().getAnnotation(noteId).content).toBe("Note");
        expect(textOf(noteId).textContent).toBe("Note");
      });

      it("shows a move cursor near a text box's edge and a text cursor inside it", async () => {
        const id = await addRenderedAnnotation(textBlock());
        const el = annEl(id);
        const text = textOf(id);
        Object.defineProperty(el, "getBoundingClientRect", {
          configurable: true,
          value: () => ({ left: 10, top: 10, width: 120, height: 50, right: 130, bottom: 60 }),
        });

        mouse(text, "mousemove", 12, 30);
        expect([el.style.cursor, text.style.cursor]).toEqual(["move", "move"]);

        mouse(text, "mousemove", 70, 35);
        expect([el.style.cursor, text.style.cursor]).toEqual(["default", "text"]);

        mouse(text, "mousemove", 12, 30);
        mouse(el.querySelector(".textblock-resize-handle") as HTMLElement, "mousemove", 70, 35);
        expect(el.style.cursor).toBe("move");

        el.dispatchEvent(new MouseEvent("mouseleave"));
        expect([el.style.cursor, text.style.cursor]).toEqual(["default", "text"]);
      });

      it("outlines a text block on hover unless it is the one being edited", async () => {
        const id = await addRenderedAnnotation(textBlock());
        const text = textOf(id);

        text.dispatchEvent(new MouseEvent("mouseenter"));
        expect(text.style.borderColor).toBe("rgba(99, 102, 241, 0.5)");
        text.dispatchEvent(new MouseEvent("mouseleave"));
        expect(text.style.borderColor).toBe("transparent");

        focusText(id);
        const focusedBorder = text.style.borderColor;
        text.dispatchEvent(new MouseEvent("mouseenter"));
        text.dispatchEvent(new MouseEvent("mouseleave"));
        expect(text.style.borderColor).toBe(focusedBorder);
      });

      it("shows editing controls while focused and hides them shortly after blur", async () => {
        await loadEditor();
        vi.useFakeTimers();
        const blockId = addAndRender(textBlock());
        const noteId = addAndRender({
          type: "text",
          pageIndex: 0,
          x: 300,
          y: 300,
          content: "Note",
        });
        const rectId = addAndRender(rect({ y: 400 }));
        vi.advanceTimersByTime(60);

        const text = focusText(blockId);
        const el = annEl(blockId);
        const deleteBtn = el.querySelector(".ann-delete-btn") as HTMLElement;
        const handles = Array.from(el.querySelectorAll<HTMLElement>(".textblock-resize-handle"));
        expect(handles).toHaveLength(8);
        expect(deleteBtn.style.display).toBe("flex");
        expect(handles.every((h) => h.style.display === "block")).toBe(true);
        expect(panelHidden("#textProperties")).toBe(false);
        expect(editor.querySelector(".formatting-toolbar")?.classList.contains("hidden")).toBe(
          false,
        );

        // Focus that comes straight back (a toolbar click) keeps the controls.
        text.blur();
        text.focus();
        vi.advanceTimersByTime(250);
        expect(deleteBtn.style.display).toBe("flex");

        text.blur();
        vi.advanceTimersByTime(250);
        expect(deleteBtn.style.display).toBe("none");
        expect(handles.every((h) => h.style.display === "none")).toBe(true);
        expect(text.style.backgroundColor).toBe("white");
        expect(text.style.boxShadow).toBe("none");
        expect(editor.querySelector(".line-height-guide")).toBeNull();

        const note = focusText(noteId);
        expect(note.style.backgroundColor).toBe("rgba(255, 255, 255, 0.8)");
        note.blur();
        vi.advanceTimersByTime(250);
        expect(note.style.backgroundColor).toBe("rgba(255, 255, 255, 0.1)");

        const box = annEl(rectId);
        const resizer = box.querySelector(".resizer") as HTMLElement;
        box.focus();
        box.blur();
        box.focus();
        vi.advanceTimersByTime(250);
        expect(resizer.style.display).toBe("block");
        box.blur();
        vi.advanceTimersByTime(250);
        expect(resizer.style.display).toBe("none");
        expect(box.style.boxShadow).toBe("none");
      });

      it("measures the gaps to the nearest text boxes above and below", async () => {
        await loadEditor();
        addAndRender(textBlock({ y: 20, height: 40 }));
        const middle = addAndRender(textBlock({ y: 100, height: 40 }));
        addAndRender(textBlock({ y: 200, height: 40 }));
        addAndRender({ type: "text", pageIndex: 0, x: 10, y: 150, content: "unsized" });
        Object.defineProperty(pageEl(), "clientWidth", { value: 150, configurable: true });

        focusText(middle);

        const labels = Array.from(editor.querySelectorAll(".spacing-guide")).map(
          (guide) => guide.textContent,
        );
        expect(labels).toEqual(["40px", "60px"]);
        const lineGuide = editor.querySelector(".line-height-guide") as HTMLElement;
        expect(lineGuide.textContent).toBe("14px line");
        expect(lineGuide.style.left).toBe("128px");

        addAndRender(textBlock({ y: 140, height: 30 }));
        textOf(middle).blur();
        focusText(middle);
        expect(
          Array.from(editor.querySelectorAll(".spacing-guide")).map((g) => g.textContent),
        ).toEqual(["40px"]);
      });

      it("still edits text when the formatting toolbar has nowhere to go", async () => {
        editor.querySelector("#formattingToolbarContainer")?.remove();
        const id = await addRenderedAnnotation(textBlock({ style: { fontSize: 18 } }));

        focusText(id);

        expect(editor.querySelector(".formatting-toolbar")).toBeNull();
        expect((editor.querySelector("#fontSizeInput") as HTMLInputElement).value).toBe("18");
      });
    });

    describe("moving and resizing", () => {
      it.each([
        ["se", 30, 20, { width: 150, height: 70, x: 10, y: 10 }],
        ["e", 30, 20, { width: 150, height: 50, x: 10, y: 10 }],
        ["s", 30, 20, { width: 120, height: 70, x: 10, y: 10 }],
        ["nw", -30, -20, { width: 150, height: 70, x: -20, y: -10 }],
        ["ne", 30, -20, { width: 150, height: 70, x: 10, y: -10 }],
        ["sw", -30, 20, { width: 150, height: 70, x: -20, y: 10 }],
        ["n", 30, -20, { width: 120, height: 70, x: 10, y: -10 }],
        ["w", -30, 20, { width: 150, height: 50, x: -20, y: 10 }],
      ] as const)("resizes a text block from its %s handle as one undo step", async (dir, dx, dy, expected) => {
        const id = await addRenderedAnnotation(textBlock());
        const el = annEl(id);
        // The 120-wide block's box is drawn 6px wider for its padding.
        sizeEl(el, 126, 50);
        const handle = el.querySelector(
          `.textblock-resize-handle[data-dir="${dir}"]`,
        ) as HTMLElement;

        mouse(handle, "mousedown", 100, 100);
        mouse(document, "mousemove", 100 + dx, 100 + dy);
        mouse(document, "mouseup", 100 + dx, 100 + dy);

        // The stored width is the block's own, without the box's padding.
        expect(manager().getAnnotation(id)).toMatchObject(expected);
        expect(el.style.width).toBe(`${expected.width + 6}px`);
        expect(el.style.left).toBe(`${expected.x}px`);
        expect(textOf(id).style.minHeight).toBe(`${expected.height}px`);

        button("#undoBtn").click();
        expect(manager().getAnnotation(id)).toMatchObject({ x: 10, y: 10, width: 120, height: 50 });
      });

      it("keeps the far edges in place when a text block is shrunk past its minimum size", async () => {
        const id = await addRenderedAnnotation(textBlock());
        const el = annEl(id);
        sizeEl(el, 126, 50);
        const handle = el.querySelector('.textblock-resize-handle[data-dir="nw"]') as HTMLElement;

        mouse(handle, "mousedown", 100, 100);
        mouse(document, "mousemove", 300, 200);
        mouse(document, "mouseup", 300, 200);

        // The box's minimum is 40x20; its right edge stays at 136, its bottom at 60.
        expect(manager().getAnnotation(id)).toMatchObject({ x: 96, y: 40, width: 34, height: 20 });
        expect(el.style.left).toBe("96px");
        expect(el.style.top).toBe("40px");
      });

      it("keeps a resized text block the same size when it is drawn again", async () => {
        const id = await addRenderedAnnotation(textBlock());
        sizeEl(annEl(id), 126, 50);
        const handle = annEl(id).querySelector(
          '.textblock-resize-handle[data-dir="e"]',
        ) as HTMLElement;

        mouse(handle, "mousedown", 100, 100);
        mouse(document, "mousemove", 120, 100);
        mouse(document, "mouseup", 120, 100);
        expect(annEl(id).style.width).toBe("146px");

        // Undo then redo draws the box again from what was stored.
        button("#undoBtn").click();
        button("#redoBtn").click();
        expect(annEl(id).style.width).toBe("146px");
        expect(manager().getAnnotation(id).width).toBe(140);
      });

      // Target box: left 100, centre 140, right 180. Dragged box is 30 wide.
      it.each([
        ["left edge to left edge", 102, 100, 100],
        ["left edge to centre", 142, 140, 140],
        ["left edge to right edge", 178, 180, 180],
        ["centre to left edge", 86, 85, 100],
        ["centre to centre", 126, 125, 140],
        ["centre to right edge", 166, 165, 180],
        ["right edge to left edge", 72, 70, 100],
        ["right edge to centre", 112, 110, 140],
        ["right edge to right edge", 152, 150, 180],
      ] as const)("snaps a dragged box %s and shows one guide", async (_label, dropX, snappedX, guideX) => {
        await loadEditor();
        addAndRender(rect({ x: 100, y: 10 }));
        addAndRender(rect({ x: 100, y: 80 })); // same edges: only one guide per line
        addAndRender({ type: "text", pageIndex: 0, x: 700, y: 10, content: "far away" });
        manager().addAnnotation(rect({ x: 101 }), { recordHistory: false }); // not on screen
        const dragged = addAndRender(rect({ x: 400, y: 300, width: 30 }));
        const el = annEl(dragged);
        sizeEl(el, 30, 40);

        mouse(el, "mousedown", 400, 300);
        mouse(document, "mousemove", dropX, 300);
        const guides = Array.from(pageEl().querySelectorAll<HTMLElement>(".alignment-guide"));
        expect(guides.map((g) => g.style.left)).toEqual([`${guideX}px`]);

        mouse(document, "mouseup", dropX, 300);
        expect(manager().getAnnotation(dragged).x).toBe(snappedX);
        expect(pageEl().querySelector(".alignment-guide")).toBeNull();
      });
    });

    describe("formatting toolbar", () => {
      const wrapSelection = (tag: string) => {
        const range = (window.getSelection() as Selection).getRangeAt(0);
        const el = document.createElement(tag);
        el.appendChild(range.extractContents());
        range.insertNode(el);
      };

      it("bolds selected words, saves the markup and can undo it", async () => {
        Object.defineProperty(document, "execCommand", {
          configurable: true,
          writable: true,
          value: vi.fn((command: string) => {
            if (command === "bold") wrapSelection("b");
            return true;
          }),
        });
        const id = await addRenderedAnnotation(textBlock());
        const text = focusText(id);
        selectText(text.firstChild as Node, 0, text.firstChild as Node, 5);

        toolbarButton("bold").click();

        expect(text.innerHTML).toBe("<b>Hello</b> world");
        expect(manager().getAnnotation(id).richContent).toBe("<b>Hello</b> world");

        stubSave();
        await editor.handleSave();
        expect(savedAnnotation(id)).toMatchObject({ richContent: "<b>Hello</b> world" });

        button("#undoBtn").click();
        expect(manager().getAnnotation(id).richContent).toBe("Hello world");
        expect(textOf(id).innerHTML).toBe("Hello world");
      });

      it("keeps formatting in an Add Text box through undo and saving", async () => {
        Object.defineProperty(document, "execCommand", {
          configurable: true,
          writable: true,
          value: vi.fn((command: string) => {
            if (command === "bold") wrapSelection("b");
            return true;
          }),
        });
        const id = await addRenderedAnnotation({
          type: "text",
          pageIndex: 0,
          x: 10,
          y: 10,
          content: "Note",
          style: { fontSize: 12 },
        });
        const text = focusText(id);
        selectText(text.firstChild as Node, 0, text.firstChild as Node, 4);
        toolbarButton("bold").click();
        setInputValue("#fontSizeInput", "20");

        // Undoing the size change draws the box again from what was stored.
        button("#undoBtn").click();
        expect(textOf(id).innerHTML).toBe("<b>Note</b>");

        stubSave();
        await editor.handleSave();
        expect(savedAnnotation(id).richContent).toBe("<b>Note</b>");
      });

      it("aligns the selected text box and saves that alignment", async () => {
        const id = await addRenderedAnnotation(textBlock());
        focusText(id);

        toolbarButton("justifyCenter").click();

        expect(textOf(id).style.textAlign).toBe("center");
        expect(manager().getAnnotation(id).style.textAlign).toBe("center");
        stubSave();
        await editor.handleSave();
        expect(savedAnnotation(id).style.textAlign).toBe("center");
      });

      it("applies and saves line spacing picked in the toolbar", async () => {
        const id = await addRenderedAnnotation(textBlock());
        focusText(id);
        const lineSelect = editor.querySelector(".fmt-line-height-select") as HTMLSelectElement;
        lineSelect.focus(); // in a browser the select takes focus from the text box

        lineSelect.value = "2.0";
        lineSelect.dispatchEvent(new Event("change", { bubbles: true }));

        expect(Number.parseFloat(textOf(id).style.lineHeight)).toBe(2);
        expect(manager().getAnnotation(id).style.lineHeight).toBe(2);
        stubSave();
        await editor.handleSave();
        expect(savedAnnotation(id).style.lineHeight).toBe(2);
      });

      it("ignores toolbar changes when no text box is selected", async () => {
        const id = await addRenderedAnnotation(rect());
        toolbarButton("justifyRight").click();

        annEl(id).focus();
        toolbarButton("justifyRight").click();

        const offscreen = manager().addAnnotation(textBlock(), { recordHistory: false });
        (editor as any).selectedAnnotationId = offscreen;
        toolbarButton("justifyRight").click();

        expect(history().canUndo()).toBe(false);
        expect(manager().getAnnotation(offscreen).style.textAlign).toBeUndefined();
      });
    });

    describe("saving", () => {
      it("does nothing when asked to save before a PDF is loaded", async () => {
        await editor.handleSave();
        expect(embedAllAnnotations).not.toHaveBeenCalled();
      });

      it("keeps bullet lists and unstyled shapes intact when saving", async () => {
        const id = await addRenderedAnnotation(textBlock());
        const shape = addAndRender({ type: "rectangle", pageIndex: 0, x: 16, y: 24 });
        textOf(id).innerHTML = "<ul><li>First</li><li>Second</li></ul>";
        stubSave();

        button("#saveBtn").click();
        await vi.waitFor(() => expect(embedAllAnnotations).toHaveBeenCalled());

        expect(savedAnnotation(id).richContent).toBe("<ul><li>First</li><li>Second</li></ul>");
        expect(savedAnnotation(shape)).toMatchObject({
          x: 2,
          y: 3,
          width: undefined,
          height: undefined,
          style: undefined,
        });
      });

      it.each([
        ["start", "left"],
        ["end", "right"],
        ["inherit", "center"],
        ["", "center"],
      ])("saves a text box aligned '%s' in the page as %s", async (domAlign, expected) => {
        const id = await addRenderedAnnotation(
          textBlock({ style: { fontSize: 12, textAlign: "center" } }),
        );
        textOf(id).style.textAlign = domAlign;
        stubSave();

        await editor.handleSave();

        expect(savedAnnotation(id).style.textAlign).toBe(expected);
      });

      it("saves in PDF units on a page with a /UserUnit", async () => {
        // pdf.js shows a 50-unit-wide page with /UserUnit 2 as 100 viewport
        // units: 8px per viewport unit, 16px per PDF unit.
        vi.mocked(loadPdf).mockResolvedValueOnce({
          numPages: 1,
          getPage: vi.fn().mockResolvedValue({
            userUnit: 2,
            getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
            getTextContent: vi.fn().mockResolvedValue({ items: [] }),
          }),
        } as any);
        const id = await addRenderedAnnotation(
          textBlock({
            x: 160,
            y: 80,
            width: 320,
            height: 48,
            style: { fontSize: 32 },
          }),
        );
        focusText(id);
        const spacing = editor.querySelector(".fmt-para-spacing-select") as HTMLSelectElement;
        spacing.value = "6";
        spacing.dispatchEvent(new Event("change", { bubbles: true }));
        expect(manager().getAnnotation(id).style.paragraphSpacing).toBe(96);
        stubSave();

        await editor.handleSave();

        expect(savedAnnotation(id)).toMatchObject({
          x: 10,
          y: 5,
          width: 20,
          height: 3,
          style: { fontSize: 2, paragraphSpacing: 6 },
        });
      });

      it("hides the progress panel again after saving", async () => {
        (editor as any).selectedFile = pdfFile();
        (editor as any).currentPdfDoc = await loadPdf(new ArrayBuffer(0));
        stubSave();
        const progress = editor.querySelector("#progressSection") as HTMLElement;
        vi.useFakeTimers();
        progress.classList.remove("hidden");

        await editor.handleSave();
        expect(progress.classList.contains("hidden")).toBe(false);
        vi.advanceTimersByTime(1500);

        expect(progress.classList.contains("hidden")).toBe(true);
      });
    });

    describe("loading extracted content", () => {
      it("turns extracted text and images into editable annotations, clearing only their regions", async () => {
        const fillRect = vi.fn();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
          fillRect,
          fillStyle: "",
        } as any);
        vi.spyOn(imageExtractor, "extractPageImages").mockImplementation(
          async (_doc: unknown, pageIndex: number) =>
            pageIndex === 0
              ? [
                  {
                    pageIndex: 0,
                    x: 400,
                    y: 160,
                    width: 160,
                    height: 80,
                    dataUrl: "data:image/png;base64,AAA",
                  },
                ]
              : [],
        );
        vi.spyOn(textBlockExtractor, "extractAllPages").mockResolvedValue([
          pageResult([
            block({
              x: 80,
              y: 40,
              width: 240,
              height: 32,
              fontName: "TimesNewRomanPS-BoldMT",
              fontSize: 24,
              bold: true,
              textAlign: "center",
              lineHeight: 1.2,
              color: "#112233",
              content: "Title",
              richContent: "<b>Title</b>",
            }),
          ]),
          pageResult([]),
          // A third page the renderer never drew: recorded, but nothing to show.
          pageResult([block({ pageIndex: 2, x: 8, y: 8, width: 16, height: 8 })]),
        ] as any);

        await loadEditor();

        const all = manager().getAllAnnotations();
        expect(all).toHaveLength(3);
        const image = all.find((ann: any) => ann.type === "image");
        expect(image).toMatchObject({
          extracted: true,
          content: "data:image/png;base64,AAA",
          x: 400,
          y: 160,
          width: 160,
          height: 80,
        });
        const title = all.find((ann: any) => ann.content === "Title");
        expect(title).toMatchObject({
          type: "textblock",
          extracted: true,
          richContent: "<b>Title</b>",
          style: {
            font: "Times-Roman",
            fontSize: 24,
            bold: true,
            textAlign: "center",
            lineHeight: 1.2,
            color: "#112233",
          },
        });
        expect(textOf(title.id).innerHTML).toBe("<b>Title</b>");
        expect(editor.querySelectorAll(".annotation")).toHaveLength(2);
        expect(history().canUndo()).toBe(false);
        expect(imageExtractor.extractPageImages).toHaveBeenCalledTimes(2);
        // Only the image and the block are cleared, padded like the export
        // (1pt, 8px at 8px per point); the rest of the page stays visible.
        expect(fillRect.mock.calls).toEqual([
          [392, 152, 176, 96],
          [72, 32, 256, 48],
        ]);

        // Saving with nothing changed leaves the original page content alone.
        stubSave();
        await editor.handleSave();
        expect(saved()[1]).toEqual([]);
        expect(saved()[2]).toEqual([]);
      });

      it("covers and redraws only the extracted text and images the user changed", async () => {
        vi.spyOn(imageExtractor, "extractPageImages").mockImplementation(
          async (_doc: unknown, pageIndex: number) =>
            pageIndex === 0
              ? [
                  {
                    pageIndex: 0,
                    x: 400,
                    y: 160,
                    width: 160,
                    height: 80,
                    dataUrl: "data:image/png;base64,AAA",
                  },
                ]
              : [],
        );
        vi.spyOn(textBlockExtractor, "extractAllPages").mockResolvedValue([
          pageResult([
            block({
              x: 80,
              y: 40,
              width: 240,
              height: 32,
              content: "Edit me",
              richContent: "Edit me",
            }),
            block({
              x: 80,
              y: 120,
              width: 240,
              height: 32,
              content: "Delete me",
              richContent: "Delete me",
            }),
            block({
              x: 80,
              y: 200,
              width: 240,
              height: 32,
              content: "Leave me",
              richContent: "Leave me",
            }),
          ]),
          pageResult([]),
        ] as any);
        await loadEditor();
        const find = (content: string) =>
          manager()
            .getAllAnnotations()
            .find((ann: any) => ann.content === content);
        const edited = find("Edit me");
        const deleted = find("Delete me");
        const image = manager()
          .getAllAnnotations()
          .find((ann: any) => ann.type === "image");

        textOf(edited.id).textContent = "Edited";
        textOf(edited.id).dispatchEvent(new Event("input"));
        (annEl(deleted.id).querySelector(".ann-delete-btn") as HTMLButtonElement).click();
        mouse(annEl(image.id), "mousedown", 0, 0);
        mouse(document, "mousemove", 16, 0);
        mouse(document, "mouseup", 16, 0);
        stubSave();

        await editor.handleSave();

        // Page scale is 8px per point.
        expect(
          saved()[1].map((ann: any) => (ann.type === "image" ? "image" : ann.content)),
        ).toEqual(["image", "Edited"]);
        expect(saved()[1][0]).toMatchObject({ x: 52, y: 20 });
        expect(saved()[2]).toEqual([
          { pageIndex: 0, x: 50, y: 20, width: 20, height: 10 },
          { pageIndex: 0, x: 10, y: 5, width: 30, height: 4 },
          { pageIndex: 0, x: 10, y: 15, width: 30, height: 4 },
        ]);
        const notice = editor.querySelector("#editorNotice") as HTMLElement;
        expect(notice.textContent).toBe(
          "Text you changed or deleted is covered on the page, not removed. The old text is still in the saved file, where it can be searched and copied. This is not redaction.",
        );

        // Told once: saving again adds nothing.
        await editor.handleSave();
        expect(notice.querySelectorAll("p")).toHaveLength(1);
      });

      it("clears only the lines of text, not the whole block, when text was extracted by line", async () => {
        const fills: number[][] = [];
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
          fillStyle: "",
          fillRect: (...args: number[]) => fills.push(args),
        } as any);
        vi.spyOn(textBlockExtractor, "extractAllPages").mockResolvedValue([
          pageResult([
            block({
              x: 80,
              y: 40,
              width: 240,
              height: 60,
              content: "Two lines",
              richContent: "Line one<br>Line two",
              glyphBoxes: [
                { x: 80, y: 42, width: 200, height: 16 },
                { x: 80, y: 78, width: 120, height: 16 },
              ],
            }),
          ]),
          pageResult([]),
        ] as any);
        await loadEditor();
        const [lines] = manager().getAllAnnotations();

        // Each line is cleared with the export's 1pt padding (8px here); the
        // gap between and around the lines is left as the page draws it.
        expect(fills).toEqual([
          [72, 34, 216, 32],
          [72, 70, 136, 32],
        ]);

        // Saving an untouched block still leaves its lines alone...
        stubSave();
        await editor.handleSave();
        expect(saved()[2]).toEqual([]);

        // ...and once deleted, each line is covered, scaled to PDF units.
        (annEl(lines.id).querySelector(".ann-delete-btn") as HTMLButtonElement).click();
        await editor.handleSave();
        expect(saved()[2]).toEqual([
          { pageIndex: 0, x: 10, y: 5.25, width: 25, height: 2 },
          { pageIndex: 0, x: 10, y: 9.75, width: 15, height: 2 },
        ]);
      });

      it("counts a change undone as no change", async () => {
        vi.spyOn(textBlockExtractor, "extractAllPages").mockResolvedValue([
          pageResult([block({ x: 80, y: 40, width: 240, height: 32, richContent: "Same" })]),
        ] as any);
        await loadEditor();
        const [original] = manager().getAllAnnotations();
        focusText(original.id);
        setInputValue("#fontSizeInput", "30");
        button("#undoBtn").click();
        stubSave();

        await editor.handleSave();

        expect(saved()[1]).toEqual([]);
        expect(saved()[2]).toEqual([]);
        expect(editor.querySelector("#editorNotice")?.classList.contains("hidden")).toBe(true);
      });

      it("does not mention covered text when only an image was moved", async () => {
        vi.spyOn(imageExtractor, "extractPageImages").mockResolvedValue([
          {
            pageIndex: 0,
            x: 400,
            y: 160,
            width: 160,
            height: 80,
            dataUrl: "data:image/png;base64,A",
          },
        ]);
        await loadEditor();
        const [image] = manager().getAllAnnotations();
        mouse(annEl(image.id), "mousedown", 0, 0);
        mouse(document, "mousemove", 8, 0);
        mouse(document, "mouseup", 8, 0);
        stubSave();

        await editor.handleSave();

        expect(saved()[2]).toHaveLength(1);
        expect(editor.querySelector("#editorNotice")?.classList.contains("hidden")).toBe(true);
      });

      it.each([
        [
          1,
          "1 character in your text could not be drawn with the PDF's standard fonts and was replaced in the saved file.",
        ],
        [
          3,
          "3 characters in your text could not be drawn with the PDF's standard fonts and were replaced in the saved file.",
        ],
      ])("says when %i characters had to be replaced on save", async (count, message) => {
        vi.mocked(embedAllAnnotations).mockImplementationOnce(
          async (_bytes: unknown, _anns: unknown, _sources: unknown, options?: any) => {
            options?.onCharactersReplaced?.(count);
            return new Uint8Array([1]);
          },
        );
        await addRenderedAnnotation(textBlock());
        stubSave();

        await editor.handleSave();

        expect(editor.querySelector("#editorNotice")?.textContent).toBe(message);
      });

      it("keeps turned text visible and says so, clearing only what became editable", async () => {
        const fills: Array<[number, ...number[]]> = [];
        let canvasIndex = 0;
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
          this: HTMLCanvasElement,
        ) {
          const page = Number(this.closest(".pdf-page-wrapper")?.getAttribute("data-index"));
          canvasIndex++;
          return {
            fillStyle: "",
            fillRect: (...args: number[]) => fills.push([page, ...args]),
          } as any;
        });
        vi.spyOn(textBlockExtractor, "extractAllPages").mockResolvedValue([
          { ...pageResult([block({ x: 80, y: 40, width: 240, height: 32 })]), angledTextCount: 2 },
          { ...pageResult([]), angledTextCount: 0 },
        ] as any);

        await loadEditor();

        // Only the extracted block is cleared, padded by 1pt (8px at 8px per
        // point); page 2 has nothing extracted, so nothing is cleared.
        expect(fills).toEqual([[0, 80 - 8, 40 - 8, 240 + 16, 32 + 16]]);
        expect(canvasIndex).toBe(2);
        const notice = editor.querySelector("#editorNotice") as HTMLElement;
        expect(notice.classList.contains("hidden")).toBe(false);
        expect(notice.textContent).toBe(
          "Some text on page 1 is turned or upside down. It stays as it is and cannot be edited.",
        );
      });

      it("lists every page with turned text in one notice", async () => {
        vi.spyOn(textBlockExtractor, "extractAllPages").mockResolvedValue([
          { ...pageResult([]), angledTextCount: 1 },
          { ...pageResult([]), angledTextCount: 1 },
        ] as any);

        await loadEditor();

        expect(editor.querySelector("#editorNotice")?.textContent).toContain("pages 1, 2 ");
      });

      it("shows no notice when every page's text reads left to right", async () => {
        vi.spyOn(textBlockExtractor, "extractAllPages").mockResolvedValue([
          pageResult([block()]),
        ] as any);

        await loadEditor();

        expect(editor.querySelector("#editorNotice")?.classList.contains("hidden")).toBe(true);
      });

      it("maps PDF font names onto the editor's standard fonts", async () => {
        const names = [
          "",
          "TimesNewRomanPSMT",
          "NotoSerif",
          "CourierNewPSMT",
          "DejaVuSansMono",
          "Arial-BoldMT",
          "Helvetica-Oblique",
          "Georgia-Italic",
          "Verdana",
          "Calibri",
        ];
        vi.spyOn(textBlockExtractor, "extractAllPages").mockResolvedValue([
          pageResult(names.map((fontName, i) => block({ fontName, content: `b${i}`, y: i * 30 }))),
        ] as any);

        await loadEditor();

        const fonts = names.map(
          (_, i) =>
            manager()
              .getAllAnnotations()
              .find((ann: any) => ann.content === `b${i}`)?.style?.font,
        );
        // Only the three families the PDF export can draw.
        expect(fonts).toEqual([
          "Helvetica",
          "Times-Roman",
          "Times-Roman",
          "Courier",
          "Courier",
          "Helvetica",
          "Helvetica",
          "Times-Roman",
          "Helvetica",
          "Helvetica",
        ]);
      });

      it("keeps the editor usable when text extraction fails", async () => {
        vi.spyOn(textBlockExtractor, "extractAllPages").mockRejectedValue(
          new Error("no text layer"),
        );

        await loadEditor();

        expect(editor.querySelector("#editorInterface")?.classList.contains("hidden")).toBe(false);
        expect(editor.querySelectorAll(".pdf-page-wrapper")).toHaveLength(2);
        expect(manager().getAllAnnotations()).toHaveLength(0);
      });
    });
    describe("selection on load", () => {
      it("does not select or focus anything it extracts while loading", async () => {
        vi.spyOn(imageExtractor, "extractPageImages").mockImplementation(
          async (_doc: unknown, pageIndex: number) =>
            pageIndex === 0
              ? [
                  {
                    pageIndex: 0,
                    x: 40,
                    y: 40,
                    width: 80,
                    height: 80,
                    dataUrl: "data:image/png;base64,AAA",
                  },
                ]
              : [],
        );
        vi.spyOn(textBlockExtractor, "extractAllPages").mockResolvedValue([
          pageResult([block({ x: 10, y: 200 })]),
          pageResult([]),
        ] as any);

        await loadEditor();
        await new Promise((resolve) => setTimeout(resolve, 80));

        expect(manager().getAllAnnotations()).toHaveLength(2);
        expect((editor as any).selectedAnnotationId).toBeNull();
        expect(panelHidden()).toBe(true);
        expect(document.activeElement?.closest(".annotation")).toBeNull();

        // Something the user adds still takes focus so it can be edited at once.
        button("#addRectBtn").click();
        mouse(canvasOf(), "click", 300, 300);
        await new Promise((resolve) => setTimeout(resolve, 80));
        const added = manager()
          .getAllAnnotations()
          .find((ann: any) => ann.type === "rectangle");
        expect((editor as any).selectedAnnotationId).toBe(added.id);
        expect(document.activeElement).toBe(annEl(added.id));
      });
    });

    describe("typing and undo steps", () => {
      const type = (id: string, text: string) => {
        textOf(id).textContent = text;
        textOf(id).dispatchEvent(new Event("input"));
      };

      it("undoes a run of keystrokes in one step", async () => {
        const id = await addRenderedAnnotation(textBlock());
        focusText(id);

        type(id, "Hello world!");
        type(id, "Hello world!!");
        type(id, "Hello world!!!");
        expect(history().getUndoCount()).toBe(1);

        button("#undoBtn").click();
        expect(manager().getAnnotation(id)).toMatchObject({
          content: "Hello world",
          richContent: "Hello world",
        });
        expect(textOf(id).textContent).toBe("Hello world");

        button("#redoBtn").click();
        expect(manager().getAnnotation(id).content).toBe("Hello world!!!");
        expect(textOf(id).textContent).toBe("Hello world!!!");
      });

      it("starts a new step after a pause in typing", async () => {
        const id = await addRenderedAnnotation(textBlock());
        vi.useFakeTimers();

        type(id, "Hello world!");
        vi.advanceTimersByTime(400);
        type(id, "Hello world!!");
        vi.advanceTimersByTime(1500);
        type(id, "Hello world!!?");
        expect(history().getUndoCount()).toBe(2);

        button("#undoBtn").click();
        expect(manager().getAnnotation(id).content).toBe("Hello world!!");
      });

      it("starts a new step after leaving the box", async () => {
        const id = await addRenderedAnnotation(textBlock());
        const text = focusText(id);

        type(id, "Hello world!");
        text.blur();
        text.focus();
        type(id, "Hello world!!");

        expect(history().getUndoCount()).toBe(2);
      });

      it("starts a new step when anything else is recorded in between", async () => {
        const id = await addRenderedAnnotation(textBlock());
        focusText(id);
        button("#addHighlightBtn").click();

        type(id, "Hello world!");
        mouse(canvasOf(), "mousedown", 300, 300);
        mouse(window, "mouseup", 340, 320);
        type(id, "Hello world!!");
        expect(history().getUndoCount()).toBe(3);

        button("#undoBtn").click();
        expect(manager().getAnnotation(id).content).toBe("Hello world!");
        expect(
          manager()
            .getAllAnnotations()
            .some((ann: any) => ann.type === "highlight"),
        ).toBe(true);
      });

      it("keeps separate steps for different boxes", async () => {
        const first = await addRenderedAnnotation(textBlock());
        const second = addAndRender({ type: "text", pageIndex: 0, x: 300, y: 300, content: "B" });

        type(first, "Hello world!");
        type(second, "BB");

        expect(history().getUndoCount()).toBe(2);
        button("#undoBtn").click();
        expect(manager().getAnnotation(second).content).toBe("B");
        expect(manager().getAnnotation(first).content).toBe("Hello world!");
      });

      it("records typing after an undo as a new step", async () => {
        const id = await addRenderedAnnotation(textBlock());
        type(id, "Hello world!");
        button("#undoBtn").click();

        type(id, "Hello there");

        expect(history().getUndoCount()).toBe(1);
        expect(button("#redoBtn").disabled).toBe(true);
        button("#undoBtn").click();
        expect(manager().getAnnotation(id).content).toBe("Hello world");
      });
    });

    describe("applying several properties", () => {
      it("applies several text properties at once and undoes them together", async () => {
        const id = await addRenderedAnnotation(textBlock());
        focusText(id);

        (editor as any).updateSelectedAnnotation({
          fontSize: 20,
          color: "#ff0000",
          font: "Courier",
          textAlign: "center",
          lineHeight: 2,
          bold: true,
          italic: true,
        });

        expect(manager().getAnnotation(id).style).toEqual({
          fontSize: 20,
          color: "#ff0000",
          font: "Courier",
          textAlign: "center",
          lineHeight: 2,
          bold: true,
          italic: true,
        });
        const shown = textOf(id).style;
        expect([
          shown.fontSize,
          shown.fontFamily,
          shown.textAlign,
          shown.fontWeight,
          shown.fontStyle,
        ]).toEqual(["20px", MONOSPACE_CSS, "center", "bold", "italic"]);
        expect(history().getUndoCount()).toBe(1);

        button("#undoBtn").click();
        expect(manager().getAnnotation(id).style).toEqual({
          fontSize: 12,
          color: "#000000",
          lineHeight: 1.2,
        });
      });

      it("resets an image's rotation and size as one undo step", async () => {
        const id = await addRenderedAnnotation({
          type: "image",
          pageIndex: 0,
          x: 10,
          y: 10,
          width: 300,
          height: 300,
          content: "data:image/png;base64,AAA",
          style: { opacity: 1, rotation: 90 },
        });
        annEl(id).focus();

        button("#resetImageBtn").click();
        expect(manager().getAnnotation(id)).toMatchObject({
          width: 150,
          height: 150,
          style: { rotation: 0 },
        });

        button("#undoBtn").click();
        expect(manager().getAnnotation(id)).toMatchObject({
          width: 300,
          height: 300,
          style: { rotation: 90 },
        });
      });

      it("records nothing when no property the annotation uses was changed", async () => {
        const id = await addRenderedAnnotation({
          type: "highlight",
          pageIndex: 0,
          x: 10,
          y: 10,
          width: 80,
          height: 20,
        });
        annEl(id).focus();

        (editor as any).updateSelectedAnnotation({ fontSize: 30 });

        expect(history().canUndo()).toBe(false);
      });
    });

    describe("toolbar and properties panel", () => {
      const toolbarSelect = (cls: string) =>
        editor.querySelector(`.formatting-toolbar ${cls}`) as HTMLSelectElement;
      const pickInToolbar = (cls: string, value: string) => {
        const select = toolbarSelect(cls);
        select.focus(); // in a browser the select takes focus from the text box
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      };

      it("shows each text box's own style as focus moves between boxes", async () => {
        await loadEditor();
        const styled = addAndRender(
          textBlock({
            style: { font: "Courier", fontSize: 24, textAlign: "center", paragraphSpacing: 48 },
          }),
        );
        const plain = addAndRender(textBlock({ y: 300, style: undefined }));

        focusText(styled);
        expect(toolbarSelect(".fmt-font-select").value).toBe("Courier");
        expect(toolbarSelect(".fmt-size-select").value).toBe("24");
        // 48 editor pixels on a page drawn at 8 pixels per point.
        expect(toolbarSelect(".fmt-para-spacing-select").value).toBe("6");
        expect(toolbarButton("justifyCenter").classList.contains("active")).toBe(true);

        focusText(plain);
        expect(toolbarSelect(".fmt-font-select").value).toBe("Helvetica");
        expect(toolbarSelect(".fmt-size-select").value).toBe("16");
        expect(toolbarSelect(".fmt-para-spacing-select").value).toBe("0");
        expect(toolbarButton("justifyCenter").classList.contains("active")).toBe(false);
        expect(toolbarButton("justifyLeft").classList.contains("active")).toBe(true);
      });

      it("keeps the properties panel and the toolbar on the same font and size", async () => {
        const id = await addRenderedAnnotation(textBlock());
        focusText(id);

        const panelFonts = Array.from(
          (editor.querySelector("#fontFamilySelect") as HTMLSelectElement).options,
        ).map((option) => option.textContent);
        expect(panelFonts).toEqual(["Sans serif", "Serif", "Monospace"]);

        setInputValue("#fontFamilySelect", "Times-Roman", "change");
        expect(toolbarSelect(".fmt-font-select").value).toBe("Times-Roman");
        expect(textOf(id).style.fontFamily).toBe(SERIF_CSS);
        setInputValue("#fontSizeInput", "28");
        expect(toolbarSelect(".fmt-size-select").value).toBe("28");

        pickInToolbar(".fmt-font-select", "Courier");

        expect(textOf(id).style.fontFamily).toBe(MONOSPACE_CSS);
        expect(manager().getAnnotation(id).style).toMatchObject({ font: "Courier", fontSize: 28 });
        expect((editor.querySelector("#fontFamilySelect") as HTMLSelectElement).value).toBe(
          "Courier",
        );
        expect(textOf(id).innerHTML).toBe("Hello world");

        stubSave();
        await editor.handleSave();
        expect(savedAnnotation(id).style.font).toBe("Courier");
      });

      it("shows a stored font the PDF cannot draw as the family it will be drawn with", async () => {
        const id = await addRenderedAnnotation(textBlock({ style: { font: "Georgia" } }));

        expect(textOf(id).style.fontFamily).toBe(SERIF_CSS);
        focusText(id);
        expect((editor.querySelector("#fontFamilySelect") as HTMLSelectElement).value).toBe(
          "Times-Roman",
        );
        expect(toolbarSelect(".fmt-font-select").value).toBe("Times-Roman");
      });

      it("adds space before the text in points scaled to the page, and saves it in points", async () => {
        const id = await addRenderedAnnotation(textBlock());
        focusText(id);

        pickInToolbar(".fmt-para-spacing-select", "6");

        // The test page is 100pt wide drawn 800px wide: 8 editor pixels per point.
        expect(manager().getAnnotation(id).style.paragraphSpacing).toBe(48);
        expect(textOf(id).style.paddingTop).toBe("50px");
        stubSave();
        await editor.handleSave();
        expect(savedAnnotation(id).style.paragraphSpacing).toBe(6);

        button("#undoBtn").click();
        expect(textOf(id).style.paddingTop).toBe("2px");
        button("#redoBtn").click();
        expect(textOf(id).style.paddingTop).toBe("50px");

        focusText(id);
        pickInToolbar(".fmt-para-spacing-select", "0");
        expect(manager().getAnnotation(id).style.paragraphSpacing).toBe(0);
        expect(textOf(id).style.paddingTop).toBe("2px");
      });

      it("keeps subscript and superscript markup when saving", async () => {
        const id = await addRenderedAnnotation(textBlock());
        textOf(id).innerHTML = "H<sub>2</sub>O and x<sup>2</sup>";
        stubSave();

        await editor.handleSave();

        expect(savedAnnotation(id).richContent).toBe("H<sub>2</sub>O and x<sup>2</sup>");
      });
    });
    describe("page tools over extracted images", () => {
      const scanOnFirstPage = () =>
        vi
          .spyOn(imageExtractor, "extractPageImages")
          .mockImplementation(async (_doc: unknown, pageIndex: number) =>
            pageIndex === 0
              ? [
                  {
                    pageIndex: 0,
                    x: 0,
                    y: 0,
                    width: 300,
                    height: 150,
                    dataUrl: "data:image/png;base64,SCAN",
                  },
                ]
              : [],
          );

      it("draws over a scanned page instead of dragging the scan", async () => {
        scanOnFirstPage();
        await loadEditor();
        const [scan] = manager().getAllAnnotations();
        button("#addFreehandBtn").click();

        mouse(annEl(scan.id), "mousedown", 100, 100);
        mouse(window, "mousemove", 300, 250);
        mouse(window, "mouseup", 300, 250);

        expect(manager().getAnnotation(scan.id)).toMatchObject({ x: 0, y: 0 });
        expect(
          manager()
            .getAllAnnotations()
            .map((ann: any) => ann.type),
        ).toEqual(["image", "freehand"]);
      });

      it("places text on a scanned page", async () => {
        scanOnFirstPage();
        await loadEditor();
        const [scan] = manager().getAllAnnotations();
        button("#addTextBtn").click();

        mouse(annEl(scan.id), "mousedown", 50, 60);
        mouse(annEl(scan.id), "click", 50, 60);
        await flush();

        expect(
          manager()
            .getAllAnnotations()
            .find((ann: any) => ann.type === "text"),
        ).toMatchObject({ x: 50, y: 60 });
        expect((editor as any).selectedAnnotationId).not.toBe(scan.id);
      });

      it("still moves an extracted image when no tool is on", async () => {
        scanOnFirstPage();
        await loadEditor();
        const [scan] = manager().getAllAnnotations();

        mouse(annEl(scan.id), "mousedown", 10, 10);
        mouse(document, "mousemove", 30, 40);
        mouse(document, "mouseup", 30, 40);

        expect(manager().getAnnotation(scan.id)).toMatchObject({ x: 20, y: 30 });
      });

      it("switches a tool off when it is clicked again or Escape is pressed", async () => {
        await loadEditor();
        const workspace = editor.querySelector(".editor-workspace") as HTMLElement;

        button("#addRectBtn").click();
        button("#addRectBtn").click();
        expect((editor as any).activeTool).toBeNull();
        expect(button("#addRectBtn").classList.contains("active")).toBe(false);
        expect(workspace.className).toBe("editor-workspace");
        mouse(canvasOf(), "click", 40, 40);
        expect(manager().getAllAnnotations()).toHaveLength(0);

        button("#addHighlightBtn").click();
        const sizeInput = editor.querySelector("#fontSizeInput") as HTMLInputElement;
        sizeInput.focus();
        key({ key: "Escape" });
        expect((editor as any).activeTool).not.toBeNull();

        sizeInput.blur();
        key({ key: "Escape" });
        expect((editor as any).activeTool).toBeNull();
        expect(button("#addHighlightBtn").classList.contains("active")).toBe(false);
      });
    });

    describe("selection and keys", () => {
      it("does not delete a box the user has clicked away from", async () => {
        const id = await addRenderedAnnotation(rect());
        vi.useFakeTimers();
        annEl(id).focus();
        expect(panelHidden()).toBe(false);

        annEl(id).blur();
        vi.advanceTimersByTime(250);
        key({ key: "Backspace" });

        expect(manager().getAnnotation(id)).toBeDefined();
        expect((editor as any).selectedAnnotationId).toBeNull();
        expect(panelHidden()).toBe(true);
      });

      it("keeps the selection while focus is in the properties panel or the toolbar", async () => {
        const id = await addRenderedAnnotation(textBlock());
        vi.useFakeTimers();
        focusText(id);

        (editor.querySelector("#fontSizeInput") as HTMLInputElement).focus();
        vi.advanceTimersByTime(250);
        expect((editor as any).selectedAnnotationId).toBe(id);

        focusText(id);
        (editor.querySelector(".fmt-font-select") as HTMLSelectElement).focus();
        vi.advanceTimersByTime(250);
        expect((editor as any).selectedAnnotationId).toBe(id);
        expect(panelHidden()).toBe(false);
      });

      it("deletes only the focused annotation, never from a list or another field", async () => {
        const id = await addRenderedAnnotation(rect());
        annEl(id).focus();

        (editor.querySelector(".fmt-font-select") as HTMLSelectElement).focus();
        key({ key: "Delete" });
        expect(manager().getAnnotation(id)).toBeDefined();

        (editor as any).selectedAnnotationId = id;
        const deleteBtn = annEl(id).querySelector(".ann-delete-btn") as HTMLButtonElement;
        deleteBtn.focus();
        key({ key: "Delete" });
        expect(manager().getAnnotation(id)).toBeDefined();

        annEl(id).focus();
        key({ key: "Delete" });
        expect(manager().getAnnotation(id)).toBeUndefined();
      });

      it("undoes with Ctrl+Z from a slider or colour picker, not from a text field", async () => {
        await loadEditor();
        button("#addRectBtn").click();
        mouse(canvasOf(), "click", 40, 60);
        const [created] = manager().getAllAnnotations();

        (editor.querySelector("#shapeOpacityInput") as HTMLInputElement).focus();
        key({ key: "z", ctrlKey: true });
        expect(manager().getAnnotation(created.id)).toBeUndefined();

        (editor.querySelector("#shapeFillPicker") as HTMLInputElement).focus();
        key({ key: "z", ctrlKey: true, shiftKey: true });
        expect(manager().getAnnotation(created.id)).toBeDefined();

        (editor.querySelector("#fontSizeInput") as HTMLInputElement).focus();
        key({ key: "z", ctrlKey: true });
        expect(manager().getAnnotation(created.id)).toBeDefined();
      });
    });

    describe("one toolbar action, one undo step", () => {
      /** Like a browser: wrap the selection and report it as an input event. */
      const browserLikeBold = () =>
        Object.defineProperty(document, "execCommand", {
          configurable: true,
          writable: true,
          value: vi.fn((command: string) => {
            if (command !== "bold") return true;
            const range = (window.getSelection() as Selection).getRangeAt(0);
            const bold = document.createElement("b");
            bold.appendChild(range.extractContents());
            range.insertNode(bold);
            bold
              .closest("[contenteditable]")
              ?.dispatchEvent(new InputEvent("input", { inputType: "formatBold" }));
            return true;
          }),
        });
      const type = (id: string, text: string) => {
        textOf(id).textContent = text;
        textOf(id).dispatchEvent(new InputEvent("input", { inputType: "insertText" }));
      };

      it("records a Bold click as one step even though the browser reports it too", async () => {
        browserLikeBold();
        const id = await addRenderedAnnotation(textBlock());
        const text = focusText(id);
        selectText(text.firstChild as Node, 0, text.firstChild as Node, 5);

        toolbarButton("bold").click();

        expect(history().getUndoCount()).toBe(1);
        button("#undoBtn").click();
        expect(manager().getAnnotation(id).richContent).toBe("Hello world");
      });

      it("keeps typing just before a toolbar change as its own step", async () => {
        browserLikeBold();
        const id = await addRenderedAnnotation(textBlock());
        focusText(id);
        type(id, "Hello world!");
        const text = textOf(id);
        selectText(text.firstChild as Node, 0, text.firstChild as Node, 5);

        toolbarButton("bold").click();

        expect(history().getUndoCount()).toBe(2);
        button("#undoBtn").click();
        expect(manager().getAnnotation(id).richContent).toBe("Hello world!");
      });

      it("records formatting the browser applies by itself (Ctrl+B) as its own step", async () => {
        const id = await addRenderedAnnotation(textBlock());
        focusText(id);
        textOf(id).innerHTML = "<b>Hello</b> world";
        textOf(id).dispatchEvent(new InputEvent("input", { inputType: "formatBold" }));
        await Promise.resolve();

        const lineSelect = editor.querySelector(".fmt-line-height-select") as HTMLSelectElement;
        lineSelect.value = "2.0";
        lineSelect.dispatchEvent(new Event("change", { bubbles: true }));

        expect(history().getUndoCount()).toBe(2);
        button("#undoBtn").click();
        expect(manager().getAnnotation(id)).toMatchObject({ richContent: "<b>Hello</b> world" });
        expect(manager().getAnnotation(id).style.lineHeight).toBe(1.2);
      });

      it("records nothing when a toolbar change leaves the box as it was", async () => {
        const id = await addRenderedAnnotation(textBlock());
        focusText(id);

        toolbarButton("justifyCenter").click();
        toolbarButton("justifyCenter").click();

        expect(history().getUndoCount()).toBe(1);
      });
    });

    it("saves font sizes set inside the text in PDF units", async () => {
      const id = await addRenderedAnnotation(textBlock({ style: { fontSize: 16 } }));
      textOf(id).innerHTML = 'Hello <span style="font-size: 24px">world</span>';
      stubSave();

      await editor.handleSave();

      // 8 editor pixels per PDF unit on the test page.
      expect(savedAnnotation(id).richContent).toBe(
        'Hello <span style="font-size: 3px;">world</span>',
      );
      expect(savedAnnotation(id).style.fontSize).toBe(2);
    });

    describe("closing the editor", () => {
      const docWith = (destroy: ReturnType<typeof vi.fn>) =>
        ({
          numPages: 2,
          destroy,
          getPage: vi.fn().mockResolvedValue({
            getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
            getTextContent: vi.fn().mockResolvedValue({ items: [] }),
          }),
        }) as any;

      it("frees the PDF document and its worker", async () => {
        const destroy = vi.fn().mockResolvedValue(undefined);
        vi.mocked(loadPdf).mockResolvedValueOnce(docWith(destroy));
        await loadEditor();

        editor.remove();

        expect(destroy).toHaveBeenCalledTimes(1);
        expect((editor as any).currentPdfDoc).toBeNull();
      });

      it("frees the earlier document when another file is opened", async () => {
        const first = vi.fn().mockResolvedValue(undefined);
        vi.mocked(loadPdf).mockResolvedValueOnce(docWith(first));
        await loadEditor();

        await loadEditor();

        expect(first).toHaveBeenCalledTimes(1);
        expect((editor as any).currentPdfDoc).not.toBeNull();
      });

      it("drops a document that finishes loading after the editor closed", async () => {
        const destroy = vi.fn().mockResolvedValue(undefined);
        let finish: (doc: any) => void = () => {};
        vi.mocked(loadPdf).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
        const loading = editor.handleFiles(asFileList(pdfFile()));
        await flush();

        editor.remove();
        finish(docWith(destroy));
        await loading;

        expect(destroy).toHaveBeenCalledTimes(1);
        expect((editor as any).currentPdfDoc).toBeNull();
        expect(renderPage).not.toHaveBeenCalled();
      });

      it("stops drawing pages and extracting once the editor is closed", async () => {
        vi.mocked(renderPage).mockImplementationOnce(async () => {
          editor.remove();
        });
        const extract = vi.spyOn(textBlockExtractor, "extractAllPages");

        await editor.handleFiles(asFileList(pdfFile()));
        await flush();

        expect(renderPage).toHaveBeenCalledTimes(1);
        expect(extract).not.toHaveBeenCalled();
      });

      it("stops placing extracted content once the editor is closed", async () => {
        vi.spyOn(textBlockExtractor, "extractAllPages").mockImplementation(async () => {
          editor.remove();
          return [pageResult([block()]), pageResult([block()])] as any;
        });
        const images = vi.spyOn(imageExtractor, "extractPageImages");

        await editor.handleFiles(asFileList(pdfFile()));
        await flush();

        expect(manager().getAllAnnotations()).toHaveLength(0);
        expect(images).not.toHaveBeenCalled();
      });

      it("stops when the document changes while a page's images are read", async () => {
        vi.spyOn(textBlockExtractor, "extractAllPages").mockResolvedValue([
          pageResult([block()]),
        ] as any);
        vi.spyOn(imageExtractor, "extractPageImages").mockImplementation(async () => {
          (editor as any).currentPdfDoc = { other: true };
          return [];
        });

        await editor.handleFiles(asFileList(pdfFile()));
        await flush();

        expect(manager().getAllAnnotations()).toHaveLength(0);
      });
    });
  });
});
