/**
 * Выбрать период в календаре (components/DateRangePicker) так, как это делает
 * человек: открыть кнопку, долистать до месяца, щёлкнуть начало и конец.
 *
 * Листание — не заглушка: календарь открывается на месяце конца текущего
 * периода, а он зависит от сегодняшнего числа. Тест, щёлкающий «1 сентября»
 * без листания, проходил бы только в сентябре и октябре.
 */
import { fireEvent } from "@testing-library/react";

// Popper мерит якорь через ResizeObserver, которого в jsdom нет.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

function calendar(testId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testId}-calendar"]`);
  if (!el) throw new Error(`календарь «${testId}» не открыт`);
  return el;
}

function clickDay(testId: string, day: string) {
  for (let i = 0; i < 60; i++) {
    const cal = calendar(testId);
    const btn = cal.querySelector<HTMLButtonElement>(`[data-day="${day}"]`);
    if (btn) { fireEvent.click(btn); return; }
    const first = cal.querySelector<HTMLElement>("[data-day]")?.dataset.day ?? "";
    const nav = cal.querySelectorAll<HTMLButtonElement>(".drp-nav");
    fireEvent.click(day < first ? nav[0] : nav[nav.length - 1]);
  }
  throw new Error(`день ${day} не нашёлся в календаре «${testId}»`);
}

export function openRange(testId: string) {
  const trigger = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!trigger) throw new Error(`нет кнопки календаря «${testId}»`);
  fireEvent.click(trigger);
}

export function pickRange(testId: string, from: string, to: string) {
  openRange(testId);
  clickDay(testId, from);
  clickDay(testId, to);
}
