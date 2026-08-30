// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router";
import { useUrlState, urlString, urlBool, urlPage, urlNumber, urlEnum } from "../hooks/useUrlState";

/**
 * Несколько изменений адреса в одном такте не должны затирать друг друга.
 *
 * Это главное обещание useUrlState, и оно не выполнялось. Функциональная форма
 * setSearchParams в react-router 7 подставляет не очередь, а снимок из
 * замыкания рендера, поэтому все вызовы такта видели одно и то же, и последний
 * затирал остальных.
 *
 * Наружу это вылезло на странице магазинов: в поле поиска нельзя было писать, а
 * кнопка «только с долгом» не нажималась — у обеих в обработчике вторым шагом
 * стоит setPage(1), и он возвращал адрес без только что записанного значения.
 *
 * Худший случай — выбор территории, там сеттеров сразу три:
 *
 *     setTerritoryFilter(id); setViewMode("list"); setPage(1);
 *
 * Проверяется именно он: после одного клика в адресе должны оказаться ВСЕ три
 * изменения.
 */

afterEach(cleanup);

const ВИД = urlEnum(["territories", "list"] as const, "territories");

function Harness() {
  const [territory, setTerritory] = useUrlState("territory", undefined, urlNumber);
  const [view, setView] = useUrlState("view", "territories", ВИД);
  const [search, setSearch] = useUrlState("search", "", urlString);
  const [debtors, setDebtors] = useUrlState("debtors", false, urlBool);
  const [page, setPage] = useUrlState("page", 1, urlPage);
  const [params] = useSearchParams();

  return (
    <div>
      <span data-testid="адрес">{params.toString() || "—"}</span>
      <span data-testid="состояние">{`${territory ?? "—"}/${view}/${search || "—"}/${debtors}/${page}`}</span>

      <button data-testid="территория" onClick={() => {
        setTerritory(7); setView("list"); setPage(1);
      }}>территория</button>

      <button data-testid="поиск" onClick={() => {
        setSearch("Хумо"); setPage(1);
      }}>поиск</button>

      <button data-testid="долг" onClick={() => {
        setDebtors(true); setPage(1);
      }}>долг</button>
    </div>
  );
}

function поднять(адрес = "/shops") {
  return render(<MemoryRouter initialEntries={[адрес]}><Harness /></MemoryRouter>);
}

describe("useUrlState: несколько записей в одном такте", () => {
  it("три сеттера подряд сохраняют все три значения", () => {
    поднять();

    fireEvent.click(screen.getByTestId("территория"));

    // page=1 в адрес не пишется намеренно — единица это «как обычно».
    expect(screen.getByTestId("состояние").textContent).toBe("7/list/—/false/1");
  });

  it("значение переживает следующий за ним setPage", () => {
    поднять();

    fireEvent.click(screen.getByTestId("поиск"));

    expect(screen.getByTestId("состояние").textContent).toBe("—/territories/Хумо/false/1");
  });

  it("сброс страницы не отменяет включённый фильтр долга", () => {
    поднять();

    fireEvent.click(screen.getByTestId("долг"));

    expect(screen.getByTestId("состояние").textContent).toBe("—/territories/—/true/1");
  });

  it("записи в разных тактах накапливаются, а не заменяют друг друга", () => {
    поднять();

    fireEvent.click(screen.getByTestId("поиск"));
    fireEvent.click(screen.getByTestId("долг"));

    expect(screen.getByTestId("состояние").textContent).toBe("—/territories/Хумо/true/1");
  });

  it("не тянет за собой значения с прошлой страницы адреса", () => {
    // Черновик живёт один такт. Если бы он пережил переход, сюда просочилось
    // бы состояние из предыдущего стенда.
    поднять("/shops?search=старое");

    fireEvent.click(screen.getByTestId("долг"));

    expect(screen.getByTestId("состояние").textContent).toBe("—/territories/старое/true/1");
  });
});
