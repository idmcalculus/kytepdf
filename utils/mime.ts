/** Central MIME lookup by file extension (with or without leading dot). */
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  zip: "application/zip",
  txt: "text/plain",
  md: "text/markdown",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  csv: "text/csv",
  markdown: "text/markdown",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
  doc: "application/msword",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  ppt: "application/vnd.ms-powerpoint",
  rtf: "application/rtf",
  epub: "application/epub+zip",
};

/** Lower-case extension of a file name, without the dot ("" when there is none). */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

export function mimeFromFilename(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function mimeFromExtension(extension: string): string {
  const ext = extension.startsWith(".")
    ? extension.slice(1).toLowerCase()
    : extension.toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}
