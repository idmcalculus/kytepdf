export type AnydocFormat =
  | "doc"
  | "docx"
  | "odt"
  | "ppt"
  | "pptx"
  | "odp"
  | "xlsx"
  | "ods"
  | "rtf"
  | "epub"
  | "csv";

export type AnydocErrorCode =
  | "unsupported"
  | "malformed"
  | "encrypted"
  | "resourceLimit"
  | "missingPart";

export interface AnydocAnalysisEnvelope {
  /** Original format detected from the bytes (or the one the caller named). */
  format: AnydocFormat | "unknown";
  /** MIME type of the source. */
  sourceMime: string;
  markdown: string;
  /** Non-empty when conversion degraded but still produced content. */
  warnings: string[];
  engine: "anydoc-wasm";
  engineVersion: string;
  processingTimeMs: number;
  /** Original file name when provided by the caller, for provenance. */
  sourceName?: string;
}

export interface AnydocWorkerRequest {
  id: number;
  bytes: Uint8Array;
  /** Optional explicit format (e.g. "csv"); omitted to auto-detect. */
  format?: AnydocFormat;
  sourceName?: string;
}

export interface AnydocWorkerFailure {
  /** anydoc's own code, "engine-unavailable" when the WASM engine could not load, or "unknown". */
  reason: AnydocErrorCode | "engine-unavailable" | "unknown";
  message: string;
}

export interface AnydocWorkerResponse {
  id: number;
  ok: boolean;
  envelope?: AnydocAnalysisEnvelope;
  failure?: AnydocWorkerFailure;
  /** The WASM instance trapped and must not be used again; the engine restarts the worker. */
  fatal?: boolean;
}

/** Authoritative list of formats the pinned anydoc-wasm package can convert. */
export const ANYDOC_SUPPORTED_EXTENSIONS = [
  "doc",
  "docx",
  "odt",
  "ppt",
  "pptx",
  "odp",
  "xlsx",
  "ods",
  "rtf",
  "epub",
  "csv",
] as const;

/** Comma-separated accept attribute for file inputs. */
export const ANYDOC_ACCEPT = ANYDOC_SUPPORTED_EXTENSIONS.map((ext) => `.${ext}`).join(",");

/** Short user-facing label for supported formats. */
export const ANYDOC_FORMAT_LABEL = "DOC, DOCX, ODT, PPT, PPTX, ODP, XLSX, ODS, RTF, EPUB, CSV";

export function isAnydocCandidate(name: string): boolean {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return (ANYDOC_SUPPORTED_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Derives the explicit anydoc format from a validated file extension.
 * Some formats (notably CSV, and ambiguously RTF/DOC/PPT) have no reliable
 * byte signature, so callers should pass this instead of relying solely on
 * anydoc's own byte-sniffing auto-detection.
 */
export function getAnydocFormat(name: string): AnydocFormat | undefined {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return (ANYDOC_SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)
    ? (ext as AnydocFormat)
    : undefined;
}

export const SOURCE_MIME: Record<AnydocFormat, string> = {
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  rtf: "application/rtf",
  epub: "application/epub+zip",
  csv: "text/csv",
};

/** All MIME types corresponding to ANYDOC_SUPPORTED_EXTENSIONS. */
export const ANYDOC_ALLOWED_MIMES = [
  ...new Set(Object.values(SOURCE_MIME)),
  // Other types browsers and systems report for supported extensions:
  // Windows with Excel installed labels .csv as application/vnd.ms-excel,
  // and macOS labels .rtf as text/rtf.
  "application/vnd.ms-excel",
  "application/csv",
  "text/x-csv",
  "text/comma-separated-values",
  "text/plain",
  "text/rtf",
  "application/x-rtf",
  // Browsers sometimes omit or mislabel Office MIME types.
  "application/octet-stream",
  "",
] as string[];
