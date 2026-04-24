import { installServiceWorker } from "./utils/serviceWorkerRuntime.ts";

installServiceWorker(self as unknown as ServiceWorkerGlobalScope);
