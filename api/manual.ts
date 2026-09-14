import { Hono } from "hono";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { authenticateRequest } from "./auth";
import { isAppError } from "@contracts/errors";

/*
  Руководство дистрибьютора внутри продукта: /manual/ → docs/manual/index.html.

  Руководство платное: владелец платформы выдаёт его организации руками
  (суперадмин → карточка организации, либо /manual в Telegram). Поэтому файлы
  НЕ лежат в public/ — статика отдала бы их любому, — а идут через эту дверь:
  сессия (кука веба или Bearer мобилки) → организация → manual_enabled_at.
  Суперадмин видит всегда.

  Файлы читаются с диска по запросу, без кэша в памяти: снимков полсотни по
  60–120 КБ, а открывают руководство не каждую минуту.
*/
export const MANUAL_DIR = path.resolve(process.cwd(), "docs", "manual");
/** Что может понадобиться читалке. PDF и python-файлы сборки — нет. */
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css; charset=utf-8" };

export function manualEnabledFor(tenant: { manualEnabledAt: Date | null }, role: string): boolean {
  return role === "superadmin" || Boolean(tenant.manualEnabledAt);
}

/** Путь запроса → путь файла внутри docs/manual, либо null, если просятся наружу. */
export function resolveManualFile(reqPath: string, dir = MANUAL_DIR): string | null {
  let rel = decodeURIComponent(reqPath.replace(/^\/manual\/?/, "")) || "index.html";
  if (rel.endsWith("/")) rel += "index.html";
  const ext = path.extname(rel).toLowerCase();
  if (!TYPES[ext]) return null;
  const full = path.resolve(dir, rel);
  // Нормализованный путь обязан остаться внутри папки: «..» и абсолютные — наружу.
  if (full !== dir && !full.startsWith(dir + path.sep)) return null;
  return full;
}

export const manual = new Hono();

manual.get("/manual", (c) => c.redirect("/manual/"));

manual.get("/manual/*", async (c) => {
  let ok: boolean;
  try {
    const auth = await authenticateRequest(new Headers(c.req.raw.headers));
    ok = manualEnabledFor(auth.tenant, auth.user.role);
  } catch (e) {
    if (!isAppError(e)) return c.text("Не удалось проверить сессию", 503);
    // Не вошли — на вход, и после входа обратно сюда.
    return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
  }
  if (!ok) return c.html(FORBIDDEN, 403);

  const file = resolveManualFile(c.req.path);
  if (!file) return c.text("Not Found", 404);
  try {
    const st = await stat(file);
    if (!st.isFile()) return c.text("Not Found", 404);
    const body = await readFile(file);
    c.header("Content-Type", TYPES[path.extname(file).toLowerCase()]);
    // Личное, за сессией: общим кэшам не отдавать; браузеру — на час, снимки не меняются каждый день.
    c.header("Cache-Control", file.endsWith(".html") ? "private, no-cache" : "private, max-age=3600");
    return c.body(body);
  } catch {
    return c.text("Not Found", 404);
  }
});

const FORBIDDEN = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Руководство</title>
<body style="font-family:system-ui,sans-serif;max-width:52ch;margin:80px auto;padding:0 20px;color:#1c1b19;line-height:1.5">
<h1 style="font-size:22px">Руководство не подключено</h1>
<p>Руководство дистрибьютора Warehouse Pro выдаётся организации отдельно. Напишите нам в поддержку из программы — подключим.</p>
<p style="color:#6b665c">Qo'llanma tashkilotga alohida beriladi. Dasturdan qo'llab-quvvatlashga yozing — ulaymiz.</p>
<p><a href="/" style="color:#14636b">← В программу</a></p></body></html>`;
