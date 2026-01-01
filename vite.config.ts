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
});
