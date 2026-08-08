import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertProductsBelongToTenant } from "../lib/tenant-refs";

/**
 * Ссылка на товар не может указывать в чужую организацию.
 *
 * Таблица products общая для всей платформы, а идентификатор товара приходит от
 * клиента. Записав чужой product_id в свою строку и прочитав её обратно, можно
 * было получить название, код и цену товара другой компании — то есть выгрузить
 * чужой каталог перебором.
 *
 * Два пути записи оставались открытыми:
 *
 *   прайс-лист → upsertItem: проверялся priceListId, но не productId;
 *   возврат    → create: productId проверялся ТОЛЬКО когда указан заказ, а
 *                возврат без заказа (брак, пересорт) — обычный путь, и он
 *                открыт рядовому агенту.
 *
 * Сама проверка проверяется на подставной базе; подключение к путям записи и
 * границы в соединениях — по исходнику.
 */

function dbWithProducts(owned: number[]) {
  return {
    select: () => ({
      from: () => ({
        // Возвращаем только те товары, что принадлежат организации — так же,
        // как это сделает настоящий WHERE с условием по tenant_id.
        where: async () => owned.map(id => ({ id })),
      }),
    }),
  } as unknown as Parameters<typeof assertProductsBelongToTenant>[0];
}

describe("проверка принадлежности товаров", () => {
  it("свои товары проходят", async () => {
    await expect(assertProductsBelongToTenant(dbWithProducts([1, 2, 3]), 7, [1, 3])).resolves.toBeUndefined();
  });

  it("чужой товар отвергается", async () => {
    await expect(assertProductsBelongToTenant(dbWithProducts([1, 2]), 7, [1, 99]))
      .rejects.toThrow(/#99 не найден в вашей организации/);
  });

  it("в сообщении нет названия чужого товара", async () => {
    // Иначе сообщение об ошибке само стало бы тем каналом утечки, который
    // проверка закрывает.
    try {
      await assertProductsBelongToTenant(dbWithProducts([]), 7, [42]);
      throw new Error("не бросило");
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain("42");
      expect(message.toLowerCase()).not.toMatch(/name|название|код/);
    }
  });

  it("пустой список не обращается к базе", async () => {
    const select = vi.fn();
    await assertProductsBelongToTenant({ select } as never, 7, []);
    expect(select).not.toHaveBeenCalled();
  });

  it("повторы в списке не мешают", async () => {
    // Клиент вправе прислать один товар дважды разными строками; проверка не
    // должна на этом спотыкаться.
    await expect(assertProductsBelongToTenant(dbWithProducts([5]), 7, [5, 5, 5])).resolves.toBeUndefined();
  });

  it("один запрос на все товары, а не по одному на каждый", async () => {
    let calls = 0;
    const db = {
      select: () => { calls++; return { from: () => ({ where: async () => [{ id: 1 }, { id: 2 }, { id: 3 }] }) }; },
    } as never;
    await assertProductsBelongToTenant(db, 7, [1, 2, 3]);
    // Цикл с отдельным запросом на строку сделал бы защиту самой медленной
    // частью операции — то есть кандидатом на удаление при первой жалобе.
    expect(calls).toBe(1);
  });
});

describe("проверка подключена к обоим путям записи", () => {
  const read = (f: string) => readFileSync(join(process.cwd(), "api", f), "utf8");

  it("прайс-лист проверяет товар перед добавлением", () => {
    const src = read("price-list-router.ts");
    const proc = src.slice(src.indexOf("upsertItem:"));
    const body = proc.slice(0, proc.search(/\n  [a-zA-Z]+:/));
    expect(body, "upsertItem принимает чужой productId").toContain("assertProductsBelongToTenant");
  });

  it("возврат проверяет товары независимо от наличия заказа", () => {
    const src = read("returns-router.ts");
    const proc = src.slice(src.indexOf("create:"));
    const body = proc.slice(0, proc.search(/\n  [a-zA-Z]+:/));
    const guardAt = body.indexOf("assertProductsBelongToTenant");
    const orderBranchAt = body.indexOf("if (input.orderId)");

    expect(guardAt, "returns.create принимает чужой productId").toBeGreaterThan(-1);
    // Проверка внутри ветки «есть заказ» оставила бы открытым путь без заказа —
    // именно тот, которым пользуется агент.
    expect(guardAt, "проверка товаров стоит внутри ветки с заказом").toBeLessThan(orderBranchAt);
  });

  it("соединения с products несут границу организации", () => {
    for (const f of ["price-list-router.ts", "returns-router.ts"]) {
      const src = read(f);
      const naked = [...src.matchAll(/leftJoin\(products,\s*eq\(\w+Items\.productId/g)];
      expect(naked.length, `${f}: соединение с products без условия по организации`).toBe(0);
    }
  });
});
