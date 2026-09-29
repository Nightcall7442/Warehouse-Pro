import { test, expect } from "@playwright/test";
import mysql from "mysql2/promise";
import { login, trpcMutate, trpcQuery } from "./harness";

/**
 * Истёкшая организация может заплатить — настоящим путём.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Подписка кончилась → рабочие ручки отвечают отказом → клиент уводит на
 * /subscription-blocked. Кнопка там вела на /settings/billing внутри общего
 * Layout, а Layout сразу спрашивает уведомления, поддержку и «Справку» —
 * ручки, закрытые подпиской. Отказ возвращал на экран блокировки: круг, ни
 * тарифов, ни заявки. Клиент, который хотел заплатить, не мог.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Суперадмин заводит организацию, её срок уводится в прошлое, директор
 * входит через форму — и оказывается на экране блокировки, где сразу видит
 * тарифы. Заявка на Basic даёт ответ на том же экране; страница никуда не
 * уходит и не перезагружается; у суперадмина в разборе заявок появляется
 * строка этой организации.
 *
 * Срок уводится одним UPDATE: у API нет способа поставить дату в прошлое, и
 * заводить его ради теста было бы хуже. Всё остальное — через экран и API.
 */
test("истёкшая организация продлевает с экрана блокировки — заявка в разборе, круга нет", async ({ browser }) => {
  test.skip(!process.env.DATABASE_URL, "нужен DATABASE_URL той же базы, что у приложения стенда");

  const stamp = String(Date.now()).slice(-8);
  const org = `E2E Истёкшая ${stamp}`;
  // Короче 32 знаков: почта идёт в заявку телефоном (у организации нет телефона).
  const email = `e2e${stamp}@x.uz`;

  // 1. Организация — обычным путём суперадмина.
  const admin = await browser.newPage();
  await login(admin, "superadmin");
  const created = await trpcMutate<{ tenantId: number }>(admin, "tenant.create", {
    orgName: org, ownerName: "Директор", ownerEmail: email, ownerPassword: "password123", plan: "trial", trialDays: 14,
  });

  // 2. Срок — в прошлое.
  const db = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    await db.execute(
      "UPDATE subscriptions SET trial_ends_at = NOW() - INTERVAL 1 DAY, current_period_ends = NOW() - INTERVAL 1 DAY WHERE tenant_id = ?",
      [created.tenantId],
    );
    await db.execute("UPDATE tenants SET trial_ends_at = NOW() - INTERVAL 1 DAY WHERE id = ?", [created.tenantId]);
  } finally {
    await db.end();
  }

  // 3. Директор входит через форму.
  const page = await browser.newPage();
  let loads = 0;
  page.on("load", () => { loads++; });
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill("password123");
  await page.getByTestId("login-submit").click();
  await page.waitForURL(url => new URL(url).pathname === "/subscription-blocked", { timeout: 20_000 });

  // 4. Тарифы — на самом экране; заявка — не уходя с него.
  const plan = "basic";
  await page.getByTestId(`plan-request-${plan}`).click();
  await expect(page.getByTestId("plan-request-sent")).toBeVisible();

  // 5. Круга нет: страница стоит и не перезагружается.
  const settled = loads;
  await page.waitForTimeout(3_000);
  expect(new URL(page.url()).pathname).toBe("/subscription-blocked");
  expect(loads, "экран блокировки перезагружается по кругу").toBe(settled);
  await expect(page.getByTestId(`plan-request-${plan}`)).toBeVisible();

  // 6. Заявка лежит в разборе у суперадмина.
  const leads = await trpcQuery<Array<{ company: string | null; source: string | null; phone: string; comment: string | null }>>(admin, "lead.list");
  const mine = leads.filter(l => l.company === org);
  expect(mine, "заявки организации нет в разборе").toHaveLength(1);
  expect(mine[0]).toMatchObject({ source: "подписка: тариф", phone: email });
  expect(mine[0].comment).toContain("Basic");
});
