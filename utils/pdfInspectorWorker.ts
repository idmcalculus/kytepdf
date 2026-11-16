import init, {
  classifyPdf,
  detectPdf,
  extractText,
  type PdfClassification,
  type PdfProcessResult,
  processPdf,
  version,
} from "@firecrawl/pdf-inspector-wasm";
import { markdownToPlainText, stripInlineTags } from "./markdownText.ts";
import type {
  AnalysisEnvelope,
  WorkerFailure,
  WorkerFailureReason,
  WorkerRequest,
  WorkerResponse,
} from "./pdfInspectorTypes.ts";

/**
 * Served from public/wasm via scripts/sync-pdf-inspector-wasm.ts (stable origin
 * path, same convention as /pdf.worker.min.js). Absolute path keeps the fetch
 * same-origin regardless of where the worker chunk is hosted.
 */
function resolveWasmUrl(): string {
  return "/wasm/pdf_inspector_wasm_bg.wasm";
}

let engineVersion: string | null = null;
let loadPromise: Promise<string> | null = null;

async function ensureLoaded(): Promise<string> {
  if (engineVersion) return engineVersion;
  if (!loadPromise) {
    loadPromise = (async () => {
      const response = await fetch(resolveWasmUrl());
      if (!response.ok) {
        throw new Error(`pdf-inspector wasm fetch failed: ${response.status}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      await init({ module_or_path: bytes });
      engineVersion = version();
      return engineVersion;
    })().catch((err) => {
      // Clear so a transient fetch failure can retry on the next request.
      loadPromise = null;
      engineVersion = null;
      throw err;
    });
  }
  return loadPromise;
}

function mapFailure(err: unknown): WorkerFailure {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  let reason: WorkerFailureReason = "unknown";
  if (
    lower.includes("password") ||
    lower.includes("encrypted") ||
    lower.includes("permission") ||
    lower.includes("access denied")
  ) {
    reason =
      lower.includes("required") || lower.includes("need") ? "password-required" : "encrypted";
  } else if (
    lower.includes("malformed") ||
    lower.includes("invalid pdf") ||
    lower.includes("not a pdf") ||
    lower.includes("corrupt") ||
    lower.includes("truncated") ||
    // lopdf's wording for broken structure, such as a stale xref offset.
    lower.includes("pdf parsing error") ||
    lower.includes("invalid file trailer") ||
    lower.includes("io error")
  ) {
    reason = "malformed";
  } else if (
    lower.includes("memory") ||
    lower.includes("out of memory") ||
    lower.includes("allocation") ||
    lower.includes("resource")
  ) {
    reason = "resource-limit";
  } else if (
    lower.includes("unsupported") ||
    lower.includes("not supported") ||
    lower.includes("missing feature")
  ) {
    reason = "unsupported";
  }
  return { reason, message };
}

function normalizeClassification(cls: PdfClassification) {
  return {
    pdfType: cls.pdfType as WorkerResponse["classification"] extends infer T
      ? T extends { pdfType: infer P }
        ? P
        : never
      : never,
    pageCount: cls.pageCount,
    confidence: cls.confidence,
    // classifyPdf reports 0-indexed pages; normalize to 1-indexed.
    pagesNeedingOcr: cls.pagesNeedingOcr.map((p) => p + 1),
  };
}

function buildEnvelope(
  proc: PdfProcessResult,
  ver: string,
  warnings: string[],
  profile: "fidelity" | "compact",
): AnalysisEnvelope {
  const pagesNeedingOcr = Array.from(proc.pagesNeedingOcr).sort((a, b) => a - b);
  const ocrReasonsByPage = (proc.ocrReasonsByPage ?? []).slice().sort((a, b) => a.page - b.page);
  const outWarnings = warnings.slice();

  if (proc.hasEncodingIssues) {
    outWarnings.unshift(
      "Encoding issues detected in the source PDF; some characters may be missing or garbled.",
    );
  }
  if (pagesNeedingOcr.length > 0) {
    outWarnings.push(
      `This document needs OCR on page${pagesNeedingOcr.length === 1 ? "" : "s"} ${pagesNeedingOcr.join(", ")}. Text extraction is limited until those pages are OCR'd.`,
    );
  }
  if (proc.confidence < 0.5) {
    outWarnings.push("Confidence is low; results may be incomplete.");
  }
  if (profile === "compact" && proc.markdown && proc.markdown.length > 0) {
    outWarnings.push("Compact profile: output is token-optimized, not visually faithful.");
  }

  return {
    fileType: "application/pdf",
    pdfType: (proc.pdfType as AnalysisEnvelope["pdfType"]) || "Unknown",
    pageCount: proc.pageCount,
    confidence: proc.confidence,
    markdown: proc.markdown,
    title: proc.title,
    layout: {
      isComplex: proc.layout?.isComplex ?? false,
      pagesWithTables: Array.from(proc.layout?.pagesWithTables ?? []).sort((a, b) => a - b),
      pagesWithColumns: Array.from(proc.layout?.pagesWithColumns ?? []).sort((a, b) => a - b),
    },
    pagesNeedingOcr,
    ocrReasonsByPage,
    hasEncodingIssues: proc.hasEncodingIssues,
    engine: "pdf-inspector-wasm",
    engineVersion: ver,
    processingTimeMs: proc.processingTimeMs,
    warnings: outWarnings,
  };
}

async function handle(request: WorkerRequest): Promise<WorkerResponse> {
  const base: Pick<WorkerResponse, "id"> = { id: request.id };
  let ver: string;
  try {
    ver = await ensureLoaded();
  } catch (err) {
    // Kept apart from document errors so the page can fall back to its
    // legacy extractor instead of showing a download error to the user.
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
    const bytes = request.bytes;

    switch (request.kind) {
      case "classify": {
        const cls = classifyPdf(bytes);
        return {
          ...base,
          ok: true,
          classification: normalizeClassification(cls) as NonNullable<
            WorkerResponse["classification"]
          >,
        };
      }
      case "extract-text": {
        // Diagnostics still come from processPdf; plain text uses the upstream
        // extractText() export when password/page filters are not required.
        //
        // Page markers stay ON even though the caller wants plain text: the
        // envelope's markdown is what the OCR merge splits on to interleave
        // recognized pages in reading order. Without markers, OCR output for a
        // Mixed PDF gets appended after all native text instead of landing in
        // its own page slot. The `text` field below never carries them.
        const proc = processPdf(bytes, {
          profile: request.profile ?? "compact",
          includePageMarkers: true,
          password: request.password,
          pages: request.pages,
        });
        const envelope = buildEnvelope(proc, ver, [], request.profile ?? "compact");
        let text: string;
        if (!request.password && !request.pages?.length) {
          try {
            // extractText() keeps the <sup>/<sub> tags the Markdown has.
            text = stripInlineTags(extractText(bytes) ?? "");
          } catch (err) {
            // A trapped instance must not be used again; let the outer catch report it.
            if (err instanceof WebAssembly.RuntimeError) throw err;
            text = markdownToPlainText(proc.markdown ?? "");
          }
        } else {
          text = markdownToPlainText(proc.markdown ?? "");
        }
        return { ...base, ok: true, envelope, text };
      }
      case "extract-markdown":
      case "analyze": {
        const warnings: string[] = [];
        let proc: PdfProcessResult;
        try {
          proc = processPdf(bytes, {
            profile: request.profile ?? "fidelity",
            includePageMarkers: true,
            password: request.password,
            pages: request.pages,
          });
        } catch (err) {
          // A trapped instance must not be used again, not even for detectPdf.
          if (err instanceof WebAssembly.RuntimeError) throw err;
          // processPdf may raise on genuinely unusable input; detectPdf is the
          // lighter-weight fallback that still classifies without extraction.
          const det = detectPdf(bytes, { password: request.password });
          warnings.push(
            `Full extraction failed (${err instanceof Error ? err.message : String(err)}); returning detection only.`,
          );
          proc = det;
        }
        const envelope = buildEnvelope(proc, ver, warnings, request.profile ?? "fidelity");
        return { ...base, ok: true, envelope };
      }
      default:
        return {
          ...base,
          ok: false,
          failure: { reason: "unknown", message: `Unknown request kind` },
        };
    }
  } catch (err) {
    if (err instanceof WebAssembly.RuntimeError) {
      // A trap (usually running out of memory) leaves the WASM heap broken:
      // Rust destructors never ran. Ask the engine to replace this worker.
      return {
        ...base,
        ok: false,
        fatal: true,
        failure: {
          reason: "resource-limit",
          message: "The document is too large to process in this browser.",
        },
      };
    }
    return { ...base, ok: false, failure: mapFailure(err) };
  }
}

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (!request || typeof request.id !== "number") return;
  const response = await handle(request);
  (postMessage as (msg: WorkerResponse) => void)(response);
});
