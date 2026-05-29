import { expect, test } from "@playwright/test";

test.describe("Authentication Flow (Mocked)", () => {
  test.beforeEach(async ({ page }) => {
    // Mock the Auth API
    await page.route("**/auth/me", async (route) => {
      // Unauthenticated initially
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Unauthorized" }),
      });
    });

    await page.route("**/auth/csrf", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "Set-Cookie": "fortress_csrf=mock-csrf; Path=/",
        },
        body: JSON.stringify({ success: true, data: { csrfToken: "mock-csrf" } }),
      });
    });

    await page.route("**/auth/login", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            user: {
              id: "1",
              email: "test@example.com",
              emailVerified: true,
              createdAt: new Date().toISOString(),
            },
            token: "mock-token",
          },
        }),
      });
    });

    await page.route("**/auth/signup", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            user: {
              id: "2",
              email: "new@example.com",
              emailVerified: false,
              createdAt: new Date().toISOString(),
            },
            token: "mock-token",
          },
        }),
      });
    });

    await page.route("**/auth/request-password-reset", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { requested: true } }),
      });
    });
  });

  test("can open modal and perform login", async ({ page }) => {
    await page.goto("/");

    // Click the Account button in the header
    await page.click("#userAccountBtn");

    // Ensure the modal is open
    const modal = page.locator("account-modal");
    await expect(modal).toBeVisible();

    // After a successful login the store calls getMe again to refresh the user.
    // Update the /auth/me mock so it returns the authenticated user from this
    // point forward, otherwise the store would immediately log the user back out.
    await page.route("**/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            user: {
              id: "1",
              email: "test@example.com",
              emailVerified: true,
              createdAt: new Date().toISOString(),
            },
          },
        }),
      });
    });

    // Fill in credentials
    await page.fill('account-modal input[name="email"]', "test@example.com");
    await page.fill('account-modal input[name="password"]', "password");
    await page.click('account-modal button[type="submit"]');

    // After successful login the modal should close.
    await expect(modal).not.toBeVisible();
  });

  test("transitions from loading state to login form when auth init is slow", async ({ page }) => {
    let finishAuthInit: () => void;
    const authInitCanFinish = new Promise<void>((resolve) => {
      finishAuthInit = resolve;
    });

    await page.route("**/auth/me", async (route) => {
      await authInitCanFinish;
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Unauthorized" }),
      });
    });

    await page.goto("/");
    await page.click("#userAccountBtn");

    await expect(page.locator("account-modal .account-loading")).toBeVisible();
    finishAuthInit!();
    await expect(page.locator('account-modal input[name="email"]')).toBeVisible();
  });

  test("can switch to signup and create account", async ({ page }) => {
    await page.goto("/");
    await page.click("#userAccountBtn");

    // Switch to Signup tab
    await page.click("#tabSignup");
    await expect(page.locator('account-modal button[type="submit"]')).toHaveText(/Create account/);

    await page.fill('account-modal input[name="email"]', "new@example.com");
    await page.fill('account-modal input[name="password"]', "securepass");
    await page.click('account-modal button[type="submit"]');

    await expect(page.locator("account-modal .account-alert.success")).toBeVisible();
  });

  test("can request password reset", async ({ page }) => {
    await page.goto("/");
    await page.click("#userAccountBtn");

    // Click "Forgot your password?"
    await page.click("#forgotLink");
    await expect(page.locator('account-modal button[type="submit"]')).toHaveText(/Send reset link/);

    await page.fill('account-modal input[name="email"]', "test@example.com");
    await page.click('account-modal button[type="submit"]');

    // Success message should appear
    await expect(page.locator("account-modal .account-alert.success")).toBeVisible();
  });
});

test.describe("Auth Form Validation (Mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/auth/me", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Unauthorized" }),
      });
    });

    await page.route("**/auth/csrf", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { csrfToken: "mock-csrf" } }),
      });
    });

    await page.route("**/auth/login", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            user: {
              id: "1",
              email: "test@example.com",
              emailVerified: true,
              createdAt: new Date().toISOString(),
            },
          },
        }),
      });
    });

    await page.route("**/auth/signup", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            user: {
              id: "2",
              email: "new@example.com",
              emailVerified: false,
              createdAt: new Date().toISOString(),
            },
          },
        }),
      });
    });

    await page.route("**/auth/reset-password", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: {} }),
      });
    });
  });

  test("invalid email blocks login request", async ({ page }) => {
    let loginCalled = false;
    await page.route("**/auth/login", async (route) => {
      loginCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { user: { id: "1" } } }),
      });
    });

    await page.goto("/");
    await page.click("#userAccountBtn");

    // Wait for form to appear
    await expect(page.locator('account-modal input[name="email"]')).toBeVisible();

    await page.fill('account-modal input[name="email"]', "not-an-email");
    await page.fill('account-modal input[name="password"]', "password");
    await page.click('account-modal button[type="submit"]');

    // Should show inline error, not call API
    await expect(page.locator("account-modal .field-error")).toBeVisible();
    await expect(page.locator("account-modal .field-error")).toHaveText(/valid email/);

    // Modal stays open — no login occurred
    await expect(page.locator("account-modal")).toBeVisible();
    expect(loginCalled).toBe(false);
  });

  test("weak signup password blocks signup request", async ({ page }) => {
    let signupCalled = false;
    await page.route("**/auth/signup", async (route) => {
      signupCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { user: { id: "2" } } }),
      });
    });

    await page.goto("/");
    await page.click("#userAccountBtn");
    await page.click("#tabSignup");

    await page.fill('account-modal input[name="email"]', "user@example.com");
    await page.fill('account-modal input[name="password"]', "short");
    await page.click('account-modal button[type="submit"]');

    await expect(page.locator("account-modal .field-error")).toBeVisible();
    await expect(page.locator("account-modal .field-error")).toHaveText(/at least 8/);

    // No success message — signup did not fire
    await expect(page.locator("account-modal .account-alert.success")).not.toBeVisible();
    expect(signupCalled).toBe(false);
  });

  test("valid signup still succeeds", async ({ page }) => {
    await page.goto("/");
    await page.click("#userAccountBtn");
    await page.click("#tabSignup");

    await page.fill('account-modal input[name="email"]', "new@example.com");
    await page.fill('account-modal input[name="password"]', "securepass123");
    await page.click('account-modal button[type="submit"]');

    await expect(page.locator("account-modal .account-alert.success")).toBeVisible();
  });

  test("reset password validates new password before request", async ({ page }) => {
    let resetCalled = false;
    await page.route("**/auth/reset-password", async (route) => {
      resetCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: {} }),
      });
    });

    // Use the real deep-link route that production uses
    await page.goto("/reset-password?token=valid-token-123");

    // The app bootstrap should detect the route and open the modal automatically.
    // Wait for the new-password field to appear.
    await expect(page.locator('account-modal input[name="newPassword"]')).toBeVisible({
      timeout: 5000,
    });

    // Try a short password
    await page.fill('account-modal input[name="newPassword"]', "abc");
    await page.click('account-modal button[type="submit"]');

    await expect(page.locator("account-modal .field-error")).toBeVisible();
    await expect(page.locator("account-modal .field-error")).toHaveText(/at least 8/);
    expect(resetCalled).toBe(false);
  });
});
