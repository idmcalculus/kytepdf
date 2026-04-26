import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
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
