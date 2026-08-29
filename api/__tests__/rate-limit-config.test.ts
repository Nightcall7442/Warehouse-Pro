import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Настройки ограничителя запросов должны доходить до самого ограничителя.
 *
 * RATE_LIMIT_GLOBAL_MAX и RATE_LIMIT_WINDOW_MS были объявлены в lib/env.ts и
 * описаны в .env.example, но не читались нигде: в middleware.ts стояли 120 и
 * 60000 прямо в коде. Рычаг был, действия не оказывал.
 *
 * Так ломается хуже всего: ошибки нет, в журнале пусто, значение в настройках
 * стоит правильное. Человек поднимает предел во время наплыва, перезапускает
 * приложение и не понимает, почему ничего не изменилось.
 */
const ROOT = process.cwd();
const MIDDLEWARE = readFileSync(join(ROOT, "api", "middleware.ts"), "utf8");
const ENV = readFileSync(join(ROOT, "api", "lib", "env.ts"), "utf8");

describe("объявленные настройки ограничителя действительно применяются", () => {
  const KNOBS = ["rateLimitGlobalMax", "rateLimitWindowMs"] as const;

  for (const knob of KNOBS) {
    it(`«${knob}» объявлен в env`, () => {
      expect(ENV, `настройка ${knob} исчезла из lib/env.ts`).toContain(`${knob}:`);
    });

    it(`«${knob}» доходит до ограничителя`, () => {
      expect(
        MIDDLEWARE,
        `${knob} объявлен, но middleware.ts его не читает — настройка ничего не меняет`,
      ).toContain(`env.${knob}`);
    });
  }

  it("предел не зашит числом рядом с настройкой", () => {
    // Возврат к литералу — это возврат к мёртвой настройке.
    const at = MIDDLEWARE.indexOf("const GLOBAL_RATE_LIMIT");
    expect(at, "объявление GLOBAL_RATE_LIMIT не найдено").toBeGreaterThan(0);
    const block = MIDDLEWARE.slice(at, MIDDLEWARE.indexOf("};", at));
    expect(block, "предел снова задан числом в коде").not.toMatch(/limit:\s*\d/);
    expect(block, "окно снова задано числом в коде").not.toMatch(/windowMs:\s*\d/);
  });
});
