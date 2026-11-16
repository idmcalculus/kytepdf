import init, { type Format, formatFromBytes, toMarkdownBytes } from "@firecrawl/anydoc-wasm";
import type {
  AnydocAnalysisEnvelope,
  AnydocErrorCode,
  AnydocFormat,
  AnydocWorkerFailure,
  AnydocWorkerRequest,
  AnydocWorkerResponse,
} from "./anydocTypes.ts";
import { SOURCE_MIME } from "./anydocTypes.ts";

let loaded = false;
let loadPromise: Promise<void> | null = null;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  if (!loadPromise) {
    loadPromise = (async () => {
      const response = await fetch("/wasm/anydoc_wasm_bg.wasm");
      if (!response.ok) {
        throw new Error(`anydoc wasm fetch failed: ${response.status}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      await init({ module_or_path: bytes });
      loaded = true;
    })().catch((err) => {
      // Clear so a transient fetch failure can retry on the next request.
      loadPromise = null;
      loaded = false;
      throw err;
    });
  }
  await loadPromise;
}

// anydoc does not export a `version()` function in 0.1.8; pin the known
// emitted version here for provenance. Bump this when upgrading the package.
const ANYDOC_WASM_VERSION = "0.1.8";

/**
 * The format read from the bytes wins, so a DOCX saved as report.doc still
 * converts. The caller's format (from the file extension) covers formats
 * with no signature, such as CSV.
 */
function mapFormat(
  detected: Format | undefined | null,
  requested: AnydocFormat | undefined,
): AnydocFormat | "unknown" {
  return (detected ?? requested ?? "unknown") as AnydocFormat | "unknown";
}

/** Reply for a WASM trap: the instance is broken, so the engine must replace the worker. */
function trapResponse(id: number): AnydocWorkerResponse {
  return {
    id,
    ok: false,
    fatal: true,
    failure: {
      reason: "resourceLimit",
      message: "The document is too large to process in this browser.",
    },
  };
}

function mapFailure(err: unknown): AnydocWorkerFailure {
  const error = err as { message?: string; code?: AnydocErrorCode } & Error;
  const message = error?.message ?? String(err);
  const code = error?.code ?? "unknown";
  // anydoc's `code` is already typed; normalize anything unexpected.
  const known: AnydocErrorCode[] = [
    "unsupported",
    "malformed",
    "encrypted",
    "resourceLimit",
    "missingPart",
  ];
  return {
    reason: known.includes(code as AnydocErrorCode) ? (code as AnydocErrorCode) : "unknown",
    message,
  };
}

async function handle(request: AnydocWorkerRequest): Promise<AnydocWorkerResponse> {
  const base: Pick<AnydocWorkerResponse, "id"> = { id: request.id };
  try {
    await ensureLoaded();
  } catch (err) {
    // Kept apart from document errors so the page can explain it plainly.
    return {
      ...base,
      ok: false,
      failure: {
        reason: "engine-unavailable",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  try {
    const start = performance.now();
    let detected: AnydocFormat | undefined;
    try {
      detected = (formatFromBytes(request.bytes) as AnydocFormat | undefined) ?? undefined;
    } catch (err) {
      if (err instanceof WebAssembly.RuntimeError) throw err;
      detected = undefined;
    }
    const format = mapFormat(detected, request.format);
    // anydoc can sniff formats this app has no MIME entry for (such as
    // "pdf"), so a miss falls back to the generic type too.
    const mime =
      (format !== "unknown" && SOURCE_MIME[format as keyof typeof SOURCE_MIME]) ||
      "application/octet-stream";

    let markdown: string;
    try {
      markdown =
        format === "unknown"
          ? toMarkdownBytes(request.bytes, undefined)
          : toMarkdownBytes(request.bytes, format as unknown as Format);
    } catch (err) {
      if (err instanceof WebAssembly.RuntimeError) return trapResponse(request.id);
      // The resulting markdown has the error code attached; let the caller
      // decide whether to convert it into an OCR fallback.
      const failure = mapFailure(err);
      if (failure.reason === "encrypted") {
        const e = err as Error & { code?: string };
        return {
          ...base,
          ok: false,
          failure: { ...failure, message: e?.message ?? "This document is encrypted." },
        };
      }
      return { ...base, ok: false, failure };
    }

    const warnings: string[] = [];
    if (!markdown.trim()) {
      warnings.push(
        "The document parser produced no text. The file may be empty or use an unsupported encoding.",
      );
    }
    if (detected === undefined && request.format === undefined) {
      warnings.push(
        "Format could not be detected from the bytes; Markdown output may not reflect the original structure.",
      );
    }

    const envelope: AnydocAnalysisEnvelope = {
      format,
      sourceMime: mime,
      markdown,
      warnings,
      engine: "anydoc-wasm",
      engineVersion: ANYDOC_WASM_VERSION,
      processingTimeMs: performance.now() - start,
      sourceName: request.sourceName,
    };
    return { ...base, ok: true, envelope };
  } catch (err) {
    if (err instanceof WebAssembly.RuntimeError) return trapResponse(request.id);
    return { ...base, ok: false, failure: mapFailure(err) };
  }
}

self.addEventListener("message", async (event: MessageEvent<AnydocWorkerRequest>) => {
  const request = event.data;
  if (!request || typeof request.id !== "number") return;
  const response = await handle(request);
  (postMessage as (msg: AnydocWorkerResponse) => void)(response);
});
