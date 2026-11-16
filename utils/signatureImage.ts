/**
 * Typed signatures in the bundled handwriting font, Great Vibes, drawn on a
 * canvas. The browser lays the text out with the font's own joined letters
 * and spacing, so a PDF needs only the picture. pdf-lib can embed a font
 * file only through fontkit, a 700 kB library.
 */
import fontUrl from "@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff?url";
import fontRanges from "@fontsource/great-vibes/unicode.json";
import { logger } from "./logger.ts";

/**
 * The family name the bundled file is added under. It is our own, so a Great
 * Vibes from elsewhere never stands in for it.
 */
export const SIGNATURE_FONT_FAMILY = "Kyte Signature";

/** A CSS font-family: the handwriting font, then a system script font for anything it lacks. */
export const SIGNATURE_FONT_STACK = `"${SIGNATURE_FONT_FAMILY}", cursive`;

/** Canvas pixels per PDF point. 4 gives about 290 dpi, sharp in print. */
const PIXELS_PER_POINT = 4;

/** Canvas pixels kept clear around the ink, so its smoothed edges are not cut off. */
const PADDING = 2;

/** Reads a CSS unicode-range ("U+0000-00FF,U+0131") into inclusive code point ranges. */
export function parseUnicodeRange(value: string): Array<[number, number]> {
  return value.split(",").map((part) => {
    const [start, end = start] = part.trim().replace(/^U\+/i, "").split("-");
    return [Number.parseInt(start, 16), Number.parseInt(end, 16)];
  });
}

const LATIN_RANGES = parseUnicodeRange(fontRanges.latin);

/**
 * Whether the bundled file covers a character. It holds the font's Latin
 * subset, so this follows the range the font package gives for that subset.
 */
export const signatureFontHas = (codePoint: number) =>
  LATIN_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);

let fontReady: Promise<boolean> | null = null;

/**
 * Adds the bundled handwriting font to the page, once. Resolves false where
 * it cannot load (no FontFace API, or the file is out of reach); the next
 * call then tries again.
 */
export function loadSignatureFont(): Promise<boolean> {
  fontReady ??= (async () => {
    if (typeof FontFace !== "function" || typeof document === "undefined" || !document.fonts) {
      return false;
    }
    const face = new FontFace(SIGNATURE_FONT_FAMILY, `url("${fontUrl}") format("woff")`);
    await face.load();
    document.fonts.add(face);
    return true;
  })().catch((error: unknown) => {
    logger.warn("The handwriting font could not be loaded.", error);
    fontReady = null;
    return false;
  });
  return fontReady;
}

/** One line of a signature as a picture. Sizes are in PDF points. */
export interface SignatureLine {
  /** The line as a PNG data URL, with a clear background. */
  dataUrl: string;
  width: number;
  height: number;
  /** How far the picture reaches left of the point where the line's baseline starts. */
  left: number;
  /** How far the picture reaches below the baseline. */
  descent: number;
}

/** Red, green and blue from 0 to 1, as pdf-lib's rgb() takes them. */
export type SignatureColor = readonly [number, number, number];

export interface SignaturePen {
  /** The width of the text at this size, in points, for wrapping. */
  widthOfTextAtSize(text: string, size: number): number;
  /** Draws one line of the signature at this size, in points. */
  drawLine(text: string, size: number, color: SignatureColor): SignatureLine;
}

const cssColor = ([red, green, blue]: SignatureColor) =>
  `rgb(${[red, green, blue].map((part) => Math.round(part * 255)).join(", ")})`;

/**
 * A pen that draws in the handwriting font, or null where the font or a
 * canvas is not available.
 */
export async function createSignaturePen(): Promise<SignaturePen | null> {
  if (!(await loadSignatureFont())) return null;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;

  const fontAt = (size: number) => `${size * PIXELS_PER_POINT}px ${SIGNATURE_FONT_STACK}`;

  return {
    widthOfTextAtSize(text, size) {
      context.font = fontAt(size);
      return context.measureText(text).width / PIXELS_PER_POINT;
    },

    drawLine(text, size, color) {
      context.font = fontAt(size);
      // The ink, not the advance: the font's swashes reach well past both
      // ends of a word and below the baseline.
      const ink = context.measureText(text);
      const left = Math.ceil(ink.actualBoundingBoxLeft) + PADDING;
      const ascent = Math.ceil(ink.actualBoundingBoxAscent) + PADDING;
      const descent = Math.ceil(ink.actualBoundingBoxDescent) + PADDING;
      canvas.width = Math.max(1, left + Math.ceil(ink.actualBoundingBoxRight) + PADDING);
      canvas.height = Math.max(1, ascent + descent);

      // Resizing the canvas reset its drawing state.
      context.font = fontAt(size);
      context.fillStyle = cssColor(color);
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
      context.fillText(text, left, ascent);

      return {
        dataUrl: canvas.toDataURL("image/png"),
        width: canvas.width / PIXELS_PER_POINT,
        height: canvas.height / PIXELS_PER_POINT,
        left: left / PIXELS_PER_POINT,
        descent: descent / PIXELS_PER_POINT,
      };
    },
  };
}
