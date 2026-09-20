import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Уведомления — на языке экрана.
 *
 * До 20.09.2026 сервер записывал одну русскую строку в момент события, и в
 * узбекском интерфейсе «Магазин оплатил 850 000 сум» оставалось последней
 * русской надписью. Теперь каждое событие приходит парой { ru, uz }; сервис
 * кладёт русский в title/message (мобилка и старые записи), узбекский —
 * рядом. Мониторинг суперадмина (alertmanager) остаётся русским по решению
 * владельца — единственное место, где одна строка допустима.
 *
 * Нарочная поломка: в любом месте создания верни `title: "…"` строкой —
 * упадёт «каждое событие»; в NotificationService перестань писать titleUz —
 * упадёт «сервис пишет оба языка».
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__tests__" || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (/\.ts$/.test(e.name)) yield full.split(path.sep).join("/");
  }
}

/** Аргументы вызова от открывающей скобки до парной закрывающей. */
function callArgs(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    const c = src[i];
    if ("({[".includes(c)) depth++;
    else if (")}]".includes(c)) { depth--; if (depth === 0) return src.slice(openParen + 1, i); }
  }
  return src.slice(openParen + 1);
}

/** Значение поля вызова: литерал в аргументах (строка, шаблон, объект до парной скобки) или инициализатор одноимённой const в файле. */
function fieldSource(args: string, src: string, field: string): string | null {
  const m = args.match(new RegExp(`(?:^|[,{\\s])${field}\\s*(:)?`, "m"));
  if (!m) return null;
  let i = m.index! + m[0].length;
  if (!m[1]) return constInit(src, field); // сокращение { title } — одноимённая const
  while (/\s/.test(args[i])) i++;
  const lineEnd = args.indexOf("\n", i) === -1 ? args.length : args.indexOf("\n", i);
  if (args[i] === "{") return args.slice(i, i + callArgs(args, i).length + 2);
  if (args[i] === "\"" || args[i] === "`" || args[i] === "'") return args.slice(i, lineEnd);
  const ident = args.slice(i).match(/^[A-Za-z_$][\w$.]*/);
  return ident ? constInit(src, ident[0].split(".")[0]) : args.slice(i, lineEnd);
}
function constInit(src: string, name: string): string | null {
  const decl = src.match(new RegExp(`const ${name}\\b[^=]*=([\\s\\S]*?);\\n`));
  return decl ? decl[1] : null;
}

// Русский без пары — только мониторинг суперадмина.
const RUSSIAN_ONLY = new Set(["api/webhooks/alertmanager.ts"]);

describe("уведомления на языке экрана", () => {
  it("каждое событие несёт заголовок и текст парой { ru, uz }", () => {
    const bare: string[] = [];
    for (const file of walk("api")) {
      if (RUSSIAN_ONLY.has(file)) continue;
      const src = read(file);
      for (const m of src.matchAll(/NotificationService\.create(?:Bulk)?\(/g)) {
        const args = callArgs(src, m.index! + m[0].length - 1);
        for (const field of ["title", "message"]) {
          const value = fieldSource(args, src, field);
          if (value === null) { if (field === "title") bare.push(`${file}: title не найден`); continue; }
          if (!/\bru\s*:/.test(value) || !/\buz\s*:/.test(value)) bare.push(`${file}: ${field} без пары { ru, uz }`);
        }
      }
    }
    expect(bare, bare.join("\n")).toEqual([]);
  });

  it("сервис пишет оба языка в базу и в SSE; одна строка — русский без узбекского", async () => {
    vi.resetModules();
    const inserted: Record<string, unknown>[] = [];
    const db = { insert: () => ({ values: async (v: Record<string, unknown> | Record<string, unknown>[]) => { inserted.push(...(Array.isArray(v) ? v : [v])); return [{ insertId: 7 }]; } }) };
    const emitted: Array<{ data: Record<string, unknown> }> = [];
    vi.doMock("../lib/sse", () => ({ sseBus: { emit: (e: { data: Record<string, unknown> }) => emitted.push(e) } }));
    const { NotificationService } = await import("../services/NotificationService");

    await NotificationService.create(db as never, { tenantId: 1, userId: 2, type: "order", title: { ru: "Заказ доставлен", uz: "Buyurtma yetkazildi" }, message: { ru: "ORD-1", uz: "ORD-1 uz" } });
    expect(inserted[0]).toMatchObject({ title: "Заказ доставлен", titleUz: "Buyurtma yetkazildi", message: "ORD-1", messageUz: "ORD-1 uz" });
    expect(emitted[0].data).toMatchObject({ title: "Заказ доставлен", titleUz: "Buyurtma yetkazildi" });

    await NotificationService.createBulk(db as never, { tenantId: 1, userIds: [3, 4], type: "stock", title: { ru: "Заканчивается", uz: "Tugayapti" } });
    expect(inserted.slice(1).map(r => [r.userId, r.titleUz])).toEqual([[3, "Tugayapti"], [4, "Tugayapti"]]);

    await NotificationService.create(db as never, { tenantId: 1, userId: 2, type: "system", title: "🔴 тревога", message: "описание" });
    expect(inserted.at(-1)).toMatchObject({ title: "🔴 тревога", titleUz: null, messageUz: null });
    vi.doUnmock("../lib/sse");
  });
});
