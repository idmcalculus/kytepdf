import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// A 1 × 1 PNG, small enough to keep inline.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);
const CSV_FILE = {
  name: "budget.csv",
  mimeType: "text/csv",
  buffer: Buffer.from("Item,Cost\nTrain,42\nHotel,120\n"),
};
const PREVIEW_READY = /^\d+ pages? · kyte-document\.pdf$/;

async function openOwnContent(page: Page) {
  await page.goto("/");
  await page.locator('.tool-card[data-id="create-pdf"]').click();
  await expect(page.locator("h1")).toContainText("Create PDF");
  await page.locator('[data-mode="sources"]').click();
  await expect(page.locator("creator-sources-panel textarea")).toBeVisible();
}

/** Creates the PDF, closes the success dialog and returns the downloaded file. */
async function createAndDownload(page: Page) {
  const createButton = page.locator("#createPdfBtn");
  await expect(createButton).toBeEnabled();
  await createButton.click();

  await expect(page.locator("#kyteOverlay")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#kyteTitle")).toHaveText("Success!");
  await page.locator("#kyteConfirmBtn").click();
  await expect(page.locator("#successDetails")).toContainText("Your own content created with");

  const downloadEvent = page.waitForEvent("download");
  await page.locator("#downloadLink").click();
  const download = await downloadEvent;
  const bytes = await readFile(await download.path());
  return { download, bytes };
}

test.describe("Create PDF from your own content", () => {
  // The tests share one dev server; see the warm-up below.
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }, testInfo) => {
    // In the dev server, the first document conversion makes Vite bundle the
    // converter's dependencies and then reload the page. Convert a file once
    // here so the tests below start with those dependencies ready. Production
    // builds have nothing to discover.
    testInfo.setTimeout(180_000);
    const page = await browser.newPage({ baseURL: testInfo.project.use.baseURL });
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await openOwnContent(page);
        let reloaded = false;
        const onNavigate = () => {
          reloaded = true;
        };
        page.on("framenavigated", onNavigate);
        await page.locator("creator-sources-panel input[type=file]").setInputFiles(CSV_FILE);
        const built = await expect(page.locator("#previewMetaText"))
          .toHaveText(PREVIEW_READY, { timeout: 45_000 })
          .then(() => true)
          .catch(() => false);
        // Give a reload that was already on its way time to arrive.
        await page.waitForTimeout(1_000);
        page.off("framenavigated", onNavigate);
        if (built && !reloaded) break;
      }
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({ page }) => {
    // Vite reloads open pages whenever a source file changes. Answer its live
    // reload socket here instead, so an edit made elsewhere in the checkout
    // while a test runs cannot reload the page under it.
    await page.routeWebSocket(/^wss?:\/\/(127\.0\.0\.1|localhost):\d+\//, () => {});

    // Chrome's native save dialog cannot be driven from a test. Without it the
    // app falls back to an ordinary download link, which Playwright can catch.
    await page.addInitScript(() => {
      delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
      delete (Window.prototype as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    });
    await openOwnContent(page);
    await expect(page.locator("#createPdfBtn")).toBeDisabled();
  });

  test("turns typed text into a downloadable PDF", async ({ page }) => {
    await page
      .locator("creator-sources-panel textarea")
      .fill("# Trip notes\n\nPack **light** and leave early.\n\n- Passport\n- Tickets");

    await expect(page.locator("#previewMetaText")).toHaveText("1 page · kyte-document.pdf", {
      timeout: 60_000,
    });
    const { download, bytes } = await createAndDownload(page);

    expect(download.suggestedFilename()).toBe("kyte-document.pdf");
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  test("turns an added image into a downloadable PDF", async ({ page }) => {
    await page.locator("creator-sources-panel input[type=file]").setInputFiles({
      name: "dot.png",
      mimeType: "image/png",
      buffer: PNG_BYTES,
    });

    await expect(page.locator("creator-sources-panel .creator-sources-item")).toHaveCount(1);
    await expect(page.locator("#previewMetaText")).toHaveText("1 page · kyte-document.pdf", {
      timeout: 60_000,
    });
    const { bytes } = await createAndDownload(page);

    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  test("turns an added CSV file into a downloadable PDF", async ({ page }) => {
    await page.locator("creator-sources-panel input[type=file]").setInputFiles(CSV_FILE);

    await expect(page.locator("creator-sources-panel .creator-sources-item")).toHaveCount(1);
    await expect(page.locator("#previewMetaText")).toHaveText(PREVIEW_READY, { timeout: 60_000 });
    const { bytes } = await createAndDownload(page);

    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    test(`keeps the success text and Download button uncovered at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openOwnContent(page);
      await expect(page.locator("#floatingPreview")).toHaveCount(viewport.width >= 1280 ? 1 : 0);
      await page.locator("creator-sources-panel textarea").fill("Short note");
      await expect(page.locator("#previewMetaText")).toHaveText("1 page · kyte-document.pdf", {
        timeout: 60_000,
      });
      await page.locator("#createPdfBtn").click();
      await page.locator("#kyteConfirmBtn").click();
      await expect(page.locator("#successMessage")).toBeVisible();

      for (const selector of ["#successTitle", "#successDetails", "#downloadLink"]) {
        await page
          .locator(selector)
          .evaluate((element) => element.scrollIntoView({ block: "center" }));
        const report = await page.locator(selector).evaluate((element) => {
          const box = element.getBoundingClientRect();
          const preview = document.querySelector("#floatingPreview")?.getBoundingClientRect();
          const overlaps =
            !!preview &&
            box.left < preview.right &&
            preview.left < box.right &&
            box.top < preview.bottom &&
            preview.top < box.bottom;
          // Every sampled point across the element must hit the element itself.
          const covered: string[] = [];
          for (const fx of [0.02, 0.5, 0.98]) {
            for (const fy of [0.25, 0.75]) {
              const hit = document.elementFromPoint(
                box.left + box.width * fx,
                box.top + box.height * fy,
              );
              if (!hit || !(hit === element || element.contains(hit))) {
                covered.push(`${fx},${fy}:${hit?.tagName}#${hit?.id}`);
              }
            }
          }
          return { overlaps, covered };
        });
        expect({ selector, ...report }).toEqual({ selector, overlaps: false, covered: [] });
      }
    });
  }
});
