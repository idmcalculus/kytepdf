/**
 * ImageExtractor - Extracts images from PDF pages by analyzing the operator list
 * to find image paint operations, then captures those regions from a rendered canvas.
 */

import { logger } from "./logger.ts";

export interface ExtractedImage {
  pageIndex: number;
  x: number; // DOM x position (scaled)
  y: number; // DOM y position (scaled)
  width: number; // DOM width (scaled)
  height: number; // DOM height (scaled)
  dataUrl: string; // Base64 image data
}

const TARGET_WIDTH = 800;
const IMAGE_CAPTURE_SCALE = 3;
const MAX_CAPTURE_CANVAS_PIXELS = 16_000_000;
/**
 * An image covering at least this share of the page is the page itself (a
 * scanned page, a full-bleed background) rather than a picture on it. It is
 * not extracted, so the page keeps it and nothing is cut out of it.
 */
const PAGE_BACKGROUND_COVERAGE = 0.9;
// pdf.js OPS constants for image operations
const OPS_SAVE = 10;
const OPS_RESTORE = 11;
const OPS_TRANSFORM = 12; // setTransform / cm
const OPS_PAINT_FORM_XOBJECT_BEGIN = 74;
const OPS_PAINT_FORM_XOBJECT_END = 75;
const OPS_PAINT_IMAGE_MASK_XOBJECT = 83;
const OPS_PAINT_IMAGE_MASK_XOBJECT_GROUP = 84;
const OPS_PAINT_IMAGE_XOBJECT = 85;
const OPS_PAINT_INLINE_IMAGE_XOBJECT = 86;
const OPS_PAINT_INLINE_IMAGE_XOBJECT_GROUP = 87;
const OPS_PAINT_IMAGE_XOBJECT_REPEAT = 88;
const OPS_PAINT_IMAGE_MASK_XOBJECT_REPEAT = 89;

type Region = { x: number; y: number; width: number; height: number };

export class ImageExtractor {
  /**
   * Extract images from a PDF page by:
   * 1. Getting the operator list to find image positions
   * 2. Rendering the page at high resolution
   * 3. Cropping image regions from the rendered canvas
   */
  async extractPageImages(
    pdfDoc: any,
    pageIndex: number,
    renderedCanvas: HTMLCanvasElement,
  ): Promise<ExtractedImage[]> {
    try {
      const page = await pdfDoc.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: 1.0 });
      const scale = TARGET_WIDTH / viewport.width;

      if (typeof page.getOperatorList !== "function") return [];

      // Get operator list to find image positions
      const opList = await page.getOperatorList();
      const pageWidth = viewport.width * scale;
      const pageHeight = viewport.height * scale;
      const imageRegions = this.dedupeImageRegions(
        this.findImageRegions(opList, viewport, scale),
      ).filter((region) => !this.isPageBackground(region, pageWidth, pageHeight));

      if (imageRegions.length === 0) return [];

      const capture = await this.createCaptureCanvas(page, scale, renderedCanvas);

      // Capture each image region from the high-resolution canvas, while keeping
      // annotation coordinates in the 800px-wide editor coordinate space.
      const images: ExtractedImage[] = [];

      for (const region of imageRegions) {
        // Clip the region to the canvas on all four sides
        const cropX = Math.max(0, Math.round(region.x));
        const cropY = Math.max(0, Math.round(region.y));
        const cropW = Math.min(Math.round(region.x + region.width), renderedCanvas.width) - cropX;
        const cropH = Math.min(Math.round(region.y + region.height), renderedCanvas.height) - cropY;

        if (cropW <= 10 || cropH <= 10) continue; // Skip tiny images

        try {
          const sourceX = Math.max(0, Math.round(cropX * capture.multiplier));
          const sourceY = Math.max(0, Math.round(cropY * capture.multiplier));
          const sourceW = Math.min(
            Math.round(cropW * capture.multiplier),
            capture.canvas.width - sourceX,
          );
          const sourceH = Math.min(
            Math.round(cropH * capture.multiplier),
            capture.canvas.height - sourceY,
          );

          if (sourceW <= 10 || sourceH <= 10) continue;

          // Create a temporary canvas to extract the image region
          const tempCanvas = document.createElement("canvas");
          tempCanvas.width = sourceW;
          tempCanvas.height = sourceH;
          const tempCtx = tempCanvas.getContext("2d");
          if (!tempCtx) continue;

          tempCtx.imageSmoothingEnabled = true;
          tempCtx.imageSmoothingQuality = "high";
          tempCtx.drawImage(
            capture.canvas,
            sourceX,
            sourceY,
            sourceW,
            sourceH,
            0,
            0,
            sourceW,
            sourceH,
          );

          // Check if this region is mostly white/blank (skip if so)
          if (this.isBlankRegion(tempCtx, sourceW, sourceH)) continue;

          const dataUrl = tempCanvas.toDataURL("image/png");
          images.push({
            pageIndex,
            x: cropX,
            y: cropY,
            width: cropW,
            height: cropH,
            dataUrl,
          });
        } catch (err) {
          logger.warn("Failed to extract image region", err);
        }
      }

      return images;
    } catch (err) {
      logger.warn(`Failed to extract images from page ${pageIndex}`, err);
      return [];
    }
  }

  private async createCaptureCanvas(
    page: any,
    displayScale: number,
    renderedCanvas: HTMLCanvasElement,
  ): Promise<{ canvas: HTMLCanvasElement; multiplier: number }> {
    const basePixels = Math.max(1, renderedCanvas.width * renderedCanvas.height);
    const boundedMultiplier = Math.min(
      IMAGE_CAPTURE_SCALE,
      Math.sqrt(MAX_CAPTURE_CANVAS_PIXELS / basePixels),
    );
    const multiplier = Math.max(1, boundedMultiplier);

    if (multiplier <= 1.01) {
      return { canvas: renderedCanvas, multiplier: 1 };
    }

    try {
      const captureCanvas = document.createElement("canvas");
      const captureViewport = page.getViewport({ scale: displayScale * multiplier });
      captureCanvas.width = Math.max(1, Math.floor(captureViewport.width));
      captureCanvas.height = Math.max(1, Math.floor(captureViewport.height));

      const captureCtx = captureCanvas.getContext("2d");
      if (!captureCtx) return { canvas: renderedCanvas, multiplier: 1 };

      await page.render({
        canvasContext: captureCtx,
        viewport: captureViewport,
      }).promise;

      return {
        canvas: captureCanvas,
        multiplier: captureCanvas.width / Math.max(1, renderedCanvas.width),
      };
    } catch (err) {
      logger.warn("High-resolution image capture render failed; using editor canvas", err);
      return { canvas: renderedCanvas, multiplier: 1 };
    }
  }

  /** True when the part of the image on the page covers most of the page. */
  private isPageBackground(region: Region, pageWidth: number, pageHeight: number): boolean {
    const width = Math.min(region.x + region.width, pageWidth) - Math.max(region.x, 0);
    const height = Math.min(region.y + region.height, pageHeight) - Math.max(region.y, 0);
    if (width <= 0 || height <= 0) return false;
    return (width * height) / (pageWidth * pageHeight) >= PAGE_BACKGROUND_COVERAGE;
  }

  private dedupeImageRegions(
    regions: Array<{ x: number; y: number; width: number; height: number }>,
  ): Array<{ x: number; y: number; width: number; height: number }> {
    const uniqueRegions: Array<{ x: number; y: number; width: number; height: number }> = [];

    for (const region of regions) {
      const duplicate = uniqueRegions.some(
        (existing) => this.getIntersectionOverUnion(existing, region) > 0.9,
      );
      if (!duplicate) uniqueRegions.push(region);
    }

    return uniqueRegions;
  }

  private getIntersectionOverUnion(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ): number {
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    const aArea = a.width * a.height;
    const bArea = b.width * b.height;
    const union = aArea + bArea - intersection;

    return union > 0 ? intersection / union : 0;
  }

  /**
   * Parse the operator list to find image painting operations and their positions.
   * Tracks the current transformation matrix (CTM) to determine where images are placed.
   */
  private findImageRegions(opList: any, viewport: any, scale: number): Region[] {
    const regions: Region[] = [];
    const ops = opList.fnArray;
    const args = opList.argsArray;

    // Track the current transform matrix as we scan operations
    // PDF transform: [a, b, c, d, e, f] where e,f are translate
    let ctm: number[] = [1, 0, 0, 1, 0, 0];
    const ctmStack: number[][] = [];
    const addImage = (matrix: number[]) => {
      const region = this.imageRegion(matrix, viewport, scale);
      if (region) regions.push(region);
    };

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];

      if (op === OPS_SAVE) {
        ctmStack.push([...ctm]);
      } else if (op === OPS_RESTORE || op === OPS_PAINT_FORM_XOBJECT_END) {
        const saved = ctmStack.pop();
        if (saved) ctm = saved;
      } else if (op === OPS_TRANSFORM) {
        // transform (concat matrix)
        const [a, b, c, d, e, f] = args[i];
        ctm = this.multiplyMatrix(ctm, [a, b, c, d, e, f]);
      } else if (op === OPS_PAINT_FORM_XOBJECT_BEGIN) {
        // A form XObject saves the state and applies its own /Matrix (args
        // [matrix, bbox]); the matching end op restores it, as Do does.
        ctmStack.push([...ctm]);
        const matrix = args[i]?.[0];
        if (matrix?.length === 6) ctm = this.multiplyMatrix(ctm, Array.from(matrix));
      } else if (
        op === OPS_PAINT_IMAGE_XOBJECT ||
        op === OPS_PAINT_INLINE_IMAGE_XOBJECT ||
        op === OPS_PAINT_IMAGE_MASK_XOBJECT
      ) {
        // Images, inline images and stencil masks fill the unit square of
        // the current matrix.
        addImage(ctm);
      } else if (
        op === OPS_PAINT_IMAGE_XOBJECT_REPEAT ||
        op === OPS_PAINT_IMAGE_MASK_XOBJECT_REPEAT
      ) {
        // pdf.js folds runs of `q cm Do Q` for one image into a single op:
        // [objId, scaleX, scaleY, positions] for images and
        // [img, scaleX, skewX, skewY, scaleY, positions] for masks. Each copy
        // is drawn at [scaleX skewX skewY scaleY x y] within the current matrix.
        const [, scaleX, skewX = 0, skewY = 0, scaleY, positions] =
          op === OPS_PAINT_IMAGE_XOBJECT_REPEAT
            ? [args[i][0], args[i][1], 0, 0, args[i][2], args[i][3]]
            : args[i];
        for (let p = 0; p + 1 < positions.length; p += 2) {
          addImage(
            this.multiplyMatrix(ctm, [
              scaleX,
              skewX,
              skewY,
              scaleY,
              positions[p],
              positions[p + 1],
            ]),
          );
        }
      } else if (
        op === OPS_PAINT_IMAGE_MASK_XOBJECT_GROUP ||
        op === OPS_PAINT_INLINE_IMAGE_XOBJECT_GROUP
      ) {
        // Grouped masks ([images]) and grouped inline images ([imgData, map])
        // give each copy its own transform within the current matrix.
        const copies = op === OPS_PAINT_IMAGE_MASK_XOBJECT_GROUP ? args[i][0] : args[i][1];
        for (const copy of copies) {
          addImage(this.multiplyMatrix(ctm, Array.from(copy.transform as ArrayLike<number>)));
        }
      }
    }

    return regions;
  }

  /**
   * An image fills the unit square of its matrix. Taking the bounds of all
   * four corners, through the page viewport, keeps flipped and rotated images
   * on the spot pdf.js paints, on rotated pages and offset crop boxes too.
   * Returns null for images of 20 editor pixels or less in either direction.
   */
  private imageRegion(m: number[], viewport: any, scale: number): Region | null {
    const corners = [
      [m[4], m[5]],
      [m[0] + m[4], m[1] + m[5]],
      [m[2] + m[4], m[3] + m[5]],
      [m[0] + m[2] + m[4], m[1] + m[3] + m[5]],
    ].map(([x, y]) => viewport.convertToViewportPoint(x, y) as number[]);
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const width = (Math.max(...xs) - left) * scale;
    const height = (Math.max(...ys) - top) * scale;
    if (width <= 20 || height <= 20) return null;

    return { x: left * scale, y: top * scale, width, height };
  }

  /**
   * Multiply two 2D transform matrices [a,b,c,d,e,f]
   */
  private multiplyMatrix(m1: number[], m2: number[]): number[] {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ];
  }

  /**
   * Check if a canvas region is mostly blank (white/near-white).
   * Returns true if > 95% of pixels are near-white.
   */
  private isBlankRegion(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
    // Sample a grid of pixels rather than checking every pixel (performance)
    const sampleSize = Math.min(20, Math.floor(Math.sqrt(width * height) / 4));
    const stepX = Math.max(1, Math.floor(width / sampleSize));
    const stepY = Math.max(1, Math.floor(height / sampleSize));
    let whiteCount = 0;
    let totalSampled = 0;

    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        const pixel = ctx.getImageData(x, y, 1, 1).data;
        // Consider "white" as RGB all > 240
        if (pixel[0] > 240 && pixel[1] > 240 && pixel[2] > 240) {
          whiteCount++;
        }
        totalSampled++;
      }
    }

    return totalSampled > 0 && whiteCount / totalSampled > 0.95;
  }
}

export const imageExtractor = new ImageExtractor();
