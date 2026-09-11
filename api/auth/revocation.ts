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

function sweep(now: number): void {
  if (memory.size < 1000) return;
  for (const [jti, until] of memory) if (until <= now) memory.delete(jti);
}

export async function revokeSession(jti: string, expiresAtSec: number): Promise<void> {
  const ttl = Math.max(1, Math.ceil(expiresAtSec - Date.now() / 1000));
  if (isRedisAvailable()) {
    try { await getRedis().set(KEY(jti), "1", "EX", ttl); return; } catch { /* ниже — память */ }
  }
  sweep(Date.now());
  memory.set(jti, Date.now() + ttl * 1000);
}

export async function isSessionRevoked(jti: string): Promise<boolean> {
  if (isRedisAvailable()) {
    try { return (await getRedis().exists(KEY(jti))) === 1; } catch { /* ниже — память */ }
  }
  const until = memory.get(jti);
  if (until === undefined) return false;
  if (until <= Date.now()) { memory.delete(jti); return false; }
  return true;
}

/** Для стендов. */
export const _revocationInternals = { memory };
