import { env } from "./env";

/* ═══════════════════════════════════════════════════════════════════════════
   Объектное хранилище — одно место на всё приложение.

   ── Что было ────────────────────────────────────────────────────────────────

   Клиент S3 создавался в ШЕСТИ местах, а публичный адрес файла собирался
   строкой в ЧЕТЫРЁХ:

       `https://${bucket}.s3.${region}.amazonaws.com/${key}`

   Пока хранилище одно и оно амазоновское, это просто повторение. Но адрес
   зашит намертво, и любое S3-совместимое хранилище — Cloudflare R2, Backblaze
   B2, Yandex Object Storage — отдаёт файлы по своему домену. Загрузка в них
   прошла бы успешно, а ссылка получилась бы неверной: фотографии просто не
   открывались бы, и виновата была бы «загрузка», хотя файл на месте.

   ── Зачем это сейчас ────────────────────────────────────────────────────────

   У Cloudflare R2 бесплатно 10 ГБ и, что важнее, БЕСПЛАТНАЯ раздача: фотографии
   товаров тянут при каждом открытии каталога, и на обычном S3 счёт растёт
   именно от неё, а не от хранения. Чтобы туда переехать, приложению нужно уметь
   свой адрес входа и свой публичный домен.

   ── Три переменные ──────────────────────────────────────────────────────────

   S3_ENDPOINT    — адрес входа хранилища. Пусто = обычный AWS.
   S3_PUBLIC_URL  — по какому адресу файлы читают снаружи. У R2 это выданный
                    домен pub-….r2.dev или свой.
   S3_FORCE_PATH  — класть имя бакета в путь, а не в поддомен. Нужно почти
                    всем, кроме AWS.
   ═══════════════════════════════════════════════════════════════════════════ */

export function isS3Configured(): boolean {
  return Boolean(env.s3Bucket && env.s3AccessKey && env.s3SecretKey);
}

/**
 * Клиент хранилища.
 *
 * Импорт внутри функции, а не наверху файла: пакет aws-sdk весит немало, и
 * приложению без хранилища он не нужен ни на запуске, ни потом.
 */
/** Настроено ли зеркало копий вне площадки (см. env.ts). */
export function isOffsiteBackupConfigured(): boolean {
  return !!(env.backupS3Endpoint && env.backupS3AccessKey && env.backupS3SecretKey);
}

/** Клиент второго назначения копии. Только когда оно настроено. */
export async function offsiteBackupClient() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: env.backupS3Region || "auto",
    credentials: { accessKeyId: env.backupS3AccessKey, secretAccessKey: env.backupS3SecretKey },
    endpoint: env.backupS3Endpoint,
    forcePathStyle: env.backupS3ForcePathStyle,
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 120_000 },
  });
}

export async function s3Client() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: env.s3Region || "auto",
    // Без пределов /health с HeadBucket и ночная копия зависали на мёртвом
    // MinIO бесконечно; запрос — длинный, потому что через него идёт дамп.
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 120_000 },
    credentials: {
      accessKeyId: env.s3AccessKey,
      secretAccessKey: env.s3SecretKey,
    },
    ...(env.s3Endpoint ? { endpoint: env.s3Endpoint, forcePathStyle: env.s3ForcePathStyle } : {}),
  });
}

/**
 * Просить ли хранилище зашифровать объект.
 *
 * На самом AWS шифрование надо запросить заголовком, иначе объект ляжет как
 * есть. У остальных наоборот: R2 и B2 шифруют всё и всегда, а незнакомый
 * заголовок отвергают целиком — ночная копия падала бы каждую ночь ради того,
 * что там включено по умолчанию.
 *
 * Признак «не AWS» — заданный свой адрес входа. Отдельной переменной для этого
 * не нужно: другого смысла у неё нет.
 */
export function serverSideEncryption(): { ServerSideEncryption?: "AES256" } {
  return env.s3Endpoint ? {} : { ServerSideEncryption: "AES256" };
}

/**
 * Публичный адрес файла.
 *
 * Порядок важен: сначала явно заданный домен, потом — привычный амазоновский.
 * Обратный порядок означал бы, что настроенный R2 продолжает выдавать ссылки
 * на amazonaws.com, и это не заметно до первой открытой карточки товара.
 */
export function publicUrl(key: string): string {
  const base = env.s3PublicUrl.replace(/\/+$/, "");
  if (base) return `${base}/${key}`;
  return `https://${env.s3Bucket}.s3.${env.s3Region || "us-east-1"}.amazonaws.com/${key}`;
}

/**
 * Хост, на который разрешено переадресовывать из /api/photos.
 *
 * Ограничение остаётся ровно таким же строгим, как было: единственный хост, и
 * сравнение точное. Меняется только то, ОТКУДА он берётся — раньше собирался
 * из бакета и региона по амазоновскому образцу, теперь совпадает с тем, по
 * какому адресу мы файлы и раздаём.
 *
 * Хранилище не настроено — переадресации нет вовсе.
 */
/**
 * Адреса, с которых начинаются ссылки на НАШИ файлы: заданный публичный домен
 * и амазоновская форма (её publicUrl строит, когда домен не задан). Ночной
 * перенос фото в хранилище (photos-to-s3) оставил в базе именно такие ссылки.
 */
export function storageUrlPrefixes(): string[] {
  if (!env.s3Bucket) return [];
  const out: string[] = [];
  const base = env.s3PublicUrl.replace(/\/+$/, "");
  if (base) out.push(`${base}/`);
  out.push(`https://${env.s3Bucket}.s3.${env.s3Region || "us-east-1"}.amazonaws.com/`);
  return out;
}

/** Хосты нашего хранилища: адрес входа (S3_ENDPOINT) и публичный домен. */
function storageHosts(): string[] {
  const out: string[] = [];
  for (const u of [env.s3Endpoint, env.s3PublicUrl]) {
    try { if (u) out.push(new URL(u).hostname); } catch { /* кривой адрес в настройке — не хост */ }
  }
  return [...new Set(out)];
}

/**
 * Образцы LIKE для ссылок на наше хранилище — всё, чем ссылка могла быть
 * записана за время жизни настроек, а не только сегодняшний publicUrl:
 *
 *   · сегодняшние префиксы (публичный домен и амазоновская форма);
 *   · любой из наших хостов по https и по http — S3_PUBLIC_URL менялся, и
 *     ссылка, записанная при прежнем значении (без бакета в пути, по http),
 *     ушла на экран как «чужая https» и не открылась: владелец второй раз
 *     за вечер 19.09.2026 показал заглушки вместо товаров;
 *   · «/<бакет>/» в любом месте — имя бакета своё, с чужими не совпадёт.
 */
export function storageUrlPatterns(): string[] {
  if (!env.s3Bucket) return [];
  const out = storageUrlPrefixes().map(p => `${p}%`);
  for (const h of storageHosts()) out.push(`https://${h}/%`, `http://${h}/%`);
  out.push(`%/${env.s3Bucket}/%`);
  return [...new Set(out)];
}

/**
 * Ключ объекта по ссылке на наше хранилище; чужая ссылка — null.
 *
 * Сначала точные префиксы, потом разбор адреса: ключ — всё после «/<бакет>/»,
 * а если бакета в пути нет, но хост наш, — весь путь (ссылка, записанная,
 * когда S3_PUBLIC_URL был без бакета).
 */
export function storageKeyOf(url: string): string | null {
  for (const prefix of storageUrlPrefixes()) {
    if (url.startsWith(prefix) && url.length > prefix.length) return decodeURIComponent(url.slice(prefix.length).split("?")[0]);
  }
  if (!env.s3Bucket) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  let path: string;
  try { path = decodeURIComponent(u.pathname); } catch { return null; }
  const marker = `/${env.s3Bucket}/`;
  const at = path.indexOf(marker);
  if (at >= 0) return path.slice(at + marker.length) || null;
  if (storageHosts().includes(u.hostname)) return path.replace(/^\/+/, "") || null;
  return null;
}

/**
 * Прочитать объект из хранилища — для раздачи фото через /api/photos.
 *
 * Фото после ночного переноса лежат в хранилище, а ссылка на него в базе
 * ведёт на бакет напрямую. Открыт ли бакет на чтение (scripts/init-storage.mjs)
 * и верен ли S3_PUBLIC_URL — этого приложение не знает, а владелец видит
 * только заглушку вместо товара (19.09.2026). Поэтому наружу уходит наша же
 * ручка, а байты она берёт своими ключами: бакет может оставаться закрытым.
 */
export async function readObject(key: string): Promise<{ body: Uint8Array; contentType: string } | null> {
  if (!isS3Configured()) return null;
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await s3Client();
  try {
    const r = await client.send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    const body = await r.Body?.transformToByteArray();
    if (!body) return null;
    return { body, contentType: (r.ContentType ?? "application/octet-stream").toLowerCase() };
  } catch {
    return null;
  }
}

export function allowedPhotoHost(): string | null {
  if (!env.s3Bucket) return null;
  if (env.s3PublicUrl) {
    try {
      return new URL(env.s3PublicUrl).hostname;
    } catch {
      // Кривой адрес в настройке не должен превращаться в «пускать куда угодно».
      return null;
    }
  }
  return `${env.s3Bucket}.s3.${env.s3Region || "us-east-1"}.amazonaws.com`;
}
