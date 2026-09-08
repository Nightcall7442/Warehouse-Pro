/**
 * Границы группы и границы суток.
 *
 * ── Зачем это отдельно ──────────────────────────────────────────────────────
 *
 * Обе стороны чата — экран клиента и разбор обращений у поддержки — рисуют один
 * и тот же разговор. Разойдись они в том, где проходит граница суток или где
 * кончается группа реплик, и одна и та же переписка выглядела бы у клиента и у
 * поддержки по-разному: «Вчера» против «Сегодня» на одном и том же сообщении.
 * Поэтому расчёт один и проверяется здесь, а не в двух отрисовках порознь.
 */
import { describe, it, expect } from "vitest";
import { buildThread, GROUP_GAP_MS } from "@/lib/chat-thread";

const NOW = new Date("2026-09-08T15:00:00");

/** Сообщение: id, сторона, смещение от полудня указанных суток. */
function msg(id: number, fromPlatform: boolean, iso: string) {
  return { id, fromPlatform, createdAt: new Date(iso) };
}

const kinds = (rows: ReturnType<typeof buildThread>) => rows.map(r => r.kind);

describe("группы реплик", () => {
  it("подряд идущие реплики одной стороны — одна группа", () => {
    const rows = buildThread([
      msg(1, false, "2026-09-08T10:00:00"),
      msg(2, false, "2026-09-08T10:01:00"),
      msg(3, false, "2026-09-08T10:02:00"),
    ], NOW);

    const msgs = rows.filter(r => r.kind === "msg");
    expect(msgs.map(m => m.kind === "msg" && m.first)).toEqual([true, false, false]);
    // Время рисуется только у последней: три одинаковых подписи подряд — это
    // ровно то, из-за чего чат выглядел дёшево.
    expect(msgs.map(m => m.kind === "msg" && m.last)).toEqual([false, false, true]);
  });

  it("смена стороны разрывает группу", () => {
    const rows = buildThread([
      msg(1, false, "2026-09-08T10:00:00"),
      msg(2, true, "2026-09-08T10:01:00"),
    ], NOW);

    const msgs = rows.filter(r => r.kind === "msg");
    // Каждая реплика и первая, и последняя в своей группе — групп две.
    expect(msgs.every(m => m.kind === "msg" && m.first && m.last)).toBe(true);
  });

  it("долгая пауза разрывает группу", () => {
    /*
      Пять минут — граница между «дописывает начатое» и «вернулся к разговору».
      Возврат заслуживает своего времени под пузырём, иначе реплика через час
      выглядит продолжением предыдущей фразы.
    */
    const later = new Date(new Date("2026-09-08T10:00:00").getTime() + GROUP_GAP_MS + 1000);
    const rows = buildThread([
      msg(1, false, "2026-09-08T10:00:00"),
      { id: 2, fromPlatform: false, createdAt: later },
    ], NOW);

    const msgs = rows.filter(r => r.kind === "msg");
    expect(msgs.map(m => m.kind === "msg" && m.first)).toEqual([true, true]);
  });

  it("реплика через минуту группу не разрывает", () => {
    const rows = buildThread([
      msg(1, false, "2026-09-08T10:00:00"),
      msg(2, false, "2026-09-08T10:01:00"),
    ], NOW);
    const msgs = rows.filter(r => r.kind === "msg");
    expect(msgs.map(m => m.kind === "msg" && m.first)).toEqual([true, false]);
  });
});

describe("границы суток", () => {
  it("заголовок стоит перед первой репликой каждых суток", () => {
    const rows = buildThread([
      msg(1, false, "2026-09-06T18:00:00"),
      msg(2, false, "2026-09-07T09:00:00"),
      msg(3, true, "2026-09-08T09:00:00"),
    ], NOW);

    expect(kinds(rows)).toEqual(["day", "msg", "day", "msg", "day", "msg"]);
    expect(rows.filter(r => r.kind === "day").map(r => r.kind === "day" && r.when))
      .toEqual(["earlier", "yesterday", "today"]);
  });

  it("новые сутки разрывают группу, даже если пауза короткая", () => {
    // Полночь между двумя репликами: разница минуты, а сутки разные. Без
    // разрыва вторая молча оказалась бы под вчерашним заголовком.
    const rows = buildThread([
      msg(1, false, "2026-09-07T23:59:30"),
      msg(2, false, "2026-09-08T00:00:10"),
    ], NOW);

    const msgs = rows.filter(r => r.kind === "msg");
    expect(msgs.map(m => m.kind === "msg" && m.first)).toEqual([true, true]);
    expect(msgs.map(m => m.kind === "msg" && m.last)).toEqual([true, true]);
  });

  it("«сегодня» и «вчера» считаются от переданного момента, а не от часов", () => {
    // Иначе проверка начинала бы падать в полночь, а не при поломке.
    const rows = buildThread([msg(1, false, "2026-09-08T09:00:00")], new Date("2026-09-09T09:00:00"));
    expect(rows[0].kind === "day" && rows[0].when).toBe("yesterday");
  });
});

describe("испорченные данные", () => {
  it("пустая переписка даёт пустой список, а не заголовок суток", () => {
    expect(buildThread([], NOW)).toEqual([]);
  });

  it("дата строкой разбирается так же, как объектом", () => {
    // superjson отдаёт Date, голый JSON — строку. Разница незаметна ровно до
    // того момента, когда окажется, что она есть.
    const rows = buildThread([{ id: 1, fromPlatform: true, createdAt: "2026-09-08T10:00:00" }], NOW);
    expect(rows[0].kind === "day" && rows[0].when).toBe("today");
  });

  it("сообщение с нечитаемой датой не теряется", () => {
    /*
      Текст в нём настоящий и человеку нужен — выбросить его хуже, чем показать
      рядом с соседним по времени. Подставлять «сейчас» тоже нельзя: старое
      сообщение встало бы под заголовок «Сегодня», и это была бы уже неправда.
    */
    const rows = buildThread([
      msg(1, false, "2026-09-08T10:00:00"),
      { id: 2, fromPlatform: false, createdAt: "не дата" },
    ], NOW);

    expect(rows.filter(r => r.kind === "msg")).toHaveLength(2);
    expect(rows.filter(r => r.kind === "day")).toHaveLength(1);
  });
});
