import { defineConfig } from "@playwright/test";

/**
 * Сквозные проверки.
 *
 * ── Что было не так ─────────────────────────────────────────────────────────
 *
 * Прежний набор не мог упасть. Тридцать два его тела были обёрнуты в
 * «сделать, если элемент виден» (проверка видимости вместо ожидания): не нашёлся элемент — тело
 * пропущено, тест зелёный. Вход выполнялся под ceo@warehouse-pro.uz, которого
 * в засеве нет, и ждал перехода на /dashboard, куда роль не попадает. То есть
 * набор ни разу не проходил целиком — и не мог этого показать, потому что в
 * CI его никто не запускал, а baseURL по умолчанию указывал на порт 3000, где
 * у разработчика обычно совсем другое приложение.
 *
 * ── Как устроено теперь ─────────────────────────────────────────────────────
 *
 * Действие идёт через настоящий экран, а проверка — через API тем же
 * браузерным контекстом: вход по cookie, поэтому page.request несёт сессию.
 * Так проверяется то, что произошло на самом деле (остаток, долг, цена), а не
 * то, что нарисовано.
 *
 * Приложение поднимает сам Playwright. Нужна пустая база в DATABASE_URL:
 * набор её засевает и меняет.
 */
export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,           // Один поток: тесты меняют общие остатки и долги.
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    headless: true,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "on-first-retry",
  },
  // Своё приложение на своём порту: 3000 у разработчика обычно занят.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start",
        url: "http://127.0.0.1:3100/health/ready",
        reuseExistingServer: false,
        timeout: 120_000,
        env: { PORT: "3100", NODE_ENV: "production" },
        stdout: "pipe",
        stderr: "pipe",
      },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
