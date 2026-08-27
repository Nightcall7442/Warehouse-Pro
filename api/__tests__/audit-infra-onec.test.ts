import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { EventEmitter } from "node:events";

/**
 * Инфраструктура и 1С: три места, где сбой не виден изнутри системы.
 *
 * Общее у них то, что в поле всё выглядит нормально. Ночной дамп загрузился,
 * заказ «синхронизирован», агент получил ответ сервера. Узнают о последствиях
 * позже и не отсюда: по чужому скачанному бэкапу, по двойному списанию остатков
 * в 1С, по третьему звонку агента в поддержку. Поэтому проверяется не «прошло
 * ли», а что именно ушло наружу — в S3, в 1С и на телефон агента.
 */

// ── Общие двойники ───────────────────────────────────────────────────────────

const { PHOTO_BUCKET } = vi.hoisted(() => ({ PHOTO_BUCKET: "warehouse-pro-uploads" }));

vi.mock("../lib/env", () => ({
  env: {
    isProduction: true,
    databaseUrl: "mysql://wp:secret@db-host:3306/warehouse",
    s3Bucket: PHOTO_BUCKET,
    s3Region: "eu-central-1",
    s3AccessKey: "AKIAEXAMPLE",
    s3SecretKey: "s3-secret",
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => true),
  checkRateLimitAsync: vi.fn(async () => true),
  rateLimitSubject: () => "test",
  getClientIp: () => null,
}));

vi.mock("../lib/metrics", () => ({ record1CSync: vi.fn() }));

vi.mock("../services/onec-status", () => ({
  updateSyncStatus: vi.fn(async () => undefined),
}));

vi.mock("../services/onec-mapper", () => ({
  OneCMapper: {
    getInternalId: vi.fn(),
    getExternalId: vi.fn(),
    upsert: vi.fn(async () => undefined),
    getAll: vi.fn(async () => []),
  },
}));

const bridge = {
  odataQuery: vi.fn(),
  createDocument: vi.fn(),
  postDocument: vi.fn(),
  healthCheck: vi.fn(async () => true),
};
vi.mock("../lib/onec-bridge", () => ({
  getBridge: () => bridge,
  getBridgeForTenant: async () => bridge,
}));

// Поддельная база: заказ и его позиции. Запросы различаются по таблице, а не по
// порядку вызова, — иначе тест начнёт зависеть от того, в каком месте функции
// стоит чтение.
const dbState: {
  order: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
} = { order: [], items: [] };

vi.mock("../queries/connection", () => ({
  getDb: () => ({
    // Для крона резервного копирования: сверка размеров таблиц.
    execute: async () => [[{ count: 7 }], []],
    select: () => ({
      from: (table: unknown) => (table === ordersTable
        ? { where: () => ({ limit: async () => dbState.order }) }
        : { leftJoin: () => ({ where: async () => dbState.items }) }),
    }),
  }),
}));

// Дочерний процесс mysqldump: отдаёт немного байт и завершается успешно.
vi.mock("child_process", () => ({
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter; stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setTimeout(() => {
      child.stdout.emit("data", Buffer.from("-- MySQL dump\nCREATE TABLE users (...);\n"));
      child.emit("close", 0);
    }, 0);
    return child;
  },
}));

// S3: запоминаем ровно то, что ушло бы в бакет.
const putCalls: Array<Record<string, unknown>> = [];
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    async send(command: { input: Record<string, unknown> }) {
      putCalls.push(command.input);
      return {};
    }
  },
  PutObjectCommand: class {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) { this.input = input; }
  },
}));

import { orders as ordersTable } from "@db/schema";
import { OneCMapper } from "../services/onec-mapper";
import { OneCSyncService } from "../services/onec-sync";
import { runBackup } from "../cron/backup";
import { createRouter, publicQuery } from "../middleware";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { TrpcContext } from "../context";

beforeEach(() => {
  putCalls.length = 0;
  dbState.order = [];
  dbState.items = [];
  bridge.createDocument.mockReset().mockResolvedValue({ id: "doc-new" });
  bridge.postDocument.mockReset().mockResolvedValue(undefined);
  vi.mocked(OneCMapper.getExternalId).mockReset().mockResolvedValue(null);
  vi.mocked(OneCMapper.upsert).mockReset().mockResolvedValue(undefined);
});

// ── 1. Ночной дамп базы ──────────────────────────────────────────────────────

describe("ночной дамп базы не лежит рядом с публичными фото", () => {
  const savedBackupBucket = process.env.S3_BACKUP_BUCKET;
  afterAll(() => {
    if (savedBackupBucket === undefined) delete process.env.S3_BACKUP_BUCKET;
    else process.env.S3_BACKUP_BUCKET = savedBackupBucket;
  });

  it("уходит в отдельный приватный бакет, а не в тот, откуда раздаются фото", async () => {
    process.env.S3_BACKUP_BUCKET = "warehouse-pro-backups-private";

    const result = await runBackup();

    expect(result.success).toBe(true);
    expect(putCalls).toHaveLength(1);
    // Адрес бакета с фотографиями уходит клиенту в каждом списке товаров, то
    // есть известен любому пользователю. Дамп всей базы там лежать не должен.
    expect(putCalls[0].Bucket).toBe("warehouse-pro-backups-private");
    expect(putCalls[0].Bucket).not.toBe(PHOTO_BUCKET);
  });

  it("ключ не угадывается по одной дате", async () => {
    delete process.env.S3_BACKUP_BUCKET;

    await runBackup();
    await runBackup();

    const today = new Date().toISOString().split("T")[0];
    const keys = putCalls.map(c => String(c.Key));
    expect(keys).toHaveLength(2);
    // Раньше ключ был ровно таким — и подставлялся в публичный адрес бакета.
    expect(keys[0]).not.toBe(`backups/warehouse-pro-${today}.sql.gz`);
    // Два запуска в один день дают разные ключи: значит, в имени есть то, чего
    // снаружи не знают.
    expect(keys[0]).not.toBe(keys[1]);
    // При этом дамп по-прежнему находится глазами: префикс и дата на месте.
    expect(keys[0].startsWith(`backups/warehouse-pro-${today}-`)).toBe(true);
  });

  it("дамп кладётся зашифрованным", async () => {
    delete process.env.S3_BACKUP_BUCKET;

    await runBackup();

    expect(putCalls[0].ServerSideEncryption).toBe("AES256");
  });
});

// ── 2. Выгрузка заказа в 1С ──────────────────────────────────────────────────

const syncService = new OneCSyncService();

function seedOrder() {
  dbState.order = [{
    id: 1, status: "new", total: "150000.00", orderNumber: "ORD-001",
    shopId: 10, createdAt: new Date("2026-08-26T09:00:00Z"),
  }];
  dbState.items = [
    { productId: 5, quantity: "3.000", unitPrice: "25000.00", unit: "pcs", unitWeight: "1.000" },
    { productId: 6, quantity: "2.000", unitPrice: "37500.00", unit: "pcs", unitWeight: "1.000" },
  ];
}

describe("повторная выгрузка заказа в 1С", () => {
  it("не создаёт второй документ, а только добрасывает проведение", async () => {
    seedOrder();
    vi.mocked(OneCMapper.getExternalId).mockImplementation(async (_db, _tenantId, entityType) => {
      if (entityType === "order") return "doc-already-created";
      if (entityType === "shop") return "shop-uuid";
      return "prod-uuid";
    });

    await syncService.syncOrderTo1C(1, 1);

    // Вторая «Реализация товаров и услуг» на тот же заказ — это двойное
    // списание остатков и двойная выручка в 1С.
    expect(bridge.createDocument).not.toHaveBeenCalled();
    expect(bridge.postDocument).toHaveBeenCalledWith(
      "Document_РеализацияТоваровИУслуг", "doc-already-created",
    );
  });

  it("идентификатор документа сохраняется до проведения — иначе таймаут теряет его", async () => {
    seedOrder();
    vi.mocked(OneCMapper.getExternalId).mockImplementation(async (_db, _tenantId, entityType) => {
      if (entityType === "order") return null;
      if (entityType === "shop") return "shop-uuid";
      return "prod-uuid";
    });
    bridge.createDocument.mockResolvedValue({ id: "doc-777" });
    // Ровно тот сбой, с которого всё начинается: документ в 1С создан, а ответ
    // на проведение не дошёл.
    bridge.postDocument.mockRejectedValue(new Error("socket hang up"));

    await expect(syncService.syncOrderTo1C(1, 1)).rejects.toThrow(/socket hang up/);

    expect(vi.mocked(OneCMapper.upsert)).toHaveBeenCalledWith(
      expect.anything(), 1, "order", "doc-777", 1,
    );
  });

  it("маппинг ищется в пределах своей организации", async () => {
    seedOrder();
    vi.mocked(OneCMapper.getExternalId).mockImplementation(async (_db, _tenantId, entityType) => {
      if (entityType === "order") return "doc-already-created";
      return "any";
    });

    await syncService.syncOrderTo1C(42, 1);

    for (const call of vi.mocked(OneCMapper.getExternalId).mock.calls) {
      expect(call[1]).toBe(42);
    }
  });
});

describe("позиции заказа без маппинга в 1С", () => {
  it("останавливают выгрузку, а не молча выпадают из накладной", async () => {
    seedOrder();
    vi.mocked(OneCMapper.getExternalId).mockImplementation(async (_db, _tenantId, entityType, internalId) => {
      if (entityType === "order") return null;
      if (entityType === "shop") return "shop-uuid";
      // Товар 6 заведён руками в Warehouse Pro и ещё не пришёл из 1С.
      return internalId === 5 ? "prod-uuid-5" : null;
    });

    await expect(syncService.syncOrderTo1C(1, 1)).rejects.toThrow(/не сопоставлен/);

    // Главное: неполной накладной в 1С не появилось вовсе. Раньше туда уходила
    // Реализация на одну позицию и меньшую сумму — и проводилась.
    expect(bridge.createDocument).not.toHaveBeenCalled();
    expect(bridge.postDocument).not.toHaveBeenCalled();
  });

  it("заказ без позиций не превращается в пустой документ", async () => {
    seedOrder();
    dbState.items = [];
    vi.mocked(OneCMapper.getExternalId).mockImplementation(async (_db, _tenantId, entityType) => {
      if (entityType === "order") return null;
      if (entityType === "shop") return "shop-uuid";
      return null;
    });

    await expect(syncService.syncOrderTo1C(1, 1)).rejects.toThrow(/не содержит позиций/);
    expect(bridge.createDocument).not.toHaveBeenCalled();
  });
});

// ── 3. Текст ошибки, который видит агент в поле ──────────────────────────────

/**
 * Форматтер ошибок проверяется через настоящий HTTP-обработчик tRPC: только там
 * он и вызывается. Роутер собирается из тех же createRouter и publicQuery, что
 * и боевые, поэтому это тот самый форматтер, а не его копия.
 */
async function callThrowing(thrown: unknown): Promise<{ message: string; code: number }> {
  const router = createRouter({
    boom: publicQuery.query(() => { throw thrown; }),
  });

  const res = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: new Request("http://localhost/api/trpc/boom"),
    router,
    createContext: ({ req, resHeaders }) => ({
      req, resHeaders, db: {},
    }) as unknown as TrpcContext,
  });

  const body = await res.json() as {
    error: { json?: { message: string; data: { code: number } }; message?: string; data?: { code: number } };
  };
  const payload = body.error.json ?? body.error;
  return { message: String(payload.message), code: Number(payload.data?.code ?? 0) };
}

describe("бизнес-отказ доходит до агента текстом", () => {
  it("«недостаточно товара» не подменяется на «внутреннюю ошибку сервера»", async () => {
    // Именно так это и бросает OrderService: голым Error, потому что tRPC
    // ничего другого от сервисного слоя не требует.
    const { message } = await callThrowing(
      new Error("Недостаточно товара на складе (доступно: 3, запрошено: 10)"),
    );

    expect(message).toBe("Недостаточно товара на складе (доступно: 3, запрошено: 10)");
    expect(message).not.toMatch(/Внутренняя ошибка сервера/);
  });

  it("ошибка драйвера базы остаётся замаскированной, даже если внутри русский текст", async () => {
    // mysql2 подставляет в сообщение сами данные — здесь название магазина.
    const driverError = Object.assign(
      new Error("Duplicate entry 'Магазин №5' for key 'shops.uniq_name'"),
      { code: "ER_DUP_ENTRY", errno: 1062, sqlState: "23000" },
    );

    const { message } = await callThrowing(driverError);

    expect(message).toBe("Внутренняя ошибка сервера. Попробуйте позже.");
  });

  it("ошибка кода остаётся замаскированной", async () => {
    const { message } = await callThrowing(
      new TypeError("Нельзя прочитать свойство id у неопределённого значения"),
    );

    expect(message).toBe("Внутренняя ошибка сервера. Попробуйте позже.");
  });
});
