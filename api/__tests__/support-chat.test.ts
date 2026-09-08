/**
 * Чат поддержки: правила разговора.
 *
 * ── Что появилось ───────────────────────────────────────────────────────────
 *
 * «24/7 поддержка» стояла в списке возможностей тарифа Exclusive на экране
 * оплаты и не была подкреплена ничем: организация платила за прямую линию, а
 * написать могла только на общий адрес почты. Ровно та же беда, что была с
 * телефоном поддержки, который сохранялся в настройках и не показывался ни на
 * одном экране.
 *
 * ── Почему проверки такие ───────────────────────────────────────────────────
 *
 * Цена ошибки здесь — чужая переписка. Разговор ведётся парой (организация,
 * пользователь), и три правила держат его закрытым: идентификаторы берутся из
 * сессии, а не из запроса; отметка «прочитано» принадлежит получателю; тариф
 * спрашивается у базы, а не у сессии. Каждое из них проверяется отдельно.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});
vi.mock("../queries/connection", () => ({ getDb: vi.fn() }));

const emitted: Array<Record<string, unknown>> = [];
vi.mock("../lib/sse", () => ({ sseBus: { emit: (e: Record<string, unknown>) => { emitted.push(e); } } }));

import { getDb } from "../queries/connection";
import { supportMessages } from "@db/schema";
import {
  hasSupportChat, requireSupportChat, postMessage, markRead,
  threadMessages, unreadCount, MAX_BODY,
} from "../services/support-chat";

const SRC = readFileSync(join(__dirname, "..", "support-router.ts"), "utf8");

interface Fixture {
  plan?: string;
  messages?: Array<Record<string, unknown>>;
  count?: number;
}

/** Условия WHERE, разобранные в плоский список меток. */
function flatten(cond: unknown, out: Array<{ kind: string; col: unknown; val?: unknown }> = []) {
  const c = cond as { __kind?: string; conds?: unknown[]; col?: unknown; val?: unknown };
  if (!c || typeof c !== "object") return out;
  if (c.__kind === "and" || c.__kind === "or") { (c.conds ?? []).forEach(x => flatten(x, out)); return out; }
  if (c.__kind) out.push({ kind: c.__kind, col: c.col, val: c.val });
  return out;
}

const updates: Array<{ set: Record<string, unknown>; where: unknown }> = [];

/**
 * Поддельная база под те запросы, что делает служба.
 *
 * Запросы различаются составом выбираемых столбцов — так же, как их различил бы
 * человек, читающий код.
 */
function fakeDb(f: Fixture) {
  let shape = "";
  const chain: Record<string, unknown> = {
    select: vi.fn((cols?: Record<string, unknown>) => {
      const keys = Object.keys(cols ?? {});
      if (keys.length === 1 && keys[0] === "plan") shape = "plan";
      else if (keys.includes("count")) shape = "count";
      else shape = "messages";
      return chain;
    }),
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    groupBy: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    where: vi.fn(() => (shape === "count" ? [{ count: f.count ?? 0 }] : chain)),
    limit: vi.fn(() => {
      if (shape === "plan") return f.plan ? [{ plan: f.plan }] : [];
      return f.messages ?? [];
    }),
    insert: vi.fn(() => ({ values: vi.fn(async () => ({ insertId: 42 })) })),
    update: vi.fn(() => ({
      set: vi.fn((s: Record<string, unknown>) => ({
        where: vi.fn(async (w: unknown) => { updates.push({ set: s, where: w }); }),
      })),
    })),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  emitted.length = 0;
  updates.length = 0;
});

describe("кого пускают в чат", () => {
  it("Exclusive — пускают", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({ plan: "exclusive" }) as never);
    expect(await hasSupportChat(1)).toBe(true);
    await expect(requireSupportChat(1)).resolves.toBeUndefined();
  });

  it("любой другой тариф — отказ с объяснением", async () => {
    for (const plan of ["trial", "basic", "pro"]) {
      vi.mocked(getDb).mockReturnValue(fakeDb({ plan }) as never);
      expect(await hasSupportChat(1)).toBe(false);
      await expect(requireSupportChat(1)).rejects.toMatchObject({
        code: "FORBIDDEN",
        // Человек должен понять, что делать: это не поломка, а тариф.
        message: expect.stringContaining("Exclusive"),
      });
    }
  });

  it("тариф спрашивается у базы, а не у сессии", async () => {
    /*
      Тариф меняют суперадмин, Stripe и крон. Сессия о смене не узнает до
      перевхода, поэтому проверка по ней — это доступ, который забыли отобрать.
    */
    const db = fakeDb({ plan: "exclusive" });
    vi.mocked(getDb).mockReturnValue(db as never);
    await hasSupportChat(7);
    expect(db.select).toHaveBeenCalled();
  });
});

describe("сообщение", () => {
  it("пустое не принимается", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({}) as never);
    await expect(postMessage({ tenantId: 1, userId: 2, fromPlatform: false, authorId: 2, body: "   " }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("длиннее столбца не принимается", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({}) as never);
    // Обрезать чужую жалобу нельзя: лучше отказать сразу, чем молча потерять
    // хвост вопроса.
    await expect(postMessage({ tenantId: 1, userId: 2, fromPlatform: false, authorId: 2, body: "я".repeat(MAX_BODY + 1) }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("ответ поддержки будит именно того, чей это разговор", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({}) as never);
    await postMessage({ tenantId: 3, userId: 9, fromPlatform: true, authorId: 1, body: "Уже смотрим" });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: "support.message", tenantId: 3, userId: 9 });
    /*
      userId обязателен. Событие без него — общее по организации, и тогда агент
      увидел бы, что директору что-то ответили.
    */
    expect(emitted[0].userId).toBe(9);
  });

  it("сообщение пользователя событием не рассылается", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({}) as never);
    await postMessage({ tenantId: 3, userId: 9, fromPlatform: false, authorId: 9, body: "Не грузятся фото" });
    // Поддержка сидит не в этой организации, а рассылка устроена по
    // организациям: разослать это значило бы разбудить не тех.
    expect(emitted).toHaveLength(0);
  });
});

describe("прочитано", () => {
  it("отметка ставится только на сообщения другой стороны", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({}) as never);
    await markRead(1, 2, true);   // пользователь прочитал ответы платформы

    expect(updates).toHaveLength(1);
    const conds = flatten(updates[0].where);
    const side = conds.find(c => c.col === supportMessages.fromPlatform);
    expect(side, "сторона выпала из условия").toBeDefined();
    /*
      Если ставить отметку обеим сторонам сразу, счётчик у поддержки
      обнулялся бы в тот момент, когда человек просто открыл свой экран, —
      и обращение выглядело бы отвеченным, не будучи им.
    */
    expect(side!.val).toBe(true);
    expect(conds.some(c => c.kind === "isNull" && c.col === supportMessages.readAt)).toBe(true);
  });

  it("поддержка отмечает своё прочтение отдельно", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({}) as never);
    await markRead(1, 2, false);
    const side = flatten(updates[0].where).find(c => c.col === supportMessages.fromPlatform);
    expect(side!.val).toBe(false);
  });

  it("непрочитанное считается по стороне", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({ count: 4 }) as never);
    expect(await unreadCount(1, 2, true)).toBe(4);
  });
});

describe("история", () => {
  it("отдаётся от старых к новым", async () => {
    // База возвращает свежие сверху — на экране разговор читается наоборот.
    const rows = [{ id: 3 }, { id: 2 }, { id: 1 }];
    vi.mocked(getDb).mockReturnValue(fakeDb({ messages: rows }) as never);
    const { messages } = await threadMessages(1, 2);
    expect(messages.map(m => m.id)).toEqual([1, 2, 3]);
  });

  it("говорит, есть ли ещё что листать", async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ id: i + 1 }));
    vi.mocked(getDb).mockReturnValue(fakeDb({ messages: many }) as never);
    const { messages, hasMore } = await threadMessages(1, 2);
    expect(hasMore).toBe(true);
    expect(messages).toHaveLength(50);
  });
});

describe("чужой разговор недоступен", () => {
  /**
   * Самое дорогое правило, и проверяется оно по исходнику.
   *
   * Тенантские ручки обязаны брать организацию и пользователя ИЗ СЕССИИ. Стоит
   * одной из них принять их из запроса — любой вошедший подставит чужой номер и
   * прочитает переписку соседа. Поймать это поведением нельзя: тест на «нельзя
   * прочитать чужое» проходит ровно до тех пор, пока такой параметр не появится.
   */
  function procedure(name: string): string {
    const at = SRC.indexOf(`  ${name}:`);
    expect(at, `ручка ${name} пропала`).toBeGreaterThan(0);
    const next = SRC.indexOf("\n  }),", at);
    return SRC.slice(at, next);
  }

  it.each(["thread", "unread", "send", "markRead"])("%s не принимает чужие идентификаторы", (name) => {
    const body = procedure(name);
    expect(body).not.toMatch(/input\.(tenantId|userId)/);
    expect(body).toMatch(/ctx\.tenant\.id/);
  });

  it("сторона платформы закрыта ролью суперадмина", () => {
    for (const name of ["inbox", "threadOf", "reply", "markThreadRead"]) {
      expect(procedure(name)).toContain("superAdminQuery");
    }
  });

  it("ответ платформы тоже проверяет тариф", () => {
    /*
      Организация могла съехать с Exclusive, пока обращение висело
      непрочитанным. Отвечать в чат, которого у неё больше нет, значит писать в
      пустоту — человек ответа не увидит.
    */
    expect(procedure("reply")).toContain("requireSupportChat");
  });
});
