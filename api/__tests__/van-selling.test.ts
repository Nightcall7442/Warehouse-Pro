/**
 * Ван-селлинг: машина — склад с водителем; загрузка под PIN; продажа с
 * колёс; пересчёт с недостачей долгом водителя.
 *
 * ── Что стережётся ──────────────────────────────────────────────────────────
 *
 *   · тариф: пробный, Pro и Exclusive — да; Basic — нет; тумблер в настройках;
 *   · права: машины и тумблер — директор; загрузка, возврат, пересчёт —
 *     право «warehouse.adjust»; продажа — водитель или кассир за него;
 *   · загрузка подписывается PIN водителя (тем же, что в кассе) или бумагой;
 *   · продажа с колёс: заказ рождается доставленным, помнит машину, товар
 *     уходит с машины без резерва, деньги — платёж от имени водителя;
 *   · заказ с машины в работу не возвращается;
 *   · недостача при пересчёте — долг водителя в кассе по цене продажи,
 *     счёт «недостача товара» подписан словами в журнале кассы;
 *   · экраны: раздел в настройках, вкладка «Машины» на складе, «С машины»
 *     в заказах — всё под тумблером; журнал действий знает события van.*;
 *   · миграция 0048 — ровно семь полей и три ключа, без хвостового маркера.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planAllowsVan, VAN_DRIVER_ROLES } from "../services/van";
import { ACCOUNT } from "../services/cash";

const ROOT = join(__dirname, "..", "..");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\r\n]*\/\/.*$/gm, "");
const read = (p: string) => strip(readFileSync(join(ROOT, p), "utf8"));

describe("тариф и роли", () => {
  it("пробный, Pro и Exclusive — да; Basic — нет", () => {
    expect(["trial", "pro", "exclusive"].map(planAllowsVan)).toEqual([true, true, true]);
    expect(planAllowsVan("basic")).toBe(false);
  });
  it("водитель — курьер, агент или супервайзер; счёт недостачи именован по машине", () => {
    expect([...VAN_DRIVER_ROLES]).toEqual(["courier", "agent", "supervisor"]);
    expect(ACCOUNT.stockShortage(7)).toBe("stock.shortage.7");
  });
});

describe("права в роутере", () => {
  const router = read("api/van-router.ts");
  it("машины и тумблер — директор; склад — право warehouse.adjust; продажа и список — любой вошедший (сервис сам решает, чья машина)", () => {
    expect(router).toContain('const stockQuery = operatorQuery.use(can("warehouse.adjust"));');
    // Имя ручки — с начала строки: «unload:» иначе прикрывал бы собой «load:».
    const proc = (name: string) => (router.match(new RegExp(`^  ${name}: (\\w+)`, "m")) ?? [])[1];
    for (const p of ["setEnabled", "save"]) expect(proc(p), p).toBe("adminQuery");
    for (const p of ["load", "unload", "count"]) expect(proc(p), p).toBe("stockQuery");
    for (const p of ["status", "list", "stock", "sale", "sales"]) expect(proc(p), p).toBe("authedQuery");
    // Каждое действие с товаром и деньгами — под тумблером и тарифом.
    expect((router.match(/await assertVanSelling\(getDb\(\), ctx\.tenant\.id, ctx\.tenant\.plan\);/g) ?? []).length).toBe(4);
    expect(router).toContain('if (input.enabled && !planAllowsVan(ctx.tenant.plan)) throw badRequest("Ван-селлинг доступен на тарифах Pro и Exclusive");');
    expect(read("api/router.ts")).toContain("van:          vanRouter,");
  });
});

describe("сервис", () => {
  const svc = read("api/services/van.ts");
  it("загрузка — под PIN водителя или подписью на бумаге; чужой PIN — отказ", () => {
    expect(svc).toContain("const signedAt = await assertDriverSigned(db, tenantId, van.driverId, input);");
    expect(svc).toContain('throw badRequest("PIN не подошёл")');
    expect(svc).toContain("acceptedBy: van.driverId,");
    expect(svc).toMatch(/fromWarehouseId: main\.id, toWarehouseId: van\.id/);
  });
  it("продажа: доставлен сразу, помнит машину, без резерва, платёж от имени водителя, идемпотентна", () => {
    expect(svc).toMatch(/status: "delivered", deliveryStatus: "delivered", deliveredAt: now/);
    expect(svc).toContain("paymentMethod: input.paymentMethod, warehouseId: van.id,");
    expect(svc).toMatch(/shift: \{ onHand: -1, held: 0 \}, reason: "order_delivery", referenceId: id/);
    expect(svc).not.toMatch(/reserveStock\(/);
    expect(svc).toContain("createdBy: seller,");
    expect(svc).toContain('throw badRequest("С этой машины продаёт её водитель")');
    expect(svc).toContain("eq(orders.idempotencyKey, input.idempotencyKey)");
    expect(svc).toContain("await recalcShopDebt(tx, tenantId, input.shopId);");
  });
  it("пересчёт: недостача — долг водителя по цене продажи, излишек — приход без долга", () => {
    expect(svc).toContain("if (diff < 0) shortage += -diff * Number(r.unitPrice);");
    expect(svc).toContain("userId: van.driverId!, amount: shortage, credit: ACCOUNT.stockShortage(van.id),");
    expect(svc).toMatch(/shift: \{ onHand: diff < 0 \? -1 : 1, held: 0 \}, reason: "inventory"/);
  });
  it("долг сотрудника не деньгами проводится тем же документом, что недостача по кассе", () => {
    const cash = read("api/services/cash.ts");
    expect(cash).toMatch(/async chargeEmployee\(tx: Tx[\s\S]*?kind: "rko", posting: \{ debit: ACCOUNT\.employeeDebt\(input\.userId\), credit: input\.credit, amount \}/);
  });
  it("заказ с машины в работу не возвращается", () => {
    const reopen = read("api/services/order-reopen.ts");
    expect(reopen).toContain("if (van?.warehouseId) {");
    expect(reopen).toContain("продажа с машины: вернуть его в работу нельзя");
  });
});

describe("экраны", () => {
  it("раздел в настройках — директору; вкладка «Машины» и «С машины» — только при включённом тумблере", () => {
    expect(read("src/pages/Settings.tsx")).toMatch(/key: "van", Icon: Truck, roles: \["ceo"\]/);
    const wh = read("src/pages/Warehouse.tsx");
    expect(wh).toContain('...(vanOn ? [{ key: "vans" as const, label: t("Машины", "Mashinalar"), count: 0 }] : [])');
    expect(wh).toContain('{activeTab === "vans" && vanOn && <VansTab />}');
    const orders = read("src/pages/Orders.tsx");
    expect(orders).toContain("{vanStatus.data?.enabled && (");
    expect(orders).toContain('data-testid="orders-van-sale"');
    expect(orders).toContain("{o.warehouseId != null && <Truck");
    expect(read("api/services/order-read.ts")).toContain("warehouseId: orders.warehouseId,");
  });
  it("окна зовут свои ручки; тумблер выключен для Basic с подсказкой", () => {
    const tab = read("src/components/warehouse/VansTab.tsx");
    for (const m of ["trpc.van.load.useMutation", "trpc.van.unload.useMutation", "trpc.van.count.useMutation", "trpc.van.sales.useQuery"]) expect(tab).toContain(m);
    expect(tab).toContain('data-testid="van-pin"');
    const sale = read("src/components/orders/VanSaleModal.tsx");
    expect(sale).toContain("trpc.van.sale.useMutation");
    expect(sale).toContain("idempotencyKey: key");
    const st = read("src/components/settings/VanSettings.tsx");
    expect(st).toContain("disabled={!planAllows || setEnabled.isPending}");
    expect(st).toContain('t("Доступно на тарифах Pro и Exclusive"');
  });
  it("журнал действий и касса знают новые события и счёт", () => {
    const labels = read("contracts/audit-text.ts"), cfg = read("src/pages/AuditLog.tsx");
    for (const a of ["van.enabled", "van.disabled", "van.created", "van.updated", "van.loaded", "van.unloaded", "van.counted", "van.sale"]) {
      expect(labels, a).toContain(`"${a}": { ru:`);
      expect(cfg, a).toContain(`"${a}":`);
    }
    expect(read("src/lib/cash-labels.ts")).toContain('[a => a.startsWith("stock.shortage."), "недостача товара"');
  });
});

describe("миграция 0048", () => {
  it("семь полей, три ключа, без хвостового маркера", () => {
    const sql = readFileSync(join(ROOT, "db/migrations/0048_van_selling.sql"), "utf8");
    const stmts = sql.split("--> statement-breakpoint").map(x => x.trim()).filter(Boolean);
    expect(stmts).toHaveLength(10);
    expect(sql).toContain("ALTER TABLE `warehouses` ADD `kind` enum('warehouse','van') DEFAULT 'warehouse' NOT NULL;");
    expect(sql).toContain("ALTER TABLE `orders` ADD `warehouse_id` bigint unsigned;");
    expect(sql).toContain("ALTER TABLE `settings` ADD `van_selling_enabled` boolean DEFAULT false NOT NULL;");
    expect(sql).toContain("ALTER TABLE `stock_transfers` ADD `accepted_by` bigint unsigned;");
    expect(sql.trimEnd().endsWith("--> statement-breakpoint")).toBe(false);
  });
});
