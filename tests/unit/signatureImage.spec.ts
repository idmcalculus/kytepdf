import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** jsdom has no FontFace or document.fonts; these stand in for the browser's. */
class FakeFontFace {
  static instances: FakeFontFace[] = [];
  static failNext = false;
  readonly load = vi.fn(async () => {
    if (FakeFontFace.failNext) {
      FakeFontFace.failNext = false;
      throw new Error("network down");
    }
    return this;
  });

  constructor(
    readonly family: string,
    readonly source: string,
  ) {
    FakeFontFace.instances.push(this);
  }
}

const fonts = { add: vi.fn() };

/** A fresh copy of the module, so its once-only font loading starts over. */
const loadModule = async () => {
  vi.resetModules();
  return import("../../utils/signatureImage");
};

const fakeContext = (ink: Partial<TextMetrics> = {}) => {
  const context = {
    font: "",
    fillStyle: "",
    textAlign: "",
    textBaseline: "",
    fontWhenDrawn: "",
    measureText: vi.fn((text: string) => ({ width: text.length * 50, ...ink })),
    fillText: vi.fn(() => {
      context.fontWhenDrawn = context.font;
    }),
  };
  return context;
};

describe("signatureImage", () => {
  beforeEach(() => {
    FakeFontFace.instances = [];
    FakeFontFace.failNext = false;
    vi.stubGlobal("FontFace", FakeFontFace);
    Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (document as { fonts?: unknown }).fonts;
    fonts.add.mockClear();
  });

  it("reads a CSS unicode-range into code point ranges", async () => {
    const { parseUnicodeRange } = await loadModule();

    expect(parseUnicodeRange("U+0000-00FF, U+0131,u+2000-206F")).toEqual([
      [0, 0xff],
      [0x131, 0x131],
      [0x2000, 0x206f],
    ]);
  });

  it("knows which characters the bundled Latin subset covers", async () => {
    const { signatureFontHas } = await loadModule();
    const has = (char: string) => signatureFontHas(char.codePointAt(0) as number);

    expect(["A", "é", "ÿ", "Œ", "€", "™"].map(has)).toEqual([true, true, true, true, true, true]);
    expect(["Š", "ž", "ƒ", "Ł", "李"].map(has)).toEqual([false, false, false, false, false]);
  });

  it("adds the bundled font to the page under its own name, once", async () => {
    const { loadSignatureFont, SIGNATURE_FONT_FAMILY } = await loadModule();

    await expect(Promise.all([loadSignatureFont(), loadSignatureFont()])).resolves.toEqual([
      true,
      true,
    ]);
    await loadSignatureFont();

    expect(FakeFontFace.instances).toHaveLength(1);
    const [face] = FakeFontFace.instances;
    expect(face.family).toBe(SIGNATURE_FONT_FAMILY);
    expect(face.source).toMatch(
      /^url\(".*great-vibes-latin-400-normal.*\.woff"\) format\("woff"\)$/,
    );
    expect(face.load).toHaveBeenCalledOnce();
    expect(fonts.add).toHaveBeenCalledExactlyOnceWith(face);
  });

  it("reports a font that fails to load, and tries again next time", async () => {
    const { loadSignatureFont } = await loadModule();
    // After the module reset, so this is the logger the fresh module uses.
    const { logger } = await import("../../utils/logger");
    const warn = vi.spyOn(logger, "warn");
    FakeFontFace.failNext = true;

    await expect(loadSignatureFont()).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "The handwriting font could not be loaded.",
      expect.any(Error),
    );
    expect(fonts.add).not.toHaveBeenCalled();

    await expect(loadSignatureFont()).resolves.toBe(true);
    expect(FakeFontFace.instances).toHaveLength(2);
  });

  it("gives up quietly where the browser has no FontFace API", async () => {
    vi.stubGlobal("FontFace", undefined);
    const { createSignaturePen, loadSignatureFont } = await loadModule();

    await expect(loadSignatureFont()).resolves.toBe(false);
    await expect(createSignaturePen()).resolves.toBeNull();
  });

  it("has no pen without a 2D canvas", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { createSignaturePen } = await loadModule();

    await expect(createSignaturePen()).resolves.toBeNull();
  });

  it("measures text in points, drawing 4 canvas pixels to the point", async () => {
    const context = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as any);
    const { createSignaturePen } = await loadModule();
    const pen = await createSignaturePen();

    // 50 canvas pixels a character in the fake context.
    expect(pen?.widthOfTextAtSize("Jane", 28)).toBe(50);
    expect(context.font).toBe('112px "Kyte Signature", cursive');
  });

  it("draws a line on a canvas cut to its ink, and places it by its baseline", async () => {
    const context = fakeContext({
      actualBoundingBoxLeft: 10.2,
      actualBoundingBoxRight: 300.4,
      actualBoundingBoxAscent: 80.1,
      actualBoundingBoxDescent: 40.7,
    });
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context as any);
    const { createSignaturePen } = await loadModule();
    const pen = await createSignaturePen();

    const line = pen?.drawLine("Jane Doe", 28, [0.04, 0.06, 0.09]);

    // Each edge is rounded out to whole pixels, with 2 clear pixels around.
    const canvas = getContext.mock.contexts[0] as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([13 + 301 + 2, 83 + 43]);
    expect(context.fillText).toHaveBeenCalledWith("Jane Doe", 13, 83);
    // Resizing the canvas resets its font, so it is set again before drawing.
    expect(context.fontWhenDrawn).toBe('112px "Kyte Signature", cursive');
    expect(context.fillStyle).toBe("rgb(10, 15, 23)");
    expect([context.textAlign, context.textBaseline]).toEqual(["left", "alphabetic"]);
    expect(line).toEqual({
      dataUrl: "data:image/png;base64,abc",
      width: 316 / 4,
      height: 126 / 4,
      left: 13 / 4,
      descent: 43 / 4,
    });
  });

  it("never makes an empty canvas", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      fakeContext({
        actualBoundingBoxLeft: -4,
        actualBoundingBoxRight: 0,
        actualBoundingBoxAscent: -2,
        actualBoundingBoxDescent: 0,
      }) as any,
    );
    const { createSignaturePen } = await loadModule();

    const line = (await createSignaturePen())?.drawLine(" ", 28, [0, 0, 0]);

    expect([line?.width, line?.height]).toEqual([1 / 4, 2 / 4]);
  });
});
