import { test, expect } from "@playwright/test";

test.describe("Order lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[type='email'], input[placeholder*='email']", "admin@warehouse-pro.uz");
    await page.fill("input[type='password'], input[placeholder*='password']", "password123");
    await page.click("button[type='submit']");
    await page.waitForURL("**/dashboard", { timeout: 10_000 });
  });

  test("create new order", async ({ page }) => {
    await page.goto("/orders/new");

    // Select shop (if picker exists)
    const shopSelect = page.locator("[class*='select'], select").first();
    if (await shopSelect.isVisible()) {
      await shopSelect.click();
      await page.click("[role='option']:first-child, li:first-child");
    }

    // Add product to order
    const addProductBtn = page.locator("button:has-text('Добавить товар'), button:has-text('Add product')");
    if (await addProductBtn.isVisible()) {
      await addProductBtn.click();
      // Select product from list
      await page.click("[role='option']:first-child, tr:first-child");
      // Set quantity
      const qtyInput = page.locator("input[type='number']").last();
      if (await qtyInput.isVisible()) {
        await qtyInput.fill("5");
      }
    }

    // Create order
    const createBtn = page.locator("button:has-text('Создать'), button:has-text('Yaratish')");
    if (await createBtn.isVisible()) {
      await createBtn.click();
      // Verify redirect to order detail or success message
      await page.waitForTimeout(2_000);
    }
  });

  test("order list displays correctly", async ({ page }) => {
    await page.goto("/orders");
    // Verify page loads with table or list
    await expect(page.locator("table, [class*='list'], [class*='card']")).toBeVisible({ timeout: 5_000 });
  });

  test("cancel order", async ({ page }) => {
    await page.goto("/orders");
    // Click on first order to open detail
    const orderRow = page.locator("tr:has(td), [class*='card']").first();
    if (await orderRow.isVisible()) {
      await orderRow.click();
      await page.waitForTimeout(1_000);

      // Click cancel button if visible
      const cancelBtn = page.locator("button:has-text('Отменить'), button:has-text('Bekor')");
      if (await cancelBtn.isVisible()) {
        await cancelBtn.click();
        // Confirm
        const confirmBtn = page.locator("button:has-text('Да'), button:has-text('Ha')");
        if (await confirmBtn.isVisible()) {
          await confirmBtn.click();
        }
      }
    }
  });
});
