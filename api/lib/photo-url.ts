import { sql, type SQL } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { storageUrlPrefixes } from "./s3";

/**
 * Photo reference for list queries.
 *
 * When S3 is not configured, photos are stored as base64 data URLs in a
 * mediumtext column (up to ~500 KB each). Selecting that column in a list turns
 * a page of 25 rows into megabytes of JSON. This returns a lazy URL served by
 * api/photos.ts instead, and passes real (S3/http) URLs through untouched.
 *
 * The `?v=` timestamp busts the browser cache whenever the row is updated.
 *
 * ── Почему последняя ветвь смотрит на «https://» ─────────────────────────────
 *
 * Она отдавала СОДЕРЖИМОЕ столбца как есть, а столбец писался четырьмя местами
 * и проверялся только одним. Импорт из Excel клал в него то, что стояло в
 * колонке «фото», без единой проверки: обычно это имя файла («IMG_0042.jpg»)
 * или ссылка по http. И то и другое доезжало до тега img на экране:
 *
 *   · имя файла достраивается до адреса текущей страницы — /orders/new/IMG_0042.jpg,
 *     это 404, а выглядит как не загрузившаяся картинка;
 *   · http блокирует политика безопасности страницы (imgSrc: 'self' data: blob: https:),
 *     причём молча — в консоли, а не на экране.
 *
 * Значение, которое браузер показать не может, — это ОТСУТСТВИЕ фотографии, и
 * честнее сказать об этом сразу: значок вместо битой картинки. Проверка стоит
 * здесь, а не в четырёх местах записи, потому что в базе уже лежат такие
 * строки: правка на входе их не исправит.
 */
export function photoRef(
  /*
    "visit" — фотоотчёт агента о визите (daily_plans.photo_url).

    Его здесь не было, и это оказалось не пробелом в списке, а тем, что
    фотографию НЕКОМУ БЫЛО ПОКАЗАТЬ: агент снимал магазин, снимок проходил
    фрод-проверку и ложился в базу, ручки для его отдачи не существовало, а
    отчёт по визитам печатал про него «да» или «нет».
  */
  kind: "product" | "shop" | "visit",
  idCol: AnyMySqlColumn,
  photoCol: AnyMySqlColumn,
  updatedAtCol: AnyMySqlColumn,
): SQL<string | null> {
  const prefix = `/api/photos/${kind}/`;
  const lazy = sql`CONCAT(${prefix}, ${idCol}, '?v=', UNIX_TIMESTAMP(${updatedAtCol}))`;
  /*
    Ссылка на НАШЕ хранилище тоже идёт через ручку (api/photos.ts читает объект
    своими ключами): открыт ли бакет и верен ли публичный домен, снаружи не
    видно, а после ночного переноса фото в S3 экран показывал заглушки
    (19.09.2026). Чужая https-ссылка — как есть: её ручка отдать не сможет.
  */
  // Префиксов не больше двух (свой домен и амазоновская форма) — ветви пишутся
  // явно, а не sql.join: тесты роутеров подменяют drizzle одной функцией sql.
  const [p1, p2] = storageUrlPrefixes();
  const own1 = p1 ? sql`WHEN ${photoCol} LIKE ${p1 + "%"} THEN ${lazy}` : sql``;
  const own2 = p2 ? sql`WHEN ${photoCol} LIKE ${p2 + "%"} THEN ${lazy}` : sql``;
  return sql<string | null>`CASE
    WHEN ${photoCol} IS NULL OR ${photoCol} = '' THEN NULL
    WHEN ${photoCol} LIKE 'data:%' THEN ${lazy}
    ${own1} ${own2}
    WHEN ${photoCol} LIKE 'https://%' THEN ${photoCol}
    ELSE NULL
  END`;
}
