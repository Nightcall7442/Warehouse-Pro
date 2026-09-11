/**
 * Храповик: остаток меняет только дверь (services/stock-ledger.ts).
 *
 * Дверь построили, но четыре пути шли мимо неё своим SQL: корректировка
 * (StockService.adjust), перемещение между складами, вебхук остатков 1С и
 * импорт из файла. Каждый поддерживал available руками, и ни один не трогал
 * партии — журнал «что сгорает» показывал товар, которого на полке нет.
 *
 * Правило: вне двери нет ни одного UPDATE warehouse_stock и ни одного
 * ON DUPLICATE KEY UPDATE по ней. INSERT допустим только как заведение
 * ПУСТОЙ строки под новый товар (все три числа — «0.00») и один особый случай:
 * откат удаления товара возвращает строки, которые сам же только что убрал.
 *
 * Ослаблять список исключений нельзя — только сокращать.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const API_DIR = join(__dirname, "..");
const DOOR = "services/stock-ledger.ts";
/** Возврат строк, снятых удалением товара, — не движение, а откат. */
const INSERT_EXCEPTIONS = new Set(["product-router.ts"]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) yield full;
  }
}

const sources = [...walk(API_DIR)]
  .map(f => ({ rel: relative(API_DIR, f).split("\\").join("/"), src: readFileSync(f, "utf8") }))
  .filter(f => f.rel !== DOOR);

describe("остаток меняет только дверь", () => {
  it("UPDATE warehouse_stock вне двери — ноль", () => {
    const offenders: string[] = [];
    for (const { rel, src } of sources) {
      const n = (src.match(/UPDATE\s+warehouse_stock\b/gi) ?? []).length
        + (src.match(/\.update\(\s*warehouseStock\s*\)/g) ?? []).length
        + (src.match(/warehouseStock[\s\S]{0,400}?onDuplicateKeyUpdate/g) ?? []).length
        + (src.match(/INSERT\s+INTO\s+warehouse_stock[\s\S]{0,400}?ON\s+DUPLICATE\s+KEY\s+UPDATE/gi) ?? []).length;
      if (n > 0) offenders.push(`${rel} (${n})`);
    }
    expect(offenders, `Остаток правится мимо двери:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("INSERT вне двери заводит только пустую строку", () => {
    const offenders: string[] = [];
    for (const { rel, src } of sources) {
      if (INSERT_EXCEPTIONS.has(rel)) continue;
      const re = /(\.insert\(\s*warehouseStock\s*\)\.values\(|INSERT\s+INTO\s+warehouse_stock\b)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const body = src.slice(m.index, m.index + 500);
        const zeros = (body.match(/["']0\.00["']/g) ?? []).length;
        if (zeros < 3) offenders.push(`${rel}: ${body.split("\n")[0].trim()}`);
      }
    }
    expect(offenders, `INSERT с количеством мимо двери:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("четыре пути идут через дверь", () => {
    const by = (rel: string) => sources.find(s => s.rel === rel)!.src;
    const adjust = by("services/stock.ts");
    expect(adjust).toContain("receiveStock(tx, {");
    expect(adjust).toContain("shift: { onHand: -1, held: 0 }, reason: \"manual_adjustment\"");
    expect(adjust).toContain("setStock(tx, { tenantId, warehouseId: whId, productId, quantity })");
    const transfer = by("warehouse-multi-router.ts");
    expect(transfer).toContain('reason: "transfer_out"');
    expect(transfer).toContain("receiveStock(tx, {");
    expect(by("webhooks/onec.ts")).toContain("setStock(tx, { tenantId, warehouseId: defaultWarehouse.id, productId, quantity: parsedQty })");
    expect(by("import-router.ts")).not.toContain("INSERT INTO warehouse_stock");
  });

  it("setStock заводит строку сам (импорт и 1С приносят итог по новому товару)", () => {
    const door = readFileSync(join(API_DIR, DOOR), "utf8");
    const i = door.indexOf("export async function setStock");
    const body = door.slice(i, i + 1500);
    expect(body).toMatch(/INSERT INTO warehouse_stock[\s\S]*ON DUPLICATE KEY UPDATE[\s\S]*current_stock = \$\{q\}/);
    expect(body).toMatch(/available\s+= current_stock - reserved/);
  });
});
