/**
 * День агента на экране слежения: что сделано и чем подтверждено.
 *
 * ── Что этот расчёт решает ──────────────────────────────────────────────────
 *
 * Карта отвечала на вопрос «где человек». Директор приходит с другим: «что он
 * сегодня сделал». Ответ был рассыпан по трём экранам — визиты на «Планах
 * визитов», норма на «Планах продаж», фотоотчёт не показывался нигде вовсе.
 *
 * Здесь считается первая половина ответа: сколько точек обойдено из
 * запланированных и какие снимки за этим стоят. Ошибка не видна глазом — она
 * даёт правдоподобное число, — поэтому проверяется отдельно от разметки.
 */
import { describe, it, expect } from "vitest";
import { buildAgentDays, type PlanRow } from "./agent-day";

const plan = (over: Partial<PlanRow> & { id: number }): PlanRow => ({
  agentId: 10,
  status: "planned",
  shopName: "Магазин",
  photoUrl: null,
  visitedAt: null,
  ...over,
});

describe("день агента складывается из планов", () => {
  it("считает обойдённые точки и общее число", () => {
    const days = buildAgentDays([
      plan({ id: 1, status: "visited" }),
      plan({ id: 2, status: "planned" }),
      plan({ id: 3, status: "skipped" }),
    ], "Магазин");

    expect(days.get(10)).toMatchObject({ visited: 1, planned: 3 });
  });

  it("пропущенный визит обойдённым не считается", () => {
    // «Пропущен» — это осознанное решение агента, а не выполненная работа.
    const days = buildAgentDays([
      plan({ id: 1, status: "skipped" }),
      plan({ id: 2, status: "skipped" }),
    ], "Магазин");

    expect(days.get(10)!.visited).toBe(0);
    expect(days.get(10)!.planned).toBe(2);
  });

  it("агенты не смешиваются", () => {
    const days = buildAgentDays([
      plan({ id: 1, agentId: 10, status: "visited" }),
      plan({ id: 2, agentId: 11, status: "visited" }),
      plan({ id: 3, agentId: 11, status: "planned" }),
    ], "Магазин");

    expect(days.get(10)).toMatchObject({ visited: 1, planned: 1 });
    expect(days.get(11)).toMatchObject({ visited: 1, planned: 2 });
  });

  it("агента без плана в карте нет вовсе", () => {
    /*
      И это не то же самое, что ноль из нуля: панель на отсутствующей записи
      говорит «плана на день нет» — это ответ. «0 из 0» читалось бы как
      «ничего не сделал», хотя делать было нечего.
    */
    const days = buildAgentDays([plan({ id: 1, agentId: 10 })], "Магазин");

    expect(days.has(11)).toBe(false);
  });

  it("снимки идут в порядке визитов", () => {
    const days = buildAgentDays([
      plan({ id: 1, status: "visited", photoUrl: "/a", visitedAt: "2026-09-07T14:00:00Z" }),
      plan({ id: 2, status: "visited", photoUrl: "/b", visitedAt: "2026-09-07T09:00:00Z" }),
      plan({ id: 3, status: "visited", photoUrl: "/c", visitedAt: "2026-09-07T11:00:00Z" }),
    ], "Магазин");

    expect(days.get(10)!.photos.map(p => p.url)).toEqual(["/b", "/c", "/a"]);
  });

  it("снимок без времени визита уходит в конец", () => {
    /*
      Такие остались от планов, отмеченных до того, как время начали ставить
      обоими путями отметки. Поставить их первыми значило бы утверждать, что
      они самые ранние, — а мы просто не знаем когда.
    */
    const days = buildAgentDays([
      plan({ id: 1, status: "visited", photoUrl: "/старый", visitedAt: null }),
      plan({ id: 2, status: "visited", photoUrl: "/новый", visitedAt: "2026-09-07T09:00:00Z" }),
    ], "Магазин");

    expect(days.get(10)!.photos.map(p => p.url)).toEqual(["/новый", "/старый"]);
  });

  it("визит без снимка в ленту не попадает, но в счёт идёт", () => {
    // Отметить визит можно и без фото — это обычный случай, а не пробел.
    const days = buildAgentDays([
      plan({ id: 1, status: "visited" }),
      plan({ id: 2, status: "visited", photoUrl: "/есть" }),
    ], "Магазин");

    expect(days.get(10)!.visited).toBe(2);
    expect(days.get(10)!.photos).toHaveLength(1);
  });

  it("магазин без названия получает запасную подпись", () => {
    // Подпись уходит в title снимка: пустая строка там читается как сбой.
    const days = buildAgentDays(
      [plan({ id: 1, status: "visited", photoUrl: "/a", shopName: null })],
      "Магазин",
    );

    expect(days.get(10)!.photos[0].shopName).toBe("Магазин");
  });

  it("пустой ответ даёт пустую карту, а не падение", () => {
    expect(buildAgentDays(undefined, "Магазин").size).toBe(0);
    expect(buildAgentDays([], "Магазин").size).toBe(0);
  });
});
