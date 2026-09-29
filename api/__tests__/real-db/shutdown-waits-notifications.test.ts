/**
 * Уведомления о заказе, оформленном в секунду выкладки, доходят.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Остановка ждала запросы в полёте, но уведомления о новом заказе — колокольчик,
 * push по ролям, Telegram — уходят ПОСЛЕ ответа (`void notifyAboutNewOrder`).
 * Ответ ушёл — запросов в полёте ноль, и остановка сразу закрывала пул и
 * выходила. Отправка в Expo и Telegram, шедшая в эту секунду, обрывалась:
 * заказ записан, а офис о нём не узнал. Так же — push и Telegram о доставке,
 * о смене статуса, запись в журнал обмена.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * На настоящей MySQL и настоящем http-сервере: заказ оформлен, ответ ушёл,
 * пришёл SIGTERM, а push по ролям ещё идёт (задержан нарочно). Пул не
 * закрывается, пока push и Telegram не ушли; колокольчик директора записан.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { users } from "@db/schema";

const { events, pushHeld, releasePush } = vi.hoisted(() => {
  let release!: () => void;
  const held = new Promise<void>(r => { release = r; });
  return { events: [] as string[], pushHeld: held, releasePush: () => release() };
});

// Expo и Telegram — снаружи; здесь важно только, что отправка идёт, когда приходит сигнал.
vi.mock("../../services/push-service", () => ({
  sendPushToRole: vi.fn(async () => { await pushHeld; }),
  sendPushToUser: vi.fn(async () => {}),
}));
vi.mock("../../services/telegram-notify", () => ({
  notifyEvent: vi.fn(async () => { events.push("telegram-sent"); return { sent: 1, queued: 0 }; }),
}));

import { OrderService } from "../../services/order";
import { gracefulShutdown } from "../../lib/graceful-shutdown";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, TEST_DATABASE_URL,
  type ServiceDb, type Seeded,
} from "./harness";

const describeIf = hasRealDb ? describe : describe.skip;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describeIf("остановка ждёт уведомления о заказе", () => {
  let db: ServiceDb;
  let s: Seeded;
  let ceoId: number;

  beforeAll(async () => {
    db = await connectRealDb();
    await truncateAll();
    s = await seed("10.000");
    const [ceo] = await db.insert(users).values({
      tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo",
    });
    ceoId = Number(ceo.insertId);
  });
  afterAll(async () => { await closeRealDb(); });

  it("ответ ушёл, push ещё идёт — пул закрывается только после push и Telegram", async () => {
    const app = new Hono();
    app.post("/order", async (c) => {
      const { id } = await OrderService.create(db, s.tenantId, s.agentId, {
        shopId: s.shopId, items: [{ productId: s.productId, quantity: "2" }], idempotencyKey: "deploy-notify-1",
      });
      return c.json({ id });
    });
    const server = await new Promise<Server>(r => {
      const srv = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => r(srv as Server));
    });
    const port = (server.address() as AddressInfo).port;
    const shutdown = gracefulShutdown(server, {
      timeoutMs: 5_000,
      stopIntake: () => {},
      busyJobs: () => 0,
      cleanup: async () => { events.push("pool-closed"); await closeRealDb(); },
      exit: (code) => { events.push(`exit:${code}`); },
    });

    const res = await fetch(`http://127.0.0.1:${port}/order`, { method: "POST" });
    expect(res.status).toBe(200);
    const { id } = await res.json() as { id: number };

    // Ответ получен, запросов в полёте нет — а push по ролям ещё не ушёл.
    const done = shutdown("SIGTERM");
    await sleep(300);
    expect(events).toEqual([]);

    releasePush();
    await done;
    expect(events).toEqual(["telegram-sent", "pool-closed", "exit:0"]);

    // Пул приложения закрыт — колокольчик сверяем отдельным соединением.
    const check = await mysql.createConnection(TEST_DATABASE_URL);
    try {
      const [rows] = await check.query(
        "SELECT title, link FROM notifications WHERE user_id = ? AND tenant_id = ?", [ceoId, s.tenantId],
      ) as unknown as [Array<{ title: string; link: string }>];
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toMatch(/^Новый заказ /);
      expect(rows[0].link).toBe(`/orders/${id}`);
    } finally {
      await check.end();
      server.closeAllConnections();
      server.close();
    }
  });
});
