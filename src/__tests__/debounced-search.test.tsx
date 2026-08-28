// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

/**
 * Задержка ввода в поисковых полях.
 *
 * Раньше каждая буква уходила в запрос отдельным ключом. У нового ключа данных
 * ещё нет, страница показывает заглушку «загрузка» вместо содержимого — вместе
 * с полем, в которое человек печатает. Поле исчезает, фокус теряется, и с
 * первой буквы это выглядит как перезагрузка страницы.
 *
 * Проверяется поведение, а не устройство: важно, сколько разных значений
 * доходит до запроса и в какой момент.
 */
describe("поиск ждёт, пока человек допечатает", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("пока идёт набор, запрос не меняется", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: "" },
    });

    for (const v of ["м", "ма", "маг", "магн"]) {
      rerender({ v });
      act(() => { vi.advanceTimersByTime(120) });
    }

    expect(result.current, "значение ушло в запрос, не дождавшись паузы").toBe("");
  });

  it("после паузы уходит только последнее набранное", () => {
    const seen: string[] = [];
    const { result, rerender } = renderHook(({ v }) => {
      const out = useDebouncedValue(v);
      if (seen[seen.length - 1] !== out) seen.push(out);
      return out;
    }, { initialProps: { v: "" } });

    for (const v of ["м", "ма", "маг", "магн", "магнит"]) {
      rerender({ v });
      act(() => { vi.advanceTimersByTime(50) });
    }
    act(() => { vi.advanceTimersByTime(300) });

    expect(result.current).toBe("магнит");
    expect(seen, `запросов было ${seen.length}: ${seen.join(" → ")}`).toEqual(["", "магнит"]);
  });

  it("очистка поля возвращает полный список сразу, без задержки", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: "" },
    });

    rerender({ v: "магнит" });
    act(() => { vi.advanceTimersByTime(300) });
    expect(result.current).toBe("магнит");

    // Ни одного таймера не прокручиваем: стёртое поле обязано подействовать
    // тем же кадром. Человек, стерший запрос, ждёт весь список, а не треть
    // секунды со старой выборкой на экране.
    rerender({ v: "" });
    expect(result.current, "после очистки на экране ещё держится прошлая выборка").toBe("");
  });

});
