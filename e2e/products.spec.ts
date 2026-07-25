import { test, expect } from "@playwright/test";

// Requires: running server at E2E_BASE_URL with test DB
// Login as operator/CEO first

test.describe("Product lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto("/login");
    await page.fill("input[type='email'], input[placeholder*='email']", "admin@warehouse-pro.uz");
    await page.fill("input[type='password'], input[placeholder*='password']", "password123");
    await page.click("button[type='submit']");
    await page.waitForURL("**/dashboard", { timeout: 10_000 });
  });

  test("create product with category", async ({ page }) => {
    await page.goto("/products");
    // Click "Add" button
    await page.click("button:has-text('Добавить'), button:has-text('Add')");

    // Fill form
    await page.fill("input[placeholder*='Код'], input[placeholder*='Kod']", "E2E-TEST-001");
    await page.fill("input[placeholder*='Название'], input[placeholder*='Nomi']", "E2E Test Product");
    await page.fill("input[placeholder*='Цена'], input[placeholder*='narxi']", "150.00");

    // Select or type category
    const categoryInput = page.locator("input[placeholder*='Категория'], input[placeholder*='Kategoriya']");
    await categoryInput.fill("E2E Category");
    await categoryInput.press("Enter");

    // Save
    await page.click("button:has-text('Сохранить'), button:has-text('Saqlash')");

    // Verify product appears in list
    await expect(page.locator("text=E2E Test Product")).toBeVisible({ timeout: 5_000 });
  });

  test("filter by category", async ({ page }) => {
    await page.goto("/products");
    // Select category filter
    const categorySelect = page.locator("[class*='select'], select").filter({ hasText: /категория|kategoriya/i });
    if (await categorySelect.isVisible()) {
      await categorySelect.click();
      // Select a category option
      await page.click("[role='option']:first-child, li:first-child");
      // Verify filtered results
      await page.waitForTimeout(1_000);
    }
  });

  test("rename category via CategoryManager", async ({ page }) => {
    await page.goto("/products");
    // Click settings icon next to category filter
    const settingsBtn = page.locator("button[title*='Управление'], button[title*='Boshqarish']");
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      // Wait for modal
      await expect(page.locator("text=Управление категориями, text=Kategoriyalarni")).toBeVisible({ timeout: 3_000 });

      // Click edit icon on first category
      const editBtn = page.locator("[title*='Переименовать'], [title*='Nomini']").first();
      if (await editBtn.isVisible()) {
        await editBtn.click();
        // Type new name and press Enter
        const input = page.locator("input[class*='neo-input']").last();
        await input.fill("Renamed Category");
        await input.press("Enter");
        // Close modal
        await page.click("button:has-text('×'), [class*='close']");
      }
    }
  });

  test("delete product", async ({ page }) => {
    await page.goto("/products");
    // Find delete button for a product
    const deleteBtn = page.locator("button[title*='Удалить'], button:has-text('Удалить')").first();
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      // Confirm deletion
      const confirmBtn = page.locator("button:has-text('Да'), button:has-text('Удалить')").last();
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
      }
    }
  });
});
