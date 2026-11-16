import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import * as XLSX from "xlsx";
import { logger } from "./logger.ts";
import type { AnalysisEnvelope } from "./pdfInspectorTypes.ts";
import { loadProcessablePdfJsDocument } from "./pdfSecurity.ts";
import { yieldToMain } from "./taskScheduler.ts";

export type ConversionQuality = "good" | "fair" | "poor";

export interface ConversionResult {
  success: boolean;
  data: Uint8Array | null;
  quality: ConversionQuality;
  warnings: string[];
}

type RichTextItem = {
  pageIndex: number;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontName: string;
};

type LineGroup = {
  y: number;
  items: RichTextItem[];
};

type DocxBlock = InstanceType<typeof Paragraph> | InstanceType<typeof Table>;

type RunStyle = {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  underline?: boolean;
  superScript?: boolean;
  subScript?: boolean;
};

type InlineSpan = { text: string; style: RunStyle };

type MarkdownTable = {
  /** 1-indexed page from the nearest `<!-- Page N -->` marker above, if any. */
  page: number | null;
  rows: string[][];
  /** True when a `|---|` delimiter row follows the first row. */
  hasHeader: boolean;
};

/** `<!-- Page N -->` markers that pdf-inspector puts between pages. */
const PAGE_MARKER_RE = /^<!--\s*Page\s+(\d+)\s*-->$/i;
/** Thematic breaks: three or more of -, * or _, optionally spaced. */
const RULE_RE = /^([-*_])(?:\s*\1){2,}$/;
/** Characters Markdown lets you escape with a backslash. */
const ESCAPED_RE = /\\([\\`*_{}[\]()#+\-.!|>~<])/g;
/** Placeholder for text that must stay literal while emphasis is parsed. */
const LITERAL_RE = /\uE000(\d+)\uE001/g;
/**
 * Emphasis (*, **, ***, _, __, ___) and ~~strike~~ that opens and closes at a
 * word edge, so "snake_case", "2*3*4" and "2 * 3" stay plain text; or one of
 * the inline tags pdf-inspector writes, opened and closed on one line:
 * <sup>, <sub>, <s> (struck through) and <u> (underlined). Other text that
 * looks like a tag, such as "<tag>" or "a < b", stays as written.
 */
const STYLED_RE =
  /(?<![\w*~])(\*{1,3}|_{1,3}|~~)(?=\S)(.+?)(?<=\S)\1(?![\w*~])|<(sup|sub|s|u)>(.*?)<\/\3>/g;
/** The run style each inline tag sets. */
const TAG_STYLES: Record<string, RunStyle> = {
  sup: { superScript: true },
  sub: { subScript: true },
  s: { strike: true },
  u: { underline: true },
};
/** A `<br>` line break, also written `<br/>` or `<br />`. */
const LINE_BREAK_RE = /<br ?\/?>/g;
const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];
/** One list or quote level of indent in Word, in twentieths of a point (0.5"). */
const INDENT_STEP = 720;

export class LocalConverter {
  private richExtractionCache = new WeakMap<
    Uint8Array,
    { items: RichTextItem[]; pageCount: number }
  >();

  async assessQuality(
    pdfBytes: Uint8Array,
    _targetFormat: "docx" | "xlsx" | "txt" | "md",
  ): Promise<ConversionQuality> {
    const { items, pageCount } = await this.extractRichTextItems(pdfBytes);
    return this.evaluateQuality(items.length, pageCount);
  }

  /**
   * Build a semantic Word document from a pdf-inspector analysis envelope.
   * When the envelope carries structured Markdown (headings, lists, bold),
   * the DOCX preserves those structures rather than collapsing everything
   * to flat paragraphs from raw text items. Falls back to the legacy
   * item-based path when the envelope has no Markdown.
   */
  async pdfToWordFromEnvelope(
    pdfBytes: Uint8Array,
    envelope: AnalysisEnvelope,
  ): Promise<ConversionResult> {
    try {
      const markdown = envelope.markdown?.trim();
      if (!markdown) {
        return this.pdfToWord(pdfBytes);
      }
      const warnings: string[] = [];
      if (envelope.hasEncodingIssues) {
        warnings.push("Source PDF reported encoding issues; some characters may be missing.");
      }
      if (envelope.pagesNeedingOcr.length > 0) {
        warnings.push(
          `Output excludes page${envelope.pagesNeedingOcr.length === 1 ? "" : "s"} ${envelope.pagesNeedingOcr.join(", ")} (OCR needed).`,
        );
      }

      const blocks = this.markdownToDocxBlocks(markdown);
      if (blocks.length === 0) {
        warnings.push("No extractable text found; output may be empty.");
      }

      const doc = new Document({
        sections: [
          {
            children: blocks,
          },
        ],
      });

      const blob = await Packer.toBlob(doc);
      const buffer = await blob.arrayBuffer();
      // Quality is now driven by the engine's confidence and structure, not
      // by raw text-item density.
      const quality = this.qualityFromEnvelope(envelope, "docx");
      return {
        success: true,
        data: new Uint8Array(buffer),
        quality,
        warnings,
      };
    } catch (err) {
      logger.error("Local PDF to Word (envelope) conversion failed", err);
      return {
        success: false,
        data: null,
        quality: "poor",
        warnings: ["Local conversion failed."],
      };
    }
  }

  /**
   * Build an XLSX from an analysis envelope. Each Markdown pipe table becomes
   * its own worksheet, named after its position and page ("Table 2 (p.3)"),
   * and the text around the tables goes to a "Text" sheet, one line per row.
   * With no tables, the text alone is written, so OCR output is never lost.
   */
  async pdfToExcelFromEnvelope(
    pdfBytes: Uint8Array,
    envelope: AnalysisEnvelope,
  ): Promise<ConversionResult> {
    try {
      const markdown = envelope.markdown?.trim();
      // pdf.js reads native text with its column layout; keep that path for
      // native PDFs with no tables. Scanned or image-based text exists only
      // in the envelope (often from OCR), which pdf.js cannot see.
      const textOnlyInEnvelope =
        envelope.pdfType === "Scanned" ||
        envelope.pdfType === "Mixed" ||
        envelope.pdfType === "ImageBased";
      if (!markdown || (envelope.layout.pagesWithTables.length === 0 && !textOnlyInEnvelope)) {
        return this.pdfToExcel(pdfBytes);
      }
      const warnings: string[] = [];
      const tables = this.markdownTables(markdown);
      const textRows = this.markdownTextRows(markdown);
      if (tables.length === 0 && textRows.length === 0) {
        return this.pdfToExcel(pdfBytes);
      }
      const workbook = XLSX.utils.book_new();
      let quality = this.qualityFromEnvelope(envelope, "xlsx");
      if (tables.length === 0) {
        warnings.push("No tables were found; the text was written one line per row.");
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(textRows), "Sheet1");
        if (quality === "good") quality = "fair";
      }
      tables.forEach((table, index) => {
        const page = table.page === null ? "" : ` (p.${table.page})`;
        // Cells hold plain text: Markdown emphasis and links are resolved.
        const rows = table.rows.map((row) => row.map((cell) => this.plainInline(cell)));
        // Excel rejects sheet names longer than 31 characters.
        const name = `Table ${index + 1}${page}`.slice(0, 31);
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
      });
      if (tables.length > 0 && textRows.length > 0) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(textRows), "Text");
      }
      const arrayBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      return {
        success: true,
        data: new Uint8Array(arrayBuffer),
        quality,
        warnings,
      };
    } catch (err) {
      logger.error("Local PDF to Excel (envelope) conversion failed", err);
      return {
        success: false,
        data: null,
        quality: "poor",
        warnings: ["Local conversion failed."],
      };
    }
  }

  /**
   * Maps the engine's structured Markdown to docx blocks: headings, bullet
   * levels, numbered items, quotes, pipe tables and styled runs, so no
   * Markdown syntax reaches the document.
   */
  private markdownToDocxBlocks(markdown: string): DocxBlock[] {
    const blocks: DocxBlock[] = [];
    // Indent widths of the open list levels, outermost first.
    const listIndents: number[] = [];
    let tableLines: string[] = [];
    let inFence = false;

    const flushTable = () => {
      const table = this.parseMarkdownTable(tableLines, null);
      if (table) blocks.push(this.buildDocxTable(table));
      tableLines = [];
    };

    for (const raw of markdown.split(/\r?\n/)) {
      const line = raw.trim();
      if (!inFence && this.isTableRow(line)) {
        tableLines.push(line);
        continue;
      }
      flushTable();

      if (/^(```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) {
        // Code keeps its text exactly, Markdown characters included.
        if (line) blocks.push(new Paragraph({ children: [new TextRun(raw.trimEnd())] }));
        continue;
      }
      // Page markers are scaffolding for the OCR merge, and rules have no
      // paragraph equivalent; neither belongs in the document.
      if (!line || PAGE_MARKER_RE.test(line) || RULE_RE.test(line)) continue;

      const heading = line.match(/^(#{1,6})\s+(.*?)(?:\s+#+)?$/);
      if (heading) {
        listIndents.length = 0;
        blocks.push(
          new Paragraph({
            heading: HEADING_LEVELS[heading[1].length - 1],
            children: this.parseRuns(heading[2]),
          }),
        );
        continue;
      }

      const item = raw.trimEnd().match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (item) {
        const level = this.listLevel(listIndents, item[1].replace(/\t/g, "    ").length);
        if (/^\d/.test(item[2])) {
          // Numbered items keep their number as text: the document defines
          // no list numbering to replace it.
          blocks.push(
            new Paragraph({
              ...(level > 0 ? { indent: { left: INDENT_STEP * level } } : {}),
              children: this.parseRuns(`${item[2]} ${item[3]}`),
            }),
          );
        } else {
          blocks.push(new Paragraph({ bullet: { level }, children: this.parseRuns(item[3]) }));
        }
        continue;
      }
      listIndents.length = 0;

      const quote = line.match(/^(?:>\s?)+(.*)$/);
      if (quote) {
        if (quote[1].trim()) {
          blocks.push(
            new Paragraph({
              indent: { left: INDENT_STEP },
              children: this.parseRuns(quote[1].trim()),
            }),
          );
        }
        continue;
      }

      blocks.push(new Paragraph({ children: this.parseRuns(line) }));
    }
    flushTable();
    return blocks;
  }

  /**
   * Nesting level of a list item from its indent: deeper than the open level
   * nests one further, shallower closes levels until one fits. Word allows
   * bullet levels 0-8.
   */
  private listLevel(openIndents: number[], indent: number): number {
    while (openIndents.length > 0 && indent < openIndents[openIndents.length - 1]) {
      openIndents.pop();
    }
    if (openIndents.length === 0 || indent > openIndents[openIndents.length - 1]) {
      openIndents.push(indent);
    }
    return Math.min(openIndents.length - 1, 8);
  }

  private buildDocxTable({ rows, hasHeader }: MarkdownTable): InstanceType<typeof Table> {
    const columns = Math.max(...rows.map((row) => row.length));
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map((cells, rowIndex) => {
        const header = hasHeader && rowIndex === 0;
        return new TableRow({
          tableHeader: header,
          // Short rows are padded so every row has the same number of cells.
          children: Array.from(
            { length: columns },
            (_, column) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: this.parseRuns(cells[column] ?? "", header ? { bold: true } : {}),
                  }),
                ],
              }),
          ),
        });
      }),
    });
  }

  /**
   * Turns inline Markdown into docx runs with bold, italic, strike,
   * underline, superscript and subscript set; a line break starts a new run.
   */
  private parseRuns(text: string, style: RunStyle = {}): InstanceType<typeof TextRun>[] {
    const spans = this.inlineSpans(text, style);
    if (spans.length === 0) spans.push({ text: "", style });
    return spans.flatMap(({ text, style }) =>
      text.split("\n").map(
        (line, index) =>
          new TextRun({
            text: line,
            ...(index > 0 ? { break: 1 } : {}),
            ...(style.bold ? { bold: true } : {}),
            ...(style.italics ? { italics: true } : {}),
            ...(style.strike ? { strike: true } : {}),
            ...(style.underline ? { underline: {} } : {}),
            ...(style.superScript ? { superScript: true } : {}),
            ...(style.subScript ? { subScript: true } : {}),
          }),
      ),
    );
  }

  /** Inline Markdown as plain text, for spreadsheet cells. */
  private plainInline(text: string): string {
    return this.inlineSpans(text)
      .map((span) => span.text)
      .join("");
  }

  /**
   * Splits inline Markdown into styled spans. Code spans and backslash
   * escapes are set aside first so their characters are never read as
   * emphasis or tags; links and images keep only their visible text, and a
   * `<br>` becomes a "\n" in the span's text.
   */
  private inlineSpans(text: string, style: RunStyle = {}): InlineSpan[] {
    const literals: string[] = [];
    const setAside = (literal: string) => `\uE000${literals.push(literal) - 1}\uE001`;
    const prepared = text
      .replace(/`([^`]+)`/g, (_match, code: string) => setAside(code))
      .replace(ESCAPED_RE, (_match, char: string) => setAside(char))
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, "$1")
      .replace(LINE_BREAK_RE, "\n");
    return this.styledSpans(prepared, style).map((span) => ({
      text: span.text.replace(LITERAL_RE, (_match, index: string) => literals[Number(index)]),
      style: span.style,
    }));
  }

  /**
   * Styles emphasis and inline tags, and whatever they wrap, so either can
   * sit inside the other: "**Yan<sup>1</sup>**", "<u>*word*</u>".
   */
  private styledSpans(text: string, style: RunStyle): InlineSpan[] {
    const spans: InlineSpan[] = [];
    let last = 0;
    for (const match of text.matchAll(STYLED_RE)) {
      const start = match.index ?? 0;
      if (start > last) spans.push({ text: text.slice(last, start), style });
      const [, marks, emphasized, tag, tagged] = match;
      const inner: RunStyle = tag
        ? { ...style, ...TAG_STYLES[tag] }
        : marks === "~~"
          ? { ...style, strike: true }
          : {
              ...style,
              bold: style.bold || marks.length >= 2,
              italics: style.italics || marks.length !== 2,
            };
      spans.push(...this.styledSpans(tag ? tagged : emphasized, inner));
      last = start + match[0].length;
    }
    if (last < text.length) spans.push({ text: text.slice(last), style });
    return spans;
  }

  private isTableRow(line: string): boolean {
    return line.length > 1 && line.startsWith("|") && line.endsWith("|");
  }

  /** Cells of a pipe-table row, trimmed; an escaped `\|` stays inside its cell. */
  private tableCells(line: string): string[] {
    return line
      .slice(1, -1)
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim());
  }

  /** Rows of one pipe table, without its `|---|` delimiter row. */
  private parseMarkdownTable(lines: string[], page: number | null): MarkdownTable | null {
    const rows: string[][] = [];
    let hasHeader = false;
    for (const line of lines) {
      const cells = this.tableCells(line);
      if (cells.every((cell) => /^:?-+:?$/.test(cell))) {
        if (rows.length === 1) hasHeader = true;
        continue;
      }
      rows.push(cells);
    }
    return rows.length > 0 ? { page, rows, hasHeader } : null;
  }

  /**
   * Every pipe table in the Markdown, in order. A table ends at the first
   * line that is not a table row; its page comes from the page markers.
   */
  private markdownTables(markdown: string): MarkdownTable[] {
    const tables: MarkdownTable[] = [];
    let page: number | null = null;
    let lines: string[] = [];
    const flush = () => {
      const table = this.parseMarkdownTable(lines, page);
      if (table) tables.push(table);
      lines = [];
    };

    for (const raw of markdown.split(/\r?\n/)) {
      const line = raw.trim();
      if (this.isTableRow(line)) {
        lines.push(line);
        continue;
      }
      flush();
      const marker = line.match(PAGE_MARKER_RE);
      if (marker) page = Number(marker[1]);
    }
    flush();
    return tables;
  }

  /**
   * Every line of the Markdown that is not part of a pipe table, as one-cell
   * rows of plain text: headings, list and quote markers and inline syntax
   * are removed, and page markers, rules and blank lines are skipped. Lines
   * inside code fences are kept as written.
   */
  private markdownTextRows(markdown: string): string[][] {
    const rows: string[][] = [];
    let fence: string | null = null;
    for (const raw of markdown.split(/\r?\n/)) {
      const line = raw.trim();
      const fenceMatch = line.match(/^(`{3,}|~{3,})/);
      if (fenceMatch && (fence === null || line.startsWith(fence))) {
        fence = fence === null ? fenceMatch[1] : null;
        continue;
      }
      if (fence !== null) {
        if (line) rows.push([raw]);
        continue;
      }
      if (!line || this.isTableRow(line) || PAGE_MARKER_RE.test(line) || RULE_RE.test(line)) {
        continue;
      }
      const text = this.plainInline(
        line
          .replace(/^#{1,6}\s+/, "")
          .replace(/^(?:>\s?)+/, "")
          .replace(/^(?:[-*+]|\d+[.)])\s+/, ""),
      ).trim();
      if (text) rows.push([text]);
    }
    return rows;
  }

  /**
   * Structure-driven quality rating. Replaces the text-density heuristic when
   * an engine envelope is available.
   */
  private qualityFromEnvelope(
    envelope: AnalysisEnvelope,
    target: "docx" | "xlsx",
  ): ConversionQuality {
    if (envelope.pdfType === "Scanned" || envelope.pdfType === "Mixed") {
      return envelope.confidence >= 0.75 ? "fair" : "poor";
    }
    if (envelope.pdfType === "ImageBased") return "poor";
    if (envelope.hasEncodingIssues) return "fair";
    if (target === "xlsx") {
      return envelope.layout.pagesWithTables.length > 0 && envelope.confidence >= 0.6
        ? "good"
        : "fair";
    }
    if (envelope.confidence >= 0.75 && (envelope.markdown?.length ?? 0) > 0) return "good";
    if (envelope.confidence >= 0.5) return "fair";
    return "poor";
  }

  async pdfToWord(pdfBytes: Uint8Array): Promise<ConversionResult> {
    try {
      const { items, pageCount } = await this.extractRichTextItems(pdfBytes);
      const quality = this.evaluateQuality(items.length, pageCount);
      const warnings = this.buildWarnings(quality, items.length);

      const paragraphs = this.buildParagraphs(items);
      if (paragraphs.length === 0) {
        warnings.push("No extractable text found; output may be empty.");
      }

      const doc = new Document({
        sections: [
          {
            children: paragraphs.map((text) => new Paragraph({ children: [new TextRun(text)] })),
          },
        ],
      });

      const blob = await Packer.toBlob(doc);
      const buffer = await blob.arrayBuffer();

      return {
        success: true,
        data: new Uint8Array(buffer),
        quality,
        warnings,
      };
    } catch (err) {
      logger.error("Local PDF to Word conversion failed", err);
      return {
        success: false,
        data: null,
        quality: "poor",
        warnings: ["Local conversion failed."],
      };
    }
  }

  async pdfToExcel(pdfBytes: Uint8Array): Promise<ConversionResult> {
    try {
      const { items, pageCount } = await this.extractRichTextItems(pdfBytes);
      const quality = this.evaluateQuality(items.length, pageCount);
      const warnings = this.buildWarnings(quality, items.length);

      const rows = this.buildRows(items);
      if (rows.length === 0) {
        warnings.push("No extractable text found; output may be empty.");
      }

      const sheet = XLSX.utils.aoa_to_sheet(rows.length > 0 ? rows : [[""]]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");

      const arrayBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      return {
        success: true,
        data: new Uint8Array(arrayBuffer),
        quality,
        warnings,
      };
    } catch (err) {
      logger.error("Local PDF to Excel conversion failed", err);
      return {
        success: false,
        data: null,
        quality: "poor",
        warnings: ["Local conversion failed."],
      };
    }
  }

  async pdfToText(pdfBytes: Uint8Array): Promise<ConversionResult> {
    try {
      const { items, pageCount } = await this.extractRichTextItems(pdfBytes);
      const quality = this.evaluateQuality(items.length, pageCount);
      const warnings = this.buildWarnings(quality, items.length);

      const text = this.buildPlainText(items, pageCount);
      if (!text.trim()) {
        warnings.push("No extractable text found; output may be empty.");
      }

      const data = new TextEncoder().encode(text);
      return { success: true, data, quality, warnings };
    } catch (err) {
      logger.error("Local PDF to Text conversion failed", err);
      return {
        success: false,
        data: null,
        quality: "poor",
        warnings: ["Local conversion failed."],
      };
    }
  }

  async pdfToMarkdown(pdfBytes: Uint8Array): Promise<ConversionResult> {
    try {
      const { items, pageCount } = await this.extractRichTextItems(pdfBytes);
      const quality = this.evaluateQuality(items.length, pageCount);
      const warnings = this.buildWarnings(quality, items.length);

      const markdown = this.buildMarkdown(items, pageCount);
      if (!markdown.trim()) {
        warnings.push("No extractable text found; output may be empty.");
      }

      const data = new TextEncoder().encode(markdown);
      return { success: true, data, quality, warnings };
    } catch (err) {
      logger.error("Local PDF to Markdown conversion failed", err);
      return {
        success: false,
        data: null,
        quality: "poor",
        warnings: ["Local conversion failed."],
      };
    }
  }

  private buildParagraphs(items: RichTextItem[]): string[] {
    if (items.length === 0) return [];

    const linesByPage = this.groupByLines(items);
    const paragraphs: string[] = [];

    for (const pageLines of linesByPage) {
      let currentParagraph = "";
      let previousLine: LineGroup | null = null;

      for (const line of pageLines) {
        const lineText = this.joinLineText(line);
        if (!lineText) continue;

        if (previousLine && this.isParagraphBreak(previousLine, line)) {
          if (currentParagraph) paragraphs.push(currentParagraph.trim());
          currentParagraph = lineText;
        } else {
          currentParagraph = currentParagraph ? `${currentParagraph} ${lineText}` : lineText;
        }
        previousLine = line;
      }

      if (currentParagraph) paragraphs.push(currentParagraph.trim());
    }

    return paragraphs;
  }

  private buildRows(items: RichTextItem[]): string[][] {
    if (items.length === 0) return [];

    const rows: string[][] = [];
    const linesByPage = this.groupByLines(items);
    const cellGap = 18;

    for (const pageLines of linesByPage) {
      for (const line of pageLines) {
        const sortedItems = [...line.items].sort((a, b) => a.x - b.x);
        const row: string[] = [];
        let currentCell = "";
        let previousX = sortedItems[0]?.x ?? 0;

        for (const item of sortedItems) {
          if (item.x - previousX > cellGap) {
            if (currentCell) row.push(currentCell.trim());
            currentCell = item.text;
          } else {
            currentCell = currentCell ? `${currentCell} ${item.text}` : item.text;
          }
          previousX = item.x;
        }

        if (currentCell) row.push(currentCell.trim());
        if (row.length > 0) rows.push(row);
      }
    }

    return rows;
  }

  private buildPlainText(items: RichTextItem[], pageCount: number): string {
    if (items.length === 0) return "";

    const linesByPage = this.groupByLines(items);
    const parts: string[] = [];

    for (let pageIdx = 0; pageIdx < linesByPage.length; pageIdx++) {
      const pageLines = linesByPage[pageIdx];
      const pageTextParts: string[] = [];
      let previousLine: LineGroup | null = null;

      for (const line of pageLines) {
        const lineText = this.joinLineText(line);
        if (!lineText) continue;

        // Insert extra newline for paragraph breaks
        if (previousLine && this.isParagraphBreak(previousLine, line)) {
          pageTextParts.push("");
        }
        pageTextParts.push(lineText);
        previousLine = line;
      }

      parts.push(pageTextParts.join("\n"));

      // Separate pages with a visible divider (except after last page)
      if (pageIdx < linesByPage.length - 1 && pageCount > 1) {
        parts.push("");
      }
    }

    return `${parts
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()}\n`;
  }

  /** Lines further apart than this many font sizes, baseline to baseline, start a paragraph. */
  private static readonly PARAGRAPH_GAP_EM = 1.5;
  /** A font size change beyond this ratio (heading to body text) starts a paragraph. */
  private static readonly PARAGRAPH_SIZE_RATIO = 1.3;

  /**
   * A paragraph break is a baseline gap of more than 1.5 font sizes, so 12pt
   * text at normal 1.2 line spacing (14.4pt) stays one paragraph while an
   * empty line or space after a paragraph splits it, or a sharp change of
   * font size such as a heading followed by body text.
   */
  private isParagraphBreak(previous: LineGroup, line: LineGroup): boolean {
    const previousSize = this.lineFontSize(previous);
    const size = this.lineFontSize(line);
    const larger = Math.max(previousSize, size);
    if (Math.abs(previous.y - line.y) > larger * LocalConverter.PARAGRAPH_GAP_EM) return true;
    return larger > Math.min(previousSize, size) * LocalConverter.PARAGRAPH_SIZE_RATIO;
  }

  private lineFontSize(line: LineGroup): number {
    return line.items.reduce((sum, item) => sum + item.fontSize, 0) / line.items.length;
  }

  // Tunable parameters for multi-column detection (used by detectColumns)
  private static readonly COLUMN_GAP_DENSITY = 0.05; // 5% of average bin density
  private static readonly COLUMN_GAP_MIN_BINS = 2; // ~20 pt minimum visual gap
  // Text this close to the top of a column is a heading candidate; the same
  // band is removed from the body when a heading is found.
  private static readonly COLUMN_HEADING_BAND = 22;

  private async extractRichTextItems(
    pdfBytes: Uint8Array,
  ): Promise<{ items: RichTextItem[]; pageCount: number }> {
    const cached = this.richExtractionCache.get(pdfBytes);
    if (cached) return cached;

    const { pdfDoc } = await loadProcessablePdfJsDocument(pdfBytes);
    const items: RichTextItem[] = [];

    for (let pageIndex = 0; pageIndex < pdfDoc.numPages; pageIndex++) {
      const page = await pdfDoc.getPage(pageIndex + 1);
      const textContent = await page.getTextContent();
      for (const item of textContent.items as any[]) {
        const text = typeof item.str === "string" ? item.str.trim() : "";
        if (!text) continue;
        const transform = item.transform as ArrayLike<number> | undefined;
        const x = typeof transform?.[4] === "number" ? transform[4] : 0;
        const y = typeof transform?.[5] === "number" ? transform[5] : 0;
        // Font size is the length of the text's x axis in the transform
        // matrix, which also holds for rotated text; 12 when it is missing.
        const fontSize = Math.hypot(Number(transform?.[0]) || 0, Number(transform?.[1]) || 0) || 12;
        const fontName = typeof item.fontName === "string" ? item.fontName : "";
        items.push({ pageIndex, text, x, y, fontSize, fontName });
      }

      if ((pageIndex + 1) % 2 === 0) {
        await yieldToMain();
      }
    }

    const result = { items, pageCount: pdfDoc.numPages };
    this.richExtractionCache.set(pdfBytes, result);
    return result;
  }

  private buildMarkdown(items: RichTextItem[], pageCount: number): string {
    if (items.length === 0) return "";

    const bodyFontSize = this.detectBodyFontSize(items);
    const itemsByPage = this.groupItemsByPage(items);
    const parts: string[] = [];

    const pageIndexes = [...itemsByPage.keys()].sort((a, b) => a - b);

    for (let i = 0; i < pageIndexes.length; i++) {
      const pageItems = itemsByPage.get(pageIndexes[i]) ?? [];
      const columns = this.detectColumns(pageItems);

      if (columns.length > 1) {
        parts.push(this.formatMultiColumnPage(columns, bodyFontSize));
      } else {
        const pageLines = this.groupPageLines(pageItems);
        parts.push(this.formatLines(pageLines, bodyFontSize));
      }

      if (i < pageIndexes.length - 1 && pageCount > 1) {
        parts.push("\n---\n");
      }
    }

    return `${parts
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()}\n`;
  }

  private groupItemsByPage(items: RichTextItem[]): Map<number, RichTextItem[]> {
    const map = new Map<number, RichTextItem[]>();
    for (const item of items) {
      if (!map.has(item.pageIndex)) map.set(item.pageIndex, []);
      map.get(item.pageIndex)?.push(item);
    }
    return map;
  }

  private groupPageLines(pageItems: RichTextItem[]): LineGroup[] {
    const lineThreshold = 6;
    const sorted = [...pageItems].sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: LineGroup[] = [];

    for (const item of sorted) {
      const currentLine = lines[lines.length - 1];
      if (!currentLine || Math.abs(currentLine.y - item.y) > lineThreshold) {
        lines.push({ y: item.y, items: [item] });
      } else {
        currentLine.items.push(item);
      }
    }

    return lines;
  }

  /**
   * Detects multi-column layouts by analyzing x-coordinate clustering.
   * Returns an array of columns, where each column is a group of items
   * with its detected heading (if any). A single-element array means no columns detected.
   */
  private detectColumns(pageItems: RichTextItem[]): { heading: string; items: RichTextItem[] }[] {
    if (pageItems.length < 10) return [{ heading: "", items: pageItems }];

    // Find the x-range of all items
    const xValues = pageItems.map((i) => i.x);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const pageWidth = maxX - minX;

    // Need sufficient width to have meaningful columns
    if (pageWidth < 200) return [{ heading: "", items: pageItems }];

    // Bucket items by x-coordinate into bins
    const binWidth = 10;
    const bins = new Map<number, number>();
    for (const x of xValues) {
      const bin = Math.floor((x - minX) / binWidth);
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
    }

    // Find gaps: consecutive empty or very sparse bins in the middle region
    const totalBins = Math.ceil(pageWidth / binWidth);
    const avgItemsPerBin = pageItems.length / totalBins;
    const gapThreshold = avgItemsPerBin * LocalConverter.COLUMN_GAP_DENSITY;

    // Scan for the largest gap in the middle 60% of the page
    const scanStart = Math.floor(totalBins * 0.2);
    const scanEnd = Math.ceil(totalBins * 0.8);
    let bestGapStart = -1;
    let bestGapEnd = -1;
    let bestGapSize = 0;
    let currentGapStart = -1;

    for (let bin = scanStart; bin < scanEnd; bin++) {
      const count = bins.get(bin) ?? 0;
      if (count <= gapThreshold) {
        if (currentGapStart === -1) currentGapStart = bin;
      } else {
        if (currentGapStart !== -1) {
          const gapSize = bin - currentGapStart;
          if (gapSize > bestGapSize) {
            bestGapSize = gapSize;
            bestGapStart = currentGapStart;
            bestGapEnd = bin;
          }
          currentGapStart = -1;
        }
      }
    }
    // Close trailing gap
    if (currentGapStart !== -1) {
      const gapSize = scanEnd - currentGapStart;
      if (gapSize > bestGapSize) {
        bestGapSize = gapSize;
        bestGapStart = currentGapStart;
        bestGapEnd = scanEnd;
      }
    }

    if (bestGapSize < LocalConverter.COLUMN_GAP_MIN_BINS) {
      return [{ heading: "", items: pageItems }];
    }

    // Split items into left and right columns
    const splitX = minX + ((bestGapStart + bestGapEnd) / 2) * binWidth;
    const leftItems = pageItems.filter((i) => i.x < splitX);
    const rightItems = pageItems.filter((i) => i.x >= splitX);

    // Both columns need meaningful content
    if (leftItems.length < 5 || rightItems.length < 5) {
      return [{ heading: "", items: pageItems }];
    }

    // Detect headings using per-column logic (much more robust for small-label cards)
    const leftHeading = this.detectColumnHeading(leftItems);
    const rightHeading = this.detectColumnHeading(rightItems);

    return [
      { heading: leftHeading, items: leftItems },
      { heading: rightHeading, items: rightItems },
    ];
  }

  /**
   * Detects a column heading by looking at the visually prominent text
   * near the top of *this specific column* (not the whole page).
   * Works even with very small fonts (e.g. 4.8pt) and fonts whose names
   * do not contain the word "bold".
   */
  private detectColumnHeading(columnItems: RichTextItem[]): string {
    if (columnItems.length === 0) return "";

    // Work exclusively within this column's items (critical for multi-column pages
    // where a page header sits above both columns).
    const maxY = Math.max(...columnItems.map((i) => i.y));
    const topBand = columnItems.filter((i) => i.y >= maxY - LocalConverter.COLUMN_HEADING_BAND);

    if (topBand.length === 0) return "";

    // Read the top band line by line, then left to right within each line.
    const candidateText = this.groupPageLines(topBand)
      .map((line) => this.joinLineText(line))
      .join(" ");

    if (!candidateText || candidateText.length > 80) return "";

    // Compute a body font baseline from the *rest* of the column (everything below the top band).
    const bodyItems = columnItems.filter((i) => i.y < maxY - LocalConverter.COLUMN_HEADING_BAND);
    if (bodyItems.length === 0) return "";

    const bodyFontSizes = bodyItems.map((i) => i.fontSize).sort((a, b) => a - b);
    const bodyMedian = bodyFontSizes[Math.floor(bodyFontSizes.length / 2)];

    const maxTopFont = Math.max(...topBand.map((i) => i.fontSize));

    // Only promote to a heading if it is meaningfully larger than the column body
    // and the text is short (typical of labels, section titles, etc.).
    const isSignificantlyLarger = maxTopFont >= bodyMedian * 1.25;
    const looksLikeParagraph =
      /[.!?]$/.test(candidateText) && candidateText.split(/\s+/).length > 8;

    if (isSignificantlyLarger && !looksLikeParagraph) {
      return candidateText;
    }
    return "";
  }

  private formatMultiColumnPage(
    columns: { heading: string; items: RichTextItem[] }[],
    bodyFontSize: number,
  ): string {
    const parts: string[] = [];

    for (const column of columns) {
      // Filter out heading items from the column body to avoid duplication
      let bodyItems = column.items;
      if (column.heading) {
        const maxY = Math.max(...column.items.map((i) => i.y));
        bodyItems = column.items.filter((i) => i.y < maxY - LocalConverter.COLUMN_HEADING_BAND);
        parts.push(`#### ${column.heading}\n`);
      }

      const lines = this.groupPageLines(bodyItems);
      parts.push(this.formatLines(lines, bodyFontSize));
    }

    return parts.join("\n");
  }

  private formatLines(lines: LineGroup[], bodyFontSize: number): string {
    const pageTextParts: string[] = [];
    let previousLine: LineGroup | null = null;

    for (const line of lines) {
      const sortedItems = [...line.items].sort((a, b) => a.x - b.x);
      const lineText = sortedItems
        .map((i) => i.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!lineText) continue;

      // Detect heading by font size relative to body text
      const avgFontSize = sortedItems.reduce((s, i) => s + i.fontSize, 0) / sortedItems.length;
      const headingLevel = this.classifyHeading(avgFontSize, bodyFontSize);

      // Detect bold from font name heuristic
      const isBold =
        headingLevel === 0 &&
        sortedItems.some((i) => /bold/i.test(i.fontName) && i.text.length > 2);

      // Detect list items
      const listMatch = lineText.match(/^(\d+[.)]\s|[-•*]\s)/);

      // Insert a blank line between paragraphs
      if (previousLine && this.isParagraphBreak(previousLine, line)) {
        pageTextParts.push("");
      }

      let formattedLine: string;
      if (headingLevel > 0) {
        const prefix = "#".repeat(headingLevel);
        formattedLine = `${prefix} ${lineText}`;
      } else if (listMatch) {
        // Normalize bullets to markdown list syntax
        const bullet = /^\d/.test(listMatch[1]) ? listMatch[1] : "- ";
        formattedLine = `${bullet}${lineText.slice(listMatch[1].length)}`;
      } else if (isBold) {
        formattedLine = `**${lineText}**`;
      } else {
        formattedLine = lineText;
      }

      pageTextParts.push(formattedLine);
      previousLine = line;
    }

    return pageTextParts.join("\n");
  }

  private detectBodyFontSize(items: RichTextItem[]): number {
    // The most common font size is assumed to be body text
    const sizeFrequency = new Map<number, number>();
    for (const item of items) {
      const rounded = Math.round(item.fontSize * 2) / 2; // round to nearest 0.5
      sizeFrequency.set(rounded, (sizeFrequency.get(rounded) ?? 0) + 1);
    }

    let maxCount = 0;
    let bodySize = 12;
    for (const [size, count] of sizeFrequency) {
      if (count > maxCount) {
        maxCount = count;
        bodySize = size;
      }
    }
    return bodySize;
  }

  private classifyHeading(fontSize: number, bodyFontSize: number): number {
    const ratio = fontSize / bodyFontSize;
    if (ratio >= 2.0) return 1; // H1: 2x+ body size
    if (ratio >= 1.6) return 2; // H2: 1.6x+
    if (ratio >= 1.3) return 3; // H3: 1.3x+
    return 0; // Not a heading
  }

  private groupByLines(items: RichTextItem[]): LineGroup[][] {
    const linesByPage: LineGroup[][] = [];
    const itemsByPage = new Map<number, RichTextItem[]>();

    for (const item of items) {
      if (!itemsByPage.has(item.pageIndex)) itemsByPage.set(item.pageIndex, []);
      itemsByPage.get(item.pageIndex)?.push(item);
    }

    const lineThreshold = 6;
    const pageIndexes = [...itemsByPage.keys()].sort((a, b) => a - b);

    for (const pageIndex of pageIndexes) {
      const pageItems = itemsByPage.get(pageIndex) ?? [];
      const sorted = [...pageItems].sort((a, b) => b.y - a.y || a.x - b.x);
      const lines: LineGroup[] = [];

      for (const item of sorted) {
        const currentLine = lines[lines.length - 1];
        if (!currentLine || Math.abs(currentLine.y - item.y) > lineThreshold) {
          lines.push({ y: item.y, items: [item] });
        } else {
          currentLine.items.push(item);
        }
      }

      linesByPage.push(lines);
    }

    return linesByPage;
  }

  private joinLineText(line: LineGroup): string {
    return line.items
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private evaluateQuality(itemCount: number, pageCount: number): ConversionQuality {
    if (itemCount === 0) return "poor";
    const avgPerPage = itemCount / Math.max(1, pageCount);
    if (avgPerPage > 80) return "good";
    if (avgPerPage > 20) return "fair";
    return "poor";
  }

  private buildWarnings(quality: ConversionQuality, itemCount: number): string[] {
    const warnings: string[] = [];
    if (itemCount === 0) {
      warnings.push("No selectable text detected.");
    }
    if (quality === "poor") {
      warnings.push(
        "Layout may be incomplete. Try enabling OCR for scanned pages, or use a text-based PDF.",
      );
    } else if (quality === "fair") {
      warnings.push("Some layout fidelity may be reduced in local mode.");
    }
    return warnings;
  }
}

export const localConverter = new LocalConverter();
