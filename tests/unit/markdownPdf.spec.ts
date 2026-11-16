import { afterEach, describe, expect, it, vi } from "vitest";

// The bundled build of pdf-lib carries its own pako; the `es` build's pako
// import does not resolve under Node.
const pdfLib = vi.hoisted(
  async () =>
    (await import(
      "../../node_modules/pdf-lib-with-encrypt/dist/pdf-lib.esm.js"
    )) as typeof import("pdf-lib-with-encrypt"),
);
const mocks = vi.hoisted(() => ({ yieldToMain: vi.fn(() => Promise.resolve()) }));

vi.mock("../../utils/pdfConfig", async () => {
  const lib = await pdfLib;
  return {
    PDFDocument: lib.PDFDocument,
    StandardFonts: lib.StandardFonts,
    rgb: lib.rgb,
    degrees: lib.degrees,
    pdfjsLib: {},
  };
});
vi.mock("../../utils/taskScheduler", () => ({ yieldToMain: mocks.yieldToMain }));

import {
  appendMarkdownPages,
  groupColumns,
  type MarkdownBlock,
  markdownToPdf,
  maxTableColumns,
  parseInline,
  parseMarkdown,
  parsePlainText,
  resolveMargins,
  resolvePageSize,
  splitTableRow,
  tableFontSize,
  toWinAnsi,
} from "../../utils/markdownPdf";

interface PageInfo {
  width: number;
  height: number;
  texts: string[];
  text: string;
  sizes: number[];
  positions: Array<{ x: number; y: number }>;
  content: string;
}

const decodeHex = (hex: string) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder("windows-1252").decode(bytes);
};

async function readPages(bytes: Uint8Array): Promise<PageInfo[]> {
  const lib = await pdfLib;
  const doc = await lib.PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const { width, height } = page.getSize();
    const contents = page.node.Contents() as any;
    const streams = !contents
      ? []
      : contents instanceof lib.PDFArray
        ? contents.asArray().map((ref: any) => doc.context.lookup(ref))
        : [contents];
    const content = streams
      .map((stream: any) =>
        new TextDecoder("latin1").decode(lib.decodePDFRawStream(stream).decode()),
      )
      .join("\n");
    const texts = [...content.matchAll(/<([0-9A-Fa-f]*)> Tj/g)].map((m) => decodeHex(m[1]));
    return {
      width,
      height,
      texts,
      text: texts.join(""),
      sizes: [...content.matchAll(/ ([\d.]+) Tf/g)].map((m) => Number(m[1])),
      positions: [...content.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)].map((m) => ({
        x: Number(m[1]),
        y: Number(m[2]),
      })),
      content,
    };
  });
}

async function render(markdown: string, options: Parameters<typeof markdownToPdf>[1] = {}) {
  const result = await markdownToPdf(markdown, options);
  return { ...result, pages: await readPages(result.bytes) };
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.yieldToMain.mockClear();
});

describe("resolvePageSize", () => {
  it("returns named sizes in either orientation", () => {
    expect(resolvePageSize()).toEqual([612, 792]);
    expect(resolvePageSize("a4")).toEqual([595.28, 841.89]);
    expect(resolvePageSize("letter", "landscape")).toEqual([792, 612]);
    expect(resolvePageSize("unknown" as any)).toEqual([612, 792]);
  });

  it("orients and clamps custom sizes", () => {
    expect(resolvePageSize([800, 400])).toEqual([400, 800]);
    expect(resolvePageSize([400, 800], "landscape")).toEqual([800, 400]);
    expect(resolvePageSize([10, 99_999])).toEqual([72, 14_400]);
    expect(resolvePageSize([Number.NaN, 500])).toEqual([500, 612]);
  });
});

describe("resolveMargins", () => {
  it("uses one number for all sides and fills gaps with the default", () => {
    expect(resolveMargins(20, [612, 792])).toEqual({ top: 20, right: 20, bottom: 20, left: 20 });
    expect(resolveMargins({ top: 10, left: -5, right: Number.NaN }, [612, 792])).toEqual({
      top: 10,
      right: 54,
      bottom: 54,
      left: 54,
    });
    expect(resolveMargins(undefined, [612, 792]).left).toBe(54);
  });

  it("shrinks margins that would leave no room for text", () => {
    const margins = resolveMargins(400, [612, 792]);
    expect(612 - margins.left - margins.right).toBeCloseTo(72);
    expect(792 - margins.top - margins.bottom).toBeCloseTo(72);
  });
});

describe("toWinAnsi", () => {
  it("keeps text the standard fonts can show", () => {
    expect(toWinAnsi("Café – “quoted” € 100\n\tnext\f")).toEqual({
      text: "Café – “quoted” € 100\n\tnext\f",
      replaced: 0,
    });
  });

  it("swaps symbols for near matches and strips accents it cannot show", () => {
    expect(toWinAnsi("a → b ≤ c ✓ Łódź ő")).toEqual({
      text: "a -> b <= c v Lódz o",
      replaced: 6,
    });
  });

  it("replaces the rest with ? and drops invisible characters silently", () => {
    const result = toWinAnsi("日本 👍🏽 ok​️­ x y");
    expect(result.text).toBe("?? ? ok x y");
    expect(result.replaced).toBe(3);
  });

  it("counts a combining mark that cannot be kept", () => {
    expect(toWinAnsi("q̃")).toEqual({ text: "q", replaced: 1 });
  });

  it("only produces characters Helvetica can encode", async () => {
    const lib = await pdfLib;
    const doc = await lib.PDFDocument.create();
    const font = await doc.embedFont(lib.StandardFonts.Helvetica);
    let all = "";
    for (let cp = 0x20; cp < 0x3000; cp++) all += String.fromCodePoint(cp);
    const { text } = toWinAnsi(all);
    expect(() => font.encodeText(text)).not.toThrow();
  });
});

describe("parseInline", () => {
  it("reads bold, italic, code and strike runs", () => {
    expect(parseInline("a **b** *c* ***d*** `e` ~~f~~ __g__ _h_")).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " " },
      { text: "c", italic: true },
      { text: " " },
      { text: "d", bold: true, italic: true },
      { text: " " },
      { text: "e", code: true },
      { text: " " },
      { text: "f", strike: true },
      { text: " " },
      { text: "g", bold: true },
      { text: " " },
      { text: "h", italic: true },
    ]);
  });

  it("nests styles", () => {
    // Runs of different lengths do not pair up; the text stays as typed.
    expect(parseInline("**bold *both***x")).toEqual([{ text: "**bold *both***x" }]);
    expect(parseInline("**a _b_ c**")).toEqual([
      { text: "a ", bold: true },
      { text: "b", bold: true, italic: true },
      { text: " c", bold: true },
    ]);
  });

  it("keeps link text, image alt text and autolinks", () => {
    expect(parseInline("[Kyte **site**](https://x.y/(a)) and ![A cat](c.png) ![](d.png)")).toEqual([
      { text: "Kyte " },
      { text: "site", bold: true },
      { text: " and " },
      { text: "[A cat]", italic: true },
      { text: " " },
      { text: "[Image]", italic: true },
    ]);
    expect(parseInline("<https://kyte.pdf> <mailto:a@b.c> <x@y.z>")).toEqual([
      { text: "https://kyte.pdf a@b.c x@y.z" },
    ]);
  });

  it("turns breaks and HTML into text", () => {
    expect(parseInline("one  \ntwo\\\nthree\nfour<br/>five <span>six</span><!-- note -->")).toEqual(
      [
        { text: "one" },
        { text: "", br: true },
        { text: "two" },
        { text: "", br: true },
        { text: "three four" },
        { text: "", br: true },
        { text: "five six" },
      ],
    );
  });

  it("leaves text that only looks like Markdown alone", () => {
    const plain = [
      "snake_case_name",
      "2 * 3 * 4",
      "**open",
      "~one~",
      "[draft]",
      "[a](b",
      "a ! b",
      "a < b",
      "****x****",
      "`open",
      "\\*not\\* \\q",
    ];
    for (const text of plain) {
      const runs = parseInline(text);
      expect(
        runs.every((run) => !run.bold && !run.italic),
        text,
      ).toBe(true);
    }
    expect(parseInline("\\*not\\* \\q")).toEqual([{ text: "*not* \\q" }]);
    expect(parseInline("[a](b")).toEqual([{ text: "[a](b" }]);
  });

  it("reads code spans with longer fences and trims one padding space", () => {
    expect(parseInline("`` a ` b `` and ` ` and `x\ny`")).toEqual([
      { text: "a ` b", code: true },
      { text: " and " },
      { text: " ", code: true },
      { text: " and " },
      { text: "x y", code: true },
    ]);
  });

  it("skips escapes and code when looking for closers", () => {
    expect(parseInline("*a \\* b* **c `**` d** [x \\] `]` y](z)")).toEqual([
      { text: "a * b", italic: true },
      { text: " " },
      { text: "c ", bold: true },
      { text: "**", bold: true, code: true },
      { text: " d", bold: true },
      { text: " x ] " },
      { text: "]", code: true },
      { text: " y" },
    ]);
    expect(
      parseInline("*unclosed `code")
        .map((run) => run.text)
        .join(""),
    ).toBe("*unclosed `code");
  });
});

const types = (blocks: MarkdownBlock[]) => blocks.map((block) => block.type);

describe("parseMarkdown", () => {
  it("reads headings, rules, page markers and comments", () => {
    const blocks = parseMarkdown(
      [
        "# One #",
        "#",
        "###### Six",
        "Setext",
        "===",
        "Two",
        "---",
        "***",
        "<!-- Page 2 -->",
        "<!-- slide 3 -->",
        "<!-- a note -->",
        "<!--",
        "hidden",
        "-->",
        "after\fform feed",
      ].join("\n"),
    );
    expect(types(blocks)).toEqual([
      "heading",
      "heading",
      "heading",
      "heading",
      "heading",
      "rule",
      "pageBreak",
      "pageBreak",
      "paragraph",
      "pageBreak",
      "paragraph",
    ]);
    expect(blocks[0]).toEqual({ type: "heading", level: 1, runs: [{ text: "One" }] });
    expect(blocks[1]).toEqual({ type: "heading", level: 1, runs: [] });
    expect((blocks[3] as any).level).toBe(1);
    expect((blocks[4] as any).level).toBe(2);
  });

  it("reads fenced and indented code", () => {
    const blocks = parseMarkdown(
      "  ```js\n  const a = 1;\n    b();\n  ```\n~~~~\nx\n~~~~\n``` not `a` fence\n\n    indented\n\n    more\n\ntext\n```\nunclosed",
    );
    expect(blocks).toEqual([
      { type: "code", text: "const a = 1;\n  b();" },
      { type: "code", text: "x" },
      {
        type: "paragraph",
        runs: [{ text: "``` not " }, { text: "a", code: true }, { text: " fence" }],
      },
      { type: "code", text: "indented\n\nmore" },
      { type: "paragraph", runs: [{ text: "text" }] },
      { type: "code", text: "unclosed" },
    ]);
  });

  it("reads block quotes with lazy lines and nested blocks", () => {
    const blocks = parseMarkdown("> # Title\n> body\nlazy line\n> - item\n\nafter");
    expect(blocks).toEqual([
      {
        type: "quote",
        blocks: [
          { type: "heading", level: 1, runs: [{ text: "Title" }] },
          { type: "paragraph", runs: [{ text: "body lazy line" }] },
          {
            type: "list",
            ordered: false,
            start: 1,
            items: [[{ type: "paragraph", runs: [{ text: "item" }] }]],
          },
        ],
      },
      { type: "paragraph", runs: [{ text: "after" }] },
    ]);
    expect(types(parseMarkdown("> a\n# b"))).toEqual(["quote", "heading"]);
  });

  it("reads nested, loose and ordered lists", () => {
    const blocks = parseMarkdown(
      "- one\n  continued\nlazy\n- two\n\n  - nested\n    deeper text\n\n- three\n3. three\n4) four\n\n-\n* star",
    );
    expect(types(blocks)).toEqual(["list", "list", "list"]);
    const bullets = blocks[0] as Extract<MarkdownBlock, { type: "list" }>;
    expect(bullets.items).toHaveLength(3);
    expect(bullets.items[0]).toEqual([
      { type: "paragraph", runs: [{ text: "one continued lazy" }] },
    ]);
    expect(types(bullets.items[1])).toEqual(["paragraph", "list"]);
    const nested = bullets.items[1][1] as Extract<MarkdownBlock, { type: "list" }>;
    expect(nested.items[0]).toEqual([
      { type: "paragraph", runs: [{ text: "nested deeper text" }] },
    ]);
    const ordered = blocks[1] as Extract<MarkdownBlock, { type: "list" }>;
    expect(ordered).toMatchObject({ ordered: true, start: 3 });
    expect(ordered.items).toHaveLength(2);
    const last = blocks[2] as Extract<MarkdownBlock, { type: "list" }>;
    expect(last.items).toEqual([[], [{ type: "paragraph", runs: [{ text: "star" }] }]]);
  });

  it("ends a list at a rule, another block or unrelated text", () => {
    expect(types(parseMarkdown("- a\n- - -\n- b\n\nplain"))).toEqual([
      "list",
      "rule",
      "list",
      "paragraph",
    ]);
    expect(types(parseMarkdown("- a\n# heading"))).toEqual(["list", "heading"]);
    expect(types(parseMarkdown("- a\n\n\n"))).toEqual(["list"]);
    expect(types(parseMarkdown("1. a\n-     wide gap"))).toEqual(["list", "list"]);
  });

  it("reads pipe tables with alignment, escapes and ragged rows", () => {
    const blocks = parseMarkdown(
      "Intro\n| Name | Qty | Note |\n|:--|--:|:-:|\n| a \\| b | `x|y` | 3 |\n| short |\n| 1 | 2 | 3 | 4 |\nnot a row\n",
    );
    expect(types(blocks)).toEqual(["paragraph", "table", "paragraph"]);
    const table = blocks[1] as Extract<MarkdownBlock, { type: "table" }>;
    expect(table.align).toEqual(["left", "right", "center"]);
    expect(table.header.map((cell) => cell[0].text)).toEqual(["Name", "Qty", "Note"]);
    expect(table.rows[0][0]).toEqual([{ text: "a | b" }]);
    expect(table.rows[0][1]).toEqual([{ text: "x|y", code: true }]);
    expect(table.rows[1].map((cell) => cell.length)).toEqual([1, 0, 0]);
    expect(table.rows[2]).toHaveLength(3);
  });

  it("splits rows without outer pipes and keeps an escaped last pipe", () => {
    expect(splitTableRow("a | b")).toEqual(["a", "b"]);
    expect(splitTableRow("| a | b \\|")).toEqual(["a", "b \\|"]);
    expect(splitTableRow("| `open | b |")).toEqual(["`open", "b"]);
  });

  it("expands tabs and normalises line endings", () => {
    expect(parseMarkdown("a\r\nb\rc")).toEqual([{ type: "paragraph", runs: [{ text: "a b c" }] }]);
    expect(parseMarkdown("```\n\tx\n```")).toEqual([{ type: "code", text: "    x" }]);
  });
});

describe("parsePlainText", () => {
  it("keeps every line and space, and splits pages on form feeds", () => {
    expect(parsePlainText("  one\ntwo\n\n\n\nthree\n\fnext\n \n")).toEqual([
      {
        type: "paragraph",
        runs: [{ text: "  one" }, { text: "", br: true }, { text: "two" }],
        preserveSpaces: true,
      },
      { type: "paragraph", runs: [{ text: "three" }], preserveSpaces: true },
      { type: "pageBreak" },
      { type: "paragraph", runs: [{ text: "next" }], preserveSpaces: true },
    ]);
    expect(parsePlainText("a\n \n\n\nb\n\n")).toHaveLength(2);
    expect(parsePlainText("")).toEqual([]);
    expect(parsePlainText("\f")).toEqual([{ type: "pageBreak" }]);
  });
});

describe("table helpers", () => {
  it("finds the widest table", () => {
    expect(maxTableColumns("no table")).toBe(0);
    expect(maxTableColumns("| a | b |\n|---|---|\n\n| a | b | c |\n|---|---|---|\n")).toBe(3);
  });

  it("shrinks table text with more columns, down to a floor", () => {
    expect(tableFontSize(11, 3)).toBe(10);
    expect(tableFontSize(11, 6)).toBe(9);
    expect(tableFontSize(11, 40)).toBe(7);
  });

  it("groups columns that do not fit, repeating the first when it is narrow", () => {
    expect(groupColumns([50, 50, 50], 200)).toEqual([[0, 1, 2]]);
    expect(groupColumns([40, 60, 60, 60, 60], 200)).toEqual([
      [0, 1, 2],
      [0, 3, 4],
    ]);
    expect(groupColumns([100, 60, 60, 60], 200)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });
});

describe("markdownToPdf", () => {
  it("draws styled text on a letter page by default and sets the title", async () => {
    const { pages, pageCount, replacedCharacters, bytes } = await render(
      "# Hello\n\nSome **bold**, *italic*, ***both***, `code` and ~~gone~~ text.\n\n###### Small",
      { title: "Report → 2025" },
    );
    expect(pageCount).toBe(1);
    expect(replacedCharacters).toBe(1);
    expect(pages[0]).toMatchObject({ width: 612, height: 792 });
    expect(pages[0].texts[0]).toBe("Report -> 2025");
    expect(pages[0].text).toContain("Hello");
    expect(pages[0].text).toContain("gone");
    // Five fonts: bold, regular, bold-italic, italic and Courier.
    expect(new Set(pages[0].content.match(/\/[A-Za-z-]+-\d+ /g)).size).toBeGreaterThanOrEqual(5);
    const lib = await pdfLib;
    expect((await lib.PDFDocument.load(bytes)).getTitle()).toBe(
      "Report -> 2025".replace("->", "→"),
    );
  });

  it("uses the page size, orientation and margins asked for", async () => {
    const a4 = await render("Text", { pageSize: "a4", orientation: "landscape", margins: 100 });
    expect(a4.pages[0].width).toBeCloseTo(841.89);
    expect(a4.pages[0].height).toBeCloseTo(595.28);
    expect(a4.pages[0].positions[0].x).toBe(100);
    const custom = await render("Text ` ` gap", { pageSize: [300, 400], fontSize: 99 });
    expect(custom.pages[0]).toMatchObject({ width: 300, height: 400 });
    expect(custom.pages[0].sizes[0]).toBe(32);
  });

  it("starts a new page at page markers but never leaves a blank page", async () => {
    const { pages } = await render(
      "<!-- Page 1 -->\n\nOne\n\n<!-- Page 2 -->\n\n<!-- Page 3 -->\n\nTwo\n\n<!-- Page 4 -->",
    );
    expect(pages.map((page) => page.text)).toEqual(["One", "Two"]);
  });

  it("puts each heading of the chosen level on its own page", async () => {
    const { pages } = await render("## Slide one\n\nHi\n\n### Detail\n\n## Slide two\n\n# Big", {
      newPageAtHeadingLevel: 2,
    });
    expect(pages.map((page) => page.texts[0])).toEqual(["Slide one", "Slide two", "Big"]);
  });

  it("returns one blank page for empty input", async () => {
    const { pageCount, pages } = await render("   ");
    expect(pageCount).toBe(1);
    expect(pages[0].texts).toEqual([]);
  });

  it("flows long text across pages and breaks very long words", async () => {
    const long = Array.from({ length: 400 }, (_, i) => `Sentence ${i} goes here.`).join(" ");
    const word = "x".repeat(600);
    const { pages } = await render(`${long}\n\n${word}`);
    expect(pages.length).toBeGreaterThan(2);
    const all = pages.map((page) => page.text).join("");
    expect(all).toContain("Sentence 399 goes here.");
    expect(all.split("x").length - 1).toBe(600);
  });

  it("keeps spaces and line breaks in plain text", async () => {
    const { pages } = await render("Title\n    indented line\n\nNext paragraph   with  gaps", {
      plainText: true,
    });
    expect(pages[0].texts).toEqual(["Title", "    indented line", "Next paragraph   with  gaps"]);
  });

  it("draws lists with markers, nested items and empty items", async () => {
    const { pages } = await render("- one\n  - inner\n- \n\n3. three\n4. four");
    expect(pages[0].texts).toEqual(["•", "one", "–", "inner", "•", "3.", "three", "4.", "four"]);
  });

  it("draws quotes and code blocks, splitting long ones across pages", async () => {
    const quote = Array.from({ length: 80 }, (_, i) => `> quoted line ${i}  `).join("\n");
    const code = Array.from({ length: 120 }, (_, i) => `line ${i}`).join("\n");
    const { pages } = await render(
      `- \`\`\`\n  item code\n  \`\`\`\n\n${quote}\n\n\`\`\`\n${code}\n\`\`\`\n\n---\n\nEnd`,
    );
    const all = pages.map((page) => page.text).join("|");
    expect(all).toContain("item code");
    expect(all).toContain("quoted line 79");
    expect(all).toContain("line 119");
    expect(pages.length).toBeGreaterThanOrEqual(3);
    // Quote bars and code backgrounds are filled in their own colours.
    const filled = (color: string) =>
      pages.filter((page) => page.content.includes(`${color} rg`)).length;
    expect(filled("0.74 0.77 0.82")).toBeGreaterThanOrEqual(2);
    expect(filled("0.95 0.96 0.97")).toBeGreaterThanOrEqual(2);
  });

  it("repeats the table header on every page the table covers", async () => {
    const rows = Array.from({ length: 150 }, (_, i) => `| Row ${i} | ${i * 2} |`).join("\n");
    const { pages } = await render(`| Name | Value |\n|---|--:|\n${rows}`);
    expect(pages.length).toBeGreaterThan(2);
    for (const page of pages) {
      expect(page.texts.slice(0, 2)).toEqual(["Name", "Value"]);
    }
    expect(pages.map((page) => page.text).join("")).toContain("Row 149");
  });

  it("shrinks text for wide tables and splits very wide ones into column groups", async () => {
    const header = Array.from({ length: 10 }, (_, i) => `Col${i}`);
    const wide = `| ${header.join(" | ")} |\n|${"---|".repeat(10)}\n| ${header.map((h) => `${h}v`).join(" | ")} |`;
    const ten = await render(wide);
    expect(Math.min(...ten.pages[0].sizes)).toBe(7);

    const many = Array.from({ length: 30 }, (_, i) => `Heading number ${i}`);
    const huge = `| ${many.join(" | ")} |\n|${"---|".repeat(30)}\n| ${many.map((_, i) => `value ${i}`).join(" | ")} |`;
    const split = await render(huge);
    const text = split.pages.map((page) => page.texts.join("|")).join("|");
    expect(text).toMatch(/Columns 1–\d+ of 30/);
    expect(text).toContain("of 30");
    expect(text).toContain("value 29");
  });

  it("breaks lines inside a table cell at <br>", async () => {
    const { pages } = await render("| Address |\n|---|\n| 1 High St<br>Leeds |");
    const { texts, positions } = pages[0];
    expect(texts).toEqual(["Address", "1 High St", "Leeds"]);
    expect(positions[2].y).toBeLessThan(positions[1].y);
  });

  it("aligns cells and splits a row taller than a page", async () => {
    const tall = Array.from({ length: 900 }, (_, i) => `word${i}`).join(" ");
    const { pages } = await render(
      `| Left | Middle | Right |\n|:--|:-:|--:|\n| a | b | c |\n| ${tall} | x | y |\n| after | **b** | c |`,
      { pageSize: [300, 400], margins: 20 },
    );
    expect(pages.length).toBeGreaterThan(2);
    const all = pages.map((page) => page.text).join(" ");
    expect(all).toContain("word899");
    expect(all).toContain("after");
    // The right-aligned "c" sits further right than the left-aligned "a".
    const first = pages[0];
    const xOf = (text: string) => first.positions[first.texts.indexOf(text)].x;
    expect(xOf("c")).toBeGreaterThan(xOf("b"));
    expect(xOf("b")).toBeGreaterThan(xOf("a"));
  });

  it("moves a heading to the next page when nothing would follow it", async () => {
    // 28 paragraphs leave room for the heading alone but not for a line after it.
    const filler = Array.from({ length: 28 }, (_, i) => `Line ${i}`).join("\n\n");
    const { pages } = await render(`${filler}\n\n## Keep me with my text\n\nBody`);
    expect(pages).toHaveLength(2);
    expect(pages[1].texts[0]).toBe("Keep me with my text");
  });

  it("hands control back to the page during long jobs", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (now += 100));
    const rows = Array.from({ length: 5 }, (_, i) => `| ${i} |`).join("\n");
    await render(`| A |\n|---|\n${rows}\n\nText`);
    expect(mocks.yieldToMain).toHaveBeenCalled();
  });

  it("adds pages to an existing document and shares its fonts", async () => {
    const lib = await pdfLib;
    const doc = await lib.PDFDocument.create();
    const first = await appendMarkdownPages(doc, "First");
    const second = await appendMarkdownPages(doc, "Second ✓");
    expect(first).toEqual({ pageCount: 1, replacedCharacters: 0 });
    expect(second).toEqual({ pageCount: 1, replacedCharacters: 1 });
    expect(doc.getPageCount()).toBe(2);
    const fonts = doc.context
      .enumerateIndirectObjects()
      .filter(
        ([, object]: any) => object?.dict?.get?.(lib.PDFName.of("Type")) === lib.PDFName.of("Font"),
      );
    expect(fonts.length).toBeLessThanOrEqual(6);
  });
});
