/**
 * Переписка не лежит у нас вечно.
 *
 * ── Решение владельца ───────────────────────────────────────────────────────
 *
 * Завершённый разговор через неделю стирается. Остаётся строка без текстов —
 * чей разговор, когда шёл, сколько было сообщений: платформа не теряет счёт
 * обращений, а содержание чужих жалоб у нас не хранится.
 *
 * ── Почему проверка с настоящими строками, а не с заглушками ────────────────
 *
 * Здесь удаляют. Ошибка в условии — это не «показали не то»: это чужая
 * переписка, стёртая раньше срока или, наоборот, оставшаяся навсегда. Проверять
 * такое подделкой, которая на любой запрос отвечает «ок», бессмысленно — ниже
 * маленькая база в памяти, и она честно применяет условия к строкам.
 *
 * Опаснее всего окно времени: сообщения принадлежат разговору не по ключу, а по
 * промежутку между его началом и завершением. Съедь граница — и удалится
 * переписка соседнего разговора той же пары.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});
vi.mock("../queries/connection", () => ({ getDb: vi.fn() }));
vi.mock("../lib/sse", () => ({ sseBus: { emit: () => {} } }));

import { getDb } from "../queries/connection";
import { supportThreads } from "@db/schema";
import {
  RETENTION_DAYS, SILENCE_DAYS,
  purgeClosedThreads, autoCloseSilent, closeThread, ensureOpenThread, threadState,
} from "../services/support-chat";

// ── Маленькая база в памяти ─────────────────────────────────────────────────

type Row = Record<string, unknown>;
const store: { threads: Row[]; messages: Row[] } = { threads: [], messages: [] };
let nextId = 1;

const nameOf = (col: unknown) => (col as { name: string }).name;

/** Условие WHERE, применённое к строке. */
function match(row: Row, cond: unknown): boolean {
  const c = cond as { __kind?: string; conds?: unknown[]; col?: unknown; val?: unknown; values?: unknown[] };
  if (!c || !c.__kind) return true;
  const v = c.col ? row[nameOf(c.col)] : undefined;
  switch (c.__kind) {
    case "and":       return (c.conds ?? []).every(x => match(row, x));
    case "or":        return (c.conds ?? []).some(x => match(row, x));
    case "eq":        return Number(v ?? NaN) === Number(c.val ?? NaN) || v === c.val;
    case "lt":        return v != null && (v as number) < (c.val as number);
    case "lte":       return v != null && (v as number) <= (c.val as number);
    case "gte":       return v != null && (v as number) >= (c.val as number);
    case "isNull":    return v == null;
    case "isNotNull": return v != null;
    case "inArray":   return (c.values as unknown[]).some(x => Number(x) === Number(v));
    default:          return true;
  }
}

interface QueryState {
  cols: Record<string, unknown>;
  rows: Row[];
  cond: unknown;
  group: unknown[] | null;
  order: { col: unknown; desc: boolean } | null;
  limit: number | null;
}

/** Значение одного поля выборки — столбец или агрегат. */
function project(rows: Row[], col: unknown): unknown {
  const marker = col as { __kind?: string; strings?: string[]; values?: unknown[] };
  if (marker?.__kind === "sql") {
    const text = (marker.strings ?? []).join("?");
    if (text.includes("count(")) return rows.length;
    if (text.includes("max(")) {
      const c = nameOf(marker.values?.[0]);
      return rows.reduce<unknown>((acc, r) => (acc == null || (r[c] as number) > (acc as number) ? r[c] : acc), null);
    }
    return null;
  }
  return rows[0]?.[nameOf(col)] ?? null;
}

function run(s: QueryState): Row[] {
  let rows = s.rows.filter(r => match(r, s.cond));

  if (s.order) {
    const c = nameOf(s.order.col);
    rows = [...rows].sort((a, b) => (Number(a[c]) - Number(b[c])) * (s.order!.desc ? -1 : 1));
  }

  const groups: Row[][] = s.group
    ? Object.values(rows.reduce<Record<string, Row[]>>((acc, r) => {
        const key = s.group!.map(g => String(r[nameOf(g)])).join(":");
        (acc[key] ??= []).push(r);
        return acc;
      }, {}))
    : rows.map(r => [r]);

  /*
    Агрегат без группировки считается по ВСЕЙ выборке и даёт ровно одну строку —
    в том числе пустую, иначе `const [row] =` вернул бы undefined там, где
    ожидается ноль.
  */
  const aggregating = Object.values(s.cols).some(c => (c as { __kind?: string })?.__kind === "sql");
  const chunks = !s.group && aggregating ? [rows] : groups;

  const out = chunks.map(g => {
    const row: Row = {};
    for (const [key, col] of Object.entries(s.cols)) row[key] = project(g, col);
    return row;
  });

  return s.limit == null ? out : out.slice(0, s.limit);
}

function fakeDb() {
  const table = (t: unknown) => (t === supportThreads ? store.threads : store.messages);

  return {
    select: (cols: Record<string, unknown>) => {
      const s: QueryState = { cols, rows: [], cond: null, group: null, order: null, limit: null };
      const chain = {
        from: (t: unknown) => { s.rows = table(t); return chain; },
        leftJoin: () => chain,
        innerJoin: () => chain,
        where: (c: unknown) => { s.cond = c; return chain; },
        groupBy: (...g: unknown[]) => { s.group = g; return chain; },
        orderBy: (o: unknown) => {
          const m = o as { __kind?: string; col?: unknown };
          s.order = m?.__kind === "desc" ? { col: m.col, desc: true } : { col: o, desc: false };
          return chain;
        },
        limit: (n: number) => { s.limit = n; return Promise.resolve(run(s)); },
        then: (ok: (r: Row[]) => unknown, no?: (e: unknown) => unknown) => Promise.resolve(run(s)).then(ok, no),
      };
      return chain;
    },

    insert: (t: unknown) => ({
      values: (v: Row) => {
        const row: Row = t === supportThreads
          ? { id: nextId++, tenant_id: v.tenantId, user_id: v.userId, opened_at: new Date(), closed_at: null, closed_by: null, purged_at: null, message_count: 0 }
          : { id: nextId++, tenant_id: v.tenantId, user_id: v.userId, from_platform: v.fromPlatform, author_id: v.authorId, body: v.body, read_at: null, created_at: new Date() };
        table(t).push(row);
        return Promise.resolve({ insertId: row.id });
      },
    }),

    update: (t: unknown) => ({
      set: (v: Row) => ({
        where: (c: unknown) => {
          for (const row of table(t).filter(r => match(r, c))) {
            if ("closedAt" in v) row.closed_at = v.closedAt;
            if ("closedBy" in v) row.closed_by = v.closedBy;
            if ("purgedAt" in v) row.purged_at = v.purgedAt;
            if ("messageCount" in v) row.message_count = v.messageCount;
          }
          return Promise.resolve({});
        },
      }),
    }),

    delete: (t: unknown) => ({
      where: (c: unknown) => {
        const keep = table(t).filter(r => !match(r, c));
        table(t).length = 0;
        table(t).push(...keep);
        return Promise.resolve({});
      },
    }),
  };
}

const DAY = 86_400_000;
const NOW = new Date("2026-09-08T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

function seedThread(over: Partial<Row> = {}): Row {
  const row: Row = {
    id: nextId++, tenant_id: 1, user_id: 7,
    opened_at: daysAgo(30), closed_at: null, closed_by: null, purged_at: null, message_count: 0,
    ...over,
  };
  store.threads.push(row);
  return row;
}

function seedMessage(at: Date, over: Partial<Row> = {}): Row {
  const row: Row = {
    id: nextId++, tenant_id: 1, user_id: 7, from_platform: false,
    author_id: 7, body: "текст", read_at: null, created_at: at, ...over,
  };
  store.messages.push(row);
  return row;
}

beforeEach(() => {
  store.threads = [];
  store.messages = [];
  nextId = 1;
  vi.mocked(getDb).mockReturnValue(fakeDb() as never);
});

// ── Стирание ────────────────────────────────────────────────────────────────

describe("стирание завершённых разговоров", () => {
  it("тексты уходят, строка о разговоре остаётся", () => {
    // Ровно то, о чём договорились: содержания нет, счёт обращений есть.
    const th = seedThread({ opened_at: daysAgo(20), closed_at: daysAgo(8), closed_by: "platform" });
    seedMessage(daysAgo(19));
    seedMessage(daysAgo(18));

    return purgeClosedThreads(NOW).then(res => {
      expect(res).toEqual({ threads: 1, messages: 2 });
      expect(store.messages).toHaveLength(0);
      expect(store.threads).toHaveLength(1);
      expect(th.message_count).toBe(2);
      expect(th.purged_at).toEqual(NOW);
    });
  });

  it("неделя ещё не вышла — не трогаем", async () => {
    seedThread({ opened_at: daysAgo(10), closed_at: daysAgo(RETENTION_DAYS - 1) });
    seedMessage(daysAgo(9));

    const res = await purgeClosedThreads(NOW);
    expect(res.threads).toBe(0);
    expect(store.messages).toHaveLength(1);
  });

  it("идущий разговор не стирается никогда", async () => {
    // Открытый разговор старше любого срока — и всё равно неприкосновенен:
    // срок отсчитывается от завершения, а его не было.
    seedThread({ opened_at: daysAgo(400), closed_at: null });
    seedMessage(daysAgo(399));

    await purgeClosedThreads(NOW);
    expect(store.messages).toHaveLength(1);
  });

  it("стирают один раз", async () => {
    seedThread({ opened_at: daysAgo(30), closed_at: daysAgo(20), purged_at: daysAgo(13) });
    seedMessage(daysAgo(29));

    const res = await purgeClosedThreads(NOW);
    // Строка уже отмечена стёртой. Возьмись мы за неё снова, счёт сообщений
    // обнулился бы — то есть след разговора испортило бы повторное стирание.
    expect(res.threads).toBe(0);
    expect(store.messages).toHaveLength(1);
  });

  it("удаляется ТОЛЬКО переписка своего разговора", async () => {
    /*
      Самое опасное место. Сообщения привязаны к разговору промежутком времени,
      а не ключом. Съедь граница — и вместе со старым разговором ушёл бы новый,
      идущий прямо сейчас: та же организация, тот же человек.
    */
    seedThread({ opened_at: daysAgo(30), closed_at: daysAgo(20), closed_by: "client" });
    seedThread({ opened_at: daysAgo(2), closed_at: null });

    const oldOne = seedMessage(daysAgo(25));
    const alsoOld = seedMessage(daysAgo(21));
    const fresh = seedMessage(daysAgo(1));

    const res = await purgeClosedThreads(NOW);

    expect(res.messages).toBe(2);
    expect(store.messages.map(m => m.id)).toEqual([fresh.id]);
    expect(store.messages).not.toContainEqual(oldOne);
    expect(store.messages).not.toContainEqual(alsoOld);
  });

  it("чужая организация не задета", async () => {
    seedThread({ tenant_id: 1, opened_at: daysAgo(30), closed_at: daysAgo(20) });
    seedMessage(daysAgo(25), { tenant_id: 2, user_id: 7 });
    seedMessage(daysAgo(25), { tenant_id: 1, user_id: 9 });

    await purgeClosedThreads(NOW);
    // Ни соседняя организация, ни другой человек той же организации.
    expect(store.messages).toHaveLength(2);
  });
});

// ── Закрытие по молчанию ────────────────────────────────────────────────────

describe("разговор закрывается сам", () => {
  it("две недели молчания — закрыт", async () => {
    const th = seedThread({ opened_at: daysAgo(40) });
    seedMessage(daysAgo(SILENCE_DAYS + 1));

    const res = await autoCloseSilent(NOW);
    expect(res.closed).toBe(1);
    expect(th.closed_at).toEqual(NOW);
    expect(th.closed_by).toBe("silence");
  });

  it("вчера писали — не трогаем", async () => {
    const th = seedThread({ opened_at: daysAgo(40) });
    seedMessage(daysAgo(1));

    await autoCloseSilent(NOW);
    expect(th.closed_at).toBeNull();
  });

  it("разговор без сообщений меряется по своему началу", async () => {
    // Иначе он остался бы открытым навсегда именно потому, что в нём пусто.
    const empty = seedThread({ opened_at: daysAgo(SILENCE_DAYS + 5) });
    const young = seedThread({ tenant_id: 1, user_id: 8, opened_at: daysAgo(1) });

    await autoCloseSilent(NOW);
    expect(empty.closed_at).toEqual(NOW);
    expect(young.closed_at).toBeNull();
  });

  it("уже закрытый второй раз не закрывается", async () => {
    const th = seedThread({ opened_at: daysAgo(40), closed_at: daysAgo(20), closed_by: "client" });
    const res = await autoCloseSilent(NOW);
    expect(res.closed).toBe(0);
    // Иначе «завершил клиент» подменилось бы на «молчание», и мы перестали бы
    // отличать решённый вопрос от брошенного.
    expect(th.closed_by).toBe("client");
  });
});

// ── Завершение и возврат ────────────────────────────────────────────────────

describe("завершение вручную", () => {
  it("закрываются все открытые строки пары", async () => {
    // Две открытые строки появляются при одновременной отправке. Оставь мы
    // вторую, разговор после нажатия «завершить» остался бы незакрытым.
    const a = seedThread({ opened_at: daysAgo(3) });
    const b = seedThread({ opened_at: daysAgo(2) });

    await closeThread(1, 7, "platform");
    expect(a.closed_at).not.toBeNull();
    expect(b.closed_at).not.toBeNull();
  });

  it("новое сообщение открывает разговор заново и отменяет стирание", async () => {
    const th = seedThread({ opened_at: daysAgo(3), closed_at: daysAgo(1), closed_by: "platform" });

    await ensureOpenThread(1, 7);

    expect(th.closed_at).toBeNull();
    expect(th.closed_by).toBeNull();
    // Строка та же — история разговора не рвётся на две.
    expect(store.threads).toHaveLength(1);
  });

  it("после стирания начинается НОВЫЙ разговор", async () => {
    const old = seedThread({ opened_at: daysAgo(30), closed_at: daysAgo(20), purged_at: daysAgo(13) });

    await ensureOpenThread(1, 7);

    expect(store.threads).toHaveLength(2);
    // Стёртый не воскресает: его след — это законченная запись.
    expect(old.purged_at).not.toBeNull();
    expect(old.closed_at).not.toBeNull();
  });

  it("в идущий разговор ничего не добавляется", async () => {
    seedThread({ opened_at: daysAgo(1) });
    await ensureOpenThread(1, 7);
    expect(store.threads).toHaveLength(1);
  });
});

describe("что видит экран", () => {
  it("у завершённого — дата стирания", async () => {
    const closedAt = daysAgo(2);
    seedThread({ opened_at: daysAgo(5), closed_at: closedAt, closed_by: "client" });

    const state = await threadState(1, 7);
    expect(state.closedBy).toBe("client");
    expect(state.purgeAt).toEqual(new Date(closedAt.getTime() + RETENTION_DAYS * DAY));
  });

  it("у идущего — ничего", async () => {
    seedThread({ opened_at: daysAgo(1) });
    expect(await threadState(1, 7)).toEqual({ closedAt: null, closedBy: null, purgeAt: null });
  });

  it("стёртый разговор — чистый лист, а не «завершённый без сообщений»", async () => {
    /*
      Для человека это не состояние, а пустой экран: можно писать заново.
      Показать «разговор завершён» там, где не осталось ни строчки, значило бы
      объявить состоянием то, чего он не увидит.
    */
    seedThread({ opened_at: daysAgo(30), closed_at: daysAgo(20), purged_at: daysAgo(13) });
    expect(await threadState(1, 7)).toEqual({ closedAt: null, closedBy: null, purgeAt: null });
  });
});
