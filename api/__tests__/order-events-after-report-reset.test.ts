import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Событие order.changed уходит из invalidateReports — одной точки после коммита.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Экран «Заказы» и Главная ждали order.created / order.status_changed, а
 * сервер их не слал ни из одного места: только push на телефон и Telegram.
 * Оператор не видел нового заказа агента и доставки курьера, пока не
 * щёлкнет по странице.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · каждый сброс по записи заказа (создание, статус, доставка, оплата,
 *     расчёт, возврат) — одно событие организации, без данных;
 *   · товары, приходы, зарплата, 1С — без события заказа;
 *   · событие уходит ПОСЛЕ сброса версии кэша: получивший его читает новое;
 *   · сервисы записи заказа зовут сброс с причиной, которую рассылка узнаёт
 *     (переименуй «delivery» — экран снова оглохнет).
 *
 * Сама запись после коммита и без события на откате — на настоящей базе:
 * real-db/orders-queues-live.test.ts.
 *
 * Нарочная поломка: убери рассылку из invalidateReports или поставь её до
 * reportCache.invalidate — падают первый и третий тесты.
 */
const h = vi.hoisted(() => ({
  emitted: [] as Array<{ type: string; tenantId: number; userId?: number; data: unknown }>,
  onEmit: null as null | (() => void),
}));
vi.mock("../lib/redis", () => ({
  INSTANCE_ID: "test", isRedisAvailable: () => false, getRedis: () => null,
  subscribeChannel: () => false, publishChannel: () => {},
}));
vi.mock("../lib/sse", () => ({
  sseBus: { emit: (e: { type: string; tenantId: number; data: unknown }) => { h.emitted.push(e); h.onEmit?.(); } },
}));

import { invalidateReports, reportCached } from "../lib/report-cache";

beforeEach(() => { h.emitted.length = 0; h.onEmit = null; });

describe("запись заказа будит экраны", () => {
  it("создание, статус, доставка, оплата, расчёт, возврат — order.changed организации, без данных", async () => {
    for (const reason of ["order", "order.assign", "order.close", "delivery", "payment", "payment.reverse", "return.status"]) {
      await invalidateReports(7, reason);
    }
    expect(h.emitted).toHaveLength(7);
    for (const e of h.emitted) {
      // Без userId — всей организации; без данных — ни сумм, ни имён.
      expect(e).toEqual({ type: "order.changed", tenantId: 7, data: {} });
    }
  });

  it("товары, приходы, зарплата, 1С — события заказа нет", async () => {
    for (const reason of ["product", "arrival", "arrival.completed", "commission", "salary.payout", "import", "onec.sync", "onec.payment", "stock.adjust", undefined]) {
      await invalidateReports(7, reason);
    }
    expect(h.emitted).toEqual([]);
  });

  it("событие — после сброса версии: экран, перечитав по нему, получает новое", async () => {
    expect(await reportCached(7, "order.stats", {}, 20_000, async () => "старое")).toBe("старое");
    let reread: Promise<string> | null = null;
    h.onEmit = () => { reread = reportCached(7, "order.stats", {}, 20_000, async () => "новое"); };
    await invalidateReports(7, "order");
    expect(reread).not.toBeNull();
    expect(await reread!).toBe("новое");
  });
});

describe("сервисы записи заказа зовут сброс с узнаваемой причиной", () => {
  const ROOT = join(__dirname, "..");
  const FILES = [
    "services/order-create.ts", "services/order-status.ts", "services/order-items.ts",
    "services/order-settlement.ts", "services/order-close.ts", "services/courier-delivery.ts",
    "services/payment.ts", "returns-router.ts",
  ];
  it.each(FILES)("%s", (file) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    const reasons = [...src.matchAll(/invalidateReports\([^,]+,\s*"([^"]+)"\)/g)].map(m => m[1]);
    expect(reasons.length, `${file}: сброса нет — экран не узнает о записи`).toBeGreaterThan(0);
    for (const r of reasons) expect(["order", "delivery", "payment", "return"], `${file}: «${r}»`).toContain(r.split(".")[0]);
  });
});
