import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, globSync } from "node:fs";
import { join } from "node:path";

/**
 * Токен сессии не ходит в адресе.
 *
 * ── Что нашёл аудит ─────────────────────────────────────────────────────────
 *
 * Сервер поднимал WebSocket и принимал JWT строкой запроса — ?token=…. Адрес с
 * токеном оседает в логах прокси, и любой, кто читает логи, читает и сессии.
 *
 * Клиента у канала не было ни одного: веб сокет не открывает, мобильное
 * приложение шлёт координаты через agent.saveLocation по tRPC. Мёртвый вход,
 * принимающий токен из адреса, — поверхность атаки без пользы; он убран.
 *
 * Страж двойной. Первый — на сам канал: файла нет, пакета нет, в запуске
 * подключения нет. Второй — на приём: ни один обработчик не должен читать
 * токен из строки запроса, каким бы ни был путь. Мобильное приложение такой
 * страж уже держит (token-not-in-url.test.ts) для своих ссылок; это его
 * серверная половина.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("мёртвый WebSocket не вернулся", () => {
  it("файла канала нет", () => {
    expect(existsSync(join(process.cwd(), "api", "lib", "ws.ts"))).toBe(false);
  });

  it("запуск его не подключает", () => {
    const boot = read("api/boot.ts");
    expect(boot).not.toContain("attachWebSocket(");
    expect(boot).not.toMatch(/import\("\.\/lib\/ws"\)/);
  });

  it("пакет ws снят с зависимостей", () => {
    // Оставленный пакет — приглашение поднять канал снова тем же способом.
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.ws, "ws вернулся в зависимости").toBeUndefined();
    expect(pkg.devDependencies?.["@types/ws"]).toBeUndefined();
  });
});

describe("токен не читается из строки запроса", () => {
  it("ни один серверный файл не берёт token из searchParams или query", () => {
    /*
      Ловит и ?token=, и любую его будущую форму: searchParams.get("token"),
      c.req.query("token"). Заголовок Authorization и httpOnly-кука —
      единственные два способа предъявить сессию, и оба не попадают в адрес.
    */
    /*
      Одно исключение, и оно названо здесь, а не спрятано в регулярке.

      api/photos.ts принимает ?token= НАМЕРЕННО и временно — ради старых
      сборок мобильного приложения, которые клеили JWT к адресу картинки. Новая
      сборка шлёт его заголовком. Условие снятия записано в самом файле: когда
      в бою исчезнут обращения к /api/photos с token= в адресе. Снять этот путь
      — значит сломать фото у агентов, которые не обновились; решение за
      владельцем, а не за проверкой. Как решит — строку ниже убрать, и страж
      возьмёт photos.ts под охрану вместе со всеми.
    */
    // Разделители приводятся к одному виду: на Windows glob отдаёт обратные
    // слэши, на CI прямые, а исключение должно срабатывать и там, и там.
    const DELIBERATE = new Set(["api/photos.ts"]);
    const files = globSync("api/**/*.ts", { cwd: process.cwd() })
      .map(f => f.replace(/\\/g, "/"))
      .filter(f => !f.includes("__tests__") && !DELIBERATE.has(f));
    const offenders: string[] = [];
    const NAMES = "(token|access_token|jwt|session)";
    const viaSearchParams = new RegExp("searchParams\\.get\\(\\s*[\"']" + NAMES + "[\"']\\s*\\)");
    const viaQuery = new RegExp("\\.query\\(\\s*[\"']" + NAMES + "[\"']\\s*\\)");
    for (const f of files) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      if (viaSearchParams.test(src) || viaQuery.test(src)) offenders.push(f);
    }
    expect(offenders, "токен снова читают из адреса: " + offenders.join(", ")).toEqual([]);
  });
});
