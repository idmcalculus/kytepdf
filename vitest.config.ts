import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text", "json", "json-summary", "html", "lcov"],
      include: ["components/**/*.ts", "utils/**/*.ts", "main.ts", "sw.ts"],
      thresholds: {
        statements: 95,
        branches: 77,
        functions: 95,
        lines: 95,
      },
      exclude: [
        "node_modules/**",
        "dist/**",
        "**/*.d.ts",
        "tests/**",
        "tests/e2e/**",
        "playwright.config.ts",
        "vitest.config.ts",
      ],
    },
    include: ["tests/**/*.{test,spec}.{js,ts}"],
    // A leading "!" inside `include` is not a supported negation in Vitest's
    // glob matching — it was silently matching nothing, so Playwright e2e
    // specs (which import `@playwright/test`, not `vitest`) were being swept
    // into the Vitest run. That mismatch broke the coverage collection/merge
    // step for the whole run, producing an empty coverage-final.json and
    // lcov.info even though the exit code stayed 0. Use the real `exclude`
    // option instead.
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
});
