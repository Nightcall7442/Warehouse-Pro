// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { useUrlState, urlString, urlBool, urlPage } from "../hooks/useUrlState";
import { ShopFilters } from "../components/shops/ShopFilters";

/**
 * Панель фильтров магазинов должна принимать ввод и нажатия.
 *
 * Жалоба: «не работает поисковик, в него невозможно писать, и не реагирует
 * кнопка "только с долгом"». Оба поля идут через useUrlState, то есть через
 * адрес страницы, — и оба перестали отвечать одновременно. Это разом
 * исключает случайную опечатку в одном обработчике и указывает на общий путь.
 *
 * Здесь панель поднимается с настоящим useUrlState внутри роутера, буква
 * набирается настоящим событием ввода, кнопка нажимается настоящим кликом.
 * Проверяется то, что видит пользователь: значение в поле и состояние кнопки
 * после действия.
 */

afterEach(cleanup);

function Harness() {
  const [search, setSearch] = useUrlState("search", "", urlString);
  const [onlyDebtors, setOnlyDebtors] = useUrlState("debtors", false, urlBool);
  const [, setPage] = useUrlState("page", 1, urlPage);
  return (
    <ShopFilters
      lang="ru"
      search={search} setSearch={setSearch}
      viewMode="list" setViewMode={() => {}}
      agentFilter={undefined} setAgentFilter={() => {}}
      city={undefined} district={undefined}
      agents={[]}
      onlyDebtors={onlyDebtors} setOnlyDebtors={setOnlyDebtors}
      sortBy="newest" setSortBy={() => {}}
      setPage={setPage}
      resetFilters={() => {}}
    />
  );
}

function поднять() {
  return render(<MemoryRouter initialEntries={["/shops"]}><Harness /></MemoryRouter>);
}

describe("панель фильтров магазинов", () => {
  it("принимает ввод в поле поиска", () => {
    поднять();
    const поле = screen.getByPlaceholderText("Поиск магазинов…") as HTMLInputElement;

    fireEvent.change(поле, { target: { value: "Хумо" } });

    expect(поле.value).toBe("Хумо");
  });

  it("набор нескольких букв подряд не теряет предыдущие", () => {
    поднять();
    const поле = screen.getByPlaceholderText("Поиск магазинов…") as HTMLInputElement;

    // Каждая буква — отдельное событие, как при настоящем наборе. Если запись
    // в адрес затирает предыдущую, тут останется одна последняя буква.
    for (const текст of ["Х", "Ху", "Хум", "Хумо"]) {
      fireEvent.change(поле, { target: { value: текст } });
    }

    expect(поле.value).toBe("Хумо");
  });

  it("кнопка «только с долгом» переключается", () => {
    поднять();
    // Проверяется aria-pressed, а не подложка: цвет — оформление, его меняют
    // при первой же смене темы, и тест начал бы падать на ровном месте.
    const кнопка = screen.getByRole("button", { name: /Только с долгом/ });

    expect(кнопка.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(кнопка);

    expect(кнопка.getAttribute("aria-pressed")).toBe("true");
  });

  it("повторное нажатие снимает фильтр долга", () => {
    поднять();
    const кнопка = screen.getByRole("button", { name: /Только с долгом/ });

    fireEvent.click(кнопка);
    fireEvent.click(кнопка);

    expect(кнопка.getAttribute("aria-pressed")).toBe("false");
  });
});
