/**
 * Where Playwright serves the built app under the production
 * Content-Security-Policy (`vite preview`; see playwright.config.ts and the
 * `preview.headers` block in vite.config.ts). Shared by the config and
 * production_csp.spec.ts so both agree on the port.
 *
 * E2E_PREVIEW_PORT lets two e2e runs on one machine use different ports.
 */
export const PREVIEW_PORT = Number(process.env.E2E_PREVIEW_PORT ?? 4175);
export const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;
