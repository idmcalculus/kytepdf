import {
  type AnydocAnalysisEnvelope,
  type AnydocFormat,
  type AnydocWorkerFailure,
  type AnydocWorkerRequest,
  type AnydocWorkerResponse,
  isAnydocCandidate,
} from "./anydocTypes.ts";
import { BoundedMap } from "./boundedCache.ts";
import { logger } from "./logger.ts";

export class AnydocError extends Error {
  reason: AnydocWorkerFailure["reason"];
  constructor(failure: AnydocWorkerFailure) {
    super(failure.message);
    this.name = "AnydocError";
    this.reason = failure.reason;
  }
}

export interface AnydocConvertOptions {
  /** Explicit format (e.g. "csv"); omitted to auto-detect from bytes. */
  format?: AnydocFormat;
  sourceName?: string;
}

const REQUEST_TIMEOUT_MS = 120_000;
// Caps in-memory session cache growth for long-running sessions that process
// many large documents (each entry can hold a full converted markdown
// envelope).
const MAX_CACHE_ENTRIES = 20;

class AnydocEngine {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (r: AnydocWorkerResponse) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private cache = new BoundedMap<string, AnydocAnalysisEnvelope>(MAX_CACHE_ENTRIES);
  private hashCache = new WeakMap<Uint8Array, string>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    // Creation is synchronous. If it throws, nothing is kept, so the next
    // request tries again instead of repeating the old failure.
    // Inline URL construction so Vite bundles the worker as JS in production.
    const w = new Worker(new URL("./anydocWorker.ts", import.meta.url), { type: "module" });
    w.addEventListener("message", (event: MessageEvent<AnydocWorkerResponse>) => {
      const response = event.data;
      if (!response || typeof response.id !== "number") return;
      const handler = this.pending.get(response.id);
      if (!handler) return;
      this.pending.delete(response.id);
      clearTimeout(handler.timer);
      handler.resolve(response);
      if (response.fatal) {
        // The WASM instance trapped; every later call on it would fail too.
        this.terminateWorker(new Error("The document converter stopped and was restarted."));
      }
    });
    w.addEventListener("error", (err) => {
      // A worker that has already been replaced may still report; only the
      // current one may tear down the requests in flight.
      if (w !== this.worker) return;
      logger.error("anydoc worker error", err);
      this.terminateWorker(new Error("The document analysis worker crashed."));
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

  private async send(request: Omit<AnydocWorkerRequest, "id">): Promise<AnydocWorkerResponse> {
    let worker: Worker;
    try {
      worker = this.ensureWorker();
    } catch (err) {
      throw err instanceof Error ? err : new Error("Failed to start the document analysis worker.");
    }
    const hash = await this.hashBytes(request.bytes);
    const cacheKey = `${hash}:${request.format ?? "auto"}:${request.sourceName ?? ""}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { id: -1, ok: true, envelope: cached };
    }
    return new Promise<AnydocWorkerResponse>((resolve, reject) => {
      const id = this.nextId++;
      // Transfer a dedicated copy so the caller's buffer remains usable.
      const workerBytes = request.bytes.slice();
      const full: AnydocWorkerRequest = { id, ...request, bytes: workerBytes };
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        // The worker is presumed stuck/dead — tear it down and reject every
        // other in-flight request now instead of letting them strand until
        // their own timers individually expire.
        this.terminateWorker(
          new AnydocError({ reason: "resourceLimit", message: "Document conversion timed out." }),
        );
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (response) => {
          if (response.ok && response.envelope) {
            this.cache.set(cacheKey, response.envelope);
          }
          resolve(response);
        },
        reject,
        timer,
      });
      worker.postMessage(full, [workerBytes.buffer]);
    });
  }

  async convert(
    bytes: Uint8Array,
    options: AnydocConvertOptions = {},
  ): Promise<AnydocAnalysisEnvelope> {
    const response = await this.send({
      bytes,
      format: options.format,
      sourceName: options.sourceName,
    });
    if (!response.ok || !response.envelope) {
      throw new AnydocError(
        response.failure ?? { reason: "unknown", message: "Conversion returned no result." },
      );
    }
    return response.envelope;
  }

  /** True when the file extension is one anydoc handles. */
  supports(name: string): boolean {
    return isAnydocCandidate(name);
  }

  clearSessionCache(): void {
    this.cache.clear();
  }
}

export const anydocEngine = new AnydocEngine();
