import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createFakeWorker = () => {
  const listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  const postMessage = vi.fn();
  const addEventListener = vi.fn((type: string, cb: (e: MessageEvent) => void) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(cb);
  });
  const removeEventListener = vi.fn((type: string, cb: (e: MessageEvent) => void) => {
    listeners.get(type)?.delete(cb);
  });
  const dispatch = vi.fn((response: any) => {
    for (const cb of listeners.get("message") ?? []) {
      cb({ data: response } as MessageEvent);
    }
  });
  const dispatchError = vi.fn((err: any) => {
    for (const cb of listeners.get("error") ?? []) {
      cb({ message: err?.message ?? "error", ...err } as MessageEvent);
    }
  });
  function FakeWorker() {
    return {
      addEventListener,
      removeEventListener,
      postMessage,
      terminate: vi.fn(),
    } as unknown as Worker;
  }
  return {
    ctor: FakeWorker as unknown as typeof Worker,
    dispatch,
    dispatchError,
    postMessageSpy: postMessage,
    addEventListenerSpy: addEventListener,
  };
};

describe("PdfInspectorEngine caching + worker plumbing", () => {
  let originalWorker: typeof Worker;
  let originalCrypto: Crypto;
  let fake: ReturnType<typeof createFakeWorker>;

  beforeEach(async () => {
    vi.resetModules();
    originalWorker = globalThis.Worker;
    originalCrypto = globalThis.crypto;
    fake = createFakeWorker();
    (globalThis as any).Worker = fake.ctor;

    const subtle = {
      digest: vi.fn(() => Promise.resolve(new ArrayBuffer(32))),
    };
    Object.defineProperty(globalThis, "crypto", {
      value: { subtle } as unknown as Crypto,
      configurable: true,
    });
  });

  afterEach(() => {
    (globalThis as any).Worker = originalWorker;
    Object.defineProperty(globalThis, "crypto", { value: originalCrypto, configurable: true });
  });

  it("transfers a dedicated buffer copy and keeps the caller bytes intact", async () => {
    const { pdfInspectorEngine } = await import("../../utils/pdfInspectorEngine");
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const originalLength = bytes.byteLength;

    const analyzePromise = pdfInspectorEngine.analyze(bytes);
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.postMessageSpy).toHaveBeenCalledTimes(1);
    const firstCall = fake.postMessageSpy.mock.calls[0];
    const first = firstCall[0] as any;
    const transferList = firstCall[1] as Transferable[] | undefined;
    expect(first.kind).toBe("analyze");
    expect(first.bytes).toBeInstanceOf(Uint8Array);
    // Caller buffer must remain usable after postMessage (we transfer a slice).
    expect(bytes.byteLength).toBe(originalLength);
    expect(bytes[0]).toBe(1);
    if (transferList) {
      expect(transferList.length).toBe(1);
      // Transferred buffer is the worker copy, not the caller's.
      expect(transferList[0]).not.toBe(bytes.buffer);
    }

    fake.dispatch({
      id: first.id,
      ok: true,
      envelope: {
        fileType: "application/pdf",
        pdfType: "TextBased",
        pageCount: 1,
        confidence: 1,
        markdown: "# hi",
        layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
        pagesNeedingOcr: [],
        ocrReasonsByPage: [],
        hasEncodingIssues: false,
        engine: "pdf-inspector-wasm",
        engineVersion: "1.14.1",
        processingTimeMs: 5,
        warnings: [],
      },
    });
    const envelope = await analyzePromise;
    expect(envelope.pdfType).toBe("TextBased");
    expect(bytes.byteLength).toBe(originalLength);
  });

  it("does not reuse a compact cache entry for a fidelity request", async () => {
    const { pdfInspectorEngine } = await import("../../utils/pdfInspectorEngine");
    const bytes = new Uint8Array([9, 9, 9]);

    const first = pdfInspectorEngine.analyze(bytes, { profile: "compact" });
    await new Promise((r) => setTimeout(r, 0));
    const id1 = fake.postMessageSpy.mock.calls[0][0].id;
    fake.dispatch({
      id: id1,
      ok: true,
      envelope: {
        fileType: "application/pdf",
        pdfType: "TextBased",
        pageCount: 1,
        confidence: 1,
        markdown: "compact",
        layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
        pagesNeedingOcr: [],
        ocrReasonsByPage: [],
        hasEncodingIssues: false,
        engine: "pdf-inspector-wasm",
        engineVersion: "1.14.1",
        processingTimeMs: 1,
        warnings: [],
      },
    });
    await first;

    fake.postMessageSpy.mockClear();
    const second = pdfInspectorEngine.analyze(bytes, { profile: "fidelity" });
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.postMessageSpy).toHaveBeenCalledTimes(1);
    const id2 = fake.postMessageSpy.mock.calls[0][0].id;
    fake.dispatch({
      id: id2,
      ok: true,
      envelope: {
        fileType: "application/pdf",
        pdfType: "TextBased",
        pageCount: 1,
        confidence: 1,
        markdown: "fidelity",
        layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
        pagesNeedingOcr: [],
        ocrReasonsByPage: [],
        hasEncodingIssues: false,
        engine: "pdf-inspector-wasm",
        engineVersion: "1.14.1",
        processingTimeMs: 1,
        warnings: [],
      },
    });
    const env = await second;
    expect(env.markdown).toBe("fidelity");
  });

  it("returns the cached envelope without re-posting when re-analyzed", async () => {
    const { pdfInspectorEngine } = await import("../../utils/pdfInspectorEngine");
    const bytes = new Uint8Array([5, 6, 7]);

    const first = pdfInspectorEngine.analyze(bytes);
    await new Promise((r) => setTimeout(r, 0));
    const id = fake.postMessageSpy.mock.calls[0][0].id;
    fake.dispatch({
      id,
      ok: true,
      envelope: {
        fileType: "application/pdf",
        pdfType: "Scanned",
        pageCount: 2,
        confidence: 0.9,
        markdown: "",
        layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
        pagesNeedingOcr: [1, 2],
        ocrReasonsByPage: [],
        hasEncodingIssues: false,
        engine: "pdf-inspector-wasm",
        engineVersion: "1.14.1",
        processingTimeMs: 1,
        warnings: [],
      },
    });
    await first;

    fake.postMessageSpy.mockClear();
    const second = await pdfInspectorEngine.analyze(bytes);
    expect(second.pdfType).toBe("Scanned");
    expect(fake.postMessageSpy).not.toHaveBeenCalled();
  });

  it("never caches passworded requests, since the key can't distinguish which password produced the result", async () => {
    const { pdfInspectorEngine } = await import("../../utils/pdfInspectorEngine");
    const bytes = new Uint8Array([4, 4, 4]);
    const envelopeFor = (markdown: string) => ({
      fileType: "application/pdf",
      pdfType: "TextBased",
      pageCount: 1,
      confidence: 1,
      markdown,
      layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
      pagesNeedingOcr: [],
      ocrReasonsByPage: [],
      hasEncodingIssues: false,
      engine: "pdf-inspector-wasm",
      engineVersion: "1.14.1",
      processingTimeMs: 1,
      warnings: [],
    });

    const first = pdfInspectorEngine.analyze(bytes, { password: "correct-horse" });
    await new Promise((r) => setTimeout(r, 0));
    const id1 = fake.postMessageSpy.mock.calls[0][0].id;
    fake.dispatch({ id: id1, ok: true, envelope: envelopeFor("unlocked with correct password") });
    await first;

    // A *different* password on the identical bytes must not be silently
    // answered from a cache keyed only on "a password was supplied".
    fake.postMessageSpy.mockClear();
    const second = pdfInspectorEngine.analyze(bytes, { password: "totally-different" });
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.postMessageSpy).toHaveBeenCalledTimes(1);
    const id2 = fake.postMessageSpy.mock.calls[0][0].id;
    fake.dispatch({ id: id2, ok: true, envelope: envelopeFor("unlocked with different password") });
    const env2 = await second;
    expect(env2.markdown).toBe("unlocked with different password");
  });

  it("rejects with a typed PdfInspectorError on failure", async () => {
    const { pdfInspectorEngine, PdfInspectorError } = await import(
      "../../utils/pdfInspectorEngine"
    );
    const bytes = new Uint8Array([8]);
    const p = pdfInspectorEngine.analyze(bytes);
    await new Promise((r) => setTimeout(r, 0));
    const id = fake.postMessageSpy.mock.calls[0][0].id;
    fake.dispatch({
      id,
      ok: false,
      failure: { reason: "encrypted", message: "password required" },
    });
    await expect(p).rejects.toMatchObject({
      name: "PdfInspectorError",
      reason: "encrypted",
      message: "password required",
    });
    expect(PdfInspectorError).toBeDefined();
  });

  it("rejects every pending request immediately when one request times out, instead of stranding the rest", async () => {
    vi.useFakeTimers();
    try {
      const { pdfInspectorEngine, PdfInspectorError } = await import(
        "../../utils/pdfInspectorEngine"
      );
      const bytesA = new Uint8Array([1]);
      const bytesB = new Uint8Array([2]);

      const first = pdfInspectorEngine.analyze(bytesA).catch((e) => e);
      await vi.advanceTimersByTimeAsync(0);

      // Start a second request 60s into the first request's 120s timeout
      // window, so their timers are offset rather than coincident.
      await vi.advanceTimersByTimeAsync(60_000);
      const second = pdfInspectorEngine.analyze(bytesB).catch((e) => e);
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.postMessageSpy).toHaveBeenCalledTimes(2);

      // Cross request A's 120s timeout. Request B's own timer would not
      // fire until virtual t=180s, so if it rejects here too, the fix is
      // working (the whole worker — and every pending request on it — is
      // torn down together instead of leaving B stranded).
      await vi.advanceTimersByTimeAsync(60_001);

      const [errA, errB] = await Promise.all([first, second]);
      expect(errA).toBeInstanceOf(PdfInspectorError);
      expect(errB).toBeInstanceOf(PdfInspectorError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("warns when a password is passed to classify(), since the wasm binding can't use it", async () => {
    const { logger } = await import("../../utils/logger");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { pdfInspectorEngine } = await import("../../utils/pdfInspectorEngine");
    const bytes = new Uint8Array([9]);

    const p = pdfInspectorEngine.classify(bytes, { password: "secret" });
    await new Promise((r) => setTimeout(r, 0));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("cannot apply a password"));

    const id = fake.postMessageSpy.mock.calls[0][0].id;
    fake.dispatch({
      id,
      ok: true,
      classification: { pdfType: "TextBased", pageCount: 1, confidence: 1, pagesNeedingOcr: [] },
    });
    await p;
    warnSpy.mockRestore();
  });

  it("classifies and normalizes 1-indexed OCR pages from classifyPdf", async () => {
    const { pdfInspectorEngine } = await import("../../utils/pdfInspectorEngine");
    const bytes = new Uint8Array([9]);
    const p = pdfInspectorEngine.classify(bytes);
    await new Promise((r) => setTimeout(r, 0));
    const id = fake.postMessageSpy.mock.calls[0][0].id;
    expect(fake.postMessageSpy.mock.calls[0][0].kind).toBe("classify");
    fake.dispatch({
      id,
      ok: true,
      classification: {
        pdfType: "Mixed",
        pageCount: 3,
        confidence: 0.7,
        pagesNeedingOcr: [2, 3],
      },
    });
    const cls = await p;
    expect(cls?.pagesNeedingOcr).toEqual([2, 3]);
    expect(cls?.pdfType).toBe("Mixed");
  });
});

/** One fake per spawned worker, so crashes and respawns can be told apart. */
const createWorkerFactory = () => {
  const instances: Array<{
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    reply: (response: unknown) => void;
    crash: () => void;
    lastRequest: () => any;
  }> = [];
  function FakeWorker() {
    const listeners = new Map<string, Array<(e: any) => void>>();
    const instance = {
      addEventListener: (type: string, cb: (e: any) => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), cb]);
      },
      postMessage: vi.fn(),
      terminate: vi.fn(),
      reply: (response: unknown) => {
        for (const cb of listeners.get("message") ?? []) cb({ data: response });
      },
      crash: () => {
        for (const cb of listeners.get("error") ?? []) cb(new Event("error"));
      },
      lastRequest: () => instance.postMessage.mock.calls.at(-1)?.[0],
    };
    instances.push(instance);
    return instance;
  }
  return { ctor: FakeWorker as unknown as typeof Worker, instances };
};

const envelopeWith = (overrides: Record<string, unknown> = {}) => ({
  fileType: "application/pdf",
  pdfType: "TextBased",
  pageCount: 1,
  confidence: 1,
  markdown: "# Doc",
  layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
  pagesNeedingOcr: [],
  ocrReasonsByPage: [],
  hasEncodingIssues: false,
  engine: "pdf-inspector-wasm",
  engineVersion: "1.14.1",
  processingTimeMs: 1,
  warnings: [],
  ...overrides,
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("PdfInspectorEngine requests, failures and caching", () => {
  let originalWorker: typeof Worker;
  let originalCrypto: Crypto;
  let factory: ReturnType<typeof createWorkerFactory>;
  let digest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    originalWorker = globalThis.Worker;
    originalCrypto = globalThis.crypto;
    factory = createWorkerFactory();
    (globalThis as any).Worker = factory.ctor;
    digest = vi.fn(() => Promise.resolve(new Uint8Array(32).fill(0xab).buffer));
    Object.defineProperty(globalThis, "crypto", {
      value: { subtle: { digest } } as unknown as Crypto,
      configurable: true,
    });
  });

  afterEach(() => {
    (globalThis as any).Worker = originalWorker;
    Object.defineProperty(globalThis, "crypto", { value: originalCrypto, configurable: true });
  });

  const load = async () => (await import("../../utils/pdfInspectorEngine")).pdfInspectorEngine;
  const worker = (index = 0) => factory.instances[index];

  describe("worker lifecycle", () => {
    it("spawns the worker lazily and reuses it", async () => {
      const engine = await load();
      expect(factory.instances).toHaveLength(0);

      const first = engine.analyze(new Uint8Array([1]));
      await tick();
      worker().reply({ id: worker().lastRequest().id, ok: true, envelope: envelopeWith() });
      await first;

      const second = engine.extractMarkdown(new Uint8Array([2]));
      await tick();
      worker().reply({ id: worker().lastRequest().id, ok: true, envelope: envelopeWith() });
      await second;

      expect(factory.instances).toHaveLength(1);
    });

    it("ignores stray worker messages and still delivers the real answer", async () => {
      const engine = await load();
      const pending = engine.analyze(new Uint8Array([1]));
      await tick();
      const { id } = worker().lastRequest();

      worker().reply(null);
      worker().reply({ ok: true });
      worker().reply({ id: id + 100, ok: true, envelope: envelopeWith({ markdown: "wrong" }) });
      worker().reply({ id, ok: true, envelope: envelopeWith({ markdown: "right" }) });

      await expect(pending).resolves.toMatchObject({ markdown: "right" });
    });

    it("rejects every in-flight request when the worker crashes, then starts a fresh one", async () => {
      const engine = await load();
      const a = engine.analyze(new Uint8Array([1])).catch((e) => e);
      const b = engine.extractText(new Uint8Array([2])).catch((e) => e);
      await tick();

      worker(0).crash();

      const [errA, errB] = await Promise.all([a, b]);
      expect(errA).toBeInstanceOf(Error);
      expect(errA.message).toBe("The PDF analysis worker crashed.");
      expect(errB.message).toBe("The PDF analysis worker crashed.");
      expect(worker(0).terminate).toHaveBeenCalled();

      // A late second error from the dead worker must not break the next request.
      worker(0).crash();

      const next = engine.analyze(new Uint8Array([3]));
      await tick();
      expect(factory.instances).toHaveLength(2);
      worker(1).reply({ id: worker(1).lastRequest().id, ok: true, envelope: envelopeWith() });
      await expect(next).resolves.toMatchObject({ pdfType: "TextBased" });
    });

    it("tries to create the worker again after a failed start", async () => {
      let attempts = 0;
      (globalThis as any).Worker = class {
        constructor() {
          attempts++;
          if (attempts === 1) throw new Error("Worker blocked");
          // biome-ignore lint/correctness/noConstructorReturn: hands back the fake worker
          return new (factory.ctor as any)();
        }
      };
      const engine = await load();

      await expect(engine.analyze(new Uint8Array([1]))).rejects.toThrow("Worker blocked");

      const retry = engine.analyze(new Uint8Array([1]));
      await tick();
      expect(attempts).toBe(2);
      worker().reply({ id: worker().lastRequest().id, ok: true, envelope: envelopeWith() });
      await expect(retry).resolves.toMatchObject({ pdfType: "TextBased" });
    });

    it("ignores an error from a worker that has already been replaced", async () => {
      const engine = await load();
      const first = engine.analyze(new Uint8Array([1])).catch((e) => e);
      await tick();
      worker(0).crash();
      await first;

      const next = engine.analyze(new Uint8Array([2]));
      await tick();
      expect(factory.instances).toHaveLength(2);

      // The old worker reports again; the new one and its request must survive.
      worker(0).crash();
      expect(worker(1).terminate).not.toHaveBeenCalled();
      worker(1).reply({ id: worker(1).lastRequest().id, ok: true, envelope: envelopeWith() });
      await expect(next).resolves.toMatchObject({ pdfType: "TextBased" });
    });

    it("passes on the browser's error when the worker cannot be created", async () => {
      (globalThis as any).Worker = class {
        constructor() {
          throw new Error("Refused to create a worker: CSP worker-src");
        }
      };
      const engine = await load();

      await expect(engine.analyze(new Uint8Array([1]))).rejects.toThrow(
        "Refused to create a worker: CSP worker-src",
      );
    });

    it("explains a worker start failure that carries no error object", async () => {
      (globalThis as any).Worker = class {
        constructor() {
          throw "blocked";
        }
      };
      const engine = await load();

      await expect(engine.analyze(new Uint8Array([1]))).rejects.toThrow(
        "Failed to start the PDF analysis worker.",
      );
    });
  });

  describe("WASM traps", () => {
    it("replaces the worker after a reply that says its WASM instance trapped", async () => {
      const { pdfInspectorEngine, PdfInspectorError } = await import(
        "../../utils/pdfInspectorEngine"
      );
      const trapped = pdfInspectorEngine.analyze(new Uint8Array([1])).catch((e) => e);
      const other = pdfInspectorEngine.extractText(new Uint8Array([2])).catch((e) => e);
      await tick();
      const [first] = worker(0).postMessage.mock.calls.map(([request]) => request);

      worker(0).reply({
        id: first.id,
        ok: false,
        fatal: true,
        failure: {
          reason: "resource-limit",
          message: "The document is too large to process in this browser.",
        },
      });

      const err = await trapped;
      expect(err).toBeInstanceOf(PdfInspectorError);
      expect(err.reason).toBe("resource-limit");
      expect(worker(0).terminate).toHaveBeenCalled();
      // A request still waiting on the broken instance fails rather than hangs.
      expect((await other).message).toBe("The PDF analysis engine stopped and was restarted.");

      const next = pdfInspectorEngine.analyze(new Uint8Array([3]));
      await tick();
      expect(factory.instances).toHaveLength(2);
      worker(1).reply({ id: worker(1).lastRequest().id, ok: true, envelope: envelopeWith() });
      await expect(next).resolves.toMatchObject({ pdfType: "TextBased" });
    });
  });

  describe("results", () => {
    it("treats a success reply without an envelope as a failure", async () => {
      const { pdfInspectorEngine, PdfInspectorError } = await import(
        "../../utils/pdfInspectorEngine"
      );
      const pending = pdfInspectorEngine.analyze(new Uint8Array([1])).catch((e) => e);
      await tick();
      worker().reply({ id: worker().lastRequest().id, ok: true });

      const err = await pending;
      expect(err).toBeInstanceOf(PdfInspectorError);
      expect(err).toMatchObject({ reason: "unknown", message: "analyze returned no result." });
    });

    it("does not cache failures", async () => {
      const engine = await load();
      const bytes = new Uint8Array([1]);

      const first = engine.analyze(bytes).catch((e) => e);
      await tick();
      worker().reply({
        id: worker().lastRequest().id,
        ok: false,
        failure: { reason: "malformed", message: "bad xref" },
      });
      expect(await first).toMatchObject({ reason: "malformed" });

      const retry = engine.analyze(bytes);
      await tick();
      expect(worker().postMessage).toHaveBeenCalledTimes(2);
      worker().reply({ id: worker().lastRequest().id, ok: true, envelope: envelopeWith() });
      await expect(retry).resolves.toMatchObject({ pdfType: "TextBased" });
    });

    it("rejects classify failures and empty classify replies with typed errors", async () => {
      const engine = await load();

      const failed = engine.classify(new Uint8Array([1])).catch((e) => e);
      await tick();
      worker().reply({
        id: worker().lastRequest().id,
        ok: false,
        failure: { reason: "malformed", message: "Not a PDF" },
      });
      expect(await failed).toMatchObject({
        name: "PdfInspectorError",
        reason: "malformed",
        message: "Not a PDF",
      });

      const empty = engine.classify(new Uint8Array([2])).catch((e) => e);
      await tick();
      worker().reply({ id: worker().lastRequest().id, ok: true });
      expect(await empty).toMatchObject({
        reason: "unknown",
        message: "classify returned no result.",
      });
    });
  });

  describe("extractMarkdown", () => {
    it("asks for fidelity output by default and serves repeats from the cache", async () => {
      const engine = await load();
      const bytes = new Uint8Array([1, 2]);

      const first = engine.extractMarkdown(bytes);
      await tick();
      const sent = worker().lastRequest();
      expect(sent).toMatchObject({ kind: "extract-markdown", profile: "fidelity" });
      worker().reply({ id: sent.id, ok: true, envelope: envelopeWith({ markdown: "# Cached" }) });
      const env = await first;

      const again = await engine.extractMarkdown(bytes, { profile: "fidelity" });
      expect(again).toBe(env);
      expect(worker().postMessage).toHaveBeenCalledTimes(1);
    });

    it("keeps Markdown, text and analysis results apart in the cache", async () => {
      const engine = await load();
      const bytes = new Uint8Array([1, 2]);

      const analyzed = engine.analyze(bytes);
      await tick();
      worker().reply({ id: worker().lastRequest().id, ok: true, envelope: envelopeWith() });
      await analyzed;

      const md = engine.extractMarkdown(bytes);
      await tick();
      expect(worker().postMessage).toHaveBeenCalledTimes(2);
      worker().reply({ id: worker().lastRequest().id, ok: true, envelope: envelopeWith() });
      await md;

      const txt = engine.extractText(bytes);
      await tick();
      expect(worker().postMessage).toHaveBeenCalledTimes(3);
      worker().reply({
        id: worker().lastRequest().id,
        ok: true,
        envelope: envelopeWith(),
        text: "t",
      });
      await txt;
    });

    it("never caches passworded requests", async () => {
      const engine = await load();
      const bytes = new Uint8Array([3]);

      for (const password of ["one", "two"]) {
        const pending = engine.extractMarkdown(bytes, { password });
        await tick();
        expect(worker().lastRequest().password).toBe(password);
        worker().reply({ id: worker().lastRequest().id, ok: true, envelope: envelopeWith() });
        await pending;
      }

      expect(worker().postMessage).toHaveBeenCalledTimes(2);
    });

    it("reports failures with the worker's reason", async () => {
      const engine = await load();
      const pending = engine.extractMarkdown(new Uint8Array([4])).catch((e) => e);
      await tick();
      worker().reply({
        id: worker().lastRequest().id,
        ok: false,
        failure: { reason: "password-required", message: "Password required" },
      });

      expect(await pending).toMatchObject({
        name: "PdfInspectorError",
        reason: "password-required",
      });
    });

    it("explains an empty reply", async () => {
      const engine = await load();
      const pending = engine.extractMarkdown(new Uint8Array([5])).catch((e) => e);
      await tick();
      worker().reply({ id: worker().lastRequest().id, ok: true });

      expect((await pending).message).toBe("extract-markdown returned no result.");
    });
  });

  describe("extractText", () => {
    it("asks for compact output by default and caches the text with the envelope", async () => {
      const engine = await load();
      const bytes = new Uint8Array([6]);

      const first = engine.extractText(bytes);
      await tick();
      const sent = worker().lastRequest();
      expect(sent).toMatchObject({ kind: "extract-text", profile: "compact" });
      worker().reply({ id: sent.id, ok: true, envelope: envelopeWith(), text: "Plain words" });
      expect(await first).toMatchObject({ text: "Plain words" });

      const again = await engine.extractText(bytes);
      expect(again.text).toBe("Plain words");
      expect(worker().postMessage).toHaveBeenCalledTimes(1);

      // A different profile is a different result.
      const fidelity = engine.extractText(bytes, { profile: "fidelity" });
      await tick();
      expect(worker().postMessage).toHaveBeenCalledTimes(2);
      worker().reply({ id: worker().lastRequest().id, ok: true, envelope: envelopeWith() });
      expect((await fidelity).text).toBe("");
    });

    it("never caches passworded requests", async () => {
      const engine = await load();
      const bytes = new Uint8Array([7]);

      for (const password of ["a", "b"]) {
        const pending = engine.extractText(bytes, { password });
        await tick();
        worker().reply({ id: worker().lastRequest().id, ok: true, envelope: envelopeWith() });
        expect((await pending).text).toBe("");
      }

      expect(worker().postMessage).toHaveBeenCalledTimes(2);
    });

    it("reports failures with the worker's reason", async () => {
      const engine = await load();
      const pending = engine.extractText(new Uint8Array([8])).catch((e) => e);
      await tick();
      worker().reply({
        id: worker().lastRequest().id,
        ok: false,
        failure: { reason: "resource-limit", message: "Out of memory" },
      });

      expect(await pending).toMatchObject({ reason: "resource-limit", message: "Out of memory" });
    });
  });

  describe("cache keys", () => {
    it("treats the same pages in any order as the same request", async () => {
      const engine = await load();
      const bytes = new Uint8Array([9]);

      const first = engine.analyze(bytes, { pages: [3, 1] });
      await tick();
      expect(worker().lastRequest().pages).toEqual([3, 1]);
      worker().reply({ id: worker().lastRequest().id, ok: true, envelope: envelopeWith() });
      await first;

      await engine.analyze(bytes, { pages: [1, 3] });
      expect(worker().postMessage).toHaveBeenCalledTimes(1);

      const allPages = engine.analyze(bytes);
      await tick();
      expect(worker().postMessage).toHaveBeenCalledTimes(2);
      worker().reply({ id: worker().lastRequest().id, ok: true, envelope: envelopeWith() });
      await allPages;
    });

    it("hashes a given byte array only once", async () => {
      const engine = await load();
      const bytes = new Uint8Array([10]);

      const a = engine.analyze(bytes);
      await tick();
      worker().reply({ id: worker().lastRequest().id, ok: true, envelope: envelopeWith() });
      await a;
      const b = engine.extractText(bytes);
      await tick();
      worker().reply({ id: worker().lastRequest().id, ok: true, envelope: envelopeWith() });
      await b;

      expect(digest).toHaveBeenCalledTimes(1);
    });

    it("forgets cached results when the session cache is cleared", async () => {
      const engine = await load();
      const bytes = new Uint8Array([11]);

      const first = engine.analyze(bytes);
      await tick();
      worker().reply({ id: worker().lastRequest().id, ok: true, envelope: envelopeWith() });
      await first;

      engine.clearSessionCache();
      const second = engine.analyze(bytes);
      await tick();
      expect(worker().postMessage).toHaveBeenCalledTimes(2);
      worker().reply({ id: worker().lastRequest().id, ok: true, envelope: envelopeWith() });
      await second;
    });
  });
});
