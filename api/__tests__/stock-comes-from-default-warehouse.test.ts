import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { orderSource } from "./helpers/order-source";

/**
 * Каталог показывает остаток того склада, с которого спишется заказ.
 *
 * Было (ADR 0008): продают только с основного склада, и каталог читал
 * основной. Правило сменилось осознанно (ADR 0012, 21.10.2026): директор
 * отмечает склады «точками продаж» и закрепляет за ними агентов, а склад
 * продажи выбирается так — выбранный офисом → склад агента → основной.
 * Организация без точек продаж живёт как раньше.
 *
 * Сторожим, что каталог и заказ решают склад ОДНИМ правилом
 * (services/sales-warehouse.ts): иначе агент увидит одно число, а сервер
 * решит по другому, и отказ придёт уже после разговора с магазином. Сумму по
 * всем складам показывать нельзя ровно поэтому.
 *
 * И что склад входит в ключ кэша обоих списков: без него первый агент
 * филиала заполнил бы кэш остатком филиала, и агенты основного склада три
 * минуты продавали бы по чужим числам.
 *
 * Отдельно стерегём запасную ветку: соединение строк склада по одному товару,
 * без склада, давало ДВЕ строки на товар у арендатора с двумя складами.
 *
 * Нарочная поломка: убери `+ \`:wh${warehouseId ?? 0}\`` из ключа listAll —
 * падает второй тест; верни в orderWarehouseId `resolveOrderWarehouse(tx,
 * tenantId)` — падает «старый заказ без склада».
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
const ROUTER = read("api/product-router.ts");
const ORDER = orderSource();
const RULE = read("api/services/sales-warehouse.ts");

const between = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

describe("каталог и заказ — один склад продажи", () => {
  it("listAll, list и карточка товара берут склад правилом продажи", () => {
    for (const [name, next] of [["listAll: fieldSalesQuery", "list: fieldSalesQuery"], ["list: fieldSalesQuery", "getById: fieldSalesQuery"], ["getById: fieldSalesQuery", "create: operatorQuery"]] as const) {
      const body = between(ROUTER, name, next);
      expect(body, `${name}: склад не через catalogWarehouseId`).toContain("await catalogWarehouseId(db, ctx, input)");
      expect(body, `${name}: склад не по умолчанию — правило продажи`).not.toContain("getDefaultWarehouseId(");
    }
    // catalogWarehouseId — то же правило, что у заказа, плюс склад правимого заказа.
    const helper = between(ROUTER, "async function catalogWarehouseId(", "async function getDefaultWarehouseId(");
    expect(helper).toContain("return salesWarehouseFor(db, tenantId, {");
    expect(helper).toContain("mayChoose: mayChooseWarehouse(ctx.user.role),");
    expect(helper).toContain("...viewerScope({ userId: ctx.user.id, userRole: ctx.user.role }),");
    const scoped = ROUTER.match(/eq\(warehouseStock\.warehouseId, warehouseId \?\? 0\)/g) ?? [];
    expect(scoped.length, "не все чтения привязаны к складу продажи").toBeGreaterThanOrEqual(3);
  });

  it("склад решается до ключа кэша и входит в оба ключа", () => {
    const listAll = between(ROUTER, "listAll: fieldSalesQuery", "list: fieldSalesQuery");
    expect(listAll.indexOf("await catalogWarehouseId(")).toBeLessThan(listAll.indexOf("const cacheKey"));
    expect(listAll).toContain("+ `:wh${warehouseId ?? 0}`;");
    expect(listAll.indexOf("withTenantDataCache(")).toBeGreaterThan(listAll.indexOf("await catalogWarehouseId("));
    const list = between(ROUTER, "list: fieldSalesQuery", "getById: fieldSalesQuery");
    expect(list.indexOf("await catalogWarehouseId(")).toBeLessThan(list.indexOf("const cacheKey"));
    expect(list).toContain("+ `:wh${warehouseId ?? 0}`;");
  });

  it("уценка в каталоге — только склада каталога", () => {
    const listAll = between(ROUTER, "listAll: fieldSalesQuery", "list: fieldSalesQuery");
    expect(listAll).toContain("activeMarkdowns(db, tenantId, data.map(r => Number(r.id)), undefined, warehouseId)");
    // resolveCatalog в listAll и list — со складом последним доводом.
    expect(ROUTER.split("String(r.unitPrice)])), warehouseId)").length - 1).toBe(2);
  });

  it("чтение без склада продажи не берёт остаток «ниоткуда»", () => {
    /*
      Запасная ветка осталась только у удаления — там обход всех складов нужен
      по делу: строки склада держат товар внешним ключом, и не убрав их
      отовсюду, товар не удалить.
    */
    const loose = ROUTER.match(/: and\(eq\(warehouseStock\.productId,[^)]*\), eq\(warehouseStock\.tenantId, tenantId\)\)/g) ?? [];
    for (const m of loose) {
      const at = ROUTER.indexOf(m);
      const context = ROUTER.slice(Math.max(0, at - 400), at);
      expect(context, `соединение без склада вне удаления: ${m}`).toMatch(/delete|Delete/);
    }
  });

  it("заказ резервирует по тому же правилу; полевому выбирать склад нельзя", () => {
    expect(ORDER).toContain("const whId = await salesWarehouseFor(tx, tenantId, q);");
    expect(ORDER).toContain("requested: input.warehouseId, agentId, mayChoose: input.mayChooseWarehouse ?? false,");
    expect(ORDER).toContain("Склад по умолчанию не найден");
    expect(RULE).toContain("Склад заказа выбирает офис. Агенту склад назначают в карточке сотрудника");
    // Кто выбирает — одно правило на сервер и экран.
    expect(RULE).toContain('export { WAREHOUSE_CHOOSERS, mayChooseWarehouse } from "@contracts/sales-warehouse";');
    expect(read("contracts/sales-warehouse.ts")).toContain('export const WAREHOUSE_CHOOSERS = ["ceo", "operator"] as const;');
    expect(read("api/order-router.ts")).toContain("mayChooseWarehouse: mayChooseWarehouse(ctx.user.role),");
  });

  it("старый заказ без склада — только основной, без склада агента", () => {
    const at = ORDER.indexOf("export async function orderWarehouseId(");
    const body = ORDER.slice(at, ORDER.indexOf("\n}\n", at));
    expect(body).toContain("await defaultWarehouseId(tx, tenantId)");
    expect(body).not.toContain("resolveOrderWarehouse(");
    expect(body).not.toContain("salesWarehouseFor(");
  });
});

describe("salesWarehouseFor: порядок выбора", () => {
  /**
   * Подделка запросов правила: «склад из карточки сотрудника» (users),
   * «с этого склада продают» и «основной» (warehouses). Что вернуть — по
   * таблице в from() и по проекции: проверка склада спрашивает и имя.
   */
  async function rule(rows: { sellable?: number[]; agentWarehouse?: number | null; defaultId?: number | null }) {
    const { salesWarehouseFor } = await import("../services/sales-warehouse");
    const schema = await import("@db/schema");
    const calls: string[] = [];
    const db = {
      select: (proj: Record<string, unknown>) => ({
        from: (table: unknown) => {
          const fromUsers = table === schema.users;
          const sellableCheck = "name" in proj;
          const q = {
            where: () => q,
            limit: async () => {
              if (fromUsers) { calls.push("agent"); return [{ warehouseId: rows.agentWarehouse ?? null }]; }
              if (sellableCheck) {
                calls.push("sellable");
                return rows.sellable?.length ? [{ id: rows.sellable[0], name: "Склад" }] : [];
              }
              calls.push("default");
              return rows.defaultId ? [{ id: rows.defaultId }] : [];
            },
          };
          return q;
        },
      }),
    } as never;
    return { salesWarehouseFor: (q: Parameters<typeof salesWarehouseFor>[2]) => salesWarehouseFor(db, 1, q), calls };
  }

  it("без выбора и без склада у агента — основной; со складом агента — его, пока с него продают", async () => {
    const plain = await rule({ defaultId: 3 });
    expect(await plain.salesWarehouseFor({ agentId: 7 })).toBe(3);
    expect(plain.calls).toEqual(["agent", "default"]);
    const branch = await rule({ agentWarehouse: 9, sellable: [9], defaultId: 3 });
    expect(await branch.salesWarehouseFor({ agentId: 7 })).toBe(9);
    expect(branch.calls).toEqual(["agent", "sellable"]);
    // Склад сняли с продаж — агент на основном, а не без каталога.
    const unmarked = await rule({ agentWarehouse: 9, sellable: [], defaultId: 3 });
    expect(await unmarked.salesWarehouseFor({ agentId: 7 })).toBe(3);
    expect(unmarked.calls).toEqual(["agent", "sellable", "default"]);
  });

  it("явный выбор: офису — проверенный склад, полевому — отказ без похода в базу", async () => {
    const office = await rule({ sellable: [5] });
    expect(await office.salesWarehouseFor({ requested: 5, agentId: 7, mayChoose: true })).toBe(5);
    expect(office.calls).toEqual(["sellable"]);
    const field = await rule({ sellable: [5] });
    await expect(field.salesWarehouseFor({ requested: 5, agentId: 7, mayChoose: false })).rejects.toThrow("Склад заказа выбирает офис");
    expect(field.calls).toEqual([]);
    const stored = await rule({ sellable: [] });
    await expect(stored.salesWarehouseFor({ requested: 6, mayChoose: true })).rejects.toThrow("С этого склада не продают");
  });

  it("нет основного склада — null, а не выдуманный номер", async () => {
    const none = await rule({ defaultId: null });
    expect(await none.salesWarehouseFor({})).toBeNull();
    vi.resetModules();
  });
});
