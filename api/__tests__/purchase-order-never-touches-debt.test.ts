/**
 * Заказ поставщику долга не создаёт; долг по нему рождается в одном месте —
 * на проведении прихода, в той же транзакции, что кладёт товар на склад
 * (ADR 0013).
 *
 * ── Почему страж ────────────────────────────────────────────────────────────
 *
 * Самая естественная «доработка» заказа — завести поставку при согласовании
 * («мы же уже договорились о сумме») или при создании прихода по нему. Тогда
 * в «Контрагентах» висел бы долг за товар, которого нет на полке, и при
 * недовозе его пришлось бы править руками. Тест реальной базы
 * (real-db/purchase-order-flow) ловит это поведением, но только на тех путях,
 * которые проходит; этот — по исходнику, на всех.
 *
 * Нарочная поломка: впиши `tx.insert(supplies)` в approvePurchaseOrder —
 * упадёт первый тест; перенеси applyReceiptTx выше receiveStock в
 * updateArrival — упадёт последний.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const API = join(__dirname, "..");
const read = (p: string) => readFileSync(join(API, p), "utf8").replace(/\r\n/g, "\n");

/** Пояснения выкидываются: правило про код, а не про рассказ о нём. */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Запись в таблицу — drizzle-вызовом или сырым SQL. */
const writes = (src: string, table: { drizzle: string; sql: string }) => [
  ...src.matchAll(new RegExp(String.raw`\.(insert|update|delete)\(\s*${table.drizzle}\b`, "g")),
  ...src.matchAll(new RegExp(String.raw`(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+\`?${table.sql}\b`, "gi")),
].map(m => m[0]);

const DEBT_AND_STOCK = [
  { drizzle: "supplies", sql: "supplies" },
  { drizzle: "supplierPayments", sql: "supplier_payments" },
  { drizzle: "warehouseStock", sql: "warehouse_stock" },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.ts$/.test(name)) out.push(full);
  }
  return out;
}

describe("заказ поставщику и долг", () => {
  it("сервис и роутер заказа не пишут ни долг, ни оплату, ни остаток", () => {
    const found: string[] = [];
    for (const file of ["services/purchase-order.ts", "purchase-order-router.ts"]) {
      const src = stripComments(read(file));
      for (const t of DEBT_AND_STOCK) for (const w of writes(src, t)) found.push(`${file}: ${w}`);
    }
    expect(found).toEqual([]);
  });

  it("в файле приёмки поставка заводится один раз — внутри applyReceiptTx", () => {
    const src = stripComments(read("services/purchase-order-receipt.ts"));
    const inserts = [...src.matchAll(/\.insert\(\s*supplies\b/g)];
    expect(inserts).toHaveLength(1);
    const start = src.indexOf("export async function applyReceiptTx(");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("\nexport ", start + 1);
    const body = src.slice(start, end < 0 ? undefined : end);
    expect(body).toContain(".insert(supplies)");
    // Ни оплаты, ни остатка здесь нет: остаток кладёт приход, оплату — человек.
    for (const t of DEBT_AND_STOCK.slice(1)) expect(writes(src, t)).toEqual([]);
  });

  it("applyReceiptTx зовёт только проведение прихода", () => {
    const callers = walk(API)
      .map(f => ({ rel: relative(API, f).replace(/\\/g, "/"), src: stripComments(readFileSync(f, "utf8")) }))
      .filter(f => /applyReceiptTx\(/.test(f.src) && !f.src.includes("export async function applyReceiptTx("))
      .map(f => f.rel);
    expect(callers).toEqual(["services/arrival.ts"]);
  });

  it("на проведении: замок заказа до остатка, долг — после, в той же транзакции", () => {
    const src = stripComments(read("services/arrival.ts"));
    const start = src.indexOf("export async function updateArrival(");
    const end = src.indexOf("\nexport ", start + 1);
    const body = src.slice(start, end);
    const tx = body.indexOf("db.transaction(");
    const lock = body.indexOf("lockReceivingOrderTx(tx");
    const stock = body.indexOf("receiveStock(tx");
    const debt = body.indexOf("applyReceiptTx(tx");
    expect([tx, lock, stock, debt].every(i => i > -1)).toBe(true);
    expect(tx).toBeLessThan(lock);
    expect(lock).toBeLessThan(stock);
    expect(stock).toBeLessThan(debt);
  });
});
