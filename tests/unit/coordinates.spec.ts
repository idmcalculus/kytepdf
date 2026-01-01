import { describe, expect, it } from "vitest";
import { adjustYForTextBaseline, domToPdfPoint } from "../../utils/coordinates";

describe("coordinates utility", () => {
  it("should convert top-left DOM coordinates to bottom-left PDF points", () => {
    const pageHeight = 842; // A4 height in points
    const scale = 1.0;

    // Origin (0,0 in DOM) should be (0, pageHeight in PDF)
    const p1 = domToPdfPoint(0, 0, pageHeight, scale);
    expect(p1.x).toBe(0);
    expect(p1.y).toBe(pageHeight);

    // Center of page (DOM)
    const p2 = domToPdfPoint(100, 100, pageHeight, 2.0);
    expect(p2.x).toBe(50); // 100 / 2.0
    expect(p2.y).toBe(pageHeight - 50); // 842 - 100/2.0
  });

  it("should adjust Y for text baseline", () => {
    const pdfY = 100;
    const fontSize = 10;
    expect(adjustYForTextBaseline(pdfY, fontSize)).toBe(92); // 100 - 8
  });
});
