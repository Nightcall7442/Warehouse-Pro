// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { AppModal } from "../components/ui/AppModal";

/**
 * Окно, открытое поверх боковой панели заказа, должно принимать клики.
 *
 * Radix на время открытой панели ставит на <body> инлайновый
 * pointer-events: none, чтобы страница под ней не реагировала на мышь.
 * AppModal рендерится порталом прямо в body, поэтому наследует запрет — и
 * окно завершения заказа оказывается видимым, но полностью мёртвым: ни
 * ввести сумму, ни нажать «Завершить», ни «Отмена». Пользователь описывал
 * это так: «диалог появляется и ничего не нажимается, помогает только
 * перезагрузка».
 *
 * Отдельный сторож, снимающий залипший запрет, здесь принципиально не
 * помогает: он срабатывает лишь когда открытых слоёв Radix не осталось, а
 * панель в этот момент открыта намеренно.
 *
 * Проверяется наличие pointer-events-auto на обоих слоях портала —
 * подложке и контейнере окна. Вычисленный стиль для этого не годится: jsdom
 * не наследует pointer-events от body, поэтому мёртвое окно выглядело бы в
 * тесте живым, и проверка молчала бы ровно в том случае, ради которого
 * написана.
 */

afterEach(cleanup);

function renderInsideRadixLayer() {
  // Так выглядит страница, пока открыта боковая панель заказа.
  document.body.style.pointerEvents = "none";
  return render(
    <AppModal open onClose={() => {}} title="Завершение заказа">
      <button>Завершить</button>
    </AppModal>,
  );
}

describe("AppModal поверх боковой панели", () => {
  it("подложка и окно принимают клики", () => {
    renderInsideRadixLayer();

    const dialog = screen.getByRole("dialog");
    const panelLayer = dialog.parentElement;
    const backdrop = panelLayer?.previousElementSibling;

    expect(panelLayer, "контейнер окна не найден").toBeTruthy();
    expect(backdrop, "подложка не найдена").toBeTruthy();

    expect(
      panelLayer!.className,
      "окно унаследует pointer-events: none от body — кнопки перестанут нажиматься",
    ).toContain("pointer-events-auto");

    expect(
      (backdrop as HTMLElement).className,
      "подложка унаследует запрет — закрыть окно кликом мимо станет нельзя",
    ).toContain("pointer-events-auto");

    document.body.style.pointerEvents = "";
  });

  it("содержимое окна действительно отрисовано", () => {
    // Страховка от «зелёного ни на чём»: если разметка окна изменится и
    // роль dialog исчезнет, предыдущая проверка упадёт по getByRole, а не
    // пройдёт вхолостую. Здесь же фиксируется, что внутрь попадает то, что
    // передали.
    renderInsideRadixLayer();
    expect(screen.getByRole("button", { name: "Завершить" })).toBeTruthy();
    document.body.style.pointerEvents = "";
  });
});
