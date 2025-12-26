import { describe, it, expect, beforeEach } from "vitest";
// @ts-ignore
import { AnnotationManager, Annotation } from "../../utils/AnnotationManager";

describe("AnnotationManager", () => {
  let manager: AnnotationManager;

  beforeEach(() => {
    manager = new AnnotationManager();
  });

  it("should add a text annotation", () => {
    const ann: Omit<Annotation, 'id'> = {
      type: 'text',
      pageIndex: 0,
      x: 100,
      y: 100,
      content: 'Hello World',
      style: { fontSize: 12, color: '#000000' }
    };

    const id = manager.addAnnotation(ann);
    expect(id).toBeDefined();
    
    const annotations = manager.getAnnotations(0);
    expect(annotations.length).toBe(1);
    expect(annotations[0].content).toBe('Hello World');
  });

  it("should update an existing annotation", () => {
    const id = manager.addAnnotation({
      type: 'text',
      pageIndex: 0,
      x: 100,
      y: 100,
      content: 'Old Text'
    });

    manager.updateAnnotation(id, { content: 'New Text', x: 150 });
    
    const ann = manager.getAnnotation(id);
    expect(ann?.content).toBe('New Text');
    expect(ann?.x).toBe(150);
    expect(ann?.y).toBe(100); // Should preserve unchanged properties
  });

  it("should remove an annotation", () => {
    const id = manager.addAnnotation({
      type: 'rectangle',
      pageIndex: 1,
      x: 50,
      y: 50,
      width: 100,
      height: 100
    });

    expect(manager.getAnnotations(1).length).toBe(1);
    manager.removeAnnotation(id);
    expect(manager.getAnnotations(1).length).toBe(0);
  });

  it("should return annotations grouped by page", () => {
    manager.addAnnotation({ type: 'text', pageIndex: 0, x: 0, y: 0 });
    manager.addAnnotation({ type: 'text', pageIndex: 0, x: 10, y: 10 });
    manager.addAnnotation({ type: 'text', pageIndex: 1, x: 0, y: 0 });

    expect(manager.getAnnotations(0).length).toBe(2);
    expect(manager.getAnnotations(1).length).toBe(1);
  });

  it("should clear all annotations", () => {
    manager.addAnnotation({ type: 'text', pageIndex: 0, x: 0, y: 0 });
    manager.clear();
    expect(manager.getAllAnnotations().length).toBe(0);
  });
});
