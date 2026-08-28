import { test, expect } from "@playwright/test";
import { login, trpcQuery } from "./harness";

/**
 * Дымовые проверки: приложение вообще поднялось и отвечает.
 *
 * Их задача — отличить «сломался один сценарий» от «не собралось ничего».
 * Поэтому здесь нарочно мало и просто, но каждая всё равно что-то утверждает.
 */

test("приложение отвечает и видит базу", async ({ page }) => {
  const res = await page.request.get("/health/ready");
  expect(res.status(), "приложение поднялось без базы").toBe(200);
});

test("страница входа отдаёт форму, а не пустую разметку", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("login-email")).toBeVisible();
  await expect(page.getByTestId("login-password")).toBeVisible();
  await expect(page.getByTestId("login-submit")).toBeEnabled();
});

test("после входа сервер знает, кто пришёл", async ({ page }) => {
  await login(page, "ceo");
  const me = await trpcQuery<{ role: string }>(page, "user.me");
  expect(me.role, "роль в сессии не та, под которой вошли").toBe("ceo");
});
