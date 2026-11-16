/**
 * Post-build assertion for the parts of the app that only fail at runtime:
 * the engine workers must be bundled JavaScript, the files they fetch by fixed
 * URL must be real (not empty, truncated or Git LFS pointers), pdf.js and its
 * worker must be the legacy build, and the service worker must carry the
 * build's asset fingerprint.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { runtimeAssetVersion } from "./runtimeAssetVersion.ts";

/** Engine workers started with `new Worker(new URL(...))`; Vite emits each as its own chunk. */
const ENGINE_WORKERS = ["pdfInspectorWorker", "anydocWorker"];

/** Files the workers fetch by absolute path, and the magic bytes each must start with. */
const RUNTIME_ASSETS: Array<{ path: string; magic?: number[]; kind?: string }> = [
  { path: "wasm/pdf_inspector_wasm_bg.wasm", magic: [0x00, 0x61, 0x73, 0x6d], kind: "WebAssembly" },
  { path: "wasm/anydoc_wasm_bg.wasm", magic: [0x00, 0x61, 0x73, 0x6d], kind: "WebAssembly" },
  { path: "tesseract/worker.min.js" },
  {
    path: "tesseract/tesseract-core-simd-lstm.wasm",
    magic: [0x00, 0x61, 0x73, 0x6d],
    kind: "WebAssembly",
  },
  { path: "tesseract/tesseract-core-simd-lstm.js" },
  { path: "tesseract/lang-data/eng.traineddata.gz", magic: [0x1f, 0x8b], kind: "gzip" },
  // pdf.js's image decoders and colour management, fetched from its wasmUrl
  // (utils/config.ts). The .js files are what it imports when WebAssembly fails.
  { path: "wasm/pdfjs/jbig2.wasm", magic: [0x00, 0x61, 0x73, 0x6d], kind: "WebAssembly" },
  { path: "wasm/pdfjs/jbig2_nowasm_fallback.js" },
  { path: "wasm/pdfjs/openjpeg.wasm", magic: [0x00, 0x61, 0x73, 0x6d], kind: "WebAssembly" },
  { path: "wasm/pdfjs/openjpeg_nowasm_fallback.js" },
  { path: "wasm/pdfjs/qcms_bg.wasm", magic: [0x00, 0x61, 0x73, 0x6d], kind: "WebAssembly" },
];

/**
 * Only pdf.js's legacy build runs in the browsers the app supports (see
 * utils/pdfConfig.ts). It carries core-js polyfills, and core-js's shared-state
 * key is a string the default build never contains.
 */
const PDFJS_LEGACY_MARKER = "__core-js_shared__";
const PDFJS_DEFAULT_BUILD =
  "the default pdf.js build, which fails before Chrome 147 and Safari 26.2";

/**
 * pdf.js's display API sends its version with every document it opens.
 * Rolldown turns the string into a template literal, so allow any quote.
 */
const PDFJS_API_VERSION = /apiVersion\s*:\s*["'`]\d+\.\d+\.\d+["'`]/g;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const startsWith = (bytes: Uint8Array, magic: number[]) =>
  magic.every((byte, index) => bytes[index] === byte);

/** The pdfjs-dist version installed in node_modules, which the shipped worker must match. */
export function installedPdfjsVersion(root = process.cwd()): string | null {
  const manifest = join(root, "node_modules", "pdfjs-dist", "package.json");
  return existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")).version : null;
}

/**
 * Returns every problem found in a built dist folder; an empty list means it
 * is fit to ship. `pdfjsVersion` is the library version the app was built
 * with: pdf.js refuses to run with a worker from any other version.
 */
export function checkDist(dist: string, pdfjsVersion = installedPdfjsVersion()): string[] {
  if (!existsSync(dist)) return ["dist/ is missing; run vite build first"];

  const problems: string[] = [];
  const assetsDir = join(dist, "assets");
  const assetFiles = walk(assetsDir);
  const jsChunks = assetFiles.filter((f) => f.endsWith(".js"));
  if (jsChunks.length === 0) problems.push("dist/assets has no .js files");

  const rawTypeScript = walk(dist).filter((f) => /\.tsx?$/.test(f));
  if (rawTypeScript.length > 0) {
    problems.push(`raw TypeScript files in dist (not bundled): ${rawTypeScript.join(", ")}`);
  }

  for (const stem of ENGINE_WORKERS) {
    const chunk = jsChunks.find((f) => basename(f).startsWith(`${stem}-`));
    if (!chunk) {
      problems.push(`dist/assets has no bundled ${stem}-*.js chunk`);
      continue;
    }
    if (statSync(chunk).size === 0) problems.push(`${basename(chunk)} is empty`);
  }

  let pdfjsCopies = 0;
  for (const file of jsChunks) {
    const src = readFileSync(file, "utf8");
    if (/from\s*["']@firecrawl\//.test(src)) {
      problems.push(`${basename(file)} still imports @firecrawl packages by bare name`);
    }
    if (/^\s*import\s+type\s/m.test(src)) {
      problems.push(`${basename(file)} still contains TypeScript "import type" syntax`);
    }
    const copies = src.match(PDFJS_API_VERSION)?.length ?? 0;
    pdfjsCopies += copies;
    if (copies > 0 && !src.includes(PDFJS_LEGACY_MARKER)) {
      problems.push(
        `${basename(file)} bundles ${PDFJS_DEFAULT_BUILD}; import pdfjs-dist/legacy/build/pdf.mjs`,
      );
    }
  }
  if (jsChunks.length > 0 && pdfjsCopies !== 1) {
    problems.push(
      pdfjsCopies === 0
        ? "no chunk in dist/assets carries pdf.js, so its build cannot be checked"
        : `dist/assets carries ${pdfjsCopies} copies of pdf.js; import it only through utils/pdfConfig.ts`,
    );
  }

  for (const asset of RUNTIME_ASSETS) {
    const full = join(dist, asset.path);
    if (!existsSync(full)) {
      problems.push(`/${asset.path} is missing; run \`bun run sync:wasm\` before building`);
      continue;
    }
    const bytes = readFileSync(full);
    if (bytes.length === 0) {
      problems.push(`/${asset.path} is empty`);
    } else if (asset.magic && !startsWith(bytes, asset.magic)) {
      problems.push(
        `/${asset.path} is not a ${asset.kind} file (a Git LFS pointer or truncated copy?)`,
      );
    }
  }

  // Vite's own hashed copies of the wasm are never fetched (the workers load
  // the /wasm copies), so they must not ship. See vite.config.ts.
  const strayWasm = assetFiles.filter((f) => f.endsWith(".wasm"));
  if (strayWasm.length > 0) {
    problems.push(`duplicate wasm in dist/assets: ${strayWasm.map((f) => basename(f)).join(", ")}`);
  }

  const workerPath = join(dist, "pdf.worker.min.js");
  if (!existsSync(workerPath)) {
    problems.push("/pdf.worker.min.js is missing; run `bun run sync:wasm` before building");
  } else {
    const worker = readFileSync(workerPath, "utf8");
    const shipped = worker.match(/pdfjsVersion = "?([\d.]+)"?/)?.[1];
    if (pdfjsVersion && shipped !== pdfjsVersion) {
      problems.push(
        `/pdf.worker.min.js is pdf.js ${shipped ?? "of unknown version"} but the app uses ${pdfjsVersion}; run \`bun run sync:wasm\``,
      );
    }
    if (!worker.includes(PDFJS_LEGACY_MARKER)) {
      problems.push(
        `/pdf.worker.min.js is ${PDFJS_DEFAULT_BUILD}; run \`bun run sync:wasm\`, which copies the legacy worker`,
      );
    }
  }

  const swPath = join(dist, "sw.js");
  if (!existsSync(swPath)) {
    problems.push("dist/sw.js is missing");
  } else {
    // dist holds the same runtime files the build hashed from public/, so the
    // fingerprint compiled into sw.js must equal one computed here. Look for the
    // value alone: minifiers place it differently (Rolldown folds it straight
    // into the cache name's string).
    const expected = runtimeAssetVersion(dist);
    if (!readFileSync(swPath, "utf8").includes(expected)) {
      problems.push(
        `dist/sw.js does not carry the runtime asset fingerprint "${expected}"; returning visitors would keep stale engine files`,
      );
    }
  }

  return problems;
}

if (import.meta.main) {
  const problems = checkDist(join(process.cwd(), "dist"));
  if (problems.length > 0) {
    console.error(`assert-worker-artifacts:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log("assert-worker-artifacts: ok");
}
