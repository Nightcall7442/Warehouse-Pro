import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  encodeSnapshot, decodeSnapshot, encodeCursor, decodeCursor, money, iso,
} from "../public/order-export";

/* ═══════════════════════════════════════════════════════════════════════════
   Листание не теряет и не дублирует — проверено прогоном, а не рассуждением.

   ── Что именно доказывается ─────────────────────────────────────────────────

   Пункты приёмки B, C и D ТЗ BEKDRINKS:

     B. на трёх и более страницах ни одна строка не потеряна и не задвоена;
     C. заказ, пришедший ВО ВРЕМЯ выгрузки, снимок не рушит;
     D. после обрыва связи выгрузка продолжается с последней точки без
        повторов.

   И сверка (пункт 11 и приёмка A): число отданных строк равно total_count,
   сумма amount равна orders_amount_total, разбивка по статусам равна
   status_counts.

   ── Честно о границах ───────────────────────────────────────────────────────

   Здесь нет MySQL — на этой машине её нет вовсе. Прогоняется НАБОР ПРАВИЛ, по
   которым запрос отбирает строки, на списке в памяти:

     1. граница набора: id ≤ maxId снимка;
     2. следующая страница: id > lastId курсора;
     3. порядок: id по возрастанию;
     4. берём limit + 1, чтобы знать про продолжение.

   Что запрос выражает ИМЕННО эти правила, стережёт отдельная проверка
   (public-orders-export.test.ts: «листание проходит приёмку по построению»),
   и она читает настоящий текст запроса. Две проверки вместе и дают цепочку:
   запрос делает то-то, а то-то ничего не теряет. Ни одна из них по
   отдельности этого не доказывает, и притворяться, что доказывает, нельзя.
   ═══════════════════════════════════════════════════════════════════════════ */

interface Row {
  id: number;
  status: string;
  total: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** Хранилище, которое умеет ровно то, что нужно правилам выше. */
class FakeOrders {
  private rows: Row[] = [];
  private nextId = 1;

  add(status: string, total: number, at = 0): Row {
    const r: Row = { id: this.nextId++, status, total, updatedAt: at, deletedAt: null };
    this.rows.push(r);
    return r;
  }

  /** Заказ изменился: статус другой, id тот же. Снимок это переживать обязан. */
  touch(id: number, status: string, at: number): void {
    const r = this.rows.find(x => x.id === id);
    if (r) { r.status = status; r.updatedAt = at; }
  }

  remove(id: number, at: number): void {
    const r = this.rows.find(x => x.id === id);
    if (r) { r.deletedAt = at; r.updatedAt = at; }
  }

  maxId(): number {
    return this.rows.reduce((m, r) => Math.max(m, r.id), 0);
  }

  /** Те же условия, что собирает baseConditions. */
  matching(opts: { maxId: number | null; updatedSince: number | null; includeDeleted: boolean }): Row[] {
    return this.rows.filter(r => {
      if (opts.maxId !== null && r.id > opts.maxId) return false;
      if (opts.updatedSince !== null && r.updatedAt < opts.updatedSince) return false;
      if (!opts.includeDeleted && r.deletedAt !== null) return false;
      return true;
    });
  }
}

interface Page {
  data: Array<{ order_id: number; status: string; amount: string; updated_at: string }>;
  next_cursor: string | null;
  has_more: boolean;
  total_count: number;
  orders_amount_total: string;
  status_counts: Record<string, number>;
  snapshot_id: string | null;
}

/**
 * Одна страница выгрузки — по правилам 1–4.
 *
 * Пишется здесь ровно один раз и дальше только вызывается: если правила
 * разъедутся с запросом, разъедутся они в одном месте, а не в пяти проверках.
 */
function fetchPage(db: FakeOrders, params: {
  limit: number;
  cursor?: string | null;
  snapshotId?: string | null;
  updatedSince?: number | null;
}): Page {
  const incremental = params.updatedSince != null;
  const cursor = params.cursor ? decodeCursor(params.cursor) : null;

  let snapshotId = params.snapshotId ?? cursor?.snapshotId ?? "";
  let snapshot = snapshotId ? decodeSnapshot(snapshotId) : null;
  if (!incremental && !snapshot) {
    snapshot = { maxId: db.maxId(), asOf: new Date(0).toISOString() };
    snapshotId = encodeSnapshot(snapshot);
  }

  const opts = {
    maxId: incremental ? null : snapshot!.maxId,
    updatedSince: params.updatedSince ?? null,
    includeDeleted: incremental,
  };

  const all = db.matching(opts).sort((a, b) => a.id - b.id);
  const after = all.filter(r => r.id > (cursor?.lastId ?? 0));
  const page = after.slice(0, params.limit + 1);
  const hasMore = page.length > params.limit;
  const rows = hasMore ? page.slice(0, params.limit) : page;

  const statusCounts: Record<string, number> = {};
  for (const r of all) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;

  return {
    data: rows.map(r => ({
      order_id: r.id,
      status: r.status,
      amount: money(r.total),
      updated_at: iso(new Date(r.updatedAt))!,
    })),
    next_cursor: hasMore && rows.length
      ? encodeCursor({ lastId: rows[rows.length - 1].id, snapshotId, updatedSince: undefined })
      : null,
    has_more: hasMore,
    total_count: all.length,
    orders_amount_total: money(all.reduce((s, r) => s + r.total, 0)),
    status_counts: statusCounts,
    snapshot_id: incremental ? null : snapshotId,
  };
}

/** Выгрузка целиком: страница за страницей, пока есть продолжение. */
function drain(db: FakeOrders, limit: number, between?: (pageNo: number) => void) {
  const seen: number[] = [];
  let cursor: string | null = null;
  let first: Page | null = null;
  let pages = 0;

  for (;;) {
    const p: Page = fetchPage(db, { limit, cursor });
    first ??= p;
    pages++;
    seen.push(...p.data.map(d => d.order_id));
    if (!p.has_more) return { seen, pages, first, last: p };
    cursor = p.next_cursor;
    expect(cursor, "продолжение обещано, а курсора нет").not.toBeNull();
    between?.(pages);
    if (pages > 1000) throw new Error("листание не кончается");
  }
}

describe("три страницы и больше: ничего не потеряно и не задвоено", () => {
  it("ровный случай — 250 заказов по 100", () => {
    const db = new FakeOrders();
    for (let i = 0; i < 250; i++) db.add("delivered", 1000 + i);

    const { seen, pages } = drain(db, 100);

    expect(pages, "страниц меньше трёх — проверка не про то").toBeGreaterThanOrEqual(3);
    expect(seen).toHaveLength(250);
    expect(new Set(seen).size, "заказ пришёл дважды").toBe(250);
  });

  it("граница страницы ровно совпадает с концом набора", () => {
    /*
      Классическое место ошибки: 200 строк по 100. Наивная проверка «пришло
      меньше, чем просили» объявила бы конец на второй странице — и получатель
      не узнал бы, есть ли третья. Правило «берём limit + 1» отвечает на это
      без лишнего запроса.
    */
    const db = new FakeOrders();
    for (let i = 0; i < 200; i++) db.add("delivered", 500);

    const { seen, pages } = drain(db, 100);
    expect(pages).toBe(2);
    expect(seen).toHaveLength(200);
  });

  it("пустая организация — законный ответ, а не поломка", () => {
    const db = new FakeOrders();
    const { seen, pages, last } = drain(db, 100);
    expect(seen).toHaveLength(0);
    expect(pages).toBe(1);
    expect(last.total_count).toBe(0);
    expect(last.orders_amount_total).toBe("0.00");
  });
});

describe("новые заказы во время выгрузки снимок не рушат", () => {
  it("пришедшие после снимка в него не попадают", () => {
    /*
      Пункт C приёмки. Именно здесь смещение (`offset`) проваливается: новая
      строка сдвигает все последующие, и на границе страницы одна теряется, а
      другая приходит дважды. Снимок по наибольшему идентификатору этого не
      допускает по построению.
    */
    const db = new FakeOrders();
    for (let i = 0; i < 250; i++) db.add("delivered", 1000);
    const before = db.maxId();

    // На каждой границе страницы приходит по десять новых заказов.
    const { seen } = drain(db, 100, () => {
      for (let i = 0; i < 10; i++) db.add("new", 777);
    });

    expect(seen).toHaveLength(250);
    expect(new Set(seen).size).toBe(250);
    expect(Math.max(...seen), "в снимок попал заказ, пришедший позже").toBe(before);
  });

  it("изменившийся статус не выкидывает заказ из набора", () => {
    /*
      Снимок фиксирует СОСТАВ, а не содержимое: заказ, ставший доставленным
      между первой и третьей страницей, обязан прийти — с новым статусом.
      Иначе он исчез бы из выгрузки насовсем, а получатель не узнал бы.
    */
    const db = new FakeOrders();
    for (let i = 0; i < 250; i++) db.add("new", 1000);

    const { seen } = drain(db, 100, () => {
      for (let id = 150; id < 160; id++) db.touch(id, "delivered", 5);
    });

    expect(seen).toHaveLength(250);
    expect(new Set(seen).size).toBe(250);
  });

  it("удаление во время выгрузки не рвёт листание", () => {
    // Удалённые в полную выгрузку не входят, и это меняет НАБОР посреди
    // листания. Потеряться при этом не должен никто, кроме самих удалённых.
    const db = new FakeOrders();
    for (let i = 0; i < 250; i++) db.add("delivered", 1000);

    const { seen } = drain(db, 100, () => db.remove(240, 7));

    expect(new Set(seen).size, "заказ пришёл дважды").toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(249);
  });
});

describe("после обрыва связи выгрузка продолжается без повторов", () => {
  it("продолжение с последней точки даёт ровно остаток", () => {
    /*
      Пункт D приёмки. Курсор — это и есть точка возобновления: он не хранится
      у нас, а едет к получателю и обратно, поэтому переживает и обрыв связи,
      и перезапуск обеих сторон.
    */
    const db = new FakeOrders();
    for (let i = 0; i < 250; i++) db.add("delivered", 1000);

    const p1 = fetchPage(db, { limit: 100 });
    const p2 = fetchPage(db, { limit: 100, cursor: p1.next_cursor });

    // Здесь «рвётся связь». Получатель сохранил только курсор второй страницы.
    const checkpoint = p2.next_cursor;
    expect(checkpoint, "точки возобновления нет").not.toBeNull();

    // ...и продолжает с него — хоть через час, хоть после перезапуска.
    const p3 = fetchPage(db, { limit: 100, cursor: checkpoint });

    const all = [...p1.data, ...p2.data, ...p3.data].map(d => d.order_id);
    expect(all).toHaveLength(250);
    expect(new Set(all).size, "после обрыва пришли повторы").toBe(250);
    expect(p3.has_more).toBe(false);
  });

  it("повтор той же страницы отдаёт то же самое", () => {
    /*
      Безопасный повтор: получатель, не дождавшийся ответа, шлёт запрос
      заново с тем же курсором. Идемпотентность здесь и означает «тот же
      курсор — тот же набор», а склеивать у себя он будет по order_id.
    */
    const db = new FakeOrders();
    for (let i = 0; i < 250; i++) db.add("delivered", 1000);

    const p1 = fetchPage(db, { limit: 100 });
    const a = fetchPage(db, { limit: 100, cursor: p1.next_cursor });
    const b = fetchPage(db, { limit: 100, cursor: p1.next_cursor });

    expect(b.data.map(d => d.order_id)).toEqual(a.data.map(d => d.order_id));
  });

  it("курсор от чужого снимка виден по привязке", () => {
    // Подставленный курсор от вчерашней выгрузки увёл бы набор, и выглядело
    // бы это как пропажа данных у нас. Привязка к снимку это ловит.
    const db = new FakeOrders();
    for (let i = 0; i < 10; i++) db.add("delivered", 1);
    const p1 = fetchPage(db, { limit: 5 });

    const mine = decodeCursor(p1.next_cursor!)!;
    const alien = decodeCursor(encodeCursor({ lastId: 5, snapshotId: "чужой" }))!;
    expect(mine.snapshotId).not.toBe(alien.snapshotId);
  });
});

describe("сверка сходится по тому же набору", () => {
  it("строки, счёт, сумма и статусы", () => {
    /*
      Приёмка A: числа обязаны сойтись с ERP. Проверяем то, что в нашей власти:
      что три итога описывают ТОТ ЖЕ набор, что и отданные строки.
    */
    const db = new FakeOrders();
    const mix = ["delivered", "new", "processing", "cancelled", "returned"];
    let expectedSum = 0;
    for (let i = 0; i < 320; i++) {
      const total = 1000 + i * 7;
      expectedSum += total;
      db.add(mix[i % mix.length], total);
    }

    const { seen, last, first } = drain(db, 100);

    // 1. Число строк равно total_count.
    expect(seen).toHaveLength(first.total_count);
    expect(last.total_count).toBe(320);

    // 2. Сумма отданных равна orders_amount_total.
    const summed = drainAmounts(db, 100);
    expect(summed).toBe(first.orders_amount_total);
    expect(first.orders_amount_total).toBe(money(expectedSum));

    // 3. Разбивка по статусам равна status_counts.
    const byStatus = drainStatuses(db, 100);
    expect(byStatus).toEqual(first.status_counts);
  });

  it("итоги не зависят от страницы, на которой их спросили", () => {
    // Иначе получатель, сверяющийся по последней странице, получил бы другие
    // числа, чем тот, кто сверяется по первой.
    const db = new FakeOrders();
    for (let i = 0; i < 250; i++) db.add("delivered", 1000);

    const p1 = fetchPage(db, { limit: 100 });
    const p2 = fetchPage(db, { limit: 100, cursor: p1.next_cursor });

    expect(p2.total_count).toBe(p1.total_count);
    expect(p2.orders_amount_total).toBe(p1.orders_amount_total);
    expect(p2.status_counts).toEqual(p1.status_counts);
  });
});

/** Сумма всех отданных строк — тем же обходом, что и выгрузка. */
function drainAmounts(db: FakeOrders, limit: number): string {
  let sum = 0;
  let cursor: string | null = null;
  for (;;) {
    const p: Page = fetchPage(db, { limit, cursor });
    for (const d of p.data) sum += Number(d.amount);
    if (!p.has_more) return money(sum);
    cursor = p.next_cursor;
  }
}

/** Разбивка по статусам — по отданным строкам, а не по запросу к итогам. */
function drainStatuses(db: FakeOrders, limit: number): Record<string, number> {
  const out: Record<string, number> = {};
  let cursor: string | null = null;
  for (;;) {
    const p: Page = fetchPage(db, { limit, cursor });
    for (const d of p.data) out[d.status] = (out[d.status] ?? 0) + 1;
    if (!p.has_more) return out;
    cursor = p.next_cursor;
  }
}

describe("режим изменений", () => {
  it("отдаёт всё, что изменилось с названного времени, включая удалённые", () => {
    const db = new FakeOrders();
    for (let i = 0; i < 50; i++) db.add("delivered", 1000, 10);
    db.touch(3, "returned", 100);
    db.remove(7, 100);

    const p = fetchPage(db, { limit: 100, updatedSince: 50 });
    const ids = p.data.map(d => d.order_id).sort((a, b) => a - b);
    expect(ids, "изменённый или удалённый заказ не пришёл").toEqual([3, 7]);
  });

  it("время берётся от сервера, а не от часов получателя", () => {
    /*
      Расхождение часов в минуту теряет заказы: получатель назначит следующий
      updated_since по своим часам и пропустит всё, что случилось в эту
      минуту у нас. Поэтому в ответе есть server_time, и в документации прямо
      сказано брать его.
    */
    const ROUTE = fs.readFileSync(
      path.resolve(process.cwd(), "api/public/orders-v1.ts"), "utf8",
    ).replace(/\r\n/g, "\n");
    expect(ROUTE).toContain("server_time: new Date().toISOString()");

    const DOC = fs.readFileSync(
      path.resolve(process.cwd(), "docs/public-api-orders.md"), "utf8",
    );
    expect(DOC, "документация не велит брать время от сервера").toMatch(/server_time/);
  });

  it("удалённый заказ приходит с меткой, а не молча пропадает", () => {
    // Без метки заказ, удалённый после первой сверки, остался бы у получателя
    // навсегда — и долг по нему тоже.
    const ROUTE = fs.readFileSync(
      path.resolve(process.cwd(), "api/public/orders-v1.ts"), "utf8",
    ).replace(/\r\n/g, "\n");
    expect(ROUTE).toContain("deleted_at: iso(r.deletedAt)");
    expect(ROUTE).toContain("includeDeleted: incremental");
  });
});
