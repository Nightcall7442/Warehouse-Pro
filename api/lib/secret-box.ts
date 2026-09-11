/**
 * Шифрование секретов, которые приходится ХРАНИТЬ, а не хешировать.
 *
 * Пароль клиента к 1С нужен в открытом виде при каждом обмене — хеш тут не
 * подходит. До этого он лежал в onec_config.password как есть: попадал в
 * каждый дамп базы и был виден любому, кто читает MySQL. Учётка 1С — это
 * бухгалтерия клиента целиком; утечка дампа превращала инцидент Warehouse
 * Pro в инцидент у каждого клиента с обменом.
 *
 * AES-256-GCM из node:crypto. Ключ выводится из APP_SECRET через HKDF с
 * отдельной меткой: тот же секрет подписывает сессии, но ключи разные, и
 * компрометация одного не даёт второго. Отдельной переменной окружения нет
 * нарочно: обязательная новая переменная остановила бы выкладку, а
 * необязательная с запасным значением ничем не лучше вывода из APP_SECRET.
 *
 * Формат строки: `enc:v1:<iv>:<tag>:<шифртекст>` в base64url. Строка без
 * префикса считается унаследованной открытой — open() возвращает её как есть,
 * чтобы прежние записи продолжали работать до первого пересохранения.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { env } from "./env";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";

let keyCache: Buffer | null = null;
function key(): Buffer {
  if (!keyCache) {
    keyCache = Buffer.from(hkdfSync("sha256", env.appSecret, "", "warehouse-pro:secret-box:v1", 32));
  }
  return keyCache;
}

/** Зашифровать. Каждый вызов даёт новый IV — одинаковые пароли не похожи в базе. */
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, ct].map(b => b.toString("base64url")).join(":");
}

/** Расшифровать; унаследованную открытую строку вернуть как есть. */
export function open(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const [iv, tag, ct] = stored.slice(PREFIX.length).split(":").map(s => Buffer.from(s, "base64url"));
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export const isSealed = (stored: string): boolean => stored.startsWith(PREFIX);

/** Только для стендов: сбросить выведенный ключ после подмены env. */
export function _resetKeyForTests(): void { keyCache = null; }
