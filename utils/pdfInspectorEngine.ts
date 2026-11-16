import { BoundedMap } from "./boundedCache.ts";
import { logger } from "./logger.ts";
import type {
  AnalysisEnvelope,
  WorkerFailure,
  WorkerFailureReason,
  WorkerRequest,
  WorkerResponse,
} from "./pdfInspectorTypes.ts";

export class PdfInspectorError extends Error {
  reason: WorkerFailureReason;
  constructor(failure: WorkerFailure) {
    super(failure.message);
    this.name = "PdfInspectorError";
    this.reason = failure.reason;
  }
}

export interface AnalyzeOptions {
  password?: string;
  pages?: number[];
  profile?: "fidelity" | "compact";
}

interface CacheEntry {
  envelope: AnalysisEnvelope;
  text: string;
}

const REQUEST_TIMEOUT_MS = 120_000;
// Caps in-memory session cache growth for long-running sessions that process
// many large PDFs (each entry can hold a full extracted markdown envelope).
const MAX_CACHE_ENTRIES = 20;

class PdfInspectorEngine {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (r: WorkerResponse) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private cache = new BoundedMap<string, CacheEntry>(MAX_CACHE_ENTRIES);
  private hashCache = new WeakMap<Uint8Array, string>();

  /** Spawn the worker lazily, only when inspection/extraction is requested. */
  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    // Creation is synchronous. If it throws, nothing is kept, so the next
    // request tries again instead of repeating the old failure.
    // Inline URL construction so Vite bundles the worker as JS in production.
    const w = new Worker(new URL("./pdfInspectorWorker.ts", import.meta.url), {
      type: "module",
    });
    w.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (!response || typeof response.id !== "number") return;
      const handler = this.pending.get(response.id);
      if (!handler) return;
      this.pending.delete(response.id);
      clearTimeout(handler.timer);
      handler.resolve(response);
      if (response.fatal) {
        // The WASM instance trapped; every later call on it would fail too.
        this.terminateWorker(new Error("The PDF analysis engine stopped and was restarted."));
      }
    });
    w.addEventListener("error", (err) => {
      // A worker that has already been replaced may still report; only the
      // current one may tear down the requests in flight.
      if (w !== this.worker) return;
      logger.error("pdf-inspector worker error", err);
      this.terminateWorker(new Error("The PDF analysis worker crashed."));
    });
    this.worker = w;
    return w;
  }

  /**
   * Centralized shutdown: reject and clear *every* pending request, not just
   * the one that triggered the shutdown. A worker crash or a single request
   * timeout invalidates the whole worker, so leaving other pending requests
   * dangling on their own individual timers just makes them wait out the
   * full timeout window for an answer that will never arrive.
   */
  private terminateWorker(reason: Error): void {
    for (const [, handler] of this.pending) {
      clearTimeout(handler.timer);
      handler.reject(reason);
    }
    this.pending.clear();
    try {
      this.worker?.terminate();
    } catch {
      /* ignore */
    }
    this.worker = null;
  }

  private async hashBytes(bytes: Uint8Array): Promise<string> {
    const cached = this.hashCache.get(bytes);
    if (cached) return cached;
    const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    this.hashCache.set(bytes, hex);
    return hex;
  }

  private optionsKey(options: AnalyzeOptions = {}): string {
    const pages = options.pages?.length
      ? options.pages
          .slice()
          .sort((a, b) => a - b)
          .join(",")
      : "";
    const password = options.password ? "pw" : "";
    const profile = options.profile ?? "";
    return `${profile}|${pages}|${password}`;
  }

  private async send(
    request: Omit<WorkerRequest, "id" | "hash"> & { hash: string },
  ): Promise<WorkerResponse> {
    let worker: Worker;
    try {
      worker = this.ensureWorker();
    } catch (err) {
      throw err instanceof Error ? err : new Error("Failed to start the PDF analysis worker.");
    }
    return new Promise<WorkerResponse>((resolve, reject) => {
      const id = this.nextId++;
      // Transfer a dedicated copy so the caller's ArrayBuffer stays usable for
      // OCR, fallbacks, and subsequent format extractions.
      const workerBytes = request.bytes.slice();
      const full: WorkerRequest = { id, ...request, bytes: workerBytes };
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        // The worker is presumed stuck/dead — tear it down and reject every
        // other in-flight request now instead of letting them strand until
        // their own timers individually expire.
        this.terminateWorker(
          new PdfInspectorError({ reason: "resource-limit", message: "PDF analysis timed out." }),
        );
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage(full, [workerBytes.buffer]);
    });
  }

  private unwrap(
    response: WorkerResponse,
    op: string,
  ): { envelope: AnalysisEnvelope; text: string } {
    if (!response.ok || !response.envelope) {
      throw new PdfInspectorError(
        response.failure ?? { reason: "unknown", message: `${op} returned no result.` },
      );
    }
    return { envelope: response.envelope, text: response.text ?? "" };
  }

  /**
   * NOTE: the underlying `classifyPdf` wasm binding only accepts raw bytes —
   * it has no password parameter. `options.password` is accepted here for a
   * consistent call shape with `analyze`/`extractText`, but it is silently
   * unusable for classification of encrypted PDFs; use `analyze()` or
   * `extractText()` instead if the document may be password-protected.
   */
  async classify(
    bytes: Uint8Array,
    options: AnalyzeOptions = {},
  ): Promise<WorkerResponse["classification"]> {
    if (options.password) {
      logger.warn(
        "pdfInspectorEngine.classify() cannot apply a password — the classify worker call " +
          "ignores it. Use analyze() or extractText() for password-protected PDFs.",
      );
    }
    const hash = await this.hashBytes(bytes);
    const response = await this.send({
      kind: "classify",
      hash,
      bytes,
      password: options.password,
    });
    if (!response.ok || !response.classification) {
      throw new PdfInspectorError(
        response.failure ?? { reason: "unknown", message: "classify returned no result." },
      );
    }
    return response.classification;
  }

  async analyze(bytes: Uint8Array, options: AnalyzeOptions = {}): Promise<AnalysisEnvelope> {
    const hash = await this.hashBytes(bytes);
    const cacheKey = `${hash}:analyze:${this.optionsKey(options)}`;
    // The cache key only encodes *whether* a password was supplied, not
    // which one — caching a passworded result would let an unrelated
    // (possibly wrong) password on the same bytes silently reuse a result
    // obtained with a different password. Skip the cache entirely for
    // passworded requests rather than persist that ambiguity.
    if (!options.password) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached.envelope;
    }
    const response = await this.send({
      kind: "analyze",
      hash: cacheKey,
      bytes,
      password: options.password,
      pages: options.pages,
      profile: options.profile,
    });
    const { envelope } = this.unwrap(response, "analyze");
    if (!options.password) {
      this.cache.set(cacheKey, { envelope, text: response.text ?? "" });
    }
    return envelope;
  }

  async extractMarkdown(
    bytes: Uint8Array,
    options: AnalyzeOptions = {},
  ): Promise<AnalysisEnvelope> {
    const hash = await this.hashBytes(bytes);
    const profile = options.profile ?? "fidelity";
    const cacheKey = `${hash}:md:${this.optionsKey({ ...options, profile })}`;
    // See analyze(): don't cache passworded requests, since the key can't
    // distinguish which password produced the cached result.
    if (!options.password) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached.envelope;
    }
    const response = await this.send({
      kind: "extract-markdown",
      hash: cacheKey,
      bytes,
      password: options.password,
      pages: options.pages,
      profile,
    });
    const { envelope } = this.unwrap(response, "extract-markdown");
    if (!options.password) {
      this.cache.set(cacheKey, { envelope, text: envelope.markdown ?? "" });
    }
    return envelope;
  }

  async extractText(
    bytes: Uint8Array,
    options: AnalyzeOptions = {},
  ): Promise<{ envelope: AnalysisEnvelope; text: string }> {
    const hash = await this.hashBytes(bytes);
    const profile = options.profile ?? "compact";
    const cacheKey = `${hash}:txt:${this.optionsKey({ ...options, profile })}`;
    // See analyze(): don't cache passworded requests, since the key can't
    // distinguish which password produced the cached result.
    if (!options.password) {
      const cached = this.cache.get(cacheKey);
      if (cached) return { envelope: cached.envelope, text: cached.text };
    }
    const response = await this.send({
      kind: "extract-text",
      hash: cacheKey,
      bytes,
      password: options.password,
      pages: options.pages,
      profile,
    });
    const { envelope } = this.unwrap(response, "extract-text");
    if (!options.password) {
      this.cache.set(cacheKey, { envelope, text: response.text ?? "" });
    }
    return { envelope, text: response.text ?? "" };
  }

  clearSessionCache(): void {
    this.cache.clear();
  }
}

export const pdfInspectorEngine = new PdfInspectorEngine();
