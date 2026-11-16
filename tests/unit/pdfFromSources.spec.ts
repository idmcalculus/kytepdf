import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The bundled build of pdf-lib carries its own pako; the `es` build's pako
// import does not resolve under Node.
const pdfLib = vi.hoisted(
  async () =>
    (await import(
      "../../node_modules/pdf-lib-with-encrypt/dist/pdf-lib.esm.js"
    )) as typeof import("pdf-lib-with-encrypt"),
);
const mocks = vi.hoisted(() => ({ yieldToMain: vi.fn(() => Promise.resolve()) }));

vi.mock("../../utils/pdfConfig", async () => {
  const lib = await pdfLib;
  return {
    PDFDocument: lib.PDFDocument,
    StandardFonts: lib.StandardFonts,
    rgb: lib.rgb,
    degrees: lib.degrees,
    pdfjsLib: {},
  };
});
vi.mock("../../utils/taskScheduler", () => ({ yieldToMain: mocks.yieldToMain }));

import { AnydocError, anydocEngine } from "../../utils/anydocEngine";
import { UserFacingError } from "../../utils/errorMapper";
import {
  buildPdfFromSources,
  classifySourceFile,
  type PdfSource,
  readJpegOrientation,
  SOURCE_ACCEPT,
  SOURCE_TYPES_LABEL,
  type SourcesProgress,
} from "../../utils/pdfFromSources";

// --- Test data -------------------------------------------------------------

const PNG_1X1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);

/** The smallest JPEG pdf-lib accepts: SOI, an optional EXIF block, SOF0 and EOI. */
function jpeg(
  width: number,
  height: number,
  exif?: { orientation: number; little?: boolean } | "xmp" | "no-tag",
): Uint8Array {
  const bytes: number[] = [0xff, 0xd8];
  // A JFIF block first, so the reader has to skip a segment.
  bytes.push(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0);
  if (exif === "xmp") {
    const payload = Array.from("http://ns.adobe.com/xap/1.0/\0", (c) => c.charCodeAt(0));
    bytes.push(0xff, 0xe1, 0, payload.length + 2, ...payload);
  } else if (exif) {
    const little = exif !== "no-tag" && !!exif.little;
    const tag = exif === "no-tag" ? 0x0110 : 0x0112;
    const value = exif === "no-tag" ? 1 : exif.orientation;
    const tiff = little
      ? [
          0x49,
          0x49,
          0x2a,
          0,
          8,
          0,
          0,
          0,
          1,
          0,
          tag & 255,
          tag >> 8,
          3,
          0,
          1,
          0,
          0,
          0,
          value,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
        ]
      : [
          0x4d,
          0x4d,
          0,
          0x2a,
          0,
          0,
          0,
          8,
          0,
          1,
          tag >> 8,
          tag & 255,
          0,
          3,
          0,
          0,
          0,
          1,
          0,
          value,
          0,
          0,
          0,
          0,
          0,
          0,
        ];
    const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    bytes.push(0xff, 0xe1, 0, payload.length + 2, ...payload);
  }
  bytes.push(0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3);
  bytes.push(1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  bytes.push(0xff, 0xd9);
  return Uint8Array.from(bytes);
}

const file = (parts: BlobPart[], name: string, type = "") => new File(parts, name, { type });

async function makePdf(sizes: Array<[number, number]>, encrypt?: { user: string }) {
  const lib = await pdfLib;
  const doc = await lib.PDFDocument.create();
  for (const size of sizes) doc.addPage(size);
  if (encrypt) await doc.encrypt({ userPassword: encrypt.user, ownerPassword: "owner-secret" });
  // pdf-lib adds a blank page to an empty document unless told not to.
  return doc.save({ addDefaultPage: false });
}

interface PageInfo {
  width: number;
  height: number;
  text: string;
  content: string;
}

const decodeHex = (hex: string) =>
  new TextDecoder("windows-1252").decode(
    Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16)),
  );

async function readPages(bytes: Uint8Array): Promise<PageInfo[]> {
  const lib = await pdfLib;
  const doc = await lib.PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const { width, height } = page.getSize();
    const contents = page.node.Contents() as any;
    const streams = !contents
      ? []
      : contents instanceof lib.PDFArray
        ? contents.asArray().map((ref: any) => doc.context.lookup(ref))
        : [contents];
    const content = streams
      .map((stream: any) =>
        new TextDecoder("latin1").decode(lib.decodePDFRawStream(stream).decode()),
      )
      .join("\n");
    const text = [...content.matchAll(/<([0-9A-Fa-f]*)> Tj/g)]
      .map((m) => decodeHex(m[1]))
      .join(" ");
    return { width, height, text, content };
  });
}

async function build(sources: PdfSource[], options = {}) {
  const result = await buildPdfFromSources(sources, options);
  return { ...result, pages: await readPages(result.bytes) };
}

/** pdf-lib logs parse notes while it reads encrypted objects. */
const quietPdfLib = () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
};

const text = (value: string, markdown = true): PdfSource => ({
  kind: "text",
  text: value,
  markdown,
});
const source = (value: File): PdfSource => ({ kind: "file", file: value });

// --- Browser pieces jsdom lacks ---------------------------------------------

const originalArrayBuffer = {
  blob: Blob.prototype.arrayBuffer,
  file: File.prototype.arrayBuffer,
};
let canvases: HTMLCanvasElement[] = [];

beforeAll(() => {
  // The shared test setup stubs these to return no bytes; these tests need the real file.
  const read = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
  Blob.prototype.arrayBuffer = read;
  File.prototype.arrayBuffer = read;
});

afterAll(() => {
  Blob.prototype.arrayBuffer = originalArrayBuffer.blob;
  File.prototype.arrayBuffer = originalArrayBuffer.file;
});

beforeEach(() => {
  canvases = [];
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
  ) {
    canvases.push(this);
    callback(new Blob([type === "image/jpeg" ? jpeg(this.width, this.height) : PNG_1X1], { type }));
  });
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 400, height: 200, close: vi.fn() })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.yieldToMain.mockClear();
});

// --- Tests ---------------------------------------------------------------

describe("classifySourceFile", () => {
  it("knows each supported extension", () => {
    expect(classifySourceFile({ name: "a.PDF" })).toEqual({ kind: "pdf", label: "PDF" });
    expect(classifySourceFile({ name: "photo.webp" })?.kind).toBe("image");
    expect(classifySourceFile({ name: "notes.txt" })?.kind).toBe("text");
    expect(classifySourceFile({ name: "notes.md" })?.kind).toBe("markdown");
    expect(classifySourceFile({ name: "a.docm" })).toMatchObject({
      kind: "document",
      format: "docx",
    });
    expect(classifySourceFile({ name: "a.xlsx" })).toMatchObject({
      kind: "spreadsheet",
      label: "Excel",
    });
    expect(classifySourceFile({ name: "a.odp" })).toMatchObject({
      kind: "presentation",
      format: "odp",
    });
  });

  it("falls back to the MIME type, then gives up", () => {
    expect(classifySourceFile({ name: "pasted", type: "image/png" })?.kind).toBe("image");
    expect(classifySourceFile({ name: "notes", type: "text/plain; charset=utf-8" })?.kind).toBe(
      "text",
    );
    expect(classifySourceFile({ name: "app.exe", type: "application/x-msdownload" })).toBeNull();
    expect(classifySourceFile({ name: "README" })).toBeNull();
  });

  it("offers every type to the file picker", () => {
    expect(SOURCE_ACCEPT).toContain(".pptx");
    expect(SOURCE_ACCEPT).toContain("image/svg+xml");
    expect(SOURCE_TYPES_LABEL).toContain("XLSX");
  });
});

describe("readJpegOrientation", () => {
  it("reads the EXIF orientation in either byte order", () => {
    expect(readJpegOrientation(jpeg(4, 2))).toBe(1);
    expect(readJpegOrientation(jpeg(4, 2, { orientation: 6 }))).toBe(6);
    expect(readJpegOrientation(jpeg(4, 2, { orientation: 8, little: true }))).toBe(8);
  });

  it("falls back to 1 for anything it cannot use", () => {
    expect(readJpegOrientation(PNG_1X1)).toBe(1);
    expect(readJpegOrientation(jpeg(4, 2, { orientation: 9 }))).toBe(1);
    expect(readJpegOrientation(jpeg(4, 2, "xmp"))).toBe(1);
    expect(readJpegOrientation(jpeg(4, 2, "no-tag"))).toBe(1);
    // A segment that does not start with 0xFF, image data before any EXIF, and an IFD past the end.
    expect(
      readJpegOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0x12, 0x34, 0, 0])),
    ).toBe(1);
    expect(readJpegOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0]))).toBe(1);
    const farIfd = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0, 0xff, 0xff, 0, 0];
    expect(
      readJpegOrientation(
        Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, farIfd.length + 2, ...farIfd]),
      ),
    ).toBe(1);
    const truncated = jpeg(4, 2, { orientation: 6 }).slice(0, 44);
    expect(readJpegOrientation(truncated)).toBe(1);
  });
});

describe("buildPdfFromSources: text", () => {
  it("draws typed Markdown and plain text, skipping empty text", async () => {
    const { pages, pageCount, warnings } = await build([
      text("# Notes\n\n- **one**"),
      text("   "),
      text("*kept as typed*", false),
    ]);
    expect(pageCount).toBe(2);
    expect(pages[0].text).toContain("Notes");
    expect(pages[1].text).toBe("*kept as typed*");
    expect(warnings).toEqual([]);
  });

  it("reads .txt and .md files, including UTF-16 ones", async () => {
    const utf16le = Uint8Array.from([0xff, 0xfe, 0x48, 0, 0x69, 0]);
    const utf16be = Uint8Array.from([0xfe, 0xff, 0, 0x4f, 0, 0x6b]);
    const { pages } = await build([
      source(file(["# Title"], "notes.md")),
      source(file(["# not a heading"], "notes.txt")),
      source(file([utf16le], "le.txt")),
      source(file([utf16be], "be.txt")),
    ]);
    expect(pages.map((page) => page.text)).toEqual(["Title", "# not a heading", "Hi", "Ok"]);
  });

  it("warns about an empty text file and about replaced characters", async () => {
    const one = await build([source(file([""], "empty.txt")), text("Arrow →")]);
    expect(one.warnings).toEqual([
      '"empty.txt" is empty, so nothing was added from it.',
      '1 character is not in the PDF\'s built-in fonts and was replaced with a similar character or "?".',
    ]);
    const two = await build([text("日本")]);
    expect(two.replacedCharacters).toBe(2);
    expect(two.warnings[0]).toMatch(/^2 characters are .* were replaced/);
  });

  it("saves the title and draws it on the first page made from text", async () => {
    const pdf = await makePdf([[200, 200]]);
    const { pages, bytes } = await build(
      [source(file([pdf], "first.pdf")), text("Body"), text("More")],
      { title: "  My file  ", showTitle: true },
    );
    expect(pages[0].text).toBe("");
    expect(pages[1].text).toBe("My file Body");
    expect(pages[2].text).toBe("More");
    const lib = await pdfLib;
    const saved = await lib.PDFDocument.load(bytes);
    expect(saved.getTitle()).toBe("My file");
    expect(saved.getCreator()).toBe("Kyte PDF");
  });

  it("uses the page size, orientation, margins and font size given", async () => {
    const { pages } = await build([text("Hello")], {
      pageSize: "a4",
      orientation: "landscape",
      margins: 30,
      fontSize: 14,
    });
    expect(pages[0].width).toBeCloseTo(841.89);
    expect(pages[0].content).toContain("1 0 0 1 30 ");
    expect(pages[0].content).toContain(" 14 Tf");
  });
});

describe("buildPdfFromSources: PDFs", () => {
  it("copies every page in order, keeping page sizes", async () => {
    const a = await makePdf([
      [200, 300],
      [400, 500],
    ]);
    const { pages, pageCount } = await build([source(file([a], "a.pdf")), text("After")]);
    expect(pageCount).toBe(3);
    expect(pages.map((page) => [page.width, page.height])).toEqual([
      [200, 300],
      [400, 500],
      [612, 792],
    ]);
  });

  it("copies a PDF that only has an owner password", async () => {
    quietPdfLib();
    const restricted = await makePdf([[300, 300]], { user: "" });
    const { pageCount } = await build([source(file([restricted], "restricted.pdf"))]);
    expect(pageCount).toBe(1);
  });

  it("points to Unlock PDF for a password-protected file", async () => {
    quietPdfLib();
    const locked = await makePdf([[300, 300]], { user: "open-sesame" });
    const error = await buildPdfFromSources([source(file([locked], "locked.pdf"))]).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error.message).toBe(
      '"locked.pdf" is password-protected. Open it in the Unlock PDF tool to remove the password, then add it again.',
    );
  });

  it("names a file that is not a readable PDF", async () => {
    const error = await buildPdfFromSources([source(file(["hello"], "fake.pdf"))]).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error.message).toMatch(/^Kyte could not read "fake\.pdf"\. /);
  });

  it("warns about a PDF with no pages", async () => {
    const empty = await makePdf([]);
    const { warnings } = await build([source(file([empty], "empty.pdf")), text("x")]);
    expect(warnings).toEqual(['"empty.pdf" has no pages, so nothing was added from it.']);
  });
});

describe("buildPdfFromSources: images", () => {
  it("embeds PNG and JPEG directly, centred and never enlarged", async () => {
    const { pages } = await build([
      source(file([PNG_1X1], "dot.png")),
      source(file([jpeg(40, 20)], "photo.jpg")),
    ]);
    expect(createImageBitmap).not.toHaveBeenCalled();
    // 1px is drawn at 0.75pt, centred on a portrait letter page.
    expect(pages[0]).toMatchObject({ width: 612, height: 792 });
    expect(pages[0].content).toContain("1 0 0 1 305.625 395.625 cm");
    // A wide image gets a landscape page.
    expect(pages[1]).toMatchObject({ width: 792, height: 612 });
    expect(pages[1].content).toMatch(/\/Image-\d+ Do/);
  });

  it("scales large images down to fit inside the margins", async () => {
    const { pages } = await build([source(file([jpeg(4000, 1000)], "wide.jpg"))], {
      imagePageOrientation: "fixed",
      margins: 36,
    });
    expect(pages[0]).toMatchObject({ width: 612, height: 792 });
    // Width fills the 540pt between the margins; height keeps the 4:1 shape.
    expect(pages[0].content).toContain("540 0 0 135 0 0 cm");
  });

  it("turns JPEGs the way their EXIF orientation says", async () => {
    const { pages } = await build([
      source(file([jpeg(40, 20, { orientation: 6 })], "six.jpg")),
      source(file([jpeg(40, 20, { orientation: 8 })], "eight.jpg")),
      source(file([jpeg(40, 20, { orientation: 3 })], "three.jpg")),
    ]);
    // Sideways photos are tall once turned, so their pages are portrait.
    expect(pages.map((page) => page.width)).toEqual([612, 612, 792]);
    expect(pages[0].content).toMatch(/-1 1 [\d.e-]+ 0 0 cm/);
    expect(pages[1].content).toMatch(/ 1 -1 [\d.e-]+ 0 0 cm/);
    expect(pages[2].content).toMatch(/-1 [\d.e-]+ [\d.e-]+ -1 0 0 cm/);
  });

  it("redraws mirrored JPEGs in the browser as JPEG", async () => {
    await build([source(file([jpeg(40, 20, { orientation: 2 })], "mirror.jpg"))]);
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(File), {
      imageOrientation: "from-image",
    });
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/jpeg",
      0.92,
    );
  });

  it("converts WebP, GIF, BMP and AVIF through a canvas to PNG", async () => {
    const { pages } = await build([
      source(file(["RIFF....WEBP"], "a.webp", "image/webp")),
      source(file(["GIF89a"], "b.gif")),
    ]);
    expect(createImageBitmap).toHaveBeenCalledTimes(2);
    expect(canvases[0].width).toBe(0);
    expect(pages[0]).toMatchObject({ width: 792, height: 612 });
  });

  it("falls back to the canvas when pdf-lib cannot read a PNG", async () => {
    const broken = Uint8Array.from([...PNG_1X1.slice(0, 16), 1, 2, 3]);
    const { pageCount } = await build([source(file([broken], "broken.png"))]);
    expect(pageCount).toBe(1);
    expect(createImageBitmap).toHaveBeenCalled();
  });

  it("keeps huge images under the canvas size limit", async () => {
    let size = { width: 0, height: 0 };
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
    ) {
      size = { width: this.width, height: this.height };
      callback(new Blob([PNG_1X1]));
    });
    vi.mocked(createImageBitmap).mockResolvedValue({
      width: 10_000,
      height: 10_000,
      close: vi.fn(),
    } as any);
    await build([source(file(["x"], "big.webp"))]);
    expect(size).toEqual({ width: 4096, height: 4096 });
  });

  it("draws SVGs through an image element, sharper than their natural size", async () => {
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: vi.fn(() => "blob:svg"), revokeObjectURL: revoke }),
    );
    const sizes = [
      { naturalWidth: 100, naturalHeight: 50 },
      { naturalWidth: 0, naturalHeight: 0 },
    ];
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        naturalWidth: number;
        naturalHeight: number;
        constructor() {
          Object.assign(this, sizes.shift());
        }
        decode() {
          return Promise.resolve();
        }
      },
    );
    let drawn: number[] = [];
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
    ) {
      drawn.push(this.width, this.height);
      callback(new Blob([PNG_1X1]));
    });
    const { pages } = await build([
      source(file(["<svg/>"], "logo.svg", "image/svg+xml")),
      source(file(["<svg/>"], "blank.svg")),
    ]);
    expect(drawn).toEqual([2000, 1000, 2000, 2000]);
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledTimes(2);
    // Laid out at the natural 100 × 50 px.
    expect(pages[0].content).toContain("75 0 0 37.5 0 0 cm");
    drawn = [];
  });

  it("explains when the browser cannot read an image", async () => {
    const expected =
      'Kyte could not read the image "photo.avif". This browser may not support this image type. Save it as PNG or JPG and try again.';
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error("decode failed"));
    await expect(build([source(file(["x"], "photo.avif"))])).rejects.toThrow(expected);

    vi.stubGlobal("createImageBitmap", undefined);
    await expect(build([source(file(["x"], "photo.avif"))])).rejects.toThrow(expected);
  });

  it("explains when the canvas cannot be used", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(build([source(file(["x"], "a.bmp"))])).rejects.toThrow(
      /could not read the image "a\.bmp"/,
    );

    vi.mocked(HTMLCanvasElement.prototype.getContext).mockRestore();
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback: BlobCallback) =>
      callback(null),
    );
    await expect(build([source(file(["x"], "a.bmp"))])).rejects.toThrow(/could not read the image/);
  });

  it("revokes the SVG address when it fails to load", async () => {
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: vi.fn(() => "blob:bad"), revokeObjectURL: revoke }),
    );
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        decode() {
          return Promise.reject(new Error("bad svg"));
        }
      },
    );
    await expect(build([source(file(["<svg"], "bad.svg"))])).rejects.toThrow(/"bad\.svg"/);
    expect(revoke).toHaveBeenCalledWith("blob:bad");
  });

  it("wraps unexpected failures with the file name", async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback: BlobCallback) =>
      callback(new Blob(["not a png"])),
    );
    const error = await buildPdfFromSources([source(file(["x"], "odd.gif"))]).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error.message).toMatch(/^Kyte could not add "odd\.gif"\. /);
  });
});

describe("buildPdfFromSources: converted documents", () => {
  it("converts Word files with anydoc and draws the Markdown", async () => {
    const convert = vi
      .spyOn(anydocEngine, "convert")
      .mockResolvedValue({ markdown: "# Report\n\nBody text" } as any);
    const { pages } = await build([source(file(["PK"], "report.docx"))]);
    expect(convert).toHaveBeenCalledWith(expect.any(Uint8Array), {
      format: "docx",
      sourceName: "report.docx",
    });
    expect(pages[0]).toMatchObject({ width: 612, height: 792 });
    expect(pages[0].text).toBe("Report Body text");
  });

  it("converts an unchanged file once across rebuilds, but retries after a failure", async () => {
    // The creator's live preview rebuilds after every edit with the same File objects.
    const convert = vi
      .spyOn(anydocEngine, "convert")
      .mockResolvedValue({ markdown: "Converted once" } as any);
    const report = file(["PK"], "cached.docx");
    await build([source(report)]);
    const { pages } = await build([source(report)]);
    expect(convert).toHaveBeenCalledTimes(1);
    expect(pages[0].text).toBe("Converted once");

    // A new File (even with the same name) is converted afresh.
    await build([source(file(["PK"], "cached.docx"))]);
    expect(convert).toHaveBeenCalledTimes(2);

    // A failed conversion isn't kept: the next build tries the same File again.
    const flaky = file(["PK"], "flaky.docx");
    convert.mockRejectedValueOnce(new AnydocError({ reason: "unknown", message: "x" }));
    await expect(build([source(flaky)])).rejects.toThrow('Kyte could not read "flaky.docx"');
    const retried = await build([source(flaky)]);
    expect(retried.pages[0].text).toBe("Converted once");
    expect(convert).toHaveBeenCalledTimes(4);
  });

  it("gives each slide of a deck its own landscape page", async () => {
    vi.spyOn(anydocEngine, "convert").mockResolvedValue({
      markdown: "## First\n\nHello\n\n## Second\n\nBye",
    } as any);
    const { pages } = await build([source(file(["PK"], "deck.pptx"))]);
    expect(pages.map((page) => [page.width, page.text])).toEqual([
      [792, "First Hello"],
      [792, "Second Bye"],
    ]);
    expect(pages[0].content).toContain(" 16 Tf");
  });

  it("puts each sheet on its own page and turns wide sheets landscape", async () => {
    const wide = `| ${"a | ".repeat(8)}\n|${"---|".repeat(8)}\n| ${"1 | ".repeat(8)}`;
    vi.spyOn(anydocEngine, "convert")
      .mockResolvedValueOnce({
        markdown: `## Narrow\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n## Wide\n\n${wide}`,
      } as any)
      .mockResolvedValueOnce({ markdown: "| a | b |\n|---|---|\n| 1 | 2 |" } as any);
    const { pages } = await build([
      source(file(["PK"], "book.xlsx")),
      source(file(["a,b\n1,2"], "data.csv")),
    ]);
    expect(pages.map((page) => page.width)).toEqual([792, 792, 612]);
    expect(pages[0].text).toContain("Narrow");
    expect(pages[1].text).toContain("Wide");
  });

  it("warns when a document has no text", async () => {
    vi.spyOn(anydocEngine, "convert").mockResolvedValue({ markdown: " \n" } as any);
    const { warnings } = await build([source(file(["PK"], "blank.odt")), text("x")]);
    expect(warnings).toEqual([
      '"blank.odt" has no text Kyte can read, so nothing was added from it.',
    ]);
  });

  it.each([
    [
      "encrypted",
      '"a.docx" is password-protected. Remove the password in the app that made it, then add it again.',
    ],
    [
      "engine-unavailable",
      'The document converter could not start, so "a.docx" was not added. Reload the page and try again.',
    ],
    [
      "resourceLimit",
      '"a.docx" is too large or complex to convert in the browser. Try a smaller file.',
    ],
    [
      "malformed",
      'Kyte could not read "a.docx". It may be damaged or in a format Kyte can\'t open. Open it, save a fresh copy and try again.',
    ],
  ] as const)("explains a %s conversion failure", async (reason, message) => {
    vi.spyOn(anydocEngine, "convert").mockRejectedValue(new AnydocError({ reason, message: "x" }));
    const error = await buildPdfFromSources([source(file(["PK"], "a.docx"))]).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error.message).toBe(message);
  });

  it("explains other conversion failures", async () => {
    vi.spyOn(anydocEngine, "convert").mockRejectedValue(
      new Error("The document analysis worker crashed."),
    );
    await expect(build([source(file(["PK"], "a.rtf"))])).rejects.toThrow(
      /^Kyte could not convert "a\.rtf"\. /,
    );
  });
});

describe("buildPdfFromSources: joining", () => {
  it("rejects unsupported files and empty jobs", async () => {
    await expect(build([source(file(["MZ"], "tool.exe"))])).rejects.toThrow(
      `"tool.exe" can't be added. Kyte can use ${SOURCE_TYPES_LABEL}.`,
    );
    await expect(build([])).rejects.toThrow(
      "There is nothing to put in the PDF yet. Type some text or add a file.",
    );
    await expect(build([text(" ")])).rejects.toBeInstanceOf(UserFacingError);
  });

  it("reports progress for each source, then saving", async () => {
    vi.spyOn(anydocEngine, "convert").mockResolvedValue({ markdown: "Doc" } as any);
    const progress: SourcesProgress[] = [];
    await buildPdfFromSources(
      [
        text("One", false),
        source(file(["PK"], "two.docx")),
        source(file([jpeg(2, 2)], "three.jpg")),
      ],
      {},
      (update) => progress.push(update),
    );
    expect(progress.map((p) => `${p.index}:${p.stage}`)).toEqual([
      "0:reading",
      "0:adding",
      "1:reading",
      "1:converting",
      "1:adding",
      "1:adding",
      "2:reading",
      "2:adding",
      "2:saving",
      "2:done",
    ]);
    expect(progress[0]).toMatchObject({ name: "Your text", total: 3, percent: 0 });
    expect(progress.map((p) => p.percent)).toEqual(
      [...progress.map((p) => p.percent)].sort((a, b) => a - b),
    );
    expect(progress.at(-1)?.percent).toBe(100);
    expect(mocks.yieldToMain).toHaveBeenCalledTimes(3);
  });

  it("names typed text sources in progress", async () => {
    const names: string[] = [];
    await buildPdfFromSources(
      [{ kind: "text", text: "a", markdown: true, name: " Cover " }],
      {},
      (p) => names.push(p.name),
    );
    expect(names[0]).toBe("Cover");
  });
});
