import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * О кончившемся товаре агент узнаёт ДО разговора, а не после.
 *
 * Остаток резервируется при СОЗДАНИИ заказа: если товара не хватает, сервер
 * отклоняет заказ целиком. А кнопка «Заказать» в каталоге была активна и при
 * нулевом остатке — агент набирал корзину, договаривался с владельцем
 * магазина, обещал привезти и только на «Оформить» узнавал, что товара нет.
 * Стоял он при этом уже у прилавка, и отказ приходил на весь заказ разом.
 *
 * Число, которое видит агент, и число, по которому решает сервер, — одно и
 * то же: и каталог (product.listAll), и резерв (resolveOrderWarehouse)
 * смотрят на склад по умолчанию.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

describe("каталог агента", () => {
  const catalog = read("src/pages/Catalog.tsx");

  it("при нулевом остатке вместо «Заказать» — предупреждение", () => {
    expect(catalog).toContain('data-testid="catalog-out-of-stock"');
    // Кнопка должна быть в ветке «есть остаток», а предупреждение — в другой.
    const at = catalog.indexOf("{stock <= 0 ? (");
    expect(at, "развилка по остатку пропала").toBeGreaterThan(0);
    const branch = catalog.slice(at, catalog.indexOf(") : (", at));
    expect(branch, "кнопка заказа осталась в ветке «товара нет»").not.toContain('data-testid="catalog-order"');
  });

  it("просят больше, чем есть — заказ не даём отправить", () => {
    // Сервер урезать не станет: он отклонит заказ целиком.
    expect(catalog).toContain('data-testid="catalog-not-enough"');
    expect(catalog).toContain("disabled={qty > stock}");
  });
});

describe("мастер заказа", () => {
  const selector = read("src/components/orders/ProductSelector.tsx");

  it("кончившийся товар подписан и в корзину не кладётся", () => {
    expect(selector).toContain("товар закончился");
    expect(selector, "тап по карточке снова добавит то, чего нет").toContain("if (inCart || out) return;");
  });

  it("подпись «мало» называет, сколько именно осталось", () => {
    // «⚠ мало» без числа не говорит, хватит ли на заказ.
    expect(selector).toMatch(/осталось.*formatQty\(product\.available\)/s);
  });
});

describe("отказ сервера называет товар", () => {
  const order = read("api/services/order.ts");

  it("в тексте отказа имя, а не номер строки в базе", () => {
    /*
      Было «Недостаточно товара на складе (доступно: 0, запрошено: 2)» —
      без единого признака, о каком товаре речь; агент с корзиной из десяти
      позиций не знал, какую убрать. Соседняя проверка называла «товар ID
      417», что для человека ничем не лучше.
    */
    const at = order.indexOf("const name = nameMap.get(item.productId)");
    expect(at, "имя товара в проверке остатка не берётся").toBeGreaterThan(0);
    const block = order.slice(at, at + 700);
    expect(block).toContain("${name}");
    expect(block, "в отказе снова номер строки вместо имени").not.toMatch(/товар ID \$\{item\.productId\}/);
  });

  it("имена действительно загружаются", () => {
    // Иначе nameMap всегда пуста и в отказ уходит запасное «товар #N».
    expect(order).toContain("nameMap.set(p.id, p.name)");
    expect(order).toMatch(/select\(\{ id: products\.id, name: products\.name/);
  });
});
