// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { useCallback, useState } from "react";
import { SearchInput } from "@/components/SearchInput";

/**
 * Суть жалобы: «после каждой буквы долгая пауза, слово целиком набрать нельзя».
 *
 * Причина была не в задержке запроса, а в перерисовке: строка поиска лежала в
 * состоянии страницы заказов — тысяча с лишним строк разметки и таблица на
 * полторы сотни заказов, — поэтому каждое нажатие перерисовывало всё целиком.
 *
 * Поэтому здесь проверяется именно число перерисовок родителя, а не только
 * «пришло ли значение»: тест, смотрящий лишь на итоговое значение, был бы
 * зелёным и на прежнем, тормозящем варианте.
 */

afterEach(() => cleanup());

/** Родитель, считающий собственные перерисовки. */
function Page({ onSearch, renders }: { onSearch: (v: string) => void; renders: { count: number } }) {
  const [applied, setApplied] = useState("");
  renders.count++;
  const handle = useCallback((v: string) => { setApplied(v); onSearch(v); }, [onSearch]);
  return (
    <div>
      <SearchInput placeholder="Поиск заказов…" onSearch={handle} delayMs={50} />
      <span data-testid="applied">{applied}</span>
    </div>
  );
}

describe("SearchInput", () => {
  it("набор слова не перерисовывает страницу на каждую букву", async () => {
    const onSearch = vi.fn();
    const renders = { count: 0 };
    render(<Page onSearch={onSearch} renders={renders} />);
    const before = renders.count;

    const input = screen.getByPlaceholderText("Поиск заказов…");
    for (const ch of "Дилшод") {
      fireEvent.change(input, { target: { value: input.getAttribute("value")! + ch } });
    }

    // Шесть букв — и ни одной перерисовки родителя, пока набор идёт.
    expect(renders.count).toBe(before);
    // Введённое при этом видно сразу: поле остаётся отзывчивым.
    expect((input as HTMLInputElement).value).toBe("Дилшод");

    // И только когда набор остановился — одно обновление наверх.
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith("Дилшод"));
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("очистка поля применяется сразу, без ожидания", async () => {
    // Стёр строку — хочет увидеть полный список немедленно.
    const onSearch = vi.fn();
    render(<SearchInput placeholder="Поиск" onSearch={onSearch} delayMs={5000} />);
    const input = screen.getByPlaceholderText("Поиск");

    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.change(input, { target: { value: "" } });

    await waitFor(() => expect(onSearch).toHaveBeenCalledWith(""));
  });

  it("не дёргает родителя начальным значением при открытии страницы", async () => {
    const onSearch = vi.fn();
    render(<SearchInput placeholder="Поиск" onSearch={onSearch} delayMs={10} />);
    await new Promise(r => setTimeout(r, 60));
    expect(onSearch).not.toHaveBeenCalled();
  });
});
