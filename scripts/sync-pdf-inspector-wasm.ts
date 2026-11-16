import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The pdf.js worker the app ships as /pdf.worker.min.js, relative to the
 * project root. It must be the legacy build, like the library
 * utils/pdfConfig.ts imports: the default build calls
 * Map.prototype.getOrInsertComputed, Math.sumPrecise and
 * Uint8Array.prototype.toHex with no fallback, so it fails before Chrome 147,
 * Firefox 144 and Safari 26.2. The legacy build polyfills them.
 */
export const PDFJS_WORKER_SOURCE = "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs";

/** pdf.js's WebAssembly in node_modules, and where it is copied to. */
export const PDFJS_WASM_SOURCE = "node_modules/pdfjs-dist/wasm";
/** Served as /wasm/pdfjs/, the `wasmUrl` in utils/config.ts. */
export const PDFJS_WASM_DEST = "public/wasm/pdfjs";

/**
 * The files pdf.js fetches from its `wasmUrl`, with the licence files that
 * sit beside them. Each image decoder has a plain JavaScript copy that pdf.js
 * imports when WebAssembly will not start. QuickJS, also in that folder, is
 * left out: only pdf.js scripting (pdf.sandbox.mjs) uses it, and the app never
 * loads that.
 */
export const PDFJS_WASM_COMPONENTS = [
  {
    name: "JBIG2 and CCITT fax image decoder (PDFium)",
    files: ["jbig2.wasm", "jbig2_nowasm_fallback.js"],
    licences: ["LICENSE_JBIG2", "LICENSE_PDFJS_JBIG2"],
  },
  {
    name: "JPEG 2000 image decoder (OpenJPEG)",
    files: ["openjpeg.wasm", "openjpeg_nowasm_fallback.js"],
    licences: ["LICENSE_OPENJPEG", "LICENSE_PDFJS_OPENJPEG"],
  },
  {
    name: "ICC colour management (qcms)",
    files: ["qcms_bg.wasm"],
    licences: ["LICENSE_QCMS", "LICENSE_PDFJS_QCMS"],
  },
];

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function copyIfPresent(src: string, dest: string, label: string) {
  if (!existsSync(src)) {
    console.error(`Source not found: ${src}`);
    process.exitCode = 1;
    return;
  }
  copyFileSync(src, dest);
  const kb = (readFileSync(dest).length / 1024).toFixed(0);
  console.log(`synced ${label} -> ${dest.replace(`${process.cwd()}/`, "")} (${kb} KB)`);
}

function readLicense(pkgDir: string): string | null {
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "COPYING"]) {
    const p = join(pkgDir, name);
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  return null;
}

function syncWasmPackages() {
  const destDir = join(process.cwd(), "public", "wasm");
  ensureDir(destDir);
  const packages = [
    {
      pkg: "@firecrawl/pdf-inspector-wasm",
      file: "pdf_inspector_wasm_bg.wasm",
      dest: "pdf_inspector_wasm_bg.wasm",
    },
    {
      pkg: "@firecrawl/anydoc-wasm",
      file: "anydoc_wasm_bg.wasm",
      dest: "anydoc_wasm_bg.wasm",
    },
  ];
  for (const entry of packages) {
    const src = join(process.cwd(), "node_modules", entry.pkg, entry.file);
    if (!existsSync(src)) {
      console.error(`Source wasm not found: ${src}\nRun: bun add ${entry.pkg}`);
      process.exitCode = 1;
      continue;
    }
    copyIfPresent(src, join(destDir, entry.dest), entry.pkg);
  }
}

function syncTesseract() {
  const destDir = join(process.cwd(), "public", "tesseract");
  const langDir = join(destDir, "lang-data");
  ensureDir(langDir);

  copyIfPresent(
    join(process.cwd(), "node_modules", "tesseract.js", "dist", "worker.min.js"),
    join(destDir, "worker.min.js"),
    "tesseract.js worker",
  );
  copyIfPresent(
    join(process.cwd(), "node_modules", "tesseract.js-core", "tesseract-core-simd-lstm.js"),
    join(destDir, "tesseract-core-simd-lstm.js"),
    "tesseract-core js",
  );
  copyIfPresent(
    join(process.cwd(), "node_modules", "tesseract.js-core", "tesseract-core-simd-lstm.wasm"),
    join(destDir, "tesseract-core-simd-lstm.wasm"),
    "tesseract-core wasm",
  );

  // Language pack is vendored under public/ (downloaded once). Do not overwrite if present.
  const eng = join(langDir, "eng.traineddata.gz");
  if (!existsSync(eng)) {
    console.error(
      `Missing ${eng}. Download eng.traineddata.gz into public/tesseract/lang-data/ (see Phase 6 notes).`,
    );
    process.exitCode = 1;
  } else {
    const kb = (readFileSync(eng).length / 1024).toFixed(0);
    console.log(`kept tesseract eng lang pack (${kb} KB)`);
  }
}

/**
 * The third-party notices for the vendored pdf.js, WASM and OCR files, so the
 * shipped distribution carries the attribution they require.
 */
export function thirdPartyNotices(root = process.cwd()): string {
  const sections: string[] = [
    "# Third-Party Notices",
    "",
    "This product redistributes the following third-party components.",
    "",
  ];

  const packages = [
    {
      name: "@firecrawl/pdf-inspector-wasm",
      note: "MIT. PDF analysis WebAssembly (Firecrawl). May embed Adobe CMap resources with additional notice requirements from the upstream pdf.js/pdf-inspector distribution.",
    },
    {
      name: "@firecrawl/anydoc-wasm",
      note: "MIT. Office/document to Markdown WebAssembly (Firecrawl / Sideguide).",
    },
    {
      name: "tesseract.js",
      note: "Apache-2.0. In-browser OCR engine wrapper.",
    },
    {
      name: "tesseract.js-core",
      note: "Apache-2.0. Tesseract OCR compiled to WebAssembly.",
    },
    {
      name: "pdfjs-dist",
      note: "Apache-2.0. PDF.js rendering library (Mozilla), including its worker (/pdf.worker.min.js).",
    },
  ];

  for (const entry of packages) {
    const pkgDir = join(root, "node_modules", entry.name);
    sections.push(`## ${entry.name}`, "", entry.note, "");
    const license = existsSync(pkgDir) ? readLicense(pkgDir) : null;
    if (license) {
      sections.push("```", license.trim(), "```", "");
    } else {
      sections.push(`(License text not found under node_modules/${entry.name}.)`, "");
    }
  }

  for (const component of PDFJS_WASM_COMPONENTS) {
    sections.push(
      `## pdfjs-dist: ${component.name}`,
      "",
      `Shipped as ${component.files.map((file) => `/wasm/pdfjs/${file}`).join(" and ")}.`,
      "",
    );
    for (const licence of component.licences) {
      const path = join(root, PDFJS_WASM_SOURCE, licence);
      if (existsSync(path)) {
        sections.push("```", readFileSync(path, "utf8").trim(), "```", "");
      } else {
        sections.push(`(License text not found at ${PDFJS_WASM_SOURCE}/${licence}.)`, "");
      }
    }
  }

  sections.push(
    "## Adobe CMaps (via pdf-inspector / pdf.js lineage)",
    "",
    "If the pdf-inspector WASM build embeds Adobe CMap resources, those materials",
    "remain subject to Adobe's CMap redistribution terms as documented by Mozilla",
    "pdf.js. See: https://github.com/mozilla/pdf.js/blob/master/LICENSE",
    "",
  );

  return sections.join("\n");
}

function writeThirdPartyNotices() {
  const noticesDir = join(process.cwd(), "public", "third-party");
  ensureDir(noticesDir);
  const notices = thirdPartyNotices();

  const out = join(noticesDir, "NOTICES.md");
  writeFileSync(out, notices);
  console.log(`wrote ${out.replace(`${process.cwd()}/`, "")}`);

  // Also place a root-level copy for source-tree visibility.
  const rootOut = join(process.cwd(), "THIRD_PARTY_NOTICES.md");
  writeFileSync(rootOut, notices);
  console.log(`wrote ${rootOut.replace(`${process.cwd()}/`, "")}`);
}

/**
 * pdf.js refuses to run with a worker from a different version, so copy the
 * worker that belongs to the installed pdfjs-dist on every dev start and
 * build, rather than keeping a hand-copied file in git that can drift.
 */
function syncPdfjsWorker() {
  copyIfPresent(
    join(process.cwd(), PDFJS_WORKER_SOURCE),
    join(process.cwd(), "public", "pdf.worker.min.js"),
    "pdfjs-dist legacy worker",
  );
}

/**
 * pdf.js decodes JBIG2, CCITT fax and JPEG 2000 images, and applies ICC
 * colour profiles, with WebAssembly it fetches from `wasmUrl` at run time.
 * Without these files it leaves those images out of the page.
 */
function syncPdfjsWasm() {
  const destDir = join(process.cwd(), PDFJS_WASM_DEST);
  ensureDir(destDir);
  for (const file of PDFJS_WASM_COMPONENTS.flatMap((component) => component.files)) {
    copyIfPresent(
      join(process.cwd(), PDFJS_WASM_SOURCE, file),
      join(destDir, file),
      `pdfjs-dist ${file}`,
    );
  }
}

function main() {
  syncPdfjsWorker();
  syncPdfjsWasm();
  syncWasmPackages();
  syncTesseract();
  writeThirdPartyNotices();
}

// Run only as a script (`bun run sync:wasm`), so tests can import the paths above.
if (import.meta.main) {
  try {
    main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
