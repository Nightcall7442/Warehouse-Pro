// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { RadixPointerEventsGuard } from "@/components/RadixPointerEventsGuard";

/**
 * Проверяется ровно то, что ломало страницу: залипший на <body> инлайновый
 * pointer-events:none от Radix. Сам факт «клик не проходит» в jsdom не
 * воспроизводится — jsdom не вычисляет pointer-events и нажал бы кнопку в любом
 * случае, — поэтому проверяем причину, а не следствие: снят стиль или нет.
 */

afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = "";
  document.body.innerHTML = "";
});

describe("RadixPointerEventsGuard", () => {
  it("снимает залипший pointer-events:none, когда открытых слоёв Radix нет", async () => {
    document.body.style.pointerEvents = "none";      // след закрывшегося Select
    render(<RadixPointerEventsGuard />);

    await waitFor(() => expect(document.body.style.pointerEvents).toBe(""));
  });

  it("НЕ трогает стиль, пока настоящий слой Radix открыт", async () => {
    // Иначе можно вернуть клики фону под открытым модальным окном — то есть
    // сломать ровно то, ради чего Radix этот стиль и ставит.
    const layer = document.createElement("div");
    layer.setAttribute("data-radix-popper-content-wrapper", "");
    document.body.appendChild(layer);
    document.body.style.pointerEvents = "none";

    render(<RadixPointerEventsGuard />);
    await new Promise(r => setTimeout(r, 60));

    expect(document.body.style.pointerEvents).toBe("none");
  });

  it("освобождает страницу, когда слой закрылся и стиль остался", async () => {
    const layer = document.createElement("div");
    layer.setAttribute("data-radix-popper-content-wrapper", "");
    document.body.appendChild(layer);
    document.body.style.pointerEvents = "none";
    render(<RadixPointerEventsGuard />);
    await new Promise(r => setTimeout(r, 40));
    expect(document.body.style.pointerEvents).toBe("none");   // пока открыт — держим

    layer.remove();                                            // Select закрылся…
    document.body.style.pointerEvents = "none";                // …а стиль забыл сняться
    await waitFor(() => expect(document.body.style.pointerEvents).toBe(""));
  });

  it("возвращает клики по нажатию, даже если наблюдатель ничего не заметил", async () => {
    // Последний рубеж: человек тычет в мёртвую страницу — она должна ожить.
    render(<RadixPointerEventsGuard />);
    document.body.style.pointerEvents = "none";
    document.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    await waitFor(() => expect(document.body.style.pointerEvents).toBe(""));
  });
});
