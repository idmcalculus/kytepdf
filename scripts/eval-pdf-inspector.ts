import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import init, {
  classifyPdf,
  detectPdf,
  type PdfClassification,
  type PdfProcessResult,
  processPdf,
  version,
} from "@firecrawl/pdf-inspector-wasm";
import { logger } from "../utils/logger.ts";

const CORPUS_DIR = join(process.cwd(), "tmp", "pdfs");
const REPORT_DIR = join(process.cwd(), "tmp", "eval-reports");
mkdirSync(REPORT_DIR, { recursive: true });

async function loadWasm(): Promise<string> {
  const wasmPath = join(
    process.cwd(),
    "node_modules",
    "@firecrawl",
    "pdf-inspector-wasm",
    "pdf_inspector_wasm_bg.wasm",
  );
  const bytes = readFileSync(wasmPath);
  await init({ module_or_path: new Uint8Array(bytes) });
  return version();
}

function classifyNormalized(
  bytes: Uint8Array,
): PdfClassification & { pagesNeedingOcr1Indexed: number[] } {
  const cls = classifyPdf(bytes);
  return {
    ...cls,
    pagesNeedingOcr1Indexed: cls.pagesNeedingOcr.map((p) => p + 1),
  };
}

function processNormalized(bytes: Uint8Array): PdfProcessResult {
  const result = processPdf(bytes, { profile: "fidelity", includePageMarkers: true });
  const proc = result as PdfProcessResult & { pagesNeedingOcr1Indexed?: number[] };
  proc.pagesNeedingOcr1Indexed = result.pagesNeedingOcr;
  return proc as PdfProcessResult;
}

interface CorpusEntry {
  file: string;
  sizeBytes: number;
  bytes: Uint8Array;
}

function loadCorpus(): CorpusEntry[] {
  if (!existsSync(CORPUS_DIR)) {
    logger.warn(
      `Corpus directory not found: ${CORPUS_DIR}. Run: bun run scripts/build-pdf-corpus.ts`,
    );
    return [];
  }
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort()
    .map((file) => {
      const p = join(CORPUS_DIR, file);
      const bytes = new Uint8Array(readFileSync(p));
      return { file, sizeBytes: bytes.length, bytes };
    });
}

interface LocalBaseline {
  kind: "markdown" | "text";
  text: string;
  durationMs: number;
  pagesCovered: number;
}

async function runLocalBaseline(
  bytes: Uint8Array,
  kind: "markdown" | "text",
): Promise<LocalBaseline> {
  const start = performance.now();
  try {
    const { localConverter } = await import("../utils/LocalConverter.ts");
    const result =
      kind === "markdown"
        ? await localConverter.pdfToMarkdown(bytes)
        : await localConverter.pdfToText(bytes);
    const text = result.success && result.data ? new TextDecoder().decode(result.data) : "";
    const pagesCovered = text.split("\n---\n").length;
    return { kind, text, durationMs: performance.now() - start, pagesCovered };
  } catch (err) {
    logger.warn(`Local baseline (${kind}) unavailable: ${(err as Error).message}`);
    return { kind, text: "", durationMs: performance.now() - start, pagesCovered: 0 };
  }
}

function pageCoverage(text: string): number {
  const markers = text.match(/<!-- Page \d+ -->/g);
  return markers ? markers.length : text.split("\n---\n").filter((s) => s.trim()).length || 0;
}

interface FileReport {
  file: string;
  sizeBytes: number;
  engine: string;
  process: {
    pdfType: string;
    pageCount: number;
    confidence: number;
    markdownChars: number;
    pagesCovered: number;
    pagesNeedingOcr: number[];
    ocrReasonsByPage: { page: number; reasons: string[] }[];
    pagesWithTables: number[];
    pagesWithColumns: number[];
    isComplex: boolean;
    hasEncodingIssues: boolean;
    processingTimeMs: number;
    title?: string;
  };
  classify: {
    pdfType: string;
    pageCount: number;
    confidence: number;
    pagesNeedingOcr0Indexed: number[];
    pagesNeedingOcr1Indexed: number[];
  };
  detected: {
    pdfType: string;
    pageCount: number;
    confidence: number;
    pagesNeedingOcr: number[];
  };
  localMarkdownBaseline: LocalBaseline;
  localTextBaseline: LocalBaseline;
  pageIndexingConsistent: boolean;
  warnings: string[];
}

function evaluateFile(entry: CorpusEntry): FileReport {
  const warnings: string[] = [];
  const bytes = entry.bytes;

  let proc: PdfProcessResult;
  let cls: ReturnType<typeof classifyNormalized>;
  let detected: PdfProcessResult;
  try {
    proc = processNormalized(bytes);
  } catch (err) {
    warnings.push(`processPdf threw: ${(err as Error).message}`);
    const empty = {
      pdfType: "Unknown",
      pageCount: 0,
      confidence: 0,
      markdown: "",
      pagesNeedingOcr: [],
      ocrReasonsByPage: [],
      processingTimeMs: 0,
      layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
      hasEncodingIssues: false,
    } as unknown as PdfProcessResult;
    proc = empty;
  }

  try {
    cls = classifyNormalized(bytes);
  } catch (err) {
    warnings.push(`classifyPdf threw: ${(err as Error).message}`);
    cls = {
      pdfType: "Unknown",
      pageCount: proc.pageCount,
      confidence: 0,
      pagesNeedingOcr: [],
      pagesNeedingOcr1Indexed: [],
    } as ReturnType<typeof classifyNormalized>;
  }

  try {
    detected = detectPdf(bytes);
  } catch (err) {
    warnings.push(`detectPdf threw: ${(err as Error).message}`);
    detected = proc;
  }

  const procOcr = Array.from(proc.pagesNeedingOcr).sort((a, b) => a - b);
  const clsOcr1 = Array.from(cls.pagesNeedingOcr1Indexed).sort((a, b) => a - b);
  const clsOcr0 = Array.from(cls.pagesNeedingOcr).sort((a, b) => a - b);
  const pageIndexingConsistent = JSON.stringify(procOcr) === JSON.stringify(clsOcr1);

  if (!pageIndexingConsistent) {
    warnings.push(
      `Page-indexing mismatch: processPdf pagesNeedingOcr=${JSON.stringify(procOcr)} (1-indexed) vs classifyPdf 1-indexed=${JSON.stringify(clsOcr1)}`,
    );
  }

  return {
    file: entry.file,
    sizeBytes: entry.sizeBytes,
    engine: "pdf-inspector-wasm",
    process: {
      pdfType: proc.pdfType,
      pageCount: proc.pageCount,
      confidence: proc.confidence,
      markdownChars: proc.markdown?.length ?? 0,
      pagesCovered: pageCoverage(proc.markdown ?? ""),
      pagesNeedingOcr: procOcr,
      ocrReasonsByPage: proc.ocrReasonsByPage ?? [],
      pagesWithTables: proc.layout?.pagesWithTables ?? [],
      pagesWithColumns: proc.layout?.pagesWithColumns ?? [],
      isComplex: proc.layout?.isComplex ?? false,
      hasEncodingIssues: proc.hasEncodingIssues,
      processingTimeMs: proc.processingTimeMs,
      title: proc.title,
    },
    classify: {
      pdfType: cls.pdfType,
      pageCount: cls.pageCount,
      confidence: cls.confidence,
      pagesNeedingOcr0Indexed: clsOcr0,
      pagesNeedingOcr1Indexed: clsOcr1,
    },
    detected: {
      pdfType: detected.pdfType,
      pageCount: detected.pageCount,
      confidence: detected.confidence,
      pagesNeedingOcr: Array.from(detected.pagesNeedingOcr).sort((a, b) => a - b),
    },
    localMarkdownBaseline: { kind: "markdown", text: "", durationMs: 0, pagesCovered: 0 },
    localTextBaseline: { kind: "text", text: "", durationMs: 0, pagesCovered: 0 },
    pageIndexingConsistent,
    warnings,
  };
}

interface Summary {
  engine: string;
  engineVersion: string;
  corpusSize: number;
  totalBytes: number;
  totalProcessingMs: number;
  classifications: Record<string, number>;
  filesNeedingOcr: number;
  totalPagesNeedingOcr: number;
  filesWithTables: number;
  filesWithColumns: number;
  filesWithEncodingIssues: number;
  pageIndexingMismatches: number;
  meanConfidence: number;
  meanProcessingMs: number;
  maxProcessingMs: number;
}

function summarize(reports: FileReport[], engineVersion: string): Summary {
  const totalProcessingMs = reports.reduce((s, r) => s + r.process.processingTimeMs, 0);
  const classifications: Record<string, number> = {};
  for (const r of reports) {
    classifications[r.process.pdfType] = (classifications[r.process.pdfType] ?? 0) + 1;
  }
  return {
    engine: "pdf-inspector-wasm",
    engineVersion,
    corpusSize: reports.length,
    totalBytes: reports.reduce((s, r) => s + r.sizeBytes, 0),
    totalProcessingMs,
    classifications,
    filesNeedingOcr: reports.filter((r) => r.process.pagesNeedingOcr.length > 0).length,
    totalPagesNeedingOcr: reports.reduce((s, r) => s + r.process.pagesNeedingOcr.length, 0),
    filesWithTables: reports.filter((r) => r.process.pagesWithTables.length > 0).length,
    filesWithColumns: reports.filter((r) => r.process.pagesWithColumns.length > 0).length,
    filesWithEncodingIssues: reports.filter((r) => r.process.hasEncodingIssues).length,
    pageIndexingMismatches: reports.filter((r) => !r.pageIndexingConsistent).length,
    meanConfidence: reports.length
      ? reports.reduce((s, r) => s + r.process.confidence, 0) / reports.length
      : 0,
    meanProcessingMs: reports.length ? totalProcessingMs / reports.length : 0,
    maxProcessingMs: reports.reduce((m, r) => Math.max(m, r.process.processingTimeMs), 0),
  };
}

function formatReport(reports: FileReport[], summary: Summary): string {
  const lines: string[] = [];
  lines.push(`# pdf-inspector evaluation report`);
  lines.push(``);
  lines.push(`- Engine: ${summary.engine} v${summary.engineVersion}`);
  lines.push(`- Corpus: ${summary.corpusSize} files, ${summary.totalBytes} bytes`);
  lines.push(`- Total processing time: ${summary.totalProcessingMs.toFixed(2)} ms (sum)`);
  lines.push(
    `- Mean / max per-file: ${summary.meanProcessingMs.toFixed(2)} ms / ${summary.maxProcessingMs.toFixed(2)} ms`,
  );
  lines.push(`- Mean confidence: ${(summary.meanConfidence * 100).toFixed(1)}%`);
  lines.push(`- Classifications: ${JSON.stringify(summary.classifications)}`);
  lines.push(
    `- Files needing OCR: ${summary.filesNeedingOcr} (${summary.totalPagesNeedingOcr} pages)`,
  );
  lines.push(`- Files with tables: ${summary.filesWithTables}`);
  lines.push(`- Files with columns: ${summary.filesWithColumns}`);
  lines.push(`- Files with encoding issues: ${summary.filesWithEncodingIssues}`);
  lines.push(
    `- Page-indexing mismatches (processPdf vs classifyPdf normalized): ${summary.pageIndexingMismatches}`,
  );
  lines.push(``);
  lines.push(`## Per-file results`);
  lines.push(``);
  lines.push(
    "| File | Size | pdfType | Pages | Conf | Markdown chars | OCR pages | Tables | Columns | EncIssues | Proc ms | Idx OK |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of reports) {
    lines.push(
      [
        r.file,
        r.sizeBytes,
        r.process.pdfType,
        r.process.pageCount,
        `${(r.process.confidence * 100).toFixed(0)}%`,
        r.process.markdownChars,
        JSON.stringify(r.process.pagesNeedingOcr),
        JSON.stringify(r.process.pagesWithTables),
        JSON.stringify(r.process.pagesWithColumns),
        r.process.hasEncodingIssues ? "yes" : "no",
        r.process.processingTimeMs.toFixed(2),
        r.pageIndexingConsistent ? "yes" : "NO",
      ].join(" | "),
    );
  }
  lines.push(``);
  if (reports.some((r) => r.warnings.length > 0)) {
    lines.push(`## Warnings`);
    lines.push(``);
    for (const r of reports) {
      for (const w of r.warnings) {
        lines.push(`- ${r.file}: ${w}`);
      }
    }
    lines.push(``);
  }
  return lines.join("\n");
}

async function main() {
  const engineVersion = await loadWasm();
  console.log(`Loaded pdf-inspector-wasm v${engineVersion}`);

  const corpus = loadCorpus();
  if (corpus.length === 0) {
    console.error("No corpus found. Run: bun run scripts/build-pdf-corpus.ts");
    process.exit(1);
  }
  console.log(`Corpus: ${corpus.length} files`);

  // Pass 1: run the new engine against the whole corpus BEFORE importing any
  // module (e.g. LocalConverter/pdfjs) that could re-evaluate the wasm-bindgen
  // glue and unset its internal `wasm` binding under bun.
  const reports: FileReport[] = [];
  for (const entry of corpus) {
    const startTotal = performance.now();
    const report = evaluateFile(entry);
    const totalMs = performance.now() - startTotal;
    console.log(
      `  ${entry.file.padEnd(28)} ${report.process.pdfType.padEnd(11)} pages=${report.process.pageCount} conf=${(report.process.confidence * 100).toFixed(0)}% md=${report.process.markdownChars} ocrPages=${report.process.pagesNeedingOcr.length} procMs=${report.process.processingTimeMs.toFixed(1)} idxOK=${report.pageIndexingConsistent} (total ${totalMs.toFixed(0)} ms)`,
    );
    reports.push(report);
  }

  // Pass 2: best-effort LocalConverter baseline. pdfjs-dist's non-legacy
  // build needs DOMMatrix which Node/bun lacks; degraded gracefully here.
  const baselineAvailable = await (async () => {
    try {
      await import("../utils/LocalConverter.ts");
      return true;
    } catch (err) {
      logger.warn(
        `LocalConverter baseline disabled in this runtime: ${(err as Error).message}. Engine results above remain valid.`,
      );
      return false;
    }
  })();

  if (baselineAvailable) {
    for (let i = 0; i < corpus.length; i++) {
      reports[i].localMarkdownBaseline = await runLocalBaseline(corpus[i].bytes, "markdown");
      reports[i].localTextBaseline = await runLocalBaseline(corpus[i].bytes, "text");
    }
  }

  const summary = summarize(reports, engineVersion);
  const md = formatReport(reports, summary);
  const mdPath = join(REPORT_DIR, "pdf-inspector-eval.md");
  writeFileSync(mdPath, md);
  const jsonPath = join(REPORT_DIR, "pdf-inspector-eval.json");
  writeFileSync(jsonPath, JSON.stringify({ summary, reports }, null, 2));
  console.log(``);
  console.log(`Report written: ${mdPath}`);
  console.log(`JSON written:    ${jsonPath}`);
  console.log(``);
  console.log(formatReport(reports, summary));
}

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
