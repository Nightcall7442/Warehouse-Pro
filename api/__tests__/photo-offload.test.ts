/**
 * Старые фото уезжают из базы в хранилище пачкой, без S3 — ничего не делают.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * До S3 картинки клались в базу data:-строками и остались там: каждая ночная
 * копия, дамп и репетиция восстановления носили их с собой. Новые фото давно
 * в S3; старые — только руками. Теперь — ночью, пачкой, с заменой на адрес
 * по прежнему значению (сменённое за время загрузки фото не затирается).
 *
 * Нарочная поломка: убери `AND … = ${r.value}` из UPDATE в photo-offload.ts —
 * третий тест насчитает затёртое фото.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let s3 = true;
vi.mock("../lib/s3", () => ({ isS3Configured: () => s3 }));
const uploaded: string[] = [];
vi.mock("../lib/photo-upload", () => ({
  isDataImage: (v: unknown) => typeof v === "string" && /^data:image\/\w+;base64,/.test(v),
  uploadBase64ToS3: async (dataUrl: string, folder: string, tenantId: number) => {
    uploaded.push(dataUrl);
    return `https://cdn.test/${folder}/${tenantId}/${uploaded.length}.jpg`;
  },
}));

import { runPhotoOffload } from "../services/photo-offload";
import { MySqlDialect } from "drizzle-orm/mysql-core";

/** Подделка базы: таблицы в памяти; SQL рендерится диалектом drizzle, параметры подставляются. */
function fakeDb(tables: Record<string, Array<Record<string, unknown>>>) {
  const executed: string[] = [];
  const dialect = new MySqlDialect();
  return {
    executed,
    execute: async (q: unknown) => {
      const { sql: raw, params } = dialect.sqlToQuery(q as never);
      let i = 0;
      const sqlText = raw.replace(/\?/g, () => { const v = params[i++]; return typeof v === "number" ? String(v) : `'${String(v)}'`; });
      executed.push(sqlText);
      const table = /FROM `?(\w+)`?|UPDATE `?(\w+)`?/.exec(sqlText);
      const name = table?.[1] ?? table?.[2] ?? "";
      const rows = tables[name] ?? [];
      if (/^\s*SELECT COUNT/.test(sqlText)) return [[{ n: rows.filter(r => Object.values(r).some(v => typeof v === "string" && v.includes("data:image/"))).length }], []];
      if (/^\s*SELECT/.test(sqlText)) {
        const col = /SELECT id, tenant_id, `?(\w+)`? AS value/.exec(sqlText)?.[1] ?? "";
        return [rows.filter(r => String(r[col] ?? "").includes("data:image/")).map(r => ({ id: r.id, tenant_id: r.tenant_id, value: r[col] })), []];
      }
      if (/^\s*UPDATE/.test(sqlText)) {
        const m = /SET `?(\w+)`? = '([^']*)'\s+WHERE id = (\d+)(?:\s+AND `?\w+`? = '([^']*)')?/.exec(sqlText.replace(/\s+/g, " "));
        if (!m) throw new Error("unexpected UPDATE " + sqlText);
        const row = rows.find(r => String(r.id) === m[3]);
        if (row && (m[4] === undefined || row[m[1]] === m[4])) row[m[1]] = m[2];
        return [{ affectedRows: row ? 1 : 0 }, []];
      }
      throw new Error("unexpected " + sqlText);
    },
  };
}

const PNG = "data:image/png;base64,AAAA";
beforeEach(() => { uploaded.length = 0; s3 = true; });

describe("перенос фото", () => {
  it("data:-строки уходят в S3, в базе остаётся адрес; ссылки и пустые не трогает", async () => {
    const tables = {
      products: [{ id: 1, tenant_id: 5, photo_url: PNG }, { id: 2, tenant_id: 5, photo_url: "https://cdn.test/x.jpg" }, { id: 3, tenant_id: 5, photo_url: null }],
      shops: [{ id: 9, tenant_id: 5, photo_url: PNG }],
      daily_plans: [], users: [], visit_reports: [], order_adjustments: [], returns: [],
    };
    const db = fakeDb(tables);
    const r = await runPhotoOffload(db as never, 50);
    expect(r).toEqual({ moved: 2, failed: 0, skipped: null });
    expect(tables.products[0].photo_url).toMatch(/^https:\/\/cdn\.test\/products\/5\//);
    expect(tables.products[1].photo_url).toBe("https://cdn.test/x.jpg");
    expect(tables.shops[0].photo_url).toMatch(/^https:\/\/cdn\.test\/shops\/5\//);
    expect(uploaded).toHaveLength(2);
  });

  it("без S3 — ничего не делает и говорит об этом", async () => {
    s3 = false;
    const db = fakeDb({ products: [{ id: 1, tenant_id: 5, photo_url: PNG }] });
    const r = await runPhotoOffload(db as never);
    expect(r.skipped).toMatch(/S3/);
    expect(db.executed).toHaveLength(0);
    expect(uploaded).toHaveLength(0);
  });

  it("фото, сменённое за время загрузки, не затирается: UPDATE — по прежнему значению", async () => {
    const tables = { products: [{ id: 1, tenant_id: 5, photo_url: PNG }], shops: [], daily_plans: [], users: [], visit_reports: [], order_adjustments: [], returns: [] };
    const db = fakeDb(tables);
    // пока грузилось — карточку переписали новой картинкой
    const orig = db.execute;
    let swapped = false;
    db.execute = async (q: unknown) => {
      const out = await orig(q);
      if (!swapped && /SELECT id, tenant_id, `photo_url` AS value FROM `products`/.test(db.executed.at(-1) ?? "")) { swapped = true; tables.products[0].photo_url = "data:image/png;base64,NEW="; }
      return out;
    };
    await runPhotoOffload(db as never, 50);
    expect(tables.products[0].photo_url).toBe("data:image/png;base64,NEW=");
  });

  it("списки json: каждая data:-строка заменяется адресом, чужие ссылки остаются", async () => {
    const tables = { products: [], shops: [], daily_plans: [], users: [], visit_reports: [{ id: 4, tenant_id: 5, photos: [PNG, "https://cdn.test/old.jpg"] }], order_adjustments: [], returns: [] };
    const db = fakeDb(tables);
    // SELECT по json ищет по CAST … LIKE — подделка смотрит на строку json
    tables.visit_reports[0].photos = JSON.stringify(tables.visit_reports[0].photos) as never;
    const r = await runPhotoOffload(db as never, 50);
    expect(r.moved).toBe(1);
    const saved = JSON.parse(String(tables.visit_reports[0].photos)) as string[];
    expect(saved[0]).toMatch(/^https:\/\/cdn\.test\/visits\/5\//);
    expect(saved[1]).toBe("https://cdn.test/old.jpg");
  });
});
