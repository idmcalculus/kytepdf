import { describe, expect, it, vi } from "vitest";
import {
  activateStaticCache,
  CACHE_NAME,
  installServiceWorker,
  installStaticCache,
  isNavigationRequest,
  isVersionedKyteCache,
  resolveCachedResponse,
  resolveNavigationResponse,
  STATIC_ASSETS,
  shouldCacheAsset,
  shouldHandleFetch,
} from "../../utils/serviceWorkerRuntime";

const request = (
  url: string,
  overrides: Partial<Pick<Request, "destination" | "method" | "mode">> = {},
) =>
  ({
    destination: "",
    method: "GET",
    mode: "cors",
    url,
    ...overrides,
  }) as Request;

const createCacheStorage = () => {
  const cache = {
    add: vi.fn().mockResolvedValue(undefined),
    addAll: vi.fn().mockResolvedValue(undefined),
    match: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
  };
  return {
    cache,
    storage: {
      delete: vi.fn().mockResolvedValue(true),
      keys: vi.fn().mockResolvedValue([CACHE_NAME]),
      open: vi.fn().mockResolvedValue(cache),
    },
  };
};

describe("serviceWorkerRuntime", () => {
  it("classifies static caches and cacheable assets", () => {
    expect(isVersionedKyteCache("kytepdf-static-v1")).toBe(true);
    expect(isVersionedKyteCache(CACHE_NAME)).toBe(false);
    expect(isVersionedKyteCache("other-cache")).toBe(false);

    expect(shouldCacheAsset("/manifest.json", "")).toBe(true);
    expect(shouldCacheAsset("/app.js", "script")).toBe(true);
    expect(shouldCacheAsset("/document", "document")).toBe(false);
  });

  it("caches WebAssembly modules for offline document analysis", () => {
    expect(shouldCacheAsset("/assets/pdf_inspector_wasm_bg-abc123.wasm", "")).toBe(true);
    expect(shouldCacheAsset("/assets/anydoc_wasm_bg-xyz789.wasm", "")).toBe(true);
    expect(shouldCacheAsset("/assets/pdf_inspector_wasm_bg.WASM", "")).toBe(true);
    expect(shouldCacheAsset("/tesseract/lang-data/eng.traineddata.gz", "")).toBe(true);
    expect(shouldCacheAsset("/api/upload", "fetch")).toBe(false);
  });

  it("caches the engine worker scripts so the engines work offline", () => {
    expect(shouldCacheAsset("/assets/pdfInspectorWorker-abc123.js", "worker")).toBe(true);
    expect(shouldCacheAsset("/assets/anydocWorker-def456.js", "worker")).toBe(true);
    expect(shouldCacheAsset("/assets/shared-ghi789.js", "sharedworker")).toBe(true);
  });

  it("names the cache after the runtime files, falling back to dev outside a build", () => {
    // The build defines __KYTE_ASSET_VERSION__ from a hash of /wasm, /tesseract
    // and the pdf.js worker; unbundled test runs get "dev".
    expect(CACHE_NAME).toBe("kytepdf-static-v6-dev");
    expect(isVersionedKyteCache("kytepdf-static-v5")).toBe(true);
    expect(isVersionedKyteCache("kytepdf-static-v6-0123456789ab")).toBe(true);
  });

  it("only handles same-origin GET fetches", () => {
    expect(shouldHandleFetch(request("https://app.test/main.js"), "https://app.test")).toBe(true);
    expect(
      shouldHandleFetch(
        request("https://app.test/main.js", { method: "POST" }),
        "https://app.test",
      ),
    ).toBe(false);
    expect(shouldHandleFetch(request("https://cdn.test/main.js"), "https://app.test")).toBe(false);
  });

  it("detects navigation requests", () => {
    expect(isNavigationRequest(request("https://app.test/", { mode: "navigate" }))).toBe(true);
    expect(isNavigationRequest(request("https://app.test/", { destination: "document" }))).toBe(
      true,
    );
    expect(
      isNavigationRequest(request("https://app.test/main.js", { destination: "script" })),
    ).toBe(false);
  });

  it("pre-caches lightweight shell assets and asks the worker to skip waiting", async () => {
    const { cache, storage } = createCacheStorage();
    const serviceWorker = { skipWaiting: vi.fn().mockResolvedValue(undefined) };

    await installStaticCache({ cacheStorage: storage as any, serviceWorker });

    expect(storage.open).toHaveBeenCalledWith(CACHE_NAME);
    expect(cache.add).toHaveBeenCalled();
    expect(cache.add.mock.calls.length).toBe(STATIC_ASSETS.length);
    // Heavy WASM/OCR binaries must not be eagerly installed.
    const added = cache.add.mock.calls.map((c: string[]) => c[0]);
    expect(added.some((a: string) => String(a).includes("wasm"))).toBe(false);
    expect(added.some((a: string) => String(a).includes("tesseract"))).toBe(false);
    expect(serviceWorker.skipWaiting).toHaveBeenCalled();
  });

  it("deletes old Kyte caches without reloading open tabs", async () => {
    const storage = {
      delete: vi.fn().mockResolvedValue(true),
      keys: vi.fn().mockResolvedValue(["kytepdf-static-v1", CACHE_NAME, "unrelated"]),
      open: vi.fn(),
    };
    const windowClient = {
      navigate: vi.fn().mockResolvedValue(undefined),
      url: "https://app.test/current",
    };
    const clients = {
      claim: vi.fn().mockResolvedValue(undefined),
      matchAll: vi.fn().mockResolvedValue([windowClient, { url: "https://app.test/plain" }]),
    };

    await activateStaticCache({ cacheStorage: storage as any, clients: clients as any });

    expect(storage.delete).toHaveBeenCalledWith("kytepdf-static-v1");
    // Only older *versioned Kyte* caches are cleaned up — unrelated
    // same-origin caches must be left untouched.
    expect(storage.delete).not.toHaveBeenCalledWith("unrelated");
    expect(storage.delete).not.toHaveBeenCalledWith(CACHE_NAME);
    expect(clients.claim).toHaveBeenCalled();
    // Reloading here would throw away unsaved work in other tabs; the page
    // asks the user instead when the new worker takes control.
    expect(windowClient.navigate).not.toHaveBeenCalled();
    expect(clients.matchAll).not.toHaveBeenCalled();
  });

  it("claims clients without navigation when no old Kyte cache exists", async () => {
    const storage = {
      delete: vi.fn().mockResolvedValue(true),
      keys: vi.fn().mockResolvedValue([CACHE_NAME, "third-party"]),
      open: vi.fn(),
    };
    const clients = {
      claim: vi.fn().mockResolvedValue(undefined),
      matchAll: vi.fn(),
    };

    await activateStaticCache({ cacheStorage: storage as any, clients: clients as any });

    // A non-Kyte cache must never be deleted by this worker's activation.
    expect(storage.delete).not.toHaveBeenCalledWith("third-party");
    expect(storage.delete).not.toHaveBeenCalled();
    expect(clients.claim).toHaveBeenCalled();
    expect(clients.matchAll).not.toHaveBeenCalled();
  });

  it("returns cached responses before fetching", async () => {
    const cachedResponse = new Response("cached");
    const { cache, storage } = createCacheStorage();
    cache.match.mockResolvedValue(cachedResponse);
    const fetcher = vi.fn();

    const response = await resolveCachedResponse({
      cacheStorage: storage as any,
      fetcher,
      request: request("https://app.test/logo.svg", { destination: "image" }),
    });

    expect(response).toBe(cachedResponse);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fetches and stores cacheable responses", async () => {
    const { cache, storage } = createCacheStorage();
    const response = new Response("fresh", { status: 200 });
    const fetcher = vi.fn().mockResolvedValue(response);
    const cacheableRequest = request("https://app.test/main.js", { destination: "script" });

    const resolved = await resolveCachedResponse({
      cacheStorage: storage as any,
      fetcher,
      request: cacheableRequest,
    });

    expect(resolved).toBe(response);
    expect(cache.put).toHaveBeenCalledWith(cacheableRequest, expect.any(Response));
  });

  it("awaits the cache.put write before resolving (worker cannot be terminated mid-write)", async () => {
    const { cache, storage } = createCacheStorage();
    let putResolve: (() => void) | undefined;
    cache.put.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          putResolve = resolve;
        }),
    );
    const response = new Response("fresh", { status: 200 });
    const fetcher = vi.fn().mockResolvedValue(response);
    const cacheableRequest = request("https://app.test/main.js", { destination: "script" });

    let settled = false;
    const pending = resolveCachedResponse({
      cacheStorage: storage as any,
      fetcher,
      request: cacheableRequest,
    }).then((r) => {
      settled = true;
      return r;
    });

    // The runtime awaits open, match and fetch first, so wait for the write to
    // start rather than counting microtask turns.
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalled());
    await Promise.resolve();
    expect(settled).toBe(false); // still waiting on the un-resolved cache.put()

    putResolve?.();
    await pending;
    expect(settled).toBe(true);
  });

  it("does not store failed or non-cacheable responses", async () => {
    const { cache, storage } = createCacheStorage();
    const fetcher = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));

    await resolveCachedResponse({
      cacheStorage: storage as any,
      fetcher,
      request: request("https://app.test/api/data"),
    });

    expect(cache.put).not.toHaveBeenCalled();
  });

  it("wires service worker events", async () => {
    const listeners = new Map<string, any>();
    const { cache, storage } = createCacheStorage();
    storage.keys.mockResolvedValue(["kytepdf-static-v1", CACHE_NAME]);
    const serviceWorker = {
      addEventListener: vi.fn((event: string, cb: any) => listeners.set(event, cb)),
      clients: {
        claim: vi.fn().mockResolvedValue(undefined),
        matchAll: vi.fn().mockResolvedValue([]),
      },
      location: { origin: "https://app.test" },
      skipWaiting: vi.fn().mockResolvedValue(undefined),
    };
    const fetcher = vi.fn().mockResolvedValue(new Response("network"));

    installServiceWorker(serviceWorker as any, {
      cacheStorage: storage as any,
      fetcher,
    });

    listeners.get("message")({ data: { type: "SKIP_WAITING" } });
    expect(serviceWorker.skipWaiting).toHaveBeenCalledTimes(1);

    const installPromise = Promise.resolve();
    const installEvent = { waitUntil: vi.fn((promise: Promise<void>) => promise) };
    listeners.get("install")(installEvent);
    await installPromise;
    expect(installEvent.waitUntil).toHaveBeenCalled();
    expect(cache.add).toHaveBeenCalled();

    const activateEvent = { waitUntil: vi.fn((promise: Promise<void>) => promise) };
    listeners.get("activate")(activateEvent);
    await activateEvent.waitUntil.mock.results[0].value;
    expect(serviceWorker.clients.claim).toHaveBeenCalled();

    const postEvent = {
      request: request("https://app.test/form", { method: "POST" }),
      respondWith: vi.fn(),
    };
    listeners.get("fetch")(postEvent);
    expect(postEvent.respondWith).not.toHaveBeenCalled();

    const navigateEvent = {
      request: request("https://app.test/", { mode: "navigate" }),
      respondWith: vi.fn(),
    };
    listeners.get("fetch")(navigateEvent);
    expect(navigateEvent.respondWith).toHaveBeenCalledWith(expect.any(Promise));

    const assetEvent = {
      request: request("https://app.test/main.css", { destination: "style" }),
      respondWith: vi.fn(),
    };
    listeners.get("fetch")(assetEvent);
    expect(assetEvent.respondWith).toHaveBeenCalledWith(expect.any(Promise));
  });

  it("falls back to the cached shell when navigation is offline", async () => {
    const shell = new Response("<html>shell</html>", { status: 200 });
    const { cache, storage } = createCacheStorage();
    cache.match.mockImplementation(async (key: string | Request) => {
      const url = typeof key === "string" ? key : (key as Request).url;
      if (String(url).includes("index.html") || String(url).endsWith("/")) return shell;
      return undefined;
    });
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));

    const response = await resolveNavigationResponse({
      cacheStorage: storage as any,
      fetcher,
      request: request("https://app.test/", { mode: "navigate" }),
    });

    expect(response).toBe(shell);
  });

  it("returns the network response even when caching it fails", async () => {
    const { cache, storage } = createCacheStorage();
    cache.put.mockRejectedValue(new DOMException("Quota exceeded", "QuotaExceededError"));
    const response = new Response("wasm bytes", { status: 200 });
    const fetcher = vi.fn().mockResolvedValue(response);

    const resolved = await resolveCachedResponse({
      cacheStorage: storage as any,
      fetcher,
      request: request("https://app.test/wasm/anydoc_wasm_bg.wasm"),
    });

    expect(resolved).toBe(response);
    expect(cache.put).toHaveBeenCalled();
  });

  describe("navigation", () => {
    const html = (body: string) =>
      new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

    it("keeps a fresh copy of the app shell from an HTML page", async () => {
      const { cache, storage } = createCacheStorage();
      const page = html("<html>new shell</html>");

      const response = await resolveNavigationResponse({
        cacheStorage: storage as any,
        fetcher: vi.fn().mockResolvedValue(page),
        request: request("https://app.test/", { mode: "navigate" }),
      });

      expect(response).toBe(page);
      expect(cache.put).toHaveBeenCalledWith("/index.html", expect.any(Response));
      expect(cache.put).toHaveBeenCalledWith("/", expect.any(Response));
    });

    it("does not store a non-HTML page as the app shell", async () => {
      const { cache, storage } = createCacheStorage();
      const manifest = new Response('{"name":"KytePDF"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });

      const response = await resolveNavigationResponse({
        cacheStorage: storage as any,
        fetcher: vi.fn().mockResolvedValue(manifest),
        request: request("https://app.test/manifest.json", { mode: "navigate" }),
      });

      expect(response).toBe(manifest);
      expect(cache.put).not.toHaveBeenCalled();
    });

    it("serves the fresh page, not 'Offline', when saving the shell fails", async () => {
      const { cache, storage } = createCacheStorage();
      cache.put.mockRejectedValue(new DOMException("Quota exceeded", "QuotaExceededError"));
      const page = html("<html>new shell</html>");

      const response = await resolveNavigationResponse({
        cacheStorage: storage as any,
        fetcher: vi.fn().mockResolvedValue(page),
        request: request("https://app.test/", { mode: "navigate" }),
      });

      expect(response).toBe(page);
      expect(response.status).toBe(200);
    });

    it("answers 'Offline' only when there is no network and no cached shell", async () => {
      const { storage } = createCacheStorage();

      const response = await resolveNavigationResponse({
        cacheStorage: storage as any,
        fetcher: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
        request: request("https://app.test/", { mode: "navigate" }),
      });

      expect(response.status).toBe(503);
      expect(await response.text()).toBe("Offline");
    });
  });
});
