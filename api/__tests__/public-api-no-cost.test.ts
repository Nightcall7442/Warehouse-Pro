import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* ═══════════════════════════════════════════════════════════════════════════
   Публичный API не отдаёт закупочную цену.

   ── Что было (аудит 19.10.2026) ─────────────────────────────────────────────

   /api/v1/products, /products/:id и позиции /orders/:id выбирались select()
   всей строки, и интегратор с ключом — тот, кому дистрибьютор открыл заказы
   и каталог, — видел costPrice товара и позиции, то есть закупку и маржу
   дистрибьютора. Внутри приложения себестоимость показывается только
   директору (financeQuery), а наружу она уходила любому ключу.

   ── Что проверяется ─────────────────────────────────────────────────────────

   · товары и позиции выбираются перечнем колонок, а не всей строкой —
     новая колонка в таблице не уйдёт наружу сама;
   · ни в одном файле публичной выгрузки нет costPrice.

   Нарочная поломка: верни db.select().from(products) в /products — упадёт
   первая проверка; добавь costPrice в PUBLIC_PRODUCT — вторая.
   ═══════════════════════════════════════════════════════════════════════════ */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** Комментарий — не код. */
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const PUBLIC_FILES = ["api/public-api.ts", "api/public/orders-v1.ts", "api/public/order-export.ts"];

describe("публичный API: закупочная цена наружу не уходит", () => {
  it("товары и позиции заказа — перечнем колонок, а не всей строкой", () => {
    const gate = strip(read("api/public-api.ts"));
    expect(gate, "товар выбирается всей строкой").not.toMatch(/\.select\(\)\s*\.from\(products\)/);
    expect(gate, "позиция выбирается всей строкой").not.toMatch(/\.select\(\)\s*\.from\(orderItems\)/);
    expect(gate).toMatch(/\.select\(PUBLIC_PRODUCT\)\s*\.from\(products\)/);
  });

  it("costPrice нет ни в одном файле публичной выгрузки", () => {
    for (const f of PUBLIC_FILES) {
      expect(strip(read(f)), `${f} упоминает закупочную цену`).not.toMatch(/costPrice|cost_price/);
    }
  });
});
