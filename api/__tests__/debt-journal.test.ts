/**
 * Полный архив задолженности: кто когда взял в долг и кто когда погасил.
 *
 * ── Чего не было ────────────────────────────────────────────────────────────
 *
 * Про ОДИН магазин ответ есть — акт сверки в его карточке. Про все сразу и за
 * всё время не было ничего: «Долги магазинов» и «Дебиторка» показывают остаток
 * на сейчас, и ни один отчёт не говорил, КОГДА это случилось.
 *
 * Первая попытка отвечала наполовину: четыре отдельных запроса, сведение и
 * сортировка в памяти, предел строк и признак «показано не всё». Для месяца
 * сойдёт, для архива — нет: на вопрос «а что было в позапрошлом году» такой
 * ответ звучит «а дальше не знаю». Поэтому теперь один UNION и страницы,
 * которые отбирает база.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Живой базы здесь нет, поэтому проверяется то, что от неё не зависит и при
 * этом ломается чаще всего:
 *
 *   · правила отбора движений не размножились — условие «заказ является
 *     обязательством» берётся из shop-statement.ts, а не переписано заново;
 *   · три тонких условия, каждое из которых уже стоило денег в recalcShopDebt,
 *     стоят и здесь;
 *   · итоги считаются по ВСЕМУ набору, а не по видимой странице;
 *   · разбор строки базы не теряет знак суммы и не путает столбцы;
 *   · размер страницы и смещение не выходят за границы.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../queries/connection", () => ({ getDb: vi.fn() }));

import { getDb } from "../queries/connection";
import { debtJournal, toRow } from "../services/debt-journal";

const SRC = readFileSync(join(__dirname, "..", "services", "debt-journal.ts"), "utf8");

/**
 * Текст запроса, собранного drizzle.
 *
 * Обход рекурсивный: запрос собирается из вложенных кусков — объединение
 * источников, условия фильтров, — и без спуска внутрь проверка видела бы одну
 * внешнюю оболочку и проходила бы вхолостую на любых фильтрах.
 *
 * Значения подстановок сюда НЕ попадают: у них другая форма, и это ровно то,
 * что проверяется ниже — фильтр уходит подстановкой, а не склейкой строк.
 */
function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] })?.queryChunks;
  if (!Array.isArray(chunks)) return "";
  return chunks
    .map(c => {
      const v = (c as { value?: unknown })?.value;
      if (typeof v === "string") return v;
      if (Array.isArray(v) && v.every(x => typeof x === "string")) return v.join("");
      // Вложенный кусок запроса — спускаемся в него.
      return sqlText(c);
    })
    .join(" ");
}

/** Поддельная база: запоминает запросы и отдаёт заготовленные строки. */
function fakeDb(pageRows: Array<Record<string, unknown>>, totals: Record<string, unknown>) {
  const queries: unknown[] = [];
  return {
    db: {
      execute: vi.fn((q: unknown) => {
        queries.push(q);
        // Первый запрос — страница, второй — итоги. Оба в форме драйвера
        // mysql2: [строки, поля].
        return Promise.resolve([queries.length === 1 ? pageRows : [totals], []]);
      }),
    },
    queries,
  };
}

const TOTALS = { n: 137, taken: "5000000.00", paid: "1200000.00" };

describe("архив собирается одним запросом и отдаётся страницами", () => {
  beforeEach(() => vi.clearAllMocks());

  it("итоги и счётчик считаются по всему набору, а не по странице", async () => {
    /*
      «Взяли столько, погасили столько» отвечает про архив. Посчитанное по
      пятидесяти видимым строкам это число означало бы совсем другое, а
      выглядело бы точно так же.
    */
    const { db } = fakeDb([], TOTALS);
    vi.mocked(getDb).mockReturnValue(db as never);

    const r = await debtJournal(1, { pageSize: 50 });

    expect(r.total).toBe(137);
    expect(r.totals).toEqual({ taken: 5000000, paid: 1200000 });
  });

  it("страница отбирается базой, а не памятью", async () => {
    const { db, queries } = fakeDb([], TOTALS);
    vi.mocked(getDb).mockReturnValue(db as never);

    await debtJournal(1, { page: 3, pageSize: 50 });

    const page = sqlText(queries[0]);
    expect(page).toMatch(/LIMIT/);
    expect(page).toMatch(/OFFSET/);
    expect(page).toMatch(/ORDER BY/);
  });

  it("размер страницы и номер не уходят за границы", async () => {
    const { db } = fakeDb([], TOTALS);
    vi.mocked(getDb).mockReturnValue(db as never);

    // Нулевая и отрицательная страница — это первая, а не смещение назад.
    expect((await debtJournal(1, { page: 0 })).page).toBe(1);
    expect((await debtJournal(1, { page: -5 })).page).toBe(1);
    // Запрос на десять тысяч строк за раз — способ уронить и базу, и браузер.
    expect((await debtJournal(1, { pageSize: 10000 })).pageSize).toBe(500);
    expect((await debtJournal(1, { pageSize: 0 })).pageSize).toBe(1);
  });

  it("фильтры уходят подстановкой, а не склейкой строк", async () => {
    const { db, queries } = fakeDb([], TOTALS);
    vi.mocked(getDb).mockReturnValue(db as never);

    await debtJournal(1, { search: "Mega'; DROP TABLE shops--", shopId: 7, kind: "payment" });

    const page = sqlText(queries[0]);
    expect(page, "значение фильтра попало в текст запроса").not.toContain("DROP TABLE");
    expect(page).toMatch(/s\.name LIKE/);
    expect(page).toMatch(/m\.kind =/);
  });
});

describe("правила отбора движений не размножились", () => {
  it("условие «заказ является обязательством» берётся из акта сверки", () => {
    /*
      В этом коде расчёт долга и его объяснение уже расходились именно так: две
      почти одинаковые формулы одного и того же живут порознь ровно до первой
      правки в одной из них.
    */
    expect(SRC).toMatch(/import \{[^}]*orderIsOwed[^}]*\} from ".\/shop-statement"/s);
    // Дважды: у самих заказов и у возвратов, которым нужен ещё должный заказ.
    expect((SRC.match(/\$\{orderIsOwed\(\)\}/g) ?? []).length).toBe(2);
    expect(SRC, "условие отбора заказов переписали заново")
      .not.toMatch(/status NOT IN \('cancelled'/);
  });

  it("платёж по удалённому заказу не считается", () => {
    // Удаление заказа значит «его не было», а с ним не было и оплаты:
    // засчитать её значило бы выдать магазину придуманный кредит.
    expect(SRC).toMatch(/payments\.order_id IS NULL OR EXISTS[\s\S]{0,160}orders\.deleted_at IS NULL/);
  });

  it("ручное начисление считается только без привязки к заказу", () => {
    // С заказом обязательство уже учтено самим заказом — иначе оно удвоится.
    expect(SRC).toMatch(/type = 'debt' AND payments\.order_id IS NULL/);
  });

  it("возврат по заказу, который уже ничего не должен, не вычитается", () => {
    // Отменённый заказ и так даёт ноль; вычесть сверх него возврат значило бы
    // списать те же деньги дважды.
    expect(SRC).toMatch(/returns\.order_id IS NULL OR EXISTS[\s\S]{0,160}\$\{orderIsOwed\(\)\}/);
  });

  it("обязательство по обычному заказу датируется отгрузкой", () => {
    // До отгрузки магазин ничего не должен, что бы ни стояло в заказе; заказ в
    // долг — наоборот, должен с того дня, как выписан.
    expect(SRC).toMatch(/WHEN orders\.payment_method = 'debt' THEN orders\.created_at/);
    expect(SRC).toMatch(/ELSE COALESCE\(orders\.delivered_at, orders\.created_at\)/);
  });
});

describe("разбор строки базы", () => {
  it("знак суммы и столбцы не путаются", () => {
    const row = toRow({
      moved_at: "2026-03-15T10:00:00.000Z",
      kind: "payment",
      doc: null,
      note: "наличными",
      amount: "-40000.00",
      order_id: 12,
      shop_id: 7,
      shop_name: "Mega Do'kon",
      city: "Ташкент",
      agent_name: "Санжар",
    });

    expect(row.amount).toBe(-40000);
    expect(row.kind).toBe("payment");
    expect(row.shopId).toBe(7);
    expect(row.orderId).toBe(12);
    expect(row.note).toBe("наличными");
    expect(row.date.getUTCFullYear()).toBe(2026);
  });

  it("пустые поля остаются пустыми, а не превращаются в «null»", () => {
    // Строка «null» в столбце документа — то, за что в этом коде уже ловили
    // выгрузки: внутреннее значение базы вместо ответа.
    const row = toRow({ moved_at: "2026-01-01", kind: "debt", amount: "1000", shop_id: 1, shop_name: "Точка" });

    expect(row.doc).toBeNull();
    expect(row.orderId).toBeNull();
    expect(row.note).toBeNull();
    expect(row.city).toBeNull();
    expect(row.agentName).toBeNull();
    expect(row.amount).toBe(1000);
  });
});
