/**
 * Второй канал тревог: AlertManager → приложение → уведомление и push
 * суперадминам. Telegram был единственным каналом и молчал, если сломался
 * бот или чат. Ключ — в адресе; без переменной ручка закрыта.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  admins: [{ id: 1, tenantId: 1 }, { id: 2, tenantId: 1 }],
  create: vi.fn(async () => {}),
  push: vi.fn(async () => {}),
}));

vi.mock("../../queries/connection", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: async () => h.admins }) }) }),
}));
vi.mock("../../services/NotificationService", () => ({ NotificationService: { create: h.create } }));
vi.mock("../../services/push-service", () => ({ sendPushToUser: h.push }));
vi.mock("../../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../lib/env", () => ({ env: { alertmanagerUrl: "https://am.example" } }));

import app from "../alertmanager";

const payload = {
  status: "firing",
  alerts: [
    { status: "firing", labels: { alertname: "КопияБазыУстарела", severity: "critical" }, annotations: { summary: "Копия старше суток", description: "Проверить BACKUP_S3_*" } },
    { status: "resolved", labels: { alertname: "ПриложениеНеОтвечает" }, annotations: { summary: "Приложение не отвечает" } },
  ],
};

const post = (url: string, body: unknown = payload) =>
  app.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  h.create.mockClear(); h.push.mockClear();
  process.env.ALERTMANAGER_WEBHOOK_SECRET = "s3cret-s3cret";
});

describe("вебхук AlertManager", () => {
  it("без переменной — 404, с чужим ключом — 401, ничего не доставляется", async () => {
    delete process.env.ALERTMANAGER_WEBHOOK_SECRET;
    expect((await post("/?secret=s3cret-s3cret")).status).toBe(404);
    process.env.ALERTMANAGER_WEBHOOK_SECRET = "s3cret-s3cret";
    expect((await post("/?secret=wrong")).status).toBe(401);
    expect((await post("/")).status).toBe(401);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("каждому суперадмину — уведомление; push только по горящей", async () => {
    const res = await post("/?secret=s3cret-s3cret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, delivered: 4 });
    // 2 тревоги × 2 админа
    expect(h.create).toHaveBeenCalledTimes(4);
    const calls = h.create.mock.calls as unknown as Array<[unknown, Record<string, unknown>]>;
    expect(calls[0][1]).toMatchObject({ userId: 1, type: "system", title: "🔴 Копия старше суток", message: "Проверить BACKUP_S3_*" });
    expect(calls[2][1]).toMatchObject({ title: "✅ Приложение не отвечает" });
    // push — 2 админа × 1 горящая
    expect(h.push).toHaveBeenCalledTimes(2);
  });

  it("плохой JSON — 400; пустой список — ничего", async () => {
    const bad = await app.request("/?secret=s3cret-s3cret", { method: "POST", body: "{oops" });
    expect(bad.status).toBe(400);
    const empty = await post("/?secret=s3cret-s3cret", { alerts: [] });
    expect(await empty.json()).toEqual({ ok: true, delivered: 0 });
  });
});
