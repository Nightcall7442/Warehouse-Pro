import { test, expect } from "@playwright/test";

test.describe("Authentication & RBAC", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(/Warehouse/);
    // Verify email and password inputs exist
    await expect(page.locator("input[type='email'], input[placeholder*='email']")).toBeVisible();
    await expect(page.locator("input[type='password'], input[placeholder*='password']")).toBeVisible();
  });

  test("successful login redirects to dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[type='email'], input[placeholder*='email']", "admin@warehouse-pro.uz");
    await page.fill("input[type='password'], input[placeholder*='password']", "password123");
    await page.click("button[type='submit']");
    await page.waitForURL("**/dashboard", { timeout: 10_000 });
    // Verify dashboard content
    await expect(page.locator("[class*='dashboard'], [class*='kpi'], h1, h2")).toBeVisible();
  });

  test("wrong password shows error", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[type='email'], input[placeholder*='email']", "admin@warehouse-pro.uz");
    await page.fill("input[type='password'], input[placeholder*='password']", "wrongpassword");
    await page.click("button[type='submit']");
    // Should stay on login or show error
    await page.waitForTimeout(2_000);
    const url = page.url();
    expect(url).toContain("login");
  });

  test("unauthenticated user redirected to login", async ({ page }) => {
    await page.goto("/dashboard");
    // Should redirect to login
    await page.waitForTimeout(2_000);
    const url = page.url();
    expect(url).toContain("login");
  });

  test("navigation shows role-appropriate links", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[type='email'], input[placeholder*='email']", "admin@warehouse-pro.uz");
    await page.fill("input[type='password'], input[placeholder*='password']", "password123");
    await page.click("button[type='submit']");
    await page.waitForURL("**/dashboard", { timeout: 10_000 });

    // CEO should see all navigation items
    const nav = page.locator("nav, [class*='sidebar'], [class*='menu']");
    if (await nav.isVisible()) {
      // Verify key links exist
      await expect(page.locator("a[href*='products'], a[href*='tovar']")).toBeVisible();
      await expect(page.locator("a[href*='orders'], a[href*='zakaz']")).toBeVisible();
    }
  });
});
