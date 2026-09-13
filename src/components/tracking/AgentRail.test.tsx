// @vitest-environment jsdom
/**
 * Панель агентов обязана различать три разные пустоты.
 *
 * На прежнем экране все три выглядели одинаково — «Нет данных о локации»:
 * и агенты, которые не делятся, и организация, где агентов ещё не завели, и
 * упавший запрос. Первое лечится разговором с агентом, второе — заведением
 * сотрудника, третье — связистом. Одно сообщение на три беды отправляет
 * человека чинить не то.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AgentRail } from "./AgentRail";
import type { TrackedAgent } from "./agent-roster";

afterEach(cleanup);

const t = (ru: string) => ru;

const agent = (over: Partial<TrackedAgent> & { id: number }): TrackedAgent => ({
  name: `Агент ${over.id}`,
  state: "silent",
  at: null,
  lat: null,
  lng: null,
  batteryLevel: null,
  accuracy: null,
  mocked: false,
  ...over,
});

function renderRail(over: Partial<Parameters<typeof AgentRail>[0]> = {}) {
  return render(
    <AgentRail
      rows={[]}
      day={new Map()}
      silentCount={0}
      filtered={false}
      onResetFilter={() => {}}
      title="АГЕНТЫ"
      open
      onToggle={() => {}}
      failed={false}
      loading={false}
      onRetry={() => {}}
      selected={null}
      onSelect={() => {}}
      lang="ru"
      t={t}
      {...over}
    />,
  );
}

describe("панель агентов", () => {
  it("молчащий агент — строка со своим объяснением, а не пустой экран", () => {
    renderRail({
      rows: [agent({ id: 1, name: "Азиз" })],
      silentCount: 1,
    });
    expect(screen.getByText("Азиз"), "агент, у которого выключена геолокация, всё равно в списке").toBeTruthy();
    expect(screen.getByText(/Не выходил на связь за сутки/)).toBeTruthy();
  });

  it("когда молчат все — панель говорит, где это включается", () => {
    renderRail({
      rows: [agent({ id: 1 }), agent({ id: 2 })],
      silentCount: 2,
    });
    expect(screen.getByText(/Геолокацию включает сам агент/),
      "самое частое состояние экрана обязано объяснять, что делать").toBeTruthy();
  });

  it("часть молчит — счёт в подвале, а не пересказ списка", () => {
    renderRail({
      rows: [
        agent({ id: 1, name: "Азиз", state: "online", at: new Date(), lat: 41.3, lng: 69.2 }),
        agent({ id: 2, name: "Бек" }),
      ],
      silentCount: 1,
    });
    expect(screen.getByText(/1 агент не делится местоположением/), "склонение по числу").toBeTruthy();
  });

  it("сбой запроса — это не «никто не делится»", () => {
    renderRail({ failed: true, rows: [], silentCount: 0 });
    expect(screen.getByText(/Не удалось получить местоположения/)).toBeTruthy();
    expect(screen.queryByText(/Геолокацию включает сам агент/),
      "отказ связи нельзя объяснять поведением агентов").toBeNull();
  });

  it("агентов нет вовсе — отправляет заводить сотрудников", () => {
    renderRail({ rows: [], silentCount: 0 });
    expect(screen.getByText(/Агентов пока нет/)).toBeTruthy();
    // Кто заводит и где — иначе супервайзер ищет кнопку у себя.
    expect(screen.getByText(/заводит руководитель в разделе «Пользователи»/)).toBeTruthy();
  });

  it("подменённые координаты названы красным словом, а не спрятаны в точку", () => {
    const rows = [
      agent({ id: 1, name: "Бек", state: "online", at: new Date(), lat: 41.3, lng: 69.2, mocked: true }),
      agent({ id: 2, name: "Али", state: "online", at: new Date(), lat: 41.3, lng: 69.2 }),
    ];
    renderRail({ rows, silentCount: 0 });
    const badges = screen.getAllByText(/подмена координат/);
    expect(badges, "бейдж — только у того, чей телефон сообщил о подмене").toHaveLength(1);
    expect(badges[0].closest("button")?.textContent).toContain("Бек");
    expect((badges[0] as HTMLElement).style.color).toBe("var(--color-danger-text)");
  });

  it("отбор без совпадений предлагает вернуться ко всем", () => {
    renderRail({ rows: [], filtered: true, title: "НА СВЯЗИ" });
    expect(screen.getByText(/В этой группе никого нет/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Показать всех/ })).toBeTruthy();
  });

  it("строка без координат никуда не ведёт", () => {
    renderRail({ rows: [agent({ id: 1, name: "Бек" })], silentCount: 1 });
    const row = screen.getByText("Бек").closest("button");
    expect((row as HTMLButtonElement).disabled, "по такой строке карте нечего показать").toBe(true);
  });
});
