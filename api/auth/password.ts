import { pbkdf2, timingSafeEqual, randomBytes } from "crypto";

/*
  600 000 — рекомендация OWASP (2023) для PBKDF2-HMAC-SHA256. Число хранится
  в самом хеше (pbkdf2$<iter>$<salt>$<key>), поэтому старые хеши на 100 000
  продолжают проходить проверку; при удачном входе они перехешируются
  (needsRehash → hashPassword) и догоняют новое число без сброса пароля.
*/
export const ITERATIONS = 600_000;
const KEY_LEN    = 64;
const DIGEST     = "sha256";

/** Хеш сделан меньшим числом итераций — после удачного входа его надо обновить. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  return parseInt(parts[1], 10) < ITERATIONS;
}

function randomSalt(): string {
  // 16 cryptographically random bytes, hex-encoded
  return randomBytes(16).toString("hex");
}

export function hashPassword(plain: string): Promise<string> {
  const salt = randomSalt();
  return new Promise((resolve, reject) => {
    pbkdf2(plain, salt, ITERATIONS, KEY_LEN, DIGEST, (err, key) => {
      if (err) return reject(err);
      resolve(`pbkdf2$${ITERATIONS}$${salt}$${key.toString("hex")}`);
    });
  });
}

export function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return Promise.resolve(false);

  const [, iters, salt, storedHex] = parts;
  return new Promise((resolve, reject) => {
    pbkdf2(plain, salt, parseInt(iters, 10), KEY_LEN, DIGEST, (err, key) => {
      if (err) return reject(err);

      const computed = Buffer.from(key.toString("hex"));
      const expected = Buffer.from(storedHex);

      // Lengths must match before timingSafeEqual (throws if not)
      if (computed.length !== expected.length) {
        resolve(false);
        return;
      }

      // Constant-time comparison — prevents timing attacks
      resolve(timingSafeEqual(computed, expected));
    });
  });
}
