import { defineConfig, devices } from "@playwright/test";
import { PREVIEW_PORT, PREVIEW_URL } from "./tests/e2e/fixtures/productionPreview.ts";

const e2ePort = Number(process.env.E2E_PORT ?? 5174);
const baseURL = `http://127.0.0.1:${e2ePort}`;

const previewCommand = `bun run preview -- --host 127.0.0.1 --port ${PREVIEW_PORT} --strictPort`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "ci-chrome",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: [
    {
      command: `bun run dev -- --host 127.0.0.1 --port ${e2ePort} --strictPort`,
      url: baseURL,
      reuseExistingServer: false,
    },
    {
      // The built app, served with the Content-Security-Policy from
      // netlify.toml (vite.config.ts `preview.headers`), for
      // production_csp.spec.ts. CI has already run `bun run build`; locally,
      // build first so the tests never run against a stale dist/.
      command: process.env.CI ? previewCommand : `bun run build && ${previewCommand}`,
      url: PREVIEW_URL,
      reuseExistingServer: false,
      timeout: process.env.CI ? 60_000 : 300_000,
      // A local .env.local may point the auth API at localhost, which the
      // production connect-src rightly blocks. Build without it, as CI does,
      // so the auth check is skipped instead of reported as a violation.
      env: process.env.CI ? {} : { VITE_AUTH_API_URL: "" },
    },
  ],
});
