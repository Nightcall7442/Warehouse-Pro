import { test, expect, type Page } from "@playwright/test";
import { login } from "./harness";

/**
 * Телефон: 390×844, как iPhone у директора.
 *
 * Три жалобы владельца 19–20.09.2026 жили только в узкой раскладке и на
 * настольном стенде не воспроизводились: «настройки открываются снизу»,
 * кольцо прибыли за краем карточки на главной, сумма заказа в две строки.
 * Здесь они проверяются там, где были видны, — на ширине телефона.
 *
 * Нарочная поломка: в ScrollToTop замени `type !== "PUSH"` на сравнение
 * pathname — упадёт «пункт меню повторно»; убери flexWrap/flexShrink у кольца
 * на главной — упадёт «кольцо внутри карточки»; убери ветку isMobile в
 * KpiCard — упадут «карточки-показатели».
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

/** На сколько страница шире экрана; горизонтальной прокрутки на телефоне быть не должно. */
function sidewaysOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test.describe("телефон", () => {
  test("главная: страница не шире экрана, кольцо прибыли внутри карточки", async ({ page }) => {
    await login(page, "ceo");
    await page.goto("/");
    const ring = page.locator(".neo-progress-ring").first();
    await expect(ring).toBeVisible();
    expect(await sidewaysOverflow(page), "главная шире экрана").toBeLessThanOrEqual(0);
    const box = await ring.evaluate(el => {
      const r = el.getBoundingClientRect();
      const card = el.closest(".kpi-hero")!.getBoundingClientRect();
      return { right: r.right, cardRight: card.right, screen: window.innerWidth };
    });
    expect(box.right, "кольцо вылезло за карточку").toBeLessThanOrEqual(box.cardRight + 1);
    expect(box.right, "кольцо вылезло за экран").toBeLessThanOrEqual(box.screen);
  });

  test("шапка лендинга: «Ру/Uz» и меню — цели в 44 точки и нажимаются", async ({ page }) => {
    // 25.09.2026: «в браузере телефона эти кнопки не нажимаются, особенно в
    // айфонах». Строку состояния iPhone здесь не воспроизвести (у Chromium
    // нет safe-area), её стережёт landing-header-tappable; здесь — размер и
    // то, что по центру кнопки лежит сама кнопка, а не чужой слой.
    await page.goto("/");
    const uz = page.locator("nav button:visible", { hasText: /^uz$/i });
    const menu = page.locator("nav button:visible[aria-label]");
    for (const b of [uz, menu]) {
      const box = (await b.boundingBox())!;
      expect(box.height, "цель касания ниже 44 точек").toBeGreaterThanOrEqual(44);
      expect(box.width, "цель касания уже 44 точек").toBeGreaterThanOrEqual(44);
      const onTop = await b.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); });
      expect(onTop, "кнопку накрывает другой слой").toBe(true);
    }
    await uz.tap();
    await expect(uz).toHaveAttribute("aria-pressed", "true");
    await menu.tap();
    await expect(page.locator("nav button:visible", { hasText: /^(Войти|Kirish)$/ })).toBeVisible();
  });

  test("заказы: сумма в карточке одной строкой и на экране", async ({ page }) => {
    await login(page, "ceo");
    await page.goto("/orders");
    const amount = page.getByTestId("order-card-total").first();
    await expect(amount).toBeVisible();
    const r = await amount.evaluate(el => { const b = el.getBoundingClientRect(); return { h: b.height, right: b.right, screen: window.innerWidth }; });
    expect(r.h, "сумма переносится на вторую строку").toBeLessThan(28);
    expect(r.right, "сумма за краем экрана").toBeLessThanOrEqual(r.screen);
    expect(await sidewaysOverflow(page), "заказы шире экрана").toBeLessThanOrEqual(0);
  });

  test("товары: карточки-показатели на телефоне компактные", async ({ page }) => {
    await login(page, "ceo");
    await page.goto("/products");
    const cards = page.locator("[data-kpi-compact]");
    await expect(cards).toHaveCount(3);
    const heights = await cards.evaluateAll(els => els.map(e => e.getBoundingClientRect().height));
    for (const h of heights) expect(h, "карточка-показатель во весь рост").toBeLessThan(80);
  });

  test("пункт меню повторно открывает настройки с начала", async ({ page }) => {
    await login(page, "ceo");
    await page.goto("/settings?section=invoices");
    await expect(page.getByTestId("invoice-preview")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const before = await page.evaluate(() => window.scrollY);
    expect(before, "страница накладных не прокрутилась — проверка не о чём").toBeGreaterThan(200);
    await page.getByRole("button", { name: /^(Меню|Menyu)$/ }).click();
    // Меню есть и настольное (скрыто), и в шторке — нажимаем видимое.
    await page.locator(".sidebar-nav-item:visible", { hasText: /^(Настройки|Sozlamalar)$/ }).first().click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect.poll(() => page.evaluate(() => window.scrollY), { message: "настройки открылись не с начала" }).toBe(0);
  });

  test("таблицы на телефоне — карточками: все колонки на экране, ничего не режется справа", async ({ page }) => {
    await login(page, "ceo");
    for (const path of ["/users", "/arrivals", "/agent/kpi", "/control", "/pnl"]) {
      await page.goto(path);
      const labelled = page.locator(".card-table td[data-label]");
      await expect(labelled.first(), `${path}: таблица не стала карточками`).toBeVisible();
      expect(await sidewaysOverflow(page), `${path} шире экрана`).toBeLessThanOrEqual(0);
      // Ни одна ячейка не уходит за правый край экрана.
      const over = await page.evaluate(() => Array.from(document.querySelectorAll(".card-table td")).filter(td => td.getBoundingClientRect().right > window.innerWidth + 1).length);
      expect(over, `${path}: ячеек за краем экрана — ${over}`).toBe(0);
    }
  });

  test("страницы директора не шире экрана", async ({ page }) => {
    await login(page, "ceo");
    for (const path of ["/shops", "/warehouse", "/settings", "/reports", "/agent/kpi"]) {
      await page.goto(path);
      await page.waitForLoadState("load");
      expect(await sidewaysOverflow(page), `${path} шире экрана`).toBeLessThanOrEqual(0);
    }
  });
});
