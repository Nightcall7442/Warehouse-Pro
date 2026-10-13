// @vitest-environment jsdom
/**
 * Календарь периода: два щелчка — период, и ничего больше.
 *
 * Здесь закреплено то, ради чего он заменил пары полей type="date":
 *   1. открытый календарь показывает период, который сейчас на экране;
 *   2. начало и конец — два щелчка, конец раньше начала — тоже период;
 *   3. дни позже «сегодня» не выбираются: продаж из будущего нет;
 *   4. клавиатурой ходят стрелками, в том числе через границу месяца;
 *   5. месяцы и дни недели — на языке экрана, а не «M09».
 *
 * Нарочная поломка: убери orderRange в commit — упадёт «конец раньше
 * начала»; убери disabled у дня — упадёт «будущее не выбирается».
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { DateRangePicker } from "./DateRangePicker";
import { FixedLang } from "@/i18n";
import { monthCells, quickRanges, rangeText, rangeTextShort } from "@/lib/date-range";

// Popper мерит якорь через ResizeObserver, которого в jsdom нет.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

beforeEach(() => {
  // Подделывается только Date: таймеры Radix должны идти по-настоящему.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 13, 12, 0));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness({ onChange, lang = "ru" }: { onChange?: (f: string, t: string) => void; lang?: "ru" | "uz" }) {
  const [range, setRange] = useState({ from: "2026-09-13", to: "2026-10-13" });
  const picker = (
    <DateRangePicker
      from={range.from}
      to={range.to}
      max="2026-10-13"
      onChange={(f, t) => { setRange({ from: f, to: t }); onChange?.(f, t); }}
      testId="cal"
    />
  );
  return <FixedLang lang={lang}>{picker}</FixedLang>;
}

const open = () => fireEvent.click(screen.getByTestId("cal"));
const day = (label: string) => screen.getByRole("button", { name: label });

describe("календарь периода", () => {
  it("кнопка называет период, открытый календарь показывает его полосой", () => {
    render(<Harness />);
    expect(screen.getByTestId("cal").textContent).toBe("13.09.2026 — 13.10.2026");
    open();
    expect(day("13 сентября 2026").getAttribute("aria-pressed")).toBe("true");
    expect(day("13 октября 2026").getAttribute("aria-pressed")).toBe("true");
    expect(day("1 октября 2026").className).toContain("is-in-range");
    expect(day("12 сентября 2026").className, "полоса вылезла за начало").not.toContain("is-in-range");
  });

  it("два щелчка — период, календарь закрывается", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    open();
    fireEvent.click(day("5 октября 2026"));
    expect(onChange, "период ушёл после первого щелчка").not.toHaveBeenCalled();
    fireEvent.click(day("12 октября 2026"));
    expect(onChange).toHaveBeenCalledWith("2026-10-05", "2026-10-12");
    expect(screen.queryByTestId("cal-calendar"), "календарь остался открытым").toBeNull();
    expect(screen.getByTestId("cal").textContent).toBe("05.10.2026 — 12.10.2026");
  });

  it("конец раньше начала — тоже период, по порядку", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    open();
    fireEvent.click(day("20 сентября 2026"));
    fireEvent.click(day("2 сентября 2026"));
    expect(onChange).toHaveBeenCalledWith("2026-09-02", "2026-09-20");
  });

  it("будущее не выбирается", () => {
    render(<Harness />);
    open();
    expect((day("14 октября 2026") as HTMLButtonElement).disabled).toBe(true);
    expect((day("13 октября 2026") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Следующий месяц" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("«Прошлый месяц» — календарный месяц целиком", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Прошлый месяц" }));
    expect(onChange).toHaveBeenCalledWith("2026-09-01", "2026-09-30");
  });

  it("стрелки ведут по дням, PageUp — через границу месяца", () => {
    render(<Harness />);
    open();
    const start = day("13 октября 2026");
    act(() => start.focus());
    fireEvent.keyDown(start, { key: "ArrowLeft" });
    expect(document.activeElement?.getAttribute("data-day")).toBe("2026-10-12");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement?.getAttribute("data-day")).toBe("2026-10-05");
    // Два месяца назад от октября — июль: его не было на экране, календарь
    // перелистнулся сам, и фокус не потерялся.
    fireEvent.keyDown(document.activeElement!, { key: "PageUp" });
    fireEvent.keyDown(document.activeElement!, { key: "PageUp" });
    fireEvent.keyDown(document.activeElement!, { key: "PageUp" });
    expect(document.activeElement?.getAttribute("data-day")).toBe("2026-07-05");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("data-day")).toBe("2026-07-06");
  });

  it("по-узбекски — месяц словом и дни недели, а не «M10»", () => {
    render(<Harness lang="uz" />);
    open();
    const cal = screen.getByTestId("cal-calendar");
    expect(cal.textContent).toContain("Oktabr 2026");
    expect(cal.textContent).toContain("Du");
    expect(cal.textContent).not.toMatch(/M\d\d/);
    expect(screen.getByRole("button", { name: "O'tgan oy" })).toBeTruthy();
  });
});

describe("арифметика календаря", () => {
  it("сетка месяца начинается с понедельника", () => {
    // 1 октября 2026 — четверг: три пустые клетки (пн, вт, ср).
    const cells = monthCells("2026-10-01");
    expect(cells.slice(0, 4)).toEqual([null, null, null, "2026-10-01"]);
    expect(cells.at(-1)).toBe("2026-10-31");
    // 1 июня 2026 — понедельник: пустых нет.
    expect(monthCells("2026-06-15")[0]).toBe("2026-06-01");
  });

  it("подпись периода", () => {
    expect(rangeText("2026-09-13", "2026-10-13")).toBe("13.09.2026 — 13.10.2026");
    expect(rangeText("2026-10-13", "2026-10-13")).toBe("13.10.2026");
    expect(rangeText("2026-10-13", "")).toBe("13.10.2026 —");
    expect(rangeText("", "")).toBe("");
  });

  it("короткая подпись — без года только в текущем году", () => {
    expect(rangeTextShort("2026-09-13", "2026-10-13", "2026-10-13")).toBe("13.09 — 13.10");
    expect(rangeTextShort("2026-10-13", "2026-10-13", "2026-10-13")).toBe("13.10");
    // Прошлый год без года не угадать — подпись полная.
    expect(rangeTextShort("2025-12-20", "2026-01-10", "2026-10-13")).toBe("20.12.2025 — 10.01.2026");
  });

  it("«этот месяц» не заходит за сегодня, прошлый — до последнего числа", () => {
    const [today, month, prev] = quickRanges("2026-03-13", "2026-03-13");
    expect(today).toMatchObject({ from: "2026-03-13", to: "2026-03-13" });
    expect(month).toMatchObject({ from: "2026-03-01", to: "2026-03-13" });
    expect(prev).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
  });
});
