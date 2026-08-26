import { describe, it, expect, vi, beforeEach } from "vitest";
import { Errors } from "@contracts/errors";

/**
 * Скачивание резервной копии суперадмином.
 *
 * Выгрузка содержит данные ВСЕХ организаций разом — это самый ценный ответ,
 * какой умеет отдавать сервер. Поэтому проверяется не «работает ли», а «кому
 * отказано»: постороннему, вошедшему пользователю чужой роли, и слишком
 * частому запросу.
 *
 * Отдельно проверяется честность ответа. Заголовки уходят первыми и назад не
 * отзываются, поэтому решение «получилось или нет» обязано быть принято ДО
 * них: сорвавшаяся выгрузка должна прийти ошибкой, а не успешной загрузкой
 * испорченного файла.
 */

const h = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  checkRateLimit: vi.fn(),
  startDump: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("../auth", () => ({ authenticateRequest: h.authenticateRequest }));
vi.mock("../lib/rate-limit", () => ({
  checkRateLimit: h.checkRateLimit,
  rateLimitSubject: () => null,
  getClientIp: () => null,
  checkRateLimitAsync: async () => true,
}));
vi.mock("../services/audit-log", () => ({ recordAudit: h.recordAudit }));
vi.mock("../services/db-dump", () => ({
  startDump: h.startDump,
  DumpUnavailableError: class DumpUnavailableError extends Error {},
}));
vi.mock("../queries/connection", () => ({ getDb: () => ({}) }));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import app from "../boot";
import { Readable } from "node:stream";

const SUPERADMIN = { user: { id: 1, role: "superadmin", name: "Root" }, tenant: { id: 1 } };

function dumpOf(text: string) {
  return { stream: Readable.from([Buffer.from(text)]), filename: "warehouse-pro-2026-08-08.sql.gz" };
}

beforeEach(() => {
  h.authenticateRequest.mockReset();
  h.checkRateLimit.mockReset().mockResolvedValue(true);
  h.startDump.mockReset().mockResolvedValue(dumpOf("dump-bytes"));
  h.recordAudit.mockReset().mockResolvedValue(undefined);
});

const req = () => app.request("/api/admin/backup/download");

describe("скачивание резервной копии", () => {
  it("постороннему — отказ, и выгрузка даже не запускается", async () => {
    // Именно так отказывает настоящий authenticateRequest: своим отказом, а не
    // случайным исключением. Разница теперь значимая — см. следующий тест.
    h.authenticateRequest.mockRejectedValue(Errors.forbidden("Invalid authentication token."));

    const res = await req();

    expect(res.status).toBe(401);
    // Важно именно это: mysqldump не должен стартовать до проверки прав,
    // иначе неавторизованный запрос сможет нагружать базу.
    expect(h.startDump).not.toHaveBeenCalled();
  });

  it("не смогли проверить сессию — 503, а не «войдите заново»", async () => {
    // Отказ по токену и сбой проверки — разные вещи. Раньше сюда сходилось
    // любое исключение, и заминка базы отвечала 401. Для мобильного клиента
    // 401 значит «сотри сессию», поэтому такая ошибка выбрасывала человека из
    // аккаунта на ровном месте. Подробнее — в auth-failure-is-not-logout.
    h.authenticateRequest.mockRejectedValue(
      Object.assign(new Error("Can't add new command when connection is in closed state"),
        { code: "PROTOCOL_CONNECTION_LOST" }));

    const res = await req();

    expect(res.status).toBe(503);
    expect(h.startDump).not.toHaveBeenCalled();
  });

  it("вошедшему, но не суперадмину — отказ", async () => {
    h.authenticateRequest.mockResolvedValue({ user: { id: 7, role: "ceo", name: "Директор" }, tenant: { id: 4 } });

    const res = await req();

    // Директор своей организации не вправе получить данные чужих.
    expect(res.status).toBe(403);
    expect(h.startDump).not.toHaveBeenCalled();
  });

  it("суперадмину — файл, и в журнале остаётся след", async () => {
    h.authenticateRequest.mockResolvedValue(SUPERADMIN);

    const res = await req();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("warehouse-pro-2026-08-08.sql.gz");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("dump-bytes");

    // Кто и когда унёс полную копию базы — это обязано остаться.
    expect(h.recordAudit).toHaveBeenCalledTimes(1);
    expect(h.recordAudit.mock.calls[0][1]).toMatchObject({
      actorId: 1, action: "system.backup_downloaded",
    });
  });

  it("слишком частые запросы отклоняются", async () => {
    h.authenticateRequest.mockResolvedValue(SUPERADMIN);
    h.checkRateLimit.mockResolvedValue(false);

    const res = await req();

    expect(res.status).toBe(429);
    expect(h.startDump).not.toHaveBeenCalled();
  });

  it("сорвавшаяся выгрузка приходит ошибкой, а не пустым файлом", async () => {
    h.authenticateRequest.mockResolvedValue(SUPERADMIN);
    const { DumpUnavailableError } = await import("../services/db-dump");
    h.startDump.mockRejectedValue(new DumpUnavailableError("mysqldump не запустился"));

    const res = await req();

    // Отсутствие mysqldump в образе не должно выглядеть как успешно скачанная
    // резервная копия: человек положит такой файл в архив и узнает правду в
    // худший момент.
    expect(res.status).toBe(500);
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("mysqldump") });
  });

  it("след в журнале появляется до отдачи потока", async () => {
    h.authenticateRequest.mockResolvedValue(SUPERADMIN);
    const order: string[] = [];
    h.recordAudit.mockImplementation(async () => { order.push("audit"); });
    h.startDump.mockImplementation(async () => { order.push("dump"); return dumpOf("x"); });

    await req();

    // Оборвись передача на середине — данные всё равно уже покинули сервер,
    // и запись об этом должна существовать.
    expect(order).toEqual(["dump", "audit"]);
  });
});
