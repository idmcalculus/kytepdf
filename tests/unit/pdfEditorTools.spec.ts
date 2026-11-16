import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { FreehandEditor } from "../../components/pdf-editor/FreehandEditor";
import { HighlighterEditor } from "../../components/pdf-editor/HighlighterEditor";
import { StrikethroughEditor } from "../../components/pdf-editor/StrikethroughEditor";
import { TextEditor } from "../../components/pdf-editor/TextEditor";
import type { ToolContext } from "../../components/pdf-editor/types";
import { UnderlineEditor } from "../../components/pdf-editor/UnderlineEditor";
import { AnnotationManager } from "../../utils/AnnotationManager";

/** A page whose viewport maps shown points to PDF ones like pdf.js (unrotated by default). */
const makePdfDoc = (
  items: unknown[],
  viewport: {
    width: number;
    height: number;
    convertToPdfPoint?: (x: number, y: number) => number[];
  } = { width: 400, height: 500 },
  userUnit?: number,
) => ({
  getPage: vi.fn().mockResolvedValue({
    userUnit,
    getTextContent: vi.fn().mockResolvedValue({ items }),
    getViewport: vi.fn().mockReturnValue({
      convertToPdfPoint: (x: number, y: number) => [x, viewport.height - y],
      ...viewport,
    }),
  }),
});

describe("pdf editor drawing tools", () => {
  let container: HTMLElement;
  let manager: AnnotationManager;
  let renderAnnotation: Mock<(id: string) => void>;
  let context: ToolContext;

  const pageWrapper = (index: number) =>
    container.querySelector(`.pdf-page-wrapper[data-index="${index}"]`) as HTMLElement;
  const only = () => {
    const all = manager.getAllAnnotations();
    expect(all).toHaveLength(1);
    return all[0];
  };

  beforeEach(() => {
    container = document.createElement("div");
    container.innerHTML = `
      <div class="pdf-page-wrapper" data-index="0"></div>
      <div class="pdf-page-wrapper" data-index="1"></div>
    `;
    document.body.appendChild(container);
    manager = new AnnotationManager();
    renderAnnotation = vi.fn<(id: string) => void>();
    context = {
      container,
      annotationManager: manager,
      pdfDoc: makePdfDoc([]),
      renderAnnotation,
      showProperties: vi.fn(),
    };
  });

  describe("TextEditor", () => {
    it("adds a text box at the click with the default style", async () => {
      const tool = new TextEditor(context);

      await tool.onPageClick(1, 120, 90);

      const ann = only();
      expect(ann).toMatchObject({
        type: "text",
        pageIndex: 1,
        x: 120,
        y: 90,
        content: "New Text",
        style: { fontSize: 16, color: "#000000", font: "Helvetica" },
      });
      expect(context.pdfDoc.getPage).toHaveBeenCalledWith(2);
      expect(renderAnnotation).toHaveBeenCalledWith(ann.id);
    });

    it("matches the size of the nearest PDF text, in editor pixels", async () => {
      // Page is 400pt wide and shown 800px wide, so 1pt = 2px.
      // A click at (200, 200)px is (100, 400)pt in PDF space.
      context.pdfDoc = makePdfDoc([
        { str: "no transform" },
        { str: "far", transform: [30, 0, 0, 30, 300, 100] },
        { str: "near", transform: [11.6, 0, 0, 11.6, 110, 405] },
        { str: "nearer", transform: [9, 0, 0, 9, 102, 401] },
      ]);
      const tool = new TextEditor(context);

      await tool.onPageClick(0, 200, 200);

      expect(only().style?.fontSize).toBe(18);
    });

    it("finds nearby text on a rotated page through the page viewport", async () => {
      // A 400 x 500pt page turned 90° shows 500pt wide: 1.6px per point. A
      // click at (160, 320)px is (100, 200)pt as shown, which is (200, 100)pt
      // in PDF space; the text there is turned with the page, 15pt tall.
      context.pdfDoc = makePdfDoc([{ str: "turned", transform: [0, 15, -15, 0, 201, 101] }], {
        width: 500,
        height: 400,
        convertToPdfPoint: (x, y) => [y, x],
      });
      const tool = new TextEditor(context);

      await tool.onPageClick(0, 160, 320);

      expect(only().style?.fontSize).toBe(24);
    });

    it("matches sizes on a page with a /UserUnit", async () => {
      // pdf.js shows the 400-unit page with /UserUnit 2 as 800 units wide, so
      // 1px per viewport unit and 2px per PDF unit: 9-unit text is 18px.
      context.pdfDoc = makePdfDoc(
        [{ str: "big", transform: [9, 0, 0, 9, 101, 499] }],
        { width: 800, height: 1000, convertToPdfPoint: (x, y) => [x / 2, 500 - y / 2] },
        2,
      );
      const tool = new TextEditor(context);

      await tool.onPageClick(0, 200, 2);

      expect(only().style?.fontSize).toBe(18);
    });

    it("keeps the default size when no text is within reach", async () => {
      context.pdfDoc = makePdfDoc([{ str: "far", transform: [30, 0, 0, 30, 390, 10] }]);
      const tool = new TextEditor(context);

      await tool.onPageClick(0, 10, 10);

      expect(only().style?.fontSize).toBe(16);
    });

    it("still adds the text box when reading the page fails", async () => {
      context.pdfDoc = { getPage: vi.fn().mockRejectedValue(new Error("page gone")) };
      const tool = new TextEditor(context);

      await tool.onPageClick(0, 40, 50);

      expect(only()).toMatchObject({ x: 40, y: 50, style: { fontSize: 16 } });
      expect(renderAnnotation).toHaveBeenCalledTimes(1);
    });
  });

  describe("FreehandEditor", () => {
    it("ignores pointer input until the tool is activated", () => {
      const tool = new FreehandEditor(context);
      tool.onPageClick();

      tool.onPointerDown(0, 10, 10);
      tool.onPointerMove(0, 20, 20);
      tool.onPointerUp(0, 30, 30);

      expect(manager.getAllAnnotations()).toHaveLength(0);
      expect(container.querySelector(".annotation-freehand")).toBeNull();
    });

    it("draws a live preview and saves the stroke relative to its bounds", () => {
      const tool = new FreehandEditor(context);
      tool.onActivate();

      tool.onPointerDown(0, 50, 60);
      const preview = pageWrapper(0).querySelector(".annotation-freehand") as HTMLElement;
      expect(preview).not.toBeNull();
      expect(preview.style.pointerEvents).toBe("none");

      tool.onPointerMove(0, 20, 100);
      expect(preview.style.left).toBe("20px");
      expect(preview.style.top).toBe("60px");
      expect(preview.style.width).toBe("30px");
      expect(preview.style.height).toBe("40px");
      expect(preview.querySelector("path")?.getAttribute("d")).toBe("M 30 0 L 0 40");

      tool.onPointerUp(0, 70, 80);

      const ann = only();
      expect(ann).toMatchObject({
        type: "freehand",
        pageIndex: 0,
        x: 20,
        y: 60,
        width: 50,
        height: 40,
        points: [
          { x: 30, y: 0 },
          { x: 0, y: 40 },
          { x: 50, y: 20 },
        ],
        style: { color: "#111827", strokeWidth: 2, opacity: 1 },
      });
      expect(renderAnnotation).toHaveBeenCalledWith(ann.id);
      expect(container.querySelector(".annotation-freehand")).toBeNull();
    });

    it("ignores moves and releases on a different page", () => {
      const tool = new FreehandEditor(context);
      tool.onActivate();
      tool.onPointerDown(0, 10, 10);

      tool.onPointerMove(1, 40, 40);
      tool.onPointerUp(1, 40, 40);
      expect(manager.getAllAnnotations()).toHaveLength(0);

      tool.onPointerUp(0, 10, 10);
      expect(manager.getAllAnnotations()).toHaveLength(1);
    });

    it("turns a single click into a tiny visible dot", () => {
      const tool = new FreehandEditor(context);
      tool.onActivate();

      tool.onPointerDown(0, 15, 25);
      tool.onPointerUp(0, 15, 25);

      const ann = only();
      expect(ann.x).toBe(15);
      expect(ann.y).toBe(25);
      expect(ann.width).toBe(1);
      expect(ann.height).toBe(1);
      expect(ann.points?.length).toBeGreaterThanOrEqual(2);
    });

    it("still saves the stroke when the page has no wrapper to preview on", () => {
      const tool = new FreehandEditor(context);
      tool.onActivate();

      tool.onPointerDown(5, 0, 0);
      tool.onPointerMove(5, 10, 10);
      tool.onPointerUp(5, 20, 5);

      expect(only()).toMatchObject({ pageIndex: 5, x: 0, y: 0, width: 20, height: 10 });
    });

    it("pads one-point and empty strokes so their bounds stay finite", () => {
      const tool = new FreehandEditor(context) as any;

      expect(tool.ensureRenderablePoints([{ x: 1, y: 2 }])).toEqual([
        { x: 1, y: 2 },
        { x: 1.1, y: 2.1 },
      ]);
      expect(tool.ensureRenderablePoints([])).toEqual([]);
      expect(tool.getBounds([])).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
    });
  });

  describe.each([
    ["strikethrough", StrikethroughEditor, "addStrikeBtn"],
    ["underline", UnderlineEditor, "addUnderlineBtn"],
  ] as const)("%s tool", (lineType, Tool, buttonId) => {
    it("is registered against its toolbar button and ignores plain clicks", () => {
      const tool = new Tool(context);
      expect(tool.id).toBe(buttonId);

      tool.onPageClick();
      tool.onPointerDown(0, 10, 10);
      tool.onPointerMove(0, 20, 20);
      tool.onPointerUp(0, 20, 20);

      expect(manager.getAllAnnotations()).toHaveLength(0);
    });

    it("previews the line and saves it with the default stroke", () => {
      const tool = new Tool(context);
      tool.onActivate();

      tool.onPointerDown(0, 100, 50);
      const preview = pageWrapper(0).querySelector(`.annotation-${lineType}`) as HTMLElement;
      const line = preview.querySelector(".line-annotation") as HTMLElement;
      expect(line.style.height).toBe("2px");

      tool.onPointerMove(1, 10, 10);
      expect(preview.style.left).toBe("100px");

      tool.onPointerMove(0, 40, 70);
      expect(preview.style.left).toBe("40px");
      expect(preview.style.top).toBe("50px");
      expect(preview.style.width).toBe("60px");
      expect(preview.style.height).toBe("20px");
      // Underlines sit on the bottom edge; strikethroughs through the middle.
      expect(line.style.top).toBe(lineType === "underline" ? "18px" : "9px");

      tool.onPointerUp(0, 40, 70);

      const ann = only();
      expect(ann).toMatchObject({
        type: lineType,
        x: 40,
        y: 50,
        width: 60,
        height: 20,
        style: { color: "#111827", strokeWidth: 2, opacity: 1 },
      });
      expect(renderAnnotation).toHaveBeenCalledWith(ann.id);
      expect(container.querySelector(`.annotation-${lineType}`)).toBeNull();
    });

    it("gives a short flat drag a usable minimum size", () => {
      const tool = new Tool(context);
      tool.onActivate();

      tool.onPointerDown(0, 10, 10);
      tool.onPointerUp(0, 15, 10);

      expect(only()).toMatchObject({ width: 30, height: 4 });
    });

    it("still saves the line when the page has no wrapper to preview on", () => {
      const tool = new Tool(context);
      tool.onActivate();

      tool.onPointerDown(9, 0, 0);
      tool.onPointerMove(9, 50, 1);
      tool.onPointerUp(9, 50, 1);

      expect(only()).toMatchObject({ pageIndex: 9, width: 50 });
    });
  });

  describe("HighlighterEditor", () => {
    it("ignores pointer input until the tool is activated", () => {
      const tool = new HighlighterEditor(context);
      tool.onPageClick();

      tool.onPointerDown(0, 10, 10);
      tool.onPointerMove(0, 20, 20);
      tool.onPointerUp(0, 20, 20);

      expect(manager.getAllAnnotations()).toHaveLength(0);
    });

    it("previews the highlight as a translucent yellow box and saves it", () => {
      const tool = new HighlighterEditor(context);
      tool.onActivate();

      tool.onPointerDown(0, 200, 100);
      const preview = pageWrapper(0).querySelector(".annotation-highlight") as HTMLElement;
      expect(preview.style.backgroundColor).toBe("rgb(255, 255, 0)");
      expect(preview.style.opacity).toBe("0.3");

      tool.onPointerMove(1, 0, 0);
      expect(preview.style.left).toBe("200px");

      tool.onPointerMove(0, 120, 140);
      expect(preview.style.left).toBe("120px");
      expect(preview.style.width).toBe("80px");
      expect(preview.style.height).toBe("40px");

      tool.onPointerUp(0, 120, 140);

      const ann = only();
      expect(ann).toMatchObject({
        type: "highlight",
        x: 120,
        y: 100,
        width: 80,
        height: 40,
        style: { color: "#ffff00", opacity: 0.3 },
      });
      expect(container.querySelector(".annotation-highlight")).toBeNull();
    });

    it("gives a click without a drag a minimum highlight size", () => {
      const tool = new HighlighterEditor(context);
      tool.onActivate();

      tool.onPointerDown(4, 30, 30);
      tool.onPointerMove(4, 30, 30);
      tool.onPointerUp(4, 30, 30);

      expect(only()).toMatchObject({ pageIndex: 4, width: 20, height: 12 });
    });

    it("stops drawing once deactivated", () => {
      const tool = new HighlighterEditor(context);
      tool.onActivate();
      tool.onDeactivate();

      tool.onPointerDown(0, 1, 1);

      expect(tool.active).toBe(false);
      expect(container.querySelector(".annotation-highlight")).toBeNull();
    });
  });
});
