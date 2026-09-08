/**
 * Полный архив задолженности: кто когда взял в долг и кто когда погасил.
 *
 * ── Чего не было ────────────────────────────────────────────────────────────
 *
 * Про ОДИН магазин ответ есть — акт сверки в его карточке. Про все сразу и за
 * всё время не было ничего: «Долги магазинов» и «Дебиторка» показывают остаток
 * на сейчас, и ни один отчёт не говорил, КОГДА это случилось.
 *
 * ── Почему проверки такие ───────────────────────────────────────────────────
 *
 * Промежуточный вариант собирал движения одним сырым запросом с UNION ALL.
 * Проверить его без живой базы было нечем — оставалось сверять текст запроса
 * глазами, — и в бою он падал пятисотой, а текст ошибки там подменяется общей
 * фразой. Разбор свёлся бы к догадкам с выкладкой на каждую.
 *
 * Сейчас чтение идёт построителем запросов, и поведение снова проверяется
 * поведением: подделка базы отдаёт строки, а проверка смотрит, что из них
 * собралось. Каждое правило ниже уже стоило денег в recalcShopDebt.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../queries/connection", () => ({ getDb: vi.fn() }));

import { getDb } from "../queries/connection";
import { debtJournal } from "../services/debt-journal";

const SRC = readFileSync(join(__dirname, "..", "services", "debt-journal.ts"), "utf8");
const d = (iso: string) => new Date(iso);
const SHOP = { shopId: 1, shopName: "Mega Do'kon", city: "Ташкент", agentName: "Санжар" };

interface Fixture {
  orders?: Array<Record<string, unknown>>;
  payments?: Array<Record<string, unknown>>;
  returns?: Array<Record<string, unknown>>;
  owedOrderIds?: number[];
}

/**
 * Поддельная база под ровно те запросы, что делает модуль.
 *
 * Запросы различаются по составу выбираемых столбцов — так же, как их различил
 * бы человек, читающий код.
 */
function fakeDb(f: Fixture) {
  let shape = "";
  const chain: Record<string, unknown> = {
    select: vi.fn((cols?: Record<string, unknown>) => {
      const keys = Object.keys(cols ?? {});
      if (keys.includes("paymentMethod")) shape = "orders";
      else if (keys.includes("type")) shape = "payments";
      else if (keys.includes("doc") && keys.includes("amount")) shape = "returns";
      else shape = "owed";
      return chain;
    }),
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => {
      switch (shape) {
        case "orders":   return f.orders ?? [];
        case "payments": return f.payments ?? [];
        case "returns":  return f.returns ?? [];
        default:         return [];
      }
    }),
    // where завершает цепочку только у поиска ещё должных заказов; у остальных
    // за ним идут orderBy и limit.
    where: vi.fn(() => (shape === "owed" ? (f.owedOrderIds ?? []).map(id => ({ id })) : chain)),
  };
  return chain;
}

describe("движения долга", () => {
  beforeEach(() => vi.clearAllMocks());

  it("отгрузка в долг и оплата попадают в архив с разными знаками", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({
      orders: [{ ...SHOP, createdAt: d("2026-01-10"), deliveredAt: null, paymentMethod: "debt", doc: "З-1", total: "100000.00", orderId: 11 }],
      payments: [{ ...SHOP, createdAt: d("2026-01-20"), type: "payment", amount: "40000.00", note: "наличными", orderId: null, orderDeletedAt: null }],
    }) as never);

    const j = await debtJournal(1);

    expect(j.rows).toHaveLength(2);
    // Свежее сверху: журнал читают с последнего события, а не с первого.
    expect(j.rows[0]).toMatchObject({ kind: "payment", amount: -40000, shopName: "Mega Do'kon", agentName: "Санжар" });
    expect(j.rows[1]).toMatchObject({ kind: "order", amount: 100000, doc: "З-1", orderId: 11 });
    expect(j.totals).toEqual({ taken: 100000, paid: 40000 });
    expect(j.total).toBe(2);
  });

  it("обычный заказ входит датой отгрузки, а долговой — датой оформления", async () => {
    // Правило одно на всю систему и живёт в shop-statement.obligationDate.
    vi.mocked(getDb).mockReturnValue(fakeDb({
      orders: [
        { ...SHOP, createdAt: d("2026-01-01"), deliveredAt: d("2026-01-25"), paymentMethod: "cash", doc: "З-НАЛ", total: "10000.00", orderId: 1 },
        { ...SHOP, createdAt: d("2026-01-05"), deliveredAt: null, paymentMethod: "debt", doc: "З-ДОЛГ", total: "20000.00", orderId: 2 },
      ],
    }) as never);

    const j = await debtJournal(1);

    expect(j.rows.map(r => [r.doc, r.date])).toEqual([
      ["З-НАЛ", d("2026-01-25")],
      ["З-ДОЛГ", d("2026-01-05")],
    ]);
  });

  it("платёж по удалённому заказу не считается", async () => {
    /*
      Удаление заказа — штатный способ исправить ошибку ВВОДА: заказа не было
      вовсе, значит не было и оплаты по нему. Засчитать её значило бы выдать
      магазину придуманный кредит. Так же поступают recalcShopDebt и акт сверки.
    */
    vi.mocked(getDb).mockReturnValue(fakeDb({
      payments: [
        { ...SHOP, createdAt: d("2026-02-01"), type: "payment", amount: "5000.00", note: null, orderId: 9, orderDeletedAt: d("2026-02-02") },
        { ...SHOP, createdAt: d("2026-02-03"), type: "payment", amount: "7000.00", note: null, orderId: 10, orderDeletedAt: null },
      ],
    }) as never);

    const j = await debtJournal(1);

    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].amount).toBe(-7000);
  });

  it("ручное начисление считается только без привязки к заказу", async () => {
    // С заказом обязательство уже учтено самим заказом — иначе оно удвоится.
    vi.mocked(getDb).mockReturnValue(fakeDb({
      payments: [
        { ...SHOP, createdAt: d("2026-03-01"), type: "debt", amount: "3000.00", note: "по тетради", orderId: null, orderDeletedAt: null },
        { ...SHOP, createdAt: d("2026-03-02"), type: "debt", amount: "9999.00", note: null, orderId: 4, orderDeletedAt: null },
      ],
    }) as never);

    const j = await debtJournal(1);

    expect(j.rows).toHaveLength(1);
    expect(j.rows[0]).toMatchObject({ kind: "debt", amount: 3000, note: "по тетради" });
  });

  it("возврат по заказу, который уже ничего не должен, не вычитается", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({
      returns: [
        { ...SHOP, createdAt: d("2026-04-01"), doc: "В-1", amount: "1000.00", note: null, orderId: 77 },
        { ...SHOP, createdAt: d("2026-04-02"), doc: "В-2", amount: "2000.00", note: null, orderId: 88 },
      ],
      owedOrderIds: [88],   // заказ 77 отменён, 88 ещё должен
    }) as never);

    const j = await debtJournal(1);

    expect(j.rows.map(r => r.doc)).toEqual(["В-2"]);
    expect(j.rows[0].amount).toBe(-2000);
  });

  it("период отрезает движения по дате обязательства, а не по дате заказа", async () => {
    /*
      Заказ оформлен в январе, отгружен в марте. В долг он превратился в марте
      — значит и в архив за март обязан попасть, хотя created_at у него
      январский. Отбор по created_at показал бы январь и потерял бы март.
    */
    vi.mocked(getDb).mockReturnValue(fakeDb({
      orders: [{ ...SHOP, createdAt: d("2026-01-15"), deliveredAt: d("2026-03-15"), paymentMethod: "cash", doc: "З-7", total: "50000.00", orderId: 7 }],
    }) as never);

    const inMarch = await debtJournal(1, { from: d("2026-03-01"), to: d("2026-03-31") });
    const inJanuary = await debtJournal(1, { from: d("2026-01-01"), to: d("2026-01-31") });

    expect(inMarch.rows.map(r => r.doc)).toEqual(["З-7"]);
    expect(inJanuary.rows).toHaveLength(0);
  });
});

describe("страницы и итоги", () => {
  beforeEach(() => vi.clearAllMocks());

  const five = () => fakeDb({
    payments: Array.from({ length: 5 }, (_, i) => ({
      ...SHOP, createdAt: d(`2026-05-0${i + 1}`), type: "payment", amount: "100.00",
      note: null, orderId: null, orderDeletedAt: null,
    })),
  });

  it("страница режет строки, но не итоги", async () => {
    /*
      «Взяли столько, погасили столько» отвечает про архив. Посчитанное по
      видимой странице это число означало бы совсем другое, а выглядело бы
      точно так же.
    */
    vi.mocked(getDb).mockReturnValue(five() as never);

    const j = await debtJournal(1, { page: 1, pageSize: 2 });

    expect(j.rows).toHaveLength(2);
    expect(j.total).toBe(5);
    expect(j.totals.paid).toBe(500);
  });

  it("вторая страница продолжает первую, а не повторяет её", async () => {
    vi.mocked(getDb).mockReturnValue(five() as never);

    const first = await debtJournal(1, { page: 1, pageSize: 2 });
    vi.mocked(getDb).mockReturnValue(five() as never);
    const second = await debtJournal(1, { page: 2, pageSize: 2 });

    expect(second.rows.map(r => r.date)).not.toEqual(first.rows.map(r => r.date));
    expect(second.page).toBe(2);
  });

  it("последняя страница не выдумывает строк", async () => {
    vi.mocked(getDb).mockReturnValue(five() as never);

    const j = await debtJournal(1, { page: 3, pageSize: 2 });

    expect(j.rows).toHaveLength(1);
  });

  it("размер страницы и номер не уходят за границы", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({}) as never);

    // Нулевая и отрицательная страница — это первая, а не смещение назад.
    expect((await debtJournal(1, { page: 0 })).page).toBe(1);
    expect((await debtJournal(1, { page: -5 })).page).toBe(1);
    // Запрос на десять тысяч строк за раз — способ уронить и базу, и браузер.
    expect((await debtJournal(1, { pageSize: 10000 })).pageSize).toBe(500);
    expect((await debtJournal(1, { pageSize: 0 })).pageSize).toBe(1);
  });

  it("вид операции отбирается, а не показывается весь", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({
      orders: [{ ...SHOP, createdAt: d("2026-06-01"), deliveredAt: null, paymentMethod: "debt", doc: "З-1", total: "1000.00", orderId: 1 }],
      payments: [{ ...SHOP, createdAt: d("2026-06-02"), type: "payment", amount: "500.00", note: null, orderId: null, orderDeletedAt: null }],
    }) as never);

    const onlyPayments = await debtJournal(1, { kind: "payment" });

    expect(onlyPayments.rows.every(r => r.kind === "payment")).toBe(true);
  });
});

describe("правила отбора не размножились", () => {
  it("условие «заказ является обязательством» берётся из акта сверки", () => {
    /*
      В этом коде расчёт долга и его объяснение уже расходились именно так: две
      почти одинаковые формулы одного и того же живут порознь ровно до первой
      правки в одной из них.
    */
    expect(SRC).toMatch(/import \{[^}]*orderIsOwed[^}]*\} from ".\/shop-statement"/s);
    expect(SRC).toMatch(/import \{[^}]*obligationDate[^}]*\} from ".\/shop-statement"/s);
    expect(SRC, "условие отбора заказов переписали заново")
      .not.toMatch(/notInArray\(orders\.status/);
  });

  it("предел выборки не молчит", () => {
    // Молча укоротить архив значит соврать про период: человек решит, что за
    // год было двести движений, а их было двадцать тысяч.
    expect(SRC).toMatch(/truncated:/);
  });
});
