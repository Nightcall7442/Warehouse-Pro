/**
 * Подпись права в «Правах оператора» называет то, что право закрывает.
 *
 * Ветки доставки и закупок повесили новые экраны на старые права: перенос
 * дня доставки и порядок объезда на доске развоза — на «orders.edit»,
 * заказы поставщикам и черновики из «Дозаказа» — на «suppliers.manage».
 * Подписи при этом остались прежними («менять состав и суммы заказа»,
 * «поставщики и оплаты им»), и директор, выключая право, не знал, что
 * выключает заодно.
 *
 * Нарочная поломка: верни подписи «orders.edit» или «suppliers.manage» к
 * прежним — тест упадёт.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const hintOf = (cap: string) => {
  const m = read("src/components/settings/OperatorAccess.tsx").match(new RegExp(`"${cap.replace(".", "\\.")}": \\{[\\s\\S]*?hintRu: "([^"]*)",\\s*hintUz: "([^"]*)"`));
  expect(m, `подпись права ${cap}`).not.toBeNull();
  return { ru: m![1], uz: m![2] };
};

describe("подписи прав оператора называют новые экраны", () => {
  it("orders.edit закрывает перенос дня и порядок объезда — подпись говорит об этом", () => {
    const courier = read("api/courier-router.ts");
    expect(courier).toContain('officeReschedule: operatorQuery.use(can("orders.edit"))');
    expect(courier).toContain('setRouteOrder: operatorQuery.use(can("orders.edit"))');
    const hint = hintOf("orders.edit");
    expect(hint.ru).toMatch(/день доставки/);
    expect(hint.ru).toMatch(/порядок объезда/);
    expect(hint.uz).toMatch(/yetkazish kuni/);
  });

  it("suppliers.manage закрывает заказы поставщикам и «Дозаказ» — подпись говорит об этом", () => {
    const po = read("api/purchase-order-router.ts");
    expect(po).toContain('create: operatorQuery.use(can("suppliers.manage"))');
    expect(po).toContain('createFromSuggestions: operatorQuery.use(can("suppliers.manage"))');
    const hint = hintOf("suppliers.manage");
    expect(hint.ru).toMatch(/заказы поставщикам/);
    expect(hint.ru).toMatch(/«Дозаказа»/);
    expect(hint.uz).toMatch(/Qayta buyurtma/);
  });
});
