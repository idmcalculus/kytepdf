import { createWorker, type Worker as TesseractWorker } from "tesseract.js";
import { BoundedMap } from "./boundedCache.ts";
import { logger } from "./logger.ts";
import {
  DEFAULT_OCR_BUDGET,
  type OcrBudget,
  type OcrErrorReason,
  type OcrPageResult,
  type OcrRunResult,
  TESSERACT_ENGINE_VERSION,
} from "./ocrTypes.ts";
import { rasterizePdfPagesStream } from "./pageRasterizer.ts";

export class OcrError extends Error {
  reason: OcrErrorReason;
  constructor(reason: OcrErrorReason, message: string) {
    super(message);
    this.name = "OcrError";
    this.reason = reason;
  }
}

const PAGE_MARKER_RE = /<!--\s*Page\s+(\d+)\s*-->/g;

/**
 * Split markdown that contains `<!-- Page N -->` markers into ordered page chunks.
 * Markdown without markers is returned as a single chunk with page 0, and any
 * text before the first marker becomes a leading page-0 chunk.
 */
export function splitMarkdownByPage(markdown: string): Array<{ page: number; body: string }> {
  const matches = [...markdown.matchAll(PAGE_MARKER_RE)];
  if (matches.length === 0) {
    return [{ page: 0, body: markdown }];
  }
  const chunks: Array<{ page: number; body: string }> = [];
  const preamble = markdown.slice(0, matches[0].index).trim();
  if (preamble) chunks.push({ page: 0, body: preamble });
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const page = Number(m[1]);
    const start = (m.index ?? 0) + m[0].length;
    const end =
      i + 1 < matches.length ? (matches[i + 1].index ?? markdown.length) : markdown.length;
    chunks.push({ page, body: markdown.slice(start, end).trim() });
  }
  return chunks;
}

/**
 * Merge OCR page text into native markdown in page order.
 * OCR text replaces empty native page bodies; non-empty native text is kept and
 * OCR is appended under an "OCR" heading when both have content.
 */
export function mergeOcrIntoMarkdown(
  nativeMarkdown: string,
  ocrPages: OcrPageResult[],
  pageCount: number,
): string {
  const byPage = new Map(ocrPages.map((p) => [p.page, p]));
  const nativeChunks = splitMarkdownByPage(nativeMarkdown);
  const nativeByPage = new Map(nativeChunks.filter((c) => c.page > 0).map((c) => [c.page, c.body]));
  // Text before the first marker (or all of it, when there are no markers).
  const preamble = (nativeChunks.find((c) => c.page === 0)?.body ?? "").trim();

  // No markers: append OCR pages after native text.
  if (nativeByPage.size === 0) {
    const parts: string[] = [];
    if (preamble) parts.push(preamble);
    for (const p of [...byPage.keys()].sort((a, b) => a - b)) {
      const text = byPage.get(p)?.text.trim();
      if (!text) continue;
      parts.push(`<!-- Page ${p} -->\n\n${text}`);
    }
    return parts.join("\n\n").trim();
  }

  const maxPage = Math.max(pageCount, ...nativeByPage.keys(), ...byPage.keys(), 0);
  const out: string[] = preamble ? [preamble] : [];
  for (let page = 1; page <= maxPage; page++) {
    const native = (nativeByPage.get(page) ?? "").trim();
    const ocr = (byPage.get(page)?.text ?? "").trim();
    let body = native;
    if (!native && ocr) {
      body = ocr;
    } else if (native && ocr && !nativeIncludesOcr(native, ocr)) {
      body = `${native}\n\n### OCR (page ${page})\n\n${ocr}`;
    }
    if (body) {
      out.push(`<!-- Page ${page} -->\n\n${body}`);
    } else if (byPage.has(page) || nativeByPage.has(page)) {
      out.push(`<!-- Page ${page} -->\n\n`);
    }
  }
  return out.join("\n\n").trim();
}

function nativeIncludesOcr(native: string, ocr: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const n = norm(native);
  const o = norm(ocr);
  if (!o) return true;
  // Heuristic: if a substantial OCR sample already appears in native text, skip merge.
  const sample = o.slice(0, Math.min(80, o.length));
  return sample.length > 12 && n.includes(sample);
}

/** How long a new OCR worker may take to download its engine and language data. */
const WORKER_START_TIMEOUT_MS = 60_000;

/** Caps the recognized-page cache; each entry holds a page's worth of text. */
const MAX_OCR_CACHE_ENTRIES = 64;

class OcrEngine {
  private worker: TesseractWorker | null = null;
  private initPromise: Promise<TesseractWorker> | null = null;
  private cache = new BoundedMap<string, OcrPageResult>(MAX_OCR_CACHE_ENTRIES);
  private loadedLang = "";
  /** Incremented on every terminate() so stale in-flight spawns can bail out. */
  private generation = 0;

  private async ensureWorker(languages: string): Promise<TesseractWorker> {
    if (this.worker && this.loadedLang === languages) return this.worker;
    if (this.initPromise && this.loadedLang === languages) return this.initPromise;

    // Switching languages (or recovering from a torn-down worker) invalidates
    // any spawn already in flight. Bump the generation first so that spawn,
    // if it is still running, discards its worker instead of clobbering ours.
    this.generation++;
    const generation = this.generation;

    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch {
        /* ignore */
      }
      this.worker = null;
    }

    this.loadedLang = languages;
    this.initPromise = (async () => {
      // tesseract.js only rejects createWorker() when its first job fails. A
      // failed language-data download is reported to errorHandler alone and
      // createWorker() never settles, so race it against that report and a
      // start timeout. Without an errorHandler, tesseract also throws the
      // failure as an uncaught error.
      let rejectStart!: (err: OcrError) => void;
      const startFailed = new Promise<never>((_resolve, reject) => {
        rejectStart = reject;
      });
      startFailed.catch(() => {});
      const spawn = createWorker(languages, 1, {
        workerPath: "/tesseract/worker.min.js",
        // This build loads tesseract-core-simd-lstm.wasm from beside it. The
        // ".wasm.js" build carries its WASM inline and fetch()es that data:
        // URL, which the production connect-src blocks.
        corePath: "/tesseract/tesseract-core-simd-lstm.js",
        langPath: "/tesseract/lang-data",
        gzip: true,
        workerBlobURL: false,
        // tesseract's default logger already discards progress messages.
        errorHandler: (data: unknown) => {
          logger.warn("OCR worker reported an error", data);
          rejectStart(
            new OcrError(
              "worker-failed",
              `OCR could not start: ${typeof data === "string" ? data : "the OCR engine failed to load."}`,
            ),
          );
        },
      });
      let worker: TesseractWorker;
      try {
        worker = await this.withTimeout(
          Promise.race([spawn, startFailed]),
          WORKER_START_TIMEOUT_MS,
          "Starting OCR",
        );
      } catch (err) {
        // If the spawn still finishes later, don't leave that worker running.
        spawn.then((late) => late.terminate()).catch(() => {});
        throw err;
      }
      if (generation !== this.generation) {
        // A newer ensureWorker()/terminate() superseded this spawn while it was
        // loading. Drop it rather than leaking a second live Tesseract worker.
        try {
          await worker.terminate();
        } catch {
          /* ignore */
        }
        throw new OcrError(
          "worker-failed",
          "OCR worker was superseded before it finished loading.",
        );
      }
      this.worker = worker;
      return worker;
    })();

    try {
      return await this.initPromise;
    } catch (err) {
      if (generation === this.generation) {
        this.initPromise = null;
        this.worker = null;
        this.loadedLang = "";
      }
      throw err instanceof OcrError
        ? err
        : new OcrError(
            "worker-failed",
            err instanceof Error ? err.message : "Failed to start the OCR worker.",
          );
    }
  }

  private async hashPng(png: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", png.slice());
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Rejects with an OcrError("timeout") if `promise` outlives `ms`.
   *
   * Deliberately does NOT terminate the worker itself — the caller owns worker
   * lifecycle so it can re-acquire a fresh worker before the next page. (An
   * earlier version terminated here, which left the caller holding a
   * terminated worker reference and failed every subsequent page in the run.)
   */
  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new OcrError("timeout", `${label} timed out after ${ms}ms.`));
      }, ms);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }

  /**
   * OCR only the requested 1-indexed pages of a PDF. Lazy-loads tesseract on first use.
   */
  async ocrPdfPages(
    pdfBytes: Uint8Array,
    pages: number[],
    budget: Partial<OcrBudget> = {},
  ): Promise<OcrRunResult> {
    const cfg: OcrBudget = { ...DEFAULT_OCR_BUDGET, ...budget };
    const warnings: string[] = [];
    const started = performance.now();

    let targetPages = [...new Set(pages.filter((p) => p >= 1))].sort((a, b) => a - b);
    if (targetPages.length === 0) {
      return {
        pages: [],
        language: cfg.languages,
        engine: "tesseract.js",
        engineVersion: TESSERACT_ENGINE_VERSION,
        warnings: ["No pages requested for OCR."],
        totalProcessingTimeMs: 0,
      };
    }
    if (targetPages.length > cfg.maxPages) {
      warnings.push(
        `OCR limited to first ${cfg.maxPages} of ${targetPages.length} requested pages.`,
      );
      targetPages = targetPages.slice(0, cfg.maxPages);
    }

    const results: OcrPageResult[] = [];

    // Stream pages: rasterize → recognize → release, one page at a time, so a
    // large batch never holds every page PNG in memory simultaneously.
    const rasterStream = rasterizePdfPagesStream(pdfBytes, targetPages, cfg.maxEdgePx);

    try {
      for await (const raster of rasterStream) {
        const cacheKey = `${await this.hashPng(raster.png)}:${cfg.languages}`;
        const cached = this.cache.get(cacheKey);
        if (cached) {
          results.push({ ...cached, page: raster.page });
          continue;
        }

        // Re-acquire per page: a previous page's timeout tears the worker down,
        // and this returns the existing worker when it is still healthy.
        let worker: TesseractWorker;
        try {
          worker = await this.ensureWorker(cfg.languages);
        } catch (err) {
          // Without a worker no further page can succeed — stop rather than
          // emitting one identical failure warning per remaining page.
          warnings.push(
            `OCR stopped at page ${raster.page}: ${err instanceof Error ? err.message : "worker unavailable"}`,
          );
          logger.warn("OCR worker unavailable; aborting remaining pages", err);
          break;
        }

        const pageStart = performance.now();
        try {
          const blob = new Blob([raster.png.buffer as ArrayBuffer], { type: "image/png" });
          const { data } = await this.withTimeout(
            worker.recognize(blob),
            cfg.pageTimeoutMs,
            `OCR page ${raster.page}`,
          );
          const entry: OcrPageResult = {
            page: raster.page,
            text: (data.text ?? "").trim(),
            confidence: typeof data.confidence === "number" ? data.confidence / 100 : 0,
            processingTimeMs: Math.round(performance.now() - pageStart),
          };
          this.cache.set(cacheKey, entry);
          results.push(entry);
        } catch (err) {
          if (err instanceof OcrError && err.reason === "timeout") {
            warnings.push(`Page ${raster.page} OCR timed out; skipped.`);
            logger.warn(`OCR timeout on page ${raster.page}`, err);
            // The worker is still grinding on the timed-out page; tear it down
            // so the next iteration starts from a clean one.
            await this.terminate();
            continue;
          }
          warnings.push(
            `Page ${raster.page} OCR failed: ${err instanceof Error ? err.message : "unknown error"}`,
          );
          logger.warn(`OCR failed on page ${raster.page}`, err);
        }
      }
    } catch (err) {
      // Per-page recognition failures are handled inside the loop, so anything
      // escaping it came from rasterization (bad/encrypted PDF, no canvas).
      const message = err instanceof Error ? err.message : "Failed to rasterize PDF pages for OCR.";
      if (results.length === 0) {
        // Nothing was read: surface it as a typed OcrError.
        throw err instanceof OcrError ? err : new OcrError("unsupported", message);
      }
      // Keep the pages already read; the caller reports the rest as missing.
      warnings.push(`OCR stopped at a page that could not be rendered: ${message}`);
      logger.warn("OCR rasterization failed mid-run; returning partial results", err);
    } finally {
      // Ensures the generator's own `finally` runs (destroying the pdf.js doc)
      // even when the loop exits early via break or throw.
      await rasterStream.return?.(undefined);
    }

    return {
      pages: results,
      language: cfg.languages,
      engine: "tesseract.js",
      engineVersion: TESSERACT_ENGINE_VERSION,
      warnings,
      totalProcessingTimeMs: Math.round(performance.now() - started),
    };
  }

  /**
   * Extract native markdown, OCR pagesNeedingOcr, and merge in page order.
   * Does not call pdf-inspector itself — caller supplies native text + pages.
   */
  async enrichMarkdownWithOcr(
    pdfBytes: Uint8Array,
    nativeMarkdown: string,
    pagesNeedingOcr: number[],
    pageCount: number,
    budget?: Partial<OcrBudget>,
  ): Promise<{ markdown: string; ocr: OcrRunResult }> {
    const ocr = await this.ocrPdfPages(pdfBytes, pagesNeedingOcr, budget);
    const markdown = mergeOcrIntoMarkdown(nativeMarkdown, ocr.pages, pageCount);
    return { markdown, ocr };
  }

  async terminate(): Promise<void> {
    // Invalidate any spawn still in flight so it disposes of its worker
    // instead of installing it after we have torn everything down.
    this.generation++;
    const worker = this.worker;
    this.worker = null;
    this.initPromise = null;
    this.loadedLang = "";
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        /* ignore */
      }
    }
  }
}

export const ocrEngine = new OcrEngine();
