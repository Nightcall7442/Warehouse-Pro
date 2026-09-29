/**
 * Остановка ждёт и то, что запрос оставил после ответа.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Остановка при выкладке считала только запросы в полёте и работы расписания.
 * А уведомления уходят ПОСЛЕ ответа, через `void`: колокольчик и push о новом
 * заказе, Telegram о доставке и о недостаче, письмо с приглашением, запись в
 * журнал обмена. Ответ ушёл — ждать для остановки нечего, пул закрывается,
 * процесс выходит, и отправка, шедшая в эту секунду, обрывается молча.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   - работа, отпущенная через inBackground, задерживает закрытие пула, пока
 *     не кончится, — даже когда запросов в полёте уже нет;
 *   - зависшая работа держит остановку не дольше срока;
 *   - в api/ не осталось отпущенных через голый `void` вызовов, кроме
 *     перечисленных ниже (запуск процесса и служебное) — новый `void notify…`
 *     назовёт этот тест. Настоящий путь заказа — в
 *     real-db/shutdown-waits-notifications.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { gracefulShutdown, inBackground } from "../lib/graceful-shutdown";
import { logger } from "../lib/logger";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function stand(timeoutMs: number) {
  const server: Server = createServer((_req, res) => res.end("ok"));
  const events: string[] = [];
  const shutdown = gracefulShutdown(server, {
    timeoutMs,
    stopIntake: () => {},
    busyJobs: () => 0,
    cleanup: async () => { events.push("pool-closed"); },
    exit: (code) => { events.push(`exit:${code}`); },
  });
  return { events, shutdown };
}

describe("остановка ждёт работу после ответа", () => {
  it("отпущенное через inBackground задерживает закрытие пула, пока не кончится", async () => {
    const s = stand(5_000);
    let finish!: () => void;
    inBackground(new Promise<void>(r => { finish = r; }).then(() => { s.events.push("push-sent"); }));

    const done = s.shutdown("SIGTERM");
    await sleep(200);
    expect(s.events).toEqual([]); // запросов нет, а push ещё идёт — пул открыт

    finish();
    await done;
    expect(s.events).toEqual(["push-sent", "pool-closed", "exit:0"]);
  });

  it("зависшая работа держит остановку не дольше срока", async () => {
    const s = stand(300);
    inBackground(new Promise<void>(() => {}));
    const t0 = Date.now();
    await s.shutdown("SIGTERM");
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(290);
    expect(took).toBeLessThan(2_000);
    expect(s.events).toEqual(["pool-closed", "exit:0"]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("timeout"), expect.objectContaining({ background: 1 }));
  });
});

/** Отпущенные через голый `void` вызовы, которым так и положено: не работа запроса. */
const ALLOWED_VOID: Array<[file: string, starts: string]> = [
  // Необработанное исключение: досылка в Sentry перед выходом с кодом 1.
  ["boot.ts", "void Sentry.flush("],
  // Запуск процесса — не запрос: сообщение о старте, вебхук и меню бота.
  ["boot.ts", 'void import("./telegram-router")'],
  ["boot.ts", 'void import("./telegram/register")'],
  ["boot.ts", 'void import("./telegram/commands")'],
  // Отметки расписания при запуске.
  ["cron/scheduler.ts", "void loadState()"],
  // Сам учёт.
  ["lib/graceful-shutdown.ts", "void p.finally("],
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : sources(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

describe("работу после ответа отпускают через inBackground, а не void", () => {
  const api = join(__dirname, "..");
  const lines = sources(api).flatMap(p => {
    const file = relative(api, p).replace(/\\/g, "/");
    return readFileSync(p, "utf8").split(/\r?\n/).map((text, i) => ({ file, line: i + 1, text: text.trim() }));
  });

  it("голый void — только у перечисленного", () => {
    const bare = lines
      .filter(l => /^void\s+[^;]*\(/.test(l.text))
      .filter(l => !ALLOWED_VOID.some(([f, s]) => l.file === f && l.text.startsWith(s)))
      .map(l => `${l.file}:${l.line}  ${l.text}`);
    expect(bare).toEqual([]);
  });

  it("уведомление не отпускается без void и без inBackground (голый вызов с .catch)", () => {
    const bare = lines
      .filter(l => /^(sendPush\w*|sendEmail|sendInviteEmail|notify\w+|recordExport|answerCallback)\(/.test(l.text))
      // Элемент списка в `await Promise.all([...])` — его ждут.
      .filter(l => !l.text.endsWith(","))
      .map(l => `${l.file}:${l.line}  ${l.text}`);
    expect(bare).toEqual([]);
  });
});
