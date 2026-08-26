import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Приведение к DECIMAL всегда указывает точность.
 *
 * ── Чем плохо приведение без неё ────────────────────────────────────────────
 *
 * Умолчание MySQL для `CAST(expr AS DECIMAL)` — DECIMAL(10,0). Ноль знаков
 * после запятой и потолок в десять цифр. Ни то, ни другое не выглядит ошибкой:
 * запрос отрабатывает, число приходит, просто оно другое.
 *
 * Что от этого ломалось на самом деле:
 *
 *   вес доставки      SUM(CAST(oi.quantity AS DECIMAL) * CAST(unit_weight AS DECIMAL))
 *                     Товар весом 0.5 кг превращался в 1 кг ЕЩЁ ДО умножения.
 *                     Курьер получал загрузку машины, посчитанную по
 *                     округлённым до целого весам.
 *
 *   фильтр должников  CAST(shops.debt AS DECIMAL) > 0
 *                     Долг в 40 тийин округлялся в ноль, и магазин пропадал из
 *                     списка должников. Сортировка по долгу шла по округлённым
 *                     значениям.
 *
 *   прогноз и остатки Дробные количества в forecast-router и stock-predictor
 *                     терялись целиком.
 *
 * Отдельно — приведения с ЯВНОЙ, но узкой точностью: `CAST(total AS
 * DECIMAL(10,2))` при колонке orders.total типа DECIMAL(12,2). Потолок такого
 * приведения — 99 999 999.99, то есть около ста миллионов сумов. Заказ
 * крупного дистрибьютора туда упирался, и выручка в KPI молча обрезалась.
 *
 * ── Правило ─────────────────────────────────────────────────────────────────
 *
 * Точность указывается всегда и не уже, чем у колонки:
 *   деньги            DECIMAL(15,2)   — как в services/shop-debt.ts
 *   количества и вес  DECIMAL(15,3)   — unit_weight в схеме decimal(10,3)
 *
 * Проверка статическая, потому что поймать это на живой базе почти нельзя:
 * ошибка проявляется только на дробных или очень больших значениях, а на
 * тестовых данных их обычно нет.
 */

const API_DIR = join(__dirname, "..");

/** Минимально допустимые разряды: (целые, дробные). */
const MIN_PRECISION = 15;
const MIN_SCALE = 2;

function* walkTypeScript(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkTypeScript(full);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) yield full;
  }
}

/** Каждое `AS DECIMAL…` в файле: либо без скобок, либо с (p,s). */
function decimalCasts(source: string): Array<{ raw: string; precision?: number; scale?: number }> {
  const out: Array<{ raw: string; precision?: number; scale?: number }> = [];
  const re = /AS\s+DECIMAL\s*(\(\s*(\d+)\s*,\s*(\d+)\s*\))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push(m[1]
      ? { raw: m[0], precision: Number(m[2]), scale: Number(m[3]) }
      : { raw: m[0] });
  }
  return out;
}

describe("приведение к DECIMAL", () => {
  it("всегда с указанной точностью, и не уже колонки", () => {
    const offenders: string[] = [];

    for (const file of walkTypeScript(API_DIR)) {
      const source = readFileSync(file, "utf8");
      const rel = relative(API_DIR, file).split("\\").join("/");

      for (const cast of decimalCasts(source)) {
        if (cast.precision === undefined) {
          offenders.push(`${rel} — «${cast.raw}» без точности: MySQL возьмёт DECIMAL(10,0) и отбросит дробную часть`);
          continue;
        }
        if (cast.precision < MIN_PRECISION || (cast.scale ?? 0) < MIN_SCALE) {
          offenders.push(`${rel} — «${cast.raw}» уже допустимого: нужно минимум DECIMAL(${MIN_PRECISION},${MIN_SCALE})`);
        }
      }
    }

    expect(
      offenders,
      offenders.length === 0 ? "" :
        `Приведение к DECIMAL теряет данные:\n` +
        offenders.map(o => `  - ${o}`).join("\n") +
        `\n\nДеньги — DECIMAL(15,2), количества и вес — DECIMAL(15,3).`,
    ).toEqual([]);
  });

  it("распознаёт и отсутствие точности, и слишком узкую", () => {
    // Страж самого стража: проверка, которая не может упасть, ничего не бережёт.
    expect(decimalCasts("CAST(x AS DECIMAL)")).toEqual([{ raw: "AS DECIMAL" }]);
    expect(decimalCasts("CAST(x AS DECIMAL(10,2))")[0]).toMatchObject({ precision: 10, scale: 2 });
    expect(decimalCasts("CAST(x AS DECIMAL(15,3))")[0]).toMatchObject({ precision: 15, scale: 3 });
    // Пробелы внутри скобок тоже должны разбираться.
    expect(decimalCasts("CAST(x AS DECIMAL( 15 , 2 ))")[0]).toMatchObject({ precision: 15, scale: 2 });
  });
});
