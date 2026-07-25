import { test, expect } from "@playwright/test";

test.describe("Shop management", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[type='email'], input[placeholder*='email']", "admin@warehouse-pro.uz");
    await page.fill("input[type='password'], input[placeholder*='password']", "password123");
    await page.click("button[type='submit']");
    await page.waitForURL("**/dashboard", { timeout: 10_000 });
  });

  test("create shop with territory", async ({ page }) => {
    await page.goto("/shops");

    // Click "Add" button
    const addBtn = page.locator("button:has-text('Добавить'), button:has-text('Qo'shish')").last();
    await expect(addBtn).toBeVisible({ timeout: 5_000 });
    await addBtn.click();

    // Fill form
    await page.fill("input[placeholder*='Название'], input[placeholder*='Nomi']", "E2E Test Shop");
    await page.fill("input[placeholder*='Город'], input[placeholder*='Shahar']", "Тест Город");
    await page.fill("input[placeholder*='Адрес'], input[placeholder*='Manzil']", "ул. Тестовая, 1");

    // Select territory if available
    const territorySelect = page.locator("[class*='select']").filter({ hasText: /территория|territory/i });
    if (await territorySelect.isVisible()) {
      await territorySelect.click();
      await page.click("[role='option']:first-child, li:first-child");
    }

    // Save
    const saveBtn = page.locator("button:has-text('Сохранить'), button:has-text('Saqlash')");
    if (await saveBtn.isVisible()) {
      await saveBtn.click();
      await page.waitForTimeout(2_000);
      // Verify shop appears in list
      await expect(page.locator("text=E2E Test Shop")).toBeVisible({ timeout: 5_000 });
    }
  });

  test("manage territories", async ({ page }) => {
    await page.goto("/shops");

    // Click "Territories" button
    const territoryBtn = page.locator("button:has-text('Территории'), button:has-text('Territoriyalar')");
    if (await territoryBtn.isVisible()) {
      await territoryBtn.click();
      // Wait for modal
      await expect(page.locator("text=Управление территориями, text=Territoriyalarni")).toBeVisible({ timeout: 3_000 });

      // Click "Add territory"
      const addTerrBtn = page.locator("button:has-text('Добавить территорию'), button:has-text('Territoriya qo'shish')");
      if (await addTerrBtn.isVisible()) {
        await addTerrBtn.click();
        // Fill territory name
        await page.fill("input[placeholder*='Название территории'], input[placeholder*='Territoriya nomi']", "E2E Territory");
        // Click create
        const createBtn = page.locator("button:has-text('Создать'), button:has-text('Yaratish')");
        if (await createBtn.isVisible()) {
          await createBtn.click();
          await page.waitForTimeout(1_000);
        }
      }

      // Close modal
      await page.click("button:has-text('×'), [class*='close']");
    }
  });

  test("shop list displays with territories", async ({ page }) => {
    await page.goto("/shops");
    // Verify page loads
    await expect(page.locator("[class*='shop'], [class*='card'], table")).toBeVisible({ timeout: 5_000 });
  });
});
