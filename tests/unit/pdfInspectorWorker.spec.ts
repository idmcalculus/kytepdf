import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerRequest, WorkerResponse } from "../../utils/pdfInspectorTypes";

const wasm = vi.hoisted(() => ({
  init: vi.fn(),
  classifyPdf: vi.fn(),
  detectPdf: vi.fn(),
  extractText: vi.fn(),
  processPdf: vi.fn(),
  version: vi.fn(),
}));

vi.mock("@firecrawl/pdf-inspector-wasm", () => ({
  default: wasm.init,
  classifyPdf: wasm.classifyPdf,
  detectPdf: wasm.detectPdf,
  extractText: wasm.extractText,
  processPdf: wasm.processPdf,
  version: wasm.version,
}));

/** Stands in for the worker's global scope: `self.addEventListener` and `postMessage`. */
const scope = vi.hoisted(() => {
  const listeners: Array<(event: MessageEvent) => Promise<void>> = [];
  return {
    listeners,
    self: {
      addEventListener: (type: string, cb: (event: MessageEvent) => Promise<void>) => {
        if (type === "message") listeners.push(cb);
      },
    },
    postMessage: vi.fn(),
  };
});

const okFetch = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(new Uint8Array([0, 97, 115, 109]).buffer),
  });

const fetchMock = vi.fn();

const processResult = (overrides: Record<string, unknown> = {}) => ({
  pdfType: "TextBased",
  markdown: "<!-- Page 1 -->\n\n# Title\n\nSome **bold** body",
  pageCount: 1,
  processingTimeMs: 4,
  pagesNeedingOcr: [] as number[],
  ocrReasonsByPage: [] as Array<{ page: number; reasons: string[] }>,
  title: "Title",
  confidence: 0.95,
  layout: { isComplex: false, pagesWithTables: [] as number[], pagesWithColumns: [] as number[] },
  hasEncodingIssues: false,
  ...overrides,
});

let nextId = 1;
const request = (overrides: Partial<WorkerRequest> = {}): WorkerRequest => ({
  id: nextId++,
  kind: "analyze",
  hash: "hash",
  bytes: new Uint8Array([37, 80, 68, 70]),
  ...overrides,
});

/** Imports a fresh copy of the worker and returns a function that sends it one message. */
async function startWorker() {
  vi.resetModules();
  scope.listeners.length = 0;
  await import("../../utils/pdfInspectorWorker");
  expect(scope.listeners).toHaveLength(1);
  const listener = scope.listeners[0];
  return async (data: unknown): Promise<WorkerResponse | undefined> => {
    scope.postMessage.mockClear();
    await listener({ data } as MessageEvent);
    expect(scope.postMessage.mock.calls.length).toBeLessThanOrEqual(1);
    return scope.postMessage.mock.calls[0]?.[0];
  };
}

describe("pdfInspectorWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("self", scope.self);
    vi.stubGlobal("postMessage", scope.postMessage);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(okFetch);
    wasm.init.mockResolvedValue({});
    wasm.version.mockReturnValue("1.14.1");
    wasm.processPdf.mockImplementation(() => processResult());
    wasm.extractText.mockReturnValue("Title\nSome bold body");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("engine loading", () => {
    it("fetches the WASM binary once from a same-origin path and stamps its version", async () => {
      const send = await startWorker();

      const first = await send(request({ kind: "analyze" }));
      const second = await send(request({ kind: "extract-markdown" }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith("/wasm/pdf_inspector_wasm_bg.wasm");
      expect(wasm.init).toHaveBeenCalledTimes(1);
      // The object form; passing bytes directly logs a deprecation warning.
      expect(wasm.init).toHaveBeenCalledWith({
        module_or_path: new Uint8Array([0, 97, 115, 109]),
      });
      expect(first?.envelope?.engine).toBe("pdf-inspector-wasm");
      expect(first?.envelope?.engineVersion).toBe("1.14.1");
      expect(second?.envelope?.engineVersion).toBe("1.14.1");
    });

    it("shares one download between requests that arrive while the engine is loading", async () => {
      await startWorker();
      const listener = scope.listeners[0];

      await Promise.all([
        listener({ data: request({ id: 101 }) } as MessageEvent),
        listener({ data: request({ id: 102 }) } as MessageEvent),
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(wasm.init).toHaveBeenCalledTimes(1);
      const replies = scope.postMessage.mock.calls.map(([r]) => [r.id, r.ok]);
      expect(replies.sort()).toEqual([
        [101, true],
        [102, true],
      ]);
    });

    it("reports a failed WASM download as engine-unavailable and retries it next time", async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
      const send = await startWorker();

      const failed = await send(request({ id: 41 }));
      expect(failed).toEqual({
        id: 41,
        ok: false,
        failure: {
          reason: "engine-unavailable",
          message: "pdf-inspector wasm fetch failed: 404",
        },
      });
      expect(wasm.init).not.toHaveBeenCalled();

      const recovered = await send(request({ id: 42 }));
      expect(recovered).toMatchObject({ id: 42, ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not cache a failed WASM instantiation", async () => {
      wasm.init.mockRejectedValueOnce(new Error("Out of memory: cannot allocate Wasm memory"));
      const send = await startWorker();

      const failed = await send(request());
      expect(failed?.ok).toBe(false);
      // A load failure is never mistaken for a problem with the document.
      expect(failed?.failure).toEqual({
        reason: "engine-unavailable",
        message: "Out of memory: cannot allocate Wasm memory",
      });

      const recovered = await send(request());
      expect(recovered?.ok).toBe(true);
      expect(wasm.init).toHaveBeenCalledTimes(2);
    });

    it("keeps the text of a load failure that carries no error object", async () => {
      wasm.init.mockRejectedValueOnce("instantiate refused");
      const send = await startWorker();

      const failed = await send(request());

      expect(failed?.failure).toEqual({
        reason: "engine-unavailable",
        message: "instantiate refused",
      });
    });

    it("ignores messages that are not requests", async () => {
      const send = await startWorker();

      expect(await send(null)).toBeUndefined();
      expect(await send({ kind: "analyze" })).toBeUndefined();
      expect(await send({ id: "7", kind: "analyze" })).toBeUndefined();
      expect(scope.postMessage).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("classify", () => {
    it("converts classifyPdf's 0-indexed OCR pages to 1-indexed pages", async () => {
      wasm.classifyPdf.mockReturnValue({
        pdfType: "Mixed",
        pageCount: 3,
        confidence: 0.6,
        pagesNeedingOcr: [0, 2],
      });
      const send = await startWorker();

      const response = await send(request({ id: 5, kind: "classify" }));

      expect(response).toEqual({
        id: 5,
        ok: true,
        classification: {
          pdfType: "Mixed",
          pageCount: 3,
          confidence: 0.6,
          pagesNeedingOcr: [1, 3],
        },
      });
      expect(wasm.processPdf).not.toHaveBeenCalled();
    });

    it.each([
      ["Password required to open this document", "password-required"],
      ["Document needs a password", "password-required"],
      ["Document is encrypted", "encrypted"],
      ["Access denied", "encrypted"],
      ["Invalid PDF header", "malformed"],
      ["File is truncated", "malformed"],
      ["Corrupt xref table", "malformed"],
      ["Memory allocation failed", "resource-limit"],
      ["Resource limit exceeded", "resource-limit"],
      ["JBIG2 filter not supported", "unsupported"],
      // lopdf's wording for broken structure: pdf.js can often still read these.
      ["process PDF: PDF parsing error: couldn't parse input: invalid file trailer", "malformed"],
      ["IO error: failed to fill whole buffer", "malformed"],
      ["missing feature of lopdf: XRef stream. Please open an issue", "unsupported"],
      ["Something odd happened", "unknown"],
    ])("maps the engine error %j to the %s reason", async (message, reason) => {
      wasm.classifyPdf.mockImplementation(() => {
        throw new Error(message);
      });
      const send = await startWorker();

      const response = await send(request({ kind: "classify" }));

      expect(response?.ok).toBe(false);
      expect(response?.failure).toEqual({ reason, message });
    });

    it("keeps the text of a non-Error throw from the WASM boundary", async () => {
      wasm.classifyPdf.mockImplementation(() => {
        throw "panicked at src/lib.rs";
      });
      const send = await startWorker();

      const response = await send(request({ kind: "classify" }));

      expect(response?.failure).toEqual({ reason: "unknown", message: "panicked at src/lib.rs" });
    });
  });

  describe("extract-text", () => {
    it("keeps page markers in the envelope for the OCR merge and returns extractText() as the text", async () => {
      const send = await startWorker();
      const req = request({ kind: "extract-text" });

      const response = await send(req);

      expect(wasm.processPdf).toHaveBeenCalledWith(req.bytes, {
        profile: "compact",
        includePageMarkers: true,
        password: undefined,
        pages: undefined,
      });
      expect(wasm.extractText).toHaveBeenCalledWith(req.bytes);
      expect(response?.ok).toBe(true);
      expect(response?.text).toBe("Title\nSome bold body");
      expect(response?.envelope?.markdown).toContain("<!-- Page 1 -->");
      // Compact is the default for plain text and the output has Markdown.
      expect(response?.envelope?.warnings).toContain(
        "Compact profile: output is token-optimized, not visually faithful.",
      );
    });

    it("passes an explicit profile through", async () => {
      const send = await startWorker();

      const response = await send(request({ kind: "extract-text", profile: "fidelity" }));

      expect(wasm.processPdf).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        expect.objectContaining({ profile: "fidelity", includePageMarkers: true }),
      );
      expect(response?.envelope?.warnings).toEqual([]);
    });

    it.each([
      ["a password", { password: "s3cret" }],
      ["a page filter", { pages: [2] }],
    ])(
      "builds the text from the Markdown when %s is given, since extractText() cannot apply it",
      async (_label, extra) => {
        wasm.processPdf.mockReturnValue(
          processResult({
            markdown:
              "<!-- Page 2 -->\n\n## Heading\n\n**Bold** item with `code`\n\n\n\n> see [the spec](https://x.test/s) for f(x)",
          }),
        );
        const send = await startWorker();

        const response = await send(request({ kind: "extract-text", ...extra }));

        expect(wasm.extractText).not.toHaveBeenCalled();
        expect(wasm.processPdf).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          expect.objectContaining(extra),
        );
        // Link text and "f(x)" survive; only the syntax goes.
        expect(response?.text).toBe("Heading\n\nBold item with code\n\nsee the spec for f(x)");
        expect(response?.text).not.toContain("Page 2");
      },
    );

    it("removes the <sup>/<sub> tags extractText() keeps, and nothing else", async () => {
      // pdf-inspector 1.26's extractText() output for a page with scripts.
      wasm.extractText.mockReturnValue(
        "She came 1<sup>st</sup>; x<sub>max</sub> is the largest.\nCompare a < b and <tag>.",
      );
      const send = await startWorker();

      const response = await send(request({ kind: "extract-text" }));

      expect(response?.text).toBe("She came 1st; xmax is the largest.\nCompare a < b and <tag>.");
    });

    it("falls back to the stripped Markdown when extractText() throws", async () => {
      wasm.extractText.mockImplementation(() => {
        throw new Error("text layer missing");
      });
      wasm.processPdf.mockReturnValue(processResult({ markdown: "# Only heading" }));
      const send = await startWorker();

      const response = await send(request({ kind: "extract-text" }));

      expect(response?.ok).toBe(true);
      expect(response?.text).toBe("Only heading");
    });

    it("returns empty text rather than undefined when nothing can be read", async () => {
      wasm.extractText.mockReturnValue(undefined);
      wasm.processPdf.mockReturnValue(processResult({ markdown: undefined }));
      const send = await startWorker();

      const response = await send(request({ kind: "extract-text" }));

      expect(response?.text).toBe("");
      // No Markdown means no compact-profile warning either.
      expect(response?.envelope?.warnings).toEqual([]);
    });

    it("returns empty stripped text when a filtered request has no Markdown", async () => {
      wasm.processPdf.mockReturnValue(processResult({ markdown: undefined }));
      const send = await startWorker();

      const response = await send(request({ kind: "extract-text", pages: [1] }));

      expect(response?.text).toBe("");
    });

    it("reports processPdf failures with a typed reason", async () => {
      wasm.processPdf.mockImplementation(() => {
        throw new Error("PDF is encrypted: password required");
      });
      const send = await startWorker();

      const response = await send(request({ id: 9, kind: "extract-text" }));

      expect(response).toEqual({
        id: 9,
        ok: false,
        failure: { reason: "password-required", message: "PDF is encrypted: password required" },
      });
    });
  });

  describe("analyze and extract-markdown", () => {
    it("asks for page markers and the fidelity profile by default", async () => {
      const send = await startWorker();

      await send(request({ kind: "analyze", password: "pw", pages: [1, 3] }));
      await send(request({ kind: "extract-markdown" }));

      expect(wasm.processPdf).toHaveBeenNthCalledWith(1, expect.any(Uint8Array), {
        profile: "fidelity",
        includePageMarkers: true,
        password: "pw",
        pages: [1, 3],
      });
      expect(wasm.processPdf).toHaveBeenNthCalledWith(2, expect.any(Uint8Array), {
        profile: "fidelity",
        includePageMarkers: true,
        password: undefined,
        pages: undefined,
      });
    });

    it("sorts page lists and explains what needs attention", async () => {
      wasm.processPdf.mockReturnValue(
        processResult({
          pdfType: "Mixed",
          pageCount: 5,
          confidence: 0.3,
          hasEncodingIssues: true,
          pagesNeedingOcr: [3, 1],
          ocrReasonsByPage: [
            { page: 3, reasons: ["no text layer"] },
            { page: 1, reasons: ["image only"] },
          ],
          layout: { isComplex: true, pagesWithTables: [4, 2], pagesWithColumns: [5, 1] },
        }),
      );
      const send = await startWorker();

      const response = await send(request({ kind: "analyze" }));
      const envelope = response?.envelope;

      expect(envelope).toMatchObject({
        fileType: "application/pdf",
        pdfType: "Mixed",
        pageCount: 5,
        confidence: 0.3,
        hasEncodingIssues: true,
        pagesNeedingOcr: [1, 3],
        ocrReasonsByPage: [
          { page: 1, reasons: ["image only"] },
          { page: 3, reasons: ["no text layer"] },
        ],
        layout: { isComplex: true, pagesWithTables: [2, 4], pagesWithColumns: [1, 5] },
        title: "Title",
        processingTimeMs: 4,
      });
      expect(envelope?.warnings).toEqual([
        "Encoding issues detected in the source PDF; some characters may be missing or garbled.",
        "This document needs OCR on pages 1, 3. Text extraction is limited until those pages are OCR'd.",
        "Confidence is low; results may be incomplete.",
      ]);
    });

    it("uses singular wording for one OCR page and flags compact output", async () => {
      wasm.processPdf.mockReturnValue(processResult({ pagesNeedingOcr: [2] }));
      const send = await startWorker();

      const response = await send(request({ kind: "extract-markdown", profile: "compact" }));

      expect(response?.envelope?.warnings).toEqual([
        "This document needs OCR on page 2. Text extraction is limited until those pages are OCR'd.",
        "Compact profile: output is token-optimized, not visually faithful.",
      ]);
    });

    it("fills in defaults when the engine leaves out layout, OCR reasons or type", async () => {
      wasm.processPdf.mockReturnValue(
        processResult({ pdfType: "", layout: undefined, ocrReasonsByPage: undefined }),
      );
      const send = await startWorker();

      const response = await send(request({ kind: "analyze" }));

      expect(response?.envelope).toMatchObject({
        pdfType: "Unknown",
        ocrReasonsByPage: [],
        layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
      });
    });

    it("falls back to detection only when full extraction fails", async () => {
      wasm.processPdf.mockImplementation(() => {
        throw new Error("content stream decode failed");
      });
      wasm.detectPdf.mockReturnValue(
        processResult({ pdfType: "Scanned", markdown: undefined, pagesNeedingOcr: [1] }),
      );
      const send = await startWorker();

      const response = await send(request({ kind: "analyze", password: "pw" }));

      expect(wasm.detectPdf).toHaveBeenCalledWith(expect.any(Uint8Array), { password: "pw" });
      expect(response?.ok).toBe(true);
      expect(response?.envelope?.pdfType).toBe("Scanned");
      expect(response?.envelope?.markdown).toBeUndefined();
      expect(response?.envelope?.warnings).toEqual([
        "Full extraction failed (content stream decode failed); returning detection only.",
        "This document needs OCR on page 1. Text extraction is limited until those pages are OCR'd.",
      ]);
    });

    it("names a non-Error extraction failure in the detection warning", async () => {
      wasm.processPdf.mockImplementation(() => {
        throw "stack overflow";
      });
      wasm.detectPdf.mockReturnValue(processResult({ markdown: undefined }));
      const send = await startWorker();

      const response = await send(request({ kind: "analyze" }));

      expect(response?.envelope?.warnings).toContain(
        "Full extraction failed (stack overflow); returning detection only.",
      );
    });

    it("reports a failure when detection also fails", async () => {
      wasm.processPdf.mockImplementation(() => {
        throw new Error("bad xref");
      });
      wasm.detectPdf.mockImplementation(() => {
        throw new Error("Not a PDF file");
      });
      const send = await startWorker();

      const response = await send(request({ kind: "extract-markdown" }));

      expect(response?.ok).toBe(false);
      expect(response?.failure).toEqual({ reason: "malformed", message: "Not a PDF file" });
    });
  });

  describe("WASM traps", () => {
    const trapped = () => {
      throw new WebAssembly.RuntimeError("Unreachable code should not be executed");
    };
    const fatalReply = (id: number) => ({
      id,
      ok: false,
      fatal: true,
      failure: {
        reason: "resource-limit",
        message: "The document is too large to process in this browser.",
      },
    });

    it("asks for a fresh worker instead of falling back to detectPdf on the broken instance", async () => {
      wasm.processPdf.mockImplementation(trapped);
      const send = await startWorker();

      const response = await send(request({ id: 81, kind: "analyze" }));

      expect(response).toEqual(fatalReply(81));
      expect(wasm.detectPdf).not.toHaveBeenCalled();
    });

    it("does not hide a trap in extractText() behind the Markdown fallback", async () => {
      wasm.extractText.mockImplementation(trapped);
      const send = await startWorker();

      const response = await send(request({ id: 82, kind: "extract-text" }));

      expect(response).toEqual(fatalReply(82));
    });

    it("reports a trap while classifying the same way", async () => {
      wasm.classifyPdf.mockImplementation(trapped);
      const send = await startWorker();

      expect(await send(request({ id: 83, kind: "classify" }))).toEqual(fatalReply(83));
    });
  });

  it("rejects unknown request kinds without touching the engine", async () => {
    const send = await startWorker();

    const response = await send(request({ id: 77, kind: "rasterize" as WorkerRequest["kind"] }));

    expect(response).toEqual({
      id: 77,
      ok: false,
      failure: { reason: "unknown", message: "Unknown request kind" },
    });
    expect(wasm.processPdf).not.toHaveBeenCalled();
    expect(wasm.classifyPdf).not.toHaveBeenCalled();
  });
});
