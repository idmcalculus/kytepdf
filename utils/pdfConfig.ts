import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib-with-encrypt";
// The legacy build, not the default one: the default build calls
// Map.prototype.getOrInsertComputed, Math.sumPrecise and
// Uint8Array.prototype.toHex with no fallback, so it fails before Chrome 147,
// Firefox 144 and Safari 26.2. The legacy build carries polyfills and runs from
// Chrome 125 and Safari 18. public/pdf.worker.min.js must be the legacy worker
// to match (scripts/sync-pdf-inspector-wasm.ts). Type-only imports may name
// "pdfjs-dist": the legacy build has the same types.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { config } from "./config.ts";

// Centralized configuration for PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = config.pdf.workerSrc;

export { degrees, PDFDocument, pdfjsLib, rgb, StandardFonts };
