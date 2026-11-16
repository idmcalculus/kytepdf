import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PDFJS_WASM_COMPONENTS,
  PDFJS_WASM_DEST,
  PDFJS_WASM_SOURCE,
  PDFJS_WORKER_SOURCE,
  thirdPartyNotices,
} from "../../scripts/sync-pdf-inspector-wasm";
import { config } from "../../utils/config";

const root = process.cwd();

/** Only pdf.js's legacy build carries core-js, whose shared-state key is this. */
const LEGACY_MARKER = "__core-js_shared__";

/** Every app source file the browser runs. */
function appSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts")) out.push(full);
    }
  };
  walk(join(root, "components"));
  walk(join(root, "utils"));
  out.push(join(root, "main.ts"), join(root, "sw.ts"));
  return out;
}

/**
 * Static and dynamic imports (and re-exports) of pdfjs-dist. `import type`
 * is left out: types are erased, and the legacy build shares them.
 */
const PDFJS_IMPORT =
  /\b(?:import|export)\b(\s+type\b)?[^'"`;]*?["'](pdfjs-dist(?:\/[^"']*)?)["']|\bimport\(\s*["'](pdfjs-dist(?:\/[^"']*)?)["']/g;

describe("pdf.js build the app ships", () => {
  it("copies the legacy worker, which runs before Chrome 147 and Safari 26.2", () => {
    expect(PDFJS_WORKER_SOURCE).toBe("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs");
    const worker = readFileSync(join(root, PDFJS_WORKER_SOURCE), "utf8");
    expect(worker).toContain(LEGACY_MARKER);
    // The default build lacks the polyfills: the check above tells them apart.
    const defaultWorker = readFileSync(
      join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
      "utf8",
    );
    expect(defaultWorker).not.toContain(LEGACY_MARKER);
  });

  it("loads pdf.js at run time only through the legacy build in utils/pdfConfig.ts", () => {
    const runtimeImports: string[] = [];
    for (const file of appSources()) {
      for (const match of readFileSync(file, "utf8").matchAll(PDFJS_IMPORT)) {
        const [, typeOnly, specifier, dynamicSpecifier] = match;
        if (typeOnly) continue;
        runtimeImports.push(`${relative(root, file)}: ${specifier ?? dynamicSpecifier}`);
      }
    }
    expect(runtimeImports).toEqual(["utils/pdfConfig.ts: pdfjs-dist/legacy/build/pdf.mjs"]);
  });
});

describe("pdf.js image decoders", () => {
  const shipped = PDFJS_WASM_COMPONENTS.flatMap((component) => component.files);

  it("are copied to the folder the app gives pdf.js as wasmUrl", () => {
    expect(PDFJS_WASM_DEST.startsWith("public/")).toBe(true);
    expect(`/${relative("public", PDFJS_WASM_DEST)}/`).toBe(config.pdf.wasmUrl);
  });

  it("include every file the pdf.js worker fetches from wasmUrl", () => {
    // Names in strings, e.g. `_filename = "jbig2.wasm"` or `${wasmUrl}qcms_bg.wasm`.
    const worker = readFileSync(join(root, PDFJS_WORKER_SOURCE), "utf8");
    const fetched = new Set(
      [...worker.matchAll(/(?<=["'`}])([\w-]+\.wasm|[\w-]+_nowasm_fallback\.js)(?=["'`])/g)].map(
        (match) => match[1],
      ),
    );
    expect([...fetched].sort()).toEqual([...shipped].sort());
    for (const file of shipped) {
      expect(existsSync(join(root, PDFJS_WASM_SOURCE, file)), file).toBe(true);
    }
  });

  it("have their licences in the third-party notices", () => {
    // pdfjs-dist ships two licences per decoder, the library's own and pdf.js's
    // for its build of it: LICENSE_QCMS and LICENSE_PDFJS_QCMS for qcms_bg.wasm.
    const stems = new Set(
      shipped.map((file) => file.replace(/(_bg)?(\.wasm|_nowasm_fallback\.js)$/, "").toUpperCase()),
    );
    const licences = readdirSync(join(root, PDFJS_WASM_SOURCE)).filter((name) =>
      stems.has(name.replace(/^LICENSE_(PDFJS_)?/, "")),
    );
    expect(licences).toHaveLength(stems.size * 2);

    const notices = thirdPartyNotices();
    for (const licence of licences) {
      const text = readFileSync(join(root, PDFJS_WASM_SOURCE, licence), "utf8").trim();
      expect(notices, licence).toContain(text);
    }
    for (const component of PDFJS_WASM_COMPONENTS) {
      expect(notices).toContain(`## pdfjs-dist: ${component.name}`);
    }
    expect(notices).not.toContain("License text not found");
  });
});
