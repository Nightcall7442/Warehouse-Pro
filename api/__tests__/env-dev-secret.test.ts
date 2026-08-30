import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * Запасной ключ подписи вне рабочей среды не должен быть известен заранее.
 *
 * Раньше он был постоянным: `dev-insecure-app-secret`. Строка лежит в
 * общедоступном репозитории, а именно ею подписывается сессионный ключ на
 * тридцать дней — кто её знает, тот кует действительную сессию для любого
 * пользователя.
 *
 * От рабочей среды защищает выход из процесса, и NODE_ENV=production зашит в
 * трёх местах. Но защита эта — одно совпадение строки: приложение, поднятое
 * ВНЕ образа (node dist/boot.js под systemd на голом сервере), получает
 * NODE_ENV пустым, и если APP_SECRET там тоже забыли, подпись идёт
 * общеизвестным ключом.
 */

const OLD = { ...process.env };

afterEach(() => {
  process.env = { ...OLD };
  vi.resetModules();
});

async function loadSecret(): Promise<string> {
  vi.resetModules();
  const { env } = await import("../lib/env");
  return env.appSecret;
}

function devWithoutSecret() {
  delete process.env.APP_SECRET;
  process.env.NODE_ENV = "development";
  process.env.DATABASE_URL = "mysql://x:y@localhost:3306/z";
}

describe("Запасной ключ подписи вне рабочей среды", () => {
  it("не совпадает с прежним общеизвестным значением", async () => {
    devWithoutSecret();
    expect(await loadSecret()).not.toBe("dev-insecure-app-secret");
  });

  it("разный при каждом запуске", async () => {
    devWithoutSecret();
    const first = await loadSecret();
    const second = await loadSecret();
    // Совпади они — «случайность» была бы декоративной.
    expect(first).not.toBe(second);
  });

  it("достаточно длинный, чтобы не подбираться", async () => {
    devWithoutSecret();
    expect((await loadSecret()).length).toBeGreaterThan(40);
  });

  it("узнаётся по приставке", async () => {
    devWithoutSecret();
    // По ней значение видно в журнале, и её проверяют защитные ветки в
    // mailer.ts и stripe.ts.
    expect((await loadSecret()).startsWith("dev-insecure-app-secret")).toBe(true);
  });

  it("заданное значение берётся как есть", async () => {
    process.env.APP_SECRET = "настоящий-ключ-из-окружения";
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "mysql://x:y@localhost:3306/z";

    // Случайность включается только при отсутствии переменной: иначе
    // разработчик, задавший ключ, терял бы сессии на каждом перезапуске.
    expect(await loadSecret()).toBe("настоящий-ключ-из-окружения");
  });
});
