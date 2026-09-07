/**
 * Состояние заказа названо словом, и названо одним словом на всё приложение.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Владелец навёл мышь на круговую диаграмму «Статусы заказов» и увидел
 * «delivered». Причина не в диаграмме: словарей состояния заказа в клиенте
 * было ПЯТЬ.
 *
 *   theme-tokens.ts      семь значений
 *   OrderDetail.tsx      семь значений
 *   stock-movement-text  семь значений
 *   Dashboard.tsx        ЧЕТЫРЕ
 *   ShopDetail.tsx       ЧЕТЫРЕ
 *
 * Две отставшие копии знали «new / processing / completed / cancelled». Из них
 * «completed» состоянием заказа не было НИКОГДА (см. api/lib/order-status.ts),
 * а «delivered», «shipped», «pending» и «returned» — были и есть. То есть обе
 * копии не знали ровно того состояния, в котором заказ проводит остаток жизни.
 *
 * На сводке это давало английское слово. На карточке магазина — хуже: там
 * обращались `STATUS_LABELS[status]?.[lang]`, и для доставленного заказа
 * выходило undefined, то есть на месте состояния не было ничего.
 *
 * ── Почему проверка, а не пять правок ───────────────────────────────────────
 *
 * Потому что шестая копия заведётся так же, как первые пять: экрану нужна
 * подпись, словарь в четыре строки пишется быстрее, чем ищется общий. И
 * отстанет она не сразу, а через год — когда в перечисление добавят значение.
 *
 * Типы стерегут полноту (Record<Order["status"], Label> не соберётся без
 * восьмого значения), а эта проверка стережёт единственность: словарь должен
 * быть один, и на сервере он должен говорить те же слова.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  labelled, ORDER_STATUS_LABEL, ROLE_LABEL, DELIVERY_STATUS_LABEL,
  PAYMENT_METHOD_LABEL, ARRIVAL_STATUS_LABEL, PLAN_STATUS_LABEL,
  ACTIVE_STATUS_LABEL, TENANT_PLAN_LABEL, SUBSCRIPTION_STATUS_LABEL,
  ADJUSTMENT_TYPE_LABEL, type Label,
} from "@/lib/entity-labels";
import { ORDER_STATUS_LABELS as SERVER_LABELS } from "../../api/lib/order-status";

const SRC = join(__dirname, "..");
const SCHEMA = readFileSync(join(__dirname, "../../db/schema.ts"), "utf8");

/** Значения перечисления из схемы базы — источник правды, а не список в тесте. */
function enumValues(table: string, column: string): string[] {
  const start = SCHEMA.indexOf(`export const ${table} = mysqlTable`);
  if (start < 0) throw new Error(`нет таблицы ${table}`);
  const chunk = SCHEMA.slice(start, start + 60_000);
  const m = new RegExp(String.raw`mysqlEnum\("${column}",\s*\[([^\]]+)\]`).exec(chunk);
  if (!m) throw new Error(`нет перечисления ${table}.${column}`);
  return m[1].split(",").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Пояснения выкидываются: правило про код, а не про рассказ о нём. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const FILES = walk(SRC).map(f => ({
  rel:  relative(SRC, f).replace(/\\/g, "/"),
  text: stripComments(readFileSync(f, "utf8")),
}));

describe("словарь состояний — один на приложение", () => {
  it("подписи покрывают перечисление из базы, на обоих языках", () => {
    /*
      Пары «таблица.колонка → словарь». Список не выдуман: это все
      перечисления, значения которых человек видит на экране. Значения берутся
      из схемы, поэтому добавленное в базу состояние обрушит проверку здесь, а
      не всплывёт английским словом у руководителя.
    */
    const covered: Array<[string, string, Record<string, Label>]> = [
      ["orders",        "status",          ORDER_STATUS_LABEL],
      ["orders",        "delivery_status", DELIVERY_STATUS_LABEL],
      ["orders",        "payment_method",  PAYMENT_METHOD_LABEL],
      ["users",         "role",            ROLE_LABEL],
      ["users",         "status",          ACTIVE_STATUS_LABEL],
      ["tenants",       "plan",            TENANT_PLAN_LABEL],
      ["tenants",       "status",          ACTIVE_STATUS_LABEL],
      ["subscriptions", "status",          SUBSCRIPTION_STATUS_LABEL],
      ["arrivals",      "status",          ARRIVAL_STATUS_LABEL],
      ["dailyPlans",    "status",          PLAN_STATUS_LABEL],
      ["orderAdjustments", "type",         ADJUSTMENT_TYPE_LABEL],
    ];

    const missing: string[] = [];
    for (const [table, column, dict] of covered) {
      for (const value of enumValues(table, column)) {
        const hit = dict[value];
        if (!hit) { missing.push(`${table}.${column}: ${value} — нет подписи`); continue; }
        if (!hit.ru.trim()) missing.push(`${table}.${column}: ${value} — пусто по-русски`);
        if (!hit.uz.trim()) missing.push(`${table}.${column}: ${value} — пусто по-узбекски`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("никакой экран не заводит свой словарь состояний заказа", () => {
    const statuses = enumValues("orders", "status");
    // Строка вида `delivered: { ru: "Доставлен"` или `delivered: "Доставлен"`.
    const dictLine = (s: string) =>
      new RegExp(String.raw`\b${s}\s*:\s*(\{[^}]*\bru\s*:\s*")|\b${s}\s*:\s*"[А-Яа-яЁё]`);

    const offenders = FILES
      .filter(f => f.rel !== "lib/entity-labels.ts")
      .map(f => ({ rel: f.rel, hits: statuses.filter(s => dictLine(s).test(f.text)) }))
      // Одно-два совпадения — это разбор частного случая, а не словарь.
      .filter(f => f.hits.length >= 3)
      .map(f => `${f.rel}: ${f.hits.join(", ")}`);

    expect(offenders).toEqual([]);
  });

  it("сервер называет состояния теми же словами", () => {
    /*
      Словарей всё-таки два: серверный говорит строчными, потому что попадает
      в середину предложения («Статус изменён: доставлен»), клиентский —
      с большой буквы, потому что стоит отдельной плашкой. Разойтись по
      СМЫСЛУ им нельзя: агент получает уведомление и тут же открывает экран.
    */
    const differing = Object.entries(ORDER_STATUS_LABEL)
      .filter(([k, v]) => SERVER_LABELS[k as keyof typeof SERVER_LABELS]?.toLowerCase() !== v.ru.toLowerCase())
      .map(([k, v]) => `${k}: сервер «${SERVER_LABELS[k as keyof typeof SERVER_LABELS]}», клиент «${v.ru}»`);

    expect(differing).toEqual([]);
  });

  it("незнакомое значение показывается кодом, а не соседней подписью", () => {
    /*
      Прежде значок состояния делал `STATUS[status] ?? STATUS.new`, а значок
      подписки — `?? STATUS_CONFIG.canceled`. Пропуск в данных видно; уверенную
      неправду — нет. Восьмое состояние должно выглядеть непривычно, а не
      выглядеть «Новым».
    */
    expect(labelled(ORDER_STATUS_LABEL, "quantum_state")).toBe("quantum_state");
    expect(labelled(ORDER_STATUS_LABEL, "quantum_state", "uz")).toBe("quantum_state");
    expect(labelled(ORDER_STATUS_LABEL, null)).toBe("—");
    expect(labelled(ORDER_STATUS_LABEL, "")).toBe("—");
  });

  it("отвечает на обоих языках", () => {
    expect(labelled(ORDER_STATUS_LABEL, "delivered")).toBe("Доставлен");
    expect(labelled(ORDER_STATUS_LABEL, "delivered", "uz")).toBe("Yetkazildi");
  });
});
