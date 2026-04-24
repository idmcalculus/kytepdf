import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib-with-encrypt";
import * as pdfjsLib from "pdfjs-dist";
import { config } from "./config.ts";

// Centralized configuration for PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = config.pdf.workerSrc;

export { pdfjsLib };
export { PDFDocument, rgb, StandardFonts, degrees };
