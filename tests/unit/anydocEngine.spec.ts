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
    for (const cb of listeners.get("message") ?? []) cb({ data: response } as MessageEvent);
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
    postMessageSpy: postMessage,
  };
};

describe("AnydocEngine caching + worker plumbing", () => {
  let originalWorker: typeof Worker;
  let originalCrypto: Crypto;
  let fake: ReturnType<typeof createFakeWorker>;
  let cryptoDigestMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    originalWorker = globalThis.Worker;
    originalCrypto = globalThis.crypto;
    fake = createFakeWorker();
    (globalThis as any).Worker = fake.ctor;
    cryptoDigestMock = vi.fn(() => Promise.resolve(new ArrayBuffer(32)));
    Object.defineProperty(globalThis, "crypto", {
      value: { subtle: { digest: cryptoDigestMock } } as unknown as Crypto,
      configurable: true,
    });
  });

  afterEach(() => {
    (globalThis as any).Worker = originalWorker;
    Object.defineProperty(globalThis, "crypto", { value: originalCrypto, configurable: true });
  });

  it("posts bytes to the worker and returns the envelope", async () => {
    const { anydocEngine } = await import("../../utils/anydocEngine");
    const bytes = new Uint8Array([1, 2, 3]);

    const p = anydocEngine.convert(bytes, { format: "csv", sourceName: "table.csv" });
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.postMessageSpy).toHaveBeenCalledTimes(1);
    const sent = fake.postMessageSpy.mock.calls[0][0] as any;
    expect(sent.format).toBe("csv");
    expect(sent.sourceName).toBe("table.csv");
    expect(sent.bytes).toBeInstanceOf(Uint8Array);

    fake.dispatch({
      id: sent.id,
      ok: true,
      envelope: {
        format: "csv",
        sourceMime: "text/csv",
        markdown: "| a | b |\n| --- | --- |",
        warnings: [],
        engine: "anydoc-wasm",
        engineVersion: "0.1.8",
        processingTimeMs: 1,
        sourceName: "table.csv",
      },
    });
    const envelope = await p;
    expect(envelope.markdown).toContain("| a |");
    expect(envelope.format).toBe("csv");
  });

  it("serves cached results without re-posting for the same format", async () => {
    const { anydocEngine } = await import("../../utils/anydocEngine");
    const bytes = new Uint8Array([4, 5]);
    const first = anydocEngine.convert(bytes, { format: "csv" });
    await new Promise((r) => setTimeout(r, 0));
    const id = fake.postMessageSpy.mock.calls[0][0].id;
    fake.dispatch({
      id,
      ok: true,
      envelope: {
        format: "csv",
        sourceMime: "text/csv",
        markdown: "| x |\n| --- |",
        warnings: [],
        engine: "anydoc-wasm",
        engineVersion: "0.1.8",
        processingTimeMs: 1,
      },
    });
    await first;

    fake.postMessageSpy.mockClear();
    const second = await anydocEngine.convert(bytes, { format: "csv" });
    expect(second.markdown).toContain("| x |");
    expect(fake.postMessageSpy).not.toHaveBeenCalled();
  });

  it("rejects with a typed AnydocError on failure", async () => {
    const { anydocEngine, AnydocError } = await import("../../utils/anydocEngine");
    const p = anydocEngine.convert(new Uint8Array([6]));
    await new Promise((r) => setTimeout(r, 0));
    const id = fake.postMessageSpy.mock.calls[0][0].id;
    fake.dispatch({
      id,
      ok: false,
      failure: { reason: "encrypted", message: "password required" },
    });
    await expect(p).rejects.toMatchObject({
      name: "AnydocError",
      reason: "encrypted",
      message: "password required",
    });
    expect(AnydocError).toBeDefined();
  });

  it("rejects every pending request immediately when one request times out, instead of stranding the rest", async () => {
    vi.useFakeTimers();
    try {
      const { anydocEngine, AnydocError } = await import("../../utils/anydocEngine");
      const bytesA = new Uint8Array([1]);
      const bytesB = new Uint8Array([2]);

      const first = anydocEngine.convert(bytesA, { format: "docx" }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(0);

      // Start a second request 60s into the first request's 120s timeout
      // window, so their timers are offset rather than coincident.
      await vi.advanceTimersByTimeAsync(60_000);
      const second = anydocEngine.convert(bytesB, { format: "xlsx" }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.postMessageSpy).toHaveBeenCalledTimes(2);

      // Cross request A's 120s timeout. Request B's own timer would not
      // fire until virtual t=180s, so if it rejects here too, the fix is
      // working (the whole worker — and every pending request on it — is
      // torn down together instead of leaving B stranded).
      await vi.advanceTimersByTimeAsync(60_001);

      const [errA, errB] = await Promise.all([first, second]);
      expect(errA).toBeInstanceOf(AnydocError);
      expect(errB).toBeInstanceOf(AnydocError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports support based on file extension", async () => {
    const { anydocEngine } = await import("../../utils/anydocEngine");
    expect(anydocEngine.supports("report.docx")).toBe(true);
    expect(anydocEngine.supports("budget.xlsx")).toBe(true);
    expect(anydocEngine.supports("contract.pdf")).toBe(false);
    expect(anydocEngine.supports("notes.txt")).toBe(false);
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

const markdownEnvelope = (markdown = "# Doc") => ({
  format: "docx",
  sourceMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  markdown,
  warnings: [],
  engine: "anydoc-wasm",
  engineVersion: "0.1.8",
  processingTimeMs: 1,
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("AnydocEngine failures and cache keys", () => {
  let originalWorker: typeof Worker;
  let originalCrypto: Crypto;
  let factory: ReturnType<typeof createWorkerFactory>;

  beforeEach(() => {
    vi.resetModules();
    originalWorker = globalThis.Worker;
    originalCrypto = globalThis.crypto;
    factory = createWorkerFactory();
    (globalThis as any).Worker = factory.ctor;
    Object.defineProperty(globalThis, "crypto", {
      value: {
        subtle: {
          // Echo the input into the digest, so different content hashes differently.
          digest: vi.fn((_alg: string, data: ArrayBuffer) => {
            const out = new Uint8Array(32);
            out.set(new Uint8Array(data).subarray(0, 32));
            return Promise.resolve(out.buffer);
          }),
        },
      } as unknown as Crypto,
      configurable: true,
    });
  });

  afterEach(() => {
    (globalThis as any).Worker = originalWorker;
    Object.defineProperty(globalThis, "crypto", { value: originalCrypto, configurable: true });
  });

  const load = async () => (await import("../../utils/anydocEngine")).anydocEngine;
  const worker = (index = 0) => factory.instances[index];

  it("ignores stray worker messages and still delivers the real answer", async () => {
    const engine = await load();
    const pending = engine.convert(new Uint8Array([1]), { format: "docx" });
    await tick();
    const { id } = worker().lastRequest();

    worker().reply(undefined);
    worker().reply({ id: String(id), ok: true, envelope: markdownEnvelope("wrong") });
    worker().reply({ id: id + 50, ok: true, envelope: markdownEnvelope("wrong") });
    worker().reply({ id, ok: true, envelope: markdownEnvelope("right") });

    await expect(pending).resolves.toMatchObject({ markdown: "right" });
  });

  it("rejects in-flight conversions when the worker crashes, then starts a fresh one", async () => {
    const engine = await load();
    const a = engine.convert(new Uint8Array([1]), { format: "docx" }).catch((e) => e);
    const b = engine.convert(new Uint8Array([2]), { format: "xlsx" }).catch((e) => e);
    await tick();

    worker(0).crash();

    const [errA, errB] = await Promise.all([a, b]);
    expect(errA.message).toBe("The document analysis worker crashed.");
    expect(errB.message).toBe("The document analysis worker crashed.");
    expect(worker(0).terminate).toHaveBeenCalled();

    // A late second error from the dead worker must not break the next request.
    worker(0).crash();

    const next = engine.convert(new Uint8Array([3]), { format: "csv" });
    await tick();
    expect(factory.instances).toHaveLength(2);
    worker(1).reply({ id: worker(1).lastRequest().id, ok: true, envelope: markdownEnvelope() });
    await expect(next).resolves.toMatchObject({ markdown: "# Doc" });
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

    await expect(engine.convert(new Uint8Array([1]), { format: "docx" })).rejects.toThrow(
      "Worker blocked",
    );

    const retry = engine.convert(new Uint8Array([1]), { format: "docx" });
    await tick();
    expect(attempts).toBe(2);
    worker().reply({ id: worker().lastRequest().id, ok: true, envelope: markdownEnvelope() });
    await expect(retry).resolves.toMatchObject({ markdown: "# Doc" });
  });

  it("ignores an error from a worker that has already been replaced", async () => {
    const engine = await load();
    const first = engine.convert(new Uint8Array([1]), { format: "docx" }).catch((e) => e);
    await tick();
    worker(0).crash();
    await first;

    const next = engine.convert(new Uint8Array([2]), { format: "docx" });
    await tick();
    expect(factory.instances).toHaveLength(2);

    // The old worker reports again; the new one and its request must survive.
    worker(0).crash();
    expect(worker(1).terminate).not.toHaveBeenCalled();
    worker(1).reply({ id: worker(1).lastRequest().id, ok: true, envelope: markdownEnvelope() });
    await expect(next).resolves.toMatchObject({ markdown: "# Doc" });
  });

  it("passes on the browser's error when the worker cannot be created", async () => {
    (globalThis as any).Worker = class {
      constructor() {
        throw new Error("Refused to create a worker: CSP worker-src");
      }
    };
    const engine = await load();

    await expect(engine.convert(new Uint8Array([1]))).rejects.toThrow(
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

    await expect(engine.convert(new Uint8Array([1]))).rejects.toThrow(
      "Failed to start the document analysis worker.",
    );
  });

  it("treats a success reply without an envelope as a failure, and does not cache it", async () => {
    const { anydocEngine, AnydocError } = await import("../../utils/anydocEngine");
    const bytes = new Uint8Array([4]);

    const first = anydocEngine.convert(bytes, { format: "docx" }).catch((e) => e);
    await tick();
    worker().reply({ id: worker().lastRequest().id, ok: true });
    const err = await first;
    expect(err).toBeInstanceOf(AnydocError);
    expect(err).toMatchObject({ reason: "unknown", message: "Conversion returned no result." });

    const retry = anydocEngine.convert(bytes, { format: "docx" });
    await tick();
    expect(worker().postMessage).toHaveBeenCalledTimes(2);
    worker().reply({ id: worker().lastRequest().id, ok: true, envelope: markdownEnvelope() });
    await expect(retry).resolves.toMatchObject({ markdown: "# Doc" });
  });

  it("keys the cache on format and file name as well as content", async () => {
    const engine = await load();
    const bytes = new Uint8Array([5]);
    /** Converts, answering for the worker only when the request reached it. */
    const convert = async (options: Parameters<typeof engine.convert>[1], data = bytes) => {
      const before = worker()?.postMessage.mock.calls.length ?? 0;
      const pending = engine.convert(data, options);
      await tick();
      if (worker().postMessage.mock.calls.length > before) {
        worker().reply({ id: worker().lastRequest().id, ok: true, envelope: markdownEnvelope() });
      }
      return pending;
    };

    await convert({ format: "docx", sourceName: "a.docx" });
    await convert({ format: "docx", sourceName: "a.docx" });
    expect(worker().postMessage).toHaveBeenCalledTimes(1);

    await convert({ format: "odt", sourceName: "a.docx" });
    expect(worker().postMessage).toHaveBeenCalledTimes(2);

    await convert({ format: "docx", sourceName: "b.docx" });
    expect(worker().postMessage).toHaveBeenCalledTimes(3);

    await convert({});
    expect(worker().postMessage).toHaveBeenCalledTimes(4);

    // Different content with the same format and name is a different result.
    await convert({ format: "docx", sourceName: "a.docx" }, new Uint8Array([7]));
    expect(worker().postMessage).toHaveBeenCalledTimes(5);
  });

  it("replaces the worker after a reply that says its WASM instance trapped", async () => {
    const { anydocEngine, AnydocError } = await import("../../utils/anydocEngine");
    const trapped = anydocEngine.convert(new Uint8Array([1]), { format: "docx" }).catch((e) => e);
    const other = anydocEngine.convert(new Uint8Array([2]), { format: "docx" }).catch((e) => e);
    await tick();
    const [first] = worker(0).postMessage.mock.calls.map(([request]) => request);

    worker(0).reply({
      id: first.id,
      ok: false,
      fatal: true,
      failure: {
        reason: "resourceLimit",
        message: "The document is too large to process in this browser.",
      },
    });

    const err = await trapped;
    expect(err).toBeInstanceOf(AnydocError);
    expect(err.reason).toBe("resourceLimit");
    expect(worker(0).terminate).toHaveBeenCalled();
    // A request still waiting on the broken instance fails rather than hangs.
    expect((await other).message).toBe("The document converter stopped and was restarted.");

    const next = anydocEngine.convert(new Uint8Array([3]), { format: "docx" });
    await tick();
    expect(factory.instances).toHaveLength(2);
    worker(1).reply({ id: worker(1).lastRequest().id, ok: true, envelope: markdownEnvelope() });
    await expect(next).resolves.toMatchObject({ markdown: "# Doc" });
  });

  it("forgets cached results when the session cache is cleared", async () => {
    const engine = await load();
    const bytes = new Uint8Array([6]);

    const first = engine.convert(bytes, { format: "csv" });
    await tick();
    worker().reply({ id: worker().lastRequest().id, ok: true, envelope: markdownEnvelope() });
    await first;

    engine.clearSessionCache();
    const second = engine.convert(bytes, { format: "csv" });
    await tick();
    expect(worker().postMessage).toHaveBeenCalledTimes(2);
    worker().reply({ id: worker().lastRequest().id, ok: true, envelope: markdownEnvelope() });
    await second;
  });
});
