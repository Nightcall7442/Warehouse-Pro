import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { env } from "./env";

/**
 * AES-256-GCM encryption for sensitive data (1C passwords, API keys, etc.).
 *
 * Format: `v1:` + base64(iv + authTag + ciphertext)
 * - v1 prefix allows future algorithm rotation
 * - 16-byte random IV per encryption (never reused)
 * - 16-byte auth tag for tamper detection
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 16;
const TAG_LEN = 16;
const PREFIX = "v1:";

function getKey(): Buffer {
  // Derive a 256-bit key from APP_SECRET using scrypt
  const secret = env.appSecret;
  if (!secret) throw new Error("APP_SECRET required for encryption");
  return scryptSync(secret, "warehouse-pro-encryption-salt", 32);
}

/**
 * Encrypt a plaintext string. Returns a prefixed base64 string.
 */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Pack: iv + tag + ciphertext
  const packed = Buffer.concat([iv, tag, encrypted]);
  return PREFIX + packed.toString("base64");
}

/**
 * Decrypt an encrypted string. Handles both v1 format and legacy plaintext.
 *
 * Legacy support: if the value doesn't start with "v1:", it's returned as-is.
 * This allows gradual migration — existing plaintext passwords work until
 * re-saved, at which point they get encrypted.
 */
export function decryptSecret(encrypted: string): string {
  if (!encrypted) return encrypted;

  // Legacy plaintext — not encrypted yet
  if (!encrypted.startsWith(PREFIX)) return encrypted;

  const packed = Buffer.from(encrypted.slice(PREFIX.length), "base64");

  const iv = packed.subarray(0, IV_LEN);
  const tag = packed.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = packed.subarray(IV_LEN + TAG_LEN);

  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(ciphertext) + decipher.final("utf8");
}

/**
 * Check if a value is encrypted (v1 format).
 */
export function isEncrypted(value: string): boolean {
  return value?.startsWith(PREFIX) ?? false;
}
