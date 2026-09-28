/**
 * Выкладка не обрывает запросы на лету.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * По SIGTERM обработчик сразу досылал журнал, закрывал пул базы и выходил, не
 * глядя на запросы в полёте: заказ, отметка курьера, загрузка Excel, шедшие в
 * эту секунду, обрывались — а выкладок около семи в день, в рабочее время.
 * Потоки событий не закрывал никто, расписание не останавливалось. И ждать
 * было некогда: Railway по умолчанию даёт между SIGTERM и SIGKILL ноль секунд.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * На настоящем http-сервере (тот же @hono/node-server, что в бою):
 *   - запрос в полёте доходит до конца, и только потом закрывается пул;
 *   - после сигнала готовность — «нет», новые соединения не принимаются, а
 *     соединение запроса в полёте закрывается сразу за его ответом;
 *   - поток событий закрывается штатно и не держит остановку до конца срока;
 *     поток, открытый уже во время остановки, закрывается сразу;
 *   - идущая работа расписания дожидается так же, как запрос;
 *   - зависший запрос не держит процесс дольше срока: обрыв, пул, выход;
 *   - закрытие, которое не кончается, не держит выход дольше четверти срока;
 *   - второй сигнал не запускает вторую остановку;
 *   - загрузчик подключает всё это, а railway.json даёт время дождаться.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { connect } from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { bootSource } from "./helpers/boot-source";

vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { sseBus, SSEBus } from "../lib/sse";
import { createSSEResponse } from "../sse-router";
import { env } from "../lib/env";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function gate(): { p: Promise<void>; open: () => void } {
  let open!: () => void;
  const p = new Promise<void>(r => { open = r; });
  return { p, open };
}

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) { s.closeAllConnections(); s.close(); }
});

/** Сервер с медленной ручкой и потоком событий; остановка — настоящая, пул и выход — записью. */
async function stand(o: { timeoutMs?: number; busyJobs?: () => number; stopIntake?: () => void; cleanup?: () => Promise<void> } = {}) {
  // Флаг «идёт остановка» живёт в модуле — каждой проверке свой, чистый.
  vi.resetModules();
  const { gracefulShutdown, isDraining } = await import("../lib/graceful-shutdown");
  const { logger } = await import("../lib/logger");

  const events: string[] = [];
  const slow = gate();
  let markEntered!: () => void;
  const entered = new Promise<void>(r => { markEntered = r; });

  const app = new Hono();
  app.get("/slow", async (c) => {
    markEntered();
    await slow.p;
    events.push("slow-answered");
    return c.text("заказ сохранён");
  });
  app.get("/fast", (c) => c.text("быстро"));
  app.get("/events", () => createSSEResponse(1, 1));

  const server = await new Promise<Server>(r => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => r(s as Server));
  });
  servers.push(server);

  const intake = vi.fn(o.stopIntake ?? (() => {}));
  const exit = vi.fn((code: number) => { events.push(`exit:${code}`); });
  const shutdown = gracefulShutdown(server, {
    timeoutMs: o.timeoutMs ?? 5_000,
    stopIntake: intake,
    busyJobs: o.busyJobs ?? (() => 0),
    cleanup: o.cleanup ?? (async () => { events.push("pool-closed"); }),
    exit,
  });
  const port = (server.address() as AddressInfo).port;
  return { port, events, shutdown, isDraining, slow, entered, intake, exit, logger };
}

describe("остановка при выкладке", () => {
  it("запрос в полёте доходит до конца, и только потом закрывается пул", async () => {
    const s = await stand();
    const answer = fetch(`http://127.0.0.1:${s.port}/slow`).then(r => r.text());
    await s.entered;

    const done = s.shutdown("SIGTERM");
    await sleep(200);
    expect(s.events).toEqual([]); // пул открыт, выхода не было — ждём заказ

    s.slow.open();
    expect(await answer).toBe("заказ сохранён");
    await done;
    expect(s.events).toEqual(["slow-answered", "pool-closed", "exit:0"]);
  });

  it("после сигнала: готовность «нет», новых соединений нет, соединение запроса в полёте закрывается за ответом", async () => {
    const s = await stand();
    expect(s.isDraining()).toBe(false);

    const sock = connect(s.port, "127.0.0.1");
    let raw = "";
    sock.setEncoding("utf8");
    sock.on("data", (d: string) => { raw += d; });
    const closed = new Promise(r => sock.on("close", r));
    sock.write("GET /slow HTTP/1.1\r\nHost: stand\r\n\r\n");
    await s.entered;

    const done = s.shutdown("SIGTERM");
    expect(s.isDraining()).toBe(true);
    await expect(fetch(`http://127.0.0.1:${s.port}/fast`)).rejects.toThrow();
    expect(s.events).toEqual([]);

    s.slow.open();
    await closed; // закрыл сервер сам — сразу за ответом, прокси не пришлёт сюда следующий
    await done;
    expect(raw).toMatch(/^HTTP\/1\.1 200/);
    expect(raw).toMatch(/\r\nconnection: close\r\n/i);
    expect(raw).toContain("заказ сохранён");
    expect(s.events).toEqual(["slow-answered", "pool-closed", "exit:0"]);
  });

  it("поток событий закрывается штатно и не держит остановку до конца срока", async () => {
    const s = await stand({ timeoutMs: 10_000, stopIntake: () => sseBus.closeAll() });
    const res = await fetch(`http://127.0.0.1:${s.port}/events`);
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"type":"connected"');

    const t0 = Date.now();
    await s.shutdown("SIGTERM");
    expect(Date.now() - t0).toBeLessThan(3_000);

    // Поток кончился, а не оборвался: чтение доходит до конца без ошибки.
    let done = false;
    while (!done) ({ done } = await reader.read());
    expect(done).toBe(true);
    expect(s.events).toEqual(["pool-closed", "exit:0"]);
  });

  it("поток, открытый уже во время остановки, закрывается сразу — после того, как в него дописан догон", async () => {
    const bus = new SSEBus("stand");
    bus.closeAll();
    const close = vi.fn();
    const controller = { close, enqueue: vi.fn() } as unknown as ReadableStreamDefaultController;
    bus.subscribe(1, 1, controller);
    expect(close).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
    expect(bus.getStats().totalListeners).toBe(0);
  });

  it("идущая работа расписания дожидается так же, как запрос", async () => {
    let jobs = 1;
    const s = await stand({ busyJobs: () => jobs });
    const done = s.shutdown("SIGTERM");
    await sleep(200);
    expect(s.events).toEqual([]);

    s.events.push("backup-finished");
    jobs = 0;
    await done;
    expect(s.events).toEqual(["backup-finished", "pool-closed", "exit:0"]);
  });

  it("зависший запрос не держит процесс дольше срока: обрыв, пул, выход", async () => {
    const s = await stand({ timeoutMs: 300 });
    const answer = fetch(`http://127.0.0.1:${s.port}/slow`).then(r => r.text());
    await s.entered;

    const t0 = Date.now();
    await s.shutdown("SIGTERM");
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(290);
    expect(took).toBeLessThan(2_000);
    await expect(answer).rejects.toThrow();
    expect(s.events).toEqual(["pool-closed", "exit:0"]);
    expect(s.logger.warn).toHaveBeenCalledWith(expect.stringContaining("timeout"), expect.objectContaining({ requests: 1 }));
    s.slow.open();
  });

  it("закрытие, которое не кончается (пул ждёт запрос в базе), не держит выход дольше четверти срока", async () => {
    const s = await stand({ timeoutMs: 400, cleanup: () => new Promise<void>(() => {}) });
    const t0 = Date.now();
    await s.shutdown("SIGTERM");
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(90);
    expect(took).toBeLessThan(2_000);
    expect(s.events).toEqual(["exit:0"]);
    expect(s.logger.error).toHaveBeenCalledWith(expect.stringContaining("did not finish"), { limitMs: 100 });
  });

  it("второй сигнал не запускает вторую остановку", async () => {
    const s = await stand();
    const first = s.shutdown("SIGTERM");
    expect(s.shutdown("SIGTERM")).toBe(first);
    expect(s.shutdown("SIGINT")).toBe(first);
    await first;
    expect(s.intake).toHaveBeenCalledTimes(1);
    expect(s.exit).toHaveBeenCalledTimes(1);
    expect(s.events).toEqual(["pool-closed", "exit:0"]);
  });
});

describe("загрузчик и платформа", () => {
  it("загрузчик подключает остановку, а готовность смотрит на неё раньше базы", () => {
    const boot = bootSource();
    expect(boot).toMatch(/app\.get\("\/health\/ready", async \(c\) => \{\n(?:\s*\/\/.*\n)*\s*if \(isDraining\(\)\) return c\.json\(\{ status: "draining" \}, 503\);/);
    expect(boot).toContain("const shutdown = gracefulShutdown(server as Server, {");
    expect(boot).toContain("stopIntake: () => { scheduler.stopScheduler(); sseBus.closeAll(); },");
    expect(boot).toContain("busyJobs: scheduler.runningJobs,");
    expect(boot).toContain('process.on("SIGTERM", () => void shutdown("SIGTERM"));');
    // Учёт запросов подключается в том же шаге, что и сервер, — до первого запроса.
    expect(boot).toMatch(/const server = serve\([\s\S]{0,900}?\n {2}\}\);\n\n {2}\/\*[\s\S]{0,700}?\*\/\n {2}const shutdown = gracefulShutdown\(/);
  });

  it("railway.json даёт дождаться, и команда запуска не отнимает у образа dumb-init", () => {
    const railway = JSON.parse(readFileSync(resolve(__dirname, "../../railway.json"), "utf8"));
    // Ожидание и четверть срока на закрытие — строго внутри окна до SIGKILL.
    expect(railway.deploy.drainingSeconds * 1000).toBeGreaterThanOrEqual(env.shutdownTimeoutMs * 1.25);
    // startCommand заменяет ENTRYPOINT: node стал бы первым процессом.
    expect(railway.deploy).not.toHaveProperty("startCommand");
    const docker = readFileSync(resolve(__dirname, "../../Dockerfile"), "utf8");
    expect(docker).toContain('ENTRYPOINT ["dumb-init", "--"]');
    expect(docker).toContain('CMD ["node", "dist/boot.js"]');
  });
});
