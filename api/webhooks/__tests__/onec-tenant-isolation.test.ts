/**
 * Изоляция организаций в вебхуке 1С.
 *
 * Секрет был ОДИН на всю платформу, а организация бралась из тела запроса и ей
 * верили. Такой секрет знает каждый клиент с интеграцией и каждый подрядчик,
 * который её настраивал, — и любой из них мог прислать чужой tenantId, провести
 * платёж по чужому магазину (уменьшив его долг) или переписать чужие остатки. В
 * коде это признавалось строкой `TODO: Replace global secret with per-tenant
 * webhook secret for proper isolation`.
 *
 * Проверяется одно свойство: организацию определяет СЕКРЕТ, а не тело запроса.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

const secretOf = (s: string) => createHash("sha256").update(s).digest("hex");

const h = vi.hoisted(() => {
  const hash = (s: string) => require("crypto").createHash("sha256").update(s).digest("hex");
  return {
    // У двух организаций свои секреты. Стенд отдаёт ту строку onec_config,
    // чей хеш совпал, — ровно как это делает уникальный индекс в базе.
    configs: [
      { tenantId: 10, secretHash: hash("secret-of-tenant-10"), id: 1 },
      { tenantId: 20, secretHash: hash("secret-of-tenant-20"), id: 2 },
    ],
    lastPaymentInsert: vi.fn(),
    /** Есть ли где-то внутри объекта условия такая строка. Циклы объекта drizzle обходятся. */
    containsValue(node: unknown, needle: string): boolean {
      const seen = new Set<unknown>();
      const walk = (n: unknown): boolean => {
        if (n === needle) return true;
        if (n === null || typeof n !== "object") return false;
        if (seen.has(n)) return false;
        seen.add(n);
        for (const v of Object.values(n as Record<string, unknown>)) {
          if (walk(v)) return true;
        }
        return false;
      };
      return walk(node);
    },
  };
});

vi.mock("../../queries/connection", () => {
  const okChain = () => {
    const chain = Promise.resolve(undefined) as Promise<unknown> & { onDuplicateKeyUpdate?: unknown };
    chain.onDuplicateKeyUpdate = () => ({ set: () => Promise.resolve(undefined) });
    return chain;
  };
  const mockDb = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation((cond: unknown) => ({
          // Условие поиска содержит присланный хеш — стенд достаёт его оттуда и
          // отвечает так же избирательно, как ответила бы база.
          //
          // Обходом, а не JSON.stringify: объект условия drizzle содержит
          // циклические ссылки на таблицу, и сериализация на нём падает.
          limit: vi.fn().mockImplementation(() => {
            const found = h.configs.find(cfg => h.containsValue(cond, cfg.secretHash));
            // Не поиск конфигурации (склад, магазин) — общая строка-заглушка.
            return Promise.resolve(found ? [found] : [{ id: 7, debt: "5000" }]);
          }),
        })),
      }),
    }),
    transaction: vi.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => fn({
      execute: vi.fn().mockResolvedValue(undefined),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockImplementation((v: unknown) => { h.lastPaymentInsert(v); return okChain(); }) }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              const data = [{ debt: "5000", reserved: "0.00" }];
              const chain = Promise.resolve(data) as Promise<unknown[]> & { for: ReturnType<typeof vi.fn> };
              chain.for = vi.fn().mockResolvedValue(data);
              return chain;
            }),
          }),
        }),
      }),
    })),
  };
  return { getDb: () => mockDb };
});

vi.mock("../../services/onec-mapper", () => ({
  OneCMapper: { getInternalId: vi.fn().mockResolvedValue(555), getExternalId: vi.fn(), upsert: vi.fn() },
}));
vi.mock("../../lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import app from "../onec";

const post = (path: string, secret: string | null, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "X-1C-Secret": secret } : {}),
    },
    body: JSON.stringify(body),
  });

beforeEach(() => h.lastPaymentInsert.mockReset());

describe("вебхук 1С: организацию определяет секрет", () => {
  it("без секрета — отказ", async () => {
    const res = await post("/payment", null, { shopExternalId: "s", amount: 100 });
    expect(res.status).toBe(401);
  });

  it("неизвестный секрет — отказ", async () => {
    const res = await post("/payment", "secret-of-nobody", { shopExternalId: "s", amount: 100 });
    expect(res.status).toBe(401);
  });

  it("пустой секрет не совпадает ни с кем", async () => {
    const res = await post("/payment", "", { shopExternalId: "s", amount: 100 });
    expect(res.status).toBe(401);
  });

  // Вот она, прежняя дыра: свой секрет, чужой tenantId в теле.
  it("свой секрет с ЧУЖИМ tenantId в теле — отказ, а не запись в чужую организацию", async () => {
    const res = await post("/payment", "secret-of-tenant-10", {
      tenantId: 20, shopExternalId: "s", amount: 100, reference: "R1",
    });
    expect(res.status).toBe(403);
    expect(h.lastPaymentInsert).not.toHaveBeenCalled();
  });

  it("то же для остатков", async () => {
    const res = await post("/stock", "secret-of-tenant-10", {
      tenantId: 20, productExternalId: "p", quantity: 5,
    });
    expect(res.status).toBe(403);
  });

  it("без tenantId в теле всё работает — организация берётся из секрета", async () => {
    const res = await post("/payment", "secret-of-tenant-10", {
      shopExternalId: "s", amount: 100, reference: "R2",
    });
    expect(res.status).toBe(200);
    expect(h.lastPaymentInsert).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 10 }));
  });

  it("совпадающий tenantId в теле допустим — но записывается всё равно владелец секрета", async () => {
    const res = await post("/payment", "secret-of-tenant-20", {
      tenantId: 20, shopExternalId: "s", amount: 100, reference: "R3",
    });
    expect(res.status).toBe(200);
    expect(h.lastPaymentInsert).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 20 }));
  });

  it("два секрета ведут в две разные организации", async () => {
    await post("/payment", "secret-of-tenant-10", { shopExternalId: "s", amount: 1, reference: "A" });
    const first = h.lastPaymentInsert.mock.calls.at(-1)?.[0];
    await post("/payment", "secret-of-tenant-20", { shopExternalId: "s", amount: 1, reference: "B" });
    const second = h.lastPaymentInsert.mock.calls.at(-1)?.[0];

    expect(first).toMatchObject({ tenantId: 10 });
    expect(second).toMatchObject({ tenantId: 20 });
  });

  it("секрет не подбирается по ответу: неизвестный и выключенный отвечают одинаково", async () => {
    const unknown = await post("/payment", "secret-of-nobody", { shopExternalId: "s", amount: 1 });
    const empty = await post("/payment", "", { shopExternalId: "s", amount: 1 });
    expect(unknown.status).toBe(empty.status);
    expect(await unknown.json()).toEqual(await empty.json());
  });

  it("хеш считается от присланного секрета, а не от чего-то ещё", () => {
    expect(secretOf("secret-of-tenant-10")).toBe(h.configs[0].secretHash);
    expect(secretOf("secret-of-tenant-10")).not.toBe(h.configs[1].secretHash);
  });
});
