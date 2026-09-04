import { describe, it, expect } from "vitest";
import { pickActivePath } from "@/const";

/**
 * Внизу у агента шесть вкладок, и две из них про заказы: «Заказ»
 * (/orders/new) и «Мои заказы» (/orders). Пока каждая вкладка решала за себя,
 * на экране нового заказа горели обе — рядом, одинаково, обе со словом
 * «заказ». Понять, где ты находишься, было нельзя.
 *
 * Проверяем именно этот случай и его продолжение: мастер заказа разбит на
 * страницы, и на каждом шаге гореть должна одна и та же вкладка «Заказ».
 */
const AGENT = [
  { path: "/agent", exact: true },
  { path: "/agent/shops" },
  { path: "/catalog" },
  { path: "/orders/new" },
  { path: "/orders" },
  { path: "/offline-orders" },
];

describe("подсветка нижней панели", () => {
  it("на новом заказе горит «Заказ», а не «Мои заказы»", () => {
    expect(pickActivePath(AGENT, "/orders/new")).toBe("/orders/new");
  });

  it("шаги мастера остаются на «Заказе»", () => {
    // Родитель /orders тоже подходит под каждый из этих путей — и проигрывает
    // по длине. В этом весь смысл правила.
    expect(pickActivePath(AGENT, "/orders/new/items")).toBe("/orders/new");
    expect(pickActivePath(AGENT, "/orders/new/review")).toBe("/orders/new");
  });

  it("список заказов и карточка заказа горят на «Моих заказах»", () => {
    expect(pickActivePath(AGENT, "/orders")).toBe("/orders");
    expect(pickActivePath(AGENT, "/orders/412")).toBe("/orders");
  });

  it("точное совпадение не растекается на вложенные пути", () => {
    // «День» помечен exact: без этого он горел бы и на /agent/shops.
    expect(pickActivePath(AGENT, "/agent")).toBe("/agent");
    expect(pickActivePath(AGENT, "/agent/shops")).toBe("/agent/shops");
  });

  it("побеждает длина пути, а не порядок пунктов", () => {
    /*
      Без этой проверки тест бесполезен: в живом списке «Заказ» и так стоит
      раньше «Моих заказов», и правило «побеждает первый совпавший» прошло бы
      всё, что выше. Здесь родитель нарочно поставлен первым — пройдёт только
      сравнение по длине.
    */
    const reversed = [{ path: "/orders" }, { path: "/orders/new" }];
    expect(pickActivePath(reversed, "/orders/new")).toBe("/orders/new");
  });

  it("чужой путь не зажигает ничего", () => {
    // Пустой ответ — это нормально: у роли есть страницы вне нижней панели.
    expect(pickActivePath(AGENT, "/settings")).toBeUndefined();
    // Ловушка на совпадение по началу строки: /offline-orders не под /orders.
    expect(pickActivePath(AGENT, "/offline-orders")).toBe("/offline-orders");
  });
});
