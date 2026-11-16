import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../utils/logger.ts", () => ({ logger: mocks.logger }));

import { ImageExtractor } from "../../utils/ImageExtractor";

// pdf.js operator codes (pdfjs-dist OPS).
const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  paintImageMaskXObject: 83,
  paintImageMaskXObjectGroup: 84,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintInlineImageXObjectGroup: 87,
  paintImageXObjectRepeat: 88,
  paintImageMaskXObjectRepeat: 89,
} as const;

type Pixel = [number, number, number, number];
type Painter = (x: number, y: number) => Pixel;
type Rect = { x: number; y: number; width: number; height: number };

const WHITE: Pixel = [255, 255, 255, 255];
const INK: Pixel = [30, 60, 90, 255];

/** Paints the given rectangles (in 800px editor space) dark on a white page. */
const pagePainter =
  (rects: Rect[]): Painter =>
  (x, y) =>
    rects.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)
      ? INK
      : WHITE;

interface FakeCanvas {
  width: number;
  height: number;
  painter: Painter;
  ctx: any;
  getContext: ReturnType<typeof vi.fn>;
  toDataURL: ReturnType<typeof vi.fn>;
}

/**
 * A canvas whose pixels come from a painter function. drawImage copies the
 * source's painter with the crop offset, so getImageData on a crop reads the
 * pixels of the region it was cut from.
 */
function makeCanvas(
  width = 0,
  height = 0,
  painter: Painter = () => WHITE,
  options: { noContext?: boolean; encodeError?: Error } = {},
): FakeCanvas {
  const canvas = { width, height, painter } as FakeCanvas;
  canvas.ctx = {
    canvas,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    drawImage: vi.fn((source: FakeCanvas, sx: number, sy: number) => {
      canvas.painter = (x, y) => source.painter(sx + x, sy + y);
    }),
    getImageData: vi.fn((x: number, y: number) => ({
      data: Uint8ClampedArray.from(canvas.painter(x, y)),
    })),
  };
  canvas.getContext = vi.fn(() => (options.noContext ? null : canvas.ctx));
  canvas.toDataURL = vi.fn((type: string) => {
    if (options.encodeError) throw options.encodeError;
    return `data:${type};crop=${canvas.width}x${canvas.height}`;
  });
  return canvas;
}

/** Every canvas the extractor creates, in order; options apply by creation index. */
function installCanvasFactory(
  optionsByIndex: Record<number, Parameters<typeof makeCanvas>[3]> = {},
) {
  const created: FakeCanvas[] = [];
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
    if (tagName !== "canvas") return createElement(tagName);
    const canvas = makeCanvas(0, 0, () => WHITE, optionsByIndex[created.length]);
    created.push(canvas);
    return canvas;
  }) as typeof document.createElement);
  return created;
}

/**
 * A pdf.js page viewport (pdfjs-dist 5 PageViewport, userUnit 1): the view box
 * turned by `rotation`, scaled, with a top-left origin.
 */
function fakeViewport(viewBox: number[], scale: number, rotation = 0) {
  const [x0, y0, x1, y1] = viewBox;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const r = ((rotation % 360) + 360) % 360;
  const [a, b, c, d] =
    r === 90
      ? [0, 1, 1, 0]
      : r === 180
        ? [-1, 0, 0, 1]
        : r === 270
          ? [0, -1, -1, 0]
          : [1, 0, 0, -1];
  const sideways = a === 0;
  const offsetX = (sideways ? Math.abs(cy - y0) : Math.abs(cx - x0)) * scale;
  const offsetY = (sideways ? Math.abs(cx - x0) : Math.abs(cy - y0)) * scale;
  const t = [
    a * scale,
    b * scale,
    c * scale,
    d * scale,
    offsetX - a * scale * cx - c * scale * cy,
    offsetY - b * scale * cx - d * scale * cy,
  ];
  return {
    width: (sideways ? y1 - y0 : x1 - x0) * scale,
    height: (sideways ? x1 - x0 : y1 - y0) * scale,
    scale,
    rotation: r,
    transform: t,
    convertToViewportPoint: (x: number, y: number) => [
      t[0] * x + t[2] * y + t[4],
      t[1] * x + t[3] * y + t[5],
    ],
  };
}

interface FakePageOptions {
  /** Page size in PDF points. */
  width?: number;
  height?: number;
  /** /Rotate, and a view (crop) box other than [0, 0, width, height]. */
  rotation?: number;
  viewBox?: number[];
  fnArray?: number[];
  argsArray?: any[];
  /** What the page shows, in 800px editor space. */
  content?: Rect[];
  renderError?: Error;
  noOperatorList?: boolean;
}

function makePdf(options: FakePageOptions) {
  const { width = 400, height = 500, fnArray = [], argsArray = [], content = [] } = options;
  const painter = pagePainter(content);
  const page: any = {
    getViewport: vi.fn(({ scale }: { scale: number }) =>
      fakeViewport(options.viewBox ?? [0, 0, width, height], scale, options.rotation),
    ),
    render: vi.fn(({ canvasContext }: any) => {
      if (options.renderError) return { promise: Promise.reject(options.renderError) };
      // Draw the same content at the target canvas's resolution.
      const target: FakeCanvas = canvasContext.canvas;
      const k = target.width / 800;
      target.painter = (x, y) => painter(x / k, y / k);
      return { promise: Promise.resolve() };
    }),
  };
  if (!options.noOperatorList) {
    page.getOperatorList = vi.fn(async () => ({ fnArray, argsArray }));
  }
  const pdfDoc = { getPage: vi.fn(async () => page) };
  const shown = fakeViewport(options.viewBox ?? [0, 0, width, height], 1, options.rotation);
  const editorHeight = Math.floor((shown.height * 800) / shown.width);
  const rendered = makeCanvas(800, editorHeight, painter);
  return { pdfDoc, page, rendered };
}

/** `q <matrix> cm /Im Do Q` as pdf.js lists it. */
const drawImage = (matrix: number[]) => ({
  fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
  argsArray: [null, matrix, ["img_1"], null],
});

const concat = (...parts: Array<{ fnArray: number[]; argsArray: any[] }>) => ({
  fnArray: parts.flatMap((p) => p.fnArray),
  argsArray: parts.flatMap((p) => p.argsArray),
});

const regionOf = (img: { x: number; y: number; width: number; height: number }) => ({
  x: img.x,
  y: img.y,
  width: img.width,
  height: img.height,
});

describe("ImageExtractor", () => {
  let extractor: ImageExtractor;

  beforeEach(() => {
    vi.clearAllMocks();
    extractor = new ImageExtractor();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("crops each image from a 3x re-render and reports it in editor coordinates", async () => {
    // A 400 x 500 pt page shows at 800 x 1000 in the editor (scale 2). The image
    // is 100 x 50 pt with its lower-left corner at (40, 400).
    const created = installCanvasFactory();
    const { pdfDoc, page, rendered } = makePdf({
      ...drawImage([100, 0, 0, 50, 40, 400]),
      content: [{ x: 80, y: 100, width: 200, height: 100 }],
    });

    const images = await extractor.extractPageImages(pdfDoc, 3, rendered as any);

    expect(pdfDoc.getPage).toHaveBeenCalledWith(4);
    expect(images).toEqual([
      {
        pageIndex: 3,
        x: 80,
        y: 100,
        width: 200,
        height: 100,
        dataUrl: "data:image/png;crop=600x300",
      },
    ]);

    // The page was re-rendered at three times the editor scale.
    expect(page.render).toHaveBeenCalledTimes(1);
    const [capture, crop] = created;
    expect(page.render.mock.calls[0][0].viewport.scale).toBe(6);
    expect(capture.width).toBe(2400);
    expect(capture.height).toBe(3000);
    expect(crop.ctx.drawImage).toHaveBeenCalledWith(capture, 240, 300, 600, 300, 0, 0, 600, 300);
    expect(crop.ctx.imageSmoothingEnabled).toBe(true);
    expect(crop.ctx.imageSmoothingQuality).toBe("high");
  });

  it("tracks nested transforms and restores the matrix after each save/restore pair", async () => {
    installCanvasFactory();
    const { pdfDoc, rendered } = makePdf({
      fnArray: [
        OPS.restore, // stray restore with nothing saved: must not reset anything
        OPS.save,
        OPS.transform,
        OPS.save,
        OPS.transform,
        OPS.paintImageXObject,
        OPS.restore,
        OPS.restore,
        OPS.save,
        OPS.transform,
        OPS.paintImageXObject,
        OPS.restore,
      ],
      argsArray: [
        null,
        null,
        [1, 0, 0, 1, 50, 50],
        null,
        [100, 0, 0, 50, 0, 0],
        ["img_1"],
        null,
        null,
        null,
        [60, 0, 0, 60, 200, 300],
        ["img_2"],
        null,
      ],
      content: [
        { x: 100, y: 800, width: 200, height: 100 },
        { x: 400, y: 280, width: 120, height: 120 },
      ],
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(images.map(regionOf)).toEqual([
      // translate(50, 50) then scale(100, 50)
      { x: 100, y: 800, width: 200, height: 100 },
      // back at the page matrix: no leftover translation from the first image
      { x: 400, y: 280, width: 120, height: 120 },
    ]);
  });

  it("returns nothing, without a re-render, when the page paints no images", async () => {
    const created = installCanvasFactory();
    const { pdfDoc, page, rendered } = makePdf({
      fnArray: [OPS.save, OPS.transform, OPS.restore],
      argsArray: [null, [1, 0, 0, 1, 10, 10], null],
    });

    await expect(extractor.extractPageImages(pdfDoc, 0, rendered as any)).resolves.toEqual([]);
    expect(page.render).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it("ignores images of 20 editor pixels or less, such as bullets and rules", async () => {
    installCanvasFactory();
    const { pdfDoc, page, rendered } = makePdf({
      ...concat(
        drawImage([10, 0, 0, 10, 40, 400]), // 20 x 20 px
        drawImage([200, 0, 0, 5, 40, 300]), // 400 x 10 px rule
      ),
      content: [
        { x: 80, y: 180, width: 20, height: 20 },
        { x: 80, y: 390, width: 400, height: 10 },
      ],
    });

    await expect(extractor.extractPageImages(pdfDoc, 0, rendered as any)).resolves.toEqual([]);
    expect(page.render).not.toHaveBeenCalled();
  });

  it("keeps one copy of an image painted twice in the same place but keeps overlapping images", async () => {
    installCanvasFactory();
    const { pdfDoc, rendered } = makePdf({
      ...concat(
        drawImage([100, 0, 0, 50, 40, 400]),
        drawImage([100, 0, 0, 50, 41, 400]), // same image nudged 1pt: IoU > 0.9
        drawImage([100, 0, 0, 50, 90, 400]), // half overlap: a different image
      ),
      content: [{ x: 80, y: 100, width: 300, height: 100 }],
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(images.map(regionOf)).toEqual([
      { x: 80, y: 100, width: 200, height: 100 },
      { x: 180, y: 100, width: 200, height: 100 },
    ]);
  });

  it("drops image regions that render as blank white", async () => {
    installCanvasFactory();
    const { pdfDoc, rendered } = makePdf({
      ...concat(
        drawImage([100, 0, 0, 50, 40, 400]), // white image (e.g. a masked-out box)
        drawImage([100, 0, 0, 50, 40, 200]),
      ),
      content: [{ x: 80, y: 500, width: 200, height: 100 }],
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(images.map(regionOf)).toEqual([{ x: 80, y: 500, width: 200, height: 100 }]);
  });

  it("keeps an image that is mostly but not entirely white", async () => {
    installCanvasFactory();
    // Only the left tenth of the image has ink, so about 10% of samples are dark.
    const { pdfDoc, rendered } = makePdf({
      ...drawImage([100, 0, 0, 50, 40, 400]),
      content: [{ x: 80, y: 100, width: 20, height: 100 }],
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(images.map(regionOf)).toEqual([{ x: 80, y: 100, width: 200, height: 100 }]);
  });

  it("trims images that run past the right and bottom edges of the page", async () => {
    installCanvasFactory();
    const { pdfDoc, rendered } = makePdf({
      ...drawImage([100, 0, 0, 100, 350, -50]), // 700..900 px across, 900..1100 px down
      content: [{ x: 700, y: 900, width: 100, height: 100 }],
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(images.map(regionOf)).toEqual([{ x: 700, y: 900, width: 100, height: 100 }]);
    expect(images[0].dataUrl).toBe("data:image/png;crop=300x300");
  });

  it("trims images that start left of or above the page to the part on the page", async () => {
    installCanvasFactory();
    const { pdfDoc, rendered } = makePdf({
      // 100 x 100 pt from (-20, 420): -40..160 px across, -40..160 px down.
      ...drawImage([100, 0, 0, 100, -20, 420]),
      content: [{ x: 0, y: 0, width: 160, height: 160 }],
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(images.map(regionOf)).toEqual([{ x: 0, y: 0, width: 160, height: 160 }]);
    expect(images[0].dataUrl).toBe("data:image/png;crop=480x480");
  });

  it("skips images that are almost entirely off the page", async () => {
    installCanvasFactory();
    const { pdfDoc, rendered } = makePdf({
      ...drawImage([50, 0, 0, 50, 395, 200]), // only 10 px of it is on the page
      content: [{ x: 790, y: 500, width: 10, height: 100 }],
    });

    await expect(extractor.extractPageImages(pdfDoc, 0, rendered as any)).resolves.toEqual([]);
  });

  it("places vertically flipped images where pdf.js draws them", async () => {
    installCanvasFactory();
    // Same 100 x 50 pt box as the first test, drawn top-down: y runs 450 -> 400.
    const { pdfDoc, rendered } = makePdf({
      ...drawImage([100, 0, 0, -50, 40, 450]),
      content: [{ x: 80, y: 100, width: 200, height: 100 }],
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(images.map(regionOf)).toEqual([{ x: 80, y: 100, width: 200, height: 100 }]);
  });

  it("places images rotated by 90 degrees where pdf.js draws them", async () => {
    installCanvasFactory();
    // A 50 x 100 image turned a quarter turn fills x 40..140, y 400..450 (pt).
    const { pdfDoc, rendered } = makePdf({
      ...drawImage([0, 50, -100, 0, 140, 400]),
      content: [{ x: 80, y: 100, width: 200, height: 100 }],
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(images.map(regionOf)).toEqual([{ x: 80, y: 100, width: 200, height: 100 }]);
  });

  it("applies a form XObject's matrix and drops the form's transforms when it ends", async () => {
    installCanvasFactory();
    const { pdfDoc, rendered } = makePdf({
      fnArray: [
        OPS.paintFormXObjectBegin,
        // Form content with a bare `cm`: the form's own q/Q is implied.
        OPS.transform,
        OPS.paintImageXObject,
        OPS.paintFormXObjectEnd,
        OPS.paintFormXObjectBegin, // a form without /Matrix
        OPS.paintFormXObjectEnd,
        OPS.paintFormXObjectEnd, // unbalanced end: ignored
        ...drawImage([100, 0, 0, 50, 40, 200]).fnArray,
      ],
      argsArray: [
        [new Float32Array([1, 0, 0, 1, 20, 0]), new Float32Array([0, 0, 500, 500])],
        [100, 0, 0, 50, 20, 400],
        ["img_form"],
        null,
        [null, null],
        null,
        null,
        ...drawImage([100, 0, 0, 50, 40, 200]).argsArray,
      ],
      content: [
        { x: 80, y: 100, width: 200, height: 100 },
        { x: 80, y: 500, width: 200, height: 100 },
      ],
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(images.map(regionOf)).toEqual([
      // (20 + 20, 400) pt: the form matrix shifts the image right by 20 pt.
      { x: 80, y: 100, width: 200, height: 100 },
      // Drawn after the form: the form's cm must not carry over.
      { x: 80, y: 500, width: 200, height: 100 },
    ]);
  });

  it("finds every copy of an image that pdf.js folded into one repeat operation", async () => {
    // pdf.js replaces three or more `q cm Do Q` runs of one image with
    // paintImageXObjectRepeat [objId, scaleX, scaleY, positions].
    installCanvasFactory();
    const { pdfDoc, rendered } = makePdf({
      fnArray: [OPS.save, OPS.transform, OPS.paintImageXObjectRepeat, OPS.restore],
      argsArray: [
        null,
        [1, 0, 0, 1, 0, 10], // whole group moved up 10 pt
        ["img_star", 50, 25, new Float32Array([20, 390, 120, 390, 220, 390])],
        null,
      ],
      content: [
        { x: 40, y: 150, width: 100, height: 50 },
        { x: 240, y: 150, width: 100, height: 50 },
        { x: 440, y: 150, width: 100, height: 50 },
      ],
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(images.map(regionOf)).toEqual([
      { x: 40, y: 150, width: 100, height: 50 },
      { x: 240, y: 150, width: 100, height: 50 },
      { x: 440, y: 150, width: 100, height: 50 },
    ]);
  });

  it("finds inline images and stencil masks as well as image XObjects", async () => {
    installCanvasFactory();
    const paintedAt = (op: number, matrix: number[]) => ({
      fnArray: [OPS.save, OPS.transform, op, OPS.restore],
      argsArray: [null, matrix, [{ width: 8, height: 8 }], null],
    });
    const { pdfDoc, rendered } = makePdf({
      ...concat(
        paintedAt(OPS.paintInlineImageXObject, [100, 0, 0, 50, 40, 400]),
        paintedAt(OPS.paintImageMaskXObject, [100, 0, 0, 50, 40, 200]),
      ),
      content: [
        { x: 80, y: 100, width: 200, height: 100 },
        { x: 80, y: 500, width: 200, height: 100 },
      ],
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(images.map(regionOf)).toEqual([
      { x: 80, y: 100, width: 200, height: 100 },
      { x: 80, y: 500, width: 200, height: 100 },
    ]);
  });

  it("finds every copy in pdf.js's grouped and repeated mask and inline image operations", async () => {
    installCanvasFactory();
    const { pdfDoc, rendered } = makePdf({
      fnArray: [
        OPS.save,
        OPS.transform,
        // [images], each with its own transform
        OPS.paintImageMaskXObjectGroup,
        // [imgData, map], each map entry with its own transform
        OPS.paintInlineImageXObjectGroup,
        // [img, scaleX, skewX, skewY, scaleY, positions]
        OPS.paintImageMaskXObjectRepeat,
        OPS.restore,
      ],
      argsArray: [
        null,
        [1, 0, 0, 1, 0, 10], // everything moved up 10 pt
        [
          [
            { data: "m1", width: 4, height: 4, transform: [50, 0, 0, 25, 20, 390] },
            { data: "m2", width: 4, height: 4, transform: [50, 0, 0, 25, 120, 390] },
          ],
        ],
        [{ width: 8, height: 4 }, [{ transform: [50, 0, 0, 25, 20, 290], x: 0, y: 0, w: 4, h: 4 }]],
        [{ data: "m3" }, 50, 0, 0, 25, new Float32Array([20, 190, 120, 190])],
        null,
      ],
      content: [
        { x: 40, y: 150, width: 300, height: 50 },
        { x: 40, y: 350, width: 100, height: 50 },
        { x: 40, y: 550, width: 300, height: 50 },
      ],
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(images.map(regionOf)).toEqual([
      { x: 40, y: 150, width: 100, height: 50 },
      { x: 240, y: 150, width: 100, height: 50 },
      { x: 40, y: 350, width: 100, height: 50 },
      { x: 40, y: 550, width: 100, height: 50 },
      { x: 240, y: 550, width: 100, height: 50 },
    ]);
  });

  it("leaves an image covering nearly the whole page in place as the page background", async () => {
    installCanvasFactory();
    // A 400 x 500 pt page: a full-page scan, a full-bleed photo running past
    // the edges, one covering 95% of the page, and a logo on top.
    const { pdfDoc, page, rendered } = makePdf({
      ...concat(
        drawImage([400, 0, 0, 500, 0, 0]),
        drawImage([420, 0, 0, 520, -10, -10]),
        drawImage([390, 0, 0, 487, 5, 5]),
        drawImage([100, 0, 0, 50, 40, 400]),
      ),
      content: [{ x: 0, y: 0, width: 800, height: 1000 }],
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(images.map(regionOf)).toEqual([{ x: 80, y: 100, width: 200, height: 100 }]);

    // A scan alone: nothing to extract, and no high-resolution render.
    page.render.mockClear();
    const scanOnly = makePdf({
      ...drawImage([400, 0, 0, 500, 0, 0]),
      content: [{ x: 0, y: 0, width: 800, height: 1000 }],
    });
    await expect(
      extractor.extractPageImages(scanOnly.pdfDoc, 0, scanOnly.rendered as any),
    ).resolves.toEqual([]);
    expect(scanOnly.page.render).not.toHaveBeenCalled();
  });

  it("still extracts a large picture that leaves a margin of the page", async () => {
    installCanvasFactory();
    // 360 x 400 pt of a 400 x 500 pt page: 72%.
    const { pdfDoc, rendered } = makePdf({
      ...drawImage([360, 0, 0, 400, 20, 50]),
      content: [{ x: 40, y: 100, width: 720, height: 800 }],
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(images.map(regionOf)).toEqual([{ x: 40, y: 100, width: 720, height: 800 }]);
  });

  it("crops from the editor canvas when the high-resolution render fails", async () => {
    const created = installCanvasFactory();
    const { pdfDoc, rendered } = makePdf({
      ...drawImage([100, 0, 0, 50, 40, 400]),
      content: [{ x: 80, y: 100, width: 200, height: 100 }],
      renderError: new Error("render cancelled"),
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(images.map(regionOf)).toEqual([{ x: 80, y: 100, width: 200, height: 100 }]);
    expect(images[0].dataUrl).toBe("data:image/png;crop=200x100");
    const crop = created[created.length - 1];
    expect(crop.ctx.drawImage).toHaveBeenCalledWith(rendered, 80, 100, 200, 100, 0, 0, 200, 100);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "High-resolution image capture render failed; using editor canvas",
      expect.any(Error),
    );
  });

  it("crops from the editor canvas when the capture canvas has no 2D context", async () => {
    const created = installCanvasFactory({ 0: { noContext: true } });
    const { pdfDoc, page, rendered } = makePdf({
      ...drawImage([100, 0, 0, 50, 40, 400]),
      content: [{ x: 80, y: 100, width: 200, height: 100 }],
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(page.render).not.toHaveBeenCalled();
    expect(images[0].dataUrl).toBe("data:image/png;crop=200x100");
    expect(created[1].ctx.drawImage).toHaveBeenCalledWith(
      rendered,
      80,
      100,
      200,
      100,
      0,
      0,
      200,
      100,
    );
  });

  it("skips the re-render for very tall pages whose editor canvas is already at the pixel budget", async () => {
    // A 400 x 10000 pt receipt is 800 x 20000 px in the editor: 16 MP already.
    const created = installCanvasFactory();
    const { pdfDoc, page, rendered } = makePdf({
      width: 400,
      height: 10000,
      ...drawImage([100, 0, 0, 50, 40, 9900]),
      content: [{ x: 80, y: 100, width: 200, height: 100 }],
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(page.render).not.toHaveBeenCalled();
    expect(created).toHaveLength(1); // only the crop canvas
    expect(images.map(regionOf)).toEqual([{ x: 80, y: 100, width: 200, height: 100 }]);
    expect(images[0].dataUrl).toBe("data:image/png;crop=200x100");
  });

  it("skips a region whose crop canvas has no 2D context", async () => {
    // Canvas 0 is the capture canvas, 1 and 2 are crops.
    installCanvasFactory({ 1: { noContext: true } });
    const { pdfDoc, rendered } = makePdf({
      ...concat(drawImage([100, 0, 0, 50, 40, 400]), drawImage([100, 0, 0, 50, 40, 200])),
      content: [
        { x: 80, y: 100, width: 200, height: 100 },
        { x: 80, y: 500, width: 200, height: 100 },
      ],
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(images.map(regionOf)).toEqual([{ x: 80, y: 500, width: 200, height: 100 }]);
  });

  it("logs and skips a region that fails to encode, then carries on", async () => {
    installCanvasFactory({ 1: { encodeError: new Error("tainted canvas") } });
    const { pdfDoc, rendered } = makePdf({
      ...concat(drawImage([100, 0, 0, 50, 40, 400]), drawImage([100, 0, 0, 50, 40, 200])),
      content: [
        { x: 80, y: 100, width: 200, height: 100 },
        { x: 80, y: 500, width: 200, height: 100 },
      ],
    });

    const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

    expect(images.map(regionOf)).toEqual([{ x: 80, y: 500, width: 200, height: 100 }]);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Failed to extract image region",
      expect.objectContaining({ message: "tainted canvas" }),
    );
  });

  it("returns nothing for pages without an operator list API", async () => {
    installCanvasFactory();
    const { pdfDoc, rendered } = makePdf({ noOperatorList: true });

    await expect(extractor.extractPageImages(pdfDoc, 0, rendered as any)).resolves.toEqual([]);
  });

  it("returns nothing and logs a warning when the page cannot be loaded", async () => {
    const pdfDoc = { getPage: vi.fn().mockRejectedValue(new Error("Invalid page request")) };

    await expect(
      extractor.extractPageImages(pdfDoc, 7, makeCanvas(800, 1000) as any),
    ).resolves.toEqual([]);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Failed to extract images from page 7",
      expect.any(Error),
    );
  });

  describe("rotated pages and offset crop boxes", () => {
    it("places an image where pdf.js shows it on a page turned a quarter", async () => {
      installCanvasFactory();
      // A 400 x 500pt page turned 90° shows 500pt wide: 1.6 editor px per pt.
      // The 100 x 50pt image at (40, 60) shows at x 60..110, y 40..140 (pt).
      const { pdfDoc, rendered } = makePdf({
        rotation: 90,
        ...drawImage([100, 0, 0, 50, 40, 60]),
        content: [{ x: 96, y: 64, width: 80, height: 160 }],
      });

      const images = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

      expect(images.map(regionOf)).toEqual([{ x: 96, y: 64, width: 80, height: 160 }]);
    });

    it.each([0, 90, 180, 270])(
      "measures images from the crop box on a page turned %i°",
      async (rotation) => {
        installCanvasFactory();
        const viewBox = [20, 30, 380, 480];
        const shown = fakeViewport(viewBox, 1, rotation);
        const scale = 800 / shown.width;
        const corners = [
          [60, 100],
          [160, 150],
        ].map(([x, y]) => shown.convertToViewportPoint(x, y));
        const region = {
          x: Math.min(corners[0][0], corners[1][0]) * scale,
          y: Math.min(corners[0][1], corners[1][1]) * scale,
          width: Math.abs(corners[0][0] - corners[1][0]) * scale,
          height: Math.abs(corners[0][1] - corners[1][1]) * scale,
        };
        const { pdfDoc, rendered } = makePdf({
          width: 400,
          height: 500,
          rotation,
          viewBox,
          ...drawImage([100, 0, 0, 50, 60, 100]),
          content: [region],
        });

        const [image] = await extractor.extractPageImages(pdfDoc, 0, rendered as any);

        expect(image.x).toBeCloseTo(Math.round(region.x), 0);
        expect(image.y).toBeCloseTo(Math.round(region.y), 0);
        expect(image.width).toBeCloseTo(region.width, -1);
        expect(image.height).toBeCloseTo(region.height, -1);
      },
    );
  });
});
