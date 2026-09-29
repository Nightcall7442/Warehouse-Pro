import { test, expect } from "@playwright/test";
import mysql from "mysql2/promise";
import { login, trpcQuery } from "./harness";

/**
 * Регистрация спрашивает телефон — настоящим путём, от формы до карточки.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Форма брала название и почту; вход закрыт до ссылки из письма. Письмо в
 * спаме — клиент потерян, номера, чтобы позвонить, нет нигде. Откуда пришёл
 * человек, не записывалось.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Человек открывает /register по рекламной ссылке с метками, пробует без
 * телефона — отказ на месте, письма нет. Вставляет номер целиком — поле
 * оставляет девять цифр группами; отвечает «откуда узнали» — «проверьте
 * почту». У суперадмина в карточке новой организации — телефон +998XXXXXXXXX
 * и почта, в базе — источник с метками из адреса; панель «Кто платит и кто
 * уходит» на месте.
 */
test("регистрация: без телефона — отказ, с ним — номер и источник у организации", async ({ browser }) => {
  const stamp = String(Date.now()).slice(-8);
  const org = `E2E Телефон ${stamp}`;
  const email = `reg${stamp}@x.uz`;

  const page = await browser.newPage();
  await page.goto("/register?utm_source=e2e_ads&ref=e2e");
  // Три первых поля рисуются одним списком, и метки у них составные
  // (register-${key}) — ищем по подсказке в поле, её видит и человек.
  await page.getByPlaceholder("Ваше имя").fill("Дилноза");
  await page.getByPlaceholder("Название компании").fill(org);
  await page.getByPlaceholder("you@company.com").fill(email);
  await page.getByTestId("register-password").fill("password123");

  // 1. Без телефона — отказ на месте.
  await page.getByTestId("register-submit").click();
  await expect(page.getByTestId("register-error")).toContainText("+998");
  await expect(page.getByTestId("register-check-mail")).toHaveCount(0);

  // 2. Номер вставлен целиком — в поле девять цифр группами.
  await page.getByTestId("register-phone").fill("+998 90 123 45 67");
  await expect(page.getByTestId("register-phone")).toHaveValue("90 123 45 67");
  await page.getByTestId("register-source").selectOption("telegram");
  await page.getByTestId("register-submit").click();
  await expect(page.getByTestId("register-check-mail")).toBeVisible();

  // 3. У суперадмина: телефон и почта в карточке, панель владельца на странице.
  const admin = await browser.newPage();
  await login(admin, "superadmin");
  await expect(admin.getByTestId("owner-panel")).toBeVisible();
  const list = await trpcQuery<Array<{ id: number; name: string }>>(admin, "tenant.list");
  const mine = list.find(t => t.name === org);
  expect(mine, "организации нет в списке суперадмина").toBeTruthy();
  const detail = await trpcQuery<{ tenant: { ownerPhone: string | null; ownerEmail: string | null } }>(
    admin, "tenant.getDetail", { tenantId: mine!.id },
  );
  expect(detail.tenant).toMatchObject({ ownerPhone: "+998901234567", ownerEmail: email });

  // 4. Источник — в базе (наружу его ручки карточки не отдают).
  if (process.env.DATABASE_URL) {
    const db = await mysql.createConnection(process.env.DATABASE_URL);
    try {
      const [rows] = await db.execute("SELECT signup_source AS s FROM tenants WHERE id = ?", [mine!.id]);
      expect((rows as Array<{ s: string | null }>)[0]?.s).toBe("answer=telegram; utm_source=e2e_ads; ref=e2e");
    } finally {
      await db.end();
    }
  }
});
