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
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        sw: resolve(__dirname, "sw.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "sw" ? "sw.js" : "assets/[name]-[hash].js",
      },
    },
  },
});
