import { describe, expect, it, vi } from "vitest";
import {
  activateStaticCache,
  CACHE_NAME,
  installServiceWorker,
  installStaticCache,
  isNavigationRequest,
  isVersionedKyteCache,
  resolveCachedResponse,
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

  it("pre-caches static assets and asks the worker to skip waiting", async () => {
    const { cache, storage } = createCacheStorage();
    const serviceWorker = { skipWaiting: vi.fn().mockResolvedValue(undefined) };

    await installStaticCache({ cacheStorage: storage as any, serviceWorker });

    expect(storage.open).toHaveBeenCalledWith(CACHE_NAME);
    expect(cache.addAll).toHaveBeenCalledWith(STATIC_ASSETS);
    expect(serviceWorker.skipWaiting).toHaveBeenCalled();
  });

  it("deletes old caches and navigates clients when replacing an older Kyte cache", async () => {
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
    expect(storage.delete).toHaveBeenCalledWith("unrelated");
    expect(storage.delete).not.toHaveBeenCalledWith(CACHE_NAME);
    expect(clients.claim).toHaveBeenCalled();
    expect(clients.matchAll).toHaveBeenCalledWith({ includeUncontrolled: true, type: "window" });
    expect(windowClient.navigate).toHaveBeenCalledWith("https://app.test/current");
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

    expect(storage.delete).toHaveBeenCalledWith("third-party");
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
    expect(cache.addAll).toHaveBeenCalled();

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
});
