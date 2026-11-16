import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
 * Bundle third-party notices for vendored WASM/OCR binaries into public/ so the
 * shipped distribution carries required attribution.
 */
function writeThirdPartyNotices() {
  const noticesDir = join(process.cwd(), "public", "third-party");
  ensureDir(noticesDir);
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
  ];

  for (const entry of packages) {
    const pkgDir = join(process.cwd(), "node_modules", entry.name);
    sections.push(`## ${entry.name}`, "", entry.note, "");
    const license = existsSync(pkgDir) ? readLicense(pkgDir) : null;
    if (license) {
      sections.push("```", license.trim(), "```", "");
    } else {
      sections.push(`(License text not found under node_modules/${entry.name}.)`, "");
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

  const out = join(noticesDir, "NOTICES.md");
  writeFileSync(out, sections.join("\n"));
  console.log(`wrote ${out.replace(`${process.cwd()}/`, "")}`);

  // Also place a root-level copy for source-tree visibility.
  const rootOut = join(process.cwd(), "THIRD_PARTY_NOTICES.md");
  writeFileSync(rootOut, sections.join("\n"));
  console.log(`wrote ${rootOut.replace(`${process.cwd()}/`, "")}`);
}

function main() {
  syncWasmPackages();
  syncTesseract();
  writeThirdPartyNotices();
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
