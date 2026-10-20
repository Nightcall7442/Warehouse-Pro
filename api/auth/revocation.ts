import { getRedis, isRedisAvailable } from "../lib/redis";

/*
  Отзыв ОДНОЙ сессии.

  Токен живёт 30 дней и до этого места переживал выход: /api/logout стирал
  куку и только. Украденный или оставшийся в чужом браузере токен работал
  до конца срока. Единственный способ отозвать был «выйти везде» —
  tokenVersion, который выкидывает и самого человека со всех устройств.

  Здесь — список отозванных идентификаторов сессий (jti) со сроком до
  истечения самого токена: дольше держать незачем, дальше он и так мёртв.
  Redis, если он есть; иначе память процесса.
  ponytail: память — одна реплика; вторая реплика не увидит отзыв, сделанный
  на первой. Redis в бою есть; без него — предупредить в логе при старте.
*/

const memory = new Map<string, number>();
const KEY = (jti: string) => `session:revoked:${jti}`;

/*
  Redis — не на каждый запрос.

  Проверка отзыва стоит в начале КАЖДОГО запроса с входом (auth/index.ts),
  и раньше каждый раз ходила в Redis. 20.10.2026 Redis стоял в другом
  регионе: ~170 мс на каждый запрос ещё до базы, а когда канал терял пакеты —
  минуты (lib/redis.ts). Сессия же отзывается раз в жизни, при выходе.

  Теперь отзыв, сделанный этим процессом, — сразу в памяти, и проверка его
  видит без Redis. Ответ Redis «не отозвана» помнится RECHECK_MS: отзыв,
  сделанный другой репликой, доходит сюда за это время. Реплика пока одна.
*/
const RECHECK_MS = 15_000;
/** Отозванная по словам Redis сессия помнится столько: отзыв не отменяется, срок токена здесь неизвестен. */
const REVOKED_REMEMBER_MS = 60 * 60_000;
/** jti → когда Redis последний раз ответил «не отозвана». */
const clean = new Map<string, number>();

function sweep(now: number): void {
  if (memory.size >= 1000) {
    for (const [jti, until] of memory) if (until <= now) memory.delete(jti);
  }
  if (clean.size >= 5000) {
    for (const [jti, at] of clean) if (now - at >= RECHECK_MS) clean.delete(jti);
  }
}

export async function revokeSession(jti: string, expiresAtSec: number): Promise<void> {
  const ttl = Math.max(1, Math.ceil(expiresAtSec - Date.now() / 1000));
  sweep(Date.now());
  memory.set(jti, Date.now() + ttl * 1000);
  clean.delete(jti);
  if (isRedisAvailable()) {
    try { await getRedis().set(KEY(jti), "1", "EX", ttl); } catch { /* память уже знает */ }
  }
}

export async function isSessionRevoked(jti: string): Promise<boolean> {
  const now = Date.now();
  const until = memory.get(jti);
  if (until !== undefined) {
    if (until > now) return true;
    memory.delete(jti);
  }
  if (!isRedisAvailable()) return false;
  const checked = clean.get(jti);
  if (checked !== undefined && now - checked < RECHECK_MS) return false;
  try {
    const revoked = (await getRedis().exists(KEY(jti))) === 1;
    sweep(now);
    if (revoked) memory.set(jti, now + REVOKED_REMEMBER_MS);
    else clean.set(jti, now);
    return revoked;
  } catch {
    return false;
  }
}

/** Для стендов. */
export const _revocationInternals = { memory, clean };
