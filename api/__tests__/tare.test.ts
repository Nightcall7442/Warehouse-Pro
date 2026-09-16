/**
 * Возвратная тара: штуки и залог, тара следует за товаром.
 *
 * ── Что стережётся ──────────────────────────────────────────────────────────
 *
 *   · план движения тары по движению товара: приход — склад +; продажа —
 *     склад −, магазин +; возврат — наоборот; перемещение — только склад;
 *     величина — количество × тары на единицу; ноль и «adjustment» — ничего;
 *   · крючок стоит в единственной двери остатка (recordStockMovement);
 *   · залог — свойство вида; ноль означает «только штуками» (charge без денег);
 *   · права: виды, тумблер, списание в долг — директор; приём тары — кладовщик
 *     или водитель на свою машину; тара товара — право products.manage;
 *   · пересчёт машины считает тару и кладёт недостачу по залогу в тот же долг;
 *   · экраны под тумблером: настройки, вкладка «Тара», карточка товара и
 *     магазина; журнал действий знает tare.*; таблицы стираются при уходе
 *     организации; миграция 0049 без хвостового маркера.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { followPlan, planAllowsTare } from "../services/tare";

const ROOT = join(__dirname, "..", "..");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\r\n]*\/\/.*$/gm, "");
const read = (p: string) => strip(readFileSync(join(ROOT, p), "utf8"));

describe("тара следует за товаром", () => {
  const base = { quantity: 3, perUnit: 20, warehouseId: 5, shopId: 9 };
  it("продажа: со склада — магазину; возврат — обратно; величина — штуки × тары на единицу", () => {
    expect(followPlan({ ...base, type: "out", reason: "order_delivery" })).toEqual([
      { holder: { kind: "warehouse", id: 5 }, delta: -60 }, { holder: { kind: "shop", id: 9 }, delta: 60 },
    ]);
    expect(followPlan({ ...base, type: "in", reason: "order_return" })).toEqual([
      { holder: { kind: "warehouse", id: 5 }, delta: 60 }, { holder: { kind: "shop", id: 9 }, delta: -60 },
    ]);
    expect(followPlan({ ...base, type: "in", reason: "return_completed" })[1]).toEqual({ holder: { kind: "shop", id: 9 }, delta: -60 });
  });
  it("приход, перемещение, пересчёт — только склад; без магазина — только склад", () => {
    expect(followPlan({ ...base, type: "in", reason: "arrival" })).toEqual([{ holder: { kind: "warehouse", id: 5 }, delta: 60 }]);
    expect(followPlan({ ...base, type: "out", reason: "transfer_out" })).toEqual([{ holder: { kind: "warehouse", id: 5 }, delta: -60 }]);
    expect(followPlan({ ...base, type: "in", reason: "transfer_in" })).toEqual([{ holder: { kind: "warehouse", id: 5 }, delta: 60 }]);
    expect(followPlan({ ...base, type: "out", reason: "inventory" })).toEqual([{ holder: { kind: "warehouse", id: 5 }, delta: -60 }]);
    expect(followPlan({ ...base, type: "out", reason: "order_delivery", shopId: null })).toHaveLength(1);
  });
  it("ноль, дробь и «adjustment» — ничего или ровно столько", () => {
    expect(followPlan({ ...base, type: "in", reason: "arrival", quantity: 0 })).toEqual([]);
    expect(followPlan({ ...base, type: "adjustment", reason: "manual_adjustment" })).toEqual([]);
    expect(followPlan({ ...base, type: "out", reason: "order_delivery", quantity: 1.5, perUnit: 1 })[0].delta).toBe(-1.5);
  });
  it("крючок — в единственной двери остатка", () => {
    const door = read("api/services/stock-ledger.ts");
    expect(door).toMatch(/const \{ followStock \} = await import\("\.\/tare"\);\s*await followStock\(tx, \{/);
    expect((read("api/services/tare.ts").match(/reason: "follow"/g) ?? []).length).toBe(1);
  });
});

describe("залог и права", () => {
  const svc = read("api/services/tare.ts");
  const router = read("api/tare-router.ts");
  it("тариф: пробный, Pro, Exclusive; залог ноль — только штуками, деньги не рождаются", () => {
    expect(["trial", "pro", "exclusive"].map(planAllowsTare)).toEqual([true, true, true]);
    expect(planAllowsTare("basic")).toBe(false);
    expect(svc).toContain("const amount = round2(input.quantity * held.depositPrice);");
    expect(svc).toContain("if (amount > 0) {");
    expect(svc).toMatch(/type: "debt", notes: `Тара не возвращена/);
    expect(svc).toContain("await recalcShopDebt(tx, tenantId, shop.id);");
  });
  it("больше, чем числится за магазином, ни принять, ни списать нельзя", () => {
    expect((svc.match(/h\?\.qty \?\? 0\} \$\{h\?\.name \?\? "тары"\} — принять/g) ?? []).length).toBe(1);
    expect(svc).toContain("— списать ${input.quantity} нельзя");
  });
  it("виды, тумблер, списание — директор; тара товара — products.manage; приём — кладовщик или водитель своей машины", () => {
    const proc = (name: string) => (router.match(new RegExp(`^  ${name}: (\\w+(?:\\.use\\(can\\("[a-z.]+"\\)\\))?)`, "m")) ?? [])[1];
    expect(proc("setEnabled")).toBe("adminQuery");
    expect(proc("saveType")).toBe("adminQuery");
    expect(proc("charge")).toBe("adminQuery");
    expect(proc("setProductTare")).toBe('operatorQuery.use(can("products.manage"))');
    expect(proc("count")).toBe("stockQuery");
    expect(router).toContain('if (!isBoss && !(wh.kind === "van" && wh.driverId === ctx.user.id)) throw badRequest("Принять тару можно на свою машину; на склад — кладовщик");');
    expect(read("api/router.ts")).toContain("tare:         tareRouter,");
  });
  it("пересчёт машины считает тару и кладёт недостачу по залогу в тот же долг водителя", () => {
    const van = read("api/services/van.ts");
    expect(van).toContain("const t = await TareService.count(tx, tenantId, actor, { warehouseId: van.id, counted: input.tare });");
    expect(van).toContain("shortage += t.shortage;");
    expect(van).toContain("(тара) −");
  });
});

describe("экраны и хозяйство", () => {
  it("настройки, вкладка «Тара», карточка товара и магазина — под тумблером", () => {
    expect(read("src/pages/Settings.tsx")).toMatch(/key: "tare", Icon: Boxes, roles: \["ceo"\]/);
    const wh = read("src/pages/Warehouse.tsx");
    expect(wh).toContain('...(tareOn ? [{ key: "tare" as const, label: t("Тара", "Idish"), count: 0 }] : [])');
    expect(wh).toContain('{activeTab === "tare" && tareOn && <TareTab />}');
    expect(read("src/pages/ProductDetail.tsx")).toContain("<ProductTare productId={product.id}");
    expect(read("src/pages/ShopDetail.tsx")).toContain("<ShopTare shopId={Number(id)} shopName={shop.name} />");
    for (const f of ["src/components/tare/ProductTare.tsx", "src/components/shops/ShopTare.tsx"]) expect(read(f)).toContain("if (!status.data?.enabled) return null;");
    expect(read("src/components/settings/TareSettings.tsx")).toContain("disabled={!planAllows || setEnabled.isPending}");
    expect(read("src/components/warehouse/VansTab.tsx")).toContain("tare: tare.length ? tare : undefined");
  });
  it("журнал действий знает tare.*; таблицы стираются при уходе организации; стенд их чистит", () => {
    const labels = read("contracts/audit-text.ts"), cfg = read("src/pages/AuditLog.tsx");
    for (const a of ["tare.enabled", "tare.disabled", "tare.type_created", "tare.type_updated", "tare.product_set", "tare.returned", "tare.charged"]) {
      expect(labels, a).toContain(`"${a}": { ru:`);
      expect(cfg, a).toContain(`"${a}":`);
    }
    const off = read("api/services/tenant-offboard.ts");
    expect(off.indexOf('"tare_movements"')).toBeLessThan(off.indexOf('"tare_types"'));
    expect(read("api/__tests__/real-db/harness.ts")).toContain('"tare_movements", "tare_types",');
  });
  it("миграция 0049: две таблицы, три поля, без хвостового маркера", () => {
    const sql = readFileSync(join(ROOT, "db/migrations/0049_tare.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE `tare_types`");
    expect(sql).toContain("CREATE TABLE `tare_movements`");
    expect(sql).toContain("ALTER TABLE `products` ADD `tare_type_id` bigint unsigned;");
    expect(sql).toContain("ALTER TABLE `products` ADD `tare_per_unit` decimal(10,3) DEFAULT '1.000' NOT NULL;");
    expect(sql).toContain("ALTER TABLE `settings` ADD `tare_enabled` boolean DEFAULT false NOT NULL;");
    expect(sql.trimEnd().endsWith("--> statement-breakpoint")).toBe(false);
  });
});
