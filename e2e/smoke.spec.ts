import { test, expect } from "@playwright/test";

test("landing page loads", async ({ page }) => {
  await page.goto("/landing");
  await expect(page).toHaveTitle(/Warehouse/);
});

test("login page loads", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("input[type='email'], input[placeholder*='email'], input[name='email']")).toBeVisible();
});
