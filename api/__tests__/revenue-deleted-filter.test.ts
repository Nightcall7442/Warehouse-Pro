import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Выборка по выручке без отсечения удалённых заказов.
 *
 * ── Что это за ошибка ────────────────────────────────────────────────────────
 *
 * Удалённый заказ — это отменённая продажа. Он не должен попадать ни в
 * выручку, ни в спрос, ни в счётчики. Отсекается он условием
 * isNull(orders.deletedAt), и для этого есть готовый набор
 * revenueOrderConditions (api/lib/order-status.ts).
 *
 * Набор и заведён потому, что условия переписывали руками и фильтр терялся —
 * по комментарию в самом файле, в четырёх местах из шести. 2 сентября 2026 он
 * нашёлся ещё в девяти: в прогнозе запасов (завышал спрос и гнал закупать
 * лишнее), в достижениях агента, в выручке по месяцам и способам оплаты и в
 * сводке телеграм-бота.
 *
 * ── Почему проверка читает исходник ──────────────────────────────────────────
 *
 * Ошибка не падает и ничего не ломает: запрос выполняется, просто отвечает
 * большим числом. Поймать её выполнением можно лишь на данных, где есть
 * удалённый заказ, — то есть в каждом из десятков мест по отдельности. Чтение
 * исходника ловит весь класс разом и стоит миллисекунды.
 *
 * Проверка не запрещает писать условия руками. Она требует одного: если в
 * наборе есть выручковые статусы, то рядом должно быть и отсечение удалённых —
 * само по себе или через общий помощник.
 */

const ROOT = path.resolve(__dirname, "..");

/** Все .ts проекта на стороне сервера, кроме самих проверок. */
function sources(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "__tests__") sources(full, acc); }
    else if (e.name.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

const STATUS_FILTER = /inArray\(\s*orders\.status\s*,\s*REVENUE_ORDER_STATUSES\s*\)/;
/** Отсечение удалённых — прямое, сырым SQL или через общий набор условий. */
const GUARD = /isNull\(\s*orders\.deletedAt\s*\)|deleted_at\s+IS\s+NULL|revenueOrderConditions|revenuePeriodConditions/;

/** Окно, в котором ищется отсечение: остальные условия того же and(). */
const WINDOW = 10;

interface Finding { file: string; line: number; text: string }

function findUnguarded(): Finding[] {
  const found: Finding[] = [];
  for (const file of sources(ROOT)) {
    // Сам файл с набором условий — его определение и есть эталон.
    if (file.endsWith("order-status.ts")) continue;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!STATUS_FILTER.test(line)) return;
      const window = lines.slice(Math.max(0, i - WINDOW), i + WINDOW + 1).join("\n");
      if (GUARD.test(window)) return;
      found.push({ file: path.relative(ROOT, file), line: i + 1, text: line.trim() });
    });
  }
  return found;
}

describe("выручка считается без удалённых заказов", () => {
  it("проверка вообще что-то читает", () => {
    // Страховка от «зелёного ни на чём»: если обход файлов сломается, список
    // окажется пустым и запрет ниже выполнится сам собой.
    const files = sources(ROOT);
    expect(files.length).toBeGreaterThan(50);
    expect(files.some(f => f.endsWith("analytics-router.ts"))).toBe(true);
  });

  it("выручковые статусы нигде не идут без отсечения удалённых", () => {
    const found = findUnguarded();
    expect(
      found.map(f => `${f.file}:${f.line}  ${f.text}`),
      "здесь заказы фильтруются по выручковым статусам, но удалённые не отсечены —\n" +
      "добавьте isNull(orders.deletedAt) или возьмите revenueOrderConditions(tenantId)",
    ).toEqual([]);
  });

  it("правило действительно срабатывает — встречная проверка", () => {
    // Без неё «пусто» выше не значило бы ничего: правило могло бы не ловить
    // вообще ничего, и проверка оставалась бы зелёной навсегда.
    const bad = [
      "  .where(and(",
      "    eq(orders.tenantId, tenantId),",
      "    inArray(orders.status, REVENUE_ORDER_STATUSES),",
      "  ))",
    ].join("\n");
    const good = bad.replace(
      "inArray(orders.status, REVENUE_ORDER_STATUSES),",
      "inArray(orders.status, REVENUE_ORDER_STATUSES), isNull(orders.deletedAt),",
    );

    const unguarded = (src: string) => {
      const lines = src.split("\n");
      return lines.some((line, i) =>
        STATUS_FILTER.test(line) &&
        !GUARD.test(lines.slice(Math.max(0, i - WINDOW), i + WINDOW + 1).join("\n")));
    };

    expect(unguarded(bad)).toBe(true);
    expect(unguarded(good)).toBe(false);
  });
});
