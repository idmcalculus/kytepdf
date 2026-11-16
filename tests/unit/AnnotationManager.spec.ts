import { beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error
import { type Annotation, AnnotationManager } from "../../utils/AnnotationManager";
import { HistoryManager } from "../../utils/HistoryManager";

describe("AnnotationManager", () => {
  let manager: AnnotationManager;

  beforeEach(() => {
    manager = new AnnotationManager();
  });

  it("should add a text annotation", () => {
    const ann: Omit<Annotation, "id"> = {
      type: "text",
      pageIndex: 0,
      x: 100,
      y: 100,
      content: "Hello World",
      style: { fontSize: 12, color: "#000000" },
    };

    const id = manager.addAnnotation(ann);
    expect(id).toBeDefined();

    const annotations = manager.getAnnotations(0);
    expect(annotations.length).toBe(1);
    expect(annotations[0].content).toBe("Hello World");
  });

  it("should update an existing annotation", () => {
    const id = manager.addAnnotation({
      type: "text",
      pageIndex: 0,
      x: 100,
      y: 100,
      content: "Old Text",
    });

    manager.updateAnnotation(id, { content: "New Text", x: 150 });

    const ann = manager.getAnnotation(id);
    expect(ann?.content).toBe("New Text");
    expect(ann?.x).toBe(150);
    expect(ann?.y).toBe(100); // Should preserve unchanged properties
  });

  it("should remove an annotation", () => {
    const id = manager.addAnnotation({
      type: "rectangle",
      pageIndex: 1,
      x: 50,
      y: 50,
      width: 100,
      height: 100,
    });

    expect(manager.getAnnotations(1).length).toBe(1);
    manager.removeAnnotation(id);
    expect(manager.getAnnotations(1).length).toBe(0);
  });

  it("should return annotations grouped by page", () => {
    manager.addAnnotation({ type: "text", pageIndex: 0, x: 0, y: 0 });
    manager.addAnnotation({ type: "text", pageIndex: 0, x: 10, y: 10 });
    manager.addAnnotation({ type: "text", pageIndex: 1, x: 0, y: 0 });

    expect(manager.getAnnotations(0).length).toBe(2);
    expect(manager.getAnnotations(1).length).toBe(1);
  });

  it("should clear all annotations", () => {
    manager.addAnnotation({ type: "text", pageIndex: 0, x: 0, y: 0 });
    manager.clear();
    expect(manager.getAllAnnotations().length).toBe(0);
  });

  it("should report a missing annotation instead of creating one", () => {
    expect(manager.updateAnnotation("missing", { x: 1 })).toBe(false);
    expect(manager.removeAnnotation("missing")).toBe(false);
    expect(manager.getAllAnnotations()).toHaveLength(0);
  });

  it("should keep a caller-supplied id, as undo/redo needs when restoring", () => {
    const id = manager.addAnnotation({ type: "text", pageIndex: 0, x: 0, y: 0 }, { id: "keep-me" });
    expect(id).toBe("keep-me");
    expect(manager.getAnnotation("keep-me")).toMatchObject({ id: "keep-me", type: "text" });
  });

  describe("history recording", () => {
    let history: HistoryManager;

    beforeEach(() => {
      history = new HistoryManager();
      manager = new AnnotationManager(history);
    });

    it("records add, update and remove with before and after states", () => {
      const id = manager.addAnnotation({
        type: "textblock",
        pageIndex: 0,
        x: 10,
        y: 20,
        richContent: "<b>Bold</b>",
        style: { bold: true, textAlign: "center" },
      });
      manager.updateAnnotation(id, { style: { bold: false, textAlign: "right" } });
      manager.removeAnnotation(id);

      const remove = history.undo();
      const update = history.undo();
      const add = history.undo();
      expect(history.canUndo()).toBe(false);

      expect(add).toMatchObject({
        type: "add",
        annotationId: id,
        previousState: null,
        newState: { richContent: "<b>Bold</b>", style: { bold: true, textAlign: "center" } },
      });
      expect(update).toMatchObject({
        type: "update",
        previousState: { style: { bold: true, textAlign: "center" } },
        newState: { style: { bold: false, textAlign: "right" } },
      });
      expect(remove).toMatchObject({
        type: "remove",
        previousState: { style: { bold: false, textAlign: "right" } },
        newState: null,
      });
    });

    it("stores snapshots that later edits cannot change", () => {
      const id = manager.addAnnotation({
        type: "freehand",
        pageIndex: 0,
        x: 0,
        y: 0,
        points: [{ x: 1, y: 1 }],
        style: { color: "#000000" },
      });
      const live = manager.getAnnotation(id) as Annotation;
      (live.style as { color: string }).color = "#ff0000";
      (live.points as Array<{ x: number }>)[0].x = 99;

      const add = history.undo();
      expect(add?.newState?.style?.color).toBe("#000000");
      expect(add?.newState?.points?.[0].x).toBe(1);
    });

    it("skips history when asked, so undo/redo replays do not record themselves", () => {
      const id = manager.addAnnotation(
        { type: "rectangle", pageIndex: 0, x: 0, y: 0 },
        { recordHistory: false },
      );
      manager.updateAnnotation(id, { x: 5 }, { recordHistory: false });
      manager.removeAnnotation(id, { recordHistory: false });

      expect(history.canUndo()).toBe(false);
    });

    it("records into a history manager attached later and stops when it is detached", () => {
      const plain = new AnnotationManager();
      plain.addAnnotation({ type: "text", pageIndex: 0, x: 0, y: 0 });

      plain.setHistoryManager(history);
      plain.addAnnotation({ type: "text", pageIndex: 0, x: 1, y: 1 });
      expect(history.undo()?.type).toBe("add");

      plain.setHistoryManager(null);
      plain.addAnnotation({ type: "text", pageIndex: 0, x: 2, y: 2 });
      expect(history.canUndo()).toBe(false);
    });
  });

  describe("extracted sources", () => {
    const source = { pageIndex: 0, x: 5, y: 6, width: 70, height: 12 };

    it("keeps the original regions even after their annotations are removed", () => {
      const id = manager.addAnnotation({ type: "textblock", pageIndex: 0, x: 5, y: 6 });
      manager.addExtractedSource(source);
      manager.removeAnnotation(id);

      expect(manager.getAllExtractedSources()).toEqual([source]);
    });

    it("returns a copy so callers cannot drop regions from the export", () => {
      manager.addExtractedSource(source);
      manager.getAllExtractedSources().pop();

      expect(manager.getAllExtractedSources()).toHaveLength(1);
    });

    it("forgets the regions when cleared for a new document", () => {
      manager.addExtractedSource(source);
      manager.clear();

      expect(manager.getAllExtractedSources()).toEqual([]);
    });
  });
});
