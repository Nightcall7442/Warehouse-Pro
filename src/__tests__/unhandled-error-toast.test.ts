// @vitest-environment jsdom
// Модуль тянет sonner, а тот при загрузке трогает document.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { shouldTellUser } from "@/lib/toast";

/**
 * Агент в магазине не должен видеть английский текст уровня стека.
 *
 * Раньше в тост уходил сам текст необработанной ошибки, а отсев был списком
 * подстрок, который пополняли на каждый новый шумный случай. Любая незнакомая
 * ошибка проливалась наружу как есть — так на экране и появилось «Failed to
 * register a ServiceWorker for scope ('...') with script ('...'): An unknown
 * error occurred when fetching the script» на пол-экрана.
 */
describe("о чём сообщать человеку", () => {
  it("про служебного работника молчим — приложение и без него работает", () => {
    expect(
      shouldTellUser(
        "Failed to register a ServiceWorker for scope ('http://x/') with script " +
          "('http://x/sw.js'): An unknown error occurred when fetching the script.",
      ),
    ).toBe(false);
    expect(shouldTellUser("workbox-precaching: non-precached-url")).toBe(false);
  });

  it("про обрыв связи молчим — у агента это будни", () => {
    expect(shouldTellUser("Failed to fetch")).toBe(false);
    expect(shouldTellUser("net::ERR_INTERNET_DISCONNECTED")).toBe(false);
    expect(shouldTellUser("NetworkError when attempting to fetch resource.")).toBe(false);
  });

  it("про старый кусок приложения молчим — этим занимается восстановление", () => {
    expect(shouldTellUser("Loading chunk 42 failed.")).toBe(false);
    expect(shouldTellUser("Failed to fetch dynamically imported module: /assets/x.js")).toBe(false);
  });

  it("поломку сервера показываем, обрыв к нему — нет", () => {
    // Разница существенная: 500 значит, что заказ мог не сохраниться.
    expect(shouldTellUser("TRPCClientError: INTERNAL_SERVER_ERROR")).toBe(true);
    expect(shouldTellUser("TRPCClientError: fetch failed")).toBe(false);
  });

  it("незнакомую ошибку показываем", () => {
    // Смысл всей перестановки: неизвестное больше не молчит и не выливается
    // текстом — человек видит одну фразу, подробности идут в журнал.
    expect(shouldTellUser("Cannot read properties of undefined (reading 'id')")).toBe(true);
  });

  it("в тост уходит наша фраза, а не текст ошибки", () => {
    // Проверяем сам вызов: сюда легко вернуть подстановку ${msg}.
    const main = fs.readFileSync(path.resolve(process.cwd(), "src/main.tsx"), "utf8");
    const call = main.slice(main.indexOf("function report("), main.indexOf("window.onerror"));
    expect(call).toContain('notify.error("');
    expect(call, "в тост снова подставляют текст ошибки").not.toMatch(/notify\.error\(`/);
  });
});
