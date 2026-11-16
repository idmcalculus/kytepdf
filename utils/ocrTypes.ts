import { version as tesseractVersion } from "tesseract.js/package.json";

/** 1-indexed page OCR result. */
export interface OcrPageResult {
  page: number;
  text: string;
  confidence: number;
  processingTimeMs: number;
}

export interface OcrRunResult {
  pages: OcrPageResult[];
  language: string;
  engine: "tesseract.js";
  engineVersion: string;
  warnings: string[];
  totalProcessingTimeMs: number;
}

export type OcrErrorReason =
  | "timeout"
  | "resource-limit"
  | "unsupported"
  | "worker-failed"
  | "unknown";

export interface OcrBudget {
  /** Max pages to OCR in one run (default 20). */
  maxPages: number;
  /** Per-page timeout in ms (default 30_000). */
  pageTimeoutMs: number;
  /** Max raster dimension on the long edge in CSS pixels (default 2000). */
  maxEdgePx: number;
  /** Language codes for tesseract (default "eng"). */
  languages: string;
}

export const DEFAULT_OCR_BUDGET: OcrBudget = {
  maxPages: 20,
  pageTimeoutMs: 30_000,
  maxEdgePx: 2000,
  languages: "eng",
};

/**
 * The tesseract.js release recorded with each OCR result, read from the
 * installed package at build time so an upgrade never leaves it stale.
 */
export const TESSERACT_ENGINE_VERSION: string = tesseractVersion;
