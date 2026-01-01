import { logger } from "./logger.ts";
import { PDFDocument, StandardFonts, pdfjsLib, rgb, degrees } from "./pdfConfig.ts";
import type { Annotation } from "./AnnotationManager.ts";
import { adjustYForTextBaseline } from "./coordinates.ts";

export async function embedAllAnnotations(
  pdfData: Uint8Array,
  annotations: Annotation[],
): Promise<Uint8Array> {
  try {
    const pdfDoc = await PDFDocument.load(pdfData);
    const pages = pdfDoc.getPages();
    
    // Cache for embedded fonts to avoid redundant embedding
    const fontCache: Record<string, any> = {};
    const getFont = async (fontName: string) => {
      if (fontCache[fontName]) return fontCache[fontName];
      
      let font;
      switch (fontName) {
        case "Times-Roman": font = await pdfDoc.embedFont(StandardFonts.TimesRoman); break;
        case "Courier": font = await pdfDoc.embedFont(StandardFonts.Courier); break;
        default: font = await pdfDoc.embedFont(StandardFonts.Helvetica); break;
      }
      fontCache[fontName] = font;
      return font;
    };

    for (const ann of annotations) {
      const page = pages[ann.pageIndex];
      if (!page) continue;

      const { height } = page.getSize();

      const hex = ann.style?.color || (ann.type === "text" ? "#000000" : "#ffffff");
      const r = parseInt(hex.slice(1, 3), 16) / 255 || 0;
      const g = parseInt(hex.slice(3, 5), 16) / 255 || 0;
      const b = parseInt(hex.slice(5, 7), 16) / 255 || 0;

      if (ann.type === "text" && ann.content) {
        const font = await getFont(ann.style?.font || "Helvetica");
        const pdfX = ann.x;
        const fontSize = ann.style?.fontSize || 16;
        const pdfY = adjustYForTextBaseline(height - ann.y, fontSize);

        page.drawText(ann.content, {
          x: pdfX,
          y: pdfY,
          size: fontSize,
          font: font,
          color: rgb(r, g, b),
        });
      } else if (ann.type === "rectangle") {
        const pdfX = ann.x;
        const pdfY = height - ann.y - (ann.height || 0);

        page.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: ann.width || 100,
          height: ann.height || 50,
          color: rgb(r, g, b),
          borderWidth: ann.style?.strokeWidth || 0,
          opacity: ann.style?.opacity ?? 1.0,
        });
      } else if (ann.type === "image" && ann.content) {
        const pdfX = ann.x;
        const pdfY = height - ann.y - (ann.height || 0);

        // Convert Data URL to Bytes
        const imageBytes = await fetch(ann.content).then((res) => res.arrayBuffer());
        let embeddedImage;
        if (ann.content.includes("image/png")) {
          embeddedImage = await pdfDoc.embedPng(imageBytes);
        } else {
          embeddedImage = await pdfDoc.embedJpg(imageBytes);
        }

        page.drawImage(embeddedImage, {
          x: pdfX,
          y: pdfY,
          width: ann.width || 150,
          height: ann.height || 150,
          rotate: degrees(ann.style?.rotation || 0),
          opacity: ann.style?.opacity ?? 1.0,
        });
      }
    }

    return await pdfDoc.save();
  } catch (err) {
    logger.error("Failed to embed all annotations", err);
    throw err;
  }
}

export async function embedTextAnnotations(
  pdfData: Uint8Array,
  annotations: Annotation[],
): Promise<Uint8Array> {
  try {
    const pdfDoc = await PDFDocument.load(pdfData);
    const pages = pdfDoc.getPages();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    for (const ann of annotations) {
      if (ann.type !== "text" || !ann.content) continue;

      const page = pages[ann.pageIndex];
      if (!page) continue;

      const { height } = page.getSize();

      // Convert HEX to RGB
      const hex = ann.style?.color || "#000000";
      const r = parseInt(hex.slice(1, 3), 16) / 255 || 0;
      const g = parseInt(hex.slice(3, 5), 16) / 255 || 0;
      const b = parseInt(hex.slice(5, 7), 16) / 255 || 0;

      // Convert DOM Y (top-left) to PDF Y (bottom-left)
      // Note: ann.x and ann.y should be in PDF points
      const pdfX = ann.x;
      const pdfY = height - ann.y - (ann.style?.fontSize || 16) * 0.8; // Rough baseline adjustment

      page.drawText(ann.content, {
        x: pdfX,
        y: pdfY,
        size: ann.style?.fontSize || 16,
        font: font,
        color: rgb(r, g, b),
      });
    }

    return await pdfDoc.save();
  } catch (err) {
    logger.error("Failed to embed text annotations", err);
    throw err;
  }
}

export async function embedShapeAnnotations(
  pdfData: Uint8Array,
  annotations: Annotation[],
): Promise<Uint8Array> {
  try {
    const pdfDoc = await PDFDocument.load(pdfData);
    const pages = pdfDoc.getPages();

    for (const ann of annotations) {
      if (ann.type !== "rectangle") continue;

      const page = pages[ann.pageIndex];
      if (!page) continue;

      const { height } = page.getSize();

      // Convert HEX to RGB
      const hex = ann.style?.color || "#ffffff";
      const r = parseInt(hex.slice(1, 3), 16) / 255 || 0;
      const g = parseInt(hex.slice(3, 5), 16) / 255 || 0;
      const b = parseInt(hex.slice(5, 7), 16) / 255 || 0;

      const pdfX = ann.x;
      const pdfY = height - ann.y - (ann.height || 0);

      page.drawRectangle({
        x: pdfX,
        y: pdfY,
        width: ann.width || 100,
        height: ann.height || 50,
        color: rgb(r, g, b),
        borderWidth: ann.style?.strokeWidth || 0,
        opacity: 1.0, // We can add opacity support later
      });
    }

    return await pdfDoc.save();
  } catch (err) {
    logger.error("Failed to embed shape annotations", err);
    throw err;
  }
}

export async function compressPdf(
  file: File,
  targetSizeKb: number,
  onProgress: (progress: number, status: string) => void,
): Promise<Uint8Array | null> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;

  let minQuality = 0.01;
  let maxQuality = 0.95;
  let currentScale = 1.0; // Start at 1.0 for better initial guess
  let bestBuffer: Uint8Array | null = null;
  let iterations = 0;
  const maxIterations = 10;

  onProgress(5, "Analyzing PDF structure...");

  while (iterations < maxIterations) {
    const quality = (minQuality + maxQuality) / 2;
    onProgress(
      10 + iterations * 8,
      `Iterative Compression (${iterations + 1}/${maxIterations})...`,
    );

    try {
      const currentPdf = await PDFDocument.create();

      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: currentScale });

        const canvasWidth = Math.max(1, Math.floor(viewport.width));
        const canvasHeight = Math.max(1, Math.floor(viewport.height));

        const canvas = document.createElement("canvas");
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Could not get 2D context from canvas");
        }
        await page.render({ canvasContext: context, viewport, canvas }).promise;

        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality),
        );
        if (!blob) {
          throw new Error("Failed to create blob from canvas");
        }
        const blobArrayBuffer = await blob.arrayBuffer();
        const imageBytes = new Uint8Array(blobArrayBuffer);

        const embeddedImage = await currentPdf.embedJpg(imageBytes);
        const pdfPage = currentPdf.addPage([canvasWidth, canvasHeight]);

        pdfPage.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: canvasWidth,
          height: canvasHeight,
        });
      }

      const pdfBytes = await currentPdf.save();
      const sizeKb = pdfBytes.length / 1024;

      bestBuffer = pdfBytes;

      logger.debug(`Compression iteration ${iterations + 1}`, {
        quality,
        scale: currentScale,
        sizeKb,
      });

      // Goal: sizeKb should be <= targetSizeKb
      // If we are under target, we try to increase quality
      // If we are over target, we DECREASE quality

      if (sizeKb > targetSizeKb) {
        maxQuality = quality;

        // If we've hit absolute basement quality (0.05) and still too large,
        // we MUST reduce scale to meet the user's hard target.
        if (quality < 0.1) {
          currentScale *= 0.6; // Heavy reduction
          minQuality = 0.01;
          maxQuality = 0.95;
        }
      } else {
        // We are under size! This is good.
        // We can try to slightly increase quality to get closer to the limit.
        minQuality = quality;

        // If we are within 5% of target, we are done.
        if (sizeKb > targetSizeKb * 0.9) {
          break;
        }
      }
    } catch (err) {
      logger.error("Compression iteration error", err);
      if (bestBuffer) break;
      throw err;
    }

    iterations++;
  }

  onProgress(100, "Finalizing...");
  return bestBuffer;
}

export async function convertPdfToImages(
  pdfData: Uint8Array,
  options: { format: "png" | "jpeg"; scale?: number },
): Promise<Blob[]> {
  try {
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    const numPages = pdf.numPages;
    const images: Blob[] = [];
    const scale = options.scale || 2.0;

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));

      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not get 2D context from canvas");

      await page.render({ canvasContext: context, viewport }).promise;

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, `image/${options.format}`, 0.95),
      );

      if (blob) {
        images.push(blob);
      }
    }

    return images;
  } catch (err) {
    logger.error("Failed to convert PDF to images", err);
    throw err;
  }
}
