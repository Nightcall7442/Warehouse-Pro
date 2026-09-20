// @vitest-environment jsdom
/**
 * Таблица → карточки на телефоне (components/CardTable).
 *
 * Прогон 20.09.2026 при 390×844: «Пользователи», «Приходы», «KPI», «P&L»,
 * «Контроль» — таблицы шире экрана, правые колонки резались. CardTable
 * на телефоне подписывает каждую ячейку заголовком её колонки (data-label),
 * а CSS раскладывает строки карточками. Здесь — сама подпись: по колонкам,
 * с учётом colspan, без подписи у безымянных колонок, обновляется при смене
 * строк и не ставится на настольном экране.
 *
 * Нарочная поломка: убери `col += span` — упадёт «итого»; убери
 * MutationObserver — упадёт «смена строк»; убери проверку isMobile — упадёт
 * «настольный экран».
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { CardTable } from "@/components/CardTable";

const mobile = { value: true };
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));

function Table({ rows }: { rows: string[][] }) {
  return (
    <CardTable>
      <table>
        <thead><tr><th>Имя</th><th>Роль</th><th>Статус</th><th></th></tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
          <tr><td colSpan={3}>Итого</td><td>3</td></tr>
        </tbody>
      </table>
    </CardTable>
  );
}
const labels = (root: HTMLElement) => Array.from(root.querySelectorAll("tbody td")).map(td => td.getAttribute("data-label"));

describe("CardTable", () => {
  beforeEach(() => { mobile.value = true; });

  it("на телефоне каждая ячейка подписана заголовком колонки; безымянная колонка и colspan — без подписи", () => {
    const { container } = render(<Table rows={[["Каримов", "Руководитель", "Активен", "✎"]]} />);
    expect(labels(container)).toEqual(["Имя", "Роль", "Статус", null, null, null]);
  });

  it("итого: колонка после colspan считается с учётом ширины предыдущих ячеек", () => {
    const { container } = render(
      <CardTable><table>
        <thead><tr><th>Дата</th><th>Машина</th><th>Топливо</th><th>Итого</th></tr></thead>
        <tbody><tr><td colSpan={3}>Итого за период</td><td>7 395</td></tr></tbody>
      </table></CardTable>,
    );
    expect(labels(container)).toEqual([null, "Итого"]);
  });

  it("смена строк (страница, фильтр) подписывается заново", async () => {
    const { container, rerender } = render(<Table rows={[["А", "Агент", "Активен", ""]]} />);
    rerender(<Table rows={[["А", "Агент", "Активен", ""], ["Б", "Курьер", "Неактивен", ""]]} />);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); }); // MutationObserver — микрозадача
    expect(labels(container).filter(Boolean)).toHaveLength(6);
  });

  it("на настольном экране подписей нет — таблица остаётся таблицей", () => {
    mobile.value = false;
    const { container } = render(<Table rows={[["А", "Агент", "Активен", ""]]} />);
    expect(labels(container).filter(Boolean)).toEqual([]);
    expect(container.querySelector(".card-table")).not.toBeNull();
  });
});
