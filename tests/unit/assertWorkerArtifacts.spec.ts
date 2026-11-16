import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDist, installedPdfjsVersion } from "../../scripts/assert-worker-artifacts";
import { runtimeAssetVersion } from "../../scripts/runtimeAssetVersion";

const WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const GZIP = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);
const PDFJS = "6.5.438";

/** core-js's shared-state key, which only pdf.js's legacy (polyfilled) build contains. */
const LEGACY = 'var r="__core-js_shared__";';
/** The pdf.js display API as Rolldown emits it: the version becomes a template literal. */
const PDFJS_API = "let ce={docId:n,apiVersion:`6.5.438`,data:i};";
/** pdf.js's image decoders, fetched from its wasmUrl (/wasm/pdfjs/). */
const PDFJS_WASM = ["jbig2.wasm", "openjpeg.wasm", "qcms_bg.wasm"];
const PDFJS_WASM_FALLBACKS = ["jbig2_nowasm_fallback.js", "openjpeg_nowasm_fallback.js"];

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
    put("assets/vendor-pdfjs-jkl012.js", `${LEGACY}${PDFJS_API}`);
    put("assets/pdfInspectorWorker-def456.js", "self.onmessage = () => {}");
    put("assets/anydocWorker-ghi789.js", "self.onmessage = () => {}");
    put("wasm/pdf_inspector_wasm_bg.wasm", WASM);
    put("wasm/anydoc_wasm_bg.wasm", WASM);
    put("tesseract/worker.min.js", "/* tesseract */");
    put("tesseract/tesseract-core-simd-lstm.wasm", WASM);
    put("tesseract/tesseract-core-simd-lstm.js", "/* core */");
    put("tesseract/lang-data/eng.traineddata.gz", GZIP);
    for (const file of PDFJS_WASM) put(`wasm/pdfjs/${file}`, WASM);
    for (const file of PDFJS_WASM_FALLBACKS) put(`wasm/pdfjs/${file}`, "export default () => {}");
    put("pdf.worker.min.js", `const pdfjsVersion = "6.5.438";${LEGACY}`);
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
    expect(checkDist(dist, PDFJS)).toEqual([]);
  });

  it("reports a missing dist folder", () => {
    expect(checkDist(join(dist, "nope"), PDFJS)).toEqual([
      "dist/ is missing; run vite build first",
    ]);
  });

  it("requires a bundled chunk for each engine worker", () => {
    rmSync(join(dist, "assets/anydocWorker-ghi789.js"));
    expect(checkDist(dist, PDFJS)).toContain("dist/assets has no bundled anydocWorker-*.js chunk");
  });

  it("rejects worker chunks that still import WASM packages by bare name", () => {
    put("assets/pdfInspectorWorker-def456.js", 'import init from "@firecrawl/pdf-inspector-wasm";');
    expect(checkDist(dist, PDFJS)).toContain(
      "pdfInspectorWorker-def456.js still imports @firecrawl packages by bare name",
    );
  });

  it("rejects untranspiled TypeScript", () => {
    put("assets/main-abc123.js", 'import type { Foo } from "./types";\nconsole.log(1)');
    put("assets/anydocWorker.ts", "export {}");
    const problems = checkDist(dist, PDFJS);
    expect(problems).toContain('main-abc123.js still contains TypeScript "import type" syntax');
    expect(problems.some((p) => p.startsWith("raw TypeScript files in dist"))).toBe(true);
  });

  it("rejects empty or fake runtime files", () => {
    put("wasm/anydoc_wasm_bg.wasm", new Uint8Array());
    put(
      "tesseract/lang-data/eng.traineddata.gz",
      "version https://git-lfs.github.com/spec/v1\noid sha256:abc\n",
    );
    const problems = checkDist(dist, PDFJS);
    expect(problems).toContain("/wasm/anydoc_wasm_bg.wasm is empty");
    expect(problems).toContain(
      "/tesseract/lang-data/eng.traineddata.gz is not a gzip file (a Git LFS pointer or truncated copy?)",
    );
  });

  it("reports missing runtime files", () => {
    rmSync(join(dist, "tesseract/worker.min.js"));
    writeServiceWorker();
    expect(checkDist(dist, PDFJS)).toContain(
      "/tesseract/worker.min.js is missing; run `bun run sync:wasm` before building",
    );
  });

  it("requires pdf.js's image decoders, or JBIG2, CCITT fax and JPEG 2000 images render blank", () => {
    for (const file of [...PDFJS_WASM, ...PDFJS_WASM_FALLBACKS]) {
      rmSync(join(dist, "wasm/pdfjs", file));
    }
    writeServiceWorker();
    const problems = checkDist(dist, PDFJS);
    for (const file of [...PDFJS_WASM, ...PDFJS_WASM_FALLBACKS]) {
      expect(problems).toContain(
        `/wasm/pdfjs/${file} is missing; run \`bun run sync:wasm\` before building`,
      );
    }

    writeGoodBuild();
    put("wasm/pdfjs/openjpeg.wasm", "version https://git-lfs.github.com/spec/v1\n");
    expect(checkDist(dist, PDFJS)).toContain(
      "/wasm/pdfjs/openjpeg.wasm is not a WebAssembly file (a Git LFS pointer or truncated copy?)",
    );
  });

  it("rejects pdf.js's default build, which needs Chrome 147 or Safari 26.2", () => {
    put("pdf.worker.min.js", 'const pdfjsVersion = "6.5.438";');
    writeServiceWorker();
    expect(checkDist(dist, PDFJS)).toEqual([
      "/pdf.worker.min.js is the default pdf.js build, which fails before Chrome 147 and Safari 26.2; run `bun run sync:wasm`, which copies the legacy worker",
    ]);

    writeGoodBuild();
    put("assets/vendor-pdfjs-jkl012.js", PDFJS_API);
    expect(checkDist(dist, PDFJS)).toEqual([
      "vendor-pdfjs-jkl012.js bundles the default pdf.js build, which fails before Chrome 147 and Safari 26.2; import pdfjs-dist/legacy/build/pdf.mjs",
    ]);
  });

  it("requires exactly one copy of pdf.js in the bundle", () => {
    // Both builds bundled, say from one module importing "pdfjs-dist".
    put("assets/main-abc123.js", PDFJS_API);
    expect(checkDist(dist, PDFJS)).toContain(
      "dist/assets carries 2 copies of pdf.js; import it only through utils/pdfConfig.ts",
    );
    rmSync(join(dist, "assets/main-abc123.js"));
    rmSync(join(dist, "assets/vendor-pdfjs-jkl012.js"));
    expect(checkDist(dist, PDFJS)).toContain(
      "no chunk in dist/assets carries pdf.js, so its build cannot be checked",
    );
  });

  it("rejects duplicate wasm left in dist/assets", () => {
    put("assets/pdf_inspector_wasm_bg-CTHLzKsX.wasm", WASM);
    expect(checkDist(dist, PDFJS)).toContain(
      "duplicate wasm in dist/assets: pdf_inspector_wasm_bg-CTHLzKsX.wasm",
    );
  });

  it("rejects a page that preloads the signature font chunk", () => {
    put(
      "index.html",
      '<link rel="modulepreload" crossorigin href="/assets/vendor-pdflib-a1.js">' +
        '<link rel="modulepreload" crossorigin href="/assets/vendor-fontkit-b2.js">',
    );
    expect(checkDist(dist, PDFJS)).toContain(
      "index.html preloads vendor-fontkit-b2.js, which only typed signatures need",
    );
    put("index.html", '<link rel="modulepreload" crossorigin href="/assets/vendor-pdflib-a1.js">');
    expect(checkDist(dist, PDFJS)).toEqual([]);
  });

  it("requires the shipped pdf.js worker to match the library version", () => {
    put("pdf.worker.min.js", "const pdfjsVersion = 5.4.449;");
    expect(checkDist(dist, PDFJS)).toContain(
      "/pdf.worker.min.js is pdf.js 5.4.449 but the app uses 6.5.438; run `bun run sync:wasm`",
    );
    rmSync(join(dist, "pdf.worker.min.js"));
    expect(checkDist(dist, PDFJS)).toContain(
      "/pdf.worker.min.js is missing; run `bun run sync:wasm` before building",
    );
  });

  it("reads the installed pdf.js version from node_modules", () => {
    expect(installedPdfjsVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(installedPdfjsVersion(dist)).toBeNull();
  });

  it("requires sw.js to carry the fingerprint of the runtime files actually shipped", () => {
    const fingerprint = runtimeAssetVersion(dist);
    expect(fingerprint).toMatch(/^[0-9a-f]{12}$/);

    // A build whose sw.js was made from other files (or the "dev" fallback).
    writeServiceWorker("dev");
    expect(checkDist(dist, PDFJS)).toContain(
      `dist/sw.js does not carry the runtime asset fingerprint "${fingerprint}"; returning visitors would keep stale engine files`,
    );

    // Rolldown (Vite 8) folds the value into the cache name's string.
    put("sw.js", `const n=\`kytepdf-static-v6-${fingerprint}\`;`);
    expect(checkDist(dist, PDFJS)).toEqual([]);

    // Changing a shipped binary changes the expected fingerprint.
    writeServiceWorker();
    expect(checkDist(dist, PDFJS)).toEqual([]);
    put("wasm/anydoc_wasm_bg.wasm", new Uint8Array([...WASM, 0x01]));
    expect(checkDist(dist, PDFJS).some((p) => p.startsWith("dist/sw.js does not carry"))).toBe(
      true,
    );

    rmSync(join(dist, "sw.js"));
    expect(checkDist(dist, PDFJS)).toContain("dist/sw.js is missing");
  });
});
