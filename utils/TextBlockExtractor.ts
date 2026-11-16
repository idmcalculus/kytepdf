/**
 * TextBlockExtractor - Extracts text content from PDF pages and groups it into
 * editable text blocks (paragraphs, headings, bullet points) with positional data.
 *
 * This enables "Word-like" editing of PDFs where each paragraph/block becomes
 * an independently editable text box.
 */

import { logger } from "./logger.ts";
import { yieldToMain } from "./taskScheduler.ts";

export interface TextSpan {
  text: string;
  fontSize: number;
  fontName: string;
  bold: boolean;
  italic: boolean;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Top and bottom of the glyphs (font ascent and descent), in editor px. */
  inkTop: number;
  inkBottom: number;
}

export interface TextLine {
  spans: TextSpan[];
  y: number;
  x: number;
  width: number;
  height: number;
  fontSize: number;
}

export interface TextBlock {
  pageIndex: number;
  lines: TextLine[];
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  bold: boolean;
  italic: boolean;
  color: string;
  textAlign: "left" | "center" | "right" | "justify";
  type: "paragraph" | "heading" | "bullet" | "date" | "address";
  content: string;
  richContent: string; // HTML formatted content
  lineHeight: number;
  /**
   * Where the block's glyphs are painted, one box per line, from the font's
   * ascent to its descent, in editor px and without padding. White these
   * out (with EXTRACTED_WHITEOUT_PADDING_PT around them) rather than the
   * block's box, so lines and borders next to the text survive.
   */
  glyphBoxes: Array<{ x: number; y: number; width: number; height: number }>;
}

export interface ExtractionResult {
  blocks: TextBlock[];
  pageWidth: number;
  pageHeight: number;
  scale: number;
  /**
   * Text items left out because they do not run left to right on the page as
   * shown (vertical labels, upside-down text). They stay part of the page.
   */
  angledTextCount: number;
}

/** pdf.js page viewport: maps PDF points to the page as shown (rotation, crop box). */
interface PageViewportLike {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): number[];
}

/** How far text may slope (rise over run) and still count as level. */
const MAX_TEXT_SLOPE = 0.05;

const TARGET_WIDTH = 800;
const LINE_THRESHOLD = 4; // Scaled points threshold for same line
/**
 * A gap this many font sizes wide between neighbouring text on one line
 * separates columns (table cells, side-by-side text), which become blocks
 * of their own. Word spaces, even in justified text, are much narrower.
 */
const COLUMN_GAP_EM = 1.5;
/**
 * How far ahead (in characters) a text item may be found in the painted
 * text before the match is treated as a miss rather than a skip.
 */
const PAINT_MATCH_WINDOW = 256;

// pdf.js operator codes (pdfjs-dist OPS).
const OPS_SAVE = 10;
const OPS_RESTORE = 11;
const OPS_SET_TEXT_RENDERING_MODE = 38;
const OPS_SHOW_TEXT = 44;
const OPS_SHOW_SPACED_TEXT = 45;
const OPS_NEXT_LINE_SHOW_TEXT = 46;
const OPS_NEXT_LINE_SET_SPACING_SHOW_TEXT = 47;
const OPS_SET_FILL_RGB_COLOR = 59;
const OPS_PAINT_FORM_XOBJECT_BEGIN = 74;
const OPS_PAINT_FORM_XOBJECT_END = 75;
const SHOW_TEXT_OPS = new Set([
  OPS_SHOW_TEXT,
  OPS_SHOW_SPACED_TEXT,
  OPS_NEXT_LINE_SHOW_TEXT,
  OPS_NEXT_LINE_SET_SPACING_SHOW_TEXT,
]);

/**
 * How the page's text is painted, read from the operator list: every
 * painted character (whitespace left out) in content-stream order, with the
 * fill colour and visibility of each UTF-16 unit.
 */
interface TextPaint {
  text: string;
  colors: string[];
  hidden: boolean[];
}

/** pdf.js's fill colour argument: "#rrggbb", or [r, g, b] (0-255) in older builds. */
function toHexColor(value: unknown, fallback: string): string {
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (Array.isArray(value) && value.length >= 3) {
    return `#${value
      .slice(0, 3)
      .map((channel) =>
        Math.max(0, Math.min(255, Math.round(Number(channel) || 0)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  }
  return fallback;
}

/** Text to match painted characters against text items: no whitespace, compatibility forms folded. */
const matchKey = (text: string) => text.normalize("NFKC").replace(/\s+/g, "");

export class TextBlockExtractor {
  /**
   * Extract text blocks from a single PDF page
   */
  async extractPage(pdfDoc: any, pageIndex: number): Promise<ExtractionResult> {
    const page = await pdfDoc.getPage(pageIndex + 1);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });
    const scale = TARGET_WIDTH / viewport.width;
    // The operator list has what the text content leaves out: fill colours
    // and invisible text. Loading it also puts the page's fonts in
    // commonObjs, whose real names tell bold and italic apart.
    const paint = await this.readTextPaint(page);

    // Positions come through the viewport, which pdf.js already sizes by the
    // page's /UserUnit; text sizes and widths are in PDF units, so they need it.
    const sizeScale = scale * (page.userUnit || 1);
    const { spans: rawSpans, angledTextCount } = this.extractSpans(
      textContent,
      viewport,
      scale,
      sizeScale,
      page.commonObjs,
      paint,
    );
    const spans = this.dedupeOverlaidSpans(rawSpans);
    const lines = this.groupIntoLines(spans, scale);
    const blocks = this.groupIntoBlocks(lines, pageIndex, viewport, scale);

    return {
      blocks,
      pageWidth: viewport.width * scale,
      pageHeight: viewport.height * scale,
      scale,
      angledTextCount,
    };
  }

  /**
   * Extract all pages from a PDF document
   */
  async extractAllPages(pdfDoc: any): Promise<ExtractionResult[]> {
    const results: ExtractionResult[] = [];
    const numPages = pdfDoc.numPages;

    for (let i = 0; i < numPages; i++) {
      try {
        const result = await this.extractPage(pdfDoc, i);
        results.push(result);
      } catch (err) {
        logger.warn(`Failed to extract page ${i}`, err);
        results.push({
          blocks: [],
          pageWidth: TARGET_WIDTH,
          pageHeight: 1100,
          scale: 1,
          angledTextCount: 0,
        });
      }

      if ((i + 1) % 2 === 0) {
        await yieldToMain();
      }
    }

    return results;
  }

  /**
   * Walk the page's operator list for the fill colour and text rendering
   * mode of every painted character. Mode 3 (and 7) paints nothing: it is
   * how scanned PDFs carry their OCR text, which must not become visible
   * text boxes. Returns null when the operator list is not available.
   */
  private async readTextPaint(page: any): Promise<TextPaint | null> {
    if (typeof page.getOperatorList !== "function") return null;
    let opList: any;
    try {
      opList = await page.getOperatorList();
    } catch (err) {
      logger.warn("Could not read the page's operator list; text keeps default colours", err);
      return null;
    }

    const paint: TextPaint = { text: "", colors: [], hidden: [] };
    const stack: Array<{ color: string; mode: number }> = [];
    let color = "#000000";
    let mode = 0;
    const fnArray: number[] = opList?.fnArray ?? [];
    const argsArray: any[] = opList?.argsArray ?? [];

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const args = argsArray[i];
      if (fn === OPS_SAVE || fn === OPS_PAINT_FORM_XOBJECT_BEGIN) {
        stack.push({ color, mode });
      } else if (fn === OPS_RESTORE || fn === OPS_PAINT_FORM_XOBJECT_END) {
        const saved = stack.pop();
        if (saved) ({ color, mode } = saved);
      } else if (fn === OPS_SET_FILL_RGB_COLOR) {
        color = toHexColor(args?.length === 1 ? args[0] : args, color);
      } else if (fn === OPS_SET_TEXT_RENDERING_MODE) {
        mode = Number(args?.[0]) || 0;
      } else if (SHOW_TEXT_OPS.has(fn)) {
        // Modes 3 and 7 are the invisible ones.
        const hidden = (mode & 3) === 3;
        for (const glyph of args?.[0] ?? []) {
          if (typeof glyph?.unicode !== "string") continue; // spacing numbers
          const chars = matchKey(glyph.unicode);
          paint.text += chars;
          for (let k = 0; k < chars.length; k++) {
            paint.colors.push(color);
            paint.hidden.push(hidden);
          }
        }
      }
    }

    return paint;
  }

  /** The font pdf.js loaded for a text item, if it has loaded. */
  private loadedFont(commonObjs: any, fontId: string): any {
    try {
      return commonObjs?.has?.(fontId) ? commonObjs.get(fontId) : null;
    } catch {
      return null;
    }
  }

  /**
   * Extract individual text spans from PDF text content.
   * Uses the actual item.width from pdf.js for accurate width measurement.
   * Positions are taken through the page viewport, so they match the page as
   * the editor shows it even when the page is rotated or its crop box does
   * not start at (0, 0).
   */
  private extractSpans(
    textContent: any,
    viewport: PageViewportLike,
    scale: number,
    sizeScale: number,
    commonObjs: any = null,
    paint: TextPaint | null = null,
  ): { spans: TextSpan[]; angledTextCount: number } {
    const spans: TextSpan[] = [];
    let angledTextCount = 0;
    // Text items come in content-stream order, as the painted characters do.
    let paintCursor = 0;

    for (const item of textContent.items) {
      if (!("transform" in item)) continue;

      // Find the item among the painted characters for its colour and
      // visibility, moving past it even when the item is left out below.
      const key = matchKey(item.str ?? "");
      let color = "#000000";
      let hidden = false;
      if (paint && key) {
        const at = paint.text.indexOf(key, paintCursor);
        if (at >= 0 && at - paintCursor <= PAINT_MATCH_WINDOW) {
          color = paint.colors[at];
          hidden = paint.hidden.slice(at, at + key.length).every(Boolean);
          paintCursor = at + key.length;
        }
      }

      // Whitespace-only items carry no text to edit, and invisible text
      // (the OCR layer of a scanned page) is not shown, so not edited.
      if (!item.str?.trim() || hidden) continue;

      const [a, b, c, d, e, f] = item.transform;
      // The text's height (its vertical scale), which holds for turned text too.
      const fontSize = Math.hypot(c, d) || Math.hypot(a, b) || 12;
      // pdf.js names fonts by an internal id ("g_d0_f1"); the loaded font
      // has the real name ("Helvetica-Bold", "ABCDEF+Arial-ItalicMT") and
      // flags, and the styles give the family it falls back to.
      const font = this.loadedFont(commonObjs, item.fontName);
      const realName = typeof font?.name === "string" ? font.name.replace(/^[A-Z]{6}\+/, "") : "";
      const style = textContent.styles?.[item.fontName];
      const fontName = [realName || item.fontName, style?.fontFamily].filter(Boolean).join(" ");
      const bold = Boolean(font?.bold || font?.black) || /bold|black|heavy|demi/i.test(fontName);
      const italic = Boolean(font?.italic) || /italic|oblique/i.test(fontName);
      // Glyph extent above and below the baseline, as shares of the size.
      const ascent =
        style?.ascent > 0 ? style.ascent : style?.descent < 0 ? 1 + style.descent : 0.8;
      const descent = style?.descent < 0 ? -style.descent : 0.2;

      // Where the baseline starts, and which way the text runs, on the page
      // as shown. Only text running left to right can become a text box.
      const [startX, startY] = viewport.convertToViewportPoint(e, f);
      const [aheadX, aheadY] = viewport.convertToViewportPoint(e + a, f + b);
      const runX = aheadX - startX;
      const runY = aheadY - startY;
      if (!(runX > 0 && Math.abs(runY) <= runX * MAX_TEXT_SLOPE)) {
        angledTextCount++;
        continue;
      }

      const domX = startX * scale;
      const domY = startY * scale;
      const scaledFontSize = fontSize * sizeScale;

      // Use actual width from pdf.js (it's in PDF units, so scale it)
      // item.width is the advance width of the text run
      const width = item.width ? item.width * sizeScale : item.str.length * scaledFontSize * 0.5;
      const height = scaledFontSize;

      spans.push({
        text: item.str,
        fontSize: scaledFontSize,
        fontName,
        bold,
        italic,
        color,
        x: domX,
        y: domY - height, // Top of text (domY is at baseline)
        width,
        height,
        inkTop: domY - ascent * scaledFontSize,
        inkBottom: domY + descent * scaledFontSize,
      });
    }

    return { spans, angledTextCount };
  }

  /**
   * Edited PDFs keep the original PDF text in the hidden text layer when we
   * white-out and redraw editable text. Remove duplicate spans at the same
   * visual location so reopening an edited PDF does not duplicate its text.
   */
  private dedupeOverlaidSpans(spans: TextSpan[]): TextSpan[] {
    const uniqueSpans: TextSpan[] = [];

    for (const span of spans) {
      const duplicate = uniqueSpans.some((existing) => {
        if (existing.text !== span.text) return false;

        const avgFontSize = (existing.fontSize + span.fontSize) / 2;
        const positionTolerance = Math.max(2, avgFontSize * 0.25);
        const lineTolerance = Math.max(3, avgFontSize * 0.5);
        const widthTolerance = Math.max(4, avgFontSize);

        return (
          Math.abs(existing.x - span.x) <= positionTolerance &&
          Math.abs(existing.y - span.y) <= lineTolerance &&
          Math.abs(existing.width - span.width) <= widthTolerance
        );
      });

      if (!duplicate) uniqueSpans.push(span);
    }

    return uniqueSpans;
  }

  /**
   * Group spans into lines based on y-proximity.
   * Uses a scaled threshold relative to font size.
   */
  private groupIntoLines(spans: TextSpan[], _scale: number): TextLine[] {
    if (spans.length === 0) return [];

    // Sort by Y (top to bottom), then X (left to right)
    const sorted = [...spans].sort((a, b) => a.y - b.y || a.x - b.x);
    const lines: TextLine[] = [];
    let currentLineSpans: TextSpan[] = [sorted[0]];
    let currentY = sorted[0].y;

    for (let i = 1; i < sorted.length; i++) {
      const span = sorted[i];
      // Use a threshold proportional to the font size of the current line
      const avgFontSize =
        currentLineSpans.reduce((s, sp) => s + sp.fontSize, 0) / currentLineSpans.length;
      const threshold = Math.max(LINE_THRESHOLD, avgFontSize * 0.4);

      if (Math.abs(span.y - currentY) <= threshold) {
        currentLineSpans.push(span);
      } else {
        for (const part of this.splitAtColumnGaps(currentLineSpans)) {
          lines.push(this.buildLine(part));
        }
        currentLineSpans = [span];
        currentY = span.y;
      }
    }

    for (const part of this.splitAtColumnGaps(currentLineSpans)) {
      lines.push(this.buildLine(part));
    }

    return lines;
  }

  /**
   * Split one row of text where neighbouring spans are further apart than
   * COLUMN_GAP_EM font sizes, so table cells and side-by-side columns stay
   * apart instead of being joined with a single space.
   */
  private splitAtColumnGaps(spans: TextSpan[]): TextSpan[][] {
    const sorted = [...spans].sort((a, b) => a.x - b.x);
    const parts: TextSpan[][] = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const gap = sorted[i].x - (prev.x + prev.width);
      if (gap > Math.max(prev.fontSize, sorted[i].fontSize) * COLUMN_GAP_EM) {
        parts.push([sorted[i]]);
      } else {
        parts[parts.length - 1].push(sorted[i]);
      }
    }
    return parts;
  }

  /**
   * Build a TextLine from a group of spans.
   * Inserts spaces between spans where there's a visible gap.
   */
  private buildLine(spans: TextSpan[]): TextLine {
    const sorted = [...spans].sort((a, b) => a.x - b.x);
    const x = Math.min(...sorted.map((s) => s.x));
    const maxRight = Math.max(...sorted.map((s) => s.x + s.width));
    const y = Math.min(...sorted.map((s) => s.y));
    const maxBottom = Math.max(...sorted.map((s) => s.y + s.height));
    const fontSize = sorted.reduce((sum, s) => sum + s.fontSize, 0) / sorted.length;

    // Merge spans that are adjacent and detect word spaces
    const mergedSpans = this.mergeSpansWithSpaces(sorted);

    return {
      spans: mergedSpans,
      x,
      y,
      width: maxRight - x,
      height: maxBottom - y,
      fontSize,
    };
  }

  /**
   * Merge adjacent spans and insert spaces where there's a gap.
   * This fixes the "20thDecember2022" problem by detecting word boundaries.
   */
  private mergeSpansWithSpaces(sortedSpans: TextSpan[]): TextSpan[] {
    if (sortedSpans.length === 0) return [];

    const result: TextSpan[] = [];

    for (let i = 0; i < sortedSpans.length; i++) {
      const current = sortedSpans[i];

      if (i > 0) {
        const prev = sortedSpans[i - 1];
        const prevEnd = prev.x + prev.width;
        const gap = current.x - prevEnd;
        const avgCharWidth = prev.fontSize * 0.3; // Approximate space width

        // If there's a gap larger than ~30% of a character width, it's a word space
        if (gap > avgCharWidth * 0.5) {
          // Check if previous span already ends with space or current starts with space
          const prevText = result.length > 0 ? result[result.length - 1].text : "";
          if (!prevText.endsWith(" ") && !current.text.startsWith(" ")) {
            // Insert a space by modifying the previous span's text
            if (result.length > 0) {
              result[result.length - 1] = {
                ...result[result.length - 1],
                text: `${result[result.length - 1].text} `,
                width: result[result.length - 1].width + gap,
              };
            }
          }
        }
      }

      result.push({ ...current });
    }

    return result;
  }

  /**
   * Group lines into blocks (paragraphs) based on vertical gaps and text properties
   */
  private groupIntoBlocks(
    lines: TextLine[],
    pageIndex: number,
    viewport: any,
    scale: number,
  ): TextBlock[] {
    if (lines.length === 0) return [];

    // Lines arrive top to bottom. Each joins the block whose last line sits
    // nearest above it in the same column (overlapping it across the page)
    // when no block break separates them, so columns and table cells
    // become blocks of their own.
    const groups: TextLine[][] = [];
    for (const line of lines) {
      let best: TextLine[] | null = null;
      for (const group of groups) {
        const last = group[group.length - 1];
        const overlaps = line.x < last.x + last.width && last.x < line.x + line.width;
        if (!overlaps || line.y <= last.y) continue;
        // Calculate gap between lines (bottom of prev to top of current)
        const gap = line.y - (last.y + last.height);
        const avgFontSize = (last.fontSize + line.fontSize) / 2;
        if (this.isBlockBreak(last, line, gap, avgFontSize)) continue;
        if (!best || last.y > best[best.length - 1].y) best = group;
      }
      if (best) best.push(line);
      else groups.push([line]);
    }

    return groups
      .map((group) => this.buildBlock(group, pageIndex, viewport, scale))
      .sort((a, b) => a.y - b.y || a.x - b.x);
  }

  /**
   * Determine if there should be a block break between two lines
   */
  private isBlockBreak(
    prevLine: TextLine,
    currentLine: TextLine,
    gap: number,
    avgFontSize: number,
  ): boolean {
    // Large vertical gap indicates paragraph break
    // Use a generous threshold: if gap > 80% of avg font size, it's a new block
    const gapThreshold = avgFontSize * 0.8;
    if (gap > gapThreshold) return true;

    // Significant font size change (heading -> body or vice versa)
    const sizeRatio = currentLine.fontSize / prevLine.fontSize;
    if (sizeRatio > 1.3 || sizeRatio < 0.7) return true;

    // Significant left-edge change (new indentation level)
    const xDiff = Math.abs(currentLine.x - prevLine.x);
    if (xDiff > avgFontSize * 2.5 && gap > avgFontSize * 0.2) return true;

    return false;
  }

  /**
   * Build a TextBlock from a group of lines.
   * Adds padding around the bounding box so the text box fully covers the canvas text.
   */
  private buildBlock(
    lines: TextLine[],
    pageIndex: number,
    viewport: any,
    scale: number,
  ): TextBlock {
    // Calculate raw bounding box
    const rawX = Math.min(...lines.map((l) => l.x));
    const rawY = Math.min(...lines.map((l) => l.y));
    const maxRight = Math.max(...lines.map((l) => l.x + l.width));
    const maxBottom = Math.max(...lines.map((l) => l.y + l.height));

    // Add padding to ensure full coverage of canvas text
    const padding = 2;
    const x = Math.max(0, rawX - padding);
    const y = Math.max(0, rawY - padding);
    const width = maxRight - rawX + padding * 2;
    const height = maxBottom - rawY + padding * 2;

    // Determine dominant text properties
    const allSpans = lines.flatMap((l) => l.spans);
    const fontSize = this.dominantFontSize(allSpans);
    const fontName = this.dominantFontName(allSpans);
    const bold = allSpans.filter((s) => s.bold).length > allSpans.length / 2;
    const italic = allSpans.filter((s) => s.italic).length > allSpans.length / 2;
    const color = this.dominantColor(allSpans);

    // Detect text alignment
    const pageWidth = viewport.width * scale;
    const textAlign = this.detectAlignment(lines, pageWidth);

    // Detect block type from the size in PDF points: the editor scale would
    // turn 12pt body text on an A4 page into 16.1px and make it a "heading".
    const type = this.detectBlockType(lines, fontSize / scale, bold);

    // Build plain content with proper spacing
    const content = this.buildPlainContent(lines);

    // Build rich HTML content preserving formatting
    const richContent = this.buildRichContent(lines, color);

    // Calculate line height from actual line positions
    let lineHeight = 1.4;
    if (lines.length > 1) {
      const lineGaps: number[] = [];
      for (let i = 1; i < lines.length; i++) {
        lineGaps.push(lines[i].y - lines[i - 1].y);
      }
      const avgGap = lineGaps.reduce((a, b) => a + b, 0) / lineGaps.length;
      lineHeight = avgGap / fontSize;
    }

    return {
      pageIndex,
      lines,
      x,
      y,
      width,
      height,
      fontSize,
      fontName,
      bold,
      italic,
      color,
      textAlign,
      type,
      content,
      richContent,
      lineHeight: Math.max(1.0, Math.min(2.5, lineHeight)),
      glyphBoxes: lines.map((line) => {
        const top = Math.min(...line.spans.map((s) => s.inkTop));
        const bottom = Math.max(...line.spans.map((s) => s.inkBottom));
        return { x: line.x, y: top, width: line.width, height: bottom - top };
      }),
    };
  }

  /**
   * Detect text alignment by analyzing line positions
   */
  private detectAlignment(
    lines: TextLine[],
    pageWidth: number,
  ): "left" | "center" | "right" | "justify" {
    if (lines.length < 2) return "left";

    const leftEdges = lines.map((l) => l.x);
    const rightEdges = lines.map((l) => l.x + l.width);
    const centers = lines.map((l) => l.x + l.width / 2);

    const leftVariance = this.variance(leftEdges);
    const rightVariance = this.variance(rightEdges);
    const centerVariance = this.variance(centers);

    // Check if text is centered on the page
    const avgCenter = centers.reduce((a, b) => a + b) / centers.length;
    const pageMid = pageWidth / 2;
    if (centerVariance < 20 && Math.abs(avgCenter - pageMid) < 50) {
      return "center";
    }

    // Check right alignment
    if (rightVariance < leftVariance * 0.5 && rightVariance < 20) {
      return "right";
    }

    // Check justify (both edges are relatively aligned across multiple lines)
    if (lines.length >= 3 && leftVariance < 10 && rightVariance < 50) {
      return "justify";
    }

    return "left";
  }

  /**
   * Detect block type from content characteristics
   */
  private detectBlockType(
    lines: TextLine[],
    pointSize: number,
    bold: boolean,
  ): "paragraph" | "heading" | "bullet" | "date" | "address" {
    const content = this.buildPlainContent(lines);

    // Check for date patterns
    if (/^\d{1,2}(st|nd|rd|th)?\s+\w+\s+\d{4}$/.test(content)) return "date";
    if (/^\w+\s+\d{1,2},?\s+\d{4}$/.test(content)) return "date";

    // Check for bullet points
    if (/^[•\-*\u2022\u2023\u25E6]\s/.test(content)) return "bullet";
    if (/^\d+[.)]\s/.test(content)) return "bullet";

    // Check for heading (bold, or larger than 16pt, and short text)
    if (bold && lines.length <= 2 && content.length < 100) return "heading";
    if (pointSize > 16 && lines.length <= 2 && content.length < 100) return "heading";

    // Check for address (multiple short lines, contains postal/location patterns)
    if (
      lines.length >= 2 &&
      lines.length <= 5 &&
      lines.every((l) => l.width < 400) &&
      /\d/.test(content)
    ) {
      const hasPostalPattern =
        /[A-Z]{1,2}\d{1,2}\s*\d[A-Z]{2}/.test(content) || /\d{5}(-\d{4})?/.test(content);
      if (hasPostalPattern) return "address";
    }

    return "paragraph";
  }

  /**
   * Build plain text content from lines with proper word spacing.
   * Each line's spans are joined with spaces detected by gap analysis.
   */
  private buildPlainContent(lines: TextLine[]): string {
    return lines
      .map((line) => {
        // Spans already have spaces inserted by mergeSpansWithSpaces
        return line.spans.map((s) => s.text).join("");
      })
      .join("\n");
  }

  /**
   * Build rich HTML content preserving bold/italic formatting, and the colour
   * of any span that differs from the block's.
   * Uses the space-aware span text from mergeSpansWithSpaces.
   */
  private buildRichContent(lines: TextLine[], blockColor: string): string {
    const lineHtmls: string[] = [];

    for (const line of lines) {
      const spanHtmls: string[] = [];

      for (const span of line.spans) {
        let text = this.escapeHtml(span.text);

        if (span.bold && span.italic) {
          text = `<b><i>${text}</i></b>`;
        } else if (span.bold) {
          text = `<b>${text}</b>`;
        } else if (span.italic) {
          text = `<i>${text}</i>`;
        }
        if (span.color !== blockColor) {
          text = `<span style="color:${span.color}">${text}</span>`;
        }

        spanHtmls.push(text);
      }

      lineHtmls.push(spanHtmls.join(""));
    }

    return lineHtmls.join("<br>");
  }

  /**
   * The most common font size in a set of spans. Sizes are grouped to the
   * nearest pixel to find it, but the group's real average is returned:
   * rounding a 21.6px heading up to 22px made it about 2% wider than its box,
   * so it wrapped in the editor and again when an edit was saved.
   */
  private dominantFontSize(spans: TextSpan[]): number {
    const groups = new Map<number, { chars: number; sizeTotal: number }>();
    for (const span of spans) {
      const key = Math.round(span.fontSize);
      const group = groups.get(key) ?? { chars: 0, sizeTotal: 0 };
      group.chars += span.text.length;
      group.sizeTotal += span.fontSize * span.text.length;
      groups.set(key, group);
    }

    let dominant: { chars: number; sizeTotal: number } | null = null;
    for (const group of groups.values()) {
      if (!dominant || group.chars > dominant.chars) dominant = group;
    }
    if (!dominant || dominant.chars === 0) return 12;
    return Math.round((dominant.sizeTotal / dominant.chars) * 100) / 100;
  }

  /** The colour that covers the most characters in a set of spans. */
  private dominantColor(spans: TextSpan[]): string {
    const colorFreq = new Map<string, number>();
    for (const span of spans) {
      colorFreq.set(span.color, (colorFreq.get(span.color) ?? 0) + span.text.length);
    }

    let maxCount = 0;
    let dominant = "#000000";
    for (const [color, count] of colorFreq) {
      if (count > maxCount) {
        maxCount = count;
        dominant = color;
      }
    }
    return dominant;
  }

  /**
   * Get the most common font name in a set of spans
   */
  private dominantFontName(spans: TextSpan[]): string {
    const nameFreq = new Map<string, number>();
    for (const span of spans) {
      const name = span.fontName || "Helvetica";
      nameFreq.set(name, (nameFreq.get(name) ?? 0) + span.text.length);
    }

    let maxCount = 0;
    let dominant = "Helvetica";
    for (const [name, count] of nameFreq) {
      if (count > maxCount) {
        maxCount = count;
        dominant = name;
      }
    }
    return dominant;
  }

  /**
   * Calculate variance of a set of numbers
   */
  private variance(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b) / values.length;
    return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

export const textBlockExtractor = new TextBlockExtractor();
