import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomBytes, createHash } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import {
  parseEncryptionKey,
  encryptStream,
  decryptStream,
  encryptFile,
  decryptFile,
  fileChecksum,
  checksumsMatch,
} from "./backup-crypto";

const KEY_HEX = "a".repeat(64);

/** Collects everything written to it, so a round-trip can be asserted in memory. */
function collector(): Writable & { data(): Buffer } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) { chunks.push(Buffer.from(chunk)); cb(); },
  });
  return Object.assign(stream, { data: () => Buffer.concat(chunks) });
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "backup-crypto-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parseEncryptionKey", () => {
  it("accepts 32 bytes of hex in either case", () => {
    expect(parseEncryptionKey(KEY_HEX)).toHaveLength(32);
    expect(parseEncryptionKey("A".repeat(64))).toHaveLength(32);
  });

  it("tolerates surrounding whitespace from .env files", () => {
    expect(parseEncryptionKey(` ${KEY_HEX}\n`)).toHaveLength(32);
  });

  it("refuses a missing key instead of writing an unencrypted dump", () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(/BACKUP_ENCRYPTION_KEY не задан/);
    expect(() => parseEncryptionKey("")).toThrow(/BACKUP_ENCRYPTION_KEY не задан/);
    expect(() => parseEncryptionKey(null)).toThrow(/BACKUP_ENCRYPTION_KEY не задан/);
  });

  it("refuses a key of the wrong length or shape", () => {
    expect(() => parseEncryptionKey("a".repeat(63))).toThrow(/32 байт в hex/);
    expect(() => parseEncryptionKey("a".repeat(65))).toThrow(/32 байт в hex/);
    expect(() => parseEncryptionKey("correct horse battery staple")).toThrow(/32 байт в hex/);
    // Base64 of 32 bytes is 44 chars — a plausible mistake that must not pass.
    expect(() => parseEncryptionKey(randomBytes(32).toString("base64"))).toThrow(/32 байт в hex/);
  });
});

describe("encrypt/decrypt round trip", () => {
  it("restores the exact plaintext", async () => {
    const key = parseEncryptionKey(KEY_HEX);
    const dump = "CREATE TABLE `tenants` (id int);\nINSERT INTO `tenants` VALUES (1);\n";

    const encrypted = collector();
    const result = await encryptStream(Readable.from([Buffer.from(dump)]), encrypted, key);

    const decrypted = collector();
    const verified = await decryptStream(Readable.from([encrypted.data()]), decrypted, key, result);

    expect(decrypted.data().toString()).toBe(dump);
    expect(verified.plaintextChecksum).toBe(result.plaintextChecksum);
    expect(verified.plaintextSize).toBe(result.plaintextSize);
  });

  it("reports sizes and checksums for both ends", async () => {
    const key = parseEncryptionKey(KEY_HEX);
    const dump = Buffer.from("x".repeat(100_000));

    const encrypted = collector();
    const result = await encryptStream(Readable.from([dump]), encrypted, key);

    expect(result.plaintextSize).toBe(dump.length);
    expect(result.plaintextChecksum).toBe(createHash("sha256").update(dump).digest("hex"));
    expect(result.size).toBe(encrypted.data().length);
    expect(result.checksum).toBe(createHash("sha256").update(encrypted.data()).digest("hex"));
    // Highly compressible input, so the artifact must be far smaller than the dump.
    expect(result.size).toBeLessThan(dump.length / 10);
    expect(result.iv).toMatch(/^[0-9a-f]{24}$/);
    expect(result.authTag).toMatch(/^[0-9a-f]{32}$/);
  });

  it("produces a different artifact each run for identical input", async () => {
    const key = parseEncryptionKey(KEY_HEX);
    const dump = Buffer.from("same input every night");

    const first = collector();
    const a = await encryptStream(Readable.from([dump]), first, key);
    const second = collector();
    const b = await encryptStream(Readable.from([dump]), second, key);

    // A fresh nonce per artifact — reusing one under the same key breaks GCM.
    expect(a.iv).not.toBe(b.iv);
    expect(first.data().equals(second.data())).toBe(false);
    expect(a.plaintextChecksum).toBe(b.plaintextChecksum);
  });

  it("survives a multi-chunk stream", async () => {
    const key = parseEncryptionKey(KEY_HEX);
    const chunks = Array.from({ length: 50 }, (_, i) => Buffer.from(`row ${i}\n`));
    const expected = Buffer.concat(chunks).toString();

    const encrypted = collector();
    const result = await encryptStream(Readable.from(chunks), encrypted, key);
    const decrypted = collector();
    await decryptStream(Readable.from([encrypted.data()]), decrypted, key, result);

    expect(decrypted.data().toString()).toBe(expected);
  });

  it("handles an empty dump without producing a bogus artifact", async () => {
    const key = parseEncryptionKey(KEY_HEX);
    const encrypted = collector();
    const result = await encryptStream(Readable.from([]), encrypted, key);

    expect(result.plaintextSize).toBe(0);
    const decrypted = collector();
    await decryptStream(Readable.from([encrypted.data()]), decrypted, key, result);
    expect(decrypted.data()).toHaveLength(0);
  });
});

describe("tamper detection", () => {
  const dump = Buffer.from("INSERT INTO `payments` VALUES (1, '1000.00');\n");

  async function encrypted() {
    const key = parseEncryptionKey(KEY_HEX);
    const sink = collector();
    const result = await encryptStream(Readable.from([dump]), sink, key);
    return { key, bytes: sink.data(), result };
  }

  it("rejects a flipped byte in the ciphertext", async () => {
    const { key, bytes, result } = await encrypted();
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;

    await expect(decryptStream(Readable.from([bytes]), collector(), key, result))
      .rejects.toThrow();
  });

  it("rejects a truncated artifact", async () => {
    const { key, bytes, result } = await encrypted();

    await expect(decryptStream(Readable.from([bytes.subarray(0, bytes.length - 8)]), collector(), key, result))
      .rejects.toThrow();
  });

  it("rejects a wrong auth tag", async () => {
    const { key, bytes, result } = await encrypted();

    await expect(decryptStream(Readable.from([bytes]), collector(), key, {
      iv: result.iv,
      authTag: "0".repeat(32),
    })).rejects.toThrow();
  });

  it("rejects a wrong IV", async () => {
    const { key, bytes, result } = await encrypted();

    await expect(decryptStream(Readable.from([bytes]), collector(), key, {
      iv: "0".repeat(24),
      authTag: result.authTag,
    })).rejects.toThrow();
  });

  it("rejects a wrong key", async () => {
    const { bytes, result } = await encrypted();
    const otherKey = parseEncryptionKey("b".repeat(64));

    await expect(decryptStream(Readable.from([bytes]), collector(), otherKey, result))
      .rejects.toThrow();
  });
});

describe("file helpers", () => {
  it("encrypts and decrypts through the filesystem", async () => {
    const key = parseEncryptionKey(KEY_HEX);
    const dumpPath = join(dir, "dump.sql");
    const encPath = join(dir, "dump.sql.gz.enc");
    const restoredPath = join(dir, "restored.sql");
    const dump = "CREATE TABLE `orders` (id int);\n".repeat(1000);
    await writeFile(dumpPath, dump);

    const result = await encryptFile(dumpPath, encPath, key);
    expect((await stat(encPath)).size).toBe(result.size);
    expect(await fileChecksum(encPath)).toBe(result.checksum);

    const verified = await decryptFile(encPath, restoredPath, key, result);
    expect(await readFile(restoredPath, "utf8")).toBe(dump);
    expect(verified.plaintextChecksum).toBe(result.plaintextChecksum);
  });
});

describe("checksumsMatch", () => {
  it("compares equal digests", () => {
    const digest = createHash("sha256").update("x").digest("hex");
    expect(checksumsMatch(digest, digest)).toBe(true);
  });

  it("rejects different digests and different lengths", () => {
    const a = createHash("sha256").update("a").digest("hex");
    const b = createHash("sha256").update("b").digest("hex");
    expect(checksumsMatch(a, b)).toBe(false);
    expect(checksumsMatch(a, a.slice(0, 32))).toBe(false);
    expect(checksumsMatch("", a)).toBe(false);
  });
});
