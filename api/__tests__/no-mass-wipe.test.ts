/**
 * В продукте нет ручки, стирающей работу организации одним нажатием.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Три кнопки в трёх местах — «Очистить» на магазинах, «Очистить» на товарах и
 * «Удалить все» на складе — звали процедуры, которые удаляли данные целыми
 * таблицами по всей организации.
 *
 * shop.clearAll (оператор, без доводов) первым делом удалял `payments` и
 * `returns` по всем магазинам. Долг магазина выводится ИМЕННО из этих строк:
 * после нажатия восстановить его было неоткуда. Внешние ключи, которые стоят
 * с restrict как раз против этого, обходились удалением детей первыми.
 *
 * product.clearAll (тоже оператор) шёл дальше и удалял `orders` и `returns`
 * всей организации — всю историю продаж, — причём каждый шаг был обёрнут в
 * «проглотить ошибку»: разрушение получалось частичным и молчаливым.
 *
 * warehouse.deleteAll стирал все остатки склада и гасил все товары.
 *
 * ── Почему правило, а не подтверждение ──────────────────────────────────────
 *
 * Сначала напрашивается защита: только руководителю, набрать слово, отказать
 * при наличии денег. Но у действия «стереть всё» нет случая, ради которого
 * стоило бы держать его в рабочем продукте: пробные данные чистятся до начала
 * работы, а дальше цена промаха — вся компания. Владелец сказал прямо:
 * директору это тоже не нужно.
 *
 * Одиночное и массовое удаление остаются и безопасны по устройству:
 * shop.delete при любой ссылке переводит магазин в «неактивен», а не стирает.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const API = join(__dirname, "..");
const SRC = join(__dirname, "..", "..", "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("массовой очистки в продукте нет", () => {
  it("ни один роутер не объявляет процедуру-очистку", () => {
    const offenders: string[] = [];
    for (const file of walk(API)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/^\s*(clearAll|deleteAll|wipeAll|truncateAll)\s*:/gm)) {
        offenders.push(`${relative(API, file)}: ${m[1]}`);
      }
    }
    expect(
      offenders,
      "процедура стирает данные организации целыми таблицами — такого действия " +
      "не должно быть ни у кого, включая руководителя:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("ни один экран не зовёт такую процедуру", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/trpc\.\w+\.(clearAll|deleteAll)\b/g)) {
        offenders.push(`${relative(SRC, file)}: ${m[0]}`);
      }
    }
    expect(offenders, "экран зовёт массовую очистку:\n" + offenders.join("\n")).toEqual([]);
  });

  it("удаление магазина по-прежнему щадящее", () => {
    /*
      Обратная сторона: убрав массовую очистку, нельзя случайно сделать
      одиночное удаление жёстким. При любой ссылке (заказы, платежи, планы)
      магазин переводится в «неактивен» — история остаётся.
    */
    const shopRouter = readFileSync(join(API, "shop-router.ts"), "utf8");
    const del = shopRouter.slice(shopRouter.indexOf("  delete: operatorQuery"));
    expect(del, "мягкое удаление магазина пропало").toMatch(/status:\s*"inactive"/);
  });
});
