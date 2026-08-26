/**
 * Кто что видит в ленте событий.
 *
 * Живая рассылка фильтровала адресные события по получателю, а догон истории
 * после переподключения — нет. Через sse.recentEvents любой вошедший
 * пользователь получал события agent.location_updated со всех агентов
 * организации, то есть их GPS, закрытый в getLocations и getTrail ролью
 * супервайзера. Тем же путём уходили персональные уведомления директору.
 *
 * Оба пути теперь пользуются одним правилом; здесь проверяются оба.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { sseBus } from "../lib/sse";

type Enqueued = { userId: number; payloads: string[] };

/** Слушатель, записывающий всё, что ему прислали. */
function listen(tenantId: number, userId: number): Enqueued & { stop: () => void } {
  const rec: Enqueued = { userId, payloads: [] };
  const controller = {
    enqueue: (chunk: Uint8Array) => { rec.payloads.push(new TextDecoder().decode(chunk)); },
  } as unknown as ReadableStreamDefaultController;
  const stop = sseBus.subscribe(tenantId, userId, controller);
  return { ...rec, get payloads() { return rec.payloads; }, stop };
}

const TENANT = 900;
const AGENT_A = 11;
const AGENT_B = 22;
const CEO = 33;

beforeEach(() => {
  // История живёт в памяти шины и между тестами не сбрасывается сама —
  // разносим тесты по организациям, чтобы они не видели чужих событий.
});

describe("догон истории (getRecentEvents)", () => {
  it("не отдаёт координаты чужого агента", () => {
    const t = TENANT + 1;
    sseBus.emit({ type: "agent.location_updated", tenantId: t, userId: AGENT_A,
      data: { agentId: AGENT_A, lat: "41.3", lng: "69.2" } });

    const mine = sseBus.getRecentEvents(t, AGENT_A);
    const theirs = sseBus.getRecentEvents(t, AGENT_B);

    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(0);
  });

  it("общие события организации видят все", () => {
    const t = TENANT + 2;
    sseBus.emit({ type: "stock.low", tenantId: t, data: { productId: 5 } });

    expect(sseBus.getRecentEvents(t, AGENT_A)).toHaveLength(1);
    expect(sseBus.getRecentEvents(t, AGENT_B)).toHaveLength(1);
  });

  it("персональное уведомление директору не достаётся агенту", () => {
    const t = TENANT + 3;
    sseBus.emit({ type: "notification.new", tenantId: t, userId: CEO,
      data: { title: "Заказ доставлен", orderNumber: "№945" } });

    expect(sseBus.getRecentEvents(t, CEO)).toHaveLength(1);
    expect(sseBus.getRecentEvents(t, AGENT_A)).toHaveLength(0);
  });

  it("смесь общих и адресных разбирается по каждому получателю", () => {
    const t = TENANT + 4;
    sseBus.emit({ type: "agent.location_updated", tenantId: t, userId: AGENT_A, data: { lat: "1" } });
    sseBus.emit({ type: "agent.location_updated", tenantId: t, userId: AGENT_B, data: { lat: "2" } });
    sseBus.emit({ type: "stock.low", tenantId: t, data: { productId: 7 } });

    expect(sseBus.getRecentEvents(t, AGENT_A).map(e => e.type))
      .toEqual(["agent.location_updated", "stock.low"]);
    expect(sseBus.getRecentEvents(t, AGENT_B)).toHaveLength(2);
    expect(sseBus.getRecentEvents(t, CEO).map(e => e.type)).toEqual(["stock.low"]);
  });

  it("отбор по времени продолжает работать вместе с отбором по получателю", () => {
    const t = TENANT + 5;
    sseBus.emit({ type: "stock.low", tenantId: t, data: { n: 1 } });
    const cutoff = Date.now();
    // Событие после отсечки должно быть строго новее.
    while (Date.now() <= cutoff) { /* ждём следующую миллисекунду */ }
    sseBus.emit({ type: "stock.low", tenantId: t, data: { n: 2 } });

    const after = sseBus.getRecentEvents(t, AGENT_A, cutoff);
    expect(after).toHaveLength(1);
    expect(after[0].data.n).toBe(2);
  });

  it("события чужой организации не видны вовсе", () => {
    const mineT = TENANT + 6, otherT = TENANT + 7;
    sseBus.emit({ type: "stock.low", tenantId: otherT, data: { productId: 9 } });
    expect(sseBus.getRecentEvents(mineT, AGENT_A)).toHaveLength(0);
  });
});

describe("живая рассылка", () => {
  it("адресное событие приходит только адресату", () => {
    const t = TENANT + 8;
    const a = listen(t, AGENT_A);
    const b = listen(t, AGENT_B);

    sseBus.emit({ type: "agent.location_updated", tenantId: t, userId: AGENT_A, data: { lat: "41.3" } });

    expect(a.payloads).toHaveLength(1);
    expect(b.payloads).toHaveLength(0);
    a.stop(); b.stop();
  });

  it("общее событие приходит обоим", () => {
    const t = TENANT + 9;
    const a = listen(t, AGENT_A);
    const b = listen(t, AGENT_B);

    sseBus.emit({ type: "stock.low", tenantId: t, data: { productId: 3 } });

    expect(a.payloads).toHaveLength(1);
    expect(b.payloads).toHaveLength(1);
    a.stop(); b.stop();
  });

  it("рассылка и догон согласованы: что не пришло живьём, не придёт и в истории", () => {
    const t = TENANT + 10;
    const b = listen(t, AGENT_B);
    sseBus.emit({ type: "agent.location_updated", tenantId: t, userId: AGENT_A, data: { lat: "41.3" } });

    expect(b.payloads).toHaveLength(0);
    expect(sseBus.getRecentEvents(t, AGENT_B)).toHaveLength(0);
    b.stop();
  });
});
