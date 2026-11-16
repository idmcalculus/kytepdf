import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createWorker: vi.fn(),
  rasterizePdfPagesStream: vi.fn(),
}));

vi.mock("tesseract.js", () => ({
  createWorker: mocks.createWorker,
}));

vi.mock("../../utils/pageRasterizer.ts", () => ({
  rasterizePdfPagesStream: mocks.rasterizePdfPagesStream,
  rasterizePdfPages: vi.fn(),
}));

/** Yields one fake rasterized page per requested page number. */
function streamOf(pages: number[]) {
  return async function* () {
    for (const page of pages) {
      // Distinct bytes per page so the content-hash cache never collides.
      yield { page, png: new Uint8Array([page, page, page]), width: 10, height: 10 };
    }
  };
}

describe("OcrEngine worker lifecycle", () => {
  let originalCrypto: Crypto;
  let digestCounter: number;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    originalCrypto = globalThis.crypto;
    digestCounter = 0;
    // Hash must differ per page, otherwise the page-2 result is served from
    // the page-1 cache entry and never reaches the worker at all.
    Object.defineProperty(globalThis, "crypto", {
      value: {
        subtle: {
          digest: vi.fn(async () => {
            const buf = new Uint8Array(32);
            buf[0] = digestCounter++;
            return buf.buffer;
          }),
        },
      } as unknown as Crypto,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", { value: originalCrypto, configurable: true });
  });

  it("recovers with a fresh worker after a page times out, instead of failing every later page", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([1, 2, 3]));

    const terminate = vi.fn().mockResolvedValue(undefined);
    let spawnCount = 0;

    mocks.createWorker.mockImplementation(async () => {
      spawnCount++;
      const isFirstWorker = spawnCount === 1;
      let recognizeCalls = 0;
      return {
        terminate,
        recognize: vi.fn(async () => {
          recognizeCalls++;
          // The first worker hangs forever on its first page, tripping the
          // per-page timeout. Any later page handed to a *terminated* worker
          // would previously reject and cascade through the whole run.
          if (isFirstWorker && recognizeCalls === 1) {
            return new Promise(() => {});
          }
          return { data: { text: "recognized", confidence: 90 } };
        }),
      };
    });

    const { ocrEngine } = await import("../../utils/ocrEngine");

    vi.useFakeTimers();
    const runPromise = ocrEngine.ocrPdfPages(new Uint8Array([1]), [1, 2, 3], {
      pageTimeoutMs: 1000,
    });
    // Let the first page reach recognize(), then trip its timeout.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1001);
    vi.useRealTimers();

    const result = await runPromise;

    // Page 1 timed out and was skipped; pages 2 and 3 still succeeded.
    expect(result.pages.map((p) => p.page)).toEqual([2, 3]);
    expect(result.warnings.some((w) => /page 1 ocr timed out/i.test(w))).toBe(true);
    // A replacement worker was spawned after the timeout tore the first down.
    expect(spawnCount).toBeGreaterThanOrEqual(2);
    expect(terminate).toHaveBeenCalled();

    await ocrEngine.terminate();
  });

  it("stops the run instead of emitting one failure per page when the worker cannot start", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([1, 2, 3]));
    mocks.createWorker.mockRejectedValue(new Error("wasm blocked"));

    const { ocrEngine } = await import("../../utils/ocrEngine");
    const result = await ocrEngine.ocrPdfPages(new Uint8Array([1]), [1, 2, 3]);

    expect(result.pages).toEqual([]);
    const stopWarnings = result.warnings.filter((w) => /OCR stopped at page/i.test(w));
    expect(stopWarnings).toHaveLength(1);
    expect(stopWarnings[0]).toContain("wasm blocked");
  });

  it("surfaces rasterization failures as a typed OcrError", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(async function* () {
      throw new Error("this PDF is encrypted");
      // biome-ignore lint/correctness/noUnreachable: generator needs a yield for typing
      yield { page: 1, png: new Uint8Array([1]), width: 1, height: 1 };
    });

    const { ocrEngine, OcrError } = await import("../../utils/ocrEngine");

    await expect(ocrEngine.ocrPdfPages(new Uint8Array([1]), [1])).rejects.toBeInstanceOf(OcrError);
  });

  it("closes the rasterizer stream when the run aborts early", async () => {
    const cleanup = vi.fn();
    mocks.rasterizePdfPagesStream.mockImplementation(async function* () {
      try {
        yield { page: 1, png: new Uint8Array([1]), width: 1, height: 1 };
        yield { page: 2, png: new Uint8Array([2]), width: 1, height: 1 };
      } finally {
        // Stands in for destroying the pdf.js document.
        cleanup();
      }
    });
    mocks.createWorker.mockRejectedValue(new Error("no worker"));

    const { ocrEngine } = await import("../../utils/ocrEngine");
    await ocrEngine.ocrPdfPages(new Uint8Array([1]), [1, 2]);

    expect(cleanup).toHaveBeenCalled();
  });

  it("returns early without spawning a worker when no pages are requested", async () => {
    const { ocrEngine } = await import("../../utils/ocrEngine");
    const result = await ocrEngine.ocrPdfPages(new Uint8Array([1]), []);

    expect(result.pages).toEqual([]);
    expect(mocks.createWorker).not.toHaveBeenCalled();
    expect(mocks.rasterizePdfPagesStream).not.toHaveBeenCalled();
  });
});

describe("OcrEngine runs", () => {
  let originalCrypto: Crypto;

  /** A tesseract worker that recognises every image as `text`. */
  const fakeWorker = (text = "recognized", confidence: number | undefined = 90) => ({
    terminate: vi.fn().mockResolvedValue(undefined),
    recognize: vi.fn(async () => ({ data: { text, confidence } })),
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    originalCrypto = globalThis.crypto;
    // Hash by content so identical page images share a cache entry.
    Object.defineProperty(globalThis, "crypto", {
      value: {
        subtle: {
          digest: vi.fn(async (_alg: string, data: ArrayBuffer) => {
            const buf = new Uint8Array(32);
            buf.set(new Uint8Array(data).slice(0, 32));
            return buf.buffer;
          }),
        },
      } as unknown as Crypto,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, "crypto", { value: originalCrypto, configurable: true });
  });

  it("reuses one worker for every page and for later runs in the same language", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([1, 2]));
    const worker = fakeWorker();
    mocks.createWorker.mockResolvedValue(worker);
    const { ocrEngine } = await import("../../utils/ocrEngine");

    await ocrEngine.ocrPdfPages(new Uint8Array([1]), [1, 2]);
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([3]));
    await ocrEngine.ocrPdfPages(new Uint8Array([1]), [3]);

    expect(mocks.createWorker).toHaveBeenCalledTimes(1);
    expect(mocks.createWorker.mock.calls[0][0]).toBe("eng");
    expect(worker.recognize).toHaveBeenCalledTimes(3);
    await ocrEngine.terminate();
  });

  it("loads same-origin OCR files the production CSP allows", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([1]));
    mocks.createWorker.mockResolvedValue(fakeWorker());
    const { ocrEngine } = await import("../../utils/ocrEngine");

    await ocrEngine.ocrPdfPages(new Uint8Array([1]), [1]);

    const options = mocks.createWorker.mock.calls[0][2];
    expect(options).toMatchObject({
      workerPath: "/tesseract/worker.min.js",
      // Not the ".wasm.js" build: that one fetch()es its WASM from a data:
      // URL, which connect-src blocks in production.
      corePath: "/tesseract/tesseract-core-simd-lstm.js",
      langPath: "/tesseract/lang-data",
    });
    // The sync script copies these from node_modules into public/tesseract.
    const { existsSync } = await import("node:fs");
    for (const file of ["tesseract-core-simd-lstm.js", "tesseract-core-simd-lstm.wasm"]) {
      expect(existsSync(`node_modules/tesseract.js-core/${file}`)).toBe(true);
    }
    await ocrEngine.terminate();
  });

  it("shares one worker start between runs that begin together", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([1]));
    let finishStart: (w: unknown) => void = () => {};
    mocks.createWorker.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishStart = resolve;
        }),
    );
    const { ocrEngine } = await import("../../utils/ocrEngine");

    const runA = ocrEngine.ocrPdfPages(new Uint8Array([1]), [1]);
    await vi.waitFor(() => expect(mocks.createWorker).toHaveBeenCalledTimes(1));
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([2]));
    const runB = ocrEngine.ocrPdfPages(new Uint8Array([1]), [2]);
    await new Promise((r) => setTimeout(r, 0));
    finishStart(fakeWorker());

    const [a, b] = await Promise.all([runA, runB]);
    expect(mocks.createWorker).toHaveBeenCalledTimes(1);
    expect(a.pages.map((p) => p.page)).toEqual([1]);
    expect(b.pages.map((p) => p.page)).toEqual([2]);
    await ocrEngine.terminate();
  });

  it("replaces the worker when the language changes", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([1]));
    const english = fakeWorker("hello");
    const german = fakeWorker("hallo");
    mocks.createWorker.mockResolvedValueOnce(english).mockResolvedValueOnce(german);
    const { ocrEngine } = await import("../../utils/ocrEngine");

    await ocrEngine.ocrPdfPages(new Uint8Array([1]), [1]);
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([2]));
    const result = await ocrEngine.ocrPdfPages(new Uint8Array([1]), [2], { languages: "deu" });

    expect(mocks.createWorker.mock.calls[1][0]).toBe("deu");
    expect(english.terminate).toHaveBeenCalled();
    expect(result.language).toBe("deu");
    expect(result.pages[0].text).toBe("hallo");
    await ocrEngine.terminate();
  });

  it("answers a repeated page image from the cache under its new page number", async () => {
    const samePng = () =>
      async function* (pages: number[]) {
        for (const page of pages)
          yield { page, png: new Uint8Array([7, 7, 7]), width: 1, height: 1 };
      };
    mocks.rasterizePdfPagesStream.mockImplementation((_bytes: Uint8Array, pages: number[]) =>
      samePng()(pages),
    );
    const worker = fakeWorker("Same scan");
    mocks.createWorker.mockResolvedValue(worker);
    const { ocrEngine } = await import("../../utils/ocrEngine");

    await ocrEngine.ocrPdfPages(new Uint8Array([1]), [1]);
    const second = await ocrEngine.ocrPdfPages(new Uint8Array([1]), [4]);

    expect(worker.recognize).toHaveBeenCalledTimes(1);
    expect(second.pages).toEqual([expect.objectContaining({ page: 4, text: "Same scan" })]);
    await ocrEngine.terminate();
  });

  it("cleans the page list and caps it at the page budget", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([1, 3]));
    mocks.createWorker.mockResolvedValue(fakeWorker());
    const { ocrEngine } = await import("../../utils/ocrEngine");
    const pdf = new Uint8Array([1]);

    const result = await ocrEngine.ocrPdfPages(pdf, [5, 3, 3, 0, -2, 1, 4], {
      maxPages: 2,
      maxEdgePx: 1200,
    });

    expect(mocks.rasterizePdfPagesStream).toHaveBeenCalledWith(pdf, [1, 3], 1200);
    expect(result.warnings).toContain("OCR limited to first 2 of 4 requested pages.");
    expect(result.pages.map((p) => p.page)).toEqual([1, 3]);
    await ocrEngine.terminate();
  });

  it.each([
    ["an error", new Error("bad image"), "Page 1 OCR failed: bad image"],
    ["a non-error", "decoder panic", "Page 1 OCR failed: unknown error"],
  ])("records a page that fails with %s and carries on with the rest", async (_label, failure, warning) => {
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([1, 2]));
    const worker = fakeWorker();
    worker.recognize.mockRejectedValueOnce(failure);
    mocks.createWorker.mockResolvedValue(worker);
    const { ocrEngine } = await import("../../utils/ocrEngine");

    const result = await ocrEngine.ocrPdfPages(new Uint8Array([1]), [1, 2]);

    expect(result.pages.map((p) => p.page)).toEqual([2]);
    expect(result.warnings).toEqual([warning]);
    // A bad page is not a dead worker: no restart.
    expect(mocks.createWorker).toHaveBeenCalledTimes(1);
    expect(worker.terminate).not.toHaveBeenCalled();
    await ocrEngine.terminate();
  });

  it("normalises recognition output", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([1, 2]));
    const worker = fakeWorker();
    worker.recognize
      .mockResolvedValueOnce({ data: { text: "  Scanned words \n", confidence: 87 } })
      .mockResolvedValueOnce({ data: {} } as any);
    mocks.createWorker.mockResolvedValue(worker);
    const { ocrEngine } = await import("../../utils/ocrEngine");

    const result = await ocrEngine.ocrPdfPages(new Uint8Array([1]), [1, 2]);

    expect(result.pages).toEqual([
      expect.objectContaining({ page: 1, text: "Scanned words", confidence: 0.87 }),
      expect.objectContaining({ page: 2, text: "", confidence: 0 }),
    ]);
    expect(result).toMatchObject({
      engine: "tesseract.js",
      engineVersion: "6.0.1",
      language: "eng",
    });
    await ocrEngine.terminate();
  });

  it("discards a worker that finishes starting after terminate()", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([1]));
    let finishStart: (w: unknown) => void = () => {};
    mocks.createWorker.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishStart = resolve;
        }),
    );
    const { ocrEngine } = await import("../../utils/ocrEngine");

    const run = ocrEngine.ocrPdfPages(new Uint8Array([1]), [1]);
    await vi.waitFor(() => expect(mocks.createWorker).toHaveBeenCalled());
    await ocrEngine.terminate();
    const late = fakeWorker();
    finishStart(late);

    const result = await run;
    expect(late.terminate).toHaveBeenCalled();
    expect(late.recognize).not.toHaveBeenCalled();
    expect(result.pages).toEqual([]);
    expect(result.warnings).toEqual([
      "OCR stopped at page 1: OCR worker was superseded before it finished loading.",
    ]);
  });

  it("reports a worker start failure that carries no error object", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([1]));
    mocks.createWorker.mockRejectedValue("blocked");
    const { ocrEngine } = await import("../../utils/ocrEngine");

    const result = await ocrEngine.ocrPdfPages(new Uint8Array([1]), [1]);

    expect(result.warnings).toEqual(["OCR stopped at page 1: Failed to start the OCR worker."]);
  });

  it("keeps the reason of an OCR error raised while rasterizing", async () => {
    const { OcrError: RealOcrError } = await import("../../utils/ocrEngine");
    const tooBig = new RealOcrError("resource-limit", "Page is too large to rasterize.");
    mocks.rasterizePdfPagesStream.mockImplementation(async function* () {
      throw tooBig;
      // biome-ignore lint/correctness/noUnreachable: generator needs a yield for typing
      yield { page: 1, png: new Uint8Array([1]), width: 1, height: 1 };
    });
    const { ocrEngine } = await import("../../utils/ocrEngine");

    await expect(ocrEngine.ocrPdfPages(new Uint8Array([1]), [1])).rejects.toBe(tooBig);
  });

  it("explains a rasterizer failure that carries no error object", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(async function* () {
      throw "no canvas";
      // biome-ignore lint/correctness/noUnreachable: generator needs a yield for typing
      yield { page: 1, png: new Uint8Array([1]), width: 1, height: 1 };
    });
    const { ocrEngine } = await import("../../utils/ocrEngine");

    await expect(ocrEngine.ocrPdfPages(new Uint8Array([1]), [1])).rejects.toMatchObject({
      name: "OcrError",
      reason: "unsupported",
      message: "Failed to rasterize PDF pages for OCR.",
    });
  });

  it("terminate() is safe with no worker and when the worker fails to stop", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([1]));
    const worker = fakeWorker();
    worker.terminate.mockRejectedValue(new Error("already gone"));
    mocks.createWorker.mockResolvedValue(worker);
    const { ocrEngine } = await import("../../utils/ocrEngine");

    await expect(ocrEngine.terminate()).resolves.toBeUndefined();
    await ocrEngine.ocrPdfPages(new Uint8Array([1]), [1]);
    await expect(ocrEngine.terminate()).resolves.toBeUndefined();
    expect(worker.terminate).toHaveBeenCalledTimes(1);

    // The next run starts a new worker rather than reusing the stopped one.
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([2]));
    await ocrEngine.ocrPdfPages(new Uint8Array([1]), [2]);
    expect(mocks.createWorker).toHaveBeenCalledTimes(2);
    await ocrEngine.terminate();
  });

  it("merges recognised pages into the native Markdown in page order", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([2]));
    mocks.createWorker.mockResolvedValue(fakeWorker("Scanned middle"));
    const { ocrEngine } = await import("../../utils/ocrEngine");
    const native = "<!-- Page 1 -->\n\nFirst\n\n<!-- Page 2 -->\n\n<!-- Page 3 -->\n\nThird";

    const { markdown, ocr } = await ocrEngine.enrichMarkdownWithOcr(
      new Uint8Array([1]),
      native,
      [2],
      3,
      {
        pageTimeoutMs: 5000,
      },
    );

    expect(markdown).toBe(
      "<!-- Page 1 -->\n\nFirst\n\n<!-- Page 2 -->\n\nScanned middle\n\n<!-- Page 3 -->\n\nThird",
    );
    expect(ocr.pages.map((p) => p.page)).toEqual([2]);
    await ocrEngine.terminate();
  });
});

describe("OcrEngine start failures and partial runs", () => {
  let originalCrypto: Crypto;
  const fakeWorker = () => ({
    terminate: vi.fn().mockResolvedValue(undefined),
    recognize: vi.fn(async () => ({ data: { text: "recognized", confidence: 90 } })),
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      value: {
        subtle: {
          digest: vi.fn(async (_alg: string, data: ArrayBuffer) => {
            const buf = new Uint8Array(32);
            buf.set(new Uint8Array(data).slice(0, 32));
            return buf.buffer;
          }),
        },
      } as unknown as Crypto,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, "crypto", { value: originalCrypto, configurable: true });
  });

  it("stops instead of hanging when the language data fails to load, and retries on the next run", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([1, 2]));
    // tesseract.js reports a failed language download only to errorHandler;
    // its createWorker() promise never settles.
    mocks.createWorker.mockImplementationOnce(
      (_langs: string, _oem: number, options: { errorHandler: (data: unknown) => void }) => {
        setTimeout(
          () => options.errorHandler("Network error while fetching eng.traineddata.gz"),
          0,
        );
        return new Promise(() => {});
      },
    );
    const { ocrEngine } = await import("../../utils/ocrEngine");

    const result = await ocrEngine.ocrPdfPages(new Uint8Array([1]), [1, 2]);

    expect(result.pages).toEqual([]);
    expect(result.warnings).toEqual([
      "OCR stopped at page 1: OCR could not start: Network error while fetching eng.traineddata.gz",
    ]);

    // The failed start was not kept: the next run starts a new worker.
    const worker = fakeWorker();
    mocks.createWorker.mockResolvedValueOnce(worker);
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([3]));
    const retry = await ocrEngine.ocrPdfPages(new Uint8Array([1]), [3]);
    expect(mocks.createWorker).toHaveBeenCalledTimes(2);
    expect(retry.pages.map((p) => p.page)).toEqual([3]);
    await ocrEngine.terminate();
  });

  it("passes an errorHandler, so a later failed job is not thrown as an uncaught error", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([1]));
    mocks.createWorker.mockResolvedValue(fakeWorker());
    const { ocrEngine } = await import("../../utils/ocrEngine");

    await ocrEngine.ocrPdfPages(new Uint8Array([1]), [1]);

    const options = mocks.createWorker.mock.calls[0][2];
    expect(options.errorHandler).toBeTypeOf("function");
    // After a successful start, a report about a failed job changes nothing.
    expect(() => options.errorHandler({ message: "recognize failed" })).not.toThrow();
    await ocrEngine.terminate();
  });

  it("explains a start failure that carries no message", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([1]));
    mocks.createWorker.mockImplementationOnce(
      (_langs: string, _oem: number, options: { errorHandler: (data: unknown) => void }) => {
        setTimeout(() => options.errorHandler({ code: 500 }), 0);
        return new Promise(() => {});
      },
    );
    const { ocrEngine } = await import("../../utils/ocrEngine");

    const result = await ocrEngine.ocrPdfPages(new Uint8Array([1]), [1]);

    expect(result.warnings).toEqual([
      "OCR stopped at page 1: OCR could not start: the OCR engine failed to load.",
    ]);
  });

  it("gives up on a worker that never finishes starting, and stops it if it turns up late", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(streamOf([1]));
    let finishStart: (w: unknown) => void = () => {};
    mocks.createWorker.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStart = resolve;
        }),
    );
    const { ocrEngine } = await import("../../utils/ocrEngine");

    vi.useFakeTimers();
    const run = ocrEngine.ocrPdfPages(new Uint8Array([1]), [1]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_001);
    vi.useRealTimers();
    const result = await run;

    expect(result.warnings).toEqual([
      "OCR stopped at page 1: Starting OCR timed out after 60000ms.",
    ]);
    const late = fakeWorker();
    finishStart(late);
    await vi.waitFor(() => expect(late.terminate).toHaveBeenCalled());
  });

  it("keeps the pages already read when a later page cannot be rendered", async () => {
    mocks.rasterizePdfPagesStream.mockImplementation(async function* () {
      yield { page: 1, png: new Uint8Array([1]), width: 1, height: 1 };
      yield { page: 2, png: new Uint8Array([2]), width: 1, height: 1 };
      throw new Error("Failed to encode page as PNG.");
    });
    mocks.createWorker.mockResolvedValue(fakeWorker());
    const { ocrEngine } = await import("../../utils/ocrEngine");

    const result = await ocrEngine.ocrPdfPages(new Uint8Array([1]), [1, 2, 3]);

    expect(result.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(result.warnings).toEqual([
      "OCR stopped at a page that could not be rendered: Failed to encode page as PNG.",
    ]);
    await ocrEngine.terminate();
  });
});
