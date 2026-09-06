import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  OPEN_ORDER_STATUSES,
  CLOSED_ORDER_STATUSES,
  REVENUE_ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  orderStillOwes,
} from "../lib/order-status";

/**
 * Forty query sites hard-coded `["delivered", "completed"]` as "the sale
 * happened". `completed` is not a member of the `orders.status` enum and no row
 * has ever held it, so each of those was comparing an enum column against a
 * value it cannot take — silently matching nothing, and reported by the
 * type-checker as two dozen errors nobody acted on.
 *
 * These tests keep the lifecycle defined in one place.
 */

const API = join(__dirname, "..");

/** The enum as db/schema.ts declares it. */
const SCHEMA_STATUSES = [
  "new", "processing", "shipped", "pending", "delivered", "cancelled", "returned",
] as const;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      out.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(API).map(f => ({ path: relative(API, f), text: readFileSync(f, "utf8") }));

describe("order status lifecycle", () => {
  it("covers the schema enum exactly once", () => {
    const named = [...OPEN_ORDER_STATUSES, ...CLOSED_ORDER_STATUSES].sort();
    expect(named).toEqual([...SCHEMA_STATUSES].sort());
    expect(new Set(named).size, "a status may not be both open and closed").toBe(named.length);
  });

  it("treats only real statuses as revenue", () => {
    for (const status of REVENUE_ORDER_STATUSES) {
      expect(SCHEMA_STATUSES, `"${status}" is not a value orders.status can hold`).toContain(status);
    }
  });

  it("has no order status the schema does not define", () => {
    // Guards against `completed` — or any successor — creeping back in as a
    // filter value the column can never match.
    const ghost = /orders\.status,\s*\[[^\]]*"completed"/;
    const offenders = FILES.filter(f => ghost.test(f.text)).map(f => f.path);
    expect(offenders, `these files filter orders.status on a value the enum lacks:\n${offenders.join("\n")}`)
      .toEqual([]);
  });

  it("filters orders.status through the shared sets, not inline literals", () => {
    // `inArray(orders.status, ["delivered"])` written by hand is how the drift
    // started; it must come from lib/order-status.ts instead.
    const inline = /inArray\(\s*orders\.status\s*,\s*\[/g;
    const offenders = FILES
      .filter(f => f.path !== join("lib", "order-status.ts"))
      .flatMap(f => (f.text.match(inline) ?? []).map(() => f.path));

    expect([...new Set(offenders)], "use OPEN/CLOSED/REVENUE_ORDER_STATUSES instead of a literal list")
      .toEqual([]);
  });
});

describe("у каждого статуса есть человеческое имя", () => {
  it("словарь покрывает перечисление целиком", () => {
    /*
      Тип Record<OrderStatus, string> уже обязывает, и эта проверка страхует
      его от ослабления: стоит написать Record<string, string> — и словарь
      снова разрешено оставить неполным.

      Так и было. Прежний словарь жил прямо в отправке уведомления, знал три
      значения из семи, и одно из этих трёх — «completed» — статусом никогда
      не было. Недостающее подставлялось как есть, поэтому агент получал в
      телефон «Статус изменён: delivered» латиницей, а ошибка не падала.
    */
    for (const status of SCHEMA_STATUSES) {
      const label = ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS];
      expect(label, `у статуса "${status}" нет русского имени`).toBeTruthy();
      expect(label, `имя статуса "${status}" осталось латиницей`).toMatch(/[а-яё]/i);
    }
  });

  it("имён не больше, чем статусов", () => {
    // Лишний ключ — след статуса, которого больше нет, вроде «completed».
    expect(Object.keys(ORDER_STATUS_LABELS).sort()).toEqual([...SCHEMA_STATUSES].sort());
  });
});

describe("«заказ ещё должен» — одно определение на всю систему", () => {
  /*
    Это условие живёт трижды в SQL (начисление, оплата, возврат — за их
    совпадением следит shop-debt-invariant.test.ts) и до сих пор переписывалось
    руками везде, где выражается кодом: в рассылке напоминаний, в двойнике
    расчёта долга. Каждый раз чуть иначе, и каждый раз это стоило денег:
    возврат по списанному заказу вычитался дважды, а напоминание о погашенном
    долге приходило директору ежедневно.
  */
  const order = (over: Partial<Parameters<typeof orderStillOwes>[0]> = {}) =>
    ({ status: "delivered", paymentMethod: "cash", deletedAt: null, ...over });

  it("доставленный заказ должен", () => {
    expect(orderStillOwes(order())).toBe(true);
  });

  it("долговой заказ должен с момента оформления, ещё до отгрузки", () => {
    expect(orderStillOwes(order({ status: "new", paymentMethod: "debt" }))).toBe(true);
  });

  it("не-долговой заказ в работе не должен ничего", () => {
    // Товар ещё на складе, в резерве — магазину его не отдавали.
    expect(orderStillOwes(order({ status: "new", paymentMethod: "cash" }))).toBe(false);
    expect(orderStillOwes(order({ status: "shipped", paymentMethod: "cash" }))).toBe(false);
  });

  it("отменённый и возвращённый не должны, даже долговые", () => {
    expect(orderStillOwes(order({ status: "cancelled", paymentMethod: "debt" }))).toBe(false);
    expect(orderStillOwes(order({ status: "returned", paymentMethod: "debt" }))).toBe(false);
  });

  it("удалённый не должен ничего, каким бы ни был статус", () => {
    // Удаление — способ исправить ошибку ВВОДА: заказа не было вовсе.
    expect(orderStillOwes(order({ deletedAt: new Date() }))).toBe(false);
    expect(orderStillOwes(order({ status: "new", paymentMethod: "debt", deletedAt: new Date() }))).toBe(false);
  });
});

describe("стенды не выдумывают значений, которых схема не знает", () => {
  it("delivery_status в поддельных строках — только из перечисления", () => {
    /*
      В трёх наборах поддельные заказы несли в этом поле значение «none».
      Такого значения столбец не знает: перечисление это not_assigned,
      assigned, out_for_delivery, delivered, failed.

      Само по себе безобидно, пока никто не фильтрует по not_assigned. Но
      стенд, описывающий состояние, которого в базе быть не может, проверяет
      не продукт, а собственную выдумку — и в день, когда фильтр появится,
      останется зелёным. Ровно так уже случилось со статусом заказа
      «completed»: сорок запросов сравнивали колонку со значением, которого
      она не может содержать.
    */
    const DELIVERY_STATUSES = ["not_assigned", "assigned", "out_for_delivery", "delivered", "failed"];
    const offenders: string[] = [];

    /*
      Обход СВОЙ: общий sourceFiles намеренно пропускает __tests__, а
      выдуманное значение живёт именно там. С общим обходчиком проверка была
      бы пустой — она проходила бы, ничего не читая.
    */
    const walkAll = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules") continue;
          out.push(...walkAll(full));
        } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
          out.push(full);
        }
      }
      return out;
    };

    for (const file of walkAll(API)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/deliveryStatus:\s*"([^"]+)"/g)) {
        if (!DELIVERY_STATUSES.includes(m[1])) offenders.push(`${relative(API, file)}: "${m[1]}"`);
      }
    }

    expect(offenders, `значения, которых столбец delivery_status не знает:\n${offenders.join("\n")}`)
      .toEqual([]);
  });
});
