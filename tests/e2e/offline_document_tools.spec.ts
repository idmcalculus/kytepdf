import { expect, test } from "@playwright/test";

/**
 * After the app shell and static assets load, document tools must not open
 * conversion-gateway network requests. Auth endpoints under *.kytepdf.com are
 * allowed only for account flows; conversion tools stay browser-local.
 */
test.describe("local-only document tools", () => {
  test("dashboard loads without conversion-gateway calls", async ({ page }) => {
    const external = new Set<string>();

    page.on("request", (req) => {
      const url = req.url();
      // Ignore same-origin app assets and vite HMR.
      if (url.includes("127.0.0.1") || url.includes("localhost")) return;
      if (url.startsWith("data:") || url.startsWith("blob:")) return;
      // Fonts are allowed by CSP.
      if (url.includes("fonts.googleapis.com") || url.includes("fonts.gstatic.com")) return;
      external.add(url);
    });

    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Kyte", { timeout: 15_000 });

    // Active local conversion tools are present and not cloud-gated.
    await expect(page.locator('.tool-card[data-id="pdf-to-word"]')).not.toHaveClass(/coming-soon/);
    await expect(page.locator('.tool-card[data-id="pdf-to-excel"]')).not.toHaveClass(/coming-soon/);
    await expect(page.locator('.tool-card[data-id="pdf-to-text"]')).not.toHaveClass(/coming-soon/);
    await expect(page.locator('.tool-card[data-id="office-to-markdown"]')).not.toHaveClass(
      /coming-soon/,
    );
    await expect(page.locator(".cloud-badge")).toHaveCount(0);
    await expect(page.locator("cloud-consent-modal")).toHaveCount(0);

    const forbidden = [...external].filter(
      (u) =>
        /cloudconvert|cloud-gateway|api\.cloud|convert\.kyte|gateway/i.test(u) ||
        u.includes("VITE_CLOUD"),
    );
    expect(forbidden, `unexpected conversion network calls: ${forbidden.join(", ")}`).toEqual([]);
  });

  test("PDF to Word tool has no cloud mode UI", async ({ page }) => {
    await page.goto("/");
    await page.locator('.tool-card[data-id="pdf-to-word"]').click();
    await expect(page.locator("h1")).toContainText("PDF to Word");
    await expect(page.locator("#modeCloudBtn")).toHaveCount(0);
    await expect(page.locator("#tryCloudBtn")).toHaveCount(0);
    await expect(page.locator("#convertLabel")).toHaveText("Start Local Conversion");
  });

  test("Office to Markdown tool is local-only", async ({ page }) => {
    await page.goto("/");
    await page.locator('.tool-card[data-id="office-to-markdown"]').click();
    await expect(page.locator("h1")).toContainText("Office to Markdown");
    await expect(page.locator("#modeCloudBtn")).toHaveCount(0);
    const accept = await page.locator("#fileInput").getAttribute("accept");
    // Compare exact comma-separated tokens rather than raw substrings —
    // ".xlsx" contains ".xls", so a naive `.not.toContain(".xls")` on the
    // raw string rejects the supported ".xlsx" extension too.
    const acceptTokens = (accept ?? "").split(",").map((token) => token.trim());
    expect(acceptTokens).toContain(".docx");
    expect(acceptTokens).toContain(".xlsx");
    expect(acceptTokens).not.toContain(".html");
    expect(acceptTokens).not.toContain(".xls");
  });
});
