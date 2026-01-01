import { Document, Packer, Paragraph, TextRun } from "docx";
import * as XLSX from "xlsx";
import { logger } from "./logger.ts";
import { pdfjsLib } from "./pdfConfig.ts";

export type ConversionQuality = "good" | "fair" | "poor";

export interface ConversionResult {
  success: boolean;
  data: Uint8Array | null;
  quality: ConversionQuality;
  warnings: string[];
}

type TextItemRecord = {
  pageIndex: number;
  text: string;
  x: number;
  y: number;
};

type LineGroup = {
  y: number;
  items: TextItemRecord[];
};

export class LocalConverter {
  async assessQuality(
    pdfBytes: Uint8Array,
    _targetFormat: "docx" | "xlsx",
  ): Promise<ConversionQuality> {
    const { items, pageCount } = await this.extractTextItems(pdfBytes);
    return this.evaluateQuality(items.length, pageCount);
  }

  async pdfToWord(pdfBytes: Uint8Array): Promise<ConversionResult> {
    try {
      const { items, pageCount } = await this.extractTextItems(pdfBytes);
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
      const { items, pageCount } = await this.extractTextItems(pdfBytes);
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

  private async extractTextItems(
    pdfBytes: Uint8Array,
  ): Promise<{ items: TextItemRecord[]; pageCount: number }> {
    const pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    const items: TextItemRecord[] = [];

    for (let pageIndex = 0; pageIndex < pdfDoc.numPages; pageIndex++) {
      const page = await pdfDoc.getPage(pageIndex + 1);
      const textContent = await page.getTextContent();
      for (const item of textContent.items as any[]) {
        const text = typeof item.str === "string" ? item.str.trim() : "";
        if (!text) continue;
        const transform = item.transform as ArrayLike<number> | undefined;
        const x = typeof transform?.[4] === "number" ? transform[4] : 0;
        const y = typeof transform?.[5] === "number" ? transform[5] : 0;
        items.push({ pageIndex, text, x, y });
      }
    }

    return { items, pageCount: pdfDoc.numPages };
  }

  private buildParagraphs(items: TextItemRecord[]): string[] {
    if (items.length === 0) return [];

    const linesByPage = this.groupByLines(items);
    const paragraphs: string[] = [];
    const lineGap = 14;

    for (const pageLines of linesByPage) {
      let currentParagraph = "";
      let previousLineY: number | null = null;

      for (const line of pageLines) {
        const lineText = this.joinLineText(line);
        if (!lineText) continue;

        if (previousLineY !== null && Math.abs(previousLineY - line.y) > lineGap) {
          if (currentParagraph) paragraphs.push(currentParagraph.trim());
          currentParagraph = lineText;
        } else {
          currentParagraph = currentParagraph ? `${currentParagraph} ${lineText}` : lineText;
        }
        previousLineY = line.y;
      }

      if (currentParagraph) paragraphs.push(currentParagraph.trim());
    }

    return paragraphs;
  }

  private buildRows(items: TextItemRecord[]): string[][] {
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

  private groupByLines(items: TextItemRecord[]): LineGroup[][] {
    const linesByPage: LineGroup[][] = [];
    const itemsByPage = new Map<number, TextItemRecord[]>();

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
      warnings.push("Layout may be incomplete. Consider cloud conversion for better quality.");
    } else if (quality === "fair") {
      warnings.push("Some layout fidelity may be reduced in local mode.");
    }
    return warnings;
  }
}

export const localConverter = new LocalConverter();
