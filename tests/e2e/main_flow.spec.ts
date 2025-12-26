import { test, expect } from '@playwright/test';

test.describe('KytePDF E2E', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
	});

	test('should display the dashboard and tools', async ({ page }) => {
		await expect(page.locator('h1')).toContainText('Kyte');
		await expect(page.locator('.tool-card')).toHaveCount(15);
	});

	test('should navigate to Compress tool', async ({ page }) => {
		await page.click('.tool-card[data-id="compress"]');
		await expect(page.locator('h2')).toContainText('Compress PDF');
	});

	test('should handle back to dashboard navigation', async ({ page }) => {
		await page.click('.tool-card[data-id="compress"]');
		await page.click('#backToDash');
		await expect(page.locator('.dashboard-grid')).toBeVisible();
	});

	test('should show account dialog', async ({ page }) => {
		await page.click('#userAccountBtn');
		await expect(page.locator('#globalDialog')).toBeVisible();
		await expect(page.locator('#globalDialog')).toContainText('User Account');
	});
});
