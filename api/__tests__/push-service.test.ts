import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Отправка уведомлений на телефоны.
 *
 * ── Что здесь на самом деле опасно ───────────────────────────────────────────
 *
 * Не сама отправка — не дошло одно уведомление, дойдёт следующее. Опасна
 * ОБРАТНАЯ сторона: сервис сам вычищает токены устройств из базы, когда Expo
 * отвечает «такого устройства больше нет». Токен стирается насовсем, и человек
 * перестаёт получать уведомления вообще — до тех пор, пока заново не войдёт в
 * мобильном приложении. Никто ему об этом не сообщит.
 *
 * Значит цена ошибки несимметрична: не удалить мёртвый токен — мелочь, а
 * удалить живой — тихо отключить агента от работы. Поэтому проверяется прежде
 * всего то, КОГДА токен удалять НЕЛЬЗЯ: обрыв связи, невнятный ответ Expo,
 * ошибка не про устройство.
 */

const dbState = vi.hoisted(() => ({
  users: [] as Array<{ id: number; tenantId: number; role: string; status: string; pushToken: string | null }>,
  cleared: [] as number[],
}));

vi.mock("../queries/connection", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => {
          const rows = dbState.users.map(u => ({ id: u.id, pushToken: u.pushToken }));
          const p: any = Promise.resolve(rows);
          p.limit = () => Promise.resolve(rows.slice(0, 1));
          return p;
        },
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: (cond: any) => {
          // Условие — eq(users.id, N); идентификатор лежит в поле val.
          if (v.pushToken === null) dbState.cleared.push(Number(cond?.val ?? cond));
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      }),
    }),
  }),
}));

// eq() возвращает объект с val — стенд читает из него идентификатор.
vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, val: unknown) => ({ __kind: "eq", val }),
  and: (...c: unknown[]) => ({ __kind: "and", c }),
}));

const { sendPushToUser, sendPushToRole, sendPushToTenant } = await import("../services/push-service");

/** Ответ Expo на одиночную отправку. */
const single = (body: unknown) => ({ json: () => Promise.resolve(body) });
/** Ответ Expo на пакет. */
const batch = (tickets: unknown[]) => ({ json: () => Promise.resolve({ data: tickets }) });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  dbState.users = [];
  dbState.cleared = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("уведомление одному человеку", () => {
  beforeEach(() => {
    dbState.users = [{ id: 7, tenantId: 1, role: "agent", status: "active", pushToken: "ExponentPushToken[abc]" }];
  });

  it("без токена не ходит в Expo вовсе", async () => {
    dbState.users = [{ id: 7, tenantId: 1, role: "agent", status: "active", pushToken: null }];
    await sendPushToUser(7, { title: "Т", body: "Б" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbState.cleared).toEqual([]);
  });

  it("успешная отправка токен не трогает", async () => {
    fetchMock.mockResolvedValue(single({ data: { status: "ok", id: "ticket-1" } }));
    await sendPushToUser(7, { title: "Т", body: "Б" });
    expect(dbState.cleared).toEqual([]);
  });

  it("устройство отписалось — токен убирается", async () => {
    // Единственный случай, когда удаление уместно: Expo прямо говорит, что
    // приложение на этом устройстве больше не установлено.
    fetchMock.mockResolvedValue(single({
      data: { status: "error", message: "\"ExponentPushToken[abc]\" is not a registered push notification recipient (DeviceNotRegistered)" },
    }));
    await sendPushToUser(7, { title: "Т", body: "Б" });
    expect(dbState.cleared).toEqual([7]);
  });

  it("обрыв связи с Expo токен НЕ убирает", async () => {
    // Сеть моргнула — устройство при этом никуда не делось. Стереть токен
    // здесь значит отключить человека от уведомлений насовсем из-за минутной
    // недоступности чужого сервиса.
    fetchMock.mockRejectedValue(new Error("fetch failed: ECONNRESET"));
    await sendPushToUser(7, { title: "Т", body: "Б" });
    expect(dbState.cleared).toEqual([]);
  });

  it("невнятный ответ Expo токен НЕ убирает", async () => {
    // Страница-заглушка вместо JSON при аварии на стороне Expo: разбор
    // падает, но об устройстве это не говорит ничего.
    fetchMock.mockResolvedValue({ json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON")) });
    await sendPushToUser(7, { title: "Т", body: "Б" });
    expect(dbState.cleared).toEqual([]);
  });

  it("ошибка Expo не про устройство токен НЕ убирает", async () => {
    fetchMock.mockResolvedValue(single({ data: { status: "error", message: "MessageTooBig" } }));
    await sendPushToUser(7, { title: "Т", body: "Б" });
    expect(dbState.cleared).toEqual([]);
  });
});

describe("уведомление группе", () => {
  it("никто не ходит в Expo, если ни у кого нет токена", async () => {
    dbState.users = [
      { id: 1, tenantId: 1, role: "agent", status: "active", pushToken: null },
      { id: 2, tenantId: 1, role: "agent", status: "active", pushToken: null },
    ];
    await sendPushToRole(1, "agent" as never, { title: "Т", body: "Б" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("убирает токен только у того, чьё устройство отписалось", async () => {
    // Ответ Expo — список в том же порядке, что и запрос. Сдвиг на единицу
    // здесь означал бы, что уведомлений лишается не тот человек.
    dbState.users = [
      { id: 11, tenantId: 1, role: "agent", status: "active", pushToken: "t-11" },
      { id: 12, tenantId: 1, role: "agent", status: "active", pushToken: "t-12" },
      { id: 13, tenantId: 1, role: "agent", status: "active", pushToken: "t-13" },
    ];
    fetchMock.mockResolvedValue(batch([
      { status: "ok" },
      { status: "error", message: "DeviceNotRegistered" },
      { status: "ok" },
    ]));

    await sendPushToRole(1, "agent" as never, { title: "Т", body: "Б" });
    expect(dbState.cleared).toEqual([12]);
  });

  it("больше сотни получателей уходят несколькими пакетами", async () => {
    // Expo принимает до ста сообщений за раз; сто первое молча потерялось бы.
    dbState.users = Array.from({ length: 250 }, (_, i) => ({
      id: i + 1, tenantId: 1, role: "agent", status: "active", pushToken: `t-${i + 1}`,
    }));
    fetchMock.mockResolvedValue(batch([]));

    await sendPushToRole(1, "agent" as never, { title: "Т", body: "Б" });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const firstBatch = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    const lastBatch  = JSON.parse((fetchMock.mock.calls[2][1] as any).body);
    expect(firstBatch).toHaveLength(100);
    expect(lastBatch).toHaveLength(50);
  });

  it("упавший пакет не мешает остальным и никого не отключает", async () => {
    dbState.users = Array.from({ length: 150 }, (_, i) => ({
      id: i + 1, tenantId: 1, role: "agent", status: "active", pushToken: `t-${i + 1}`,
    }));
    fetchMock
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(batch([{ status: "ok" }]));

    await sendPushToRole(1, "agent" as never, { title: "Т", body: "Б" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(dbState.cleared).toEqual([]);
  });

  it("рассылка по организации уходит тем же пакетным путём", async () => {
    dbState.users = [{ id: 21, tenantId: 1, role: "operator", status: "active", pushToken: "t-21" }];
    fetchMock.mockResolvedValue(batch([{ status: "ok" }]));

    await sendPushToTenant(1, { title: "Т", body: "Б" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(sent[0]).toMatchObject({ to: "t-21", title: "Т", body: "Б" });
  });
});
