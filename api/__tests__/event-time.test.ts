/**
 * Время офлайн-события — время события, а не отправки.
 *
 * Отметки визитов и доставок с телефона ждут связи часами: синхронизация
 * вечером ставила всем визитам дня «18:40», доставка после полуночи уезжала
 * в следующий день (оплата курьера «за довезённое» за период), супервайзеру
 * нечего было сверять с точками маршрута. Телефон теперь шлёт `recordedAt`
 * из очереди; онлайн-путь ничего не шлёт, и «сейчас» остаётся как было.
 *
 * Часы телефона бывают неверны: время из будущего или старше недели не
 * отвергает событие — визит важнее его часа, — а просто не принимается.
 */
import { describe, it, expect } from "vitest";
import { eventTime, recordedAtInput } from "../lib/event-time";

const NOW = new Date("2026-09-19T12:00:00.000Z");

describe("eventTime", () => {
  it("без поля — сейчас", () => {
    expect(eventTime(undefined, NOW)).toBe(NOW);
  });

  it("утренний визит, ушедший вечером, — утром", () => {
    expect(eventTime("2026-09-19T09:15:00.000Z", NOW).toISOString()).toBe("2026-09-19T09:15:00.000Z");
    // Со смещением тоже: телефон шлёт ISO как умеет.
    expect(eventTime("2026-09-19T14:15:00+05:00", NOW).toISOString()).toBe("2026-09-19T09:15:00.000Z");
  });

  it("часы телефона врут — событие остаётся, время «сейчас»", () => {
    expect(eventTime("2026-09-19T12:06:00.000Z", NOW)).toBe(NOW);   // из будущего
    expect(eventTime("2026-09-11T12:00:00.000Z", NOW)).toBe(NOW);   // старше недели
    expect(eventTime("вчера", NOW)).toBe(NOW);
  });

  it("на границе принимается: пять минут вперёд, неделя назад", () => {
    expect(eventTime("2026-09-19T12:04:59.000Z", NOW).toISOString()).toBe("2026-09-19T12:04:59.000Z");
    expect(eventTime("2026-09-12T12:00:01.000Z", NOW).toISOString()).toBe("2026-09-12T12:00:01.000Z");
  });

  it("вход — ISO со смещением или ничего; мусор не проходит zod", () => {
    expect(recordedAtInput.safeParse(undefined).success).toBe(true);
    expect(recordedAtInput.safeParse("2026-09-19T09:15:00.000Z").success).toBe(true);
    expect(recordedAtInput.safeParse("2026-09-19 09:15").success).toBe(false);
  });
});
