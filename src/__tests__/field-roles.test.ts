import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Полевые роли на общих экранах.
 *
 * Агент и мерчендайзер ходят по тем же страницам, что и офис: карточка товара,
 * общий поиск, список товаров. Кнопки там рассчитаны на оператора, и до этой
 * правки каждая из них обещала полевому то, чего сервер не даст:
 *
 *   • карточка товара — «Изменить», «Удалить» и загрузка фото
 *     (product.update / delete / uploadPhoto — operatorQuery);
 *   • фото прямо в списке товаров — то же самое, и отказ прилетал уже после
 *     выбора файла и сжатия;
 *   • общий поиск — shop.list (managementQuery): раздел «Магазины» у них молча
 *     оставался пустым, а отказ уходил на каждый набранный запрос. У курьера
 *     пустым было всё окно: товары и заказы — fieldSalesQuery.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const DETAIL = read("src/pages/ProductDetail.tsx");
const PHOTO = read("src/components/products/ProductPhoto.tsx");
const SEARCH = read("src/components/GlobalSearch.tsx");
const APP = read("src/App.tsx");

describe("карточка товара", () => {
  it("правка, удаление и фото — только оператору", () => {
    expect(DETAIL).toContain("const canEdit = canOperate(user?.role);");
    expect(DETAIL, "кнопки правки снова у всех").toContain("{canEdit && (\n        <div className=\"flex gap-2\">");
    expect(DETAIL, "фото снова грузит кто угодно").toContain("onClick={canEdit ? () => fileRef.current?.click() : undefined}");
  });

  it("сама карточка остаётся открытой полевым", () => {
    // Им она нужна как справка: цена, остаток, вес. Закрывать её незачем —
    // product.getById идёт по fieldSalesQuery.
    const at = APP.indexOf('path="/products/:id"');
    expect(at, "маршрут карточки товара не найден").toBeGreaterThan(0);
    const route = APP.slice(at, APP.indexOf("/>", at));
    for (const role of ["agent", "merchandiser"]) expect(route).toContain(role);
  });
});

describe("фото в списке товаров", () => {
  it("меняет только тот, кому сервер это позволит", () => {
    expect(PHOTO).toContain("const canEdit = canOperate(user?.role);");
    expect(PHOTO).toContain("onClick={canEdit ? () => fileRef.current?.click() : undefined}");
  });
});

describe("общий поиск", () => {
  it("магазины ищутся тем запросом, который роли отдадут", () => {
    /*
      shop.list — managementQuery. У полевых свой список закреплённых точек;
      его и отбираем по строке на месте, а не спрашиваем чужой.
    */
    expect(SEARCH).toContain("{ enabled: searching && seesAllShops }");
    expect(SEARCH).toContain("trpc.agent.myShops.useQuery(undefined,                      { enabled: searching && isFieldAgent })");
  });

  it("товары и заказы не спрашиваются у курьера", () => {
    expect(SEARCH).toContain('const seesCatalog  = role !== "courier";');
    expect(SEARCH).toContain("{ enabled: searching && seesCatalog }");
  });

  it("роли, которой нечего искать, окно не открывается", () => {
    // Пустое «ничего не найдено» на любой запрос врёт: не «не нашлось», а
    // «искать нечем».
    expect(SEARCH).toContain("if (!seesAllShops && !seesCatalog && !isFieldAgent) return null;");
  });

  it("найденный магазин ведёт туда, куда роли можно", () => {
    // Карточка точки закрыта полевым (RoleGuard на /shops/:id), а нужен им
    // обычно заказ на эту точку.
    expect(SEARCH).toContain("go(isFieldAgent ? `/orders/new?shopId=${s.id}` : `/shops/${s.id}`)");
  });
});
