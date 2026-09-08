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

  it("магазин стирается ровно в одном месте и только под проверкой", () => {
    /*
      Обратная сторона: убрав массовую очистку, нельзя случайно сделать
      одиночное удаление жёстким.

      Раньше правило звучало «при любой ссылке магазин переводится в
      неактивен», и проверка искала эту строку в обработчике delete. Само
      правило держалось на ошибке внешнего ключа: обработчик ПРОБОВАЛ стереть
      строку и переходил к мягкому пути, только когда база не давала. У точки
      без заказов база давала — и она исчезала вместе с адресом, координатами и
      фотографией, при том что окно обещало одно и то же в обоих случаях.

      Теперь это два разных действия (services/shop-archive.ts), и правило
      сильнее: стереть строку можно ровно в одном месте кода и только после
      проверки, что за точкой ничего не числится.
    */
    const offenders: string[] = [];
    for (const file of walk(API)) {
      if (file.includes("__tests__")) continue;
      const rel = relative(API, file);
      if (rel.split(/[\\/]/).join("/") === "services/shop-archive.ts") continue;
      if (/\.delete\(\s*shops\s*\)/.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }
    expect(
      offenders,
      "магазин стирается в обход services/shop-archive.ts — там стоит проверка " +
      "истории, и мимо неё точка исчезает вместе с заказами:\n" + offenders.join("\n"),
    ).toEqual([]);

    const archive = readFileSync(join(API, "services", "shop-archive.ts"), "utf8");
    // Стирание закрыто отказом, а отказ — перечнем того, что бы пропало.
    expect(archive, "проверка истории перед удалением пропала")
      .toMatch(/if \(trace\.total > 0\) throw new ShopHasHistoryError/);
    // Архивация остаётся мягкой: строка на месте, статус меняется.
    expect(archive, "архивация перестала быть мягкой").toMatch(/status:\s*"inactive"/);
  });
});
