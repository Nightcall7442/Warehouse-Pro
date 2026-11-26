import { describe, it, expect } from "vitest";
import { OFFBOARD_ORDER } from "../services/tenant-offboard";
// @ts-expect-error — скрипт на чистом JS, без объявлений типов.
import { OFFBOARD_ORDER as SCRIPT_ORDER, restoreOrder, splitStatements } from "../../scripts/restore-tenant.mjs";

/*
  scripts/restore-tenant.mjs возвращает удалённую организацию в обратном
  порядке удаления. Свой список у него — потому что скрипт собирается
  отдельным образом без исходников api/. Разойдись списки — новая таблица
  удалялась бы, но не возвращалась (или возвращалась раньше родителя).
*/
describe("восстановление организации: порядок таблиц", () => {
  it("тот же список, что у ухода организации", () => {
    expect(SCRIPT_ORDER).toEqual(OFFBOARD_ORDER);
  });

  it("сначала сама организация, потом родители раньше детей", () => {
    const order = (restoreOrder() as Array<{ table: string }>).map(s => s.table);
    expect(order[0]).toBe("tenants");
    expect(order[1]).toBe("users");
    expect(order.indexOf("orders")).toBeLessThan(order.indexOf("order_items"));
    expect(order.indexOf("shops")).toBeLessThan(order.indexOf("orders"));
    expect(order.indexOf("products")).toBeLessThan(order.indexOf("warehouse_stock"));
  });

  it("дамп режется по выражениям", () => {
    expect(splitStatements("-- c\nCREATE TABLE a (x int);\nINSERT INTO a VALUES (1);\n")).toEqual(["CREATE TABLE a (x int)", "INSERT INTO a VALUES (1)"]);
  });
});
