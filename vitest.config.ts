import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      all: true,
      provider: "istanbul",
      reporter: ["text", "json", "html", "lcov"],
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
        "cloud-gateway/**",
        "infra/**",
        "playwright.config.ts",
        "vitest.config.ts",
      ],
    },
    include: ["tests/unit/**/*.{test,spec}.{js,ts}", "tests/integration/**/*.{test,spec}.{js,ts}"],
  },
});
