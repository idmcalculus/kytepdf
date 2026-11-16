import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test as base, expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { PREVIEW_URL } from "./fixtures/productionPreview.ts";

/**
 * The built app under the Content-Security-Policy that Netlify sends in
 * production. `vite dev` sends no policy, so a fetch, worker, WASM module,
 * font or image the policy blocks only fails after deploy. These flows load
 * each of those and fail on any violation, including ones inside workers.
 *
 * Runs against `vite preview` (see playwright.config.ts), which serves the
 * policy from netlify.toml through vite.config.ts `preview.headers`.
 */

type DialogResult = { type: string; title: string; message: string };
type SavedFile = { name: string; bytes: Buffer };
type PageViolation = { blockedURI: string; violatedDirective: string };

const CSP_TEXT = /Content[- ]Security[- ]Policy/i;

/** Cuts the payload out of data: URLs, which can run to megabytes of base64. */
const shortenDataUrls = (text: string) =>
  text.replace(/(data:[^,'"\s]*,)[^'"\s]{24,}/g, (_match, head: string) => `${head}…`);

/**
 * Collects every policy violation the page reports, and fails the test at the
 * end if there was one:
 * - `securitypolicyviolation` events in the page, recorded by an init script
 *   (into `window.__cspViolations`) and passed straight to Node, so a reload
 *   cannot lose them;
 * - console messages that mention the policy;
 * - in Chromium, the log entries of workers (the WASM engines, OCR and pdf.js
 *   run there), which reach neither the page's events nor its console.
 */
const test = base.extend<{ cspViolations: string[] }>({
  cspViolations: [
    async ({ page, browserName }, use) => {
      const violations: string[] = [];
      const record = (entry: string) => {
        const short = shortenDataUrls(entry);
        if (!violations.includes(short)) violations.push(short);
      };
      const recordPageViolation = (v: PageViolation) =>
        record(`page: ${v.violatedDirective} blocked ${v.blockedURI || "(inline)"}`);

      await page.exposeFunction("__reportCspViolation", recordPageViolation);
      await page.addInitScript(() => {
        const win = window as any;
        // Without the File System Access API the app saves through an
        // <a download> link, which Playwright reports as a download.
        Reflect.deleteProperty(win, "showSaveFilePicker");
        Reflect.deleteProperty(Object.getPrototypeOf(win), "showSaveFilePicker");

        win.__cspViolations = [];
        document.addEventListener(
          "securitypolicyviolation",
          (event) => {
            const violation = {
              blockedURI: event.blockedURI,
              violatedDirective: event.violatedDirective,
            };
            win.__cspViolations.push(violation);
            win.__reportCspViolation?.(violation);
          },
          true,
        );
      });

      page.on("console", (message) => {
        if (CSP_TEXT.test(message.text())) record(`console: ${message.text()}`);
      });

      if (browserName === "chromium") {
        const cdp = await page.context().newCDPSession(page);
        cdp.on("Log.entryAdded", ({ entry }) => {
          if (entry.source === "worker" && CSP_TEXT.test(entry.text)) {
            record(`worker: ${entry.text}`);
          }
        });
        await cdp.send("Log.enable");
      }

      await use(violations);

      const inPage: PageViolation[] = await page
        .evaluate(() => (window as any).__cspViolations ?? [])
        .catch(() => []);
      inPage.forEach(recordPageViolation);
      expect(violations, "Content-Security-Policy violations").toEqual([]);
    },
    { auto: true },
  ],
});

test.use({ baseURL: PREVIEW_URL });
test.describe.configure({ timeout: 120_000 });

/** A one-page PDF with real Helvetica text, built by hand so the test needs no PDF library. */
function buildTextPdf(lines: string[]): Buffer {
  const escapePdf = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = [
    "BT",
    "/F1 24 Tf",
    "30 TL",
    "72 720 Td",
    ...lines.map((line, index) => `${index > 0 ? "T* " : ""}(${escapePdf(line)}) Tj`),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const TEXT_LINES = ["KytePDF production CSP check", "Plain words for the extractor"];
const TEXT_PDF = buildTextPdf(TEXT_LINES);
const textPdfFile = (name = "csp-text.pdf") => ({
  name,
  mimeType: "application/pdf",
  buffer: TEXT_PDF,
});
const CSV_FILE = {
  name: "budget.csv",
  mimeType: "text/csv",
  buffer: Buffer.from("Item,Cost\nTrain,42\nHotel,120\n"),
};
const OCR_WORDS = ["HELLO", "WORLD"];

// Drawn once per worker in a blank page (no policy applies there).
let ocrPng: Buffer;
let photoPng: Buffer;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    // Large black words on white: clean input for Tesseract.
    ocrPng = Buffer.from(
      await page.evaluate(async (words) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1400;
        canvas.height = 360;
        const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#000000";
        ctx.font = "bold 140px Arial, Helvetica, sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillText(words.join(" "), 60, canvas.height / 2);
        const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
        if (!blob) throw new Error("canvas.toBlob returned nothing");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return btoa(binary);
      }, OCR_WORDS),
      "base64",
    );

    // Seeded noise does not compress, so embedding it grows the PDF by tens
    // of kilobytes: an unmistakable sign that the image reached the file.
    photoPng = Buffer.from(
      await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 160;
        const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
        const image = ctx.createImageData(canvas.width, canvas.height);
        // xorshift32: every output byte is well mixed, so nothing repeats.
        let seed = 0x2545f491;
        for (let i = 0; i < image.data.length; i += 4) {
          for (let c = 0; c < 3; c += 1) {
            seed ^= seed << 13;
            seed ^= seed >>> 17;
            seed ^= seed << 5;
            image.data[i + c] = seed & 0xff;
          }
          image.data[i + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
        const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
        if (!blob) throw new Error("canvas.toBlob returned nothing");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return btoa(binary);
      }),
      "base64",
    );
  } finally {
    await page.close();
  }
});

function netlifyCsp(testInfo: TestInfo): string {
  const toml = readFileSync(resolve(testInfo.project.testDir, "../../netlify.toml"), "utf8");
  const match = toml.match(/Content-Security-Policy\s*=\s*"([^"]+)"/);
  if (!match) throw new Error("No Content-Security-Policy found in netlify.toml");
  return match[1];
}

/** Opens a tool from the dashboard and returns its element. */
async function openTool(page: Page, id: string, tag: string): Promise<Locator> {
  const onDashboard = await page
    .locator(".dashboard-grid")
    .isVisible()
    .catch(() => false);
  if (!onDashboard) {
    await page.goto("/");
  }
  await page.locator(`.tool-card[data-id="${id}"]`).click();
  const tool = page.locator(tag);
  await expect(tool).toBeVisible();
  return tool;
}

/** Waits for the app's dialog, reads it, and closes it. */
async function takeDialog(page: Page, timeout = 60_000): Promise<DialogResult> {
  await page.locator("#kyteOverlay.active").waitFor({ state: "visible", timeout });
  const modalClass = (await page.locator("#kyteModal").getAttribute("class")) ?? "";
  const result = {
    type: /kyte-modal-(\w+)/.exec(modalClass)?.[1] ?? "info",
    title: ((await page.locator("#kyteTitle").textContent()) ?? "").trim(),
    message: ((await page.locator("#kyteMessage").textContent()) ?? "").trim(),
  };
  await page.locator("#kyteConfirmBtn").click();
  await expect(page.locator("#kyteOverlay")).toBeHidden();
  return result;
}

async function expectSuccessDialog(page: Page, timeout?: number): Promise<string> {
  const dialog = await takeDialog(page, timeout);
  expect(dialog.type, `${dialog.title}: ${dialog.message}`).toBe("success");
  return dialog.message;
}

/**
 * Runs `trigger` and returns the file it downloads. Fails at once, with the
 * app's own message, if the app shows an error dialog instead.
 */
async function downloadFrom(
  page: Page,
  trigger: () => Promise<unknown>,
  timeout = 60_000,
): Promise<SavedFile> {
  const download = page.waitForEvent("download", { timeout });
  const errorDialog = page
    .locator("#kyteOverlay.active #kyteModal.kyte-modal-error")
    .waitFor({ state: "visible", timeout })
    .then(() => "error" as const);
  await trigger();
  const outcome = await Promise.race([download, errorDialog]);
  if (outcome === "error") {
    const message = await page.locator("#kyteMessage").textContent();
    throw new Error(`The app showed an error instead of a download: "${message?.trim()}"`);
  }
  return {
    name: outcome.suggestedFilename(),
    bytes: await readFile(await outcome.path()),
  };
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

test.describe("Production Content-Security-Policy", () => {
  test("dashboard loads under the deployed policy", async ({ page }, testInfo) => {
    const response = await page.goto("/");
    expect(
      response?.headers()["content-security-policy"],
      "vite preview must send the policy from netlify.toml",
    ).toBe(netlifyCsp(testInfo));

    await expect(page.locator("h1")).toContainText("Kyte", { timeout: 15_000 });
    await expect(page.locator(".tool-card").first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    // The service worker registers on load in production builds.
    const workerState = await page.evaluate(() =>
      Promise.race([
        navigator.serviceWorker.ready.then((registration) => registration.active?.state ?? "none"),
        new Promise<string>((done) => setTimeout(() => done("not ready after 15 s"), 15_000)),
      ]),
    );
    expect(workerState).toMatch(/^activat/);
  });

  test("PDF to Text extracts Markdown with the WASM engine", async ({ page }) => {
    const tool = await openTool(page, "pdf-to-text", "pdf-to-text");
    await tool.locator("#fileInput").setInputFiles(textPdfFile());
    await expect(tool.locator("#mainLayout")).toBeVisible();
    await tool.locator("#formatMdBtn").click();
    await tool.locator("#convertBtn").click();

    const message = await expectSuccessDialog(page);
    // The diagnosis comes only from pdf-inspector; its absence means the
    // WASM engine failed and the legacy extractor stepped in.
    expect(message, "pdf-inspector diagnosis").toContain("Type:");

    const saved = await downloadFrom(page, () => tool.locator("#downloadLink").click());
    expect(saved.name).toMatch(/\.md$/);
    const markdown = collapse(saved.bytes.toString("utf8"));
    for (const line of TEXT_LINES) expect(markdown).toContain(line);
  });

  test("Office to Markdown turns a CSV into a table", async ({ page }) => {
    const tool = await openTool(page, "office-to-markdown", "office-to-markdown");
    await tool.locator("#fileInput").setInputFiles(CSV_FILE);
    await expect(tool.locator("#mainLayout")).toBeVisible();
    await tool.locator("#convertBtn").click();
    await expectSuccessDialog(page);

    const saved = await downloadFrom(page, () => tool.locator("#downloadLink").click());
    expect(saved.name).toMatch(/\.md$/);
    const markdown = saved.bytes.toString("utf8");
    expect(markdown).toMatch(/\|\s*Item\s*\|\s*Cost\s*\|/);
    expect(markdown).toMatch(/\|\s*:?-{3,}:?\s*\|/);
    expect(markdown).toMatch(/\|\s*Train\s*\|\s*42\s*\|/);
    expect(markdown).toMatch(/\|\s*Hotel\s*\|\s*120\s*\|/);
  });

  test("OCR reads an image-only PDF made by Image to PDF", async ({ page }) => {
    // Tesseract loads its worker, WASM core and language data on first use.
    test.setTimeout(240_000);

    const imageTool = await openTool(page, "img-to-pdf", "image-to-pdf");
    await imageTool
      .locator("#fileInput")
      .setInputFiles({ name: "words.png", mimeType: "image/png", buffer: ocrPng });
    await expect(imageTool.locator("#fileListContainer")).toBeVisible();
    await imageTool.locator("#convertBtn").click();
    await expectSuccessDialog(page);
    // This button sits below the fold. Once scrolled to, Chrome's
    // elementsFromPoint() lists the inline <image-to-pdf> host above it,
    // so Playwright's hit-target check reports a false "intercepts pointer
    // events" and retries until the timeout. A real click at that point
    // reaches the button (elementFromPoint agrees), so skip the check; the
    // download below still proves the click landed.
    const scan = await downloadFrom(page, () =>
      imageTool.locator("#downloadLink").click({ force: true }),
    );
    expect(scan.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    await page.locator("#backToDash").click();
    const textTool = await openTool(page, "pdf-to-text", "pdf-to-text");
    await textTool
      .locator("#fileInput")
      .setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: scan.bytes });
    await expect(textTool.locator("#mainLayout")).toBeVisible();
    await expect(textTool.locator("#ocrToggle")).toBeChecked();
    await textTool.locator("#convertBtn").click();

    const message = await expectSuccessDialog(page, 180_000);
    expect(message, "OCR should have run on the scanned page").toContain("OCR applied to page 1");

    const saved = await downloadFrom(page, () => textTool.locator("#downloadLink").click());
    // OCR may differ in case and spacing; compare letters only.
    const recognised = saved.bytes
      .toString("utf8")
      .toUpperCase()
      .replace(/[^A-Z]+/g, " ");
    for (const word of OCR_WORDS) expect(recognised).toContain(word);
  });

  test("PDF editor embeds an added image when saving", async ({ page }) => {
    const tool = await openTool(page, "edit", "pdf-editor");
    await tool.locator("#fileInput").setInputFiles(textPdfFile());
    await expect(tool.locator("#editorInterface")).toBeVisible();
    await expect(tool.locator("#statusText")).toHaveText("Ready", { timeout: 60_000 });
    await expect(tool.locator(".pdf-page-wrapper")).toHaveCount(1);

    const chooser = page.waitForEvent("filechooser");
    await tool.locator("#addImageBtn").click();
    await (await chooser).setFiles({ name: "photo.png", mimeType: "image/png", buffer: photoPng });
    await expect(tool.locator(".annotation-image:not([data-extracted])")).toHaveCount(1);

    const saved = await downloadFrom(page, () => tool.locator("#saveBtn").click());
    expect(saved.name).toMatch(/_edited\.pdf$/);
    expect(saved.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(saved.bytes.toString("latin1")).toMatch(/\/Subtype\s*\/Image/);
    expect(saved.bytes.length).toBeGreaterThan(TEXT_PDF.length + photoPng.length / 2);
  });

  test("PDF to Image renders pages and downloads a ZIP", async ({ page }) => {
    const tool = await openTool(page, "pdf-to-img", "pdf-to-image");
    await tool.locator("#fileInput").setInputFiles(textPdfFile());
    await expect(tool.locator("#thumbnailGrid .page-item")).toHaveCount(1);
    await tool.locator("#convertBtn").click();
    await expectSuccessDialog(page);

    const saved = await downloadFrom(page, () => tool.locator("#downloadLink").click());
    expect(saved.name).toMatch(/\.zip$/);
    expect(saved.bytes.subarray(0, 4).toString("latin1")).toBe("PK\x03\x04");
    expect(saved.bytes.toString("latin1")).toContain("csp-text_page_1.png");
  });
});
