/**
 * Скидка полевых ролей ограничена порогом, а правки заказа оставляют след.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * order.create открыт fieldSalesQuery, поле discount принимало 0–100 %, и
 * единственной проверкой был диапазон. Создание заказа в журнал не писалось
 * вовсе; удаление, восстановление, правка скидки/способа оплаты и
 * переписывание строк — операции, меняющие выручку и долг, — тоже. Оператор
 * удалял доставленный заказ в долг — долг магазина исчезал из всех отчётов, а
 * в базе оставался только timestamp.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. Порог читается из настроек организации; пустой — как раньше; офис
 *    (ceo, operator) порогом не ограничен; проверка стоит ДО создания.
 * 2. Создание пишет след с процентом скидки и ролью; повтор по ключу — нет.
 * 3. delete / restore / update / updateItems получают актора из роутера и
 *    пишут след после транзакции.
 *
 * Нарочная поломка: убери `actorOf(ctx)` у OrderService.delete в роутере —
 * третья проверка падает.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { orderSource, orderMethod } from "./helpers/order-source";

const ROUTER = readFileSync(resolve(__dirname, "../order-router.ts"), "utf-8");
const create = ROUTER.slice(ROUTER.indexOf("create: fieldSalesQuery"), ROUTER.indexOf("cancel: fieldSalesQuery"));

describe("порог скидки полевых ролей", () => {
  it("читается из настроек, пустой порог ничего не меняет, офис не ограничен", () => {
    expect(create).toContain("settings.maxFieldDiscountPct");
    expect(create).toContain("cfg?.max != null && discountPct > Number(cfg.max)");
    expect(create).toContain('!["ceo", "operator"].includes(ctx.user.role)');
  });

  it("проверяется до создания заказа", () => {
    expect(create.indexOf("settings.maxFieldDiscountPct")).toBeLessThan(create.indexOf("OrderService.create("));
  });

  /*
    Выше порога — не отказ, а ожидание: заказ оформляется в pending с
    причиной, офис получает уведомление и подтверждает переводом в «новый»
    (updateStatus — только ceo/operator). Причина стирается при выходе из
    ожидания.
  */
  it("выше порога — заказ ждёт офиса с причиной и уведомлением, а не отказ", () => {
    expect(create).not.toContain('code: "FORBIDDEN"');
    expect(create).toContain("holdReason = `Скидка ${discountPct}% выше порога");
    expect(create).toMatch(/holdReason,\s*\}\);/);
    expect(create).toContain("NotificationService.createBulk(ctx.db, {");
    expect(create).toContain("sql`${users.role} IN ('ceo', 'operator')`");
    const service = orderSource();
    expect(service).toContain('status: input.holdReason ? "pending" : "new"');
    expect(service).toContain('const holdPatch = order.status === "pending" && newStatus !== "pending" ? { holdReason: null } : {};');
    expect(service).toContain("held: Boolean(input.holdReason)");
    expect(readFileSync(resolve(__dirname, "../../src/pages/OrderDetail.tsx"), "utf-8")).toContain('data-testid="order-hold-reason"');
  });

  it("поле принимает роутер настроек и показывает экран компании", () => {
    expect(readFileSync(resolve(__dirname, "../settings-router.ts"), "utf-8")).toMatch(/maxFieldDiscountPct: z\.preprocess/);
    expect(readFileSync(resolve(__dirname, "../../src/components/settings/CompanySettings.tsx"), "utf-8")).toContain('set("maxFieldDiscountPct")');
  });
});

describe("след правок заказа", () => {
  it("создание пишет процент скидки и роль; повтор по ключу — нет", () => {
    expect(create).toContain('action: "order.create"');
    expect(create).toContain("discountPct, paymentMethod");
    expect(create).toContain("if (!created.idempotent)");
  });

  it("delete, restore, update и updateItems получают актора", () => {
    expect(ROUTER).toContain("OrderService.delete(ctx.db, ctx.tenant.id, input.id, actorOf(ctx))");
    expect(ROUTER).toContain("OrderService.restore(ctx.db, ctx.tenant.id, input.id, actorOf(ctx))");
    expect(ROUTER).toContain("OrderService.updateItems(ctx.db, ctx.tenant.id, input.id, { items: input.items }, actorOf(ctx))");
    // Оба вызова update заканчиваются актором.
    const updates = ROUTER.split("OrderService.update(").slice(1);
    expect(updates.length).toBe(2);
    for (const u of updates) expect(u.slice(0, u.indexOf(");"))).toContain("actorOf(ctx)");
  });

  it("служба пишет след после транзакции в каждом из четырёх методов", () => {
    for (const [m, action] of [["delete", "order.delete"], ["restore", "order.restore"], ["update", "order.update"], ["updateItems", "order.update_items"]] as const) {
      // `delete` — зарезервированное слово: в модуле метод зовётся deleteOrder.
      const body = orderMethod(m === "delete" ? "deleteOrder" : m);
      expect(body, `${m} без следа`).toContain(`"${action}"`);
      expect(body.indexOf("await db.transaction"), `${m}: след внутри транзакции`).toBeLessThan(body.indexOf(`"${action}"`));
    }
  });
});
