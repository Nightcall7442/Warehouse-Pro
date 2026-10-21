/**
 * «Проводить правку остатка без утверждения» (warehouse.apply) закрывает
 * каждый путь, где остаток правят рукой, — а где не закрывает, там это
 * решение записано с причиной.
 *
 * ── Что считается правкой ───────────────────────────────────────────────────
 *
 * Движение без встречного документа: остаток назначают числом (setStock) или
 * пишут движение с причиной «ручная правка», «загрузка из файла»,
 * «инвентаризация», «возврат поставщику», «обмен с 1С». Приход от
 * поставщика, перемещение, заказ и возврат магазина сюда не входят: у них
 * есть встречный документ, и закрываются они своими правами
 * (suppliers.manage, warehouse.adjust, orders.edit).
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Каждый файл api/, где такая правка пишется, стоит ровно в одном списке:
 * GATED — и в нём есть то, что отправляет правку директору, — или
 * EXCEPTIONS с причиной. Новый путь правки, не попавший ни в один список, —
 * красный тест: закрывать его или нет, решает человек, а не забывчивость.
 *
 * Поведение (заявка вместо движения, утверждение разницей) — на настоящей
 * базе: real-db/stock-count-approval.test.ts.
 *
 * Нарочная поломка: убери needsStockApproval из import-router.ts — тест
 * назовёт файл; добавь `setStock(` в новый файл — тест потребует решения.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const API_DIR = join(__dirname, "..");
const DOOR = "services/stock-ledger.ts";

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) yield full;
  }
}

/** Комментарии не в счёт: путь правки — это код, а не упоминание. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const sources = [...walk(API_DIR)]
  .map(f => ({ rel: relative(API_DIR, f).split("\\").join("/"), src: code(readFileSync(f, "utf8")) }))
  .filter(f => f.rel !== DOOR);

const CORRECTION = /setStock\(|reason: "(manual_adjustment|import|inventory|supplier_return|onec_sync)"/;

/** Файл → что в нём отправляет правку директору вместо движения. */
const GATED: Record<string, string[]> = {
  // Ручная правка: оператор без права получает заявку (mode "request").
  "services/stock.ts": ['if (mode === "request")', "requestAdjust("],
  // Начальные остатки из файла: товары с нулём, числа — директору одним документом.
  "import-router.ts": ["needsStockApproval(", "requestImportStock(", "quantity: askApproval ? 0 : row.initialStock"],
  // Цикл проведения документа: зовут его только «Применить» (can warehouse.apply)
  // и «Утвердить» (директор) — проверяется ниже по роутеру.
  "services/stock-count.ts": ["export async function applyCountLines("],
};

/** Файл → почему правка здесь идёт без утверждения. */
const EXCEPTIONS: Record<string, string> = {
  "supplier-router.ts":
    "возврат поставщику — документ с контрагентом и деньгами: долг поставщику уменьшается в той же транзакции, " +
    "заявка развела бы деньги и товар; закрывается правом suppliers.manage",
  "services/onec-sync.ts":
    "обмен с 1С заводит товар со строкой остатка ноль — количества не меняет; обмен включает директор (onec.* — adminQuery)",
  "webhooks/onec.ts":
    "остаток приходит из учётной системы 1С по ключу интеграции, которую настроил директор, — не от оператора",
};

describe("правка остатка: утверждение или записанное исключение", () => {
  const writers = sources.filter(s => CORRECTION.test(s.src)).map(s => s.rel).sort();

  it("каждый путь правки остатка классифицирован", () => {
    const unknown = writers.filter(f => !(f in GATED) && !(f in EXCEPTIONS));
    expect(unknown, "новый путь правки остатка: отправьте его на утверждение или запишите исключение с причиной").toEqual([]);
  });

  it("списки не врут: каждый файл в них действительно правит остаток", () => {
    // Иначе исключение переживёт сам путь и однажды прикроет новый.
    const stale = [...Object.keys(GATED), ...Object.keys(EXCEPTIONS)].filter(f => !writers.includes(f));
    expect(stale).toEqual([]);
  });

  it("закрытые пути отправляют правку директору", () => {
    const missing: string[] = [];
    for (const [file, marks] of Object.entries(GATED)) {
      const src = sources.find(s => s.rel === file)!.src;
      for (const m of marks) if (!src.includes(m)) missing.push(`${file}: ${m}`);
    }
    expect(missing).toEqual([]);
  });

  it("ручная правка спрашивает право внутри ручки, а не отказывает стражем", () => {
    // Отказ FORBIDDEN оставил бы склад без правки; заявка — нет.
    const router = code(readFileSync(join(API_DIR, "warehouse-router.ts"), "utf8"));
    const at = router.indexOf("adjustStock: operatorQuery");
    const body = router.slice(at, router.indexOf("}),", at));
    expect(body).toContain('.use(can("warehouse.adjust"))');
    expect(body).not.toContain('can("warehouse.apply")');
    expect(body).toContain("needsStockApproval(ctx.db, ctx.tenant.id, ctx.user.role)");
    expect(body).toContain("input.warehouseId, mode)");
  });

  it("применить самому — с правом; утвердить и вернуть — только директор", () => {
    const router = readFileSync(join(API_DIR, "stock-count-router.ts"), "utf8");
    expect(router).toMatch(/^ {2}applyCount: operatorQuery\.use\(can\("warehouse\.adjust"\)\)\.use\(can\("warehouse\.apply"\)\)/m);
    expect(router).toMatch(/^ {2}approveCount: adminQuery\b/m);
    expect(router).toMatch(/^ {2}rejectCount: adminQuery\b/m);
    // Отправить может любой, кто правит склад: это и есть путь без права.
    expect(router).toMatch(/^ {2}submitCount: operatorQuery\.use\(can\("warehouse\.adjust"\)\)\n/m);
    // Цикл проведения зовут только эти двое.
    const callers = sources.filter(s => s.src.includes("applyCountLines(") && s.rel !== "services/stock-count.ts").map(s => s.rel);
    expect(callers).toEqual(["stock-count-router.ts"]);
  });

  it("«Завести строки остатков» (backfillStock) не меняет количеств — поэтому не закрыт", () => {
    // Заводит пустые строки под товары без них: три нуля, никакого движения.
    const router = code(readFileSync(join(API_DIR, "warehouse-router.ts"), "utf8"));
    const at = router.indexOf("backfillStock: operatorQuery");
    const body = router.slice(at, router.indexOf("}),", at));
    expect(body).toMatch(/currentStock: "0\.00",\s*reserved: "0\.00",\s*available: "0\.00"/);
    expect(body).not.toMatch(/setStock|receiveStock|applyStockEffect|recordStockMovement/);
  });
});
