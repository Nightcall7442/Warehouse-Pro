/**
 * Redis замолчал — запросы не ждут.
 *
 * 20.10.2026: Redis стоял в другом регионе, канал через океан терял пакеты,
 * и все запросы процесса стояли в очереди за одним соединением без
 * тайм-аута — от 20 секунд до пяти минут. Программа «зависала» целиком.
 *
 * Здесь настоящий ioredis против сервера, который отвечает на рукопожатие и
 * замолкает. На прежнем клиенте первая же проверка сессии висит, пока
 * сервер молчит, — тест падает по тайм-ауту.
 *
 * Правило — api/lib/redis.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server, type Socket } from "node:net";

const env = vi.hoisted(() => ({ redisUrl: "", redisCommandTimeoutMs: 300 }));
vi.mock("../lib/env", () => ({ env }));
vi.mock("../lib/logger", () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));

/** Сколько команд каждого вида дошло до сервера. */
const seen = new Map<string, number>();
let silent = false;
let connections = 0;
let server: Server;
const sockets = new Set<Socket>();

/** Разбор RESP-массивов строк — ровно то, что шлёт клиент. */
function commands(buf: Buffer): { cmds: string[][]; rest: Buffer } {
  const cmds: string[][] = [];
  let i = 0;
  const line = (from: number) => {
    const end = buf.indexOf("\r\n", from);
    return end < 0 ? null : { text: buf.toString("utf8", from, end), next: end + 2 };
  };
  for (;;) {
    const head = line(i);
    if (!head || head.text[0] !== "*") break;
    const n = Number(head.text.slice(1));
    let at = head.next;
    const args: string[] = [];
    let complete = true;
    for (let k = 0; k < n; k++) {
      const len = line(at);
      if (!len) { complete = false; break; }
      const size = Number(len.text.slice(1));
      if (buf.length < len.next + size + 2) { complete = false; break; }
      args.push(buf.toString("utf8", len.next, len.next + size));
      at = len.next + size + 2;
    }
    if (!complete) break;
    cmds.push(args);
    i = at;
  }
  return { cmds, rest: buf.subarray(i) };
}

function reply(cmd: string[]): string {
  const name = cmd[0].toUpperCase();
  if (name === "INFO") {
    const body = "# Server\r\nredis_version:8.2.0\r\n# Persistence\r\nloading:0\r\n";
    return `$${Buffer.byteLength(body)}\r\n${body}\r\n`;
  }
  if (name === "PING") return "+PONG\r\n";
  if (name === "EXISTS") return ":0\r\n";
  if (name === "GET") return "$-1\r\n";
  return "+OK\r\n";
}

function serve(socket: Socket): void {
  connections++;
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  let buf: Buffer = Buffer.alloc(0);
  socket.on("data", chunk => {
    const parsed = commands(Buffer.concat([buf, chunk]));
    buf = parsed.rest;
    for (const cmd of parsed.cmds) {
      const name = cmd[0].toUpperCase();
      seen.set(name, (seen.get(name) ?? 0) + 1);
      // Рукопожатие отвечаем всегда: молчит канал, а не сервер при входе.
      const handshake = name === "INFO" || name === "CLIENT" || name === "AUTH" || name === "SELECT";
      if (silent && !handshake) continue;
      socket.write(reply(cmd));
    }
  });
  socket.on("error", () => {});
}

describe("Redis замолчал — запросы не ждут", () => {
  beforeAll(async () => {
    server = createServer(serve);
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };
    env.redisUrl = `redis://127.0.0.1:${port}`;
    const { connectRedis } = await import("../lib/redis");
    await connectRedis();
  });

  afterAll(async () => {
    vi.useRealTimers();
    const { disconnectRedis } = await import("../lib/redis");
    await Promise.race([disconnectRedis(), new Promise(r => setTimeout(r, 1_000))]);
    for (const s of sockets) s.destroy();
    await new Promise<void>(r => server.close(() => r()));
  });

  it("пока Redis отвечает — сессию проверяет он", async () => {
    const { isSessionRevoked } = await import("../auth/revocation");
    const { isRedisAvailable } = await import("../lib/redis");
    expect(isRedisAvailable()).toBe(true);
    expect(await isSessionRevoked("jti-ok")).toBe(false);
    expect(seen.get("EXISTS")).toBe(1);
  });

  it("Redis замолчал — проверка сессии отвечает за тайм-аут команды, а не висит", async () => {
    const { isSessionRevoked } = await import("../auth/revocation");
    silent = true;
    const started = Date.now();
    expect(await isSessionRevoked("jti-silent")).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_500);
  }, 4_000);

  it("после тайм-аута Redis полминуты не спрашивают: следующие запросы не ждут вовсе", async () => {
    const { isSessionRevoked } = await import("../auth/revocation");
    const { isRedisAvailable } = await import("../lib/redis");
    expect(isRedisAvailable()).toBe(false);
    const asked = seen.get("EXISTS");
    const started = Date.now();
    for (let i = 0; i < 20; i++) expect(await isSessionRevoked(`jti-bypass-${i}`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(200);
    expect(seen.get("EXISTS"), "во время обхода команды в Redis не шли").toBe(asked);
  });

  it("молчащее соединение рвётся и открывается заново; через полминуты Redis снова в деле", async () => {
    const before = connections;
    silent = false;
    // socketTimeout 5 с: неотвеченная команда — соединение рвётся, клиент открывает новое.
    await vi.waitFor(() => expect(connections).toBeGreaterThan(before), { timeout: 8_000, interval: 100 });
    const { isRedisAvailable } = await import("../lib/redis");
    expect(isRedisAvailable(), "обход ещё не истёк").toBe(false);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31_000);
    await vi.waitFor(() => expect(isRedisAvailable()).toBe(true), { timeout: 3_000, interval: 50 });

    const { isSessionRevoked } = await import("../auth/revocation");
    const asked = seen.get("EXISTS") ?? 0;
    expect(await isSessionRevoked("jti-back")).toBe(false);
    expect(seen.get("EXISTS")).toBe(asked + 1);
  }, 15_000);
});
