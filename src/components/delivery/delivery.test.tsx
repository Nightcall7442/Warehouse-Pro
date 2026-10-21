// @vitest-environment jsdom
/**
 * Экраны доставки: что из базы попадает в разметку и как.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Подсказки на картах (карта курьера) экранируют название
 *     магазина, номер заказа и имя: «<img onerror>» в названии магазина —
 *     текст, а не картинка, выполняющая код на экране офиса.
 *  2. Порядок на доске: перетащенный поверх серверного; довезённые выпадают,
 *     новые встают в конец; «изменён» — только если правда изменён.
 *  3. Дни переноса: окно и подписи по календарю.
 *  4. Карточка заказа рисует подпись ломаной из чисел, фото — ссылками на
 *     /api/photos/delivery, причину — словами, перенос — днём.
 *  5. Ссылка на карту — только из чисел.
 *
 * Нарочная поломка: в balloonHtml убери escapeHtml у строк — падает 1.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { balloonHtml, mergeOrder, orderChanged, latLng } from "./dispatch";
import { addDays, planDayChoices, planDayLabel } from "./plan-days";
import { mapLink } from "./links";

vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru", t: (k: string) => k }), useTranslate: () => (ru: string) => ru }));

const { DeliveryProof } = await import("./DeliveryProof");

afterEach(cleanup);

describe("подсказки карт", () => {
  it("1. название, номер и имя — экранированы", () => {
    const b = balloonHtml(`Магазин "Ромашка" <img src=x onerror=alert(1)>`, ["ORD-<b>1</b>", null, "Ул. Навои & 5"]);
    expect(b.header).not.toContain("<img");
    expect(b.header).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(b.header).toContain("&quot;Ромашка&quot;");
    expect(b.body).toContain("ORD-&lt;b&gt;1&lt;/b&gt;");
    expect(b.body).toContain("Навои &amp; 5");
    expect(b.hint).toBe("Магазин &quot;Ромашка&quot; &lt;img src=x onerror=alert(1)&gt;");
  });

  it("1. карта курьера не собирает подсказку сырой строкой", () => {
    const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
    const courierPage = read("../../pages/CourierDeliveries.tsx");
    // Прежняя строка вставляла ${m.name} прямо в <b>…</b>.
    expect(courierPage).not.toMatch(/balloonContentHeader:\s*`[^`]*\$\{m\.name\}/);
    expect(courierPage).toContain("balloonHtml(m.name)");
    for (const src of [courierPage]) {
      for (const m of src.matchAll(/balloonContent(?:Header|Body):\s*([^,}]+)/g)) {
        expect(m[1].trim(), "подсказка — только из balloonHtml").toMatch(/^b\.(header|body)$/);
      }
    }
  });
});

describe("порядок на доске развоза", () => {
  it("2. свой порядок поверх серверного; ушедшие выпадают, новые — в конец", () => {
    expect(mergeOrder([1, 2, 3], null)).toEqual([1, 2, 3]);
    expect(mergeOrder([1, 2, 3], [3, 1, 2])).toEqual([3, 1, 2]);
    expect(mergeOrder([1, 3, 4], [3, 2, 1])).toEqual([3, 1, 4]);
    expect(orderChanged([1, 2, 3], [1, 2, 3])).toBe(false);
    expect(orderChanged([1, 2, 3], [2, 1, 3])).toBe(true);
    expect(orderChanged([1, 2], [1, 2, 3])).toBe(true);
  });

  it("5. координаты — числами; пустые и нулевые — нет точки", () => {
    expect(latLng("41.3", "69.2")).toEqual([41.3, 69.2]);
    expect(latLng(null, "69.2")).toBeNull();
    expect(latLng("", "")).toBeNull();
    expect(latLng("abc", "69")).toBeNull();
    expect(mapLink("41.31", "69.27")).toBe("https://yandex.ru/maps/?pt=69.27,41.31&z=17&l=map");
    expect(mapLink("javascript:alert(1)", "1")).toBeNull();
  });
});

describe("дни переноса", () => {
  it("3. окно и подписи", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(planDayChoices("2026-10-21", 1, 3)).toEqual(["2026-10-22", "2026-10-23", "2026-10-24"]);
    expect(planDayLabel("2026-10-21", "2026-10-21", "ru")).toBe("Сегодня");
    expect(planDayLabel("2026-10-22", "2026-10-21", "uz")).toBe("Ertaga");
    expect(planDayLabel("2026-10-26", "2026-10-21", "ru")).toBe("Пн 26.10");
    expect(planDayLabel("2026-10-26", "2026-10-21", "uz")).toBe("Du 26.10");
  });
});

describe("«Доставка» в карточке заказа", () => {
  const events = [
    { id: 11, kind: "failed" as const, courierName: "Азиз", reasonCode: "shop_closed" as const, note: "до 14:00", recordedAt: new Date("2026-10-20T06:00:00Z") },
    { id: 12, kind: "rescheduled" as const, courierName: "Азиз", reasonCode: "asked_reschedule" as const, rescheduledTo: "2026-10-23", recordedAt: new Date("2026-10-20T07:00:00Z") },
    {
      id: 13, kind: "delivered" as const, courierName: "Азиз", recipientName: "Дилшод <b>", photoCount: 2,
      signature: { w: 1000, h: 400, strokes: [[0, 0, 100, 200, 300, 100], ["x" as unknown as number, 1]] },
      lat: "41.31", lng: "69.27", recordedAt: new Date("2026-10-23T08:00:00Z"),
    },
  ];

  it("4. попытки по порядку: причина словами, перенос днём, подпись ломаной, фото ссылками", () => {
    render(<DeliveryProof events={events} deliveryResult="partial_paid" deliveryNotes="остаток завтра" plannedDeliveryDate={null} open={false} />);
    expect(screen.getByTestId("delivery-event-failed").textContent).toContain("Магазин закрыт: до 14:00");
    expect(screen.getByTestId("delivery-event-rescheduled").textContent).toContain("Перенесён на 23.10");
    const delivered = screen.getByTestId("delivery-event-delivered");
    expect(delivered.textContent).toContain("Принял: Дилшод <b>");
    expect(delivered.innerHTML, "имя — текстом, а не разметкой").not.toContain("<b>Дилшод");

    const svg = screen.getByTestId("delivery-signature");
    expect(svg.getAttribute("viewBox")).toBe("0 0 1000 400");
    const lines = svg.querySelectorAll("polyline");
    expect(lines, "штрих с нечислом выпал").toHaveLength(1);
    expect(lines[0].getAttribute("points")).toBe("0,0 100,200 300,100");

    const photos = screen.getAllByTestId("delivery-photo");
    expect(photos.map(a => a.getAttribute("href"))).toEqual(["/api/photos/delivery/13/0", "/api/photos/delivery/13/1"]);
    expect(screen.getByTestId("delivery-event-map").getAttribute("href")).toBe("https://yandex.ru/maps/?pt=69.27,41.31&z=17&l=map");
    expect(screen.getByTestId("delivery-proof").textContent).toContain("Частично оплачен");
  });

  it("4. открытый заказ с днём — «запланирована на»; пусто — блока нет", () => {
    render(<DeliveryProof events={[]} plannedDeliveryDate="2026-10-23" open />);
    expect(screen.getByTestId("delivery-planned").textContent).toContain("23.10");
    cleanup();
    const { container } = render(<DeliveryProof events={[]} plannedDeliveryDate={null} open />);
    expect(container.innerHTML).toBe("");
  });
});
