import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/*
  Одноразовые коды по времени (TOTP, RFC 6238) — на node:crypto, без
  зависимости. Google Authenticator и любой другой генератор понимают ровно
  это: HMAC-SHA1, шаг 30 секунд, шесть цифр, секрет в base32.
*/

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** 20 случайных байт — рекомендованная длина для SHA1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, atMs = Date.now(), step = TOTP_STEP_SECONDS): string {
  const counter = Math.floor(atMs / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const offset = h[h.length - 1] & 0x0f;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/**
 * Код верен в своём шаге или в соседних (±1): часы телефона и сервера
 * расходятся на секунды, а человек набирает код не мгновенно.
 */
export function verifyTotp(secret: string, code: string, atMs = Date.now()): boolean {
  return matchTotp(secret, code, atMs) !== null;
}

/** Какому шагу (счётчику) отвечает код; null — никакому из ±1. */
export function matchTotp(secret: string, code: string, atMs = Date.now()): number | null {
  const given = String(code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(given)) return null;
  for (const k of [-1, 0, 1]) {
    const at = atMs + k * TOTP_STEP_SECONDS * 1000;
    const expected = totpCode(secret, at);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return Math.floor(at / 1000 / TOTP_STEP_SECONDS);
  }
  return null;
}

/*
  Код принимается один раз. Окно ±30 с нужно из-за часов, но в нём один и
  тот же код подходил повторно: подсмотренный через плечо код входил ещё
  минуту (аудит 20.09.2026). Последний принятый счётчик держится по
  человеку; код того же или более раннего шага — отказ. Память на процесс:
  при нескольких репликах защита слабее, но не хуже прежней.
*/
const usedCounters = new Map<number, { counter: number; at: number }>();
const USED_TTL_MS = 3 * TOTP_STEP_SECONDS * 1000;
export function verifyTotpOnce(userId: number, secret: string, code: string, atMs = Date.now()): boolean {
  const counter = matchTotp(secret, code, atMs);
  if (counter === null) return false;
  const last = usedCounters.get(userId);
  if (last && atMs - last.at < USED_TTL_MS && counter <= last.counter) return false;
  usedCounters.set(userId, { counter, at: atMs });
  return true;
}

/** Ссылка для QR-кода: её понимает любое приложение-аутентификатор. */
export function otpauthUrl(issuer: string, account: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}
