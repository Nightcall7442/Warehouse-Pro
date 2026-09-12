/**
 * Службы не импортируют роутеры.
 *
 * Роутер — это транспорт: zod, права, контекст запроса. Служба — правило
 * дела. Когда служба тянет роутер (так было с telegram-router ради одной
 * sendTelegram), правило начинает зависеть от транспорта: тест службы
 * вынужден подделывать весь tRPC-модуль, а круг импортов ждёт своего часа.
 *
 * Нарочная поломка: верни в api/services/leads.ts
 * `import { sendTelegram } from "../telegram-router"` — страж назовёт файл.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const API = join(process.cwd(), "api");
/** Слои, которым роутеры не нужны. Заодно — крон, lib, http и webhooks. */
const LAYERS = ["services", "cron", "lib", "http", "webhooks", "telegram"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.includes("__tests__")) out.push(p);
  }
  return out;
}

const ROUTER_IMPORT = /(?:from\s*|import\()\s*["']\.{1,2}\/(?:[\w/-]+\/)?([\w-]+-router|router)["']/g;

describe("службы не импортируют роутеры", () => {
  const offenders: string[] = [];
  for (const layer of LAYERS) {
    for (const file of walk(join(API, layer))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(ROUTER_IMPORT)) {
        // Мост tRPC обязан знать корневой роутер — это и есть его работа.
        if (file.endsWith(join("http", "trpc-adapter.ts")) && m[1] === "router") continue;
        offenders.push(`${relative(API, file).split(sep).join("/")} → ${m[1]}`);
      }
    }
  }

  it("ни одна служба, крон, lib, http, webhook или telegram не тянет *-router", () => {
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("транспорт Telegram живёт в lib, роутер берёт его оттуда", () => {
    const router = readFileSync(join(API, "telegram-router.ts"), "utf8");
    expect(router).toContain('from "./lib/telegram"');
    expect(router).not.toMatch(/^export async function sendTelegram/m);
    const lib = readFileSync(join(API, "lib", "telegram.ts"), "utf8");
    expect(lib).toMatch(/^export async function sendTelegram/m);
    expect(lib).not.toContain("createRouter");
  });
});
