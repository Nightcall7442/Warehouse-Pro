/**
 * Уведомление должно ДОЙТИ, а не просто записаться.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * В NotificationService есть create и createBulk. Они делают три вещи: пишут
 * строку, шлют живое событие и сбрасывают кеш счётчика непрочитанного. Ни одна
 * из них не вызывалась НИОТКУДА: все девять мест, порождающих уведомления,
 * вставляли строку в таблицу напрямую.
 *
 * Строка при этом появлялась — и на этом всё. Живого события нет, значит
 * колокольчик не шевелится. Кеш счётчика живёт тридцать секунд и сбрасывается
 * только на «прочитано», значит и опрос раз в тридцать секунд возвращал старое
 * число. Человек узнавал о новом заказе, когда сам заходил на страницу.
 *
 * Хуже того: три места слали событие руками, а кеш всё равно не трогали. Значок
 * подскакивал на единицу, а следующий опрос возвращал прежнее число из кеша и
 * откатывал его обратно.
 *
 * ── Отсюда проверки ─────────────────────────────────────────────────────────
 *
 * Первая — на исходники: прямых вставок в таблицу быть не должно. Она и держит
 * всё остальное: без неё десятое место, добавленное завтра, снова обойдёт
 * службу, и разбираться будем по жалобе «уведомления не приходят».
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});
vi.mock("../queries/connection", () => ({ getDb: vi.fn() }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const emitted: Array<Record<string, unknown>> = [];
vi.mock("../lib/sse", () => ({ sseBus: { emit: (e: Record<string, unknown>) => { emitted.push(e); } } }));

const invalidated: string[] = [];
vi.mock("../lib/cache", () => ({
  cache: { get: () => undefined, set: () => {}, invalidatePrefix: (p: string) => { invalidated.push(p); } },
  withCache: async (_k: string, _t: number, produce: () => unknown) => produce(),
  CacheKeys: { smartAlerts: (t: number, u: number) => `sa:${t}:${u}` },
  CacheTTL: { alerts: 60 },
}));

import { NotificationService } from "../services/NotificationService";

// ── 1. Никто не пишет в таблицу мимо службы ─────────────────────────────────

const API = join(__dirname, "..");

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, found);
    else if (entry.endsWith(".ts")) found.push(full);
  }
  return found;
}

describe("уведомления рождаются в одном месте", () => {
  it("никто не вставляет строки в notifications мимо службы", () => {
    /*
      Прямая вставка выглядит безобидно и работает: строка появляется, на
      странице она видна. Не появляется только то, ради чего уведомление и
      существует, — сигнал о нём. Отличить одно от другого по коду вставки
      нельзя, поэтому запрещаем саму вставку.
    */
    const offenders = sources(API)
      .filter(f => !f.endsWith(join("services", "NotificationService.ts")))
      .filter(f => /\.insert\(\s*notifications\s*\)/.test(readFileSync(f, "utf8")))
      .map(f => f.slice(API.length + 1));

    expect(offenders).toEqual([]);
  });

  it("служба по-прежнему умеет писать сама", () => {
    // Иначе предыдущая проверка проходила бы и на коде, где писать некому.
    const src = readFileSync(join(API, "services", "NotificationService.ts"), "utf8");
    expect(/\.insert\(\s*notifications\s*\)/.test(src)).toBe(true);
  });
});

// ── 2. Служба делает все три вещи ───────────────────────────────────────────

function fakeDb() {
  return {
    insert: () => ({ values: () => Promise.resolve([{ insertId: 42 }]) }),
  };
}

beforeEach(async () => {
  emitted.length = 0;
  invalidated.length = 0;
  const { getDb } = await import("../queries/connection");
  vi.mocked(getDb).mockReturnValue(fakeDb() as never);
});

describe("что делает служба", () => {
  const db = fakeDb() as never;

  it("одно уведомление: строка, событие и сброс кеша счётчика", async () => {
    await NotificationService.create(db, {
      tenantId: 1, userId: 7, type: "order",
      title: "Новый заказ", message: "Магазин — 100 сум", link: "/orders/5",
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: "notification.new", tenantId: 1, userId: 7 });
    // Без сброса кеша опрос через тридцать секунд вернул бы прежнее число и
    // откатил значок обратно.
    expect(invalidated).toContain("notif_unread:1:7");
  });

  it("пачка: событие и сброс кеша КАЖДОМУ получателю", async () => {
    /*
      Уведомление всем операторам разом — самый частый случай. Событие нельзя
      отправить одно на всех: рассылка адресная, и получи его только первый,
      остальные узнали бы о заказе на следующем заходе на страницу.
    */
    await NotificationService.createBulk(db, {
      tenantId: 1, userIds: [7, 8, 9], type: "order", title: "Новый заказ",
    });

    expect(emitted.map(e => e.userId)).toEqual([7, 8, 9]);
    expect(invalidated).toEqual(["notif_unread:1:7", "notif_unread:1:8", "notif_unread:1:9"]);
  });

  it("пустой список получателей не порождает ничего", async () => {
    await NotificationService.createBulk(db, { tenantId: 1, userIds: [], type: "order", title: "Никому" });
    expect(emitted).toHaveLength(0);
  });

  it("падение записи не роняет то, что её вызвало", async () => {
    // Уведомление — следствие действия, а не его часть. Заказ обязан создаться
    // даже если уведомить о нём не вышло.
    const broken = { insert: () => ({ values: () => Promise.reject(new Error("база легла")) }) } as never;
    await expect(NotificationService.create(broken, {
      tenantId: 1, userId: 7, type: "order", title: "Новый заказ",
    })).resolves.toBeUndefined();
    expect(emitted).toHaveLength(0);
  });
});
