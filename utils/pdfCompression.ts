/**
 * PDF compression by re-rendering each page as a JPEG image.
 *
 * Hitting a target size means choosing a render scale and a JPEG quality.
 * Rendering a whole document is slow (a large scan can take minutes per
 * pass), so the settings are chosen from a sample of pages. The whole
 * document is then rendered once, plus at most two correcting passes when the
 * sample misjudged the size.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import { UserFacingError } from "./errorMapper.ts";
import { logger } from "./logger.ts";
import { PDFDocument, pdfjsLib } from "./pdfConfig.ts";
import { destroyPdfDocument } from "./pdfDocument.ts";
import { loadProcessablePdfJsDocument } from "./pdfSecurity.ts";
import { yieldToMain } from "./taskScheduler.ts";

export type CompressionProgressCallback = (percent: number, status: string) => void;

export interface CompressPdfOptions {
  /**
   * The share of the original size the user asked for, from 0.01 to 0.95. It
   * sets the starting resolution. Derived from the target size when omitted.
   */
  targetRatio?: number;
  /**
   * An open pdf.js document for the same file, such as the preview's. Reusing
   * it saves loading a large file into memory a second time. The caller keeps
   * ownership: compressPdf never destroys it.
   */
  document?: PDFDocumentProxy | null;
}

interface RenderSettings {
  scale: number;
  quality: number;
}

/** Estimated output size at each of QUALITY_STEPS, for one render scale. */
interface SizeModel {
  scale: number;
  totals: number[];
}

interface Plan {
  settings: RenderSettings;
  /** Output size the size model predicts for these settings, in bytes. */
  estimate: number;
}

interface PageSize {
  width: number;
  height: number;
}

/**
 * JPEG qualities measured on the sample pages. Sizes between them are
 * interpolated. Each step costs one encode per sample page, and sizes climb
 * fastest at the top, so the steps are closer together there.
 */
const QUALITY_STEPS = [0.05, 0.15, 0.3, 0.45, 0.6, 0.75, 0.85, 0.95];
const MIN_QUALITY = QUALITY_STEPS[0];
const MAX_QUALITY = QUALITY_STEPS[QUALITY_STEPS.length - 1];

const SAMPLE_PAGE_COUNT = 8;
const MIN_SCALE = 0.2;
const MAX_PLANNING_STEPS = 6;
/** Aim slightly under the target so small estimation errors still fit. */
const TARGET_HEADROOM = 0.97;
/** At full quality, a plan this far under the target can afford more resolution. */
const UNDERUSED_TARGET_SHARE = 0.65;
/** A pass that fits and fills at least this share of the target is kept. */
const ACCEPTABLE_FILL = 0.75;
/** Bytes pdf-lib writes per page besides the image: page and content objects, xref entries. */
const PAGE_OVERHEAD_BYTES = 600;
const DOCUMENT_OVERHEAD_BYTES = 2048;
/**
 * Safari refuses canvases above 16,777,216 pixels, and other browsers slow
 * down sharply well before their own limits. Larger pages render at a lower
 * scale instead.
 */
const MAX_CANVAS_PIXELS = 16_777_216;

/** Progress range for each full pass. Later passes only fine-tune, so they get less of the bar. */
const PASS_PROGRESS: ReadonlyArray<readonly [number, number]> = [
  [15, 90],
  [90, 96],
  [96, 99],
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Wraps a progress callback so the bar never moves backwards, for example
 * when settings are re-checked between passes.
 */
function forwardOnlyProgress(onProgress: CompressionProgressCallback): CompressionProgressCallback {
  let highest = 0;
  return (percent, status) => {
    highest = Math.max(highest, percent);
    onProgress(highest, status);
  };
}

/**
 * Compresses a PDF towards `targetSizeKb` by rendering every page to a JPEG.
 * Returns the result that fits the target with the best quality, or the
 * smallest result if nothing fits.
 */
export async function compressPdf(
  file: File,
  targetSizeKb: number,
  onProgress: CompressionProgressCallback,
  options: CompressPdfOptions = {},
): Promise<Uint8Array> {
  const report = forwardOnlyProgress(onProgress);
  const targetBytes = targetSizeKb * 1024;
  const targetRatio = clamp(
    options.targetRatio ?? targetBytes / Math.max(file.size, targetBytes),
    0.01,
    0.95,
  );

  report(2, "Opening PDF...");
  const ownsDocument = !options.document;
  const pdf = options.document ?? (await loadProcessablePdfJsDocument(file)).pdfDoc;

  try {
    const numPages = pdf.numPages;
    if (numPages < 1) {
      throw new UserFacingError("This PDF has no pages to compress.");
    }

    const renderer = new PageImageRenderer(pdf);
    const samplePages = pickSamplePages(numPages);
    let sampledPages = 0;
    const planner = new SettingsPlanner(
      (scale) =>
        measureSizeModel(renderer, samplePages, numPages, scale, () => {
          sampledPages += 1;
          report(Math.min(15, 5 + sampledPages), "Choosing compression settings...");
        }),
      getStartScale(targetRatio),
      getMaxScale(targetRatio),
    );

    const runPass = async (pass: number, passPlan: Plan) => {
      const [start, end] = PASS_PROGRESS[pass];
      const action = pass === 0 ? "Compressing" : "Fine-tuning size:";
      const output = await renderDocument(renderer, numPages, passPlan.settings, (pageNumber) => {
        report(
          start + ((end - start) * pageNumber) / numPages,
          `${action} page ${pageNumber} of ${numPages}...`,
        );
      });
      logger.debug(`Compression pass ${pass + 1}`, {
        ...passPlan.settings,
        estimate: passPlan.estimate,
        size: output.length,
        target: targetBytes,
      });
      return output;
    };

    report(5, "Choosing compression settings...");
    let plan = await planner.plan(targetBytes);
    let output = await runPass(0, plan);
    let best = output;

    for (let pass = 1; pass < PASS_PROGRESS.length && !fitsWell(output, targetBytes); pass++) {
      try {
        // The sample misjudged the document as a whole. Scale the target by
        // the error and plan again on the same size models.
        const next = await planner.plan(targetBytes / (output.length / plan.estimate));
        if (isSameSettings(next.settings, plan.settings)) break;
        plan = next;
        output = await runPass(pass, plan);
      } catch (error) {
        // Later passes only refine the size, so the earlier result still stands.
        logger.error("Compression refinement failed; keeping the earlier result", error);
        break;
      }
      best = pickBetterResult(best, output, targetBytes);
    }

    report(100, "Finalizing...");
    return best;
  } finally {
    if (ownsDocument) {
      await destroyPdfDocument(pdf).catch((error: unknown) => {
        logger.warn("Failed to release the compression document", error);
      });
    }
  }
}

/** Renders pages of one document onto a single reused canvas. */
class PageImageRenderer {
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;

  constructor(private readonly pdf: PDFDocumentProxy) {
    const context = this.canvas.getContext("2d");
    if (!context) {
      throw new UserFacingError(
        "Your browser could not create the drawing surface needed to compress this PDF.",
      );
    }
    this.context = context;
  }

  /**
   * Renders a page and hands the canvas to `use`. The canvas is reused for
   * the next page, so `use` must finish with it before returning. The page's
   * cached data is released afterwards, which keeps memory flat across long
   * documents.
   */
  async withRenderedPage<T>(
    pageNumber: number,
    scale: number,
    use: (canvas: HTMLCanvasElement, pageSize: PageSize) => Promise<T>,
  ): Promise<T> {
    const page = await this.pdf.getPage(pageNumber);
    try {
      const { width, height } = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: fitScaleToCanvasLimit(width, height, scale) });
      this.canvas.width = Math.max(1, Math.floor(viewport.width));
      this.canvas.height = Math.max(1, Math.floor(viewport.height));
      await page.render({
        canvas: this.canvas,
        canvasContext: this.context,
        viewport,
        // Draw form fields too. The default leaves them to an HTML layer,
        // which a flattened image does not have.
        annotationMode: pdfjsLib.AnnotationMode.ENABLE,
      }).promise;
      return await use(this.canvas, { width, height });
    } finally {
      page.cleanup();
    }
  }
}

function fitScaleToCanvasLimit(width: number, height: number, scale: number) {
  const pixels = width * height * scale * scale;
  return pixels > MAX_CANVAS_PIXELS ? scale * Math.sqrt(MAX_CANVAS_PIXELS / pixels) : scale;
}

function encodeJpeg(canvas: HTMLCanvasElement, quality: number, pageNumber: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(
            new UserFacingError(
              `Your browser could not encode page ${pageNumber}. It may be out of memory. Close other tabs and try again.`,
            ),
          );
        }
      },
      "image/jpeg",
      quality,
    );
  });
}

/** Up to SAMPLE_PAGE_COUNT page numbers spread evenly through the document. */
export function pickSamplePages(numPages: number, count = SAMPLE_PAGE_COUNT): number[] {
  if (numPages <= count) {
    return Array.from({ length: numPages }, (_, index) => index + 1);
  }
  return Array.from(
    { length: count },
    (_, index) => Math.floor(((index + 0.5) * numPages) / count) + 1,
  );
}

/**
 * Renders the sample pages at `scale`, encodes each at every quality step
 * and extrapolates the sizes to the whole document.
 */
async function measureSizeModel(
  renderer: PageImageRenderer,
  samplePages: number[],
  numPages: number,
  scale: number,
  onPageMeasured: () => void,
): Promise<SizeModel> {
  const sampleBytes = QUALITY_STEPS.map(() => 0);

  for (const pageNumber of samplePages) {
    await renderer.withRenderedPage(pageNumber, scale, async (canvas) => {
      for (const [index, quality] of QUALITY_STEPS.entries()) {
        sampleBytes[index] += (await encodeJpeg(canvas, quality, pageNumber)).size;
      }
    });
    onPageMeasured();
    await yieldToMain();
  }

  const pagesPerSample = numPages / samplePages.length;
  const overhead = numPages * PAGE_OVERHEAD_BYTES + DOCUMENT_OVERHEAD_BYTES;
  // JPEG size grows with quality. Enforcing that guards the search against
  // the odd encoder result that breaks it.
  let runningMax = 0;
  const totals = sampleBytes.map((bytes) => {
    runningMax = Math.max(runningMax, bytes * pagesPerSample + overhead);
    return runningMax;
  });

  return { scale, totals };
}

/** The highest quality whose estimated size fits `targetBytes`, or null if none does. */
export function solveQuality(totals: readonly number[], targetBytes: number): number | null {
  if (totals[0] > targetBytes) return null;

  let index = 0;
  while (index + 1 < totals.length && totals[index + 1] <= targetBytes) {
    index += 1;
  }
  if (index === totals.length - 1) return MAX_QUALITY;

  const fraction = (targetBytes - totals[index]) / (totals[index + 1] - totals[index]);
  return QUALITY_STEPS[index] + fraction * (QUALITY_STEPS[index + 1] - QUALITY_STEPS[index]);
}

/** The estimated size at `quality`, interpolated between the measured steps. */
export function estimateSize(totals: readonly number[], quality: number): number {
  if (quality <= MIN_QUALITY) return totals[0];
  if (quality >= MAX_QUALITY) return totals[totals.length - 1];

  const upper = QUALITY_STEPS.findIndex((step) => step >= quality);
  const lower = upper - 1;
  const fraction = (quality - QUALITY_STEPS[lower]) / (QUALITY_STEPS[upper] - QUALITY_STEPS[lower]);
  return totals[lower] + fraction * (totals[upper] - totals[lower]);
}

/**
 * Chooses render settings for a target size from sample measurements. Size
 * models are cached per scale, so planning again after a pass is cheap.
 */
class SettingsPlanner {
  private readonly models = new Map<number, SizeModel>();

  constructor(
    private readonly measure: (scale: number) => Promise<SizeModel>,
    private readonly startScale: number,
    private readonly maxScale: number,
  ) {}

  /**
   * Picks the settings with the best quality whose estimate fits
   * `targetBytes`. When nothing fits, picks the smallest settings measured.
   */
  async plan(targetBytes: number): Promise<Plan> {
    const aim = targetBytes * TARGET_HEADROOM;
    let scale = this.startScale;
    let lastFit: Plan | null = null;
    let smallest: SizeModel | null = null;

    for (let step = 0; step < MAX_PLANNING_STEPS; step++) {
      const model = await this.modelAt(scale);
      if (!smallest || model.totals[0] < smallest.totals[0]) smallest = model;

      const quality = solveQuality(model.totals, aim);
      if (quality === null) {
        // The previous, smaller scale fitted; the larger one tried after it did not.
        if (lastFit) return lastFit;
        if (scale <= MIN_SCALE) break;
        // Size follows the pixel count, which grows with the square of the scale.
        const shrink = clamp(Math.sqrt(aim / model.totals[0]), 0.3, 0.9);
        scale = Math.max(MIN_SCALE, scale * shrink);
        continue;
      }

      const plan = { settings: { scale, quality }, estimate: estimateSize(model.totals, quality) };
      const canAffordMoreDetail =
        quality >= MAX_QUALITY &&
        plan.estimate < targetBytes * UNDERUSED_TARGET_SHARE &&
        scale < this.maxScale;
      if (!canAffordMoreDetail) return plan;

      lastFit = plan;
      // Go straight to the scale whose full-quality size should reach the
      // target. Each scale tried costs a round of sample renders.
      scale = Math.min(this.maxScale, scale * Math.sqrt(aim / plan.estimate));
    }

    if (lastFit) return lastFit;
    const fallback = smallest as SizeModel;
    return {
      settings: { scale: fallback.scale, quality: MIN_QUALITY },
      estimate: fallback.totals[0],
    };
  }

  private async modelAt(scale: number) {
    let model = this.models.get(scale);
    if (!model) {
      model = await this.measure(scale);
      this.models.set(scale, model);
    }
    return model;
  }
}

/** Renders every page with `settings` into a new image-only PDF. */
async function renderDocument(
  renderer: PageImageRenderer,
  numPages: number,
  settings: RenderSettings,
  onPageDone: (pageNumber: number) => void,
): Promise<Uint8Array> {
  const output = await PDFDocument.create();

  for (let pageNumber = 1; pageNumber <= numPages; pageNumber++) {
    const { imageBytes, pageSize } = await renderer.withRenderedPage(
      pageNumber,
      settings.scale,
      async (canvas, pageSize) => {
        const blob = await encodeJpeg(canvas, settings.quality, pageNumber);
        return { imageBytes: new Uint8Array(await blob.arrayBuffer()), pageSize };
      },
    );

    const image = await output.embedJpg(imageBytes);
    // Keep the original page size in points, whatever resolution the image has.
    output.addPage([pageSize.width, pageSize.height]).drawImage(image, {
      x: 0,
      y: 0,
      width: pageSize.width,
      height: pageSize.height,
    });

    onPageDone(pageNumber);
    if (pageNumber % 2 === 0) {
      await yieldToMain();
    }
  }

  return output.save();
}

/** Prefers a result that fits the target, then the larger fitting one (better quality), else the smaller one. */
function pickBetterResult(current: Uint8Array, candidate: Uint8Array, targetBytes: number) {
  const currentFits = current.length <= targetBytes;
  const candidateFits = candidate.length <= targetBytes;
  if (currentFits !== candidateFits) {
    return candidateFits ? candidate : current;
  }
  if (candidateFits) {
    return candidate.length > current.length ? candidate : current;
  }
  return candidate.length < current.length ? candidate : current;
}

/** True when a result fits the target and uses enough of it to keep. */
function fitsWell(output: Uint8Array, targetBytes: number) {
  return output.length <= targetBytes && output.length >= targetBytes * ACCEPTABLE_FILL;
}

function isSameSettings(a: RenderSettings, b: RenderSettings) {
  return Math.abs(a.scale - b.scale) < 1e-3 && Math.abs(a.quality - b.quality) < 1e-3;
}

function getStartScale(targetRatio: number) {
  if (targetRatio <= 0.15) return 0.85;
  if (targetRatio <= 0.45) return 1.15;
  return 1.5;
}

function getMaxScale(targetRatio: number) {
  if (targetRatio <= 0.15) return 1.0;
  if (targetRatio <= 0.45) return 1.6;
  return 2.4;
}
