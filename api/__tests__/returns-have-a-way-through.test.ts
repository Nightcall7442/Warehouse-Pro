import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * У возврата должен быть путь до «проведён».
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Агент заводит возврат из мобильного приложения — он приходит «на
 * рассмотрении». Дальше его должен посмотреть человек в офисе: одобрить или
 * отказать, а одобренный — провести.
 *
 * Ручка, которая это делает (returns.updateStatus), была написана, выставлена
 * наружу и НЕ ВЫЗЫВАЛАСЬ НИОТКУДА: страницы возвратов в вебе не существовало,
 * а мобилка их только заводит. Единственный способ вывести возврат из
 * «на рассмотрении» был недоступен.
 *
 * ── Чем это стоило ──────────────────────────────────────────────────────────
 *
 * На состояние «проведён» опираются ПЯТЬ расчётов:
 *
 *   долг магазина (services/shop-debt.ts)
 *   прибыль и выручка (services/revenue-returns.ts)
 *   база комиссии агента (commission-router, services/kpi.ts)
 *   доля возвратов в KPI
 *   рейтинг магазина (services/shop-scoring.ts)
 *
 * Все пятеро считали правильно то, чего не бывает: ни один возврат не мог
 * дойти до этого состояния. Ошибку такого рода не видно ни в типах, ни в
 * тестах отдельных функций — виден только пустой отчёт, который все считают
 * правдой.
 *
 * ── Отсюда проверки ─────────────────────────────────────────────────────────
 *
 * Общий храповик (api-surface-is-reachable) ловит «ручку не зовут». Здесь —
 * то, чего он не видит: что кнопки на экране ведут ИМЕННО туда, куда пускает
 * сервер, и что дорога до «проведён» существует целиком.
 */

const ROOT = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

const ROUTER = read("api", "returns-router.ts");
const PAGE = read("src", "pages", "Returns.tsx");

/** Разрешённые переходы, как их задаёт сервер. */
function serverTransitions(): Record<string, string[]> {
  const at = ROUTER.indexOf("const validTransitions");
  expect(at, "правило переходов в роутере не найдено").toBeGreaterThan(0);
  const block = ROUTER.slice(at, ROUTER.indexOf("};", at));
  const out: Record<string, string[]> = {};
  for (const m of block.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    out[m[1]] = [...m[2].matchAll(/"(\w+)"/g)].map(x => x[1]);
  }
  return out;
}

/** Переходы, которые предлагает экран. */
function screenTransitions(): Record<string, string[]> {
  const at = PAGE.indexOf("const NEXT: Record<Status, Status[]>");
  expect(at, "таблица переходов на экране не найдена").toBeGreaterThan(0);
  const block = PAGE.slice(at, PAGE.indexOf("};", at));
  const out: Record<string, string[]> = {};
  for (const m of block.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    out[m[1]] = [...m[2].matchAll(/"(\w+)"/g)].map(x => x[1]);
  }
  return out;
}

describe("возврат доходит до «проведён»", () => {
  it("экран вообще зовёт смену состояния", () => {
    // Именно этого и не было: ручка есть, звать её некому.
    expect(PAGE, "экран не умеет менять состояние возврата")
      .toContain("trpc.returns.updateStatus.useMutation");
  });

  it("дорога от «на рассмотрении» до «проведён» существует целиком", () => {
    /*
      Главная проверка. Разрыв в ЛЮБОМ звене означает, что «проведён»
      недостижим — и пять расчётов молча считают по пустоте.
    */
    const server = serverTransitions();
    const screen = screenTransitions();

    const path = ["pending", "approved", "completed"];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      expect(server[from] ?? [], `сервер не пускает ${from} → ${to}`).toContain(to);
      expect(screen[from] ?? [], `экран не предлагает ${from} → ${to}`).toContain(to);
    }
  });

  it("экран не обещает переходов, которых сервер не даст", () => {
    /*
      Кнопка, на которую сервер отвечает отказом, — это обещание, которого
      продукт не держит. Человек нажимает и получает непонятную ошибку вместо
      действия.
    */
    const server = serverTransitions();
    const screen = screenTransitions();
    const broken: string[] = [];
    for (const [from, targets] of Object.entries(screen)) {
      for (const to of targets) {
        if (!(server[from] ?? []).includes(to)) broken.push(`${from} → ${to}`);
      }
    }
    expect(broken, `экран предлагает переходы, которых сервер не даёт: ${broken.join(", ")}`).toEqual([]);
  });

  it("терминальные состояния терминальны на обеих сторонах", () => {
    // Проведённый возврат уже вернул товар на склад, отклонённый не двигал
    // ничего: из обоих выхода нет, и предлагать его нельзя.
    const server = serverTransitions();
    const screen = screenTransitions();
    for (const state of ["rejected", "completed"]) {
      expect(server[state] ?? [], `сервер выпускает из «${state}»`).toEqual([]);
      expect(screen[state] ?? [], `экран предлагает выход из «${state}»`).toEqual([]);
    }
  });

  it("проведение спрашивает подтверждение, а одобрение — нет", () => {
    /*
      «Одобрен» ещё ничего не двигает: решение человека, передумать можно.
      «Проведён» возвращает товар на склад и уменьшает долг магазина, и
      обратной дороги нет. Необратимое действие обязано спросить.
    */
    const act = PAGE.slice(PAGE.indexOf("const act = async"), PAGE.indexOf("const rows ="));
    expect(act).toMatch(/if\s*\(to === "completed"\)/);
    expect(act).toContain("await confirm(");
  });

  it("разбор нашёл обе таблицы переходов, а не пустоту", () => {
    // Проверка, которая ничего не разобрала, зелена всегда.
    expect(Object.keys(serverTransitions()).sort()).toEqual(["approved", "completed", "pending", "rejected"]);
    expect(Object.keys(screenTransitions()).sort()).toEqual(["approved", "completed", "pending", "rejected"]);
  });
});
