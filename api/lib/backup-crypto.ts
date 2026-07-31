import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createGzip, createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { createReadStream, createWriteStream } from "node:fs";
import type { Readable, Writable } from "node:stream";

/**
 * FIX: P0.4 — compression + authenticated encryption for database dumps.
 *
 * A dump is the entire tenant database in plaintext, so it must not sit in object
 * storage readable. The artifact is `gzip` then AES-256-GCM: GCM is authenticated,
 * so a truncated or tampered object fails to decrypt instead of restoring
 * silently-corrupt data. The IV and auth tag are not secret and travel with the
 * object's metadata; the key never leaves the environment.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12; // 96-bit nonce, the size GCM is specified for
const ALGORITHM = "aes-256-gcm";

export type EncryptionResult = {
  /** Random nonce for this artifact, hex — required to decrypt. */
  iv: string;
  /** GCM authentication tag, hex — required to decrypt. */
  authTag: string;
  /** SHA-256 of the encrypted bytes, hex — verifies the object survived transit. */
  checksum: string;
  /** Size of the encrypted artifact in bytes. */
  size: number;
  /** SHA-256 of the plaintext dump, hex — verifies a restore produced the same SQL. */
  plaintextChecksum: string;
  /** Size of the plaintext dump in bytes, before compression. */
  plaintextSize: number;
};

/**
 * Parse and validate the configured key.
 *
 * Rejects anything that is not exactly 32 bytes of hex: a short key would silently
 * weaken the cipher, and a passphrase-looking value usually means someone expected
 * key derivation that isn't happening here.
 */
export function parseEncryptionKey(raw: string | undefined | null): Buffer {
  if (!raw) {
    throw new Error(
      "BACKUP_ENCRYPTION_KEY не задан — резервная копия не может быть зашифрована. " +
      "Сгенерируйте ключ: openssl rand -hex 32",
    );
  }
  const trimmed = raw.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(
      `BACKUP_ENCRYPTION_KEY должен быть ${KEY_BYTES} байт в hex (64 символа), получено ${trimmed.length}. ` +
      "Сгенерируйте ключ: openssl rand -hex 32",
    );
  }
  return Buffer.from(trimmed, "hex");
}

/** Counts bytes and hashes them as they flow past, without buffering the stream. */
function makeMeter() {
  const hash = createHash("sha256");
  let size = 0;
  return {
    tap(chunk: Buffer): Buffer {
      size += chunk.length;
      hash.update(chunk);
      return chunk;
    },
    result(): { checksum: string; size: number } {
      return { checksum: hash.digest("hex"), size };
    },
  };
}

async function* meterChunks(source: AsyncIterable<Buffer | string>, meter: ReturnType<typeof makeMeter>) {
  for await (const chunk of source) {
    yield meter.tap(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
}

/**
 * gzip + encrypt `source` into `destination`, measuring both ends.
 *
 * Nothing is buffered whole: a multi-gigabyte dump streams through at constant
 * memory. The auth tag is only available after the cipher has flushed, which is why
 * it comes back in the result rather than being embedded in the stream.
 */
export async function encryptStream(
  source: Readable,
  destination: Writable,
  key: Buffer,
): Promise<EncryptionResult> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plain = makeMeter();
  const encrypted = makeMeter();

  await pipeline(
    source,
    (s: AsyncIterable<Buffer | string>) => meterChunks(s, plain),
    createGzip({ level: 6 }),
    cipher,
    (s: AsyncIterable<Buffer | string>) => meterChunks(s, encrypted),
    destination,
  );

  const plaintext = plain.result();
  const ciphertext = encrypted.result();

  return {
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
    checksum: ciphertext.checksum,
    size: ciphertext.size,
    plaintextChecksum: plaintext.checksum,
    plaintextSize: plaintext.size,
  };
}

/**
 * Decrypt + gunzip `source` into `destination`.
 *
 * Throws when the auth tag doesn't match — that is the point of GCM, and it covers
 * both a corrupted download and a modified object. Returns the plaintext checksum
 * so a caller can compare it with what the backup recorded.
 */
export async function decryptStream(
  source: Readable,
  destination: Writable,
  key: Buffer,
  params: { iv: string; authTag: string },
): Promise<{ plaintextChecksum: string; plaintextSize: number }> {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(params.iv, "hex"));
  decipher.setAuthTag(Buffer.from(params.authTag, "hex"));

  const plain = makeMeter();
  await pipeline(
    source,
    decipher,
    createGunzip(),
    (s: AsyncIterable<Buffer | string>) => meterChunks(s, plain),
    destination,
  );

  const { checksum, size } = plain.result();
  return { plaintextChecksum: checksum, plaintextSize: size };
}

/** SHA-256 of a file on disk, hex. */
export async function fileChecksum(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), async (source: AsyncIterable<Buffer>) => {
    for await (const chunk of source) hash.update(chunk);
  });
  return hash.digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function checksumsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  const maxLen = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.alloc(maxLen);
  const paddedB = Buffer.alloc(maxLen);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  return timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
}

/** Convenience wrapper: encrypt one file into another. */
export async function encryptFile(inputPath: string, outputPath: string, key: Buffer): Promise<EncryptionResult> {
  return encryptStream(createReadStream(inputPath), createWriteStream(outputPath), key);
}

/** Convenience wrapper: decrypt one file into another. */
export async function decryptFile(
  inputPath: string,
  outputPath: string,
  key: Buffer,
  params: { iv: string; authTag: string },
): Promise<{ plaintextChecksum: string; plaintextSize: number }> {
  return decryptStream(createReadStream(inputPath), createWriteStream(outputPath), key, params);
}
