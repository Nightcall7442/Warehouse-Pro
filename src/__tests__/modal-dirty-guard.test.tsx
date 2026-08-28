// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { AppModal } from "../components/ui/AppModal";

/**
 * Случайное закрытие не должно стирать работу.
 *
 * Быстрый заказ собирается при живом разговоре с владельцем магазина: выбрать
 * магазин, найти двадцать товаров, проставить количества, скидку, примечание.
 * Всё это лежало в состоянии окна, а закрытие вызывало resetForm().
 *
 * Закрывали же окно две вещи, срабатывающие от неточного движения:
 * клик по затемнению вокруг панели и Escape. Один промах мимо панели — и
 * несколько минут работы исчезали. Ни подтверждения, ни черновика: проверено
 * поиском beforeunload/isDirty/unsaved по src — не было ничего.
 *
 * Ниже проверяется именно это поведение, а не наличие свойства в коде.
 */

afterEach(cleanup);

describe("окно без несохранённой работы закрывается как раньше", () => {
  it("клик по затемнению закрывает", () => {
    const onClose = vi.fn();
    render(<AppModal open onClose={onClose} title="Пустое окно"><div /></AppModal>);

    // Затемнение — первый из двух слоёв поверх страницы.
    const overlay = document.querySelector("[data-modal-overlay]");
    expect(overlay, "затемнение не найдено — разметка окна изменилась").toBeTruthy();
    fireEvent.click(overlay!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape закрывает", () => {
    const onClose = vi.fn();
    render(<AppModal open onClose={onClose} title="Пустое окно"><div /></AppModal>);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("окно с несохранённой работой промахом не закрыть", () => {
  it("клик по затемнению не закрывает", () => {
    const onClose = vi.fn();
    render(
      <AppModal open dirty onClose={onClose} title="Новый заказ">
        <div>20 позиций</div>
      </AppModal>,
    );

    const overlay = document.querySelector("[data-modal-overlay]");
    fireEvent.click(overlay!);

    expect(
      onClose,
      "Промах мимо панели снова закрывает окно — а закрытие в быстром заказе " +
        "стирает корзину, магазин, скидку и примечание.",
    ).not.toHaveBeenCalled();
  });

  it("Escape не закрывает", () => {
    const onClose = vi.fn();
    render(
      <AppModal open dirty onClose={onClose} title="Новый заказ">
        <div>20 позиций</div>
      </AppModal>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose, "Escape снова стирает собранный заказ").not.toHaveBeenCalled();
  });

  it("окно остаётся на экране", () => {
    render(
      <AppModal open dirty onClose={() => {}} title="Новый заказ">
        <div>20 позиций</div>
      </AppModal>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByText("20 позиций")).toBeTruthy();
  });

  it("защита снимается вместе с работой, а не остаётся навсегда", () => {
    // Корзину опустошили — окно снова закрывается промахом, как обычное.
    // Слушатель Escape ставится при открытии, и если он запомнит «работа
    // есть», окно останется незакрываемым до перезагрузки страницы.
    const onClose = vi.fn();
    const { rerender } = render(
      <AppModal open dirty onClose={onClose} title="Новый заказ"><div /></AppModal>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    rerender(<AppModal open dirty={false} onClose={onClose} title="Новый заказ"><div /></AppModal>);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(
      onClose,
      "Слушатель запомнил состояние на момент открытия: окно нельзя закрыть " +
        "даже после того, как из него всё убрали.",
    ).toHaveBeenCalledTimes(1);
  });
});
