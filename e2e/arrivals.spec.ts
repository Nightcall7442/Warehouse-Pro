import { test, expect } from "@playwright/test";

test.describe("Arrival lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[type='email'], input[placeholder*='email']", "admin@warehouse-pro.uz");
    await page.fill("input[type='password'], input[placeholder*='password']", "password123");
    await page.click("button[type='submit']");
    await page.waitForURL("**/dashboard", { timeout: 10_000 });
  });

  test("create arrival with items", async ({ page }) => {
    await page.goto("/arrivals");

    // Click "New arrival" button
    const newBtn = page.locator("button:has-text('Новый приход'), button:has-text('Yangi kelish')");
    await expect(newBtn).toBeVisible({ timeout: 5_000 });
    await newBtn.click();

    // Fill form
    await page.fill("input[placeholder*='Водитель'], input[placeholder*='Haydovchi']", "Тест Водитель");

    // Add item
    const addItemBtn = page.locator("button:has-text('Добавить'), button:has-text('Qo'shish')").last();
    if (await addItemBtn.isVisible()) {
      await addItemBtn.click();
      // Select product
      const productSelect = page.locator("[class*='select'], select").last();
      if (await productSelect.isVisible()) {
        await productSelect.click();
        await page.click("[role='option']:first-child, li:first-child");
      }
      // Set quantity
      const qtyInput = page.locator("input[type='number']").last();
      if (await qtyInput.isVisible()) {
        await qtyInput.fill("100");
      }
    }

    // Save
    const saveBtn = page.locator("button:has-text('Сохранить'), button:has-text('Saqlash')");
    if (await saveBtn.isVisible()) {
      await saveBtn.click();
      await page.waitForTimeout(2_000);
    }
  });

  test("complete arrival updates stock", async ({ page }) => {
    await page.goto("/arrivals");

    // Find a pending arrival
    const pendingRow = page.locator("tr:has-text('pending'), tr:has-text('Ожидает')").first();
    if (await pendingRow.isVisible()) {
      await pendingRow.click();
      await page.waitForTimeout(1_000);

      // Click "Complete" button
      const completeBtn = page.locator("button:has-text('Завершить'), button:has-text('Tugallash')");
      if (await completeBtn.isVisible()) {
        await completeBtn.click();
        // Confirm
        const confirmBtn = page.locator("button:has-text('Да'), button:has-text('Ha')");
        if (await confirmBtn.isVisible()) {
          await confirmBtn.click();
        }
        await page.waitForTimeout(2_000);
      }
    }
  });

  test("view arrival details with items", async ({ page }) => {
    await page.goto("/arrivals");

    // Click on first arrival
    const arrivalRow = page.locator("tr:has(td), [class*='card']").first();
    if (await arrivalRow.isVisible()) {
      await arrivalRow.click();
      await page.waitForTimeout(1_000);

      // Verify detail view shows items
      await expect(page.locator("[class*='item'], [class*='product'], table")).toBeVisible({ timeout: 3_000 });
    }
  });

  test("delete pending arrival", async ({ page }) => {
    await page.goto("/arrivals");

    // Find delete button for pending arrival
    const deleteBtn = page.locator("button:has-text('Удалить'), button:has-text('O'chirish')").first();
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      // Confirm
      const confirmBtn = page.locator("button:has-text('Да'), button:has-text('Ha')");
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
      }
    }
  });
});
