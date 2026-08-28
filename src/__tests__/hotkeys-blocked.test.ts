// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { areHotkeysBlocked } from "../hooks/useHotkeys";

/**
 * Клавиши-сокращения не должны срабатывать поверх открытого окна.
 *
 * «n» уводит на создание заказа, «/» ставит каретку в поле поиска страницы.
 * Обе полезны на странице и обе разрушительны в окне: нажатие «n» меняет
 * страницу, и окно вместе с набранным исчезает.
 *
 * Проверка стояла только на фокусе и знала лишь INPUT, TEXTAREA и
 * contentEditable. AppModal при открытии ставит фокус на свою панель — это
 * div с tabIndex=-1, — поэтому сразу после открытия любого окна проверка
 * отвечала «печатать не мешаем» и клавиша срабатывала.
 *
 * Здесь собирается настоящий DOM тех состояний, в которых человек и
 * оказывается.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

/** Панель окна ровно с той разметкой, что ставит AppModal. */
function openModalWithFocusOnPanel(): HTMLElement {
  document.body.innerHTML = `
    <div data-modal-overlay></div>
    <div role="dialog" aria-modal="true" tabindex="-1" id="panel">
      <button id="add">Добавить товар</button>
      <input id="search" placeholder="Поиск товаров" />
    </div>`;
  const panel = document.getElementById("panel")!;
  panel.focus();
  return panel;
}

describe("на странице клавиши работают", () => {
  it("ничего не открыто, фокус нигде — «n» разрешена", () => {
    document.body.innerHTML = `<div id="page">список заказов</div>`;
    expect(areHotkeysBlocked("n")).toBe(false);
  });

  it("«/» тоже разрешена", () => {
    document.body.innerHTML = `<input id="search" placeholder="Поиск" />`;
    expect(areHotkeysBlocked("/")).toBe(false);
  });

  it("но не когда человек печатает в поле", () => {
    document.body.innerHTML = `<input id="q" />`;
    document.getElementById("q")!.focus();
    expect(areHotkeysBlocked("n")).toBe(true);
  });
});

describe("поверх открытого окна клавиши молчат", () => {
  it("фокус на панели окна — «n» не срабатывает", () => {
    // Ровно состояние сразу после открытия окна: AppModal фокусирует панель.
    // Это div, а не поле ввода, — и прежняя проверка пропускала клавишу.
    openModalWithFocusOnPanel();
    expect(
      areHotkeysBlocked("n"),
      "«n» снова уводит на /orders/new прямо из открытого окна — форма пропадает.",
    ).toBe(true);
  });

  it("фокус на кнопке внутри окна — «n» не срабатывает", () => {
    openModalWithFocusOnPanel();
    document.getElementById("add")!.focus();
    expect(areHotkeysBlocked("n")).toBe(true);
  });

  it("фокус вообще потерян — «n» всё равно не срабатывает", () => {
    // После клика по затемнению фокус уходит на body. Проверка по фокусу
    // здесь бессильна, поэтому смотреть надо на разметку.
    openModalWithFocusOnPanel();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(areHotkeysBlocked("n")).toBe(true);
  });

  it("«/» не уводит каретку в поле под окном", () => {
    openModalWithFocusOnPanel();
    expect(areHotkeysBlocked("/")).toBe(true);
  });

  it("окно закрыли — клавиши снова работают", () => {
    openModalWithFocusOnPanel();
    expect(areHotkeysBlocked("n")).toBe(true);
    document.body.innerHTML = `<div id="page">список заказов</div>`;
    expect(areHotkeysBlocked("n")).toBe(false);
  });
});

describe("Escape — исключение", () => {
  it("проходит и при открытом окне: он для того и нужен", () => {
    openModalWithFocusOnPanel();
    expect(areHotkeysBlocked("Escape")).toBe(false);
  });

  it("проходит и когда человек печатает", () => {
    document.body.innerHTML = `<input id="q" />`;
    document.getElementById("q")!.focus();
    expect(areHotkeysBlocked("Escape")).toBe(false);
  });
});
