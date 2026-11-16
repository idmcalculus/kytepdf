/**
 * Draws Markdown (or plain text) onto pdf-lib pages with the standard PDF
 * fonts, so text from the creator, .txt/.md files and Office files converted
 * by anydoc all end up as real, selectable PDF text.
 */
import { PDFDocument, rgb, StandardFonts } from "./pdfConfig.ts";
import { yieldToMain } from "./taskScheduler.ts";

type PdfDoc = Awaited<ReturnType<typeof PDFDocument.create>>;
type PdfFont = Awaited<ReturnType<PdfDoc["embedFont"]>>;
type PdfPage = ReturnType<PdfDoc["addPage"]>;
type Color = ReturnType<typeof rgb>;

export type PageSizeName = "letter" | "a4";
/** A named size, or a custom [width, height] in PDF points (1/72 inch). */
export type PageSizeOption = PageSizeName | readonly [number, number];
export type PageOrientation = "portrait" | "landscape";

export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MarkdownPdfOptions {
  pageSize?: PageSizeOption;
  orientation?: PageOrientation;
  /** Points. One number sets all four sides. */
  margins?: number | Partial<PageMargins>;
  /** Drawn as a large heading at the top of the first page. */
  title?: string;
  /** Keep the text as typed: no Markdown, every line break kept. */
  plainText?: boolean;
  /**
   * Start a new page before each heading at this level or above (1–6). Used
   * for decks, where anydoc writes each slide title as a level-2 heading.
   */
  newPageAtHeadingLevel?: number;
  /** Body text size in points. */
  fontSize?: number;
}

export interface MarkdownPdfResult {
  /** Pages this call added. */
  pageCount: number;
  /** Characters the standard fonts cannot show, swapped for a near match or "?". */
  replacedCharacters: number;
}

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  /** A forced line break; `text` is empty. */
  br?: boolean;
}

export type TableAlign = "left" | "center" | "right";

export type MarkdownBlock =
  | { type: "heading"; level: number; runs: TextRun[] }
  | { type: "paragraph"; runs: TextRun[]; preserveSpaces?: boolean }
  | { type: "list"; ordered: boolean; start: number; items: MarkdownBlock[][] }
  | { type: "quote"; blocks: MarkdownBlock[] }
  | { type: "code"; text: string }
  | { type: "rule" }
  | { type: "table"; header: TextRun[][]; rows: TextRun[][][]; align: TableAlign[] }
  | { type: "pageBreak" };

const PAGE_SIZES: Record<PageSizeName, readonly [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

const DEFAULT_MARGIN = 54;
const DEFAULT_FONT_SIZE = 11;
const MIN_PAGE_SIDE = 72;
// The largest page side the PDF spec lets viewers rely on.
const MAX_PAGE_SIDE = 14_400;
const MIN_CONTENT_SIDE = 72;

export function resolvePageSize(
  size: PageSizeOption = "letter",
  orientation: PageOrientation = "portrait",
): [number, number] {
  let width: number;
  let height: number;
  if (typeof size === "string") {
    [width, height] = PAGE_SIZES[size] ?? PAGE_SIZES.letter;
  } else {
    const clamp = (value: number) =>
      Number.isFinite(value) ? Math.min(MAX_PAGE_SIDE, Math.max(MIN_PAGE_SIDE, value)) : 612;
    [width, height] = [clamp(size[0]), clamp(size[1])];
  }
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  return orientation === "landscape" ? [long, short] : [short, long];
}

export function resolveMargins(
  margins: MarkdownPdfOptions["margins"],
  pageSize: readonly [number, number],
): PageMargins {
  const pick = (value: number | undefined) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : DEFAULT_MARGIN;
  const base =
    typeof margins === "number"
      ? { top: pick(margins), right: pick(margins), bottom: pick(margins), left: pick(margins) }
      : {
          top: pick(margins?.top),
          right: pick(margins?.right),
          bottom: pick(margins?.bottom),
          left: pick(margins?.left),
        };
  // Margins that leave no room for text are scaled down instead of rejected.
  const [width, height] = pageSize;
  const shrink = (a: number, b: number, side: number) => {
    const room = side - MIN_CONTENT_SIDE;
    return a + b > room ? room / (a + b) : 1;
  };
  const x = shrink(base.left, base.right, width);
  const y = shrink(base.top, base.bottom, height);
  return {
    top: base.top * y,
    bottom: base.bottom * y,
    left: base.left * x,
    right: base.right * x,
  };
}

// ---------------------------------------------------------------------------
// Characters the standard fonts can show
// ---------------------------------------------------------------------------

/** Code points WinAnsi (the encoding of the standard PDF fonts) can encode. */
const WIN_ANSI = (() => {
  const set = new Set<number>();
  for (let cp = 0x20; cp <= 0x7e; cp++) set.add(cp);
  for (let cp = 0xa0; cp <= 0xff; cp++) set.add(cp);
  for (const char of "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ") set.add(char.codePointAt(0) as number);
  return set;
})();

/** Common characters outside WinAnsi with a close, readable stand-in. */
const NEAR_MATCHES: Record<string, string> = {
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2015": "\u2014",
  "\u2043": "-",
  "\u2212": "-",
  "\u2032": "'",
  "\u2033": '"',
  "\u2190": "<-",
  "\u2192": "->",
  "\u2194": "<->",
  "\u21d2": "=>",
  "\u2264": "<=",
  "\u2265": ">=",
  "\u2260": "!=",
  "\u2248": "~",
  "\u2219": "\u2022",
  "\u2023": "\u2022",
  "\u25cf": "\u2022",
  "\u25e6": "\u2022",
  "\u25aa": "\u2022",
  "\u25a0": "\u2022",
  "\u2713": "v",
  "\u2714": "v",
  "\u2717": "x",
  "\u2718": "x",
  "\u2605": "*",
  "\u2606": "*",
  "\u201f": "\u201d",
  "\u201b": "\u2019",
  // Letters with a stroke have no accent to strip.
  "\u0141": "L",
  "\u0142": "l",
  "\u0110": "D",
  "\u0111": "d",
  "\u0126": "H",
  "\u0127": "h",
  "\u0131": "i",
};

/**
 * Invisible characters that carry no text of their own: zero-width spaces
 * and joiners, byte order marks, soft hyphens, variation selectors, emoji
 * skin tones and control characters.
 */
const isInvisible = (char: string, cp: number) =>
  (cp >= 0x200b && cp <= 0x200f) ||
  cp === 0x2060 ||
  cp === 0xfeff ||
  cp === 0xad ||
  (cp >= 0xfe00 && cp <= 0xfe0f) ||
  (cp >= 0x1f3fb && cp <= 0x1f3ff) ||
  /\p{Cc}/u.test(char);

const canEncode = (text: string) =>
  Array.from(text).every((char) => WIN_ANSI.has(char.codePointAt(0) as number));

/**
 * Makes text safe for the standard fonts, which throw on anything WinAnsi
 * cannot encode. Accented letters lose the accent, a few symbols get a close
 * match and the rest become "?". Line breaks and form feeds are kept.
 */
export function toWinAnsi(text: string): { text: string; replaced: number } {
  let replaced = 0;
  let out = "";
  for (const char of text.normalize("NFC")) {
    if (char === "\n" || char === "\f" || char === "\t") {
      out += char;
      continue;
    }
    const cp = char.codePointAt(0) as number;
    if (WIN_ANSI.has(cp) && cp !== 0xad) {
      out += char;
      continue;
    }
    if (isInvisible(char, cp)) continue;
    if (/\p{Zs}/u.test(char)) {
      out += " ";
      continue;
    }
    const near = NEAR_MATCHES[char];
    replaced += 1;
    if (near) {
      out += near;
      continue;
    }
    const base = char.normalize("NFD").replace(/\p{M}/gu, "");
    if (base && canEncode(base)) {
      out += base;
    } else if (!/\p{M}/u.test(char)) {
      out += "?";
    }
  }
  return { text: out, replaced };
}

/** Replaces tabs with spaces up to the next multiple of four columns. */
const expandTabs = (text: string) =>
  text.includes("\t")
    ? text
        .split("\n")
        .map((line) => {
          let out = "";
          for (const char of line) {
            out += char === "\t" ? " ".repeat(4 - (out.length % 4)) : char;
          }
          return out;
        })
        .join("\n")
    : text;

// ---------------------------------------------------------------------------
// Inline Markdown
// ---------------------------------------------------------------------------

type InlineStyle = Pick<TextRun, "bold" | "italic" | "code" | "strike">;

const ESCAPABLE = /[!-/:-@[-`{-~]/;
const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char);
const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);

const countRun = (src: string, at: number, char: string) => {
  let end = at;
  while (src[end] === char) end++;
  return end - at;
};

/** Index of the backtick run that closes a code span, or -1. */
const findCodeClose = (src: string, from: number, length: number) => {
  for (let j = from; j < src.length; j++) {
    if (src[j] !== "`") continue;
    const run = countRun(src, j, "`");
    if (run === length) return j;
    j += run - 1;
  }
  return -1;
};

/** Finds the bracket that closes the one at `open`, skipping escapes and code. */
const findBracketClose = (src: string, open: number, openChar: string, closeChar: string) => {
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    const char = src[j];
    if (char === "\\") {
      j++;
    } else if (char === "`") {
      const run = countRun(src, j, "`");
      const close = findCodeClose(src, j + run, run);
      j = close >= 0 ? close + run - 1 : j + run - 1;
    } else if (char === openChar) {
      depth++;
    } else if (char === closeChar) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
};

/** `[text](target)` starting at `open`; links keep only their text. */
const parseLinkAt = (src: string, open: number) => {
  const close = findBracketClose(src, open, "[", "]");
  if (close < 0 || src[close + 1] !== "(") return null;
  const end = findBracketClose(src, close + 1, "(", ")");
  if (end < 0) return null;
  return { text: src.slice(open + 1, close), end: end + 1 };
};

/** Finds a closing emphasis delimiter of exactly `length` characters. */
const findEmphasisClose = (src: string, from: number, char: string, length: number) => {
  for (let j = from; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === "`") {
      const run = countRun(src, j, "`");
      const close = findCodeClose(src, j + run, run);
      j = close >= 0 ? close + run - 1 : j + run - 1;
      continue;
    }
    if (c !== char) continue;
    const run = countRun(src, j, char);
    if (
      run === length &&
      j > from &&
      !isSpace(src[j - 1]) &&
      (char !== "_" || !isWordChar(src[j + run]))
    ) {
      return j;
    }
    j += run - 1;
  }
  return -1;
};

const INLINE_PATTERNS = {
  autolink: /^<((?:https?|ftp|mailto):[^\s<>]+)>/i,
  email: /^<([^\s<>@]+@[^\s<>]+)>/,
  br: /^<br\s*\/?>/i,
  comment: /^<!--[\s\S]*?-->/,
  tag: /^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/,
};

function parseInto(src: string, style: InlineStyle, out: TextRun[]): void {
  let buf = "";
  const flush = () => {
    if (buf) out.push({ text: buf, ...style });
    buf = "";
  };
  const lineBreak = () => {
    flush();
    out.push({ text: "", br: true });
  };

  let i = 0;
  while (i < src.length) {
    const char = src[i];

    if (char === "\\") {
      const next = src[i + 1];
      if (next === "\n") {
        lineBreak();
        i += 2;
        continue;
      }
      if (next !== undefined && ESCAPABLE.test(next)) {
        buf += next;
        i += 2;
        continue;
      }
    } else if (char === "\n") {
      // Two trailing spaces force a break; otherwise a newline is a space.
      if (/ {2,}$/.test(buf)) {
        buf = buf.replace(/ +$/, "");
        lineBreak();
      } else {
        buf = `${buf.replace(/ +$/, "")} `;
      }
      i++;
      while (src[i] === " ") i++;
      continue;
    } else if (char === "`") {
      const run = countRun(src, i, "`");
      const close = findCodeClose(src, i + run, run);
      if (close >= 0) {
        flush();
        let code = src.slice(i + run, close).replace(/\n/g, " ");
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) {
          code = code.slice(1, -1);
        }
        out.push({ text: code, ...style, code: true });
        i = close + run;
        continue;
      }
      buf += src.slice(i, i + run);
      i += run;
      continue;
    } else if (char === "!" && src[i + 1] === "[") {
      const image = parseLinkAt(src, i + 1);
      if (image) {
        flush();
        const alt = image.text.replace(/\s+/g, " ").trim();
        out.push({ text: alt ? `[${alt}]` : "[Image]", ...style, italic: true });
        i = image.end;
        continue;
      }
    } else if (char === "[") {
      const link = parseLinkAt(src, i);
      if (link) {
        flush();
        parseInto(link.text, style, out);
        i = link.end;
        continue;
      }
    } else if (char === "<") {
      const rest = src.slice(i);
      const auto = INLINE_PATTERNS.autolink.exec(rest) ?? INLINE_PATTERNS.email.exec(rest);
      if (auto) {
        buf += auto[1].replace(/^mailto:/i, "");
        i += auto[0].length;
        continue;
      }
      const br = INLINE_PATTERNS.br.exec(rest);
      if (br) {
        lineBreak();
        i += br[0].length;
        continue;
      }
      // Inline HTML is not drawn; the text between tags is kept.
      const skip = INLINE_PATTERNS.comment.exec(rest) ?? INLINE_PATTERNS.tag.exec(rest);
      if (skip) {
        i += skip[0].length;
        continue;
      }
    } else if (char === "*" || char === "_" || char === "~") {
      const run = countRun(src, i, char);
      const usable = char === "~" ? run === 2 : run <= 3;
      const canOpen = usable && !isSpace(src[i + run]) && (char !== "_" || !isWordChar(src[i - 1]));
      const close = canOpen ? findEmphasisClose(src, i + run, char, run) : -1;
      if (close >= 0) {
        flush();
        const inner: InlineStyle =
          char === "~"
            ? { ...style, strike: true }
            : run === 3
              ? { ...style, bold: true, italic: true }
              : run === 2
                ? { ...style, bold: true }
                : { ...style, italic: true };
        parseInto(src.slice(i + run, close), inner, out);
        i = close + run;
        continue;
      }
      buf += src.slice(i, i + run);
      i += run;
      continue;
    }

    buf += char;
    i++;
  }
  flush();
}

const sameStyle = (a: TextRun, b: TextRun) =>
  !a.br &&
  !b.br &&
  !!a.bold === !!b.bold &&
  !!a.italic === !!b.italic &&
  !!a.code === !!b.code &&
  !!a.strike === !!b.strike;

/** Parses one paragraph's worth of inline Markdown into styled runs. */
export function parseInline(src: string): TextRun[] {
  const runs: TextRun[] = [];
  parseInto(src, {}, runs);
  const merged: TextRun[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && sameStyle(last, run)) {
      last.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Block Markdown
// ---------------------------------------------------------------------------

const BLOCK = {
  pageMarker: /^\s*<!--\s*(?:page|slide)\b[^>]*-->\s*$/i,
  commentLine: /^\s*<!--[\s\S]*-->\s*$/,
  commentOpen: /^\s*<!--/,
  fence: /^( {0,3})(`{3,}|~{3,})(.*)$/,
  heading: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/,
  rule: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
  quote: /^ {0,3}>[ \t]?(.*)$/,
  listItem: /^( *)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/,
  setext: /^ {0,3}(=+|-+)[ \t]*$/,
  tableDelimiter: /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/,
  indentedCode: /^ {4,}\S/,
};

const leadingSpaces = (line: string) => line.length - line.trimStart().length;

const isTableStart = (lines: string[], i: number) =>
  lines[i].includes("|") &&
  i + 1 < lines.length &&
  lines[i + 1].includes("|") &&
  BLOCK.tableDelimiter.test(lines[i + 1]);

/** Whether a line begins a block that can interrupt a paragraph. */
const startsBlock = (lines: string[], i: number) => {
  const line = lines[i];
  return (
    BLOCK.pageMarker.test(line) ||
    BLOCK.fence.test(line) ||
    BLOCK.heading.test(line) ||
    BLOCK.rule.test(line) ||
    BLOCK.quote.test(line) ||
    BLOCK.listItem.test(line) ||
    isTableStart(lines, i)
  );
};

/** Splits a table row on unescaped pipes outside code spans. */
export function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\\" && text[i + 1] === "|") {
      // Keep the escape so the inline parser turns it into a literal pipe.
      cell += "\\|";
      i++;
    } else if (char === "`") {
      const run = countRun(text, i, "`");
      const close = findCodeClose(text, i + run, run);
      const end = close >= 0 ? close + run : i + run;
      cell += text.slice(i, end);
      i = end - 1;
    } else if (char === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function parseTable(lines: string[], start: number): { block: MarkdownBlock; next: number } {
  const header = splitTableRow(lines[start]);
  const align = splitTableRow(lines[start + 1]).map((spec): TableAlign => {
    const left = spec.startsWith(":");
    const right = spec.endsWith(":");
    return left && right ? "center" : right ? "right" : "left";
  });
  const width = header.length;
  // Rows are padded or cut to the header's width, as GFM does.
  const toCells = (cells: string[]) =>
    Array.from({ length: width }, (_, index) => parseInline(cells[index] ?? ""));
  const rows: TextRun[][][] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
    rows.push(toCells(splitTableRow(lines[i])));
    i++;
  }
  return {
    block: {
      type: "table",
      header: toCells(header),
      rows,
      align: Array.from({ length: width }, (_, index) => align[index] ?? "left"),
    },
    next: i,
  };
}

function parseList(lines: string[], start: number): { block: MarkdownBlock; next: number } {
  const first = BLOCK.listItem.exec(lines[start]) as RegExpExecArray;
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const isSibling = (match: RegExpExecArray | null, line: string) =>
    !!match && leadingSpaces(line) < indent + 2 && /\d/.test(match[2]) === ordered;

  const items: string[][] = [];
  let current: string[] = [];
  let contentOffset = 0;
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // A blank line ends the list unless more of it follows.
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (
        j < lines.length &&
        (leadingSpaces(lines[j]) >= indent + 2 ||
          isSibling(BLOCK.listItem.exec(lines[j]), lines[j]))
      ) {
        current.push("");
        i++;
        continue;
      }
      break;
    }
    const match = BLOCK.listItem.exec(line);
    const lineIndent = leadingSpaces(line);
    if (match && isSibling(match, line) && !BLOCK.rule.test(line)) {
      const gap = match[3]?.length ?? 1;
      contentOffset = lineIndent + match[2].length + (gap > 4 ? 1 : gap);
      current = [match[4] ?? ""];
      items.push(current);
      i++;
      continue;
    }
    if (lineIndent >= indent + 2) {
      current.push(line.slice(Math.min(lineIndent, contentOffset)));
      i++;
      continue;
    }
    // A wrapped line of the item's paragraph that was not indented.
    if (current[current.length - 1]?.trim() && !startsBlock(lines, i)) {
      current.push(line.trim());
      i++;
      continue;
    }
    break;
  }

  return {
    block: {
      type: "list",
      ordered,
      start: ordered ? Number.parseInt(first[2], 10) : 1,
      items: items.map((itemLines) => parseBlockLines(itemLines)),
    },
    next: i,
  };
}

function parseBlockLines(lines: string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    if (BLOCK.pageMarker.test(line)) {
      blocks.push({ type: "pageBreak" });
      i++;
      continue;
    }
    if (BLOCK.commentLine.test(line)) {
      i++;
      continue;
    }
    if (BLOCK.commentOpen.test(line)) {
      while (i < lines.length && !lines[i].includes("-->")) i++;
      i++;
      continue;
    }

    const fence = BLOCK.fence.exec(line);
    if (fence && !(fence[2][0] === "`" && fence[3].includes("`"))) {
      const [, fenceIndent, marker] = fence;
      const closing = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
      const code: string[] = [];
      i++;
      while (i < lines.length && !closing.test(lines[i])) {
        const codeLine = lines[i];
        code.push(codeLine.slice(Math.min(fenceIndent.length, leadingSpaces(codeLine))));
        i++;
      }
      i++;
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }

    const heading = BLOCK.heading.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        runs: parseInline(heading[2] ?? ""),
      });
      i++;
      continue;
    }

    if (BLOCK.rule.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }

    if (BLOCK.quote.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && lines[i].trim()) {
        const quoted = BLOCK.quote.exec(lines[i]);
        if (quoted) {
          inner.push(quoted[1]);
        } else if (inner[inner.length - 1]?.trim() && !startsBlock(lines, i)) {
          inner.push(lines[i]);
        } else {
          break;
        }
        i++;
      }
      blocks.push({ type: "quote", blocks: parseBlockLines(inner) });
      continue;
    }

    if (BLOCK.listItem.test(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    if (isTableStart(lines, i)) {
      const { block, next } = parseTable(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    if (BLOCK.indentedCode.test(line)) {
      const code: string[] = [];
      while (i < lines.length && (BLOCK.indentedCode.test(lines[i]) || !lines[i].trim())) {
        code.push(lines[i].slice(4));
        i++;
      }
      while (code.length && !code[code.length - 1].trim()) code.pop();
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }

    // Paragraph, possibly turned into a heading by an underline.
    const text: string[] = [line];
    i++;
    let level = 0;
    while (i < lines.length && lines[i].trim()) {
      const underline = BLOCK.setext.exec(lines[i]);
      if (underline) {
        level = underline[1][0] === "=" ? 1 : 2;
        i++;
        break;
      }
      if (startsBlock(lines, i)) break;
      text.push(lines[i]);
      i++;
    }
    const runs = parseInline(text.map((part) => part.trimStart()).join("\n"));
    blocks.push(level ? { type: "heading", level, runs } : { type: "paragraph", runs });
  }
  return blocks;
}

const normalizeNewlines = (text: string) => text.replace(/\r\n?/g, "\n");

/** Parses Markdown into blocks. Form feeds and `<!-- Page N -->` lines become page breaks. */
export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const text = expandTabs(normalizeNewlines(markdown)).replace(/\f/g, "\n<!-- Page -->\n");
  return parseBlockLines(text.split("\n"));
}

/** Plain text: blank lines split paragraphs, every line break and space is kept. */
export function parsePlainText(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const pages = expandTabs(normalizeNewlines(text)).split("\f");
  pages.forEach((page, index) => {
    if (index > 0) blocks.push({ type: "pageBreak" });
    for (const paragraph of page.split(/\n[ \t]*\n/)) {
      if (!paragraph.trim()) continue;
      const runs: TextRun[] = [];
      paragraph
        .replace(/^\n+|\n+$/g, "")
        .split("\n")
        .forEach((line, lineIndex) => {
          if (lineIndex > 0) runs.push({ text: "", br: true });
          if (line) runs.push({ text: line.trimEnd() });
        });
      blocks.push({ type: "paragraph", runs, preserveSpaces: true });
    }
  });
  return blocks;
}

/** The most columns any pipe table in the Markdown has (0 when there is none). */
export function maxTableColumns(markdown: string): number {
  const lines = normalizeNewlines(markdown).split("\n");
  let max = 0;
  for (let i = 0; i + 1 < lines.length; i++) {
    if (isTableStart(lines, i)) max = Math.max(max, splitTableRow(lines[i]).length);
  }
  return max;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

interface Fonts {
  regular: PdfFont;
  bold: PdfFont;
  italic: PdfFont;
  boldItalic: PdfFont;
  mono: PdfFont;
  monoBold: PdfFont;
}

interface Segment {
  text: string;
  font: PdfFont;
  strike?: boolean;
}

interface Line {
  segments: Segment[];
  width: number;
}

const COLORS = {
  text: rgb(0.11, 0.12, 0.15),
  muted: rgb(0.38, 0.4, 0.45),
  rule: rgb(0.78, 0.8, 0.84),
  codeBg: rgb(0.95, 0.96, 0.97),
  headerBg: rgb(0.92, 0.94, 0.96),
  quoteBar: rgb(0.74, 0.77, 0.82),
};

const HEADING_SCALE = [0, 1.9, 1.55, 1.3, 1.15, 1, 0.95];
const BULLETS = ["•", "–"];
const TABLE_PAD_X = 4;
const TABLE_PAD_Y = 3;
const MIN_TABLE_FONT = 7;
const MIN_COLUMN_WIDTH = 24;
const MAX_WORD_WIDTH = 90;
// Long jobs hand control back to the page this often, so it stays responsive.
const YIELD_EVERY_MS = 40;

const fontCache = new WeakMap<PdfDoc, Promise<Fonts>>();

function embedFonts(doc: PdfDoc): Promise<Fonts> {
  let fonts = fontCache.get(doc);
  if (!fonts) {
    fonts = (async () => {
      const [regular, bold, italic, boldItalic, mono, monoBold] = await Promise.all([
        doc.embedFont(StandardFonts.Helvetica),
        doc.embedFont(StandardFonts.HelveticaBold),
        doc.embedFont(StandardFonts.HelveticaOblique),
        doc.embedFont(StandardFonts.HelveticaBoldOblique),
        doc.embedFont(StandardFonts.Courier),
        doc.embedFont(StandardFonts.CourierBold),
      ]);
      return { regular, bold, italic, boldItalic, mono, monoBold };
    })();
    fontCache.set(doc, fonts);
  }
  return fonts;
}

const pickFont = (fonts: Fonts, run: TextRun, forceBold: boolean) => {
  const bold = forceBold || !!run.bold;
  if (run.code) return bold ? fonts.monoBold : fonts.mono;
  if (bold && run.italic) return fonts.boldItalic;
  if (bold) return fonts.bold;
  return run.italic ? fonts.italic : fonts.regular;
};

interface LayoutOptions {
  width: number;
  size: number;
  fonts: Fonts;
  bold?: boolean;
  preserveSpaces?: boolean;
}

/** Breaks styled runs into lines no wider than `width`. */
function layoutRuns(runs: TextRun[], options: LayoutOptions): Line[] {
  const { width: maxWidth, size, fonts, bold = false, preserveSpaces = false } = options;
  // A hair of slack so text measured to fit exactly is not wrapped by rounding.
  const limit = maxWidth + 0.01;
  const lines: Line[] = [];
  let segments: Segment[] = [];
  let lineWidth = 0;
  let pendingSpace: Segment | null = null;
  let atHardLineStart = true;
  let word: Segment[] = [];
  let wordWidth = 0;

  const measure = (segment: Segment) => segment.font.widthOfTextAtSize(segment.text, size);
  const append = (segment: Segment) => {
    const last = segments[segments.length - 1];
    if (last && last.font === segment.font && !!last.strike === !!segment.strike) {
      last.text += segment.text;
    } else {
      segments.push({ ...segment });
    }
    lineWidth += measure(segment);
  };
  const pushLine = () => {
    lines.push({ segments, width: lineWidth });
    segments = [];
    lineWidth = 0;
  };
  const placeWord = () => {
    if (!word.length) return;
    const space = pendingSpace;
    pendingSpace = null;
    const spaceWidth = space ? measure(space) : 0;
    if (segments.length && lineWidth + spaceWidth + wordWidth > limit) {
      pushLine();
    } else if (space && (segments.length || (preserveSpaces && atHardLineStart))) {
      append(space);
    }
    atHardLineStart = false;
    if (wordWidth <= limit - lineWidth) {
      word.forEach(append);
    } else {
      // A word wider than the line is split between characters.
      for (const segment of word) {
        for (const char of segment.text) {
          const piece = { ...segment, text: char };
          if (segments.length && lineWidth + measure(piece) > limit) pushLine();
          append(piece);
        }
      }
    }
    word = [];
    wordWidth = 0;
  };

  for (const run of runs) {
    if (run.br) {
      placeWord();
      pushLine();
      pendingSpace = null;
      atHardLineStart = true;
      continue;
    }
    const font = pickFont(fonts, run, bold);
    for (const piece of run.text.split(/(\s+)/)) {
      if (!piece) continue;
      if (/^\s+$/.test(piece)) {
        placeWord();
        // Spaces can end one run and start the next; one gap is enough.
        if (!pendingSpace) {
          pendingSpace = { text: preserveSpaces ? piece : " ", font, strike: run.strike };
        }
        continue;
      }
      const segment = { text: piece, font, strike: run.strike };
      word.push(segment);
      wordWidth += measure(segment);
    }
  }
  placeWord();
  if (segments.length || !lines.length) pushLine();
  return lines;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

interface Marker {
  text: string;
  right: number;
  font: PdfFont;
  size: number;
}

class PageWriter {
  page: PdfPage | null = null;
  y = 0;
  pageHasContent = false;
  /** Set by a page break; the page is only added once something follows. */
  breakPending = false;
  readonly pages: PdfPage[] = [];
  marker: Marker | null = null;
  private pageFont: PdfFont | null = null;
  private lastYield = Date.now();

  constructor(
    readonly doc: PdfDoc,
    readonly fonts: Fonts,
    readonly pageSize: [number, number],
    readonly margins: PageMargins,
    readonly size: number,
    readonly newPageAtHeadingLevel: number,
  ) {}

  get bottom() {
    return this.margins.bottom;
  }

  get top() {
    return this.pageSize[1] - this.margins.top;
  }

  get contentWidth() {
    return this.pageSize[0] - this.margins.left - this.margins.right;
  }

  newPage() {
    this.page = this.doc.addPage([...this.pageSize]);
    this.pages.push(this.page);
    this.pageFont = null;
    this.y = this.top;
    this.pageHasContent = false;
    this.breakPending = false;
  }

  /** Asks for a new page before the next thing drawn, unless this one is empty. */
  breakPage() {
    if (this.pageHasContent) this.breakPending = true;
  }

  /**
   * Draws text on the current page. Passing `font` to pdf-lib's drawText adds
   * a new font resource on every call, so the font is set only when it changes.
   */
  text(text: string, x: number, y: number, size: number, font: PdfFont, color: Color) {
    const page = this.page as PdfPage;
    if (this.pageFont !== font) {
      page.setFont(font);
      this.pageFont = font;
    }
    page.drawText(text, { x, y, size, color });
  }

  /** Starts a new page unless `height` still fits on this one. */
  ensureSpace(height: number) {
    if (this.breakPending || (this.pageHasContent && this.y - height < this.bottom)) {
      this.newPage();
    }
  }

  /** Moves down before a block, but never past the top of a fresh page. */
  gap(height: number) {
    if (this.pageHasContent && !this.breakPending) this.y -= height;
  }

  async maybeYield() {
    if (Date.now() - this.lastYield < YIELD_EVERY_MS) return;
    await yieldToMain();
    this.lastYield = Date.now();
  }

  /** Draws the list marker waiting for the first line of its item. */
  drawMarker(baseline: number) {
    const marker = this.marker;
    if (!marker) return;
    this.marker = null;
    const width = marker.font.widthOfTextAtSize(marker.text, marker.size);
    this.text(marker.text, marker.right - width, baseline, marker.size, marker.font, COLORS.text);
  }

  drawLine(line: Line, x: number, baseline: number, size: number, color: Color) {
    const page = this.page as PdfPage;
    let cursor = x;
    for (const segment of line.segments) {
      const width = segment.font.widthOfTextAtSize(segment.text, size);
      if (segment.text.trim()) {
        this.text(segment.text, cursor, baseline, size, segment.font, color);
      }
      if (segment.strike) {
        const middle = baseline + size * 0.3;
        page.drawLine({
          start: { x: cursor, y: middle },
          end: { x: cursor + width, y: middle },
          thickness: Math.max(0.5, size / 16),
          color,
        });
      }
      cursor += width;
    }
  }

  /** Draws wrapped lines, moving to new pages as needed. */
  drawLines(lines: Line[], x: number, size: number, lineHeight: number, color: Color) {
    for (const line of lines) {
      this.ensureSpace(lineHeight);
      const baseline = this.y - size;
      this.drawMarker(baseline);
      this.drawLine(line, x, baseline, size, color);
      this.y -= lineHeight;
      this.pageHasContent = true;
    }
  }
}

interface BlockContext {
  x: number;
  width: number;
  listDepth: number;
  color: Color;
}

function renderHeading(
  writer: PageWriter,
  block: Extract<MarkdownBlock, { type: "heading" }>,
  ctx: BlockContext,
) {
  if (block.level <= writer.newPageAtHeadingLevel) writer.breakPage();
  const size = writer.size * HEADING_SCALE[block.level];
  const lineHeight = size * 1.25;
  const lines = layoutRuns(block.runs, { width: ctx.width, size, fonts: writer.fonts, bold: true });
  writer.gap(size * 0.7);
  // Keep a heading with the first lines that follow it.
  writer.ensureSpace(lines.length * lineHeight + writer.size * 2.8);
  const color = block.level === 6 ? COLORS.muted : ctx.color;
  writer.drawLines(lines, ctx.x, size, lineHeight, color);
  writer.y -= size * 0.35;
}

function renderCode(writer: PageWriter, text: string, ctx: BlockContext) {
  const size = writer.size * 0.85;
  const lineHeight = size * 1.35;
  const pad = 6;
  const lines = text.split("\n").flatMap((codeLine) =>
    layoutRuns([{ text: codeLine, code: true }], {
      width: ctx.width - pad * 2,
      size,
      fonts: writer.fonts,
      preserveSpaces: true,
    }),
  );
  writer.gap(writer.size * 0.3);
  let index = 0;
  while (index < lines.length) {
    writer.ensureSpace(lineHeight + pad * 2);
    const fit = Math.max(1, Math.floor((writer.y - writer.bottom - pad * 2) / lineHeight));
    const chunk = lines.slice(index, index + fit);
    const height = chunk.length * lineHeight + pad * 2;
    const page = writer.page as PdfPage;
    page.drawRectangle({
      x: ctx.x,
      y: writer.y - height,
      width: ctx.width,
      height,
      color: COLORS.codeBg,
    });
    writer.drawMarker(writer.y - pad - size);
    chunk.forEach((line, lineIndex) => {
      const baseline = writer.y - pad - size - lineIndex * lineHeight;
      writer.drawLine(line, ctx.x + pad, baseline, size, ctx.color);
    });
    writer.y -= height;
    writer.pageHasContent = true;
    index += chunk.length;
  }
  writer.y -= writer.size * 0.7;
}

function renderRule(writer: PageWriter, ctx: BlockContext) {
  writer.gap(writer.size * 0.6);
  writer.ensureSpace(writer.size);
  const y = writer.y - writer.size * 0.3;
  (writer.page as PdfPage).drawLine({
    start: { x: ctx.x, y },
    end: { x: ctx.x + ctx.width, y },
    thickness: 0.75,
    color: COLORS.rule,
  });
  writer.y -= writer.size * 1.2;
  writer.pageHasContent = true;
}

async function renderQuote(writer: PageWriter, blocks: MarkdownBlock[], ctx: BlockContext) {
  const inset = 14;
  writer.ensureSpace(writer.size * 1.4);
  const firstPage = writer.pages.length - 1;
  let top = writer.y;
  await renderBlocks(writer, blocks, {
    ...ctx,
    x: ctx.x + inset,
    width: ctx.width - inset,
    color: COLORS.muted,
  });
  // The bar is drawn per page once the quote's extent on that page is known.
  const lastPage = writer.pages.length - 1;
  for (let index = firstPage; index <= lastPage; index++) {
    const page = writer.pages[index];
    const bottom = index === lastPage ? writer.y + writer.size * 0.5 : writer.bottom;
    if (top > bottom) {
      page.drawRectangle({
        x: ctx.x + 2,
        y: bottom,
        width: 2.5,
        height: top - bottom,
        color: COLORS.quoteBar,
      });
    }
    top = writer.top;
  }
}

async function renderList(
  writer: PageWriter,
  block: Extract<MarkdownBlock, { type: "list" }>,
  ctx: BlockContext,
) {
  const indent = writer.size * 1.6;
  const itemCtx = {
    ...ctx,
    x: ctx.x + indent,
    width: ctx.width - indent,
    listDepth: ctx.listDepth + 1,
  };
  if (ctx.listDepth === 0) writer.gap(writer.size * 0.2);
  for (const [index, item] of block.items.entries()) {
    writer.marker = {
      text: block.ordered ? `${block.start + index}.` : BULLETS[ctx.listDepth % BULLETS.length],
      right: itemCtx.x - 5,
      font: writer.fonts.regular,
      size: writer.size,
    };
    if (item.length) {
      await renderBlocks(writer, item, itemCtx);
    }
    if (writer.marker) {
      // An empty item still shows its marker on a line of its own.
      writer.drawLines(
        layoutRuns([], { width: itemCtx.width, size: writer.size, fonts: writer.fonts }),
        itemCtx.x,
        writer.size,
        writer.size * 1.4,
        ctx.color,
      );
    }
  }
  if (ctx.listDepth === 0) writer.y -= writer.size * 0.5;
}

/** Table text shrinks as columns are added, down to a readable minimum. */
export function tableFontSize(baseSize: number, columns: number): number {
  return Math.max(MIN_TABLE_FONT, baseSize - 1 - Math.max(0, columns - 4) * 0.5);
}

interface ColumnMeasure {
  natural: number;
  min: number;
}

function measureColumns(
  table: Extract<MarkdownBlock, { type: "table" }>,
  fonts: Fonts,
  size: number,
): ColumnMeasure[] {
  return table.header.map((_, column) => {
    let natural = 0;
    let min = 0;
    const cells = [{ runs: table.header[column], bold: true }].concat(
      table.rows.map((row) => ({ runs: row[column], bold: false })),
    );
    for (const { runs, bold } of cells) {
      let lineWidth = 0;
      for (const run of runs) {
        if (run.br) {
          lineWidth = 0;
          continue;
        }
        const font = pickFont(fonts, run, bold);
        lineWidth += font.widthOfTextAtSize(run.text, size);
        natural = Math.max(natural, lineWidth);
        for (const word of run.text.split(/\s+/)) {
          min = Math.max(min, Math.min(MAX_WORD_WIDTH, font.widthOfTextAtSize(word, size)));
        }
      }
    }
    const pad = TABLE_PAD_X * 2;
    return {
      natural: Math.max(MIN_COLUMN_WIDTH, natural + pad),
      min: Math.max(MIN_COLUMN_WIDTH, min + pad),
    };
  });
}

/** Spreads the available width over columns: natural widths when they fit, else squeezed. */
function fitColumns(measures: ColumnMeasure[], available: number): number[] {
  const natural = measures.reduce((sum, m) => sum + m.natural, 0);
  if (natural <= available) return measures.map((m) => m.natural);
  const min = measures.reduce((sum, m) => sum + m.min, 0);
  const spare = Math.max(0, available - min);
  const stretch = natural - min;
  return measures.map((m) => m.min + (stretch > 0 ? ((m.natural - m.min) * spare) / stretch : 0));
}

/**
 * Splits columns into groups that each fit the page. Every group after the
 * first repeats column 1, which usually names the row.
 */
export function groupColumns(minWidths: number[], available: number): number[][] {
  const total = minWidths.reduce((sum, width) => sum + width, 0);
  if (total <= available) return [minWidths.map((_, index) => index)];
  const repeatKey = minWidths[0] <= available * 0.35;
  const groups: number[][] = [];
  let group: number[] = [];
  let width = 0;
  minWidths.forEach((columnWidth, index) => {
    if (group.length && width + columnWidth > available) {
      groups.push(group);
      group = repeatKey ? [0] : [];
      width = repeatKey ? minWidths[0] : 0;
    }
    group.push(index);
    width += columnWidth;
  });
  groups.push(group);
  return groups;
}

async function renderTable(
  writer: PageWriter,
  table: Extract<MarkdownBlock, { type: "table" }>,
  ctx: BlockContext,
) {
  const columns = table.header.length;
  const size = tableFontSize(writer.size, columns);
  const measures = measureColumns(table, writer.fonts, size);
  const groups = groupColumns(
    measures.map((m) => m.min),
    ctx.width,
  );
  writer.gap(writer.size * 0.3);
  for (const [groupIndex, group] of groups.entries()) {
    if (groups.length > 1) {
      // Later groups repeat column 1; the caption names the new columns only.
      const first = groupIndex > 0 && group[0] === 0 ? group[1] : group[0];
      const caption = `Columns ${first + 1}–${group[group.length - 1] + 1} of ${columns}`;
      writer.ensureSpace(size * 1.6 * 3);
      writer.drawLines(
        layoutRuns([{ text: caption, italic: true }], {
          width: ctx.width,
          size,
          fonts: writer.fonts,
        }),
        ctx.x,
        size,
        size * 1.6,
        COLORS.muted,
      );
    }
    await renderTableGroup(
      writer,
      table,
      group,
      fitColumns(
        group.map((c) => measures[c]),
        ctx.width,
      ),
      size,
      ctx,
    );
    writer.y -= writer.size * 0.8;
  }
}

async function renderTableGroup(
  writer: PageWriter,
  table: Extract<MarkdownBlock, { type: "table" }>,
  group: number[],
  widths: number[],
  size: number,
  ctx: BlockContext,
) {
  const { fonts } = writer;
  const lineHeight = size * 1.3;
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);
  const layoutCell = (runs: TextRun[], width: number, bold: boolean) =>
    layoutRuns(runs, { width: width - TABLE_PAD_X * 2, size, fonts, bold });
  const header = group.map((column, index) =>
    layoutCell(table.header[column], widths[index], true),
  );
  const headerLines = Math.max(...header.map((lines) => lines.length));
  const headerHeight = headerLines * lineHeight + TABLE_PAD_Y * 2;
  const pageRoom = writer.top - writer.bottom;
  let tableTop = 0;

  const drawCells = (cells: Line[][], from: number, count: number) => {
    let x = ctx.x;
    cells.forEach((lines, index) => {
      const align = table.align[group[index]];
      const inner = widths[index] - TABLE_PAD_X * 2;
      lines.slice(from, from + count).forEach((line, lineIndex) => {
        const offset =
          align === "right"
            ? inner - line.width
            : align === "center"
              ? (inner - line.width) / 2
              : 0;
        const baseline = writer.y - TABLE_PAD_Y - size - lineIndex * lineHeight + size * 0.15;
        writer.drawLine(line, x + TABLE_PAD_X + Math.max(0, offset), baseline, size, ctx.color);
      });
      x += widths[index];
    });
  };

  const closeColumns = () => {
    // Column lines are drawn once per page, from the table top to where it stopped.
    const page = writer.page as PdfPage;
    let x = ctx.x;
    for (let index = 0; index <= widths.length; index++) {
      page.drawLine({
        start: { x, y: tableTop },
        end: { x, y: writer.y },
        thickness: 0.5,
        color: COLORS.rule,
      });
      x += widths[index] ?? 0;
    }
  };

  const drawHeader = () => {
    const page = writer.page as PdfPage;
    tableTop = writer.y;
    const height = Math.min(headerHeight, writer.y - writer.bottom);
    page.drawRectangle({
      x: ctx.x,
      y: writer.y - height,
      width: tableWidth,
      height,
      color: COLORS.headerBg,
    });
    page.drawLine({
      start: { x: ctx.x, y: writer.y },
      end: { x: ctx.x + tableWidth, y: writer.y },
      thickness: 0.5,
      color: COLORS.rule,
    });
    drawCells(header, 0, headerLines);
    writer.y -= height;
    page.drawLine({
      start: { x: ctx.x, y: writer.y },
      end: { x: ctx.x + tableWidth, y: writer.y },
      thickness: 0.5,
      color: COLORS.rule,
    });
    writer.pageHasContent = true;
  };

  // Set while only the header is on the page, so a row taller than a whole
  // page is split instead of pushed to yet another page.
  let freshPage = false;
  const startPage = () => {
    closeColumns();
    writer.newPage();
    drawHeader();
    freshPage = true;
  };

  writer.ensureSpace(headerHeight + lineHeight + TABLE_PAD_Y * 2);
  writer.drawMarker(writer.y - TABLE_PAD_Y - size);
  drawHeader();

  for (const row of table.rows) {
    await writer.maybeYield();
    const cells = group.map((column, index) => layoutCell(row[column], widths[index], false));
    const rowLines = Math.max(...cells.map((lines) => lines.length));
    let done = 0;
    while (done < rowLines) {
      const room = Math.floor((writer.y - writer.bottom - TABLE_PAD_Y * 2) / lineHeight);
      const left = rowLines - done;
      const rowHeight = left * lineHeight + TABLE_PAD_Y * 2;
      // Move a row that fits on a fresh page rather than splitting it.
      const fitsFreshPage = rowHeight <= pageRoom - headerHeight;
      if (!freshPage && room < left && (room < 1 || (done === 0 && fitsFreshPage))) {
        startPage();
        continue;
      }
      freshPage = false;
      const count = Math.max(1, Math.min(room, left));
      drawCells(cells, done, count);
      writer.y -= count * lineHeight + TABLE_PAD_Y * 2;
      (writer.page as PdfPage).drawLine({
        start: { x: ctx.x, y: writer.y },
        end: { x: ctx.x + tableWidth, y: writer.y },
        thickness: 0.5,
        color: COLORS.rule,
      });
      done += count;
      if (done < rowLines) startPage();
    }
  }
  closeColumns();
}

async function renderBlocks(writer: PageWriter, blocks: MarkdownBlock[], ctx: BlockContext) {
  for (const block of blocks) {
    await writer.maybeYield();
    switch (block.type) {
      case "pageBreak":
        writer.breakPage();
        break;
      case "heading":
        renderHeading(writer, block, ctx);
        break;
      case "paragraph": {
        const lineHeight = writer.size * 1.4;
        const lines = layoutRuns(block.runs, {
          width: ctx.width,
          size: writer.size,
          fonts: writer.fonts,
          preserveSpaces: block.preserveSpaces,
        });
        writer.drawLines(lines, ctx.x, writer.size, lineHeight, ctx.color);
        writer.y -= writer.size * (ctx.listDepth > 0 ? 0.25 : 0.7);
        break;
      }
      case "list":
        await renderList(writer, block, ctx);
        break;
      case "quote":
        await renderQuote(writer, block.blocks, ctx);
        break;
      case "code":
        renderCode(writer, block.text, ctx);
        break;
      case "rule":
        renderRule(writer, ctx);
        break;
      case "table":
        await renderTable(writer, block, ctx);
        break;
    }
  }
}

/**
 * Draws Markdown (or plain text) onto new pages at the end of `doc`. Fonts
 * are embedded once per document, so many calls can share one PDF.
 */
export async function appendMarkdownPages(
  doc: PdfDoc,
  source: string,
  options: MarkdownPdfOptions = {},
): Promise<MarkdownPdfResult> {
  const pageSize = resolvePageSize(options.pageSize, options.orientation);
  const margins = resolveMargins(options.margins, pageSize);
  const size =
    options.fontSize && Number.isFinite(options.fontSize)
      ? Math.min(32, Math.max(6, options.fontSize))
      : DEFAULT_FONT_SIZE;
  const fonts = await embedFonts(doc);
  const safe = toWinAnsi(expandTabs(normalizeNewlines(source)));
  const title = options.title?.trim() ? toWinAnsi(options.title.trim()) : null;
  const blocks = options.plainText ? parsePlainText(safe.text) : parseMarkdown(safe.text);
  if (title) blocks.unshift({ type: "heading", level: 1, runs: [{ text: title.text }] });

  const writer = new PageWriter(
    doc,
    fonts,
    pageSize,
    margins,
    size,
    options.newPageAtHeadingLevel ?? 0,
  );
  writer.newPage();
  await renderBlocks(writer, blocks, {
    x: margins.left,
    width: writer.contentWidth,
    listDepth: 0,
    color: COLORS.text,
  });
  return {
    pageCount: writer.pages.length,
    replacedCharacters: safe.replaced + (title?.replaced ?? 0),
  };
}

/** Builds a standalone PDF from Markdown (or plain text). */
export async function markdownToPdf(
  source: string,
  options: MarkdownPdfOptions = {},
): Promise<MarkdownPdfResult & { bytes: Uint8Array }> {
  const doc = await PDFDocument.create();
  if (options.title?.trim()) doc.setTitle(options.title.trim());
  const result = await appendMarkdownPages(doc, source, options);
  return { ...result, bytes: await doc.save() };
}
