import { Hono, type Context } from "hono";
import { eq, and } from "drizzle-orm";
import { products, shops } from "@db/schema";
import { getDb } from "./queries/connection";
import { authenticateRequest } from "./auth";
import { isAppError } from "@contracts/errors";
import { SAFE_IMAGE_TYPES } from "./lib/photo-value";

/**
 * Photo delivery for entities whose photo is stored in the database as a base64
 * data URL (the fallback when S3 is not configured — see product.uploadPhoto).
 *
 * List endpoints must not inline those blobs: a page of 25 products carried up
 * to ~12 MB of JSON. They now return a URL pointing here instead, so the photo
 * is fetched lazily, in parallel, and cached by the browser. Photos that are
 * already real S3 URLs are returned as-is by the list and never reach this route.
 */
const photos = new Hono();

const DATA_URL_RE = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/;
const CACHE_HEADER = "private, max-age=604800, immutable";

/**
 * Типы, которые можно отдавать как изображение.
 *
 * Тип брался прямо из сохранённой строки данных, а выражение выше пропускает
 * что угодно вида image/*, включая image/svg+xml. SVG — документ со
 * сценариями: открытый по прямой ссылке с нашего домена, он выполняет их в
 * нашем происхождении, со всеми куками. Внутри тега img он безопасен, но
 * ссылку на фотографию можно открыть и отдельной вкладкой.
 *
 * Список белый, а не чёрный: новый опасный тип не должен проходить сам собой.
 */
// Список живёт в api/lib/photo-value.ts — он же проверяет вход.

/**
 * Куда позволено переадресовывать.
 *
 * Фотография, уже лежащая в хранилище, отдавалась переадресацией на
 * сохранённый адрес — любой. А само поле пишется без проверки формата: в
 * правке магазина оно ограничено только длиной. То есть ручка вида
 * /api/photos/product/123 на нашем домене уводила посетителя куда угодно.
 * Такую ссылку удобно вставлять в письма: она начинается с настоящего адреса
 * системы, и человек ей верит.
 *
 * Разрешён единственный хост — тот, куда выкладываем сами. Не настроено
 * хранилище — переадресации нет вовсе.
 */
function allowedRedirectHost(): string | null {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return null;
  const region = process.env.S3_REGION || "us-east-1";
  return bucket + ".s3." + region + ".amazonaws.com";
}

export function isAllowedPhotoTarget(raw: string): boolean {
  const host = allowedRedirectHost();
  if (!host) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  // Только https и только наш хост. Сравнение точное: ни evil-bucket.s3...,
  // ни bucket.s3.amazonaws.com.evil.com пройти не должны.
  return url.protocol === "https:" && url.hostname === host;
}

async function serve(
  c: Context,
  loader: (tenantId: number, id: number) => Promise<string | null | undefined>,
) {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Not Found" }, 404);

  let tenantId: number;
  try {
    /**
     * Веб приходит с кукой, мобильное — с заголовком Authorization.
     *
     * Приём токена из адреса (?token=) оставлен ВРЕМЕННО и только ради
     * совместимости со старыми сборками приложения. Он опасен: адреса целиком
     * оседают в журналах обращений на каждом узле по дороге — сам сервер,
     * обратный прокси, сеть доставки, кэш, — хранятся дольше сессии и уезжают
     * в системы разбора журналов. А это полный сессионный токен, а не узкий
     * ключ на картинку.
     *
     * Начиная со сборки, где SecureImage передаёт токен заголовком, приложение
     * этим путём не пользуется. КОГДА агенты обновятся — удалить обе строки с
     * query("token") ниже. Понять, что пора, можно по журналу: обращения к
     * /api/photos с параметром token в адресе должны исчезнуть.
     */
    const authHeader = c.req.header("authorization");
    const token = c.req.query("token");
    const headers = new Headers(c.req.raw.headers);
    if (!authHeader && token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    const auth = await authenticateRequest(headers);
    if (!auth.tenant) return c.json({ error: "Unauthorized" }, 401);
    tenantId = auth.tenant.id;
  } catch (e) {
    // Сбой проверки — не то же самое, что негодный токен: 401 здесь означал бы
    // «перелогиньтесь» из-за заминки базы. См. api/context.ts.
    if (!isAppError(e)) return c.json({ error: "Не удалось проверить сессию" }, 503);
    return c.json({ error: "Unauthorized" }, 401);
  }

  const photoUrl = await loader(tenantId, id);
  if (!photoUrl) return c.json({ error: "Not Found" }, 404);

  // Already hosted elsewhere (S3) — send the client straight there.
  if (!photoUrl.startsWith("data:")) {
    if (!isAllowedPhotoTarget(photoUrl)) return c.json({ error: "Not Found" }, 404);
    return c.redirect(photoUrl, 302);
  }

  const match = DATA_URL_RE.exec(photoUrl);
  if (!match) return c.json({ error: "Not Found" }, 404);

  const body = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  const contentType = match[1].toLowerCase();
  if (!SAFE_IMAGE_TYPES.has(contentType)) return c.json({ error: "Not Found" }, 404);

  return c.body(body, 200, {
    "Content-Type":  contentType,
    "Cache-Control": CACHE_HEADER,
    // Браузер не должен угадывать тип по содержимому: без этого он способен
    // счесть разметкой то, что мы объявили картинкой.
    "X-Content-Type-Options": "nosniff",
    // Ответ ничего не подгружает и ничего не выполняет, даже если внутрь
    // однажды попадёт не то, что мы думаем.
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
}

photos.get("/product/:id", (c) =>
  serve(c, async (tenantId, id) => {
    const [row] = await getDb().select({ photoUrl: products.photoUrl })
      .from(products)
      .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
      .limit(1);
    return row?.photoUrl;
  }));

photos.get("/shop/:id", (c) =>
  serve(c, async (tenantId, id) => {
    const [row] = await getDb().select({ photoUrl: shops.photoUrl })
      .from(shops)
      .where(and(eq(shops.id, id), eq(shops.tenantId, tenantId)))
      .limit(1);
    return row?.photoUrl;
  }));

export default photos;
