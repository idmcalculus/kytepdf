import { expect, test } from "@playwright/test";

test.describe("KytePDF E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display the dashboard and tools", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Kyte" })).toBeVisible();
    await expect(page.locator(".tool-card")).toHaveCount(16);
  });

  test("should navigate to Compress tool", async ({ page }) => {
    await page.click('.tool-card[data-id="compress"]');
    await expect(page.getByRole("heading", { name: "Compress PDF" })).toBeVisible();
  });

  test("should handle back to dashboard navigation", async ({ page }) => {
    await page.click('.tool-card[data-id="compress"]');
    await page.click("#backToDash");
    await expect(page.locator(".dashboard-grid")).toBeVisible();
  });

  test("should show about dialog", async ({ page }) => {
    await page.click("#aboutBtn");
    await expect(page.locator("#aboutOverlay")).toBeVisible();
    await expect(page.locator("#aboutOverlay")).toContainText("About KytePDF");
  });
});
