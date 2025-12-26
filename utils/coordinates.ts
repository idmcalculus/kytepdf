/**
 * Utility functions for coordinate system conversions between DOM (top-left origin)
 * and PDF (bottom-left origin).
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Converts DOM coordinates (relative to page wrapper) to PDF points.
 * @param domX X coordinate in DOM pixels
 * @param domY Y coordinate in DOM pixels
 * @param pageHeight PDF page height in points
 * @param scale The current rendering scale (targetWidth / viewportWidth)
 */
export function domToPdfPoint(domX: number, domY: number, pageHeight: number, scale: number): Point {
  return {
    x: domX / scale,
    y: pageHeight - (domY / scale)
  };
}

/**
 * Adjusts the Y coordinate for text baseline.
 * PDF drawText uses the bottom-left of the first character (the baseline).
 */
export function adjustYForTextBaseline(pdfY: number, fontSize: number): number {
  // Approximate baseline shift (descender compensation)
  return pdfY - (fontSize * 0.8);
}
