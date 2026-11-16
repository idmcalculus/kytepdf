import type { Annotation, ExtractedSource } from "./AnnotationManager.ts";
import { adjustYForTextBaseline } from "./coordinates.ts";
import { logger } from "./logger.ts";
import { toWinAnsi } from "./markdownPdf.ts";
import { degrees, PDFDocument, rgb, StandardFonts } from "./pdfConfig.ts";
import { loadProcessablePdf, loadProcessablePdfJsDocument } from "./pdfSecurity.ts";
import { nearestEditorFont } from "./richText.ts";
import { yieldToMain } from "./taskScheduler.ts";

/**
 * Strip control characters that PDF fonts cannot render.
 * Removes chars 0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F.
 */
function stripControlChars(text: string): string {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Allow tab (0x09), newline (0x0A), carriage return (0x0D), and all printable chars
    if (code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20) {
      result += text[i];
    }
  }
  return result;
}

/**
 * Represents a styled run of text parsed from HTML content
 */
interface TextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  color?: string;
  fontSize?: number;
  /** Subscript or superscript (<sub>/<sup>). */
  script?: "sub" | "super";
}

/** Width of a page in the editor, in editor pixels (the editor's TARGET_WIDTH). */
const EDITOR_PAGE_WIDTH = 800;
/** A text box's border plus padding above and below its text in the editor, in editor pixels. */
const TEXT_BOX_INSET_PX = 3;
/**
 * A text box's border plus padding left and right of its text in the editor,
 * in editor pixels: 1px + 3px for an extracted text block, 1px + 4px for an
 * Add Text box.
 */
const TEXTBLOCK_INSET_X_PX = 4;
const TEXT_INSET_X_PX = 5;
/** An extracted text box is this much wider in the editor than its text (padding), in editor pixels. */
const TEXT_BOX_EXTRA_WIDTH_PX = 6;
/** Gap between a list marker and its item's text, as a share of the marker's size. */
const LIST_MARKER_GAP = 0.3;

/**
 * Margin, in PDF points, added around each extracted glyph box when it is
 * whited out. Small, so table borders and underlines next to the text stay.
 */
export const EXTRACTED_WHITEOUT_PADDING_PT = 1;

/** Sub- and superscript are drawn smaller, like the browser's "smaller" (1/1.2). */
const SCRIPT_SIZE = 1 / 1.2;
/** How far a superscript is raised and a subscript lowered, as a share of the text size. */
const SUPERSCRIPT_RISE = 0.35;
const SUBSCRIPT_DROP = 0.2;

type FontGetter = (fontName: string, bold?: boolean, italic?: boolean) => Promise<any>;
type TextAlign = "left" | "center" | "right" | "justify";

interface ListLineParts {
  markerRun: TextRun;
  contentRuns: TextRun[];
}

interface DrawToken {
  run: TextRun;
  text: string;
  isWhitespace: boolean;
  isJustifiableSpace: boolean;
}

interface SourceLine {
  runs: TextRun[];
  /** True when a block boundary, rather than a <br>, came before this line. */
  startsBlock: boolean;
  /** True when the line starts a list item from <li> markup; its first run is the marker. */
  listItem: boolean;
}

type RunStyle = Omit<TextRun, "text">;

const PLAIN_STYLE: RunStyle = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
};

/** Elements that start and end a line of their own, as blocks do in the editor. */
const BLOCK_TAGS = new Set([
  "address",
  "article",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "p",
  "pre",
  "section",
  "table",
  "tr",
]);

/** The style an element gives the text inside it: its tag and its inline style. */
function styleForElement(el: HTMLElement, inherited: RunStyle): RunStyle {
  const tag = el.tagName.toLowerCase();
  const style = { ...inherited };

  if (tag === "b" || tag === "strong") style.bold = true;
  if (tag === "i" || tag === "em") style.italic = true;
  if (tag === "u") style.underline = true;
  if (tag === "s" || tag === "strike" || tag === "del") style.strikethrough = true;
  if (tag === "sub") style.script = "sub";
  if (tag === "sup") style.script = "super";

  // <font color> (produced by execCommand in some browsers). The font face
  // is not read: the editor sets one font per box, in style.font.
  if (tag === "font") {
    const colorAttr = el.getAttribute("color");
    if (colorAttr) style.color = colorAttr;
  }

  const css = el.style;
  if (css.fontWeight === "bold" || parseInt(css.fontWeight, 10) >= 700) style.bold = true;
  if (css.fontStyle === "italic") style.italic = true;
  if (css.textDecoration?.includes("underline")) style.underline = true;
  if (css.textDecoration?.includes("line-through")) style.strikethrough = true;
  if (css.color) style.color = css.color;
  if (css.fontSize) {
    const size = parseFloat(css.fontSize);
    if (!Number.isNaN(size)) style.fontSize = size;
  }
  return style;
}

/**
 * Parse rich HTML into lines of styled runs. The HTML is parsed once and
 * walked, so a style opened before a <br> or a block ("<b>One<br>Two</b>")
 * carries on to the lines after it, and styles on <div> and <p> apply. A
 * line ends at <br>, at a newline in the text (the editor uses
 * white-space: pre-wrap) and at block and list boundaries. A line made by
 * <li> starts with its list marker.
 */
function parseRichContent(html: string): SourceLine[] {
  const body = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
  const lines: SourceLine[] = [];
  const lists: Array<{ ordered: boolean; next: number }> = [];
  let runs: TextRun[] = [];
  let listItem = false;
  let afterBlock = false;

  // A forced break (<br>, a newline) ends its line even when the line is
  // empty, as the editor shows an empty line for "<div><br></div>" or a
  // second <br>; the empty line keeps the style there for its height. The
  // end of a block adds no line of its own, so lines are not doubled around
  // blocks and a trailing <br> adds nothing, as in the browser.
  const endLine = (forcedStyle?: RunStyle) => {
    if (runs.length === 0 && forcedStyle) runs = [{ ...forcedStyle, text: "" }];
    if (runs.length > 0) {
      lines.push({ runs, startsBlock: afterBlock, listItem });
      afterBlock = false;
    }
    runs = [];
    listItem = false;
  };
  const blockBreak = () => {
    endLine();
    afterBlock = true;
  };

  const walk = (node: Node, style: RunStyle) => {
    if (node.nodeType === Node.TEXT_NODE) {
      (node.textContent ?? "").split("\n").forEach((piece, index) => {
        if (index > 0) endLine(style);
        if (piece) runs.push({ ...style, text: piece });
      });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") {
      endLine(style);
      return;
    }
    if (tag === "script" || tag === "style") return;

    const inner = styleForElement(el, style);
    const walkChildren = () => {
      for (const child of el.childNodes) walk(child, inner);
    };

    if (tag === "ol" || tag === "ul") {
      blockBreak();
      const start = parseInt(el.getAttribute("start") ?? "", 10);
      lists.push({ ordered: tag === "ol", next: Number.isNaN(start) ? 1 : start });
      walkChildren();
      lists.pop();
      blockBreak();
    } else if (tag === "li") {
      endLine();
      const list = lists[lists.length - 1];
      const marker = list?.ordered ? `${list.next++}.` : "\u2022";
      runs.push({ ...inner, text: `${marker} ` });
      listItem = true;
      walkChildren();
      endLine();
    } else if (BLOCK_TAGS.has(tag)) {
      // A block that opens a list item stays on the item's marker line.
      if (!(listItem && runs.length === 1)) blockBreak();
      walkChildren();
      blockBreak();
    } else {
      walkChildren();
    }
  };

  for (const child of body.childNodes) walk(child, PLAIN_STYLE);
  endLine();
  return lines;
}

/** The CSS named colours (CSS Color Module Level 4), as #rrggbb. */
const CSS_NAMED_COLORS: Record<string, string> = {
  aliceblue: "#f0f8ff",
  antiquewhite: "#faebd7",
  aqua: "#00ffff",
  aquamarine: "#7fffd4",
  azure: "#f0ffff",
  beige: "#f5f5dc",
  bisque: "#ffe4c4",
  black: "#000000",
  blanchedalmond: "#ffebcd",
  blue: "#0000ff",
  blueviolet: "#8a2be2",
  brown: "#a52a2a",
  burlywood: "#deb887",
  cadetblue: "#5f9ea0",
  chartreuse: "#7fff00",
  chocolate: "#d2691e",
  coral: "#ff7f50",
  cornflowerblue: "#6495ed",
  cornsilk: "#fff8dc",
  crimson: "#dc143c",
  cyan: "#00ffff",
  darkblue: "#00008b",
  darkcyan: "#008b8b",
  darkgoldenrod: "#b8860b",
  darkgray: "#a9a9a9",
  darkgreen: "#006400",
  darkgrey: "#a9a9a9",
  darkkhaki: "#bdb76b",
  darkmagenta: "#8b008b",
  darkolivegreen: "#556b2f",
  darkorange: "#ff8c00",
  darkorchid: "#9932cc",
  darkred: "#8b0000",
  darksalmon: "#e9967a",
  darkseagreen: "#8fbc8f",
  darkslateblue: "#483d8b",
  darkslategray: "#2f4f4f",
  darkslategrey: "#2f4f4f",
  darkturquoise: "#00ced1",
  darkviolet: "#9400d3",
  deeppink: "#ff1493",
  deepskyblue: "#00bfff",
  dimgray: "#696969",
  dimgrey: "#696969",
  dodgerblue: "#1e90ff",
  firebrick: "#b22222",
  floralwhite: "#fffaf0",
  forestgreen: "#228b22",
  fuchsia: "#ff00ff",
  gainsboro: "#dcdcdc",
  ghostwhite: "#f8f8ff",
  gold: "#ffd700",
  goldenrod: "#daa520",
  gray: "#808080",
  green: "#008000",
  greenyellow: "#adff2f",
  grey: "#808080",
  honeydew: "#f0fff0",
  hotpink: "#ff69b4",
  indianred: "#cd5c5c",
  indigo: "#4b0082",
  ivory: "#fffff0",
  khaki: "#f0e68c",
  lavender: "#e6e6fa",
  lavenderblush: "#fff0f5",
  lawngreen: "#7cfc00",
  lemonchiffon: "#fffacd",
  lightblue: "#add8e6",
  lightcoral: "#f08080",
  lightcyan: "#e0ffff",
  lightgoldenrodyellow: "#fafad2",
  lightgray: "#d3d3d3",
  lightgreen: "#90ee90",
  lightgrey: "#d3d3d3",
  lightpink: "#ffb6c1",
  lightsalmon: "#ffa07a",
  lightseagreen: "#20b2aa",
  lightskyblue: "#87cefa",
  lightslategray: "#778899",
  lightslategrey: "#778899",
  lightsteelblue: "#b0c4de",
  lightyellow: "#ffffe0",
  lime: "#00ff00",
  limegreen: "#32cd32",
  linen: "#faf0e6",
  magenta: "#ff00ff",
  maroon: "#800000",
  mediumaquamarine: "#66cdaa",
  mediumblue: "#0000cd",
  mediumorchid: "#ba55d3",
  mediumpurple: "#9370db",
  mediumseagreen: "#3cb371",
  mediumslateblue: "#7b68ee",
  mediumspringgreen: "#00fa9a",
  mediumturquoise: "#48d1cc",
  mediumvioletred: "#c71585",
  midnightblue: "#191970",
  mintcream: "#f5fffa",
  mistyrose: "#ffe4e1",
  moccasin: "#ffe4b5",
  navajowhite: "#ffdead",
  navy: "#000080",
  oldlace: "#fdf5e6",
  olive: "#808000",
  olivedrab: "#6b8e23",
  orange: "#ffa500",
  orangered: "#ff4500",
  orchid: "#da70d6",
  palegoldenrod: "#eee8aa",
  palegreen: "#98fb98",
  paleturquoise: "#afeeee",
  palevioletred: "#db7093",
  papayawhip: "#ffefd5",
  peachpuff: "#ffdab9",
  peru: "#cd853f",
  pink: "#ffc0cb",
  plum: "#dda0dd",
  powderblue: "#b0e0e6",
  purple: "#800080",
  rebeccapurple: "#663399",
  red: "#ff0000",
  rosybrown: "#bc8f8f",
  royalblue: "#4169e1",
  saddlebrown: "#8b4513",
  salmon: "#fa8072",
  sandybrown: "#f4a460",
  seagreen: "#2e8b57",
  seashell: "#fff5ee",
  sienna: "#a0522d",
  silver: "#c0c0c0",
  skyblue: "#87ceeb",
  slateblue: "#6a5acd",
  slategray: "#708090",
  slategrey: "#708090",
  snow: "#fffafa",
  springgreen: "#00ff7f",
  steelblue: "#4682b4",
  tan: "#d2b48c",
  teal: "#008080",
  thistle: "#d8bfd8",
  tomato: "#ff6347",
  turquoise: "#40e0d0",
  violet: "#ee82ee",
  wheat: "#f5deb3",
  white: "#ffffff",
  whitesmoke: "#f5f5f5",
  yellow: "#ffff00",
  yellowgreen: "#9acd32",
};

/**
 * Convert a CSS colour (#rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() or a
 * named colour) to #rrggbb. Anything else falls back to black.
 */
function cssColorToHex(rawColor: string): string {
  const color = rawColor.trim().toLowerCase();
  if (/^#[0-9a-f]{3,4}$/.test(color)) {
    const [r, g, b] = color.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(color)) return color.slice(0, 7);
  if (CSS_NAMED_COLORS[color]) return CSS_NAMED_COLORS[color];
  if (color.startsWith("rgb")) {
    const match = color.match(/(\d+)/g);
    if (match && match.length >= 3) {
      const r = parseInt(match[0], 10).toString(16).padStart(2, "0");
      const g = parseInt(match[1], 10).toString(16).padStart(2, "0");
      const b = parseInt(match[2], 10).toString(16).padStart(2, "0");
      return `#${r}${g}${b}`;
    }
  }
  return "#000000";
}

/** The size a run is drawn at: its own or the box's, smaller for sub/superscript. */
function getRunFontSize(run: TextRun, defaultFontSize: number): number {
  const size = run.fontSize || defaultFontSize;
  return run.script ? size * SCRIPT_SIZE : size;
}

/** How far a run sits above (+) or below (-) the line's baseline. */
function getRunBaselineShift(run: TextRun, defaultFontSize: number): number {
  const size = run.fontSize || defaultFontSize;
  if (run.script === "super") return size * SUPERSCRIPT_RISE;
  if (run.script === "sub") return -size * SUBSCRIPT_DROP;
  return 0;
}

/**
 * Where the page shown in the editor sits in PDF space. The editor works on
 * the page as pdf.js shows it: the crop box (clipped to the media box),
 * turned by /Rotate, top-left origin, 1 unit per point. Exported drawings use
 * the same page with its origin at the bottom-left and y going up.
 */
interface PageFrame {
  /** Size of the page as shown, in points. */
  width: number;
  height: number;
  /** /Rotate (0, 90, 180 or 270); turning a drawing by this keeps it upright on screen. */
  rotation: number;
  /** A point on the shown page (from its bottom-left, y up) in PDF space. */
  toPdf(x: number, y: number): { x: number; y: number };
}

type FramedPage = {
  getSize(): { width: number; height: number };
  getRotation?: () => { angle: number };
  getCropBox?: () => { x: number; y: number; width: number; height: number };
  getMediaBox?: () => { x: number; y: number; width: number; height: number };
};

type Box = { x: number; y: number; width: number; height: number };

/** A box with a positive width and height, as pdf.js reads [x1 y1 x0 y0] boxes. */
function normalizeBox(box: Box): Box {
  return {
    x: Math.min(box.x, box.x + box.width),
    y: Math.min(box.y, box.y + box.height),
    width: Math.abs(box.width),
    height: Math.abs(box.height),
  };
}

function getPageFrame(page: FramedPage): PageFrame {
  const size = page.getSize();
  const media = normalizeBox(page.getMediaBox?.() ?? { x: 0, y: 0, ...size });
  const crop = normalizeBox(page.getCropBox?.() ?? media);
  // pdf.js shows the crop box clipped to the media box, or the media box
  // when they do not overlap.
  let x0 = Math.max(crop.x, media.x);
  let y0 = Math.max(crop.y, media.y);
  let x1 = Math.min(crop.x + crop.width, media.x + media.width);
  let y1 = Math.min(crop.y + crop.height, media.y + media.height);
  if (x1 <= x0 || y1 <= y0) {
    [x0, y0, x1, y1] = [media.x, media.y, media.x + media.width, media.y + media.height];
  }
  const boxWidth = x1 - x0;
  const boxHeight = y1 - y0;

  // pdf.js ignores a /Rotate that is not a multiple of 90.
  const angle = page.getRotation?.().angle ?? 0;
  const rotation = angle % 90 === 0 ? ((angle % 360) + 360) % 360 : 0;
  const sideways = rotation === 90 || rotation === 270;

  // The inverse of pdf.js's PageViewport transform at scale 1, applied to a
  // y-up point on the shown page.
  const toPdf = (x: number, y: number) => {
    switch (rotation) {
      case 90:
        return { x: x1 - y, y: y0 + x };
      case 180:
        return { x: x1 - x, y: y1 - y };
      case 270:
        return { x: x0 + y, y: y1 - x };
      default:
        return { x: x0 + x, y: y0 + y };
    }
  };

  return {
    width: sideways ? boxHeight : boxWidth,
    height: sideways ? boxWidth : boxHeight,
    rotation,
    toPdf,
  };
}

function runsHaveSameStyle(a: TextRun, b: TextRun): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.color === b.color &&
    a.fontSize === b.fontSize &&
    a.script === b.script
  );
}

function appendTextRun(line: TextRun[], run: TextRun, text: string) {
  if (!text) return;

  const previous = line[line.length - 1];
  if (previous && runsHaveSameStyle(previous, run)) {
    previous.text += text;
    return;
  }

  line.push({ ...run, text });
}

function tokenizeRunsForDrawing(runs: TextRun[]): DrawToken[] {
  const tokens: DrawToken[] = [];

  for (const run of runs) {
    const runTokens = stripControlChars(run.text).match(/\s+|\S+/g) ?? [];
    for (const text of runTokens) {
      tokens.push({
        run,
        text,
        isWhitespace: /^\s+$/.test(text),
        isJustifiableSpace: false,
      });
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].isWhitespace) continue;

    const hasTextBefore = tokens.slice(0, i).some((token) => !token.isWhitespace);
    const hasTextAfter = tokens.slice(i + 1).some((token) => !token.isWhitespace);
    tokens[i].isJustifiableSpace = hasTextBefore && hasTextAfter;
  }

  return tokens;
}

const listMarkerPattern = /^\s*((?:\d+|[a-zA-Z])[.)]|[\u2022\u2023\u25e6\u25aa\-*])\s+/;

function getRunAtOffset(runs: TextRun[], offset: number): TextRun | null {
  let currentOffset = 0;

  for (const run of runs) {
    const nextOffset = currentOffset + run.text.length;
    if (offset >= currentOffset && offset < nextOffset) return run;
    currentOffset = nextOffset;
  }

  return runs.find((run) => run.text.trim().length > 0) ?? runs[0] ?? null;
}

function sliceRunsFromOffset(runs: TextRun[], offset: number): TextRun[] {
  const result: TextRun[] = [];
  let remaining = offset;

  for (const run of runs) {
    if (remaining >= run.text.length) {
      remaining -= run.text.length;
      continue;
    }

    const text = run.text.slice(remaining);
    if (text) result.push({ ...run, text });
    remaining = 0;
  }

  return result;
}

function extractListLineParts(runs: TextRun[]): ListLineParts | null {
  const rawText = runs.map((run) => run.text).join("");
  const match = rawText.match(listMarkerPattern);
  if (!match) return null;

  const marker = match[1];
  const markerStart = match[0].indexOf(marker);
  const markerRun = getRunAtOffset(runs, markerStart);
  if (!markerRun) return null;

  return {
    markerRun: { ...markerRun, text: marker },
    contentRuns: sliceRunsFromOffset(runs, match[0].length),
  };
}

async function measureTextRun(
  run: TextRun,
  text: string,
  fontName: string,
  defaultFontSize: number,
  getFont: FontGetter,
): Promise<number> {
  const cleanText = stripControlChars(text);
  if (!cleanText) return 0;

  const font = await getFont(fontName, run.bold, run.italic);
  const fontSize = getRunFontSize(run, defaultFontSize);
  if (typeof font.widthOfTextAtSize === "function") {
    return font.widthOfTextAtSize(cleanText, fontSize);
  }

  return cleanText.length * fontSize * 0.5;
}

async function measureLineRuns(
  runs: TextRun[],
  fontName: string,
  defaultFontSize: number,
  getFont: FontGetter,
): Promise<number> {
  let width = 0;

  for (const run of runs) {
    width += await measureTextRun(run, run.text, fontName, defaultFontSize, getFont);
  }

  return width;
}

type TextPiece = { run: TextRun; text: string };

/** A word and the whitespace before it. A word can span runs, as in "H<sub>2</sub>O". */
interface WrapWord {
  pieces: TextPiece[];
  space: TextPiece[];
}

/**
 * Split runs into words at whitespace. Text on both sides of a style change
 * with no space between ("x<sup>2</sup>") stays one word, so wrapping never
 * separates it. The editor shows text with white-space: pre-wrap, so the
 * whitespace before each word is kept as it is, one space per character
 * (a tab counts as one), including before the first word. Trailing
 * whitespace is dropped: pre-wrap lets it hang past the line's end.
 */
function splitIntoWords(runs: TextRun[]): WrapWord[] {
  const words: WrapWord[] = [];
  let pendingSpace: TextPiece[] = [];
  let afterSpace = true;

  for (const run of runs) {
    for (const token of run.text.match(/\s+|\S+/g) ?? []) {
      if (/^\s+$/.test(token)) {
        pendingSpace.push({ run, text: " ".repeat(token.length) });
        afterSpace = true;
        continue;
      }
      if (!afterSpace && words.length > 0) {
        words[words.length - 1].pieces.push({ run, text: token });
      } else {
        words.push({ pieces: [{ run, text: token }], space: pendingSpace });
        pendingSpace = [];
      }
      afterSpace = false;
    }
  }

  return words;
}

async function wrapTextRuns(
  runs: TextRun[],
  maxWidth: number,
  fontName: string,
  defaultFontSize: number,
  getFont: FontGetter,
): Promise<TextRun[][]> {
  if (runs.length === 0) return [[]];
  if (maxWidth <= 0) return [runs];

  const measure = (piece: TextPiece) =>
    measureTextRun(piece.run, piece.text, fontName, defaultFontSize, getFont);

  const wrappedLines: TextRun[][] = [];
  let currentLine: TextRun[] = [];
  let currentWidth = 0;
  // Whitespace before the first word is indentation and is drawn; whitespace
  // where a line wraps is dropped, as pre-wrap hangs it at the line's end.
  let atSourceStart = true;

  const flushLine = () => {
    if (currentLine.length > 0) {
      wrappedLines.push(currentLine);
      currentLine = [];
      currentWidth = 0;
    }
  };

  for (const word of splitIntoWords(runs)) {
    let wordWidth = 0;
    for (const piece of word.pieces) wordWidth += await measure(piece);
    // The space keeps the style of the run it came from, so it is measured
    // in that style too: a 40pt space before 10pt text is 40pt wide.
    let space = currentLine.length > 0 || atSourceStart ? word.space : [];
    let spaceWidth = 0;
    for (const piece of space) spaceWidth += await measure(piece);
    atSourceStart = false;

    if (currentLine.length > 0 && currentWidth + spaceWidth + wordWidth > maxWidth) {
      flushLine();
      space = [];
      spaceWidth = 0;
    }

    const startsLine = currentLine.length === 0;
    for (const piece of space) appendTextRun(currentLine, piece.run, piece.text);
    currentWidth += spaceWidth;

    if (startsLine && wordWidth > maxWidth) {
      // Too long for any line: break it between characters.
      let doneWidth = currentWidth;
      for (const piece of word.pieces) {
        let pieceText = "";
        for (const char of Array.from(piece.text)) {
          const candidate = `${pieceText}${char}`;
          const candidateWidth = await measure({ run: piece.run, text: candidate });
          if (currentLine.length + pieceText.length > 0 && doneWidth + candidateWidth > maxWidth) {
            appendTextRun(currentLine, piece.run, pieceText);
            flushLine();
            doneWidth = 0;
            pieceText = char;
          } else {
            pieceText = candidate;
          }
        }
        appendTextRun(currentLine, piece.run, pieceText);
        doneWidth += await measure({ run: piece.run, text: pieceText });
      }
      currentWidth = doneWidth;
      continue;
    }

    for (const piece of word.pieces) appendTextRun(currentLine, piece.run, piece.text);
    currentWidth += wordWidth;
  }

  flushLine();
  return wrappedLines.length > 0 ? wrappedLines : [[]];
}

/**
 * Draw the editor's annotations onto the PDF and return the saved bytes.
 * The standard fonts only encode WinAnsi, so text they cannot show is
 * replaced (accents dropped, close matches, or "?") rather than failing the
 * save; `options.onCharactersReplaced` gets the number of replaced characters
 * when there are any.
 */
export async function embedAllAnnotations(
  pdfData: Uint8Array,
  annotations: Annotation[],
  extractedSources: ExtractedSource[] = [],
  options: { onCharactersReplaced?: (count: number) => void } = {},
): Promise<Uint8Array> {
  try {
    const { pdfDoc } = await loadProcessablePdf(pdfData);
    const pages = pdfDoc.getPages();
    let replacedChars = 0;

    const toRgb = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255 || 0;
      const g = parseInt(hex.slice(3, 5), 16) / 255 || 0;
      const b = parseInt(hex.slice(5, 7), 16) / 255 || 0;
      return { r, g, b };
    };

    const imageCache = new Map<
      string,
      Promise<Awaited<ReturnType<typeof pdfDoc.embedPng | typeof pdfDoc.embedJpg>>>
    >();
    const getEmbeddedImage = async (dataUrl: string) => {
      const cached = imageCache.get(dataUrl);
      if (cached) return cached;
      // pdf-lib decodes a base64 data URL itself. fetch() must not be used:
      // the production Content-Security-Policy (connect-src) blocks data: URLs.
      const embedPromise = dataUrl.includes("image/png")
        ? pdfDoc.embedPng(dataUrl)
        : pdfDoc.embedJpg(dataUrl);
      imageCache.set(dataUrl, embedPromise);
      return embedPromise;
    };

    // Cache for embedded fonts to avoid redundant embedding
    const fontCache: Record<string, any> = {};
    const getFont = async (fontName: string, bold = false, italic = false) => {
      // Build a key that accounts for style variants
      let standardFont: keyof typeof StandardFonts;
      // The editor offers only these three families; any other stored name
      // draws as the nearest one, as the editor shows it.
      const family = nearestEditorFont(fontName).value;
      if (family === "Times-Roman") {
        if (bold && italic) standardFont = "TimesRomanBoldItalic";
        else if (bold) standardFont = "TimesRomanBold";
        else if (italic) standardFont = "TimesRomanItalic";
        else standardFont = "TimesRoman";
      } else if (family === "Courier") {
        if (bold && italic) standardFont = "CourierBoldOblique";
        else if (bold) standardFont = "CourierBold";
        else if (italic) standardFont = "CourierOblique";
        else standardFont = "Courier";
      } else {
        // Default to Helvetica family
        if (bold && italic) standardFont = "HelveticaBoldOblique";
        else if (bold) standardFont = "HelveticaBold";
        else if (italic) standardFont = "HelveticaOblique";
        else standardFont = "Helvetica";
      }

      const cacheKey = standardFont;
      if (fontCache[cacheKey]) return fontCache[cacheKey];

      const font = await pdfDoc.embedFont(StandardFonts[standardFont]);
      fontCache[cacheKey] = font;
      return font;
    };

    const sourceRegions = [...extractedSources];
    // Extracted annotations stand in for their sources only on pages whose
    // sources are missing; elsewhere the sources are the exact glyph boxes.
    const pagesWithSources = new Set(extractedSources.map((src) => src.pageIndex));
    for (const ann of annotations) {
      if (!ann.extracted || pagesWithSources.has(ann.pageIndex)) continue;
      if (ann.type !== "textblock" && ann.type !== "image") continue;
      if (!ann.width || !ann.height) continue;
      sourceRegions.push({
        pageIndex: ann.pageIndex,
        x: ann.x,
        y: ann.y,
        width: ann.width,
        height: ann.height,
      });
    }

    // First pass: white-out ALL originally extracted regions (text + images),
    // including those whose annotations were deleted by the user. Extracted
    // annotations are included as a fallback so stale/missing source tracking
    // cannot leave the old PDF text layer visible under redrawn text.
    for (const src of sourceRegions) {
      const page = pages[src.pageIndex];
      if (!page) continue;

      const frame = getPageFrame(page);
      const padding = EXTRACTED_WHITEOUT_PADDING_PT;

      page.drawRectangle({
        ...frame.toPdf(src.x - padding, frame.height - src.y - src.height - padding),
        width: src.width + padding * 2,
        height: src.height + padding * 2,
        rotate: degrees(frame.rotation),
        color: rgb(1, 1, 1), // White
        opacity: 1.0,
        borderWidth: 0,
      });
    }

    /**
     * Draw a text box's rich text (or plain content), wrapped to the box.
     * Add Text boxes have no width: in the editor they grow with their text
     * up to the page edge, so they wrap there and align within their widest
     * line.
     */
    const drawTextBox = async (ann: Annotation, page: (typeof pages)[number], frame: PageFrame) => {
      const fontSize = ann.style?.fontSize || 16;
      const baseColor = ann.style?.color || "#000000";
      const fontName = ann.style?.font || "Helvetica";
      const lineHeightFactor = ann.style?.lineHeight || 1.4;
      const textAlign: TextAlign = ann.style?.textAlign || "left";
      const rotate = degrees(frame.rotation);
      const at = (x: number, y: number) => frame.toPdf(x, y);

      // One editor pixel in PDF units: the editor shows every page 800px wide.
      const editorPx = frame.width / EDITOR_PAGE_WIDTH;
      // The text starts inside the box's border and left padding.
      const insetX = (ann.type === "textblock" ? TEXTBLOCK_INSET_X_PX : TEXT_INSET_X_PX) * editorPx;
      const contentX = ann.x + insetX;

      // Parse rich HTML content into runs
      let textLines: SourceLine[];
      if (ann.richContent) {
        textLines = parseRichContent(ann.richContent);
      } else {
        // Fallback: plain content split by newlines
        const plainLines = (ann.content || "").split("\n");
        textLines = plainLines.map((line) => ({
          runs: [
            {
              text: line,
              bold: ann.style?.bold || false,
              italic: ann.style?.italic || false,
              underline: false,
              strikethrough: false,
            },
          ],
          startsBlock: false,
          listItem: false,
        }));
      }

      // The standard fonts throw on characters outside WinAnsi. Clean the
      // text once, here, so measuring, wrapping and drawing all see the
      // same string.
      for (const line of textLines) {
        for (const run of line.runs) {
          const safe = toWinAnsi(run.text);
          run.text = safe.text;
          replacedChars += safe.replaced;
        }
      }

      // Lays the lines out in a box `blockWidth` wide, drawing them when
      // `draw` is set; returns the width of the widest line and the height
      // from the box's top to the bottom of its last line.
      const layout = async (
        blockWidth: number,
        draw: boolean,
      ): Promise<{ widest: number; height: number }> => {
        let widest = 0;
        const top = frame.height - ann.y;
        // The first line starts below the box's border and top padding, plus
        // any paragraph spacing, as in the editor.
        let currentY = top - TEXT_BOX_INSET_PX * editorPx - (ann.style?.paragraphSpacing || 0);
        let continuedListIndent: number | null = null;

        for (let sourceLineIndex = 0; sourceLineIndex < textLines.length; sourceLineIndex++) {
          const { runs: sourceLineRuns, startsBlock, listItem } = textLines[sourceLineIndex];
          // A list item's text continues on its column only across <br> breaks.
          if (startsBlock) continuedListIndent = null;
          // Only <li> lines get list layout: typed text that merely starts
          // with "2024. " or "- " is drawn as the plain text the editor shows.
          const listLine = listItem ? extractListLineParts(sourceLineRuns) : null;
          const isListContinuation: boolean = !listLine && continuedListIndent !== null;
          const runsToWrap = listLine?.contentRuns ?? sourceLineRuns;
          const listTextIndent: number = listLine
            ? Math.max(fontSize * 1.8, 18)
            : isListContinuation
              ? (continuedListIndent ?? 0)
              : 0;
          const useListLayout = Boolean(listLine || isListContinuation);
          const wrapWidth = useListLayout ? Math.max(20, blockWidth - listTextIndent) : blockWidth;
          const wrappedLines = await wrapTextRuns(
            runsToWrap,
            wrapWidth,
            fontName,
            fontSize,
            getFont,
          );

          for (let lineIndex = 0; lineIndex < wrappedLines.length; lineIndex++) {
            const lineRuns = wrappedLines[lineIndex];
            const markerRun = listLine && lineIndex === 0 ? listLine.markerRun : null;
            if (lineRuns.length === 0 && !markerRun) {
              // An empty line is as tall as the text style it was left in.
              const blankSize = Math.max(
                fontSize,
                ...sourceLineRuns.map((run) => getRunFontSize(run, fontSize)),
              );
              currentY -= lineHeightFactor * blankSize;
              continue;
            }

            const lineFontSize = Math.max(
              ...lineRuns.map((run) => getRunFontSize(run, fontSize)),
              markerRun ? getRunFontSize(markerRun, fontSize) : fontSize,
              fontSize,
            );
            // Each line is as tall as its largest text, as in the editor, so a
            // large run does not overlap the next line.
            const lineAdvance = lineHeightFactor * lineFontSize;
            // CSS puts half of the extra line height (the half-leading) above
            // the text, so the baseline drops by that much at larger spacing.
            const halfLeading = ((lineHeightFactor - 1) * lineFontSize) / 2;
            const adjustedY = adjustYForTextBaseline(currentY - halfLeading, lineFontSize);

            if (markerRun && draw) {
              const markerColor = markerRun.color
                ? toRgb(cssColorToHex(markerRun.color))
                : toRgb(baseColor);
              const markerFont = await getFont(fontName, markerRun.bold, markerRun.italic);
              const markerFontSize = getRunFontSize(markerRun, fontSize);
              const cleanMarker = stripControlChars(markerRun.text);

              if (cleanMarker) {
                // Right-aligned against the item's text, as browsers place list
                // markers, so a wide number such as "10." never runs into it.
                const markerWidth = await measureTextRun(
                  markerRun,
                  cleanMarker,
                  fontName,
                  fontSize,
                  getFont,
                );
                const markerX =
                  contentX + listTextIndent - markerFontSize * LIST_MARKER_GAP - markerWidth;
                page.drawText(cleanMarker, {
                  ...at(markerX, adjustedY),
                  rotate,
                  size: markerFontSize,
                  font: markerFont,
                  color: rgb(markerColor.r, markerColor.g, markerColor.b),
                });
              }
            }

            if (lineRuns.length === 0) {
              currentY -= lineAdvance;
              continue;
            }

            const lineWidth = await measureLineRuns(lineRuns, fontName, fontSize, getFont);
            const lineBoxX = useListLayout ? contentX + listTextIndent : contentX;
            const lineBoxWidth = useListLayout ? wrapWidth : blockWidth;
            widest = Math.max(widest, lineBoxX - contentX + lineWidth);
            if (!draw) {
              currentY -= lineAdvance;
              continue;
            }
            // Like CSS justify, the last line of each source line (before a
            // <br>, a block or the end) is not stretched.
            const endsSourceLine = lineIndex === wrappedLines.length - 1;

            // Calculate X offset based on text alignment
            let xOffset = lineBoxX;
            if (textAlign === "center") {
              xOffset = lineBoxX + Math.max(0, (lineBoxWidth - lineWidth) / 2);
            } else if (textAlign === "right") {
              xOffset = lineBoxX + Math.max(0, lineBoxWidth - lineWidth);
            }

            let currentX = xOffset;
            const drawRunText = async (run: TextRun, text: string, x: number): Promise<number> => {
              const runColor = run.color ? toRgb(cssColorToHex(run.color)) : toRgb(baseColor);
              const font = await getFont(fontName, run.bold, run.italic);
              const runFontSize = getRunFontSize(run, fontSize);
              const runY = adjustedY + getRunBaselineShift(run, fontSize);
              const cleanText = stripControlChars(text);

              if (cleanText) {
                page.drawText(cleanText, {
                  ...at(x, runY),
                  rotate,
                  size: runFontSize,
                  font,
                  color: rgb(runColor.r, runColor.g, runColor.b),
                });

                const textWidth = await measureTextRun(run, cleanText, fontName, fontSize, getFont);

                // Draw underline if needed
                if (run.underline) {
                  page.drawLine({
                    start: at(x, runY - 2),
                    end: at(x + textWidth, runY - 2),
                    thickness: 1,
                    color: rgb(runColor.r, runColor.g, runColor.b),
                  });
                }

                // Draw strikethrough if needed
                if (run.strikethrough) {
                  page.drawLine({
                    start: at(x, runY + runFontSize * 0.3),
                    end: at(x + textWidth, runY + runFontSize * 0.3),
                    thickness: 1,
                    color: rgb(runColor.r, runColor.g, runColor.b),
                  });
                }

                return textWidth;
              }
              return 0;
            };

            const drawTokens = tokenizeRunsForDrawing(lineRuns);
            const justifiableSpaceCount = drawTokens.filter(
              (token) => token.isJustifiableSpace,
            ).length;
            const justifyExtraSpace =
              textAlign === "justify" &&
              !endsSourceLine &&
              justifiableSpaceCount > 0 &&
              lineWidth < lineBoxWidth
                ? (lineBoxWidth - lineWidth) / justifiableSpaceCount
                : 0;

            if (justifyExtraSpace > 0) {
              for (const token of drawTokens) {
                const textWidth = await drawRunText(token.run, token.text, currentX);
                currentX += textWidth + (token.isJustifiableSpace ? justifyExtraSpace : 0);
              }
            } else {
              for (const run of lineRuns) {
                currentX += await drawRunText(run, run.text, currentX);
              }
            }

            currentY -= lineAdvance;
          }

          if (listLine) continuedListIndent = listTextIndent;
        }

        return { widest, height: top - currentY };
      };

      // The width the text wraps at. An extracted box is shown 6px wider than
      // its stored width, less its border and padding on both sides; an Add
      // Text box grows with its text up to the page edge.
      const maxWidth = Math.max(50, frame.width - ann.x - 2 * insetX);
      let blockWidth = maxWidth;
      if (ann.width) {
        blockWidth =
          ann.type === "textblock"
            ? ann.width + (TEXT_BOX_EXTRA_WIDTH_PX - 2 * TEXTBLOCK_INSET_X_PX) * editorPx
            : ann.width;
      }
      if (!ann.width && ann.type === "text") {
        // A tiny allowance keeps rounding from re-wrapping the widest line.
        blockWidth = Math.min(maxWidth, (await layout(maxWidth, false)).widest + 0.01);
      }
      if (ann.type === "textblock" && ann.extracted && ann.width) {
        // In the editor an extracted text box is opaque white: at least its
        // original height, taller if its text grew, and 6px wider for its
        // padding. Draw the same box, so text baked into an image under it
        // does not show through or twice. (Without a width there is no
        // known box to fill.)
        const { height } = await layout(blockWidth, false);
        const boxHeight = Math.max(ann.height || 0, height + TEXT_BOX_INSET_PX * editorPx);
        page.drawRectangle({
          ...at(ann.x, frame.height - ann.y - boxHeight),
          width: ann.width + TEXT_BOX_EXTRA_WIDTH_PX * editorPx,
          height: boxHeight,
          rotate,
          color: rgb(1, 1, 1),
          opacity: 1,
          borderWidth: 0,
        });
      }
      await layout(blockWidth, true);
    };

    // Second pass: draw all annotations (including textblock text on top of white rects)
    for (const ann of annotations) {
      const page = pages[ann.pageIndex];
      if (!page) continue;

      const frame = getPageFrame(page);
      const height = frame.height;
      const rotate = degrees(frame.rotation);
      const at = (x: number, y: number) => frame.toPdf(x, y);

      if (ann.type === "textblock" || ann.type === "text") {
        await drawTextBox(ann, page, frame);
      } else if (ann.type === "rectangle") {
        const { r, g, b } = toRgb(ann.style?.color || "#ffffff");
        const width = ann.width || 100;
        const boxHeight = ann.height || 50;
        const strokeWidth = ann.style?.strokeWidth || 0;

        page.drawRectangle({
          ...at(ann.x, height - ann.y - boxHeight),
          width,
          height: boxHeight,
          rotate,
          color: rgb(r, g, b),
          borderWidth: strokeWidth,
          // The editor draws the border black; without a colour none is drawn.
          ...(strokeWidth > 0 ? { borderColor: rgb(0, 0, 0) } : {}),
          opacity: ann.style?.opacity ?? 1.0,
        });
      } else if (ann.type === "highlight") {
        const { r, g, b } = toRgb(ann.style?.color || "#ffff00");
        const width = ann.width || 120;
        const boxHeight = ann.height || 24;

        page.drawRectangle({
          ...at(ann.x, height - ann.y - boxHeight),
          width,
          height: boxHeight,
          rotate,
          color: rgb(r, g, b),
          opacity: ann.style?.opacity ?? 0.3,
          borderWidth: 0,
        });
      } else if (ann.type === "freehand" && ann.points && ann.points.length > 1) {
        const { r, g, b } = toRgb(ann.style?.color || "#111827");
        const strokeWidth = ann.style?.strokeWidth || 2;
        const opacity = ann.style?.opacity ?? 1;

        for (let i = 1; i < ann.points.length; i++) {
          const prev = ann.points[i - 1];
          const next = ann.points[i];

          page.drawLine({
            start: at(ann.x + prev.x, height - (ann.y + prev.y)),
            end: at(ann.x + next.x, height - (ann.y + next.y)),
            thickness: strokeWidth,
            color: rgb(r, g, b),
            opacity,
          });
        }
      } else if (ann.type === "strikethrough" || ann.type === "underline") {
        const { r, g, b } = toRgb(ann.style?.color || "#111827");
        const strokeWidth = ann.style?.strokeWidth || 2;
        const opacity = ann.style?.opacity ?? 1;
        const boxHeight = ann.height || 12;
        const lineTop =
          ann.type === "underline"
            ? Math.max(0, boxHeight - strokeWidth)
            : Math.max(0, boxHeight / 2 - strokeWidth / 2);
        // The editor draws the line as a bar `strokeWidth` tall from lineTop;
        // a PDF line is centred on its path, so follow the bar's middle.
        const lineY = height - (ann.y + lineTop + strokeWidth / 2);

        page.drawLine({
          start: at(ann.x, lineY),
          end: at(ann.x + (ann.width || 120), lineY),
          thickness: strokeWidth,
          color: rgb(r, g, b),
          opacity,
        });
      } else if (ann.type === "image" && ann.content) {
        const width = ann.width || 150;
        const boxHeight = ann.height || 150;
        // The editor turns images clockwise about their centre (CSS rotate);
        // pdf-lib turns anticlockwise about the corner it is given, so find
        // where the bottom-left corner ends up and turn the other way.
        const turn = ann.style?.rotation || 0;
        const radians = (-turn * Math.PI) / 180;
        const centerX = ann.x + width / 2;
        const centerY = height - ann.y - boxHeight / 2;
        const cornerX =
          centerX + (-width / 2) * Math.cos(radians) - (-boxHeight / 2) * Math.sin(radians);
        const cornerY =
          centerY + (-width / 2) * Math.sin(radians) + (-boxHeight / 2) * Math.cos(radians);

        const embeddedImage = await getEmbeddedImage(ann.content);

        page.drawImage(embeddedImage, {
          ...at(cornerX, cornerY),
          width,
          height: boxHeight,
          rotate: degrees(frame.rotation - turn),
          opacity: ann.style?.opacity ?? 1.0,
        });
      }
    }

    if (replacedChars > 0) options.onCharactersReplaced?.(replacedChars);
    return await pdfDoc.save();
  } catch (err) {
    logger.error("Failed to embed all annotations", err);
    throw err;
  }
}

export interface PageImage {
  pageNumber: number;
  blob: Blob | null;
}

/**
 * Renders PDF pages to images, keeping each image with its page number so a
 * page that fails to encode never shifts the pages after it.
 * @param options.pages 1-based page numbers to render; all pages when omitted.
 */
export async function renderPdfPagesToImages(
  pdfData: Uint8Array,
  options: { format: "png" | "jpeg"; scale?: number; pages?: number[] },
): Promise<PageImage[]> {
  try {
    const { pdfDoc: pdf } = await loadProcessablePdfJsDocument(pdfData);
    try {
      const pageNumbers = (
        options.pages ?? Array.from({ length: pdf.numPages }, (_, index) => index + 1)
      ).filter((pageNumber) => pageNumber >= 1 && pageNumber <= pdf.numPages);
      const results: PageImage[] = [];
      const scale = options.scale || 2.0;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not get 2D context from canvas");

      for (let index = 0; index < pageNumbers.length; index++) {
        const pageNumber = pageNumbers[index];
        const page = await pdf.getPage(pageNumber);
        try {
          const viewport = page.getViewport({ scale });

          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));

          await page.render({ canvasContext: context, viewport, canvas }).promise;

          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, `image/${options.format}`, 0.95),
          );
          results.push({ pageNumber, blob });
        } finally {
          // Frees the page's decoded images and fonts in the pdf.js worker.
          page.cleanup?.();
        }

        if ((index + 1) % 2 === 0) {
          await yieldToMain();
        }
      }

      return results;
    } finally {
      // The document and its worker hold the parsed file; free them on
      // success and on error alike.
      try {
        await pdf.destroy?.();
      } catch (destroyErr) {
        logger.warn("Failed to release the PDF after rendering it", destroyErr);
      }
    }
  } catch (err) {
    logger.error("Failed to convert PDF to images", err);
    throw err;
  }
}

/** Renders every page and returns the images that encoded, in page order. */
export async function convertPdfToImages(
  pdfData: Uint8Array,
  options: { format: "png" | "jpeg"; scale?: number },
): Promise<Blob[]> {
  const pages = await renderPdfPagesToImages(pdfData, options);
  return pages.flatMap(({ blob }) => (blob ? [blob] : []));
}

export async function convertImagesToPdf(images: File[]): Promise<Uint8Array> {
  try {
    const pdfDoc = await PDFDocument.create();

    for (const imageFile of images) {
      const arrayBuffer = await imageFile.arrayBuffer();
      let embeddedImage: Awaited<ReturnType<typeof pdfDoc.embedPng | typeof pdfDoc.embedJpg>>;

      if (imageFile.type === "image/png") {
        embeddedImage = await pdfDoc.embedPng(arrayBuffer);
      } else {
        embeddedImage = await pdfDoc.embedJpg(arrayBuffer);
      }

      const { width, height } = embeddedImage.scale(1);
      const page = pdfDoc.addPage([width, height]);

      page.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width,
        height,
      });
    }

    return await pdfDoc.save();
  } catch (err) {
    logger.error("Failed to convert images to PDF", err);
    throw err;
  }
}
