import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { runtimeAssetVersion } from "./scripts/runtimeAssetVersion.ts";

/**
 * The wasm-bindgen glue for pdf-inspector/anydoc carries a
 * `new URL('..._bg.wasm', import.meta.url)` reference for its default init
 * path. Vite resolves that and emits a hashed copy into dist/assets/ — ~11.7 MB
 * that is never requested, because both workers call `init(bytes)` with bytes
 * they fetch from the stable `/wasm/*` public copies instead.
 *
 * Drop the redundant emissions, but only once the public copy is confirmed
 * present, so a missing `sync:wasm` step fails the build loudly rather than
 * silently shipping an app whose engines 404 at runtime.
 */
function dropDuplicateWasmAssets(): Plugin {
  const publicWasmDir = resolve(import.meta.dirname, "public", "wasm");
  return {
    name: "kytepdf:drop-duplicate-wasm-assets",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (asset.type !== "asset" || !fileName.endsWith(".wasm")) continue;

        // dist/assets/pdf_inspector_wasm_bg-CTHLzKsX.wasm -> pdf_inspector_wasm_bg.wasm
        const base = fileName.split("/").pop() ?? fileName;
        const canonical = base.replace(/-[A-Za-z0-9_-]{8,}\.wasm$/, ".wasm");
        if (!existsSync(resolve(publicWasmDir, canonical))) {
          this.error(
            `Refusing to drop bundled ${fileName}: public/wasm/${canonical} is missing. ` +
              `Run \`bun run sync:wasm\` so the worker's /wasm/${canonical} fetch resolves.`,
          );
        }
        delete bundle[fileName];
      }
    },
  };
}

/**
 * The Content-Security-Policy that Netlify sends in production, read from
 * netlify.toml so `vite preview` serves exactly the deployed policy and the
 * production-CSP end-to-end tests (tests/e2e/production_csp.spec.ts) run
 * under it. Dev deliberately sends none: it needs the local auth URL and
 * Vite's HMR socket, which the production policy blocks.
 *
 * A missing policy yields no header rather than a failed config load; the
 * e2e spec checks that the preview's header matches netlify.toml.
 */
function productionCspHeaders(): Record<string, string> {
  const netlifyToml = resolve(import.meta.dirname, "netlify.toml");
  if (!existsSync(netlifyToml)) return {};
  const match = readFileSync(netlifyToml, "utf8").match(/Content-Security-Policy\s*=\s*"([^"]+)"/);
  return match ? { "Content-Security-Policy": match[1] } : {};
}

/** Matches a module inside node_modules/<path>, on any OS. */
const vendor = (path: string) => new RegExp(`[\\\\/]node_modules[\\\\/]${path}`);

/**
 * Splits the heavy vendor libraries into their own cacheable chunks, so users
 * only re-download the part that changed. Each group names its own packages
 * and has a priority: Rolldown otherwise pulls a group's dependencies into it
 * (pako landed in vendor-fontkit, and the page then preloaded that 756 kB chunk
 * although only typed signatures need it).
 */
const VENDOR_CHUNKS = [
  { name: "vendor-pdfjs", test: vendor("pdfjs-dist[\\\\/]"), priority: 90 },
  {
    name: "vendor-pdflib",
    test: vendor("(pdf-lib-with-encrypt|pako|@pdf-lib[\\\\/](?!fontkit[\\\\/]))"),
    priority: 80,
  },
  // Loaded on demand only when a document includes a typed signature.
  { name: "vendor-fontkit", test: vendor("@pdf-lib[\\\\/]fontkit[\\\\/]"), priority: 70 },
  { name: "vendor-docx", test: vendor("docx[\\\\/]"), priority: 60 },
  { name: "vendor-xlsx", test: vendor("xlsx[\\\\/]"), priority: 50 },
  { name: "vendor-zip", test: vendor("jszip[\\\\/]"), priority: 40 },
  { name: "vendor-ui", test: vendor("lucide[\\\\/]"), priority: 30 },
  { name: "vendor-misc", test: vendor(""), priority: 0 },
];

export default defineConfig({
  plugins: [dropDuplicateWasmAssets()],
  define: {
    // See scripts/runtimeAssetVersion.ts: ties the service worker's cache name
    // to the WASM/OCR files, so upgrades never serve stale binaries.
    __KYTE_ASSET_VERSION__: JSON.stringify(
      runtimeAssetVersion(resolve(import.meta.dirname, "public")),
    ),
  },
  preview: {
    headers: productionCspHeaders(),
  },
  css: {
    preprocessorOptions: {
      scss: {
        loadPaths: [resolve(import.meta.dirname, "styles")],
      },
    },
  },
  build: {
    // Keep chunks named and in assets/ for better cache control
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        sw: resolve(import.meta.dirname, "sw.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "sw" ? "sw.js" : "assets/[name]-[hash].js",
        // Rolldown replaces the deprecated manualChunks with codeSplitting groups.
        codeSplitting: { groups: VENDOR_CHUNKS },
      },
    },
  },
});
