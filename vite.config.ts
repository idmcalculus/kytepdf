import { existsSync } from "node:fs";
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
  const publicWasmDir = resolve(__dirname, "public", "wasm");
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

export default defineConfig({
  plugins: [dropDuplicateWasmAssets()],
  define: {
    // See scripts/runtimeAssetVersion.ts: ties the service worker's cache name
    // to the WASM/OCR files, so upgrades never serve stale binaries.
    __KYTE_ASSET_VERSION__: JSON.stringify(runtimeAssetVersion(resolve(__dirname, "public"))),
  },
  css: {
    preprocessorOptions: {
      scss: {
        loadPaths: [resolve(__dirname, "styles")],
      },
    },
  },
  build: {
    // Keep chunks named and in assets/ for better cache control
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        sw: resolve(__dirname, "sw.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "sw" ? "sw.js" : "assets/[name]-[hash].js",
        /**
         * Manual chunk strategy — splits the four heavy vendor libraries
         * into their own cacheable chunks so users only re-download the
         * part that changed:
         *
         *   vendor-pdfjs      ~2.5 MB (pdfjs-dist + worker)
         *   vendor-pdflib     ~1.1 MB (pdf-lib-with-encrypt + pako + fonts)
         *   vendor-xlsx       ~0.9 MB (xlsx / SheetJS)
         *   vendor-zip        ~0.1 MB (jszip)
         *   vendor-misc       everything else from node_modules
         */
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          // PDF.js — PDF rendering engine (largest dep)
          if (id.includes("/pdfjs-dist/")) return "vendor-pdfjs";

          // pdf-lib + its deps (pako compression, standard fonts)
          if (
            id.includes("/pdf-lib-with-encrypt/") ||
            id.includes("/@pdf-lib/") ||
            id.includes("/pako/")
          ) {
            return "vendor-pdflib";
          }

          // docx — only used for DOCX generation
          if (id.includes("/docx/")) return "vendor-docx";

          // SheetJS / xlsx — only used by Office conversion tools
          if (id.includes("/xlsx/")) return "vendor-xlsx";

          // JSZip — only used for batch ZIP downloads
          if (id.includes("/jszip/")) return "vendor-zip";

          // Lucide icons
          if (id.includes("/lucide/")) return "vendor-ui";

          // Everything else from node_modules → single shared vendor chunk
          return "vendor-misc";
        },
      },
    },
  },
});
