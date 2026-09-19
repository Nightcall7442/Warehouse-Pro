/**
 * Фото по чужим ссылкам копируются к себе; чужой сайт лёг — ждём ночи.
 *
 * Владелец (19.09.2026): «фото товаров пропали, вчера были». У Serena Trade
 * в photo_url лежали ссылки на cdn.ynamdar.com из прайса поставщика; сайт
 * перестал отвечать — карточки опустели, хотя у нас не менялось ничего.
 *
 * Нарочные поломки: в photo-mirror.ts убери проверку Content-Type — упадёт
 * «не картинка»; убери `AND … = ${r.value}` из UPDATE — упадёт «сменённое не
 * затирается»; убери isPublicHost из isForeignPhotoUrl — упадёт «внутренний
 * хост не запрашивается».
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";

let s3 = true;
vi.mock("../lib/s3", () => ({
  isS3Configured: () => s3,
  storageUrlPatterns: () => ["https://minio.test/wp-photos/%", "https://minio.test/%", "http://minio.test/%", "%/wp-photos/%"],
}));
const uploaded: Array<{ bytes: number; type: string; ext: string; folder: string; tenant: number }> = [];
vi.mock("../lib/photo-upload", () => ({
  uploadImageToS3: async (buf: Buffer, type: string, ext: string, folder: string, tenant: number) => {
    uploaded.push({ bytes: buf.length, type, ext, folder, tenant });
    return `https://minio.test/wp-photos/${folder}/${tenant}/${uploaded.length}.${ext}`;
  },
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { mirrorForeignPhotos, mirrorOne, isForeignPhotoUrl, MAX_BYTES } from "../services/photo-mirror";

/** База в памяти: SQL рендерится диалектом, ссылки отбираются по тем же условиям, что и в бою. */
function fakeDb(tables: Record<string, Array<Record<string, unknown>>>) {
  const executed: string[] = [];
  const dialect = new MySqlDialect();
  const like = (v: string, pattern: string) => new RegExp("^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$").test(v);
  return {
    executed,
    execute: async (q: unknown) => {
      const { sql: raw, params } = dialect.sqlToQuery(q as never);
      let i = 0;
      const text = raw.replace(/\?/g, () => { const v = params[i++]; return typeof v === "number" ? String(v) : `'${String(v)}'`; }).replace(/\s+/g, " ");
      executed.push(text);
      const name = /FROM `?(\w+)`?|UPDATE `?(\w+)`?/.exec(text);
      const rows = tables[name?.[1] ?? name?.[2] ?? ""] ?? [];
      if (/^ ?SELECT/.test(text)) {
        const col = /`?(\w+)`? AS value/.exec(text)![1];
        const nots = [...text.matchAll(/NOT LIKE '([^']*)'/g)].map(m => m[1]);
        return [rows.filter(r => typeof r[col] === "string" && String(r[col]).startsWith("https://") && !nots.some(p => like(String(r[col]), p)))
          .map(r => ({ id: r.id, tenant_id: r.tenant_id, value: r[col] })), []];
      }
      if (/^ ?UPDATE/.test(text)) {
        const m = /SET `?(\w+)`? = '([^']*)' WHERE id = (\d+)(?: AND `?\w+`? = '([^']*)')?/.exec(text);
        if (!m) throw new Error("unexpected UPDATE " + text);
        const row = rows.find(r => String(r.id) === m[3]);
        if (row && (m[4] === undefined || row[m[1]] === m[4])) row[m[1]] = m[2];
        return [{ affectedRows: 1 }, []];
      }
      throw new Error("unexpected " + text);
    },
  };
}

const empty = { shops: [], daily_plans: [], users: [] };
const png = (bytes = 4) => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/png" } });
const fetchOf = (answer: (url: string) => Response | Promise<Response>) => {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request) => { const u = String(input); calls.push(u); return answer(u); }) as unknown as typeof fetch;
  return { f, calls };
};

beforeEach(() => { uploaded.length = 0; s3 = true; });

describe("копия чужих фото", () => {
  it("чужая https-ссылка копируется и заменяется адресом хранилища; своё хранилище, data: и пустые не трогает", async () => {
    const tables = { ...empty, products: [
      { id: 1, tenant_id: 5, photo_url: "https://cdn.ynamdar.com/ynamdar/images/products/a.jpg" },
      { id: 2, tenant_id: 5, photo_url: "https://minio.test/wp-photos/products/5/old.jpg" },
      { id: 3, tenant_id: 5, photo_url: "data:image/png;base64,AAAA" },
      { id: 4, tenant_id: 5, photo_url: null },
    ] };
    const { f, calls } = fetchOf(() => png(10));
    const r = await mirrorForeignPhotos(fakeDb(tables) as never, 50, f);
    expect(r).toEqual({ copied: 1, failed: 0, skipped: null });
    expect(calls).toEqual(["https://cdn.ynamdar.com/ynamdar/images/products/a.jpg"]);
    expect(tables.products[0].photo_url).toBe("https://minio.test/wp-photos/products/5/1.png");
    expect(tables.products[1].photo_url).toBe("https://minio.test/wp-photos/products/5/old.jpg");
    expect(tables.products[2].photo_url).toBe("data:image/png;base64,AAAA");
    expect(uploaded[0]).toMatchObject({ bytes: 10, type: "image/png", ext: "png", folder: "products", tenant: 5 });
  });

  it("чужой сайт лёг — ссылка остаётся как была, отказ посчитан; после трёх отказов хост не дёргается до следующей ночи", async () => {
    const tables = { ...empty, products: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, tenant_id: 5, photo_url: `https://cdn.ynamdar.com/p/${i}.jpg` })) };
    const { f, calls } = fetchOf(() => { throw new Error("connect ECONNREFUSED"); });
    const r = await mirrorForeignPhotos(fakeDb(tables) as never, 50, f);
    expect(r).toEqual({ copied: 0, failed: 6, skipped: null });
    expect(calls).toHaveLength(3);
    expect(tables.products.every(p => String(p.photo_url).startsWith("https://cdn.ynamdar.com/"))).toBe(true);
  });

  it("не картинка, слишком большая или чужой отказ — не копируется", async () => {
    const html = new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
    expect(await mirrorOne("https://a.example/x.jpg", "products", 1, fetchOf(() => html).f)).toBeNull();
    expect(await mirrorOne("https://a.example/x.jpg", "products", 1, fetchOf(() => new Response("", { status: 404 })).f)).toBeNull();
    expect(await mirrorOne("https://a.example/x.jpg", "products", 1, fetchOf(() => png(MAX_BYTES + 1)).f)).toBeNull();
    expect(uploaded).toHaveLength(0);
    expect(await mirrorOne("https://a.example/x.jpg", "products", 1, fetchOf(() => png(8)).f)).toMatch(/^https:\/\/minio\.test\//);
  });

  it("внутренний хост, адрес и http не запрашиваются вовсе", async () => {
    const { f, calls } = fetchOf(() => png());
    for (const u of ["http://cdn.example/a.jpg", "https://10.0.0.5/a.jpg", "https://localhost/a.jpg", "https://minio.railway.internal/a.jpg", "https://[::1]/a.jpg", "not a url"]) {
      expect(isForeignPhotoUrl(u), u).toBe(false);
      expect(await mirrorOne(u, "products", 1, f)).toBeNull();
    }
    expect(calls).toEqual([]);
    expect(isForeignPhotoUrl("https://cdn.ynamdar.com/a.jpg")).toBe(true);
  });

  it("сменённое за время копирования фото не затирается", async () => {
    const tables = { ...empty, products: [{ id: 1, tenant_id: 5, photo_url: "https://cdn.ynamdar.com/a.jpg" }] };
    const db = fakeDb(tables);
    const { f } = fetchOf(async () => { tables.products[0].photo_url = "data:image/png;base64,NEW"; return png(); });
    const r = await mirrorForeignPhotos(db as never, 50, f);
    expect(r.copied).toBe(1);
    expect(tables.products[0].photo_url).toBe("data:image/png;base64,NEW");
    expect(db.executed.find(q => q.startsWith(" UPDATE") || q.startsWith("UPDATE"))).toMatch(/AND `?photo_url`? = 'https:\/\/cdn\.ynamdar\.com\/a\.jpg'/);
  });

  it("без S3 — ничего не делает и говорит об этом", async () => {
    s3 = false;
    const { f, calls } = fetchOf(() => png());
    const r = await mirrorForeignPhotos(fakeDb({ ...empty, products: [{ id: 1, tenant_id: 5, photo_url: "https://cdn.ynamdar.com/a.jpg" }] }) as never, 50, f);
    expect(r.skipped).toMatch(/S3/);
    expect(calls).toEqual([]);
  });
});
