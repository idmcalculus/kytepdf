import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * CSP regressions are invisible in `vite dev` (no headers applied) and only
 * surface as blocked assets in production, so assert the deployed policy here.
 */
describe("netlify Content-Security-Policy", () => {
  let csp: string;
  let directives: Map<string, string[]>;

  beforeAll(() => {
    const toml = readFileSync(join(process.cwd(), "netlify.toml"), "utf8");
    const match = toml.match(/Content-Security-Policy\s*=\s*"([^"]+)"/);
    if (!match) throw new Error("No Content-Security-Policy found in netlify.toml");
    csp = match[1];
    directives = new Map(
      csp
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const [name, ...values] = part.split(/\s+/);
          return [name, values] as [string, string[]];
        }),
    );
  });

  it("allows the self-hosted font the build emits", () => {
    // @fontsource/great-vibes is bundled into dist/assets/*.woff. A
    // gstatic-only font-src silently blocks it in production.
    expect(directives.get("font-src")).toContain("'self'");
  });

  it("still allows the Google Fonts stylesheet and files", () => {
    expect(directives.get("style-src")).toContain("https://fonts.googleapis.com");
    expect(directives.get("font-src")).toContain("https://fonts.gstatic.com");
  });

  it("permits WebAssembly compilation for the local document engines", () => {
    // pdf-inspector, anydoc and tesseract all instantiate WASM.
    expect(directives.get("script-src")).toContain("'wasm-unsafe-eval'");
  });

  it("keeps script-src free of unsafe-inline and unsafe-eval", () => {
    const scriptSrc = directives.get("script-src") ?? [];
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("restricts connect-src to same-origin plus the auth API", () => {
    const connectSrc = directives.get("connect-src") ?? [];
    expect(connectSrc).toContain("'self'");
    expect(connectSrc).toContain("https://*.kytepdf.com");
    // Document bytes must never leave the origin: no wildcard egress.
    expect(connectSrc).not.toContain("*");
    expect(connectSrc).not.toContain("https:");
  });

  it("allows same-origin workers for the engine web workers", () => {
    expect(directives.get("worker-src")).toContain("'self'");
  });

  it("applies baseline hardening directives", () => {
    expect(directives.get("default-src")).toContain("'self'");
    expect(directives.get("object-src")).toContain("'none'");
    expect(directives.get("base-uri")).toContain("'self'");
    expect(directives.get("frame-ancestors")).toContain("'none'");
  });
});
