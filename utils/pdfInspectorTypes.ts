export type PdfType = "TextBased" | "Scanned" | "ImageBased" | "Mixed" | "Unknown";

export interface LayoutComplexity {
  isComplex: boolean;
  /** 1-indexed page numbers. */
  pagesWithTables: number[];
  /** 1-indexed page numbers. */
  pagesWithColumns: number[];
}

export interface PageOcrReasons {
  /** 1-indexed page number. */
  page: number;
  reasons: string[];
}

export interface AnalysisEnvelope {
  fileType: "application/pdf";
  pdfType: PdfType;
  pageCount: number;
  confidence: number;
  markdown?: string;
  plainText?: string;
  title?: string;
  layout: LayoutComplexity;
  /** 1-indexed page numbers needing OCR. */
  pagesNeedingOcr: number[];
  ocrReasonsByPage: PageOcrReasons[];
  hasEncodingIssues: boolean;
  engine: "pdf-inspector-wasm";
  engineVersion: string;
  processingTimeMs: number;
  warnings: string[];
}

export type WorkerRequestKind = "analyze" | "classify" | "extract-markdown" | "extract-text";

export interface WorkerRequest {
  id: number;
  kind: WorkerRequestKind;
  /** Content hash, computed on the main thread for session cache keys. */
  hash: string;
  bytes: Uint8Array;
  /** Never persisted by the engine; used only for a single analyze call. */
  password?: string;
  pages?: number[];
  profile?: "fidelity" | "compact";
}

export type WorkerFailureReason =
  /** The WASM engine could not be downloaded or started. */
  | "engine-unavailable"
  | "encrypted"
  | "password-required"
  | "malformed"
  | "resource-limit"
  | "unsupported"
  | "unknown";

export interface WorkerFailure {
  reason: WorkerFailureReason;
  message: string;
}

export interface WorkerResponse {
  id: number;
  ok: boolean;
  envelope?: AnalysisEnvelope;
  classification?: {
    pdfType: PdfType;
    pageCount: number;
    confidence: number;
    /** 1-indexed, normalized from the 0-indexed classifyPdf output. */
    pagesNeedingOcr: number[];
  };
  text?: string;
  failure?: WorkerFailure;
  /** The WASM instance trapped and must not be used again; the engine restarts the worker. */
  fatal?: boolean;
}
