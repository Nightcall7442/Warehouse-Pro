import { describe, it, expect } from "vitest";
import { buildRoster, ONLINE_WINDOW_MS } from "./agent-roster";
import { visiblePins, boundsOf } from "./map-declutter";

/**
 * Обе проверки стерегут одну и ту же беду с двух сторон: экран, который
 * молчит о том, чего не показал.
 */

const NOW = new Date("2026-09-06T12:00:00Z").getTime();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000);

describe("buildRoster: молчащий агент — это строка, а не пустота", () => {
  it("агент из справочника без точки остаётся в списке", () => {
    const r = buildRoster(
      [{ id: 1, name: "Азиз" }, { id: 2, name: "Бек" }],
      [{ agentId: 1, lat: "41.3", lng: "69.2", at: minutesAgo(2) }],
      NOW,
    );

    expect(r.counts, "агентов двое, точка одна — обе строки должны быть на месте")
      .toEqual({ online: 1, stale: 0, silent: 1, total: 2 });
    expect(r.rows[1].state, "у Бека точки нет — он не «офлайн», он молчит").toBe("silent");
    expect(r.rows[1].lat, "координаты взять неоткуда").toBeNull();
  });

  it("сигнал старше окна — «был раньше», а не «на связи»", () => {
    const r = buildRoster(
      [{ id: 1, name: "Азиз" }],
      [{ agentId: 1, lat: "41.3", lng: "69.2", at: new Date(NOW - ONLINE_WINDOW_MS - 1000) }],
      NOW,
    );
    expect(r.rows[0].state).toBe("stale");
  });

  it("время берётся из at, а не из created_at", () => {
    // Точка пролежала в буфере телефона час и доехала только что. По
    // created_at агент выглядел свежим и стоял там, где его давно нет.
    const r = buildRoster(
      [{ id: 1, name: "Азиз" }],
      [{ agentId: 1, lat: "41.3", lng: "69.2", at: minutesAgo(90), createdAt: new Date(NOW) }],
      NOW,
    );
    expect(r.rows[0].state, "агент был здесь полтора часа назад").toBe("stale");
  });

  it("нулевая координата — это незаполненное поле, а не Гвинейский залив", () => {
    const r = buildRoster([{ id: 1, name: "Азиз" }], [{ agentId: 1, lat: "0", lng: "0", at: minutesAgo(1) }], NOW);
    expect(r.rows[0].lat, "0 приходит из пустого поля — на карту такое не ставят").toBeNull();
  });

  it("точка от того, кого нет в справочнике, не пропадает", () => {
    const r = buildRoster([], [{ agentId: 7, agentName: "Уволенный", lat: "41.3", lng: "69.2", at: minutesAgo(1) }], NOW);
    expect(r.counts.total, "его метка на карте есть — списку молчать о ней нельзя").toBe(1);
    expect(r.rows[0].name).toBe("Уволенный");
  });

  it("на связи идут первыми, молчащие — последними", () => {
    const r = buildRoster(
      [{ id: 1, name: "Молчит" }, { id: 2, name: "Давно" }, { id: 3, name: "Сейчас" }],
      [
        { agentId: 2, lat: "41.3", lng: "69.2", at: minutesAgo(200) },
        { agentId: 3, lat: "41.3", lng: "69.3", at: minutesAgo(1) },
      ],
      NOW,
    );
    expect(r.rows.map(x => x.name)).toEqual(["Сейчас", "Давно", "Молчит"]);
    expect(r.lastSignalAt?.getTime()).toBe(minutesAgo(1).getTime());
  });
});

describe("visiblePins: карта начинается не в углу страницы", () => {
  const FOOT = { halfWidth: 17, above: 58, below: 4 };
  // Карта на этой странице лежит правее и ниже начала страницы — ровно так,
  // как её видит globalToPage.
  const VIEW = { left: 440, top: 330, width: 800, height: 480 };

  it("метка в дальнем углу карты видна", () => {
    // ЭТО И БЫЛО «видно 0 из 73»: окно брали из container.getSize(), то есть
    // от нуля, и всё правее 880-й точки страницы объявлялось «за экраном».
    const far = { x: VIEW.left + VIEW.width - 20, y: VIEW.top + VIEW.height - 20 };
    expect(visiblePins([far], VIEW, FOOT), "точка лежит внутри карты").toEqual([true]);
  });

  it("метка за краем окна не показывается", () => {
    const off = { x: VIEW.left + VIEW.width + 300, y: VIEW.top };
    expect(visiblePins([off], VIEW, FOOT)).toEqual([false]);
  });

  it("две метки в одном доме — видна первая по приоритету", () => {
    const a = { x: 700, y: 500 };
    const b = { x: 704, y: 502 };
    expect(visiblePins([a, b], VIEW, FOOT), "вторая налезает на первую").toEqual([true, false]);
  });

  it("метки, разнесённые по экрану, не мешают друг другу", () => {
    const pins = [{ x: 500, y: 400 }, { x: 700, y: 400 }, { x: 900, y: 700 }];
    expect(visiblePins(pins, VIEW, FOOT)).toEqual([true, true, true]);
  });
});

describe("boundsOf: под что подгонять вид", () => {
  it("пустой список — подгонять нечего", () => {
    expect(boundsOf([])).toBeNull();
  });

  it("одна точка — центр, а не рамка нулевого размера", () => {
    expect(boundsOf([[41.3, 69.2]]), "рамка нулевого размера уводит карту в предельное приближение")
      .toEqual({ center: [41.3, 69.2] });
  });

  it("разнесённые точки — рамка по крайним", () => {
    expect(boundsOf([[41.3, 69.2], [41.5, 69.0], [41.4, 69.4]]))
      .toEqual({ bounds: [[41.3, 69.0], [41.5, 69.4]] });
  });
});
