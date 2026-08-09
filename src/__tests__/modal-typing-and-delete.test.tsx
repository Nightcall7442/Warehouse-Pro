// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AppModal } from "../components/ui/AppModal";

/**
 * Три поломки, мешавшие работе каждый день.
 *
 * Все три — про то, что интерфейс отменял действие человека: уводил каретку из
 * поля, стирал введённые деньги, удалял товар без вопроса.
 */

afterEach(cleanup);

describe("в открытом окне можно печатать", () => {
  /**
   * Эффект, ставящий фокус на панель окна, зависел от onClose. Вызывающая
   * сторона почти всегда передаёт стрелку, создаваемую заново на каждый рендер,
   * поэтому зависимость менялась всегда: эффект перезапускался на каждый рендер
   * и уводил фокус на панель.
   *
   * Для человека это выглядело так: в поле поиска товара вводится «м», каретка
   * исчезает, и «о» с «л» печатать уже некуда. Набрать слово в быстром заказе
   * было нельзя.
   */
  function Harness() {
    const [value, setValue] = useState("");
    // Нестабильный onClose — ровно как в QuickOrderModal и соседях.
    return (
      <AppModal open onClose={() => { /* новая функция на каждый рендер */ }} title="Быстрый заказ">
        <input aria-label="Поиск товаров" value={value} onChange={e => setValue(e.target.value)} />
      </AppModal>
    );
  }

  it("фокус остаётся в поле после ввода символа", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Поиск товаров") as HTMLInputElement;

    input.focus();
    fireEvent.change(input, { target: { value: "м" } });

    expect(
      document.activeElement,
      "после первого символа фокус ушёл из поля — набрать слово нельзя",
    ).toBe(input);
  });

  it("слово набирается целиком", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Поиск товаров") as HTMLInputElement;
    input.focus();

    for (const ch of ["м", "мо", "мол", "моло"]) {
      fireEvent.change(input, { target: { value: ch } });
      expect(document.activeElement).toBe(input);
    }
    expect(input.value).toBe("моло");
  });

  it("Escape по-прежнему закрывает окно", () => {
    // Обработчик теперь берётся из ссылки, и легко было бы его потерять.
    const onClose = vi.fn();
    render(<AppModal open onClose={onClose} title="Окно"><div /></AppModal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("форма завершения заказа не стирается сама", () => {
  const SRC = readFileSync(
    join(process.cwd(), "src", "components", "orders", "CompletionFlowModal.tsx"), "utf8",
  );

  it("сброс завязан на состав позиций, а не на массив", () => {
    // Родительский экран собирает список через .map() и отдаёт новый массив на
    // каждый свой рендер, а рендер случается, когда любой сотрудник создаёт
    // заказ. Оператор вводил сумму оплаты — и всё стиралось без предупреждения;
    // не заметив, он нажимал «Завершить», и уходила оплата 0 с полным долгом.
    expect(SRC).toContain("const itemsKey = items.map(item => item.id).join(\",\")");
    expect(SRC).toMatch(/\}, \[open, itemsKey\]\);/);
    expect(SRC, "сброс снова зависит от самого массива позиций").not.toMatch(/\}, \[open, items\]\);/);
  });
});

describe("товар со склада не удаляется молча", () => {
  const SRC = readFileSync(join(process.cwd(), "src", "pages", "Warehouse.tsx"), "utf8");

  it("удаление спрашивает подтверждение", () => {
    // Кнопка с корзиной стоит вплотную к «Скорректировать», отмены нет.
    const fn = SRC.slice(SRC.indexOf("const handleDelete"));
    const body = fn.slice(0, fn.indexOf("}, ["));
    expect(body, "удаление вызывается сразу, без подтверждения").toContain("await confirm(");
    expect(body).toMatch(/if \(ok\) deleteMutation\.mutate/);
  });

  it("в вопросе видно, какой именно товар", () => {
    // Единственное, по чему видно, что рука попала не в ту строку.
    const calls = SRC.match(/handleDelete\(item\.productId, item\.productName/g) ?? [];
    expect(calls.length, "не все кнопки удаления передают название товара").toBe(2);
  });
});
