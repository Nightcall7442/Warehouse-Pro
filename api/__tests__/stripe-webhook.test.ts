import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";

/**
 * Обработчик событий Stripe — деньги, приходящие снаружи.
 *
 * ── Что здесь проверяется и что НЕТ ──────────────────────────────────────────
 *
 * Покрытие этого файла было 1,36%: по сути не проверялся ничем. При этом он
 * решает, какой тариф у организации и не отключить ли её за неоплату, а
 * запросы к нему приходят из интернета.
 *
 * Проверяются РЕШЕНИЯ, а не SQL: пускать ли запрос без подписи, что делать с
 * повтором того же события, в какой тариф превращается идентификатор цены,
 * попадает ли тариф в таблицу организаций. Запросы здесь простые (сравнение
 * по tenant_id), и подделка базы их не искажает.
 *
 * Чего этот набор НЕ доказывает: что SQL верен. Для запросов сложнее равенства
 * есть отдельный набор на настоящей MySQL (api/__tests__/real-db). Разделение
 * намеренное, и написано здесь, чтобы никто не принял одно за другое.
 */

const verifyWebhook = vi.hoisted(() => vi.fn());
type MailArgs = { to: string; subject: string; html: string };
const sendEmail = vi.hoisted(() => vi.fn((_opts: { to: string; subject: string; html: string }) => Promise.resolve()));

vi.mock("../lib/stripe", () => ({ verifyWebhook }));
vi.mock("../lib/mailer", () => ({ sendEmail }));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../lib/env", () => ({
  env: {
    stripeProPriceId: "price_pro",
    stripeExclusivePriceId: "price_exclusive",
    appUrl: "https://app.test",
  },
}));

/** Что записал обработчик — по таблицам, а не по вызовам. */
interface Written {
  subscriptions: Array<Record<string, unknown>>;
  tenantPlans: Array<{ tenantId: unknown; plan: unknown }>;
  billingEvents: Array<Record<string, unknown>>;
  subscriptionUpdates: Array<Record<string, unknown>>;
}
let written: Written;
/** Уже обработанные события — для проверки повтора. */
let seenEventIds: string[];
/** Организации в базе. */
let tenantRows: Array<Record<string, unknown>>;
/** Есть ли уже подписка у организации. */
let hasSubscription: boolean;

const { subscriptions, tenants, billingEvents } = await import("@db/schema");

function makeDb() {
  const table = (ref: unknown) =>
    ref === subscriptions ? "subscriptions" : ref === tenants ? "tenants" : ref === billingEvents ? "billingEvents" : "other";

  const db: any = {
    // Единственная выборка вне транзакции — проверка повтора события.
    select: () => ({
      from: (ref: unknown) => ({
        where: () => ({
          limit: () => Promise.resolve(
            table(ref) === "billingEvents"
              ? seenEventIds.map(id => ({ stripeEventId: id }))
              : [],
          ),
        }),
      }),
    }),
    transaction: async (fn: (tx: any) => Promise<unknown>) => {
      const tx: any = {
        select: () => ({
          from: (ref: unknown) => ({
            where: () => ({
              limit: () => Promise.resolve(
                table(ref) === "subscriptions" ? (hasSubscription ? [{ id: "sub-1" }] : [])
                  : table(ref) === "tenants" ? tenantRows
                  : [],
              ),
            }),
          }),
        }),
        insert: (ref: unknown) => ({
          values: (v: Record<string, unknown>) => {
            if (table(ref) === "subscriptions") written.subscriptions.push(v);
            if (table(ref) === "billingEvents") written.billingEvents.push(v);
            return Promise.resolve([{ insertId: 1 }]);
          },
        }),
        update: (ref: unknown) => ({
          set: (v: Record<string, unknown>) => ({
            where: () => {
              if (table(ref) === "tenants") written.tenantPlans.push({ tenantId: "…", plan: v.plan });
              if (table(ref) === "subscriptions") written.subscriptionUpdates.push(v);
              return Promise.resolve([{ affectedRows: 1 }]);
            },
          }),
        }),
      };
      return fn(tx);
    },
  };
  return db;
}

let mockDb: ReturnType<typeof makeDb>;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

const { registerStripeWebhook } = await import("../webhooks/stripe");

function makeApp() {
  const app = new Hono();
  registerStripeWebhook(app);
  return app;
}

/** Запрос к обработчику с подписью (или без неё). */
function post(app: Hono, body: unknown, signature: string | null = "sig") {
  return app.request("/api/webhooks/stripe", {
    method: "POST",
    headers: signature ? { "stripe-signature": signature } : {},
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  written = { subscriptions: [], tenantPlans: [], billingEvents: [], subscriptionUpdates: [] };
  seenEventIds = [];
  tenantRows = [];
  hasSubscription = false;
  mockDb = makeDb();
  verifyWebhook.mockReset();
  sendEmail.mockReset();
  sendEmail.mockImplementation(() => Promise.resolve());
});

describe("Stripe: подпись", () => {
  it("без заголовка подписи отвечает 400 и ничего не пишет", async () => {
    const res = await post(makeApp(), {}, null);
    expect(res.status).toBe(400);
    expect(written.subscriptions).toHaveLength(0);
    expect(written.tenantPlans).toHaveLength(0);
    // Проверка подписи даже не вызывалась — до неё дело не дошло.
    expect(verifyWebhook).not.toHaveBeenCalled();
  });

  it("неверная подпись отвечает 400 и не меняет тариф", async () => {
    // Это главная защита файла: без неё любой желающий выдаёт себе тариф
    // «эксклюзив» одним запросом.
    verifyWebhook.mockRejectedValue(new Error("No signatures found matching the expected signature"));
    const res = await post(makeApp(), { type: "checkout.session.completed" });
    expect(res.status).toBe(400);
    expect(written.tenantPlans).toHaveLength(0);
    expect(written.subscriptions).toHaveLength(0);
  });
});

describe("Stripe: повтор события", () => {
  it("то же событие второй раз ничего не меняет", async () => {
    // Stripe повторяет доставку, пока не получит 2xx. Без этой проверки
    // повторная доставка второй раз применила бы тот же платёж.
    seenEventIds = ["evt_1"];
    verifyWebhook.mockResolvedValue({
      id: "evt_1", type: "checkout.session.completed",
      data: { object: { metadata: { tenantId: "7", plan: "pro" } } },
    });

    const res = await post(makeApp(), {});
    expect(res.status).toBe(200);
    expect(written.subscriptions).toHaveLength(0);
    expect(written.tenantPlans).toHaveLength(0);
    expect(written.billingEvents).toHaveLength(0);
  });
});

describe("Stripe: оплата прошла", () => {
  it("заводит подписку и переносит тариф в организацию", async () => {
    // Тариф обязан попасть в tenants: именно оттуда его читают проверки прав.
    // Запись только в subscriptions означала бы оплаченный, но не работающий
    // тариф.
    verifyWebhook.mockResolvedValue({
      id: "evt_2", type: "checkout.session.completed",
      data: { object: { metadata: { tenantId: "7", plan: "pro" }, subscription: "sub_x", customer: "cus_x" } },
    });

    const res = await post(makeApp(), {});
    expect(res.status).toBe(200);
    expect(written.subscriptions).toHaveLength(1);
    expect(written.subscriptions[0]).toMatchObject({ tenantId: 7, plan: "pro", status: "active" });
    expect(written.tenantPlans).toEqual([{ tenantId: "…", plan: "pro" }]);
    expect(written.billingEvents).toHaveLength(1);
  });

  it("существующую подписку обновляет, а не заводит вторую", async () => {
    hasSubscription = true;
    verifyWebhook.mockResolvedValue({
      id: "evt_3", type: "checkout.session.completed",
      data: { object: { metadata: { tenantId: "7", plan: "exclusive" }, subscription: "sub_x", customer: "cus_x" } },
    });

    await post(makeApp(), {});
    expect(written.subscriptions).toHaveLength(0);
    expect(written.subscriptionUpdates[0]).toMatchObject({ plan: "exclusive", status: "active" });
  });

  it("неизвестный тариф в метаданных превращается в basic, а не в эксклюзив", async () => {
    // Метаданные приходят снаружи. Любое незнакомое значение обязано падать
    // в самый дешёвый тариф, а не в самый дорогой.
    verifyWebhook.mockResolvedValue({
      id: "evt_4", type: "checkout.session.completed",
      data: { object: { metadata: { tenantId: "7", plan: "супер-вип" }, subscription: null, customer: null } },
    });

    await post(makeApp(), {});
    expect(written.subscriptions[0]).toMatchObject({ plan: "basic" });
    expect(written.tenantPlans).toEqual([{ tenantId: "…", plan: "basic" }]);
  });

  it("событие без организации не пишет запись в журнал оплат", async () => {
    // tenant_id в billing_events объявлен NOT NULL. Запись без организации
    // уронила бы вставку и откатила бы всё, что сделал разбор события.
    verifyWebhook.mockResolvedValue({
      id: "evt_5", type: "checkout.session.completed",
      data: { object: { metadata: {} } },
    });

    const res = await post(makeApp(), {});
    expect(res.status).toBe(200);
    expect(written.billingEvents).toHaveLength(0);
  });
});

describe("Stripe: изменение подписки", () => {
  it("идентификатор цены превращается в нужный тариф", async () => {
    verifyWebhook.mockResolvedValue({
      id: "evt_6", type: "customer.subscription.updated",
      data: { object: {
        metadata: { tenantId: "7" }, status: "active",
        items: { data: [{ price: { id: "price_exclusive" } }] },
        current_period_end: 1790000000,
      } },
    });

    await post(makeApp(), {});
    expect(written.subscriptions[0]).toMatchObject({ plan: "exclusive", status: "active" });
    expect(written.tenantPlans).toEqual([{ tenantId: "…", plan: "exclusive" }]);
  });

  it("незнакомая цена даёт basic", async () => {
    verifyWebhook.mockResolvedValue({
      id: "evt_7", type: "customer.subscription.updated",
      data: { object: {
        metadata: { tenantId: "7" }, status: "active",
        items: { data: [{ price: { id: "price_чужая" } }] },
        current_period_end: null,
      } },
    });

    await post(makeApp(), {});
    expect(written.subscriptions[0]).toMatchObject({ plan: "basic" });
  });

  it("подписка не активна — тариф организации не меняется", async () => {
    // Просроченная подписка не должна выдавать доступ. Тариф в tenants
    // остаётся прежним, пока оплата не пройдёт.
    verifyWebhook.mockResolvedValue({
      id: "evt_8", type: "customer.subscription.updated",
      data: { object: {
        metadata: { tenantId: "7" }, status: "past_due",
        items: { data: [{ price: { id: "price_pro" } }] },
        current_period_end: null,
      } },
    });

    await post(makeApp(), {});
    expect(written.subscriptions[0]).toMatchObject({ status: "past_due" });
    expect(written.tenantPlans).toHaveLength(0);
  });
});

describe("Stripe: отмена и неоплата", () => {
  it("удаление подписки переводит её в «отменена»", async () => {
    verifyWebhook.mockResolvedValue({
      id: "evt_9", type: "customer.subscription.deleted",
      data: { object: { metadata: { tenantId: "7" } } },
    });

    await post(makeApp(), {});
    expect(written.subscriptionUpdates[0]).toMatchObject({ status: "canceled" });
  });

  it("неудачная оплата ставит «просрочено» и пишет владельцу", async () => {
    tenantRows = [{ id: 7, name: "ООО Ромашка", ownerEmail: "owner@test.local" }];
    verifyWebhook.mockResolvedValue({
      id: "evt_10", type: "invoice.payment_failed",
      data: { object: { subscription_details: { metadata: { tenantId: "7" } } } },
    });

    await post(makeApp(), {});
    expect(written.subscriptionUpdates[0]).toMatchObject({ status: "past_due" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0] as MailArgs).toMatchObject({ to: "owner@test.local" });
  });

  it("сбой отправки письма не роняет обработку события", async () => {
    // Почта — не часть расчётов. Если письмо не ушло, статус всё равно
    // обязан смениться, иначе Stripe будет повторять доставку бесконечно.
    tenantRows = [{ id: 7, name: "ООО Ромашка", ownerEmail: "owner@test.local" }];
    sendEmail.mockImplementation(() => Promise.reject(new Error("SMTP недоступен")));
    verifyWebhook.mockResolvedValue({
      id: "evt_11", type: "invoice.payment_failed",
      data: { object: { subscription_details: { metadata: { tenantId: "7" } } } },
    });

    const res = await post(makeApp(), {});
    expect(res.status).toBe(200);
    expect(written.subscriptionUpdates[0]).toMatchObject({ status: "past_due" });
  });

  it("у организации нет почты владельца — письмо не шлётся, статус меняется", async () => {
    tenantRows = [{ id: 7, name: "ООО Ромашка", ownerEmail: null }];
    verifyWebhook.mockResolvedValue({
      id: "evt_12", type: "invoice.payment_failed",
      data: { object: { subscription_details: { metadata: { tenantId: "7" } } } },
    });

    await post(makeApp(), {});
    expect(sendEmail).not.toHaveBeenCalled();
    expect(written.subscriptionUpdates[0]).toMatchObject({ status: "past_due" });
  });
});
