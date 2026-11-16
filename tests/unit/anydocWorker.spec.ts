import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnydocWorkerRequest, AnydocWorkerResponse } from "../../utils/anydocTypes";

const wasm = vi.hoisted(() => ({
  init: vi.fn(),
  formatFromBytes: vi.fn(),
  toMarkdownBytes: vi.fn(),
}));

vi.mock("@firecrawl/anydoc-wasm", () => ({
  default: wasm.init,
  formatFromBytes: wasm.formatFromBytes,
  toMarkdownBytes: wasm.toMarkdownBytes,
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

const fetchMock = vi.fn();
const okFetch = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(new Uint8Array([0, 97, 115, 109]).buffer),
  });

/** The anydoc-wasm release that is installed, and so bundled and run. */
const installedAnydocVersion: string = JSON.parse(
  readFileSync("node_modules/@firecrawl/anydoc-wasm/package.json", "utf8"),
).version;

/** anydoc throws an Error with a `code` naming what went wrong. */
const anydocError = (code: string, message: string) => Object.assign(new Error(message), { code });

let nextId = 1;
const request = (overrides: Partial<AnydocWorkerRequest> = {}): AnydocWorkerRequest => ({
  id: nextId++,
  bytes: new Uint8Array([80, 75, 3, 4]),
  ...overrides,
});

async function startWorker() {
  vi.resetModules();
  scope.listeners.length = 0;
  await import("../../utils/anydocWorker");
  expect(scope.listeners).toHaveLength(1);
  const listener = scope.listeners[0];
  return async (data: unknown): Promise<AnydocWorkerResponse | undefined> => {
    scope.postMessage.mockClear();
    await listener({ data } as MessageEvent);
    expect(scope.postMessage.mock.calls.length).toBeLessThanOrEqual(1);
    return scope.postMessage.mock.calls[0]?.[0];
  };
}

describe("anydocWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("self", scope.self);
    vi.stubGlobal("postMessage", scope.postMessage);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(okFetch);
    wasm.init.mockResolvedValue({});
    wasm.formatFromBytes.mockReturnValue("docx");
    wasm.toMarkdownBytes.mockReturnValue("# Report\n\nBody text");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("engine loading", () => {
    it("fetches the WASM binary once from a same-origin path", async () => {
      const send = await startWorker();

      await send(request());
      await send(request());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith("/wasm/anydoc_wasm_bg.wasm");
      expect(wasm.init).toHaveBeenCalledTimes(1);
      // The object form; passing bytes directly logs a deprecation warning.
      expect(wasm.init).toHaveBeenCalledWith({
        module_or_path: new Uint8Array([0, 97, 115, 109]),
      });
    });

    it("shares one download between requests that arrive while the engine is loading", async () => {
      await startWorker();
      const listener = scope.listeners[0];

      await Promise.all([
        listener({ data: request({ id: 201 }) } as MessageEvent),
        listener({ data: request({ id: 202 }) } as MessageEvent),
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(wasm.init).toHaveBeenCalledTimes(1);
      const replies = scope.postMessage.mock.calls.map(([r]) => [r.id, r.ok]);
      expect(replies.sort()).toEqual([
        [201, true],
        [202, true],
      ]);
    });

    it("reports a failed WASM download as engine-unavailable and retries it next time", async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
      const send = await startWorker();

      const failed = await send(request({ id: 11 }));
      expect(failed).toEqual({
        id: 11,
        ok: false,
        failure: { reason: "engine-unavailable", message: "anydoc wasm fetch failed: 503" },
      });
      expect(wasm.toMarkdownBytes).not.toHaveBeenCalled();

      const recovered = await send(request({ id: 12 }));
      expect(recovered).toMatchObject({ id: 12, ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("ignores messages that are not requests", async () => {
      const send = await startWorker();

      expect(await send(undefined)).toBeUndefined();
      expect(await send({ bytes: new Uint8Array() })).toBeUndefined();
      expect(await send({ id: "3" })).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("conversion", () => {
    it("converts with the caller's format and returns a provenance envelope", async () => {
      wasm.formatFromBytes.mockReturnValue(undefined);
      wasm.toMarkdownBytes.mockReturnValue("| a | b |\n| --- | --- |\n| 1 | 2 |");
      const send = await startWorker();
      const req = request({ id: 21, format: "csv", sourceName: "table.csv" });

      const response = await send(req);

      expect(wasm.toMarkdownBytes).toHaveBeenCalledWith(req.bytes, "csv");
      expect(response).toMatchObject({
        id: 21,
        ok: true,
        envelope: {
          format: "csv",
          sourceMime: "text/csv",
          markdown: "| a | b |\n| --- | --- |\n| 1 | 2 |",
          warnings: [],
          engine: "anydoc-wasm",
          // Read from the installed package, so an upgrade can't leave it stale.
          engineVersion: installedAnydocVersion,
          sourceName: "table.csv",
        },
      });
      expect(response?.envelope?.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("uses the format sniffed from the bytes when the caller names none", async () => {
      wasm.formatFromBytes.mockReturnValue("pptx");
      const send = await startWorker();

      const response = await send(request());

      expect(wasm.toMarkdownBytes).toHaveBeenCalledWith(expect.any(Uint8Array), "pptx");
      expect(response?.envelope?.format).toBe("pptx");
      expect(response?.envelope?.sourceMime).toBe(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );
      expect(response?.envelope?.warnings).toEqual([]);
    });

    it("prefers the format read from the bytes, so a DOCX named report.doc still converts", async () => {
      wasm.formatFromBytes.mockReturnValue("docx");
      const send = await startWorker();

      const response = await send(request({ format: "doc", sourceName: "report.doc" }));

      expect(wasm.toMarkdownBytes).toHaveBeenCalledWith(expect.any(Uint8Array), "docx");
      expect(response?.envelope?.format).toBe("docx");
      expect(response?.envelope?.sourceMime).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
    });

    it("uses the caller's format for files with no byte signature, such as CSV", async () => {
      wasm.formatFromBytes.mockReturnValue(undefined);
      const send = await startWorker();

      const response = await send(request({ format: "csv" }));

      expect(wasm.toMarkdownBytes).toHaveBeenCalledWith(expect.any(Uint8Array), "csv");
      expect(response?.envelope?.warnings).toEqual([]);
    });

    it.each([
      ["conversion", "toMarkdownBytes"],
      ["format sniffing", "formatFromBytes"],
    ] as const)(
      "asks for a fresh worker when the WASM instance traps during %s",
      async (_label, fn) => {
        wasm[fn].mockImplementation(() => {
          throw new WebAssembly.RuntimeError("unreachable");
        });
        const send = await startWorker();

        const response = await send(request({ id: 61, format: "docx" }));

        expect(response).toEqual({
          id: 61,
          ok: false,
          fatal: true,
          failure: {
            reason: "resourceLimit",
            message: "The document is too large to process in this browser.",
          },
        });
      },
    );

    it.each([
      ["returns nothing", () => undefined],
      [
        "throws",
        () => {
          throw new Error("signature read failed");
        },
      ],
    ])("lets anydoc guess and warns when format sniffing %s", async (_label, sniff) => {
      wasm.formatFromBytes.mockImplementation(sniff);
      const send = await startWorker();

      const response = await send(request());

      expect(wasm.toMarkdownBytes).toHaveBeenCalledWith(expect.any(Uint8Array), undefined);
      expect(response?.ok).toBe(true);
      expect(response?.envelope?.format).toBe("unknown");
      expect(response?.envelope?.sourceMime).toBe("application/octet-stream");
      expect(response?.envelope?.warnings).toEqual([
        "Format could not be detected from the bytes; Markdown output may not reflect the original structure.",
      ]);
    });

    it("falls back to a generic MIME type for a sniffed format it has no entry for", async () => {
      // anydoc recognises PDFs, which this app sends elsewhere and has no MIME entry for.
      wasm.formatFromBytes.mockReturnValue("pdf");
      const send = await startWorker();

      const response = await send(request());

      expect(response?.envelope?.format).toBe("pdf");
      expect(response?.envelope?.sourceMime).toBe("application/octet-stream");
    });

    it("warns when the parser produced no text", async () => {
      wasm.toMarkdownBytes.mockReturnValue("  \n ");
      const send = await startWorker();

      const response = await send(request({ format: "docx" }));

      expect(response?.ok).toBe(true);
      expect(response?.envelope?.warnings).toEqual([
        "The document parser produced no text. The file may be empty or use an unsupported encoding.",
      ]);
    });
  });

  describe("conversion failures", () => {
    it.each(["unsupported", "malformed", "resourceLimit", "missingPart", "encrypted"])(
      "passes anydoc's %s code and message through",
      async (code) => {
        wasm.toMarkdownBytes.mockImplementation(() => {
          throw anydocError(code, `anydoc says ${code}`);
        });
        const send = await startWorker();

        const response = await send(request({ id: 31, format: "docx" }));

        expect(response).toEqual({
          id: 31,
          ok: false,
          failure: { reason: code, message: `anydoc says ${code}` },
        });
      },
    );

    it("passes needsOcr through for a PDF with scanned pages", async () => {
      // anydoc 0.2's NeedsOcrError: an Error with the scanned pages on it.
      wasm.toMarkdownBytes.mockImplementation(() => {
        throw Object.assign(new Error("pages 2-3 of 3 need OCR"), {
          code: "needsOcr",
          pages: [2, 3],
          pageCount: 3,
        });
      });
      const send = await startWorker();

      const response = await send(request({ id: 32, format: "docx" }));

      expect(response).toEqual({
        id: 32,
        ok: false,
        failure: { reason: "needsOcr", message: "pages 2-3 of 3 need OCR" },
      });
    });

    it("maps codes it does not know to unknown", async () => {
      wasm.toMarkdownBytes.mockImplementation(() => {
        throw anydocError("io", "no filesystem");
      });
      const send = await startWorker();

      const response = await send(request({ format: "docx" }));

      expect(response?.failure).toEqual({ reason: "unknown", message: "no filesystem" });
    });

    it("gives an encrypted failure a readable message when anydoc supplies none", async () => {
      wasm.toMarkdownBytes.mockImplementation(() => {
        throw { code: "encrypted" };
      });
      const send = await startWorker();

      const response = await send(request({ format: "docx" }));

      expect(response?.failure).toEqual({
        reason: "encrypted",
        message: "This document is encrypted.",
      });
    });

    it("keeps the text of a non-Error throw", async () => {
      wasm.toMarkdownBytes.mockImplementation(() => {
        throw "RuntimeError: unreachable";
      });
      const send = await startWorker();

      const response = await send(request({ format: "docx" }));

      expect(response?.failure).toEqual({
        reason: "unknown",
        message: "RuntimeError: unreachable",
      });
    });

    it("reports a null throw as unknown", async () => {
      wasm.toMarkdownBytes.mockImplementation(() => {
        throw null;
      });
      const send = await startWorker();

      const response = await send(request({ format: "docx" }));

      expect(response?.failure).toEqual({ reason: "unknown", message: "null" });
    });

    it("keeps the text of a load failure that carries no error object", async () => {
      wasm.init.mockRejectedValueOnce("instantiate refused");
      const send = await startWorker();

      const response = await send(request());

      expect(response?.failure).toEqual({
        reason: "engine-unavailable",
        message: "instantiate refused",
      });
    });
  });
});
