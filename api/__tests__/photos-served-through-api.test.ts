/**
 * Фото из хранилища раздаёт сама ручка /api/photos, а не ссылка на бакет.
 *
 * ── Что случилось ────────────────────────────────────────────────────────────
 *
 * Крон photos-to-s3 (с 12.09.2026) ночью переносит фото из базы в хранилище
 * и оставляет в строке прямую ссылку на бакет. photoRef такую ссылку отдавал
 * экрану как есть, карточка товара — тем более (там столбец шёл сырым). Бакет
 * в бою закрыт или публичный домен не тот — и 19.09 владелец увидел вместо
 * фото товаров цветные заглушки: «фото товаров куда они делись?».
 *
 * ── Что теперь ──────────────────────────────────────────────────────────────
 *
 * Ссылка на НАШЕ хранилище наружу не уходит: photoRef отдаёт /api/photos/…,
 * а ручка читает объект своими ключами и отдаёт байты. Открыт бакет или нет —
 * фото есть. Чужая https-ссылка (импорт из Excel) — по-прежнему как есть.
 *
 * Нарочная поломка: верни в photoRef `LIKE 'https://%' THEN photoCol` первой
 * ветвью — упадёт «ссылка на своё хранилище»; в photos.ts убери readObject —
 * упадёт «ручка отдаёт байты».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { products } from "@db/schema";

const OLD = { ...process.env };
beforeEach(() => {
  vi.resetModules();
  process.env.S3_BUCKET = "wp-photos";
  process.env.S3_REGION = "eu-north-1";
  process.env.S3_ACCESS_KEY = "k";
  process.env.S3_SECRET_KEY = "s";
  process.env.S3_ENDPOINT = "https://minio.example";
  process.env.S3_PUBLIC_URL = "https://minio.example/wp-photos";
});
afterEach(() => { process.env = { ...OLD }; vi.doUnmock("../queries/connection"); vi.doUnmock("../auth"); vi.doUnmock("../lib/s3"); });

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("ключ по ссылке", () => {
  it("свой публичный домен и амазоновская форма → ключ; чужая ссылка → null", async () => {
    const { storageKeyOf, storageUrlPrefixes } = await import("../lib/s3");
    expect(storageUrlPrefixes()).toEqual(["https://minio.example/wp-photos/", "https://wp-photos.s3.eu-north-1.amazonaws.com/"]);
    expect(storageKeyOf("https://minio.example/wp-photos/products/7/a.jpg")).toBe("products/7/a.jpg");
    expect(storageKeyOf("https://wp-photos.s3.eu-north-1.amazonaws.com/products/7/a.jpg?x=1")).toBe("products/7/a.jpg");
    expect(storageKeyOf("https://evil.example/products/7/a.jpg")).toBeNull();
    expect(storageKeyOf("https://minio.example/wp-photos/")).toBeNull();
  });
  it("ссылка, записанная при прежних настройках, — тоже своя: по http, без бакета в пути, с бакетом на другом домене", async () => {
    /*
      Второй вечер 19.09.2026: после выкладки #74 заглушки остались. Ручка
      узнавала ссылку только по сегодняшнему S3_PUBLIC_URL, а в базе лежит
      то, что publicUrl построил в ту ночь, когда фото переносили.
    */
    const { storageKeyOf, storageUrlPatterns } = await import("../lib/s3");
    expect(storageKeyOf("http://minio.example/wp-photos/products/7/a.jpg")).toBe("products/7/a.jpg");
    expect(storageKeyOf("https://minio.example/products/7/a.jpg?v=1")).toBe("products/7/a.jpg");
    expect(storageKeyOf("https://cdn.other.example/wp-photos/products/7/a%20b.jpg")).toBe("products/7/a b.jpg");
    expect(storageKeyOf("https://evil.example/products/7/a.jpg")).toBeNull();
    expect(storageKeyOf("not a url")).toBeNull();
    expect(storageUrlPatterns()).toEqual([
      "https://minio.example/wp-photos/%", "https://wp-photos.s3.eu-north-1.amazonaws.com/%",
      "https://minio.example/%", "http://minio.example/%", "%/wp-photos/%",
    ]);
  });
});

describe("photoRef", () => {
  it("ссылка на своё хранилище идёт через ручку, чужая https — как есть, строка данных — через ручку", async () => {
    const { photoRef } = await import("../lib/photo-url");
    const q = new MySqlDialect().sqlToQuery(sql`select ${photoRef("product", products.id, products.photoUrl, products.updatedAt)}`);
    // Порядок ветвей: свои префиксы ДО общего https — иначе бакет уйдёт наружу.
    const ours = q.sql.indexOf("`photo_url` LIKE ? THEN CONCAT(?");
    const any = q.sql.indexOf("LIKE 'https://%' THEN `products`.`photo_url`");
    expect(ours).toBeGreaterThan(0);
    expect(ours).toBeLessThan(any);
    expect(q.params).toEqual(expect.arrayContaining(["/api/photos/product/", "https://minio.example/wp-photos/%", "https://wp-photos.s3.eu-north-1.amazonaws.com/%", "http://minio.example/%", "%/wp-photos/%"]));
    // Строка данных + пять образцов своего хранилища — шесть ленивых ссылок.
    expect((q.sql.match(/CONCAT\(\?, `products`\.`id`, '\?v=', UNIX_TIMESTAMP/g) ?? []).length).toBe(6);
  });
});

describe("ручка /api/photos", () => {
  async function app(photoUrl: string | null, obj: { body: Uint8Array; contentType: string } | null) {
    // Несколько стендов в одной проверке: без сброса второй получил бы ручку первого.
    vi.resetModules();
    vi.doMock("../queries/connection", () => ({ getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ photoUrl }] }) }) }) }) }));
    vi.doMock("../auth", () => ({ authenticateRequest: async () => ({ tenant: { id: 1 }, user: { id: 1 } }) }));
    const real = await vi.importActual<typeof import("../lib/s3")>("../lib/s3");
    const readObject = vi.fn(async () => obj);
    vi.doMock("../lib/s3", () => ({ ...real, readObject }));
    const { default: photos } = await import("../photos");
    return { photos, readObject };
  }

  it("ручка отдаёт байты объекта из своего хранилища, без переадресации на бакет", async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const { photos, readObject } = await app("https://minio.example/wp-photos/products/7/a.jpg", { body: png, contentType: "image/png" });
    const r = await photos.request("/product/7", { headers: { cookie: "wp_session=x" } });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toContain("max-age=604800");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(png);
    expect(readObject).toHaveBeenCalledWith("products/7/a.jpg");
  });

  it("объект не прочёлся своими ключами — последний шанс, переадресация на разрешённый хост; не картинка — 404", async () => {
    const { photos } = await app("https://minio.example/wp-photos/products/7/a.jpg", null);
    const r = await photos.request("/product/7");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://minio.example/wp-photos/products/7/a.jpg");
    const { photos: p2 } = await app("https://minio.example/wp-photos/products/7/a.svg", { body: new Uint8Array([1]), contentType: "image/svg+xml" });
    expect((await p2.request("/product/7")).status).toBe(404);
    // Не прочлось, и хост чужой — 404, наружу не отправляем.
    const { photos: p3 } = await app("https://cdn.other.example/wp-photos/products/7/a.jpg", null);
    expect((await p3.request("/product/7")).status).toBe(404);
  });

  it("ссылка на наш хост в другом бакете — сначала своими ключами, потом переадресация, как раньше", async () => {
    const { photos, readObject } = await app("https://minio.example/other-bucket/a.jpg", null);
    const r = await photos.request("/product/7");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://minio.example/other-bucket/a.jpg");
    expect(readObject).toHaveBeenCalledWith("other-bucket/a.jpg");
  });
});

describe("карточки берут фото той же ссылкой, что и списки", () => {
  it("getById товара и магазина — через photoRef; сырой столбец наружу не уходит", () => {
    const product = read("api/product-router.ts");
    expect(product).toContain('photoUrl: photoRef("product", products.id, products.photoUrl, products.updatedAt),');
    expect(product).not.toMatch(/photoUrl:\s*products\.photoUrl,/);
    const shop = read("api/shop-router.ts");
    expect(shop).toContain('photoUrl: photoRef("shop", shops.id, shops.photoUrl, shops.updatedAt)');
    expect(shop).not.toMatch(/photoUrl:\s*shops\.photoUrl,/);
  });
});
