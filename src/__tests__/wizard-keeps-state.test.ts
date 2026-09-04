import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pageKey } from "@/const";

/**
 * Шаги мастера заказа не должны выбрасывать состояние.
 *
 * Обёртка страницы в Layout.tsx стоит с ключом. Пока ключом был просто путь,
 * переход с «Магазина» на «Товары» выбрасывал родителя мастера вместе с
 * выбранным магазином: сторож видел пустой магазин и возвращал на первый шаг.
 * Со стороны — кнопка «Продолжить» просто не работает, заказ оформить нельзя.
 * Воспроизводилось на живой странице: адрес не менялся, выбор сбрасывался.
 *
 * Ключ при этом нужен: без него экраны с параметром в адресе несли бы чужое
 * состояние — в ShopDetail это сумма оплаты и ключ повторной отправки.
 */
describe("ключ обёртки страницы", () => {
  it("шаги мастера дают один ключ", () => {
    const first = pageKey("/orders/new");
    expect(pageKey("/orders/new/items")).toBe(first);
    expect(pageKey("/orders/new/review")).toBe(first);
  });

  it("разные страницы дают разные ключи", () => {
    // Иначе вернётся исходная беда: чужое состояние на карточке магазина.
    expect(pageKey("/shops/1")).not.toBe(pageKey("/shops/2"));
    expect(pageKey("/orders/1")).not.toBe(pageKey("/orders/2"));
    expect(pageKey("/orders")).not.toBe(pageKey("/orders/new"));
    expect(pageKey("/agent")).not.toBe(pageKey("/agent/shops"));
  });

  it("совпадение по началу строки не растекается", () => {
    // Ловушка: /orders/newest начинается с /orders/new, но это другая страница.
    expect(pageKey("/orders/newest")).toBe("/orders/newest");
  });

  it("Layout действительно берёт ключ отсюда", () => {
    // Без этого проверки выше стерегли бы функцию, которой никто не пользуется.
    const layout = fs.readFileSync(path.resolve(process.cwd(), "src/components/Layout.tsx"), "utf8");
    expect(layout).toContain("key={pageKey(location.pathname)}");
  });

  it("шаги мастера и список корней не разошлись", () => {
    // NESTED_PAGE_ROOTS в const.ts и STEP_PATHS в NewOrder.tsx описывают одно
    // и то же. Разойдутся — мастер снова начнёт терять выбор молча.
    const page = fs.readFileSync(path.resolve(process.cwd(), "src/pages/NewOrder.tsx"), "utf8");
    const steps = page.slice(page.indexOf("const STEP_PATHS"), page.indexOf("\n", page.indexOf("const STEP_PATHS")));
    for (const m of steps.matchAll(/"([^"]+)"/g)) {
      expect(pageKey(m[1]), `шаг ${m[1]} даёт свой ключ`).toBe("/orders/new");
    }
  });
});
