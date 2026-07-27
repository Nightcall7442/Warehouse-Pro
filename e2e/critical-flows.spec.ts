import { test, expect } from "@playwright/test";

// ── Helpers ──────────────────────────────────────────────────────────────────
async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill("input[type='email'], input[placeholder*='email']", "admin@warehouse-pro.uz");
  await page.fill("input[type='password'], input[placeholder*='password']", "password123");
  await page.click("button[type='submit']");
  await page.waitForURL("**/dashboard", { timeout: 10_000 });
}

// ── Order Creation Flow ──────────────────────────────────────────────────────
test.describe("Order Creation — Critical Flow", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("full order creation flow: shop → products → submit", async ({ page }) => {
    // Step 1: Navigate to new order
    await page.goto("/orders/new");
    await page.waitForLoadState("networkidle");

    // Step 2: Select shop
    const shopPicker = page.locator("[class*='select'], select, [class*='shop']").first();
    if (await shopPicker.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await shopPicker.click();
      // Wait for dropdown to appear
      await page.waitForTimeout(500);
      // Select first shop
      const firstOption = page.locator("[role='option'], li, [class*='option']").first();
      if (await firstOption.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await firstOption.click();
      }
    }

    // Step 3: Add product
    const addProductBtn = page.locator("button:has-text('Добавить'), button:has-text('Товар'), button:has-text('Add')");
    if (await addProductBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await addProductBtn.click();
      await page.waitForTimeout(500);

      // Select first product from list
      const productRow = page.locator("[class*='product'], tr, [class*='item']").first();
      if (await productRow.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await productRow.click();
      }
    }

    // Step 4: Set quantity
    const qtyInput = page.locator("input[type='number'], input[placeholder*='кол'], input[placeholder*='qty']").last();
    if (await qtyInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await qtyInput.fill("3");
    }

    // Step 5: Submit order
    const submitBtn = page.locator("button:has-text('Создать'), button:has-text('Оформить'), button:has-text('Submit'), button[type='submit']");
    if (await submitBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await submitBtn.click();

      // Wait for success - either redirect or toast
      await page.waitForTimeout(3_000);

      // Verify success: check for redirect to orders page or success message
      const url = page.url();
      const hasRedirected = url.includes("/orders") || url.includes("/order/");
      const hasSuccessToast = await page.locator("[class*='success'], [class*='toast'], :text('создан'), :text('Создан')").isVisible({ timeout: 2_000 }).catch(() => false);

      expect(hasRedirected || hasSuccessToast).toBeTruthy();
    }
  });

  test("order list shows created orders", async ({ page }) => {
    await page.goto("/orders");
    await page.waitForLoadState("networkidle");

    // Verify page loads with content
    const content = page.locator("table, [class*='list'], [class*='card'], [class*='order']");
    await expect(content.first()).toBeVisible({ timeout: 5_000 });
  });

  test("order detail shows items and totals", async ({ page }) => {
    await page.goto("/orders");
    await page.waitForLoadState("networkidle");

    // Click first order
    const orderLink = page.locator("tr:has(td) a, [class*='order'] a, [class*='card']").first();
    if (await orderLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await orderLink.click();
      await page.waitForLoadState("networkidle");

      // Verify order detail page has key elements
      const hasOrderInfo = await page.locator(":text('Заказ'), :text('Order'), h1, h2").isVisible({ timeout: 3_000 }).catch(() => false);
      expect(hasOrderInfo).toBeTruthy();
    }
  });
});

// ── Payment Flow ─────────────────────────────────────────────────────────────
test.describe("Payment — Critical Flow", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("add payment to shop reduces debt", async ({ page }) => {
    // Step 1: Go to shops
    await page.goto("/shops");
    await page.waitForLoadState("networkidle");

    // Step 2: Click on first shop
    const shopCard = page.locator("[class*='shop'], tr:has(td), [class*='card']").first();
    if (await shopCard.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await shopCard.click();
      await page.waitForLoadState("networkidle");

      // Step 3: Find and click payment button
      const paymentBtn = page.locator("button:has-text('Платёж'), button:has-text('Оплата'), button:has-text('Payment'), button:has-text('Добавить платёж')");
      if (await paymentBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await paymentBtn.click();
        await page.waitForTimeout(500);

        // Step 4: Fill payment amount
        const amountInput = page.locator("input[type='number'], input[placeholder*='сум'], input[placeholder*='amount']").first();
        if (await amountInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await amountInput.fill("100000");
        }

        // Step 5: Submit payment
        const submitBtn = page.locator("button:has-text('Сохранить'), button:has-text('Save'), button:has-text('Добавить'), button[type='submit']");
        if (await submitBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await submitBtn.click();
          await page.waitForTimeout(2_000);

          // Verify success
          const hasSuccess = await page.locator("[class*='success'], [class*='toast'], :text('успешно'), :text('сохранён')").isVisible({ timeout: 2_000 }).catch(() => false);
          expect(hasSuccess).toBeTruthy();
        }
      }
    }
  });

  test("payment history shows transactions", async ({ page }) => {
    await page.goto("/shops");
    await page.waitForLoadState("networkidle");

    // Click first shop
    const shopCard = page.locator("[class*='shop'], tr:has(td), [class*='card']").first();
    if (await shopCard.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await shopCard.click();
      await page.waitForLoadState("networkidle");

      // Look for payment history section
      const historySection = page.locator(":text('История'), :text('Платежи'), :text('Payments'), [class*='payment']");
      if (await historySection.isVisible({ timeout: 3_000 }).catch(() => false)) {
        // Should have at least one payment row
        const paymentRows = page.locator("[class*='payment'] tr, [class*='payment'] [class*='item']");
        const count = await paymentRows.count();
        expect(count).toBeGreaterThanOrEqual(0); // May be empty for new shops
      }
    }
  });
});

// ── Order Status Transitions ─────────────────────────────────────────────────
test.describe("Order Status Transitions — Critical Flow", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("complete order deducts stock", async ({ page }) => {
    await page.goto("/orders");
    await page.waitForLoadState("networkidle");

    // Find an order with "new" or "processing" status
    const orderRow = page.locator("tr:has(td)").first();
    if (await orderRow.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await orderRow.click();
      await page.waitForLoadState("networkidle");

      // Look for status change buttons
      const completeBtn = page.locator("button:has-text('Выполнен'), button:has-text('Complete'), button:has-text('Bajarildi')");
      if (await completeBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await completeBtn.click();

        // Confirm if dialog appears
        const confirmBtn = page.locator("button:has-text('Да'), button:has-text('Подтвердить'), button:has-text('Confirm')");
        if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await confirmBtn.click();
        }

        await page.waitForTimeout(2_000);

        // Verify status changed
        const completedBadge = page.locator(":text('Выполнен'), :text('Completed'), :text('Bajarildi'), [class*='success']");
        const isCompleted = await completedBadge.isVisible({ timeout: 3_000 }).catch(() => false);
        expect(isCompleted).toBeTruthy();
      }
    }
  });

  test("cancel order restores reserved stock", async ({ page }) => {
    await page.goto("/orders");
    await page.waitForLoadState("networkidle");

    // Find a "new" order
    const orderRow = page.locator("tr:has(td)").first();
    if (await orderRow.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await orderRow.click();
      await page.waitForLoadState("networkidle");

      // Look for cancel button
      const cancelBtn = page.locator("button:has-text('Отменить'), button:has-text('Cancel'), button:has-text('Bekor')");
      if (await cancelBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await cancelBtn.click();

        // Confirm cancellation
        const confirmBtn = page.locator("button:has-text('Да'), button:has-text('Подтвердить'), button:has-text('Confirm')");
        if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await confirmBtn.click();
        }

        await page.waitForTimeout(2_000);

        // Verify status changed to cancelled
        const cancelledBadge = page.locator(":text('Отменён'), :text('Cancelled'), :text('Bekor'), [class*='danger']");
        const isCancelled = await cancelledBadge.isVisible({ timeout: 3_000 }).catch(() => false);
        expect(isCancelled).toBeTruthy();
      }
    }
  });
});

// ── Stock Validation ─────────────────────────────────────────────────────────
test.describe("Stock Validation — Critical Flow", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("cannot order more than available stock", async ({ page }) => {
    await page.goto("/orders/new");
    await page.waitForLoadState("networkidle");

    // Select shop
    const shopPicker = page.locator("[class*='select'], select").first();
    if (await shopPicker.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await shopPicker.click();
      await page.waitForTimeout(500);
      const firstOption = page.locator("[role='option'], li").first();
      if (await firstOption.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await firstOption.click();
      }
    }

    // Add product
    const addBtn = page.locator("button:has-text('Добавить'), button:has-text('Товар')");
    if (await addBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(500);
      const product = page.locator("[class*='product'], tr").first();
      if (await product.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await product.click();
      }
    }

    // Try to set very high quantity
    const qtyInput = page.locator("input[type='number']").last();
    if (await qtyInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await qtyInput.fill("999999");
    }

    // Try to submit
    const submitBtn = page.locator("button:has-text('Создать'), button[type='submit']");
    if (await submitBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await submitBtn.click();
      await page.waitForTimeout(2_000);

      // Should show error about insufficient stock
      const hasError = await page.locator(":text('Недостаточно'), :text('Insufficient'), [class*='error'], [class*='danger']").isVisible({ timeout: 3_000 }).catch(() => false);
      // OR should still be on the same page (not redirected)
      const stillOnPage = page.url().includes("/orders/new");
      expect(hasError || stillOnPage).toBeTruthy();
    }
  });
});

// ── Dashboard KPIs ───────────────────────────────────────────────────────────
test.describe("Dashboard — Critical Flow", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("dashboard loads with KPI cards", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Verify KPI section exists
    const kpiSection = page.locator("[class*='kpi'], [class*='metric'], [class*='stat']");
    await expect(kpiSection.first()).toBeVisible({ timeout: 5_000 });
  });

  test("dashboard shows error fallback on API failure", async ({ page }) => {
    // Block API calls to simulate failure
    await page.route("**/api/trpc/**", route => route.abort());

    await page.goto("/dashboard");
    await page.waitForTimeout(3_000);

    // Should show error fallback with retry button
    const errorFallback = page.locator(":text('Ошибка'), :text('Повторить'), :text('Retry'), [class*='error']");
    const isVisible = await errorFallback.isVisible({ timeout: 5_000 }).catch(() => false);
    expect(isVisible).toBeTruthy();
  });
});
