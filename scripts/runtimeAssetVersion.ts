import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

/** Runtime files the app fetches by fixed, unhashed URLs, relative to public/ or dist/. */
export const RUNTIME_ASSET_ROOTS = ["wasm", "tesseract", "pdf.worker.min.js"];

/**
 * A 12-character hash of the runtime files under `rootDir` (public/ at build
 * time, dist/ after it, which holds identical copies). The service worker puts
 * it in its cache name, so a dependency upgrade that changes any of these files
 * also changes sw.js, and returning visitors drop the old copies instead of
 * pairing new glue code with an old binary. Returns "none" when none exist.
 */
export function runtimeAssetVersion(rootDir: string): string {
  const files: string[] = [];
  const walk = (path: string) => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) walk(resolve(path, name));
    } else {
      files.push(path);
    }
  };
  for (const root of RUNTIME_ASSET_ROOTS) walk(resolve(rootDir, root));
  if (files.length === 0) return "none";

  const hash = createHash("sha256");
  for (const file of files) {
    // Forward slashes so the hash is the same on every OS.
    hash.update(relative(rootDir, file).split("\\").join("/"));
    hash.update(readFileSync(file));
  }
  return hash.digest("hex").slice(0, 12);
}
