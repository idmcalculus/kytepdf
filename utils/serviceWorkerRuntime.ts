export const CACHE_NAME = "kytepdf-static-v2";

export const STATIC_ASSETS = [
  "/manifest.json",
  "/logo.svg",
  "/logo-icon.svg",
  "/pdf.worker.min.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

type CacheStorageLike = Pick<CacheStorage, "delete" | "keys" | "open">;
type WindowClientLike = {
  navigate?: (url: string) => Promise<unknown>;
  url: string;
};

type ClientsLike = {
  claim: () => Promise<void>;
  matchAll: (options: {
    includeUncontrolled: boolean;
    type: "window";
  }) => Promise<WindowClientLike[]>;
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
  return (
    STATIC_ASSETS.includes(pathname) || ["script", "style", "image", "font"].includes(destination)
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
  await cache.addAll(staticAssets);
  await serviceWorker.skipWaiting();
}

export async function activateStaticCache({
  cacheName = CACHE_NAME,
  cacheStorage = caches,
  clients,
}: RuntimeOptions & { clients: ClientsLike }) {
  const keys = await cacheStorage.keys();
  const hasKyteCacheToReplace = keys.some((key) => isVersionedKyteCache(key, cacheName));
  await Promise.all(keys.filter((key) => key !== cacheName).map((key) => cacheStorage.delete(key)));
  await clients.claim();

  if (!hasKyteCacheToReplace) return;

  const browserClients = await clients.matchAll({ includeUncontrolled: true, type: "window" });
  await Promise.all(
    browserClients.map((client) =>
      typeof client.navigate === "function" ? client.navigate(client.url) : undefined,
    ),
  );
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
    cache.put(request, response.clone());
  }
  return response;
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
      event.respondWith(fetcher(event.request));
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
