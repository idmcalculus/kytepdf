import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDist } from "../../scripts/assert-worker-artifacts";
import { runtimeAssetVersion } from "../../scripts/runtimeAssetVersion";

const WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const GZIP = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);

describe("checkDist", () => {
  let dist: string;

  const put = (path: string, content: string | Uint8Array) => {
    const full = join(dist, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };

  /** sw.js as a minified build emits it, with the fingerprint of the current files. */
  const writeServiceWorker = (fingerprint = runtimeAssetVersion(dist)) =>
    put("sw.js", `const u="${fingerprint}",c=\`kytepdf-static-v6-\${u}\`;`);

  /** A build that should pass every check. */
  const writeGoodBuild = () => {
    put("assets/main-abc123.js", "console.log('app')");
    put("assets/pdfInspectorWorker-def456.js", "self.onmessage = () => {}");
    put("assets/anydocWorker-ghi789.js", "self.onmessage = () => {}");
    put("wasm/pdf_inspector_wasm_bg.wasm", WASM);
    put("wasm/anydoc_wasm_bg.wasm", WASM);
    put("tesseract/worker.min.js", "/* tesseract */");
    put("tesseract/tesseract-core-simd-lstm.wasm", WASM);
    put("tesseract/tesseract-core-simd-lstm.js", "/* core */");
    put("tesseract/lang-data/eng.traineddata.gz", GZIP);
    writeServiceWorker();
  };

  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), "kyte-dist-"));
    writeGoodBuild();
  });

  afterEach(() => {
    rmSync(dist, { recursive: true, force: true });
  });

  it("accepts a complete build", () => {
    expect(checkDist(dist)).toEqual([]);
  });

  it("reports a missing dist folder", () => {
    expect(checkDist(join(dist, "nope"))).toEqual(["dist/ is missing; run vite build first"]);
  });

  it("requires a bundled chunk for each engine worker", () => {
    rmSync(join(dist, "assets/anydocWorker-ghi789.js"));
    expect(checkDist(dist)).toContain("dist/assets has no bundled anydocWorker-*.js chunk");
  });

  it("rejects worker chunks that still import WASM packages by bare name", () => {
    put("assets/pdfInspectorWorker-def456.js", 'import init from "@firecrawl/pdf-inspector-wasm";');
    expect(checkDist(dist)).toContain(
      "pdfInspectorWorker-def456.js still imports @firecrawl packages by bare name",
    );
  });

  it("rejects untranspiled TypeScript", () => {
    put("assets/main-abc123.js", 'import type { Foo } from "./types";\nconsole.log(1)');
    put("assets/anydocWorker.ts", "export {}");
    const problems = checkDist(dist);
    expect(problems).toContain('main-abc123.js still contains TypeScript "import type" syntax');
    expect(problems.some((p) => p.startsWith("raw TypeScript files in dist"))).toBe(true);
  });

  it("rejects empty or fake runtime files", () => {
    put("wasm/anydoc_wasm_bg.wasm", new Uint8Array());
    put(
      "tesseract/lang-data/eng.traineddata.gz",
      "version https://git-lfs.github.com/spec/v1\noid sha256:abc\n",
    );
    const problems = checkDist(dist);
    expect(problems).toContain("/wasm/anydoc_wasm_bg.wasm is empty");
    expect(problems).toContain(
      "/tesseract/lang-data/eng.traineddata.gz is not a gzip file (a Git LFS pointer or truncated copy?)",
    );
  });

  it("reports missing runtime files", () => {
    rmSync(join(dist, "tesseract/worker.min.js"));
    writeServiceWorker();
    expect(checkDist(dist)).toContain(
      "/tesseract/worker.min.js is missing; run `bun run sync:wasm` before building",
    );
  });

  it("rejects duplicate wasm left in dist/assets", () => {
    put("assets/pdf_inspector_wasm_bg-CTHLzKsX.wasm", WASM);
    expect(checkDist(dist)).toContain(
      "duplicate wasm in dist/assets: pdf_inspector_wasm_bg-CTHLzKsX.wasm",
    );
  });

  it("requires sw.js to carry the fingerprint of the runtime files actually shipped", () => {
    const fingerprint = runtimeAssetVersion(dist);
    expect(fingerprint).toMatch(/^[0-9a-f]{12}$/);

    // A build whose sw.js was made from other files (or the "dev" fallback).
    writeServiceWorker("dev");
    expect(checkDist(dist)).toContain(
      `dist/sw.js does not carry the runtime asset fingerprint "${fingerprint}"; returning visitors would keep stale engine files`,
    );

    // Changing a shipped binary changes the expected fingerprint.
    writeServiceWorker();
    expect(checkDist(dist)).toEqual([]);
    put("wasm/anydoc_wasm_bg.wasm", new Uint8Array([...WASM, 0x01]));
    expect(checkDist(dist).some((p) => p.startsWith("dist/sw.js does not carry"))).toBe(true);

    rmSync(join(dist, "sw.js"));
    expect(checkDist(dist)).toContain("dist/sw.js is missing");
  });
});
