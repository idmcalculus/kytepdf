/**
 * Set at build time from a hash of the unhashed runtime files (WASM engines,
 * OCR, the pdf.js worker), so sw.js changes whenever they do. Browsers then
 * install the new worker and its activate step deletes the old cache, instead
 * of serving last release's binary to this release's glue code. Tests and
 * other unbundled runs see "dev".
 */
declare const __KYTE_ASSET_VERSION__: string | undefined;
const ASSET_VERSION = typeof __KYTE_ASSET_VERSION__ === "string" ? __KYTE_ASSET_VERSION__ : "dev";

export const CACHE_NAME = `kytepdf-static-v6-${ASSET_VERSION}`;

/**
 * Lightweight shell assets only. Heavy WASM/OCR binaries (~21 MiB) are
 * lazy-cached on first use via shouldCacheAsset(), not installed eagerly.
 */
export const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/logo.svg",
  "/logo-icon.svg",
  "/pdf.worker.min.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

type CacheStorageLike = Pick<CacheStorage, "delete" | "keys" | "open">;

type ClientsLike = {
  claim: () => Promise<void>;
};

type ExtendableEventLike = {
  waitUntil: (promise: Promise<unknown>) => void;
};

type FetchEventLike = {
  request: Request;
  respondWith: (response: Promise<Response> | Response) => void;
};

type MessageEventLike = {
  data?: { type?: string };
};

type ServiceWorkerLike = {
  addEventListener: {
    (type: "activate" | "install", listener: (event: ExtendableEventLike) => void): void;
    (type: "fetch", listener: (event: FetchEventLike) => void): void;
    (type: "message", listener: (event: MessageEventLike) => void): void;
  };
  clients: ClientsLike;
  location: Pick<Location, "origin">;
  skipWaiting: () => Promise<void>;
};

type RuntimeOptions = {
  cacheName?: string;
  cacheStorage?: CacheStorageLike;
  fetcher?: typeof fetch;
  staticAssets?: string[];
};

export function isVersionedKyteCache(key: string, cacheName = CACHE_NAME) {
  return key.startsWith("kytepdf-static-") && key !== cacheName;
}

export function shouldCacheAsset(pathname: string, destination: RequestDestination) {
  // Lazy-cache WebAssembly modules and OCR language packs so document analysis
  // works offline after the first use. These are fetched with an empty
  // destination, so they are matched by extension here rather than by the
  // destination allowlist below.
  const lower = pathname.toLowerCase();
  if (
    lower.endsWith(".wasm") ||
    lower.endsWith(".traineddata") ||
    lower.endsWith(".traineddata.gz") ||
    lower.includes("/tesseract/")
  ) {
    return true;
  }
  // Engine scripts started with `new Worker()` arrive as "worker"; without
  // them the cached WASM is useless offline.
  return (
    STATIC_ASSETS.includes(pathname) ||
    ["script", "style", "image", "font", "worker", "sharedworker"].includes(destination)
  );
}

export function shouldHandleFetch(request: Request, origin: string) {
  if (request.method !== "GET") return false;
  return new URL(request.url).origin === origin;
}

export function isNavigationRequest(request: Request) {
  return request.mode === "navigate" || request.destination === "document";
}

export async function installStaticCache({
  cacheName = CACHE_NAME,
  cacheStorage = caches,
  serviceWorker,
  staticAssets = STATIC_ASSETS,
}: RuntimeOptions & { serviceWorker: Pick<ServiceWorkerLike, "skipWaiting"> }) {
  const cache = await cacheStorage.open(cacheName);
  // Best-effort: missing optional assets (e.g. icons) must not fail install.
  await Promise.all(
    staticAssets.map(async (asset) => {
      try {
        await cache.add(asset);
      } catch {
        /* ignore individual asset failures */
      }
    }),
  );
  await serviceWorker.skipWaiting();
}

export async function activateStaticCache({
  cacheName = CACHE_NAME,
  cacheStorage = caches,
  clients,
}: RuntimeOptions & { clients: ClientsLike }) {
  const keys = await cacheStorage.keys();
  const staleKyteCaches = keys.filter((key) => isVersionedKyteCache(key, cacheName));
  // Only remove older versioned Kyte caches — other same-origin caches
  // (e.g. unrelated to this service worker) must be left alone.
  await Promise.all(staleKyteCaches.map((key) => cacheStorage.delete(key)));
  // Open tabs are not reloaded from here: that would throw away unsaved work.
  // The page asks the user on "controllerchange" (see appBootstrap.ts).
  await clients.claim();
}

/** Caching is best effort: a failed write (e.g. storage quota) must never cost the page a good response. */
async function putQuietly(cache: Cache, key: RequestInfo, response: Response) {
  try {
    await cache.put(key, response);
  } catch {
    /* keep serving from the network */
  }
}

export async function resolveCachedResponse({
  cacheName = CACHE_NAME,
  cacheStorage = caches,
  fetcher = fetch,
  request,
}: RuntimeOptions & { request: Request }) {
  const cache = await cacheStorage.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetcher(request);
  const url = new URL(request.url);
  if (response?.ok && shouldCacheAsset(url.pathname, request.destination)) {
    // Await the write so the browser cannot terminate the worker before the
    // clone is persisted — an un-awaited cache.put() races the fetch event's
    // lifetime.
    await putQuietly(cache, request, response.clone());
  }
  return response;
}

/** Network-first navigation with offline shell fallback. */
export async function resolveNavigationResponse({
  cacheName = CACHE_NAME,
  cacheStorage = caches,
  fetcher = fetch,
  request,
}: RuntimeOptions & { request: Request }) {
  const cache = await cacheStorage.open(cacheName);
  let response: Response | undefined;
  try {
    response = await fetcher(request);
  } catch {
    /* offline or network error — fall through to cache */
  }

  if (response?.ok) {
    // Keep a fresh SPA shell for offline reloads, but only from an HTML page:
    // opening /manifest.json in a tab must not become the offline app. Await
    // the writes so the worker cannot be terminated before they're persisted.
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().includes("text/html")) {
      await Promise.all([
        putQuietly(cache, "/index.html", response.clone()),
        putQuietly(cache, "/", response.clone()),
      ]);
    }
    return response;
  }

  return (
    (await cache.match(request)) ||
    (await cache.match("/index.html")) ||
    (await cache.match("/")) ||
    new Response("Offline", { status: 503, statusText: "Service Unavailable" })
  );
}

export function installServiceWorker(
  serviceWorker: ServiceWorkerLike,
  {
    cacheName = CACHE_NAME,
    cacheStorage = caches,
    fetcher = fetch,
    staticAssets = STATIC_ASSETS,
  }: RuntimeOptions = {},
) {
  serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "SKIP_WAITING") {
      serviceWorker.skipWaiting();
    }
  });

  serviceWorker.addEventListener("install", (event) => {
    event.waitUntil(
      installStaticCache({
        cacheName,
        cacheStorage,
        serviceWorker,
        staticAssets,
      }),
    );
  });

  serviceWorker.addEventListener("activate", (event) => {
    event.waitUntil(
      activateStaticCache({
        cacheName,
        cacheStorage,
        clients: serviceWorker.clients,
      }),
    );
  });

  serviceWorker.addEventListener("fetch", (event) => {
    if (!shouldHandleFetch(event.request, serviceWorker.location.origin)) return;

    if (isNavigationRequest(event.request)) {
      event.respondWith(
        resolveNavigationResponse({
          cacheName,
          cacheStorage,
          fetcher,
          request: event.request,
        }),
      );
      return;
    }

    event.respondWith(
      resolveCachedResponse({
        cacheName,
        cacheStorage,
        fetcher,
        request: event.request,
      }),
    );
  });
}
