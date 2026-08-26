/**
 * Проверка подписки.
 *
 * Прежняя версия этого файла проверяла billedQuery и billedAdmin — процедуры,
 * которые не вызывались ни в одном из 38 роутеров. Тесты были зелёными,
 * механизм — мёртвым, а организации с истёкшим тарифом продолжали работать:
 * одна из них оформила заказ через пять дней после окончания оплаты.
 *
 * Поэтому теперь проверяется не отдельная процедура, а то, что калитка стоит в
 * ОСНОВАНИИ: любая процедура, построенная на authedQuery, закрыта по
 * умолчанию. Именно это свойство и было нарушено, и именно его надо стеречь.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../context";
import { asTestContext } from "./helpers/test-context";

const mockHasSubscriptionAccess = vi.fn();
vi.mock("../lib/feature-gating", () => ({
  hasSubscriptionAccess: (...args: unknown[]) => mockHasSubscriptionAccess(...args),
  checkSubscriptionAccess: (...args: unknown[]) => mockHasSubscriptionAccess(...args),
  invalidateSubscriptionAccess: vi.fn(),
}));

vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());

function makeCtx(tenantId: number, userId: number, role = "operator"): TrpcContext {
  return asTestContext({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user: { id: userId, tenantId, role, status: "active" as const, name: "Test", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test", name: "Test Co", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  });
}

beforeEach(() => {
  mockHasSubscriptionAccess.mockReset();
});

describe("подписка: калитка в основании authedQuery", () => {
  it("пускает, когда подписка действует", async () => {
    mockHasSubscriptionAccess.mockResolvedValue(true);
    const { createRouter, authedQuery } = await import("../middleware");
    const router = createRouter({ orders: authedQuery.query(() => "ok") });
    await expect(router.createCaller(makeCtx(1, 1, "ceo")).orders()).resolves.toBe("ok");
  });

  it("не пускает, когда подписка истекла", async () => {
    mockHasSubscriptionAccess.mockResolvedValue(false);
    const { createRouter, authedQuery } = await import("../middleware");
    const router = createRouter({ orders: authedQuery.query(() => "ok") });
    await expect(router.createCaller(makeCtx(1, 1, "ceo")).orders())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("спрашивает про ту организацию, что в контексте", async () => {
    mockHasSubscriptionAccess.mockResolvedValue(true);
    const { createRouter, authedQuery } = await import("../middleware");
    const router = createRouter({ orders: authedQuery.query(() => "ok") });
    await router.createCaller(makeCtx(42, 1, "ceo")).orders();
    expect(mockHasSubscriptionAccess).toHaveBeenCalledWith(42);
  });
});

// Вот это и есть регрессия, которую файл обязан ловить: раньше рабочие
// процедуры подписку не проверяли вовсе, потому что стояли на невооружённых
// operatorQuery / fieldSalesQuery / adminQuery.
describe("подписка распространяется на рабочие процедуры, а не только на выделенные", () => {
  const cases: Array<[string, string]> = [
    ["operatorQuery", "operator"],
    ["adminQuery", "ceo"],
    ["fieldSalesQuery", "agent"],
    ["supervisorQuery", "supervisor"],
    ["courierQuery", "courier"],
    ["managementQuery", "operator"],
    ["financeQuery", "ceo"],
    ["reportsQuery", "operator"],
  ];

  for (const [procName, role] of cases) {
    it(`${procName} закрыт при истёкшей подписке`, async () => {
      mockHasSubscriptionAccess.mockResolvedValue(false);
      const mw = await import("../middleware");
      const proc = (mw as unknown as Record<string, typeof mw.authedQuery>)[procName];
      const router = mw.createRouter({ work: proc.query(() => "ok") });
      await expect(router.createCaller(makeCtx(1, 1, role)).work())
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  }
});

describe("исключения: что остаётся доступным без подписки", () => {
  // Без этих четырёх заблокированная организация не смогла бы ни увидеть свой
  // тариф, ни заплатить — то есть блокировка стала бы ловушкой без выхода.
  const open = ["auth", "billing", "stripe", "system"];

  for (const prefix of open) {
    it(`${prefix}.* открыт при истёкшей подписке`, async () => {
      mockHasSubscriptionAccess.mockResolvedValue(false);
      const { createRouter, authedQuery } = await import("../middleware");
      const router = createRouter({
        [prefix]: createRouter({ status: authedQuery.query(() => "ok") }),
      });
      const caller = router.createCaller(makeCtx(1, 1, "ceo")) as unknown as Record<string, { status: () => Promise<string> }>;
      await expect(caller[prefix].status()).resolves.toBe("ok");
    });
  }

  it("подписку у таких путей вообще не спрашивают — лишний запрос к базе ни к чему", async () => {
    mockHasSubscriptionAccess.mockResolvedValue(false);
    const { createRouter, authedQuery } = await import("../middleware");
    const router = createRouter({ billing: createRouter({ status: authedQuery.query(() => "ok") }) });
    await router.createCaller(makeCtx(1, 1, "ceo")).billing.status();
    expect(mockHasSubscriptionAccess).not.toHaveBeenCalled();
  });

  it("похожее имя не открывает доступ: проверяется префикс с точкой", async () => {
    mockHasSubscriptionAccess.mockResolvedValue(false);
    const { createRouter, authedQuery } = await import("../middleware");
    // «authorized» начинается с «auth», но исключением не является.
    const router = createRouter({ authorized: createRouter({ list: authedQuery.query(() => "ok") }) });
    await expect(router.createCaller(makeCtx(1, 1, "ceo")).authorized.list())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("суперадмин", () => {
  it("работает при любой подписке — он платформа, а не арендатор", async () => {
    mockHasSubscriptionAccess.mockResolvedValue(false);
    const { createRouter, superAdminQuery } = await import("../middleware");
    const router = createRouter({ platform: superAdminQuery.query(() => "ok") });
    await expect(router.createCaller(makeCtx(1, 1, "superadmin")).platform()).resolves.toBe("ok");
  });

  it("и подписку у него не спрашивают вовсе", async () => {
    mockHasSubscriptionAccess.mockResolvedValue(false);
    const { createRouter, authedQuery } = await import("../middleware");
    const router = createRouter({ anything: authedQuery.query(() => "ok") });
    await router.createCaller(makeCtx(1, 1, "superadmin")).anything();
    expect(mockHasSubscriptionAccess).not.toHaveBeenCalled();
  });
});

describe("порядок проверок", () => {
  it("роль проверяется тоже: подписка есть, но роль не та", async () => {
    mockHasSubscriptionAccess.mockResolvedValue(true);
    const { createRouter, adminQuery } = await import("../middleware");
    const router = createRouter({ secret: adminQuery.query(() => "ok") });
    await expect(router.createCaller(makeCtx(1, 1, "agent")).secret())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("без организации в контексте — UNAUTHORIZED, а не отказ по подписке", async () => {
    const { createRouter, authedQuery } = await import("../middleware");
    const router = createRouter({ secret: authedQuery.query(() => "ok") });
    const caller = router.createCaller(asTestContext({ req: new Request("http://x/"), resHeaders: new Headers() }));
    await expect(caller.secret()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
