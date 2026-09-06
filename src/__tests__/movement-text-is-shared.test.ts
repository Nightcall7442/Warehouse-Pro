/**
 * Движение склада описывается словами ровно в одном месте.
 *
 * ── Почему это правило, а не ещё одна заплатка ──────────────────────────────
 *
 * Одна и та же беда всплыла ПЯТЬ раз. Поля stock_movements — referenceType и
 * referenceId — печатались на экран как есть, и человек видел
 * «manual_adjustment #null»: внутреннее слово и номер, которого у ручной
 * правки нет и быть не может.
 *
 * Чинили по очереди: карточку товара, выгрузку в Excel, реестр отчётов. Разбор
 * при этом уже был вынесен в lib/stock-movement-text.ts — но история движений
 * на странице склада о нём не знала и оставалась пятой копией. Каждая правка
 * закрывала своё место и не мешала появиться следующему.
 *
 * Поэтому проверка смотрит не на конкретный экран, а на признак копии: поле
 * подставляется в вывод. Появится шестое место — упадёт здесь, а не у
 * арендатора.
 *
 * ── Что именно ищется ───────────────────────────────────────────────────────
 *
 * `referenceType}` и `referenceId}` — закрывающая скобка означает, что
 * значение подставлено в разметку или в строку. Само по себе имя поля в коде
 * не запрещено: его читают, передают в movementDocument, кладут в тип. Плохо
 * ровно одно — вывести его человеку.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");

/** Разбор живёт здесь — ему поля читать положено. */
const SHARED = join("lib", "stock-movement-text.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("разбор движений склада — один на всех", () => {
  it("ни один экран не подставляет referenceType и referenceId в вывод", () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (rel.endsWith(SHARED)) continue;
      // Проверки вправе называть поля: они как раз описывают, что подставлять
      // их нельзя.
      if (rel.includes("__tests__") || /\.test\.tsx?$/.test(rel)) continue;

      const text = readFileSync(file, "utf8");
      for (const field of ["referenceType", "referenceId"]) {
        if (text.includes(`${field}}`)) offenders.push(`${rel}: ${field}`);
      }
    }

    expect(
      offenders,
      "поля движения подставляются в вывод напрямую — человек увидит " +
      "«manual_adjustment #null». Разбор есть: movementDocument и movementNote " +
      "из lib/stock-movement-text.ts:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("сам разбор на месте и умеет главное", async () => {
    // Без этого правило выше проходило бы и на пустом проекте.
    const { movementDocument, movementNote } = await import("@/lib/stock-movement-text");

    expect(movementDocument("manual_adjustment", null, "ru")).toBe("Ручная правка");
    expect(movementDocument("manual_adjustment", null, "ru")).not.toMatch(/#|null/);
    expect(movementNote("Заказ: new → delivered", "ru")).toBe("Заказ: Новый → Доставлен");
  });
});
