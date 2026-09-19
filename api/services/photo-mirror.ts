import { sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { logger } from "../lib/logger";
import { isS3Configured, storageUrlPatterns } from "../lib/s3";
import { uploadImageToS3 } from "../lib/photo-upload";
import { SAFE_IMAGE_TYPES } from "../lib/photo-value";
import { rowsOf } from "../lib/db-rows";
import { SINGLE } from "./photo-offload";

/*
  Фото по чужим ссылкам — копия у себя.

  Владелец (19.09.2026): «фото товаров пропали, вчера были». В базе у Serena
  Trade в photo_url лежали ссылки на cdn.ynamdar.com — из прайса поставщика
  ещё с июля. Сайт перестал отвечать (connection refused) — и карточки
  опустели, хотя у нас не менялось ничего: ни данные, ни код. Чужой сайт — не
  место для наших картинок: ночью копируем их к себе и подменяем ссылку, как
  photo-offload делает с data:-строками. Пока чужой сайт лежит — не выходит,
  повторим следующей ночью; вернулся — картинки переедут и больше не пропадут.

  Что берём: только https, только публичный хост (не адрес, не localhost, не
  внутренняя сеть), только картинку по Content-Type и не больше MAX_BYTES.
  Обновление — по прежнему значению: сменили фото, пока копировали, — не
  затрём.
*/
export const MIRROR_BATCH = 300;
export const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
/** Столько отказов одного хоста за прогон — и остальные его ссылки ждут следующей ночи. */
const HOST_FAILS = 3;

/** Хост, к которому серверу можно ходить: не адрес, не свой, не внутренний. */
export function isPublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || h.startsWith("[")) return false; // IPv4/IPv6 буквально
  return h.includes(".");
}

/** Ссылка на чужой сайт, которую стоит копировать: https и публичный хост. */
export function isForeignPhotoUrl(value: string): boolean {
  let u: URL;
  try { u = new URL(value); } catch { return false; }
  return u.protocol === "https:" && isPublicHost(u.hostname);
}

function extOf(contentType: string): string {
  const t = contentType.split(";")[0].trim().toLowerCase();
  return t === "image/jpeg" ? "jpg" : t === "image/svg+xml" ? "svg" : t.replace("image/", "");
}

/** Скачать картинку по чужой ссылке и положить к себе; null — не вышло (причина в журнале). */
export async function mirrorOne(url: string, folder: string, tenantId: number, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!isForeignPhotoUrl(url)) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, redirect: "follow", headers: { accept: "image/*" } });
    if (!res.ok) { logger.warn("photo mirror: bad status", { url, status: res.status }); return null; }
    // Переадресация могла увести на закрытый адрес — проверяем то, откуда пришли байты.
    if (res.url && !isForeignPhotoUrl(res.url)) { logger.warn("photo mirror: redirect to non-public host", { url }); return null; }
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!SAFE_IMAGE_TYPES.has(type)) { logger.warn("photo mirror: not an image", { url, type }); return null; }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) { logger.warn("photo mirror: too big", { url, declared }); return null; }
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length === 0 || body.length > MAX_BYTES) { logger.warn("photo mirror: too big or empty", { url, bytes: body.length }); return null; }
    return await uploadImageToS3(body, type, extOf(type), folder, tenantId);
  } catch (e) {
    logger.warn("photo mirror failed", { url, error: e instanceof Error ? e.message : String(e) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function mirrorForeignPhotos(db = getDb(), batch = MIRROR_BATCH, fetchImpl: typeof fetch = fetch): Promise<{ copied: number; failed: number; skipped: string | null }> {
  if (!isS3Configured()) return { copied: 0, failed: 0, skipped: "S3 не настроен — чужие ссылки остаются чужими" };
  let copied = 0, failed = 0, budget = batch;
  // ponytail: счётчик отказов по хосту живёт один прогон; мёртвый навсегда сайт
  // будет пробоваться по три раза каждую ночь — дёшево, а колонки «не трогать» нет.
  const hostFails = new Map<string, number>();

  for (const { table, column, folder } of SINGLE) {
    if (budget <= 0) break;
    let where = sql`${sql.identifier(column)} LIKE 'https://%'`;
    for (const p of storageUrlPatterns()) where = sql`${where} AND ${sql.identifier(column)} NOT LIKE ${p}`;
    const rows = rowsOf<{ id: number; tenant_id: number; value: string }>(await db.execute(sql`
      SELECT id, tenant_id, ${sql.identifier(column)} AS value FROM ${sql.identifier(table)}
      WHERE ${where} ORDER BY id LIMIT ${budget}
    `));
    for (const r of rows) {
      budget--;
      let host = "";
      try { host = new URL(r.value).hostname; } catch { failed++; continue; }
      if ((hostFails.get(host) ?? 0) >= HOST_FAILS) { failed++; continue; }
      const url = await mirrorOne(r.value, folder, r.tenant_id, fetchImpl);
      if (!url) { failed++; hostFails.set(host, (hostFails.get(host) ?? 0) + 1); continue; }
      await db.execute(sql`
        UPDATE ${sql.identifier(table)} SET ${sql.identifier(column)} = ${url}
        WHERE id = ${r.id} AND ${sql.identifier(column)} = ${r.value}
      `);
      copied++;
    }
  }

  if (copied + failed > 0) logger.info("photo mirror", { copied, failed, hosts: [...hostFails.keys()] });
  return { copied, failed, skipped: null };
}
