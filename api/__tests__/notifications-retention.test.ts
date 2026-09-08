/**
 * У уведомлений появился срок хранения.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Таблица только росла. Ни одна запись никогда не удалялась: уведомление о
 * заказе, прочитанное год назад, лежало ровно столько же, сколько сегодняшнее.
 * И растёт при этом самая шумная таблица в базе — строка порождается на каждый
 * заказ, каждый низкий остаток и каждое напоминание о долге, причём отдельная
 * КАЖДОМУ получателю: одно событие у директора с тремя операторами это четыре
 * строки.
 *
 * ── Почему проверка на настоящих строках ────────────────────────────────────
 *
 * Здесь удаляют. Ошибка в границе — это либо стёртое раньше срока, либо
 * таблица, которая по-прежнему растёт вечно, и второе не проявляется ничем,
 * кроме счёта за базу через полгода.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});
vi.mock("../queries/connection", () => ({ getDb: vi.fn() }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/sse", () => ({ sseBus: { emit: () => {} } }));

const invalidated: string[] = [];
vi.mock("../lib/cache", () => ({
  cache: { get: () => undefined, set: () => {}, invalidatePrefix: (p: string) => { invalidated.push(p); } },
  withCache: async (_k: string, _t: number, produce: () => unknown) => produce(),
  CacheKeys: { smartAlerts: (t: number, u: number) => `sa:${t}:${u}` },
  CacheTTL: { alerts: 60 },
}));

import {
  NotificationService, READ_RETENTION_DAYS, UNREAD_RETENTION_DAYS,
} from "../services/NotificationService";

// ── База в памяти ───────────────────────────────────────────────────────────

type Row = { id: number; is_read: boolean; created_at: Date };
let rows: Row[] = [];
let nextId = 1;

const nameOf = (col: unknown) => (col as { name: string }).name;

function match(row: Row, cond: unknown): boolean {
  const c = cond as { __kind?: string; conds?: unknown[]; col?: unknown; val?: unknown };
  if (!c || !c.__kind) return true;
  // У «and» столбца нет — читать имя до разбора вида условия нельзя.
  const v = c.col ? (row as unknown as Record<string, unknown>)[nameOf(c.col)] : undefined;
  switch (c.__kind) {
    case "and": return (c.conds ?? []).every(x => match(row, x));
    case "eq":  return v === c.val;
    case "lt":  return (v as number) < (c.val as number);
    default:    return true;
  }
}

function fakeDb() {
  return {
    delete: () => ({
      where: (cond: unknown) => {
        const doomed = rows.filter(r => match(r, cond));
        rows = rows.filter(r => !match(r, cond));
        // mysql2 отдаёт заголовок ответа первым элементом.
        return Promise.resolve([{ affectedRows: doomed.length }]);
      },
    }),
  };
}

const DAY = 86_400_000;
const NOW = new Date("2026-09-09T03:40:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

function seed(isRead: boolean, ageDays: number): Row {
  const row = { id: nextId++, is_read: isRead, created_at: daysAgo(ageDays) };
  rows.push(row);
  return row;
}

beforeEach(() => {
  rows = [];
  nextId = 1;
  invalidated.length = 0;
});

describe("срок хранения", () => {
  const db = () => fakeDb() as never;

  it("прочитанное живёт месяц", async () => {
    const old = seed(true, READ_RETENTION_DAYS + 1);
    const fresh = seed(true, READ_RETENTION_DAYS - 1);

    const res = await NotificationService.purgeOld(db(), NOW);

    expect(res.read).toBe(1);
    expect(rows.map(r => r.id)).toEqual([fresh.id]);
    expect(rows).not.toContainEqual(old);
  });

  it("непрочитанное живёт три месяца, а не месяц", async () => {
    /*
      Непрочитанное — это незакрытое дело. Стереть его вместе с прочитанным
      значило бы решить за человека, что оно неважно, и молча снять с него
      счётчик.
    */
    const monthOld = seed(false, READ_RETENTION_DAYS + 5);
    const veryOld = seed(false, UNREAD_RETENTION_DAYS + 1);

    const res = await NotificationService.purgeOld(db(), NOW);

    expect(res.unread).toBe(1);
    expect(rows.map(r => r.id)).toEqual([monthOld.id]);
    expect(rows).not.toContainEqual(veryOld);
  });

  it("свежее не трогает вообще", async () => {
    seed(true, 1);
    seed(false, 1);

    const res = await NotificationService.purgeOld(db(), NOW);

    expect(res).toEqual({ read: 0, unread: 0 });
    expect(rows).toHaveLength(2);
  });

  it("границу считает по переданному моменту, а не по часам", async () => {
    // Иначе проверка начала бы падать в другой день, а не при поломке.
    seed(true, READ_RETENTION_DAYS + 1);
    const res = await NotificationService.purgeOld(db(), new Date(NOW.getTime() - 10 * DAY));
    expect(res.read).toBe(0);
  });

  it("сбрасывает кеш счётчика непрочитанного", async () => {
    /*
      Счётчик кешируется на тридцать секунд у каждого отдельно, а уборка идёт
      по всей таблице — кого именно задело, мы не знаем. Без сброса у тех, чьи
      старые непрочитанные стёрты, значок полминуты показывал бы их.
    */
    seed(false, UNREAD_RETENTION_DAYS + 1);
    await NotificationService.purgeOld(db(), NOW);
    expect(invalidated).toContain("notif_unread:");
  });
});
