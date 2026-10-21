/**
 * «Где мой заказ» — публичная страница для магазина (/t/:token).
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Метка подписана с приставкой «track:»: метка чека (/r/) сюда не
 *     подходит, а метка слежения — к чеку; испорченная подпись — «нет».
 *  2. Ссылки нет у ждущего подтверждения, отменённого, возвращённого,
 *     удалённого и доставленного больше трёх дней назад.
 *  3. Приостановленная организация — 404, как будто ссылки и не было.
 *  4. Курьер на странице не назван вовсе: имя хранится «Фамилия Имя», и
 *     первым словом уходила фамилия. Координат нет ни магазина, ни
 *     курьера, хотя минуты по ним посчитаны; текст экранируется.
 *  5. Язык: ?lang=uz, иначе заголовок браузера, иначе русский.
 *  6. Доставленному — ссылка на чек (/r/), где магазин подтверждает
 *     получение; сорванному — без обещания «поставщик свяжется».
 *
 * Нарочная поломка: в sig() замени "track:" на "receipt:" — падает 1; убери
 * проверку tenantStatus — падает 3; верни в страницу имя курьера из users —
 * падает 4.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/env", async (orig) => {
  const real = await orig<typeof import("../lib/env")>();
  return { ...real, env: { ...real.env, appSecret: "test-secret-for-tracking", appUrl: "https://app.example.test" } };
});

import { trackToken, parseTrackToken, trackHidden, trackingPage, trackLang, trackingUrl } from "../services/tracking";
import { receiptToken, parseReceiptToken } from "../services/receipt";

/** База-очередь: каждый select отдаёт следующий заготовленный ответ, в порядке вызовов. */
function queueDb(answers: unknown[][]) {
  const q = [...answers];
  const chain = (rows: unknown[]): Record<string, unknown> => {
    const p = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>;
    for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit", "groupBy"]) p[m] = () => chain(rows);
    return p;
  };
  return { select: () => chain(q.shift() ?? []) } as never;
}

const NOW = Date.UTC(2026, 9, 21, 7, 0, 0); // 21.10.2026, 12:00 по Ташкенту
const baseOrder = {
  id: 77, tenantId: 1, number: "ORD-077", status: "shipped", deliveryStatus: "out_for_delivery",
  deliveredAt: null, deletedAt: null, courierId: 5, plannedDeliveryDate: null, routeSeq: 3,
  shopLat: "41.31108100", shopLng: "69.27973700", tenantStatus: "active",
};

describe("метка слежения", () => {
  it("1. своя подпись: чек сюда не подходит, слежение — к чеку; порча — нет", () => {
    const t = trackToken(77);
    expect(parseTrackToken(t)).toBe(77);
    expect(parseTrackToken(receiptToken(77))).toBeNull();
    expect(parseReceiptToken(t)).toBeNull();
    expect(parseTrackToken(t.replace(/.$/, c => (c === "A" ? "B" : "A")))).toBeNull();
    expect(parseTrackToken("78." + t.split(".")[1])).toBeNull();
    expect(parseTrackToken("77")).toBeNull();
    expect(trackingUrl(77)).toBe(`https://app.example.test/t/${t}`);
  });
});

describe("когда ссылки нет", () => {
  const at = (days: number) => new Date(NOW - days * 86_400_000);
  it("2. ждёт подтверждения, отменён, возвращён, удалён, доставлен давно — нет; в работе и свежий — есть", () => {
    const o = { status: "new", deletedAt: null, deliveredAt: null, deliveryStatus: "not_assigned" };
    expect(trackHidden(o, NOW)).toBe(false);
    expect(trackHidden({ ...o, status: "pending" }, NOW)).toBe(true);
    expect(trackHidden({ ...o, status: "cancelled" }, NOW)).toBe(true);
    expect(trackHidden({ ...o, status: "returned" }, NOW)).toBe(true);
    expect(trackHidden({ ...o, deletedAt: at(0) }, NOW)).toBe(true);
    expect(trackHidden({ ...o, status: "delivered", deliveryStatus: "delivered", deliveredAt: at(2) }, NOW)).toBe(false);
    expect(trackHidden({ ...o, status: "delivered", deliveryStatus: "delivered", deliveredAt: at(4) }, NOW)).toBe(true);
  });

  it("3. приостановленная организация и отменённый заказ — 404 без единого слова о заказе", async () => {
    const suspended = await trackingPage(queueDb([[{ ...baseOrder, tenantStatus: "suspended" }]]), trackToken(77), "ru", NOW);
    expect(suspended.status).toBe(404);
    expect(suspended.html).not.toContain("ORD-077");

    const cancelled = await trackingPage(queueDb([[{ ...baseOrder, status: "cancelled" }]]), trackToken(77), "ru", NOW);
    expect(cancelled.status).toBe(404);

    const none = await trackingPage(queueDb([[]]), trackToken(77), "ru", NOW);
    expect(none.status).toBe(404);
    // Испорченная метка до базы не доходит.
    const bad = await trackingPage(queueDb([]), "77.xxxxxxxxxxxxxxxxxxxxxx", "uz", NOW);
    expect(bad.status).toBe(404);
    expect(bad.html).toContain("Havola ishlamaydi");
  });
});

describe("что на странице", () => {
  it("4. курьер не назван, координат нет, минуты есть; текст экранирован", async () => {
    const db = queueDb([
      [{ ...baseOrder, number: "<b>ORD-077</b>" }],
      [{ company: "Склад & <Ко>", phone: "+998 90 123-45-67" }],
      [{ n: 2 }],
      [{ lat: "41.29950000", lng: "69.24010000" }],
    ]);
    const r = await trackingPage(db, trackToken(77), "ru", NOW);
    expect(r.status).toBe(200);
    expect(r.html).toContain("Курьер едет к вам");
    expect(r.html).toContain("Перед вами адресов: 2");
    expect(r.html).toMatch(/Примерно через \d+ мин/);
    for (const c of ["41.311", "69.279", "41.2995", "69.2401"]) expect(r.html).not.toContain(c);
    expect(r.html).toContain("&lt;b&gt;ORD-077&lt;/b&gt;");
    expect(r.html).toContain("Склад &amp; &lt;Ко&gt;");
    expect(r.html).not.toContain("<b>ORD-077</b>");
    expect(r.html).toContain('href="tel:+998901234567"');
  });

  it("4. без свежей точки курьера минут не обещаем; доставленный — время доставки", async () => {
    const noPing = await trackingPage(queueDb([[baseOrder], [{ company: "Склад" }], [{ n: 0 }], []]), trackToken(77), "ru", NOW);
    expect(noPing.html).not.toMatch(/Примерно через/);

    const done = await trackingPage(queueDb([
      [{ ...baseOrder, status: "delivered", deliveryStatus: "delivered", deliveredAt: new Date(NOW - 3_600_000) }],
      [{ company: "Склад" }],
    ]), trackToken(77), "uz", NOW);
    expect(done.html).toContain("Yetkazildi 21.10");
    expect(done.html).not.toContain('http-equiv="refresh"');
    // Доставленному — ссылка на чек: там магазин подтверждает получение.
    expect(done.html).toContain(`href="/r/${receiptToken(77)}"`);
    expect(noPing.html).not.toContain("/r/");
  });

  /*
    Срыв — без обещаний: «поставщик свяжется с вами» висело на странице хоть
    неделю, а позвонить магазину никто не напоминает. «Сегодня» — только в
    день срыва.
  */
  it("4. не доставлен — без обещания позвонить; «сегодня» — только в день срыва", async () => {
    const failed = { ...baseOrder, status: "new", deliveryStatus: "failed", courierId: null };
    const today = await trackingPage(queueDb([[failed], [{ company: "Склад" }], [{ at: new Date(NOW - 3_600_000) }]]), trackToken(77), "ru", NOW);
    expect(today.html).toContain("Сегодня доставить не получилось. Новый день доставки уточняется");
    const earlier = await trackingPage(queueDb([[failed], [{ company: "Склад" }], [{ at: new Date(NOW - 2 * 86_400_000) }]]), trackToken(77), "uz", NOW);
    expect(earlier.html).toContain("Yetkazish amalga oshmadi. Yangi yetkazish kuni aniqlanmoqda");
    for (const r of [today, earlier]) expect(r.html).not.toMatch(/свяжется|bog'lanadi/);
  });

  it("4. перенесённый на будущий день — «запланирована на», без минут", async () => {
    const r = await trackingPage(queueDb([[{ ...baseOrder, deliveryStatus: "assigned", plannedDeliveryDate: "2026-10-23" }], [{ company: "Склад" }]]), trackToken(77), "ru", NOW);
    expect(r.html).toContain("Доставка запланирована на 23.10");
    expect(r.html).not.toMatch(/Перед вами|Примерно/);
  });

  it("5. язык: ?lang=, затем заголовок браузера, иначе русский", () => {
    expect(trackLang("uz", "ru-RU")).toBe("uz");
    expect(trackLang(undefined, "uz-UZ,uz;q=0.9")).toBe("uz");
    expect(trackLang(undefined, "en-US")).toBe("ru");
    expect(trackLang("de", undefined)).toBe("ru");
  });
});
