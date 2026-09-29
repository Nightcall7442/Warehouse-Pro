/**
 * Заказ, оформляемый в секунду выкладки, записывается целиком.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * По SIGTERM пул базы закрывался сразу. Заказ, шедший через сервер в эту
 * секунду, упирался в закрытый пул: оформление падало, агент видел ошибку, а
 * выкладок около семи в день, в рабочее время. На заглушке этого не увидеть —
 * у неё нет пула. И отдельно: сам mysql2 при pool.end() ждёт запрос, который
 * ещё выполняется в базе, — после истечения срока такое закрытие держало бы
 * процесс до SIGKILL.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * На настоящей MySQL и настоящем http-сервере: заказ, пришедший до сигнала и
 * дошедший до базы после него, оформлен — ответ 200, строка заказа есть, резерв
 * на складе стоит; пул закрыт только после этого. И: запрос, висящий в базе
 * дольше срока, не держит выход — закрытие обрывается по своему пределу, а пул
 * mysql2 действительно ждёт такой запрос (ради этого предел и стоит).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { OrderService } from "../../services/order";
import { gracefulShutdown } from "../../lib/graceful-shutdown";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, TEST_DATABASE_URL,
  type ServiceDb, type Seeded,
} from "./harness";

const describeIf = hasRealDb ? describe : describe.skip;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function listen(app: Hono): Promise<{ server: Server; port: number }> {
  const server = await new Promise<Server>(r => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => r(s as Server));
  });
  return { server, port: (server.address() as AddressInfo).port };
}

describeIf("остановка при выкладке на настоящей базе", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); await truncateAll(); s = await seed("10.000"); });
  afterAll(async () => { await closeRealDb(); });

  it("заказ в полёте оформлен целиком, и только потом закрывается пул", async () => {
    const events: string[] = [];
    let open!: () => void;
    const gate = new Promise<void>(r => { open = r; });
    let markEntered!: () => void;
    const entered = new Promise<void>(r => { markEntered = r; });

    const app = new Hono();
    app.post("/order", async (c) => {
      markEntered();
      await gate; // заказ пришёл до сигнала, а до базы дошёл уже после
      const { id } = await OrderService.create(db, s.tenantId, s.agentId, {
        shopId: s.shopId, items: [{ productId: s.productId, quantity: "3" }], idempotencyKey: "deploy-1",
      });
      return c.json({ id });
    });
    const { server, port } = await listen(app);
    const shutdown = gracefulShutdown(server, {
      timeoutMs: 5_000,
      stopIntake: () => {},
      busyJobs: () => 0,
      cleanup: async () => { events.push("pool-closed"); await closeRealDb(); },
      exit: (code) => { events.push(`exit:${code}`); },
    });

    const answer = fetch(`http://127.0.0.1:${port}/order`, { method: "POST" });
    await entered;
    const done = shutdown("SIGTERM");
    await sleep(200);
    expect(events).toEqual([]);

    open();
    const res = await answer;
    expect(res.status).toBe(200);
    const { id } = await res.json() as { id: number };
    await done;
    expect(events).toEqual(["pool-closed", "exit:0"]);

    // Пул приложения закрыт — сверяем отдельным соединением.
    const check = await mysql.createConnection(TEST_DATABASE_URL);
    try {
      const [orders] = await check.query("SELECT id FROM orders WHERE id = ?", [id]) as unknown as [Array<{ id: number }>];
      expect(orders).toHaveLength(1);
      const [stock] = await check.query(
        "SELECT reserved FROM warehouse_stock WHERE product_id = ? AND warehouse_id = ?", [s.productId, s.warehouseId],
      ) as unknown as [Array<{ reserved: string }>];
      expect(Number(stock[0].reserved)).toBe(3);
    } finally {
      await check.end();
    }
  });

  it("запрос, висящий в базе дольше срока, не держит выход: закрытие обрывается по пределу", async () => {
    const events: string[] = [];
    const pool = mysql.createPool({ uri: TEST_DATABASE_URL, connectionLimit: 2 });
    let markEntered!: () => void;
    const entered = new Promise<void>(r => { markEntered = r; });

    const app = new Hono();
    app.get("/report", async (c) => {
      markEntered();
      await pool.query("SELECT SLEEP(3)");
      return c.text("отчёт");
    });
    const { server, port } = await listen(app);
    const shutdown = gracefulShutdown(server, {
      timeoutMs: 400,
      stopIntake: () => {},
      busyJobs: () => 0,
      cleanup: async () => { await pool.end(); events.push("pool-closed"); },
      exit: (code) => { events.push(`exit:${code}`); },
    });

    const answer = fetch(`http://127.0.0.1:${port}/report`).then(r => r.text(), () => "оборван");
    await entered;
    await sleep(100); // запрос ушёл в базу

    const t0 = Date.now();
    await shutdown("SIGTERM");
    expect(Date.now() - t0).toBeLessThan(1_500); // 400 мс ожидания + 100 мс закрытия, а не три секунды SLEEP
    expect(events).toEqual(["exit:0"]);
    expect(await answer).toBe("оборван");

    // Пул и правда ждал запрос в базе — закрылся, только когда SLEEP кончился.
    await vi.waitFor(() => expect(events).toEqual(["exit:0", "pool-closed"]), { timeout: 5_000, interval: 100 });
  });
});
