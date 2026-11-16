import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  yieldToMain: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/logger.ts", () => ({ logger: mocks.logger }));
vi.mock("../../utils/taskScheduler.ts", () => ({ yieldToMain: mocks.yieldToMain }));

import { type TextBlock, TextBlockExtractor } from "../../utils/TextBlockExtractor";

type ItemOptions = { size?: number; font?: string; width?: number | null };

/**
 * pdf.js gives text items an internal font id ("g_d0_f1"); the loaded font,
 * with its real name and flags, is in page.commonObjs under that id.
 */
const fontsById = new Map<string, Record<string, unknown>>();
const fontId = (name: string, flags: Record<string, unknown> = {}) => {
  const known = [...fontsById].find(
    ([, font]) => font.name === name && JSON.stringify(font) === JSON.stringify({ name, ...flags }),
  );
  if (known) return known[0];
  const id = `g_d0_f${fontsById.size + 1}`;
  fontsById.set(id, { name, ...flags });
  return id;
};
const fakeCommonObjs = {
  has: (id: string) => fontsById.has(id),
  get: (id: string) => {
    const font = fontsById.get(id);
    if (!font) throw new Error(`Requesting object that isn't resolved yet ${id}.`);
    return font;
  },
};

/**
 * A pdf.js text item at (x, baseline) in PDF points, in the font named
 * `font`. Unless given, its advance width is half an em per character.
 */
const item = (
  str: string,
  x: number,
  baseline: number,
  { size = 12, font = "Helvetica", width }: ItemOptions = {},
) => ({
  str,
  fontName: fontId(font),
  width: width === undefined ? str.length * size * 0.5 : width,
  transform: [size, 0, 0, size, x, baseline],
});

// pdf.js operator codes (pdfjs-dist OPS).
const OPS = {
  save: 10,
  restore: 11,
  setTextRenderingMode: 38,
  showText: 44,
  setFillRGBColor: 59,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
};
type Op = [fn: number, args: unknown[] | null];
/** showText as pdf.js lists it: glyphs with their unicode, and spacing numbers. */
const show = (text: string): Op => [
  OPS.showText,
  [[...Array.from(text).map((unicode) => ({ unicode, isSpace: unicode === " " })), -120]],
];
const fill = (hex: string): Op => [OPS.setFillRGBColor, [hex]];
const renderMode = (mode: number): Op => [OPS.setTextRenderingMode, [mode]];
const opList = (...ops: Op[]) => ({
  fnArray: ops.map(([fn]) => fn),
  argsArray: ops.map(([, args]) => args),
});

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

interface FakePageSpec {
  items?: any[];
  /** Page size in points; 800 x 1000 keeps editor and PDF units equal. */
  width?: number;
  height?: number;
  /** /Rotate, and a view (crop) box other than [0, 0, width, height]. */
  rotation?: number;
  viewBox?: number[];
  /** /UserUnit: pdf.js sizes the viewport by it. */
  userUnit?: number;
  /** pdf.js text styles, by font id. */
  styles?: Record<string, { fontFamily?: string; ascent?: number; descent?: number }>;
  /** The page's operator list; without it the page has no getOperatorList. */
  ops?: { fnArray: number[]; argsArray: unknown[] } | Error;
  /** page.commonObjs; the shared fake font store unless given. */
  commonObjs?: unknown;
  error?: Error;
}

function makePdf(pages: FakePageSpec[]) {
  return {
    numPages: pages.length,
    getPage: vi.fn(async (pageNumber: number) => {
      const spec = pages[pageNumber - 1];
      const page: Record<string, unknown> = {
        userUnit: spec.userUnit,
        commonObjs: "commonObjs" in spec ? spec.commonObjs : fakeCommonObjs,
        getViewport: vi.fn(({ scale }: { scale: number }) =>
          fakeViewport(
            spec.viewBox ?? [0, 0, spec.width ?? 800, spec.height ?? 1000],
            scale * (spec.userUnit ?? 1),
            spec.rotation,
          ),
        ),
        getTextContent: vi.fn(async () => {
          if (spec.error) throw spec.error;
          return { items: spec.items ?? [], styles: spec.styles };
        }),
      };
      const { ops } = spec;
      if (ops) {
        page.getOperatorList = vi.fn(async () => {
          if (ops instanceof Error) throw ops;
          return ops;
        });
      }
      return page;
    }),
  };
}

const extractor = new TextBlockExtractor();

const blocksFor = async (items: any[]): Promise<TextBlock[]> =>
  (await extractor.extractPage(makePdf([{ items }]), 0)).blocks;

/** One single-item line per entry, 12pt, starting at baseline 900 and stepping down. */
const linesAt = (lines: Array<[text: string, x: number, width?: number]>, step = 14) =>
  lines.map(([text, x, width], i) => item(text, x, 900 - i * step, { width }));

describe("TextBlockExtractor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("extractPage", () => {
    it("scales a page to the 800px editor width and flips y to a top-left origin", async () => {
      // A 400 x 500 pt page shows at scale 2.
      const pdf = makePdf([
        { width: 400, height: 500, items: [item("Hello", 50, 450, { size: 7, width: 20 })] },
      ]);

      const result = await extractor.extractPage(pdf, 0);

      expect(pdf.getPage).toHaveBeenCalledWith(1);
      expect(result).toMatchObject({ pageWidth: 800, pageHeight: 1000, scale: 2 });
      expect(result.blocks).toHaveLength(1);
      // Baseline 450 pt is 100 px from the top; the 14 px tall text starts at 86.
      // Blocks get 2 px of padding on each side.
      expect(result.blocks[0]).toMatchObject({
        pageIndex: 0,
        x: 98,
        y: 84,
        width: 44,
        height: 18,
        fontSize: 14,
        content: "Hello",
      });
      expect(result.blocks[0].lines[0].spans[0]).toMatchObject({
        x: 100,
        y: 86,
        width: 40,
        height: 14,
        fontSize: 14,
      });
    });

    it("returns plain defaults for a one-line block", async () => {
      const [block] = await blocksFor([item("Hello world", 100, 900, { width: 66 })]);

      expect(block).toMatchObject({
        pageIndex: 0,
        x: 98,
        y: 86,
        width: 70,
        height: 16,
        fontSize: 12,
        fontName: "Helvetica",
        bold: false,
        italic: false,
        color: "#000000",
        textAlign: "left",
        type: "paragraph",
        content: "Hello world",
        richContent: "Hello world",
        lineHeight: 1.4,
      });
    });

    it("keeps padding on the page for text at the top-left corner", async () => {
      const [block] = await blocksFor([item("Corner", 1, 999, { width: 36 })]);

      // The text starts at (1, -11); padding must not push the box off the page.
      expect(block.x).toBe(0);
      expect(block.y).toBe(0);
      expect(block.width).toBe(40);
      expect(block.height).toBe(16);
    });

    it("returns no blocks for a page without text", async () => {
      await expect(blocksFor([])).resolves.toEqual([]);
    });
  });

  describe("text spans", () => {
    it("puts spaces between words that pdf.js returns as separate runs", async () => {
      // The "20thDecember2022" problem: each word is its own run, with a gap
      // between them but no space character.
      const [block] = await blocksFor([
        item("20th", 100, 900, { width: 24 }),
        item("December", 128, 900, { width: 48 }),
        item("2022", 180, 900, { width: 24 }),
      ]);

      expect(block.content).toBe("20th December 2022");
      expect(block.type).toBe("date");
    });

    it("joins runs that touch without adding a space", async () => {
      const [block] = await blocksFor([
        item("Hel", 100, 900, { width: 18 }),
        item("lo", 118, 900, { width: 12 }),
      ]);

      expect(block.content).toBe("Hello");
    });

    it("does not double a space that the text already has", async () => {
      const [block] = await blocksFor([
        item("Dear ", 100, 900, { width: 30 }),
        item("Sir", 134, 900, { width: 18 }),
        item(" or Madam", 156, 900, { width: 54 }),
      ]);

      expect(block.content).toBe("Dear Sir or Madam");
    });

    it("skips marked-content entries, empty strings and whitespace-only runs", async () => {
      const [block, ...rest] = await blocksFor([
        { type: "beginMarkedContent", tag: "P" },
        item("", 100, 900),
        item("   ", 100, 900),
        item("Kept", 100, 900, { width: 24 }),
        { type: "endMarkedContent" },
      ]);

      expect(rest).toEqual([]);
      expect(block.content).toBe("Kept");
      expect(block.lines[0].spans).toHaveLength(1);
    });

    it("estimates width when pdf.js gives none and sizes text by its height", async () => {
      const [block] = await blocksFor([
        // No width: 4 chars x 12 px x 0.5
        item("Wide", 100, 900, { width: null }),
        // Squeezed to half width: the size is still its 12pt height.
        { str: "Tall", fontName: "Helvetica", width: 24, transform: [6, 0, 0, 12, 130, 900] },
      ]);

      const [wide, tall] = block.lines[0].spans;
      expect(wide.width).toBe(24 + (130 - 124)); // own width plus the gap to "Tall"
      expect(tall.fontSize).toBe(12);
      expect(tall.height).toBe(12);
    });

    it("takes the size from the width axis when text has no height", async () => {
      const [block] = await blocksFor([
        { str: "Flat", fontName: "Helvetica", width: 24, transform: [12, 0, 0, 0, 300, 900] },
      ]);

      expect(block.fontSize).toBe(12);
    });

    it("drops a second copy of the same text drawn at the same spot", async () => {
      // Edited PDFs keep the original text under the redrawn text.
      const blocks = await blocksFor([
        item("Total", 100, 900, { width: 30 }),
        item("Total", 101, 900.5, { width: 31 }),
        item("Total", 100, 850, { width: 30 }), // a different line: kept
      ]);

      expect(blocks.map((b) => b.content)).toEqual(["Total", "Total"]);
      expect(blocks[0].lines[0].spans).toHaveLength(1);
    });

    it("keeps different text drawn at the same spot", async () => {
      const [block] = await blocksFor([
        item("A", 100, 900, { width: 6 }),
        item("B", 100, 900, { width: 6 }),
      ]);

      expect(block.lines[0].spans.map((s) => s.text.trim())).toEqual(["A", "B"]);
    });
  });

  describe("lines and blocks", () => {
    it("orders lines top to bottom and words left to right, whatever the content order", async () => {
      const [block] = await blocksFor([
        item("second line", 100, 885, { width: 66 }),
        item("world", 140, 900, { width: 30 }),
        item("Hello", 100, 900, { width: 30 }),
      ]);

      expect(block.content).toBe("Hello world\nsecond line");
      expect(block.richContent).toBe("Hello world<br>second line");
      expect(block.lines.map((l) => l.y)).toEqual([88, 103]);
    });

    it("splits paragraphs at a vertical gap of more than 0.8 em", async () => {
      const blocks = await blocksFor([
        item("First paragraph line one", 100, 900, { width: 144 }),
        item("First paragraph line two", 100, 885, { width: 144 }),
        item("Second paragraph", 100, 850, { width: 96 }),
      ]);

      expect(blocks.map((b) => b.content)).toEqual([
        "First paragraph line one\nFirst paragraph line two",
        "Second paragraph",
      ]);
    });

    it("splits a heading from the body text under it by font size", async () => {
      const blocks = await blocksFor([
        item("Introduction", 100, 900, { size: 18, font: "Helvetica-Bold", width: 108 }),
        item("Body text follows the heading.", 100, 885, { width: 180 }),
      ]);

      expect(blocks.map((b) => [b.content, b.type, b.fontSize, b.bold])).toEqual([
        ["Introduction", "heading", 18, true],
        ["Body text follows the heading.", "paragraph", 12, false],
      ]);
    });

    it("splits a block where the left edge moves by more than 2.5 em", async () => {
      const blocks = await blocksFor([
        item("Label", 100, 900, { width: 30 }),
        item("Indented note", 150, 885, { width: 78 }),
      ]);

      expect(blocks.map((b) => b.content)).toEqual(["Label", "Indented note"]);
    });

    it("measures line height from the spacing of the lines", async () => {
      const [spaced] = await blocksFor([
        item("Line one", 100, 900, { width: 48 }),
        item("Line two", 100, 885, { width: 48 }),
        item("Line three", 100, 870, { width: 60 }),
      ]);
      expect(spaced.lineHeight).toBeCloseTo(15 / 12, 10);

      // Lines 8 px apart in 12 px text would overlap; clamp to 1.0.
      const [tight] = await blocksFor([
        item("Line one", 100, 900, { width: 48 }),
        item("Line two", 100, 892, { width: 48 }),
      ]);
      expect(tight.lines).toHaveLength(2);
      expect(tight.lineHeight).toBe(1);
    });
  });

  describe("formatting", () => {
    it("marks bold and italic runs in the rich content and escapes HTML", async () => {
      const [block] = await blocksFor([
        item("Note:", 100, 900, { font: "Arial-BoldMT", width: 30 }),
        item("read", 134, 900, { font: "Arial-ItalicMT", width: 24 }),
        item("this", 162, 900, { font: "Arial-BoldItalicMT", width: 24 }),
        item('<now> & "then"', 190, 900, { font: "ArialMT", width: 84 }),
      ]);

      expect(block.content).toBe('Note: read this <now> & "then"');
      expect(block.richContent).toBe(
        "<b>Note: </b><i>read </i><b><i>this </i></b>&lt;now&gt; &amp; &quot;then&quot;",
      );
      // Two of four runs are bold and two italic: not a majority either way.
      expect(block.bold).toBe(false);
      expect(block.italic).toBe(false);
      // The plain font carries the most characters.
      expect(block.fontName).toBe("ArialMT");
    });

    it("marks a block bold or italic when most runs are", async () => {
      const [boldBlock] = await blocksFor([
        item("All", 100, 900, { font: "Times-Bold", width: 18 }),
        item("bold", 122, 900, { font: "Times-Bold", width: 24 }),
        item("mostly", 150, 900, { font: "Times-Roman", width: 36 }),
      ]);
      expect(boldBlock.bold).toBe(true);
      expect(boldBlock.italic).toBe(false);

      const [obliqueBlock] = await blocksFor([
        item("Slanted", 100, 900, { font: "Helvetica-Oblique", width: 42 }),
        item("words", 146, 900, { font: "Helvetica-Oblique", width: 30 }),
      ]);
      expect(obliqueBlock.italic).toBe(true);
      expect(obliqueBlock.richContent).toBe("<i>Slanted </i><i>words</i>");
    });

    it("takes the font size and name used by the most characters", async () => {
      const [block] = await blocksFor([
        item("Big", 100, 900, { size: 14, font: "Display", width: 21 }),
        // No font name reported: counted as Helvetica.
        { str: "small words here", width: 96, transform: [12, 0, 0, 12, 125, 900] },
      ]);

      expect(block.fontSize).toBe(12);
      expect(block.fontName).toBe("Helvetica");
    });
  });

  describe("fonts pdf.js has loaded", () => {
    it("reads bold and italic from the real font name behind pdf.js's font id", async () => {
      const [block] = await blocksFor([
        item("Heading", 100, 900, { font: "ABCDEF+Arial-BoldMT", width: 42 }),
      ]);

      expect(block.lines[0].spans[0].fontName).toBe("Arial-BoldMT");
      expect(block.bold).toBe(true);
    });

    it("takes bold and italic from the font's flags when its name does not say", async () => {
      const boldId = fontId("Calibri", { bold: true });
      const blackId = fontId("Gotham", { black: true });
      const italicId = fontId("Minion", { italic: true });
      const [block] = await blocksFor([
        { str: "Strong", fontName: boldId, width: 36, transform: [12, 0, 0, 12, 100, 900] },
        { str: "Heavy", fontName: blackId, width: 30, transform: [12, 0, 0, 12, 140, 900] },
        { str: "Slanted", fontName: italicId, width: 42, transform: [12, 0, 0, 12, 174, 900] },
      ]);

      expect(block.lines[0].spans.map((s) => [s.fontName, s.bold, s.italic])).toEqual([
        ["Calibri", true, false],
        ["Gotham", true, false],
        ["Minion", false, true],
      ]);
    });

    it("falls back to the font id when the font store has not resolved it", async () => {
      const result = await extractor.extractPage(
        makePdf([
          {
            items: [item("Plain", 100, 900, { font: "Times-Bold", width: 30 })],
            commonObjs: {
              has: () => true,
              get: () => {
                throw new Error("Requesting object that isn't resolved yet");
              },
            },
          },
        ]),
        0,
      );

      expect(result.blocks[0].fontName).toMatch(/^g_d0_f\d+$/);
      expect(result.blocks[0].bold).toBe(false);
    });
  });

  describe("columns and tables", () => {
    it("keeps the columns of a table apart instead of joining each row with a space", async () => {
      const blocks = await blocksFor([
        item("Description", 50, 900, { width: 66 }),
        item("Amount", 600, 900, { width: 36 }),
        item("Consulting", 50, 885, { width: 60 }),
        item("$1,200.00", 600, 885, { width: 54 }),
        item("Travel", 50, 870, { width: 36 }),
        item("$300.00", 600, 870, { width: 42 }),
      ]);

      expect(blocks.map((b) => [b.content, b.x])).toEqual([
        ["Description\nConsulting\nTravel", 48],
        ["Amount\n$1,200.00\n$300.00", 598],
      ]);
    });

    it("reads side-by-side columns as one block each", async () => {
      const blocks = await blocksFor([
        item("Left column line one", 50, 900, { width: 120 }),
        item("Right column line one", 420, 900, { width: 126 }),
        item("Left column line two", 50, 885, { width: 120 }),
        item("Right column line two", 420, 885, { width: 126 }),
      ]);

      expect(blocks.map((b) => b.content)).toEqual([
        "Left column line one\nLeft column line two",
        "Right column line one\nRight column line two",
      ]);
    });

    it("keeps words with ordinary gaps on one line, even widely justified ones", async () => {
      // Gaps of 8 and 17 px: under 1.5 em (18 px) at 12 px.
      const [block, ...rest] = await blocksFor([
        item("Wide", 100, 900, { width: 24 }),
        item("word", 132, 900, { width: 24 }),
        item("gaps", 173, 900, { width: 24 }),
      ]);

      expect(rest).toEqual([]);
      expect(block.content).toBe("Wide word gaps");
    });
  });

  describe("colours and invisible text from the operator list", () => {
    it("gives each block the colour most of its text is painted in, and marks others", async () => {
      const result = await extractor.extractPage(
        makePdf([
          {
            items: [
              item("Red title", 100, 900, { width: 54 }),
              item("Body text here", 100, 885, { width: 84 }),
            ],
            ops: opList(
              fill("#cc0000"),
              show("Red title"),
              fill("#1a1a1a"),
              show("Body text here"),
            ),
          },
        ]),
        0,
      );

      const [block] = result.blocks;
      expect(block.lines.map((l) => l.spans[0].color)).toEqual(["#cc0000", "#1a1a1a"]);
      expect(block.color).toBe("#1a1a1a");
      expect(block.richContent).toBe(
        '<span style="color:#cc0000">Red title</span><br>Body text here',
      );
    });

    it("restores the colour after save/restore and form XObjects", async () => {
      const result = await extractor.extractPage(
        makePdf([
          {
            items: [
              item("Warning", 100, 900, { width: 42 }),
              item("Normal", 100, 850, { width: 36 }),
              item("Boxed", 100, 800, { width: 30 }),
              item("After", 100, 750, { width: 30 }),
            ],
            ops: opList(
              [OPS.save, null],
              fill("#ff0000"),
              show("Warning"),
              [OPS.restore, null],
              show("Normal"),
              [OPS.paintFormXObjectBegin, [null, null]],
              fill("#0000ff"),
              show("Boxed"),
              [OPS.paintFormXObjectEnd, null],
              show("After"),
            ),
          },
        ]),
        0,
      );

      expect(result.blocks.map((b) => [b.content, b.color])).toEqual([
        ["Warning", "#ff0000"],
        ["Normal", "#000000"],
        ["Boxed", "#0000ff"],
        ["After", "#000000"],
      ]);
    });

    it("reads [r, g, b] colours from older pdf.js builds", async () => {
      const result = await extractor.extractPage(
        makePdf([
          {
            items: [item("Blue", 100, 900, { width: 24 })],
            ops: opList([OPS.setFillRGBColor, [0, 128, 255]], show("Blue")),
          },
        ]),
        0,
      );

      expect(result.blocks[0].color).toBe("#0080ff");
    });

    it("leaves text black when it cannot be found among the painted characters", async () => {
      const far = "x".repeat(300);
      const result = await extractor.extractPage(
        makePdf([
          {
            items: [
              item("Missing", 100, 900, { width: 42 }),
              item("Green", 100, 850, { width: 30 }),
              item("Too far", 100, 800, { width: 42 }),
            ],
            // "Missing" was never painted; "Too far" only appears 300 characters on.
            ops: opList(fill("#00aa00"), show("Green"), show(far), show("Too far")),
          },
        ]),
        0,
      );

      expect(result.blocks.map((b) => [b.content, b.color])).toEqual([
        ["Missing", "#000000"],
        ["Green", "#00aa00"],
        ["Too far", "#000000"],
      ]);
    });

    it("leaves out invisible text, such as the OCR layer of a scanned page", async () => {
      const result = await extractor.extractPage(
        makePdf([
          {
            items: [
              item("Scanned words", 100, 900, { width: 78 }),
              item("Clip only", 100, 850, { width: 54 }),
              item("Visible note", 100, 800, { width: 72 }),
              item("Saved mode", 100, 750, { width: 60 }),
            ],
            ops: opList(
              [OPS.save, null],
              renderMode(3),
              show("Scanned words"),
              renderMode(7),
              show("Clip only"),
              [OPS.restore, null],
              show("Visible note"),
              renderMode(1),
              show("Saved mode"),
            ),
          },
        ]),
        0,
      );

      expect(result.blocks.map((b) => b.content)).toEqual(["Visible note", "Saved mode"]);
    });

    it("finds no text boxes on a scanned page whose text is all invisible", async () => {
      const result = await extractor.extractPage(
        makePdf([
          {
            items: [item("OCR line one", 100, 900), item("OCR line two", 100, 885)],
            ops: opList(renderMode(3), show("OCR line one"), show("OCR line two")),
          },
        ]),
        0,
      );

      expect(result.blocks).toEqual([]);
    });

    it("keeps text, in black, when the operator list cannot be read", async () => {
      const failure = new Error("operator list failed");
      const result = await extractor.extractPage(
        makePdf([{ items: [item("Kept", 100, 900, { width: 24 })], ops: failure }]),
        0,
      );

      expect(result.blocks.map((b) => [b.content, b.color])).toEqual([["Kept", "#000000"]]);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        "Could not read the page's operator list; text keeps default colours",
        failure,
      );
    });
  });

  describe("glyph boxes", () => {
    it("gives one box per line from the font's ascent to its descent", async () => {
      const id = fontId("Helvetica");
      const result = await extractor.extractPage(
        makePdf([
          {
            items: [
              item("First line", 100, 900, { width: 60 }),
              item("Second", 100, 885, { width: 36 }),
            ],
            styles: { [id]: { ascent: 0.9, descent: -0.25 } },
          },
        ]),
        0,
      );

      // Baselines at 100 and 115 px; 0.9 x 12 above and 0.25 x 12 below.
      const boxes = result.blocks[0].glyphBoxes;
      expect(boxes).toHaveLength(2);
      expect(boxes[0].x).toBe(100);
      expect(boxes[0].width).toBe(60);
      expect(boxes[0].y).toBeCloseTo(100 - 10.8, 10);
      expect(boxes[0].height).toBeCloseTo(13.8, 10);
      expect(boxes[1].y).toBeCloseTo(115 - 10.8, 10);
      expect(boxes[1].width).toBe(36);
    });

    it("assumes 0.8 above and 0.2 below without metrics, or 1 + descent above", async () => {
      const [plain] = await blocksFor([item("No metrics", 100, 900, { width: 60 })]);
      expect(plain.glyphBoxes[0].y).toBeCloseTo(100 - 9.6, 10);
      expect(plain.glyphBoxes[0].height).toBeCloseTo(12, 10);

      const id = fontId("Courier");
      const result = await extractor.extractPage(
        makePdf([
          {
            items: [item("Descent only", 100, 900, { font: "Courier", width: 72 })],
            styles: { [id]: { descent: -0.3 } },
          },
        ]),
        0,
      );
      expect(result.blocks[0].glyphBoxes[0].y).toBeCloseTo(100 - 8.4, 10);
      expect(result.blocks[0].glyphBoxes[0].height).toBeCloseTo(12, 10);
    });
  });

  describe("alignment", () => {
    it("detects lines centred on the page", async () => {
      const [block] = await blocksFor(
        linesAt([
          ["Centred title line", 300, 200],
          ["Subtitle", 350, 100],
        ]),
      );
      expect(block.textAlign).toBe("center");
    });

    it("detects right-aligned lines", async () => {
      const [block] = await blocksFor(
        linesAt([
          ["Invoice number 1042", 500, 200],
          ["Due today", 600, 100],
        ]),
      );
      expect(block.textAlign).toBe("right");
    });

    it("detects justified lines flush on both sides", async () => {
      const [block] = await blocksFor(
        linesAt([
          ["Column text spread across", 100, 250],
          ["the whole width of the", 100, 250],
          ["column on every line.", 100, 250],
        ]),
      );
      expect(block.textAlign).toBe("justify");
    });

    it("falls back to left for a ragged right edge", async () => {
      const [block] = await blocksFor(
        linesAt([
          ["A ragged paragraph whose lines", 100, 300],
          ["end at different", 100, 200],
          ["places on the right", 100, 250],
        ]),
      );
      expect(block.textAlign).toBe("left");
    });
  });

  describe("block types", () => {
    const typeOf = async (lines: Array<[string, number?]>, options: ItemOptions = {}) => {
      const blocks = await blocksFor(
        lines.map(([text, x = 100], i) => item(text, x, 900 - i * 14, options)),
      );
      expect(blocks).toHaveLength(1);
      return blocks[0].type;
    };

    it("recognises dates in day-month and month-day form", async () => {
      await expect(typeOf([["1st March 2024"]])).resolves.toBe("date");
      await expect(typeOf([["December 20, 2022"]])).resolves.toBe("date");
      await expect(typeOf([["Due 2022"]])).resolves.toBe("paragraph");
    });

    it("recognises bulleted and numbered items", async () => {
      await expect(typeOf([["• First point"]])).resolves.toBe("bullet");
      await expect(typeOf([["- Second point"]])).resolves.toBe("bullet");
      await expect(typeOf([["1. Step one"]])).resolves.toBe("bullet");
      await expect(typeOf([["2) Step two"]])).resolves.toBe("bullet");
    });

    it("recognises short bold or large text as a heading", async () => {
      await expect(typeOf([["Terms and conditions"]], { font: "Arial-Bold" })).resolves.toBe(
        "heading",
      );
      await expect(typeOf([["Quarterly report"]], { size: 18 })).resolves.toBe("heading");
      // Long bold text is a paragraph, not a heading.
      await expect(typeOf([["Bold ".repeat(25).trim()]], { font: "Arial-Bold" })).resolves.toBe(
        "paragraph",
      );
    });

    it("keeps the real font size instead of rounding it up to a whole pixel", async () => {
      // 16.5pt on a Letter page is 21.57 px in the 800px editor. Rounding it to
      // 22 px made a heading about 2% wider than its box, so it wrapped.
      const letter = await extractor.extractPage(
        makePdf([
          { width: 612, height: 792, items: [item("Invoice 1042", 72, 700, { size: 16.5 })] },
        ]),
        0,
      );
      expect(letter.blocks[0].fontSize).toBeCloseTo((16.5 * 800) / 612, 2);
      expect(letter.blocks[0].fontSize).toBeLessThan(22);
    });

    it("judges headings by point size, not by the size after scaling to the editor", async () => {
      // An A5 page is 419.53 pt wide, so the editor shows it at about 1.9x.
      const a5 = (items: any[]) =>
        extractor.extractPage(makePdf([{ width: 419.53, height: 595.28, items }]), 0);

      const body = await a5([item("An ordinary sentence of body text.", 40, 500, { size: 11 })]);
      expect(body.blocks[0].fontSize).toBeCloseTo(20.98, 2); // 11pt shown at about 21 px
      expect(body.blocks[0].type).toBe("paragraph");

      const title = await a5([item("Chapter One", 40, 500, { size: 18 })]);
      expect(title.blocks[0].type).toBe("heading");
    });

    it("recognises short multi-line blocks with a postcode as an address", async () => {
      await expect(typeOf([["221B Baker Street"], ["London NW1 6XE"]])).resolves.toBe("address");
      await expect(
        typeOf([["1600 Amphitheatre Parkway"], ["Mountain View, CA 94043"]]),
      ).resolves.toBe("address");
    });

    it("treats short blocks with numbers but no postcode as paragraphs", async () => {
      await expect(typeOf([["Call 555 1234"], ["after 6pm"]])).resolves.toBe("paragraph");
      await expect(typeOf([["Meet at the cafe"], ["near the station"]])).resolves.toBe("paragraph");
    });
  });

  describe("extractAllPages", () => {
    it("extracts every page in order, keeps going past a failed page and yields every two pages", async () => {
      const failure = new Error("bad text stream");
      const pdf = makePdf([
        { items: [item("Page one", 100, 900, { width: 48 })] },
        { error: failure },
        { items: [item("Page three", 100, 900, { width: 60 })] },
      ]);

      const results = await extractor.extractAllPages(pdf);

      expect(results).toHaveLength(3);
      expect(results[0].blocks.map((b) => [b.pageIndex, b.content])).toEqual([[0, "Page one"]]);
      expect(results[1]).toEqual({
        blocks: [],
        pageWidth: 800,
        pageHeight: 1100,
        scale: 1,
        angledTextCount: 0,
      });
      expect(results[2].blocks.map((b) => [b.pageIndex, b.content])).toEqual([[2, "Page three"]]);
      expect(mocks.logger.warn).toHaveBeenCalledWith("Failed to extract page 1", failure);
      expect(mocks.yieldToMain).toHaveBeenCalledTimes(1);
    });

    it("returns an empty list for a document with no pages", async () => {
      await expect(extractor.extractAllPages(makePdf([]))).resolves.toEqual([]);
    });
  });

  describe("rotated pages and offset crop boxes", () => {
    // Crop box [50, 30, 450, 630] (400 x 600pt). Each matrix makes the text read
    // left to right on the page as shown; its baseline starts at (100, 200)pt.
    it.each([
      // rotation, text matrix, editor scale, baseline start as shown (pt)
      [0, [12, 0, 0, 12], 2, [50, 430]],
      [90, [0, 12, -12, 0], 800 / 600, [170, 50]],
      [180, [-12, 0, 0, -12], 2, [350, 170]],
      [270, [0, -12, 12, 0], 800 / 600, [430, 350]],
    ])(
      "places text where pdf.js shows it on a page turned %i°",
      async (rotation, matrix, scale, start) => {
        const result = await extractor.extractPage(
          makePdf([
            {
              rotation,
              viewBox: [50, 30, 450, 630],
              items: [
                {
                  str: "Turned",
                  fontName: "Helvetica",
                  width: 36,
                  transform: [...matrix, 100, 200],
                },
              ],
            },
          ]),
          0,
        );

        const [block] = result.blocks;
        expect(result.scale).toBeCloseTo(scale, 10);
        expect(result.pageWidth).toBeCloseTo(800, 10);
        expect(block.content).toBe("Turned");
        expect(block.fontSize).toBeCloseTo(12 * scale, 10);
        const [span] = block.lines[0].spans;
        expect(span.x).toBeCloseTo(start[0] * scale, 10);
        // The text's top is one text height above the baseline.
        expect(span.y).toBeCloseTo((start[1] - 12) * scale, 10);
        expect(result.angledTextCount).toBe(0);
      },
    );

    it("leaves out text that does not read left to right on the page as shown", async () => {
      const result = await extractor.extractPage(
        makePdf([
          {
            items: [
              { str: "Up", fontName: "Helvetica", width: 12, transform: [0, 12, -12, 0, 40, 500] },
              {
                str: "Upside down",
                fontName: "Helvetica",
                width: 60,
                transform: [-12, 0, 0, -12, 400, 500],
              },
              {
                str: "No direction",
                fontName: "Helvetica",
                width: 9,
                transform: [0, 0, 0, 0, 1, 1],
              },
              // A slope of 1 in 120 still counts as level.
              {
                str: "Level",
                fontName: "Helvetica",
                width: 30,
                transform: [12, 0.1, -0.1, 12, 100, 300],
              },
            ],
          },
        ]),
        0,
      );

      expect(result.blocks.map((b) => b.content)).toEqual(["Level"]);
      expect(result.angledTextCount).toBe(3);
    });
  });

  it("sizes text by the page's /UserUnit, as pdf.js shows it", async () => {
    // A 400-unit-wide page with /UserUnit 2 shows 800 units wide: 1px per unit
    // of the viewport, so each PDF unit is 2px.
    const result = await extractor.extractPage(
      makePdf([
        {
          width: 400,
          height: 500,
          userUnit: 2,
          items: [item("Large", 100, 400, { size: 12, width: 30 })],
        },
      ]),
      0,
    );

    const [span] = result.blocks[0].lines[0].spans;
    expect(result.scale).toBe(1);
    expect(span.fontSize).toBe(24);
    expect(span.width).toBe(60);
    expect(span.x).toBe(200);
    expect(span.y).toBe((500 - 400) * 2 - 24);
  });

  it("names a font by its id and family when pdf.js has not loaded it", async () => {
    const result = await extractor.extractPage(
      makePdf([
        {
          items: [
            {
              str: "Serif text",
              fontName: "g_d0_f99",
              width: 60,
              transform: [12, 0, 0, 12, 100, 900],
            },
          ],
          styles: { g_d0_f99: { fontFamily: "serif" } },
        },
      ]),
      0,
    );

    expect(result.blocks[0].fontName).toBe("g_d0_f99 serif");
  });
});
