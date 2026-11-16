/**
 * Builds one PDF from typed text and files of many kinds, in the order given.
 * Everything happens in the browser: PDFs are copied page by page, images
 * are embedded, and text, Office, OpenDocument, RTF, EPUB and CSV files are
 * turned into Markdown (anydoc runs locally in a worker) and drawn as text.
 */
import { AnydocError, anydocEngine } from "./anydocEngine.ts";
import { ANYDOC_FORMAT_LABEL, type AnydocFormat } from "./anydocTypes.ts";
import { describeFailure, UserFacingError } from "./errorMapper.ts";
import {
  appendMarkdownPages,
  type MarkdownPdfOptions,
  maxTableColumns,
  type PageMargins,
  type PageOrientation,
  type PageSizeOption,
  resolveMargins,
  resolvePageSize,
} from "./markdownPdf.ts";
import { extensionOf } from "./mime.ts";
import { degrees, PDFDocument } from "./pdfConfig.ts";
import { loadProcessablePdf } from "./pdfSecurity.ts";
import { yieldToMain } from "./taskScheduler.ts";

type PdfDoc = Awaited<ReturnType<typeof PDFDocument.create>>;
type PdfImage = Awaited<ReturnType<PdfDoc["embedPng"]>>;

export type PdfSource =
  | {
      kind: "text";
      text: string;
      /** False keeps the text exactly as typed. */
      markdown: boolean;
      /** Used in progress and messages; defaults to "Your text". */
      name?: string;
    }
  | { kind: "file"; file: File };

export type SourceKind =
  | "pdf"
  | "image"
  | "text"
  | "markdown"
  | "document"
  | "spreadsheet"
  | "presentation";

export interface SourceFileType {
  kind: SourceKind;
  /** Short name for the type, for lists ("PDF", "Word", "Image"). */
  label: string;
  /** The anydoc format for files anydoc converts. */
  format?: AnydocFormat;
}

export interface PdfFromSourcesOptions {
  pageSize?: PageSizeOption;
  orientation?: PageOrientation;
  margins?: number | Partial<PageMargins>;
  /** Body text size in points for text sources. */
  fontSize?: number;
  /** Saved as the PDF's title. */
  title?: string;
  /** Also draw `title` at the top of the first page made from text. */
  showTitle?: boolean;
  /**
   * "auto" (the default) turns image pages landscape for wide images;
   * "fixed" keeps every image page in `orientation`.
   */
  imagePageOrientation?: "auto" | "fixed";
}

export type SourceStage = "reading" | "converting" | "adding" | "saving" | "done";

export interface SourcesProgress {
  /** Zero-based index of the source being worked on. */
  index: number;
  total: number;
  name: string;
  stage: SourceStage;
  /** Whole job, 0–100. */
  percent: number;
}

export interface PdfFromSourcesResult {
  bytes: Uint8Array;
  pageCount: number;
  /** Plain-language notes for the user, such as replaced characters. */
  warnings: string[];
  /** Characters the built-in fonts could not show. */
  replacedCharacters: number;
}

const TYPE_BY_EXTENSION: Record<string, SourceFileType> = {
  pdf: { kind: "pdf", label: "PDF" },
  jpg: { kind: "image", label: "Image" },
  jpeg: { kind: "image", label: "Image" },
  jfif: { kind: "image", label: "Image" },
  png: { kind: "image", label: "Image" },
  webp: { kind: "image", label: "Image" },
  gif: { kind: "image", label: "Image" },
  bmp: { kind: "image", label: "Image" },
  svg: { kind: "image", label: "Image" },
  avif: { kind: "image", label: "Image" },
  txt: { kind: "text", label: "Text" },
  text: { kind: "text", label: "Text" },
  md: { kind: "markdown", label: "Markdown" },
  markdown: { kind: "markdown", label: "Markdown" },
  doc: { kind: "document", label: "Word", format: "doc" },
  docx: { kind: "document", label: "Word", format: "docx" },
  // Macro-enabled and template variants share a parser with the plain format.
  docm: { kind: "document", label: "Word", format: "docx" },
  dotx: { kind: "document", label: "Word", format: "docx" },
  odt: { kind: "document", label: "OpenDocument text", format: "odt" },
  rtf: { kind: "document", label: "RTF", format: "rtf" },
  epub: { kind: "document", label: "EPUB", format: "epub" },
  xlsx: { kind: "spreadsheet", label: "Excel", format: "xlsx" },
  xlsm: { kind: "spreadsheet", label: "Excel", format: "xlsx" },
  ods: { kind: "spreadsheet", label: "OpenDocument sheet", format: "ods" },
  csv: { kind: "spreadsheet", label: "CSV", format: "csv" },
  ppt: { kind: "presentation", label: "PowerPoint", format: "ppt" },
  pptx: { kind: "presentation", label: "PowerPoint", format: "pptx" },
  pptm: { kind: "presentation", label: "PowerPoint", format: "pptx" },
  ppsx: { kind: "presentation", label: "PowerPoint", format: "pptx" },
  odp: { kind: "presentation", label: "OpenDocument slides", format: "odp" },
};

// Used only when a file has no extension we know.
const TYPE_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
};

/** `accept` value for a file input that takes every supported type. */
export const SOURCE_ACCEPT = Object.keys(TYPE_BY_EXTENSION)
  .map((ext) => `.${ext}`)
  .concat(Object.keys(TYPE_BY_MIME))
  .join(",");

/** Plain list of supported types for messages. */
export const SOURCE_TYPES_LABEL = `PDF, images (JPG, PNG, WebP, GIF, BMP, SVG, AVIF), text (TXT, MD) and documents (${ANYDOC_FORMAT_LABEL})`;

/** What kind of source a file is, from its extension or else its MIME type. */
export function classifySourceFile(file: { name: string; type?: string }): SourceFileType | null {
  const byExtension = TYPE_BY_EXTENSION[extensionOf(file.name)];
  if (byExtension) return byExtension;
  const mime = (file.type ?? "").toLowerCase().split(";")[0].trim();
  const extension = TYPE_BY_MIME[mime];
  return extension ? TYPE_BY_EXTENSION[extension] : null;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** CSS pixels to PDF points, so a screenshot keeps its on-screen size. */
const POINTS_PER_PIXEL = 0.75;
// Browsers refuse larger canvases (Safari's cap is 4096 × 4096).
const MAX_CANVAS_PIXELS = 16_777_216;
// SVGs have no fixed resolution, so small ones are drawn larger to stay sharp.
const MIN_SVG_LONG_SIDE = 2000;
const DEFAULT_SVG_SIDE = 1024;

const isJpegHeader = (bytes: Uint8Array) =>
  bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

const isPngHeader = (bytes: Uint8Array) =>
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);

/**
 * Reads the EXIF orientation (1–8) of a JPEG. Phone photos are often stored
 * sideways with this tag saying how to turn them; pdf-lib ignores it.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  if (!isJpegHeader(bytes)) return 1;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1];
    // Image data starts at SOS; EXIF always comes before it.
    if (marker === 0xda || marker === 0xd9) return 1;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const isExif =
      marker === 0xe1 &&
      String.fromCharCode(...bytes.subarray(offset + 4, offset + 10)) === "Exif\0\0";
    if (isExif) {
      const tiff = offset + 10;
      const little = bytes[tiff] === 0x49;
      const u16 = (at: number) =>
        little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1];
      const u32 = (at: number) =>
        little ? (u16(at) | (u16(at + 2) << 16)) >>> 0 : ((u16(at) << 16) | u16(at + 2)) >>> 0;
      const ifd = tiff + u32(tiff + 4);
      const count = ifd + 2 <= bytes.length ? u16(ifd) : 0;
      for (let entry = 0; entry < count; entry++) {
        const at = ifd + 2 + entry * 12;
        if (at + 12 > bytes.length) break;
        if (u16(at) === 0x0112) {
          const value = u16(at + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    offset += 2 + length;
  }
  return 1;
}

interface DecodedImage {
  image: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function loadImageElement(file: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    // An SVG without a set size reports 0; fall back to a sensible square.
    const width = image.naturalWidth || image.naturalHeight || DEFAULT_SVG_SIDE;
    const height = image.naturalHeight || image.naturalWidth || DEFAULT_SVG_SIDE;
    return { image, width, height, release: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function decodeImage(file: Blob, isSvg: boolean): Promise<DecodedImage> {
  // createImageBitmap cannot read SVG in most browsers; an <img> can, and
  // scripts inside an SVG never run there.
  if (isSvg) return loadImageElement(file);
  if (typeof createImageBitmap !== "function") {
    throw new Error("createImageBitmap is not available");
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  return {
    image: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    release: () => bitmap.close(),
  };
}

interface RasterImage {
  bytes: Uint8Array;
  /** Size to lay out at, in CSS pixels. */
  width: number;
  height: number;
  type: "png" | "jpeg";
}

/** Draws any browser-readable image onto a canvas and encodes it as PNG or JPEG. */
async function rasterize(file: Blob, isSvg: boolean, type: "png" | "jpeg"): Promise<RasterImage> {
  const decoded = await decodeImage(file, isSvg);
  const canvas = document.createElement("canvas");
  try {
    const { width, height } = decoded;
    let scale = isSvg ? Math.max(1, MIN_SVG_LONG_SIDE / Math.max(width, height)) : 1;
    scale = Math.min(scale, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available");
    if (type === "jpeg") {
      // JPEG has no transparency; without this, clear areas turn black.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, `image/${type}`, 0.92),
    );
    if (!blob) throw new Error("The image could not be encoded");
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height, type };
  } finally {
    decoded.release();
    // Frees the canvas memory now rather than at the next garbage collection.
    canvas.width = 0;
    canvas.height = 0;
  }
}

interface ImageLayout {
  pageSize: [number, number];
  margins: PageMargins;
}

function drawImagePage(
  doc: PdfDoc,
  image: PdfImage,
  size: { width: number; height: number },
  orientation: number,
  layout: (wide: boolean) => ImageLayout,
) {
  const turned = orientation >= 5;
  const naturalWidth = (turned ? size.height : size.width) * POINTS_PER_PIXEL;
  const naturalHeight = (turned ? size.width : size.height) * POINTS_PER_PIXEL;
  const { pageSize, margins } = layout(naturalWidth > naturalHeight);
  const page = doc.addPage(pageSize);
  const roomWidth = pageSize[0] - margins.left - margins.right;
  const roomHeight = pageSize[1] - margins.top - margins.bottom;
  const scale = Math.min(1, roomWidth / naturalWidth, roomHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  const x = margins.left + (roomWidth - width) / 2;
  const y = margins.bottom + (roomHeight - height) / 2;
  // pdf-lib turns an image about its lower-left corner, so the corner moves
  // to keep the turned image inside the same box.
  if (orientation === 6) {
    page.drawImage(image, { x, y: y + height, width: height, height: width, rotate: degrees(-90) });
  } else if (orientation === 8) {
    page.drawImage(image, { x: x + width, y, width: height, height: width, rotate: degrees(90) });
  } else if (orientation === 3) {
    page.drawImage(image, { x: x + width, y: y + height, width, height, rotate: degrees(180) });
  } else {
    page.drawImage(image, { x, y, width, height });
  }
}

async function addImage(
  doc: PdfDoc,
  file: File,
  layout: (wide: boolean) => ImageLayout,
  onConverting: () => void,
) {
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const isSvg = extensionOf(file.name) === "svg" || file.type === "image/svg+xml";
  if (!isSvg && (isJpegHeader(header) || isPngHeader(header))) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const jpeg = isJpegHeader(bytes);
    const orientation = jpeg ? readJpegOrientation(bytes) : 1;
    // Mirrored orientations (2, 4, 5, 7) cannot be drawn by turning alone.
    if ([1, 3, 6, 8].includes(orientation)) {
      try {
        const image = jpeg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
        drawImagePage(doc, image, image, orientation, layout);
        return;
      } catch {
        // pdf-lib cannot read every JPEG and PNG variant; the browser can.
      }
    }
  }
  onConverting();
  let raster: RasterImage;
  try {
    raster = await rasterize(file, isSvg, isJpegHeader(header) ? "jpeg" : "png");
  } catch {
    throw new UserFacingError(
      `Kyte could not read the image "${file.name}". This browser may not support this image type. Save it as PNG or JPG and try again.`,
    );
  }
  const image =
    raster.type === "jpeg" ? await doc.embedJpg(raster.bytes) : await doc.embedPng(raster.bytes);
  drawImagePage(doc, image, raster, 1, layout);
}

// ---------------------------------------------------------------------------
// PDFs, text and converted documents
// ---------------------------------------------------------------------------

async function addPdf(doc: PdfDoc, file: File) {
  let source: PdfDoc;
  try {
    // Only the parsed document is kept; its bytes can be freed once loaded.
    ({ pdfDoc: source } = await loadProcessablePdf(new Uint8Array(await file.arrayBuffer())));
  } catch (error) {
    if (/encrypted|password/i.test(String(error))) {
      throw new UserFacingError(
        `"${file.name}" is password-protected. Open it in the Unlock PDF tool to remove the password, then add it again.`,
      );
    }
    throw new UserFacingError(describeFailure(`Kyte could not read "${file.name}".`, error));
  }
  const pages = await doc.copyPages(source, source.getPageIndices());
  for (const page of pages) doc.addPage(page);
  return pages.length;
}

/** Reads a text file, honouring a UTF-16 byte order mark when there is one. */
async function readTextFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  return new TextDecoder(encoding).decode(bytes);
}

function conversionError(error: unknown, name: string): UserFacingError {
  if (error instanceof AnydocError) {
    switch (error.reason) {
      case "encrypted":
        return new UserFacingError(
          `"${name}" is password-protected. Remove the password in the app that made it, then add it again.`,
        );
      case "engine-unavailable":
        return new UserFacingError(
          `The document converter could not start, so "${name}" was not added. Reload the page and try again.`,
        );
      case "resourceLimit":
        return new UserFacingError(
          `"${name}" is too large or complex to convert in the browser. Try a smaller file.`,
        );
      default:
        return new UserFacingError(
          `Kyte could not read "${name}". It may be damaged or in a format Kyte can't open. Open it, save a fresh copy and try again.`,
        );
    }
  }
  return new UserFacingError(describeFailure(`Kyte could not convert "${name}".`, error));
}

/**
 * Conversions are kept per File, so the creator's live preview, which rebuilds
 * after every edit, doesn't convert unchanged documents again. A File's
 * contents never change, and an entry goes when the File is let go.
 */
const markdownCache = new WeakMap<File, Promise<string>>();

function convertToMarkdown(file: File, type: SourceFileType): Promise<string> {
  const cached = markdownCache.get(file);
  if (cached) return cached;
  const pending = convertFileToMarkdown(file, type);
  markdownCache.set(file, pending);
  // A failure is not kept, so adding the file again tries again.
  pending.catch(() => markdownCache.delete(file));
  return pending;
}

async function convertFileToMarkdown(file: File, type: SourceFileType): Promise<string> {
  let bytes: Uint8Array | null = new Uint8Array(await file.arrayBuffer());
  try {
    const envelope = await anydocEngine.convert(bytes, {
      format: type.format,
      sourceName: file.name,
    });
    return envelope.markdown;
  } catch (error) {
    throw conversionError(error, file.name);
  } finally {
    // The engine keeps its own copy; drop ours before drawing starts.
    bytes = null;
  }
}

// ---------------------------------------------------------------------------
// Joining sources
// ---------------------------------------------------------------------------

const describeName = (source: PdfSource) =>
  source.kind === "file" ? source.file.name : source.name?.trim() || "Your text";

/**
 * Builds one PDF from the sources, in order. Each source starts on a new
 * page. Failures name the file at fault in a UserFacingError.
 */
export async function buildPdfFromSources(
  sources: PdfSource[],
  options: PdfFromSourcesOptions = {},
  onProgress?: (progress: SourcesProgress) => void,
): Promise<PdfFromSourcesResult> {
  const doc = await PDFDocument.create();
  const title = options.title?.trim();
  if (title) doc.setTitle(title);
  doc.setCreator("Kyte PDF");

  const warnings: string[] = [];
  let replacedCharacters = 0;
  let titleDrawn = !(options.showTitle && title);
  const orientation = options.orientation ?? "portrait";
  const textOptions: MarkdownPdfOptions = {
    pageSize: options.pageSize,
    orientation,
    margins: options.margins,
    fontSize: options.fontSize,
  };

  const imageLayout = (wide: boolean): ImageLayout => {
    const chosen =
      (options.imagePageOrientation ?? "auto") === "auto"
        ? wide
          ? "landscape"
          : "portrait"
        : orientation;
    const pageSize = resolvePageSize(options.pageSize, chosen);
    return { pageSize, margins: resolveMargins(options.margins, pageSize) };
  };

  const addText = async (text: string, extra: MarkdownPdfOptions) => {
    const result = await appendMarkdownPages(doc, text, {
      ...textOptions,
      ...extra,
      title: titleDrawn ? undefined : title,
    });
    titleDrawn = true;
    replacedCharacters += result.replacedCharacters;
  };

  const total = sources.length;
  for (const [index, source] of sources.entries()) {
    const name = describeName(source);
    const report = (stage: SourceStage, done: number) =>
      onProgress?.({
        index,
        total,
        name,
        stage,
        percent: Math.round(((index + done) / total) * 95),
      });
    report("reading", 0);

    if (source.kind === "text") {
      if (source.text.trim()) {
        report("adding", 0.5);
        await addText(source.text, { plainText: !source.markdown });
      }
      await yieldToMain();
      continue;
    }

    const { file } = source;
    const type = classifySourceFile(file);
    if (!type) {
      throw new UserFacingError(
        `"${file.name}" can't be added. Kyte can use ${SOURCE_TYPES_LABEL}.`,
      );
    }

    try {
      switch (type.kind) {
        case "pdf":
          report("adding", 0.5);
          if ((await addPdf(doc, file)) === 0) {
            warnings.push(`"${file.name}" has no pages, so nothing was added from it.`);
          }
          break;
        case "image":
          await addImage(doc, file, imageLayout, () => report("converting", 0.3));
          break;
        case "text":
        case "markdown": {
          const text = await readTextFile(file);
          report("adding", 0.5);
          if (text.trim()) {
            await addText(text, { plainText: type.kind === "text" });
          } else {
            warnings.push(`"${file.name}" is empty, so nothing was added from it.`);
          }
          break;
        }
        default: {
          report("converting", 0.2);
          const markdown = await convertToMarkdown(file, type);
          if (!markdown.trim()) {
            warnings.push(
              `"${file.name}" has no text Kyte can read, so nothing was added from it.`,
            );
            break;
          }
          report("adding", 0.6);
          const extra: MarkdownPdfOptions = {};
          if (type.kind === "presentation") {
            // anydoc writes each slide title as a level-2 heading. Slides are
            // wide and hold little text, so pages are landscape with larger type.
            extra.newPageAtHeadingLevel = 2;
            extra.orientation = "landscape";
            extra.fontSize = Math.max(options.fontSize ?? 0, 16);
          } else if (type.kind === "spreadsheet") {
            // Each sheet starts on its own page; wide sheets get a wide page.
            extra.newPageAtHeadingLevel = 2;
            if (maxTableColumns(markdown) > 6) extra.orientation = "landscape";
          }
          await addText(markdown, extra);
        }
      }
    } catch (error) {
      if (error instanceof UserFacingError) throw error;
      throw new UserFacingError(describeFailure(`Kyte could not add "${file.name}".`, error));
    }
    report("adding", 1);
    // Let the page repaint between sources.
    await yieldToMain();
  }

  if (doc.getPageCount() === 0) {
    throw new UserFacingError(
      "There is nothing to put in the PDF yet. Type some text or add a file.",
    );
  }
  if (replacedCharacters > 0) {
    warnings.push(
      `${replacedCharacters} ${replacedCharacters === 1 ? "character is" : "characters are"} not in the PDF's built-in fonts and ${replacedCharacters === 1 ? "was" : "were"} replaced with a similar character or "?".`,
    );
  }

  onProgress?.({ index: total - 1, total, name: "", stage: "saving", percent: 96 });
  const bytes = await doc.save();
  onProgress?.({ index: total - 1, total, name: "", stage: "done", percent: 100 });
  return { bytes, pageCount: doc.getPageCount(), warnings, replacedCharacters };
}
