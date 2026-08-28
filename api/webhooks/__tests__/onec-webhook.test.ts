import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Вставка внутри транзакции — общая на все обработчики, поэтому она вынесена
 * наружу: тестам про повторную оплату нужно заставить её отказать так же, как
 * отказал бы уникальный индекс.
 *
 * Возвращается промис с довеском onDuplicateKeyUpdate: обработчик остатков
 * продолжает цепочку, обработчик платежей просто ждёт результат.
 */
const h = vi.hoisted(() => {
  const okChain = () => {
    const chain = Promise.resolve(undefined) as Promise<unknown> & { onDuplicateKeyUpdate?: unknown };
    chain.onDuplicateKeyUpdate = () => ({ set: () => Promise.resolve(undefined) });
    return chain;
  };
  // Секрет вебхука теперь принадлежит организации: посредник ищет строку
  // onec_config по SHA-256 присланного заголовка и берёт tenantId ИЗ НЕЁ.
  // Поэтому стенду нужен настоящий хеш, а не просто совпадающая строка.
  const SECRET = "test-secret-123";
  // require, а не импорт: эта строка живёт внутри фабрики vi.mock, а vitest
  // поднимает такие фабрики ВЫШЕ всех импортов файла. Импортированное имя
  // здесь ещё не существует — попытка заменить require на импорт роняет
  // набор с «Cannot access __vi_import_0__ before initialization».
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SECRET_HASH = require("crypto").createHash("sha256").update(SECRET).digest("hex");
  return { txInsertValues: vi.fn(okChain), okChain, SECRET, SECRET_HASH };
});

vi.mock("../../queries/connection", () => {
  const mockDb = {
    // Одна строка удовлетворяет всем трём запросам вне транзакции: поиску
    // onec_config по хешу секрета (tenantId, secretHash), поиску склада по
    // умолчанию (id) и старым проверкам магазина (debt). Разделять их по
    // таблицам стенду незачем — важно, что организация приходит из найденной
    // строки, а не из тела запроса.
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { tenantId: 1, secretHash: h.SECRET_HASH, id: 7, debt: "5000" },
          ]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onDuplicateKeyUpdate: vi.fn().mockReturnValue({
          set: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    transaction: vi.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        insert: vi.fn().mockReturnValue({ values: h.txInsertValues }),
        // Пересчёт долга идёт сырым UPDATE. Без него запрос падал бы с
        // TypeError, а обработчик возвращал 500 — что и произошло, когда тест
        // впервые дошёл до настоящей вставки.
        execute: vi.fn().mockResolvedValue(undefined),
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
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      };
      return fn(tx);
    }),
  };
  return { getDb: () => mockDb };
});

vi.mock("../../services/onec-mapper", () => ({
  OneCMapper: {
    getInternalId: vi.fn().mockResolvedValue(null),
    getExternalId: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../lib/env", () => ({
  env: {
    onecWebhookSecret: "test-secret-123",
  },
}));

import app from "../onec";
import { OneCMapper } from "../../services/onec-mapper";

const AUTH_HEADERS = { "Content-Type": "application/json", "X-1C-Secret": "test-secret-123" };

function paymentBody(extra: Record<string, unknown> = {}) {
  return JSON.stringify({ tenantId: 1, shopExternalId: "shop-uuid", amount: 1000, reference: "REF-001", ...extra });
}

describe("1C Webhooks", () => {
  beforeEach(() => {
    h.txInsertValues.mockReset();
    h.txInsertValues.mockImplementation(h.okChain);
  });

  describe("POST /payment", () => {
    it("returns 401 without auth header", async () => {
      const res = await app.request("/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });

    it("returns 400 for missing fields", async () => {
      const res = await app.request("/payment", {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when shop not mapped", async () => {
      vi.mocked(OneCMapper.getInternalId).mockResolvedValueOnce(null);

      const res = await app.request("/payment", {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          tenantId: 1,
          shopExternalId: "shop-uuid",
          amount: 1000,
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toContain("not mapped");
    });

    it("returns 200 for valid payment", async () => {
      vi.mocked(OneCMapper.getInternalId).mockResolvedValueOnce(10);

      const res = await app.request("/payment", {
        method: "POST",
        headers: AUTH_HEADERS,
        body: paymentBody(),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.success).toBe(true);
      // До этой правки тест не доходил до вставки вовсе: проверка «нет ли уже
      // платежа с такой заметкой» на заглушке всегда находила строку, и
      // обработчик отвечал 200 по короткому пути «дубликат». Настоящий путь
      // оплаты не был покрыт ничем.
      expect(h.txInsertValues).toHaveBeenCalledTimes(1);
    });

    it("номер документа 1С уходит в базу как ключ повтора", async () => {
      vi.mocked(OneCMapper.getInternalId).mockResolvedValueOnce(10);

      await app.request("/payment", { method: "POST", headers: AUTH_HEADERS, body: paymentBody() });

      // Без ключа в строке уникальному индексу не на что опереться, и повтор
      // документа записал бы деньги второй раз.
      const [inserted] = h.txInsertValues.mock.calls[0] as unknown[];
      expect(inserted).toMatchObject({ idempotencyKey: "1c:REF-001" });
    });

    it("повторно присланный документ не записывается второй раз", async () => {
      vi.mocked(OneCMapper.getInternalId).mockResolvedValueOnce(10);
      // Так отвечает MySQL, когда уникальный индекс не пускает вторую строку.
      h.txInsertValues.mockImplementationOnce(() =>
        Promise.reject(Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" })));

      const res = await app.request("/payment", { method: "POST", headers: AUTH_HEADERS, body: paymentBody() });

      // 1С получает тот же успех, что и с первого раза: ошибка заставила бы её
      // слать документ снова.
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true, duplicate: true });
    });

    it("без номера документа отказ уникального индекса не выдаётся за принятую оплату", async () => {
      vi.mocked(OneCMapper.getInternalId).mockResolvedValueOnce(10);
      h.txInsertValues.mockImplementationOnce(() =>
        Promise.reject(Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" })));

      const res = await app.request("/payment", {
        method: "POST", headers: AUTH_HEADERS, body: paymentBody({ reference: undefined }),
      });

      // Ключа нет — столбец пуст, конфликтовать нечему. Значит ER_DUP_ENTRY
      // пришёл от какого-то другого индекса, и молчаливый успех скрыл бы
      // непринятую оплату.
      expect(res.status).toBe(500);
    });
  });

  describe("POST /stock", () => {
    it("returns 401 without auth header", async () => {
      const res = await app.request("/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: 1 }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 400 for missing fields", async () => {
      const res = await app.request("/stock", {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({ tenantId: 1 }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when product not mapped", async () => {
      vi.mocked(OneCMapper.getInternalId).mockResolvedValueOnce(null);

      const res = await app.request("/stock", {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          tenantId: 1,
          productExternalId: "prod-uuid",
          quantity: 50,
        }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 200 for valid stock update", async () => {
      vi.mocked(OneCMapper.getInternalId).mockResolvedValueOnce(5);

      const res = await app.request("/stock", {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          tenantId: 1,
          productExternalId: "prod-uuid",
          quantity: 50,
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.success).toBe(true);
    });
  });
});
