import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[type='email'], input[placeholder*='email']", "admin@warehouse-pro.uz");
    await page.fill("input[type='password'], input[placeholder*='password']", "password123");
    await page.click("button[type='submit']");
    await page.waitForURL("**/dashboard", { timeout: 10_000 });
  });

  test("dashboard loads with KPI cards", async ({ page }) => {
    // Verify dashboard page loaded
    await expect(page.locator("[class*='dashboard'], [class*='kpi'], [class*='card']")).toBeVisible({ timeout: 5_000 });
  });

  test("dashboard shows revenue data", async ({ page }) => {
    // Wait for data to load
    await page.waitForTimeout(2_000);
    // Check that numeric data is displayed (not loading spinners)
    const hasNumbers = await page.locator("text=/\\d+/").first().isVisible();
    expect(hasNumbers).toBeTruthy();
  });

  test("navigation to all major sections works", async ({ page }) => {
    const sections = [
      { href: "/products", name: "Товары" },
      { href: "/orders", name: "Заказы" },
      { href: "/shops", name: "Магазины" },
      { href: "/arrivals", name: "Приходы" },
    ];

    for (const section of sections) {
      await page.goto(section.href);
      // Verify page loads (no crash)
      await page.waitForTimeout(1_000);
      const hasContent = await page.locator("h1, h2, [class*='card'], table, [class*='list']").first().isVisible();
      expect(hasContent, `Section ${section.href} should load`).toBeTruthy();
    }
  });
});
