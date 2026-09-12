/**
 * Каждая ручка, которую зовёт мобилка, есть в роутере — и того же рода.
 *
 * contracts/mobile-procedures.json порождает scripts/mobile-contract.mjs из
 * src/api.ts мобильного репозитория (там же — проверка типов, для неё нужен
 * второй репозиторий, и она идёт отдельной джобой CI). Здесь — то, что можно
 * проверить без него: путь существует, query не стал mutation и наоборот.
 * Переименовал ручку на сервере — падает ЭТОТ тест, а не APK у агентов.
 *
 * Нарочная поломка: переименуй в json «order.myOrders» → «order.mine».
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { appRouter } from "../router";

const calls: Array<{ fn: string; path: string; kind: "query" | "mutation" }> =
  JSON.parse(readFileSync("contracts/mobile-procedures.json", "utf8"));

describe("ручки мобилки существуют", () => {
  const procedures = (appRouter as unknown as { _def: { procedures: Record<string, { _def: { type: string } }> } })._def.procedures;

  it("список не пуст и разобран", () => {
    expect(calls.length).toBeGreaterThan(80);
    expect(Object.keys(procedures).length).toBeGreaterThan(300);
  });

  it("каждый путь есть в роутере и того же рода", () => {
    const missing = calls.filter(c => !procedures[c.path]).map(c => `${c.path} (${c.fn})`);
    expect(missing, "мобилка зовёт ручки, которых в роутере нет").toEqual([]);
    const wrongKind = calls
      .filter(c => procedures[c.path] && procedures[c.path]._def.type !== c.kind)
      .map(c => `${c.path}: мобилка ${c.kind}, сервер ${procedures[c.path]._def.type}`);
    expect(wrongKind).toEqual([]);
  });
});
