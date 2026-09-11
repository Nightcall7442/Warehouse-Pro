/**
 * Ни один исходящий вызов не ждёт чужой сервер бесконечно.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Восемь вызовов fetch к Telegram и Expo, клиент S3 и транспорт SMTP шли без
 * предела ожидания. Оформление заказа после commit ждало Telegram и Expo — и
 * в минуты, когда Telegram в Узбекистане замедляется, каждый заказ в поле
 * «висел», агент жал повтор, оператор видел «не проходит». Заказ при этом был
 * уже записан. Крон-работа с зависшим сокетом стояла до перезапуска процесса,
 * а следующие тики молча выходили, не получив замок.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Каждый вызов `fetch(` в серверном коде несёт `signal` внутри СВОИХ скобок.
 * Разбор — по балансу скобок, а не «в соседних N строках»: окно по строкам
 * находит сигнал соседнего запроса и пропускает пропавший (так уже ошибался
 * другой страж, см. память проекта). Клиент S3 объявляет requestHandler с
 * пределами, SMTP-транспорт — connectionTimeout.
 *
 * Нарочная поломка: убери `signal:` из sendMessage в telegram-router.ts —
 * первая проверка называет файл и номер строки.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Текст вызова от `fetch(` до закрывающей скобки того же уровня. */
function callBody(src: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) return src.slice(openIdx, i + 1); }
  }
  return src.slice(openIdx);
}

const lineOf = (src: string, idx: number) => src.slice(0, idx).split("\n").length;

describe("исходящие вызовы с пределом ожидания", () => {
  it("каждый fetch( в api/ несёт signal внутри своих скобок", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const src = readFileSync(file, "utf-8");
      // Слово `fetch(` как вызов: не `safeFetch(`, не `.fetch(` у объекта, не в комментарии.
      const re = /(?<![\w.])fetch\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const body = callBody(src, m.index + "fetch".length);
        if (!/\bsignal\b/.test(body)) {
          offenders.push(`${relative(ROOT, file)}:${lineOf(src, m.index)}`);
        }
      }
    }
    expect(offenders, "fetch без signal (добавьте signal: AbortSignal.timeout(ms))").toEqual([]);
  });

  it("клиент S3 объявляет пределы соединения и запроса", () => {
    const src = readFileSync(join(ROOT, "lib/s3.ts"), "utf-8");
    expect(src).toMatch(/requestHandler:\s*\{[^}]*connectionTimeout[^}]*requestTimeout/);
  });

  it("транспорт SMTP объявляет пределы", () => {
    const src = readFileSync(join(ROOT, "lib/mailer.ts"), "utf-8");
    // Именно боевой транспорт (host: env.smtpHost), а не тестовый ethereal.
    const prod = src.slice(src.indexOf("env.smtpHost"));
    expect(prod).toMatch(/connectionTimeout/);
    expect(prod).toMatch(/socketTimeout/);
  });
});
