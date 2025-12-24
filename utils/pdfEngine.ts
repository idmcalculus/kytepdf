import { logger } from "./logger.ts";
import { PDFDocument, pdfjsLib } from "./pdfConfig.ts";

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
