import { describe, expect, it } from "vitest";
import { mergeOcrIntoMarkdown, splitMarkdownByPage } from "../../utils/ocrEngine";
import type { OcrPageResult } from "../../utils/ocrTypes";

describe("splitMarkdownByPage", () => {
  it("returns a single chunk when markers are absent", () => {
    expect(splitMarkdownByPage("hello world")).toEqual([{ page: 0, body: "hello world" }]);
  });

  it("splits on <!-- Page N --> markers", () => {
    const md = `<!-- Page 1 -->\n\nAlpha\n\n<!-- Page 2 -->\n\nBeta`;
    expect(splitMarkdownByPage(md)).toEqual([
      { page: 1, body: "Alpha" },
      { page: 2, body: "Beta" },
    ]);
  });
});

describe("mergeOcrIntoMarkdown", () => {
  const ocr = (page: number, text: string): OcrPageResult => ({
    page,
    text,
    confidence: 0.9,
    processingTimeMs: 1,
  });

  it("fills empty native pages with OCR text", () => {
    const native = `<!-- Page 1 -->\n\nNative one\n\n<!-- Page 2 -->\n\n`;
    const merged = mergeOcrIntoMarkdown(native, [ocr(2, "Scanned two")], 2);
    expect(merged).toContain("<!-- Page 1 -->");
    expect(merged).toContain("Native one");
    expect(merged).toContain("<!-- Page 2 -->");
    expect(merged).toContain("Scanned two");
  });

  it("appends OCR under a heading when native text already exists", () => {
    const native = `<!-- Page 1 -->\n\nTitle line`;
    const merged = mergeOcrIntoMarkdown(native, [ocr(1, "Extra from scan")], 1);
    expect(merged).toContain("Title line");
    expect(merged).toContain("### OCR (page 1)");
    expect(merged).toContain("Extra from scan");
  });

  it("appends OCR pages when native markdown has no markers", () => {
    const merged = mergeOcrIntoMarkdown("plain", [ocr(1, "from image")], 1);
    expect(merged).toContain("plain");
    expect(merged).toContain("<!-- Page 1 -->");
    expect(merged).toContain("from image");
  });

  it("interleaves OCR into reading order rather than appending at the end", () => {
    // A Mixed PDF: pages 1 and 3 have native text, page 2 is scanned. The OCR
    // text must land in page 2's slot, not after page 3.
    const native = `<!-- Page 1 -->\n\nFirst\n\n<!-- Page 2 -->\n\n\n\n<!-- Page 3 -->\n\nThird`;
    const merged = mergeOcrIntoMarkdown(native, [ocr(2, "Second from scan")], 3);

    const posFirst = merged.indexOf("First");
    const posScan = merged.indexOf("Second from scan");
    const posThird = merged.indexOf("Third");

    expect(posFirst).toBeGreaterThanOrEqual(0);
    expect(posScan).toBeGreaterThan(posFirst);
    expect(posThird).toBeGreaterThan(posScan);
  });

  it("skips redundant OCR when native already contains the sample", () => {
    const native = `<!-- Page 1 -->\n\nThe quick brown fox jumps over the lazy dog`;
    const merged = mergeOcrIntoMarkdown(
      native,
      [ocr(1, "The quick brown fox jumps over the lazy dog")],
      1,
    );
    expect(merged).not.toContain("### OCR");
  });
});

describe("mergeOcrIntoMarkdown edge cases", () => {
  const ocr = (page: number, text: string): OcrPageResult => ({
    page,
    text,
    confidence: 0.9,
    processingTimeMs: 1,
  });

  it("orders OCR pages and skips blank ones when native text has no markers", () => {
    const merged = mergeOcrIntoMarkdown("", [ocr(3, "Third"), ocr(1, "First"), ocr(2, "   ")], 3);

    expect(merged).toBe("<!-- Page 1 -->\n\nFirst\n\n<!-- Page 3 -->\n\nThird");
  });

  it("keeps a marker for a known page that has no text from either source", () => {
    const native = "<!-- Page 1 -->\n\nOne\n\n<!-- Page 2 -->\n\n";
    const merged = mergeOcrIntoMarkdown(native, [ocr(2, "")], 2);

    expect(merged).toBe("<!-- Page 1 -->\n\nOne\n\n<!-- Page 2 -->");
  });

  it("fills pages beyond the last native marker from OCR, and leaves unknown pages out", () => {
    const native = "<!-- Page 1 -->\n\nOne";
    const merged = mergeOcrIntoMarkdown(native, [ocr(4, "Four")], 5);

    expect(merged).toBe("<!-- Page 1 -->\n\nOne\n\n<!-- Page 4 -->\n\nFour");
    expect(merged).not.toContain("Page 2");
    expect(merged).not.toContain("Page 5");
  });

  it("still appends short OCR text that native text happens to contain", () => {
    // Samples of 12 characters or fewer are too short to prove the page was
    // already read natively.
    const merged = mergeOcrIntoMarkdown("<!-- Page 1 -->\n\nTotal: 42", [ocr(1, "Total: 42")], 1);

    expect(merged).toContain("### OCR (page 1)");
  });
});

describe("text before the first page marker", () => {
  it("is returned as a leading page-0 chunk", () => {
    expect(splitMarkdownByPage("# Report title\n\n<!-- Page 1 -->\n\nBody")).toEqual([
      { page: 0, body: "# Report title" },
      { page: 1, body: "Body" },
    ]);
  });

  it("adds no empty chunk when nothing precedes the first marker", () => {
    expect(splitMarkdownByPage("\n\n<!-- Page 1 -->\n\nBody")).toEqual([{ page: 1, body: "Body" }]);
  });

  it("is kept at the top when OCR is merged in", () => {
    const merged = mergeOcrIntoMarkdown(
      "# Report title\n\n<!-- Page 1 -->\n\nBody\n\n<!-- Page 2 -->\n\n",
      [{ page: 2, text: "Scanned", confidence: 0.9, processingTimeMs: 1 }],
      2,
    );

    expect(merged).toBe("# Report title\n\n<!-- Page 1 -->\n\nBody\n\n<!-- Page 2 -->\n\nScanned");
  });
});
