import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { decryptStream, parseEncryptionKey } from "../lib/backup-crypto";

/**
 * End-to-end coverage for the upload path: a fake `mysqldump` produces SQL, the job
 * encrypts and "uploads" it, and the test decrypts what landed in the bucket. Only
 * the S3 SDK and the dump binary are faked — the streaming, encryption, tiering and
 * pruning are the real code.
 */

const KEY_HEX = "c".repeat(64);

const FAKE_DUMP = [
  "-- MySQL dump 10.13",
  "CREATE TABLE `tenants` (`id` int NOT NULL AUTO_INCREMENT, PRIMARY KEY (`id`));",
  "INSERT INTO `tenants` VALUES (1),(2),(3);",
  "CREATE TABLE `orders` (`id` int NOT NULL, PRIMARY KEY (`id`));",
  "-- Dump completed",
  "",
].join("\n");

const mockEnv = {
  databaseUrl: "mysql://warehouse:s3cr3t@mysql:3306/warehouse_pro",
  s3Bucket: "wp-backups",
  s3Region: "eu-central-1",
  s3AccessKey: "key",
  s3SecretKey: "secret",
  backupEncryptionKey: KEY_HEX,
  backupVerifyDatabaseUrl: "",
  mysqldumpPath: "mysqldump",
  mysqlClientPath: "mysql",
  isProduction: false,
};

vi.mock("../lib/env", () => ({ env: mockEnv }));

/** Every command the job sends, in order, as `{ type, input }`. */
type Sent = { type: string; input: Record<string, unknown> };
const sent: Sent[] = [];
/** Bodies captured from PutObject, keyed by object key. */
const uploaded = new Map<string, Buffer>();
/** What ListObjectsV2 should answer with, per prefix. */
let listing: Record<string, string[]> = {};

async function drain(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body);
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(public readonly input: Record<string, unknown>) {}
    get type(): string { return this.constructor.name; }
  }
  class PutObjectCommand extends Command {}
  class CopyObjectCommand extends Command {}
  class ListObjectsV2Command extends Command {}
  class DeleteObjectsCommand extends Command {}
  class GetObjectCommand extends Command {}

  class S3Client {
    async send(command: Command): Promise<unknown> {
      sent.push({ type: command.type, input: command.input });

      if (command instanceof PutObjectCommand) {
        uploaded.set(String(command.input.Key), await drain(command.input.Body));
        return {};
      }
      if (command instanceof CopyObjectCommand) {
        const source = String(command.input.CopySource).split("/").slice(1).join("/");
        const body = uploaded.get(source);
        if (body) uploaded.set(String(command.input.Key), body);
        return {};
      }
      if (command instanceof ListObjectsV2Command) {
        const prefix = String(command.input.Prefix);
        return { Contents: (listing[prefix] ?? []).map(Key => ({ Key })) };
      }
      return {};
    }
  }

  return { S3Client, PutObjectCommand, CopyObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, GetObjectCommand };
});

const { runBackup } = await import("./backup");

let dir: string;

/** A stand-in mysqldump: prints the fixture and exits 0. */
async function installFakeDump(script: string): Promise<string> {
  const path = join(dir, "mysqldump");
  await writeFile(path, script, { mode: 0o755 });
  await chmod(path, 0o755);
  return path;
}

function collector(): Writable & { data(): Buffer } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) { chunks.push(Buffer.from(chunk)); cb(); },
  });
  return Object.assign(stream, { data: () => Buffer.concat(chunks) });
}

function metadataOf(key: string): Record<string, string> {
  const put = sent.find(s => s.type === "PutObjectCommand" && s.input.Key === key);
  return (put?.input.Metadata ?? {}) as Record<string, string>;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "backup-upload-"));
  sent.length = 0;
  uploaded.clear();
  listing = {};
  const dumpPath = await installFakeDump(`#!/bin/sh\ncat <<'SQL_EOF'\n${FAKE_DUMP}SQL_EOF\n`);
  Object.assign(mockEnv, {
    s3Bucket: "wp-backups",
    s3AccessKey: "key",
    s3SecretKey: "secret",
    backupEncryptionKey: KEY_HEX,
    backupVerifyDatabaseUrl: "",
    mysqldumpPath: dumpPath,
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("upload path", () => {
  it("uploads an encrypted artifact that decrypts back to the dump", async () => {
    const result = await runBackup(new Date("2026-07-31T02:00:00Z"));

    expect(result.success).toBe(true);
    const key = "backups/daily/warehouse-pro-2026-07-31.sql.gz.enc";
    expect(result.key).toBe(key);

    const body = uploaded.get(key);
    expect(body).toBeDefined();
    const meta = metadataOf(key);

    const restored = collector();
    await decryptStream(Readable.from([body!]), restored, parseEncryptionKey(KEY_HEX), {
      iv: meta.iv!,
      authTag: meta.authtag!,
    });

    expect(restored.data().toString()).toBe(FAKE_DUMP);
    expect(restored.data().toString()).toContain("CREATE TABLE `tenants`");
  });

  it("records the metadata a restore needs", async () => {
    await runBackup(new Date("2026-07-31T02:00:00Z"));
    const meta = metadataOf("backups/daily/warehouse-pro-2026-07-31.sql.gz.enc");

    expect(meta.timestamp).toBe("2026-07-31T02:00:00.000Z");
    expect(meta.database).toBe("warehouse_pro");
    expect(meta.algorithm).toBe("aes-256-gcm");
    expect(meta.iv).toMatch(/^[0-9a-f]{24}$/);
    expect(meta.authtag).toMatch(/^[0-9a-f]{32}$/);
    expect(meta.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(meta["plaintext-size"]).toBe(String(FAKE_DUMP.length));
  });

  it("sends the artifact with a matching ContentLength", async () => {
    const result = await runBackup(new Date("2026-07-31T02:00:00Z"));
    const put = sent.find(s => s.type === "PutObjectCommand");

    expect(put?.input.ContentLength).toBe(result.size);
    expect(put?.input.ContentType).toBe("application/octet-stream");
    expect(uploaded.get(String(put?.input.Key))).toHaveLength(result.size!);
  });

  it("never puts the plaintext dump in the bucket", async () => {
    await runBackup(new Date("2026-07-31T02:00:00Z"));

    for (const body of uploaded.values()) {
      expect(body.toString("latin1")).not.toContain("CREATE TABLE");
      expect(body.toString("latin1")).not.toContain("tenants");
    }
  });
});

describe("tiering", () => {
  it("keeps a weekday backup in the daily tier only", async () => {
    // 2026-07-31 is a Friday.
    await runBackup(new Date("2026-07-31T02:00:00Z"));
    expect(sent.filter(s => s.type === "CopyObjectCommand")).toHaveLength(0);
  });

  it("promotes a Sunday backup to the weekly tier", async () => {
    // 2026-07-26 is a Sunday.
    await runBackup(new Date("2026-07-26T02:00:00Z"));
    const copies = sent.filter(s => s.type === "CopyObjectCommand").map(s => s.input.Key);
    expect(copies).toEqual(["backups/weekly/warehouse-pro-2026-07-26.sql.gz.enc"]);
  });

  it("promotes the 1st of a month to the monthly tier", async () => {
    // 2026-08-01 is a Saturday, so monthly only.
    await runBackup(new Date("2026-08-01T02:00:00Z"));
    const copies = sent.filter(s => s.type === "CopyObjectCommand").map(s => s.input.Key);
    expect(copies).toEqual(["backups/monthly/warehouse-pro-2026-08-01.sql.gz.enc"]);
  });

  it("promotes to both tiers when the 1st falls on a Sunday", async () => {
    // 2026-02-01 is a Sunday.
    await runBackup(new Date("2026-02-01T02:00:00Z"));
    const copies = sent.filter(s => s.type === "CopyObjectCommand").map(s => s.input.Key);
    expect(copies).toEqual([
      "backups/weekly/warehouse-pro-2026-02-01.sql.gz.enc",
      "backups/monthly/warehouse-pro-2026-02-01.sql.gz.enc",
    ]);
  });

  it("copies server-side instead of re-uploading", async () => {
    await runBackup(new Date("2026-07-26T02:00:00Z"));

    expect(sent.filter(s => s.type === "PutObjectCommand")).toHaveLength(1);
    const copy = sent.find(s => s.type === "CopyObjectCommand");
    expect(copy?.input.CopySource).toBe("wp-backups/backups/daily/warehouse-pro-2026-07-26.sql.gz.enc");
    expect(copy?.input.MetadataDirective).toBe("COPY");
  });
});

describe("pruning", () => {
  it("deletes the oldest daily backups beyond the 7 kept", async () => {
    listing = {
      "backups/daily/": Array.from({ length: 10 }, (_, i) =>
        `backups/daily/warehouse-pro-2026-07-${String(i + 22).padStart(2, "0")}.sql.gz.enc`),
    };

    await runBackup(new Date("2026-07-31T02:00:00Z"));

    const deletes = sent.filter(s => s.type === "DeleteObjectsCommand");
    expect(deletes).toHaveLength(1);
    const objects = (deletes[0]!.input.Delete as { Objects: Array<{ Key: string }> }).Objects.map(o => o.Key);
    expect(objects).toEqual([
      "backups/daily/warehouse-pro-2026-07-22.sql.gz.enc",
      "backups/daily/warehouse-pro-2026-07-23.sql.gz.enc",
      "backups/daily/warehouse-pro-2026-07-24.sql.gz.enc",
    ]);
  });

  it("does not delete anything while a tier is under its limit", async () => {
    listing = {
      "backups/daily/": ["backups/daily/warehouse-pro-2026-07-30.sql.gz.enc"],
      "backups/weekly/": ["backups/weekly/warehouse-pro-2026-07-26.sql.gz.enc"],
    };

    await runBackup(new Date("2026-07-31T02:00:00Z"));
    expect(sent.filter(s => s.type === "DeleteObjectsCommand")).toHaveLength(0);
  });

  it("leaves objects it does not recognise alone", async () => {
    listing = {
      "backups/daily/": [
        ...Array.from({ length: 8 }, (_, i) =>
          `backups/daily/warehouse-pro-2026-07-${String(i + 23).padStart(2, "0")}.sql.gz.enc`),
        "backups/daily/README.txt",
        "backups/daily/manual-export.sql",
      ],
    };

    await runBackup(new Date("2026-07-31T02:00:00Z"));

    const deletes = sent.filter(s => s.type === "DeleteObjectsCommand");
    const objects = (deletes[0]!.input.Delete as { Objects: Array<{ Key: string }> }).Objects.map(o => o.Key);
    expect(objects).toEqual(["backups/daily/warehouse-pro-2026-07-23.sql.gz.enc"]);
  });

  it("checks every tier, not just the one written today", async () => {
    await runBackup(new Date("2026-07-31T02:00:00Z"));

    const prefixes = sent.filter(s => s.type === "ListObjectsV2Command").map(s => s.input.Prefix);
    expect(prefixes).toEqual(["backups/daily/", "backups/weekly/", "backups/monthly/"]);
  });
});
