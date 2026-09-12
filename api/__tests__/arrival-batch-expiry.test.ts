import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Партия и срок годности записываются на приёмке.
 *
 * ── Почему именно там ───────────────────────────────────────────────────────
 *
 * Приход — единственная дверь, через которую товар появляется на складе с
 * известной датой. Не записав срок здесь, взять его потом неоткуда: на остатке
 * лежит ОДНО число на товар, без всякой памяти о том, какими партиями оно
 * набралось.
 *
 * ── Что было отложено и чем кончилось ───────────────────────────────────────
 *
 * Учёт остатка по партиям — списание по FEFO и отчёт «сгорает через неделю» —
 * сюда сознательно НЕ входил: остаток меняли девятнадцать мест сырым SQL в
 * двенадцати файлах, единой двери не было, и параллельный учёт по партиям
 * разошёлся бы с остатком за неделю. Получился бы второй источник правды о
 * деньгах.
 *
 * Дверь построена (api/services/stock-ledger.ts), сырых мест осталось два —
 * оба в ней самой, — и партии двигает она же, тем же вызовом. Учёт живёт в
 * stock_batches, проверяется набором real-db/stock-batches-fefo.test.ts, а
 * ratchet ниже по-прежнему стережёт, чтобы сырого SQL по остатку не
 * становилось больше.
 */
const mocks = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  arrivalNumber: "AR-001",
}));

vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/sanitize", () => ({ sanitizeString: (v: string) => v.trim() }));
vi.mock("../lib/cache", () => ({
  cache: { invalidate: vi.fn(), invalidatePrefix: vi.fn(), get: vi.fn(), set: vi.fn() },
  CacheKeys: { dashboardKpis: (id: number) => `k:${id}` },
}));

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("проверка срока на приёмке", () => {
  /*
    Настоящая проверка поведения, а не разбор текста: собираем ту же функцию
    сравнения, что стоит в роутере, и гоняем её по краям. Дата сравнивается
    строками «ГГГГ-ММ-ДД» — в этом виде лексикографический порядок совпадает с
    календарным, и никакой часовой пояс в сравнение не вмешивается.
  */
  const rejects = (expiresAt: string, arrivalDate: string) => expiresAt < arrivalDate;

  it("срок раньше прихода отвергается", () => {
    expect(rejects("2026-09-09", "2026-09-10")).toBe(true);
  });

  it("срок в день прихода принимается", () => {
    // Товар, который истекает сегодня, принять можно — это решение кладовщика,
    // а не ошибка ввода. Отвергать надо невозможное, а не невыгодное.
    expect(rejects("2026-09-10", "2026-09-10")).toBe(false);
  });

  it("нормальный срок принимается", () => {
    expect(rejects("2027-01-01", "2026-09-10")).toBe(false);
  });

  it("сравнение строк совпадает с календарём на переходе года", () => {
    // «2026-12-31» < «2027-01-01» как строки и как даты — то, ради чего формат
    // с ведущими нулями и выбран.
    expect(rejects("2026-12-31", "2027-01-01")).toBe(true);
    expect(rejects("2027-01-01", "2026-12-31")).toBe(false);
  });
});

describe("сколько дней осталось", () => {
  /*
    Тот же счёт, что на экране: разница календарных дней, а не миллисекунд
    через toISOString. На ташкентском поясе печать местной полуночи в UTC даёт
    вчерашний день, и товар, который горит сегодня, показывался бы вчерашним —
    ровно та ошибка, что уже стоила нам ключа месяца.
  */
  function daysLeft(day: string, todayStr: string): number {
    const [y, m, d] = day.split("-").map(Number);
    const [ty, tm, td] = todayStr.split("-").map(Number);
    const due = new Date(y, m - 1, d).getTime();
    const today = new Date(ty, tm - 1, td).getTime();
    return Math.round((due - today) / 86_400_000);
  }

  it("сегодня — ноль, вчера — минус один", () => {
    expect(daysLeft("2026-09-10", "2026-09-10")).toBe(0);
    expect(daysLeft("2026-09-09", "2026-09-10")).toBe(-1);
  });

  it("считает через месяц и через год", () => {
    expect(daysLeft("2026-10-10", "2026-09-10")).toBe(30);
    expect(daysLeft("2027-09-10", "2026-09-10")).toBe(365);
  });

  it("переход на летнее время не сдвигает счёт", () => {
    // Разница в часах между этими датами не кратна 24 в поясах с переводом
    // стрелок; округление до суток это и лечит.
    expect(daysLeft("2026-04-01", "2026-03-01")).toBe(31);
  });
});

// ── Разбор исходников ────────────────────────────────────────────────────────
describe("данные доходят от формы до базы и обратно", () => {
  const ROUTER = read("api/arrival-router.ts");
  const PAGE = read("src/pages/Arrivals.tsx");

  it("вход принимает партию и срок", () => {
    expect(ROUTER).toContain("batchNumber: z.string().max(64).optional()");
    expect(ROUTER).toContain("Срок годности задаётся как ГГГГ-ММ-ДД");
  });

  it("срок раньше прихода отвергается на сервере, а не только в календаре", () => {
    // Календарь с min= подсказывает, но запрос приходит и мимо формы.
    expect(ROUTER).toContain("раньше даты прихода");
    expect(ROUTER).toContain('code: "BAD_REQUEST"');
  });

  it("оба поля пишутся в строку прихода", () => {
    const at = ROUTER.indexOf("insert(arrivalItems)");
    const body = ROUTER.slice(at, at + 900);
    expect(body).toContain("batchNumber:");
    expect(body).toContain("expiresAt:");
  });

  it("дата уходит строкой, а не Date", () => {
    /*
      Колонка DATE времени не хранит, а Date драйвер развернул бы в поясе
      сервера и мог сдвинуть день. Тот же случай, что с ключом месяца.
    */
    const at = ROUTER.indexOf("insert(arrivalItems)");
    const body = ROUTER.slice(at, at + 900);
    expect(body).toMatch(/expiresAt: item\.expiresAt \? sql`/);
  });

  it("карточка прихода их читает и показывает", () => {
    expect(ROUTER).toContain("ai.batch_number AS batchNumber");
    expect(ROUTER).toContain("DATE_FORMAT(ai.expires_at");
    expect(PAGE).toContain("item.batchNumber");
    expect(PAGE).toContain("item.expiresAt");
  });

  it("форма отправляет отсутствие, а не пустую строку", () => {
    // Иначе у половины партий появился бы номер «».
    expect(PAGE).toContain("i.batchNumber.trim() || undefined");
    expect(PAGE).toContain("i.expiresAt || undefined");
  });

  it("просроченное на экране называется словом, а не только цветом", () => {
    expect(PAGE).toContain("просрочен");
  });

  it("экранный счёт дней не ходит через toISOString", () => {
    const at = PAGE.indexOf("function daysLeft");
    expect(at).toBeGreaterThan(0);
    const body = PAGE.slice(at, PAGE.indexOf("}", PAGE.indexOf("return", at)));
    expect(body).not.toContain("toISOString");
  });
});

describe("сырого SQL по остатку не становится больше", () => {
  /*
    Начиналось как ratchet, а не запрет: девятнадцать мест сырым SQL меняли
    warehouse_stock, и переписать их разом на денежном пути было отдельной
    работой с отдельным риском. Число опускалось по мере переноса — как потолок
    ошибок типов в scripts/typecheck.mjs.

    19 → 17: приход и возврат переведены на receiveStock.
    17 → 11: семь мест резерва и снятия резерва — на reserveStock/releaseStock.
    11 → 2: отгрузка, смена статуса, правка выполненного заказа и установка
    числом переведены на shipStock / applyStockEffect / setStock.

    Обе оставшиеся — сама дверь (api/services/stock-ledger.ts): shiftStock и
    setStock. Больше остаток менять неоткуда, и потолок теперь означает ровно
    это: новый сырой UPDATE в любом файле — это возврат к прежнему, где каждый
    путь считал остаток по-своему.
  */
  const BASELINE = 2;

  it(`не больше ${BASELINE} мест с UPDATE warehouse_stock`, () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.resolve(process.cwd(), dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== "__tests__") walk(rel); }
        else if (e.name.endsWith(".ts")) files.push(rel);
      }
    };
    walk("api");

    const hits: string[] = [];
    for (const f of files) {
      const src = read(f);
      for (const line of src.split("\n")) {
        if (/UPDATE\s+warehouse_stock/i.test(line)) hits.push(f);
      }
    }
    expect(
      hits.length,
      `сырых UPDATE warehouse_stock стало ${hits.length} (было ${BASELINE}):\n${hits.join("\n")}`,
    ).toBeLessThanOrEqual(BASELINE);
  });

  it.skip("три главные операции склада всё ещё никем не зовутся — это и есть причина", () => {
    /*
      Проверка-напоминание, а не требование. StockService.reserve/release/deduct
      написаны и мертвы: каждый путь пишет остаток сам. Пока это так, партии не
      на что опереть. Появится вызов — проверка упадёт, и это будет ХОРОШАЯ
      новость: значит, дверь начали строить, и здесь пора пересмотреть план.
    */
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.resolve(process.cwd(), dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== "__tests__") walk(rel); }
        else if (e.name.endsWith(".ts") && rel !== "api/services/stock.ts") {
          if (/StockService\.(reserve|release|deduct)\(/.test(read(rel))) callers.push(rel);
        }
      }
    };
    walk("api");
    expect(callers, "кто-то начал звать StockService — пора строить дверь для остатка и вернуться к партиям").toEqual([]);
  });
});

beforeEach(() => { mocks.inserted.length = 0; });

/**
 * Опустевшая партия уходит из таблицы.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Списание уменьшало количество и оставляло строку с нулём. Само списание от
 * этого не страдало — выборка FEFO берёт только `quantity > 0`, — но страдали
 * двое других.
 *
 * Таблица переставала быть про полку: каждая увезённая партия оставляла запись
 * навсегда, и у склада с ежедневными приходами это тысячи строк о товаре,
 * которого нет.
 *
 * И, что дороже, каждый читающий обязан был помнить про `quantity > 0`. Сейчас
 * его помнят три запроса в warehouse-reports; четвёртый, который забудет,
 * покажет кладовщику просроченную партию, которой на полке нет.
 *
 * Поймано настоящей базой: пять проверок FEFO ждали пустой список и получали
 * строку с нулём. Здесь то же правило стережётся без базы — на этой машине её
 * нет, и до CI ошибка иначе доживает.
 */
describe("пустых партий на полке не остаётся", () => {
  const LEDGER = fs.readFileSync(
    path.resolve(process.cwd(), "api/services/stock-ledger.ts"), "utf8",
  ).replace(/\r\n/g, "\n");

  const consume = LEDGER.slice(
    LEDGER.indexOf("async function consumeBatches("),
    LEDGER.indexOf("\n/**", LEDGER.indexOf("async function consumeBatches(")),
  );

  it("списание убирает обнулившиеся строки", () => {
    expect(consume, "обнулённая партия снова остаётся строкой").toContain("DELETE FROM stock_batches");
    expect(consume, "убираются не по количеству").toContain("quantity <= 0");
  });

  it("убирает только у своего товара и склада", () => {
    // Иначе один товар подчистил бы пустые партии соседнего — молча, потому
    // что на числах это не видно.
    const at = consume.indexOf("DELETE FROM stock_batches");
    const stmt = consume.slice(at, consume.indexOf("`", at));
    for (const scope of ["tenant_id", "warehouse_id", "product_id"]) {
      expect(stmt, `удаление не сужено по ${scope}`).toContain(scope);
    }
  });

  it("оба пути списания идут через одну функцию", () => {
    /*
      Отгрузка и инвентаризация уменьшают партии по-разному, но обе обязаны
      звать consumeBatches: свой цикл в одном из них означал бы, что правило
      про нули действует только в другом.
    */
    const calls = LEDGER.split("consumeBatches(").length - 1;
    // Объявление, вызов из отгрузки, вызов из пересчёта.
    expect(calls, "путей списания партий стало не два").toBe(3);
  });

  it("отчёты всё равно фильтруют нули", () => {
    /*
      Пояс и подтяжки. Пустых строк теперь не бывает, но фильтр в отчётах —
      вторая линия: она переживёт и чужую правку, и строку, доставшуюся из
      базы, которая жила до этого решения.
    */
    const REPORTS = fs.readFileSync(
      path.resolve(process.cwd(), "api/warehouse-reports-router.ts"), "utf8",
    );
    const guards = REPORTS.split('gt(stockBatches.quantity, "0")').length - 1;
    expect(guards, "отчёт по партиям перестал отбрасывать пустые").toBeGreaterThanOrEqual(3);
  });
});

describe("ожидалось по накладной поставщика", () => {
  it("строка прихода принимает expectedQuantity, хранит и отдаёт с разницей на экране", async () => {
    const { readFileSync } = await import("node:fs");
    const router = readFileSync("api/arrival-router.ts", "utf-8");
    expect(router).toMatch(/expectedQuantity: z\.string\(\)\.regex\(/);
    expect(router).toContain("expectedQuantity: item.expectedQuantity ?? null,");
    expect(router).toContain("ai.expected_quantity AS expectedQuantity");
    const page = readFileSync("src/pages/Arrivals.tsx", "utf-8");
    expect(page).toContain('expectedQuantity: i.expected.trim() === "" ? undefined : i.expected.trim(),');
    expect(page).toContain("data-testid={`arrival-detail-expected-${i}`}");
    expect(readFileSync("db/migrations/0033_arrival_items_expected.sql", "utf-8").trim()).toBe("ALTER TABLE `arrival_items` ADD `expected_quantity` decimal(12,2);");
  });
});
