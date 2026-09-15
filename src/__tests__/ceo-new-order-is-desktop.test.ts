import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * «Новый заказ» у директора — окно на большом экране, а не мастер с телефона.
 *
 * Кнопка на главной вела на /orders/new — мастер агента в три шага, свёрстанный
 * под телефон (max-w-lg). Директор нажимал её на мониторе и получал узкую
 * мобильную форму посреди пустоты; владелец так и написал: «у директора
 * мобильный новый заказ появляется». Настольный путь давно есть — окно
 * быстрого заказа на странице «Заказы», куда и ведёт кнопка теперь.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const DASH = read("src/pages/Dashboard.tsx");
const ORDERS = read("src/pages/Orders.tsx");

describe("кнопка «Новый заказ» на главной", () => {
  it("ведёт на «Заказы» с открытым окном, а не в мобильный мастер", () => {
    expect(DASH).toContain('navigate("/orders?new=1")');
    expect(DASH, "кнопка снова ведёт в мастер агента").not.toContain('navigate("/orders/new")');
  });
});

describe("страница «Заказы»", () => {
  it("открывает окно быстрого заказа по ?new=1 сразу, а не после лишнего клика", () => {
    expect(ORDERS).toContain('useState(searchParams.get("new") === "1")');
  });

  it("закрыв окно, убирает параметр из адреса — обновление страницы не откроет его снова", () => {
    const at = ORDERS.indexOf("const setQuickOrderOpen = ");
    expect(at).toBeGreaterThan(0);
    const fn = ORDERS.slice(at, ORDERS.indexOf("};", at));
    expect(fn).toContain('next.delete("new")');
    expect(fn).toContain("setSearchParams(next, { replace: true })");
    expect(ORDERS).toContain("onOpenChange={setQuickOrderOpen}");
  });
});
