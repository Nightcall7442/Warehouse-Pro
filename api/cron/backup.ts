import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../lib/logger";
import { env } from "../lib/env";
import {
  checksumsMatch,
  decryptStream,
  encryptStream,
  fileChecksum,
  parseEncryptionKey,
} from "../lib/backup-crypto";
import {
  RETENTION_LIMITS,
  backupKey,
  selectExpired,
  tierPrefix,
  tiersForDay,
  type BackupTier,
} from "../lib/backup-retention";

/**
 * FIX: P0.4 — nightly database backup.
 *
 * The previous implementation counted rows in eight tables and uploaded that
 * summary as JSON under a `.sql` key: there was no dump, so there was nothing to
 * restore from. This runs `mysqldump`, streams the output through gzip and
 * AES-256-GCM into object storage, keeps 7 daily / 4 weekly / 12 monthly copies,
 * and — when a scratch database is configured — proves the artifact restores.
 */

export type BackupResult = {
  success: boolean;
  message: string;
  key?: string;
  size?: number;
  plaintextSize?: number;
  durationMs?: number;
  verified?: boolean;
};

type Connection = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

/** Both client binaries take minutes on a large database; beyond this something is wrong. */
const CHILD_TIMEOUT_MS = 5 * 60 * 1000;

/** Parse a mysql:// URL into connection parts. Exported for tests. */
export function connectionFromUrl(url: string): Connection {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL не удалось разобрать как URL");
  }
  if (!parsed.protocol.startsWith("mysql")) {
    throw new Error(`Ожидался mysql:// URL, получено ${parsed.protocol}`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) throw new Error("DATABASE_URL не содержит имя базы данных");

  return {
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port, 10) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
  };
}

/**
 * A `[client]` defaults file, so the password never appears in argv.
 *
 * `--password=` on the command line is visible to every process on the host via
 * `ps`, and MYSQL_PWD leaks the same way through /proc. A 0600 file in a private
 * temp directory is the option the MySQL docs endorse.
 */
export function defaultsFileContents(conn: Connection): string {
  return [
    "[client]",
    `host=${conn.host}`,
    `port=${conn.port}`,
    `user=${conn.user}`,
    `password=${conn.password}`,
    "",
  ].join("\n");
}

async function writeDefaultsFile(dir: string, conn: Connection): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, "my.cnf");
  await writeFile(path, defaultsFileContents(conn), { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

/**
 * Dump flags. Exported for tests.
 *
 * `--single-transaction` gives a consistent snapshot without locking writers out
 * (InnoDB only, which is what the schema uses). No `--databases`, so the dump
 * carries no `CREATE DATABASE`/`USE` and can be restored into a scratch schema of
 * any name — that is what makes the restore check possible.
 */
export function mysqldumpArgs(defaultsPath: string, conn: Connection): string[] {
  return [
    `--defaults-extra-file=${defaultsPath}`,
    "--single-transaction",
    "--quick",
    "--routines",
    "--triggers",
    "--events",
    "--no-tablespaces",
    "--default-character-set=utf8mb4",
    "--hex-blob",
    conn.database,
  ];
}

/** Spawn a client binary and resolve when it exits 0. */
function runClient(
  bin: string,
  args: string[],
  handlers: {
    onStdout?: (stdout: NodeJS.ReadableStream) => Promise<void>;
    stdin?: NodeJS.ReadableStream;
  } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: [handlers.stdin ? "pipe" : "ignore", handlers.onStdout ? "pipe" : "ignore", "pipe"],
      timeout: CHILD_TIMEOUT_MS,
    });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      // Keep the tail only: a failing dump can produce a lot of noise.
      stderr = (stderr + chunk.toString()).slice(-4_000);
    });

    let consumed: Promise<void> = Promise.resolve();
    if (handlers.onStdout && child.stdout) consumed = handlers.onStdout(child.stdout);
    if (handlers.stdin && child.stdin) handlers.stdin.pipe(child.stdin);

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new Error(
          `Не найден исполняемый файл ${bin}. Установите MySQL client или задайте MYSQLDUMP_PATH/MYSQL_PATH.`,
        ));
        return;
      }
      reject(err);
    });

    child.on("close", (code) => {
      consumed.then(
        () => {
          if (code === 0) resolve();
          else reject(new Error(`${bin} завершился с кодом ${code}: ${stderr.trim()}`));
        },
        (err: unknown) => reject(err),
      );
    });
  });
}

type S3Config = { bucket: string; region: string; accessKey: string; secretKey: string };

function s3ConfigOrNull(): S3Config | null {
  if (!env.s3Bucket || !env.s3AccessKey || !env.s3SecretKey) return null;
  return {
    bucket: env.s3Bucket,
    region: env.s3Region || "us-east-1",
    accessKey: env.s3AccessKey,
    secretKey: env.s3SecretKey,
  };
}

async function makeS3Client(config: S3Config) {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: config.region,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
  });
}

/**
 * Object metadata for an artifact. Exported for tests.
 *
 * The IV and auth tag live here because decryption needs them and they are not
 * secret; the checksums let a restore prove it read back exactly what was written.
 * S3 lower-cases user-metadata keys, so they are written that way to keep the round
 * trip predictable.
 */
export function artifactMetadata(input: {
  timestamp: string;
  iv: string;
  authTag: string;
  checksum: string;
  size: number;
  plaintextChecksum: string;
  plaintextSize: number;
  database: string;
}): Record<string, string> {
  return {
    timestamp: input.timestamp,
    // Whole-instance dump: every tenant lives in one schema.
    tenant: "all",
    database: input.database,
    algorithm: "aes-256-gcm",
    compression: "gzip",
    iv: input.iv,
    authtag: input.authTag,
    checksum: input.checksum,
    size: String(input.size),
    "plaintext-checksum": input.plaintextChecksum,
    "plaintext-size": String(input.plaintextSize),
  };
}

/** Run mysqldump and write the encrypted artifact to `destPath`. */
async function dumpToEncryptedFile(
  destPath: string,
  defaultsPath: string,
  conn: Connection,
  key: Buffer,
) {
  let encryption: Awaited<ReturnType<typeof encryptStream>> | undefined;

  await runClient(env.mysqldumpPath, mysqldumpArgs(defaultsPath, conn), {
    onStdout: async (stdout) => {
      encryption = await encryptStream(stdout as never, createWriteStream(destPath), key);
    },
  });

  if (!encryption) throw new Error("mysqldump не отдал вывод");
  return encryption;
}

/**
 * Load a plaintext dump into the scratch database and count tenants.
 *
 * The schema is dropped and recreated first, so a verification run doesn't depend
 * on what the previous one left behind.
 */
async function restoreAndCount(dumpPath: string, verifyUrl: string, dir: string): Promise<number> {
  const conn = connectionFromUrl(verifyUrl);
  const defaultsPath = await writeDefaultsFile(join(dir, "verify"), conn);

  await runClient(env.mysqlClientPath, [
    `--defaults-extra-file=${defaultsPath}`,
    "-e",
    `DROP DATABASE IF EXISTS \`${conn.database}\`; CREATE DATABASE \`${conn.database}\` CHARACTER SET utf8mb4;`,
  ]);

  await runClient(env.mysqlClientPath, [`--defaults-extra-file=${defaultsPath}`, conn.database], {
    stdin: createReadStream(dumpPath),
  });

  let output = "";
  await runClient(env.mysqlClientPath, [
    `--defaults-extra-file=${defaultsPath}`,
    "--skip-column-names",
    "-e",
    "SELECT COUNT(*) FROM tenants",
    conn.database,
  ], {
    onStdout: async (stdout) => {
      for await (const chunk of stdout) output += String(chunk);
    },
  });

  const count = parseInt(output.trim(), 10);
  if (!Number.isFinite(count)) {
    throw new Error(`Не удалось прочитать COUNT(*) FROM tenants: "${output.trim()}"`);
  }
  return count;
}

/**
 * Download an artifact, decrypt it and restore it into the scratch database.
 *
 * Downloading rather than reusing the local file is deliberate: it also proves the
 * upload arrived intact, which is the half of "we have backups" that fails
 * silently in practice.
 */
export async function verifyBackup(key: string): Promise<{ verified: boolean; message: string; tenantCount?: number }> {
  const config = s3ConfigOrNull();
  if (!config) return { verified: false, message: "S3 не настроен — проверка восстановления пропущена" };
  if (!env.backupVerifyDatabaseUrl) {
    return { verified: false, message: "BACKUP_VERIFY_DATABASE_URL не задан — проверка восстановления пропущена" };
  }

  const encryptionKey = parseEncryptionKey(env.backupEncryptionKey);
  const dir = await mkdtemp(join(tmpdir(), "wp-verify-"));
  try {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = await makeS3Client(config);
    const object = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));

    const metadata = object.Metadata ?? {};
    const iv = metadata.iv;
    const authTag = metadata.authtag;
    if (!iv || !authTag) {
      throw new Error(`У объекта ${key} нет метаданных iv/authtag — расшифровать невозможно`);
    }

    const encPath = join(dir, "artifact.sql.gz.enc");
    const body = object.Body as unknown as NodeJS.ReadableStream;
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(encPath);
      body.pipe(out);
      out.on("finish", () => resolve());
      out.on("error", reject);
      body.on("error", reject);
    });

    if (metadata.checksum && !checksumsMatch(await fileChecksum(encPath), metadata.checksum)) {
      throw new Error(`Контрольная сумма объекта ${key} не совпадает с метаданными`);
    }

    const dumpPath = join(dir, "restore.sql");
    const decrypted = await decryptStream(
      createReadStream(encPath),
      createWriteStream(dumpPath),
      encryptionKey,
      { iv, authTag },
    );
    const recorded = metadata["plaintext-checksum"];
    if (recorded && !checksumsMatch(decrypted.plaintextChecksum, recorded)) {
      throw new Error("Расшифрованный дамп не совпадает с контрольной суммой исходного");
    }

    const tenantCount = await restoreAndCount(dumpPath, env.backupVerifyDatabaseUrl, dir);
    if (tenantCount < 1) {
      return { verified: false, message: "Дамп восстановлен, но таблица tenants пуста", tenantCount };
    }
    return { verified: true, message: `дамп восстановлен, tenants: ${tenantCount}`, tenantCount };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Copy the daily artifact into the weekly/monthly tiers and prune every tier. */
async function fanOutAndPrune(config: S3Config, day: string, dailyKey: string): Promise<void> {
  const { CopyObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const s3 = await makeS3Client(config);

  for (const tier of tiersForDay(day)) {
    if (tier === "daily") continue;
    // Server-side copy: the artifact is already encrypted, no need to re-upload it.
    await s3.send(new CopyObjectCommand({
      Bucket: config.bucket,
      CopySource: `${config.bucket}/${dailyKey}`,
      Key: backupKey(tier, day),
      MetadataDirective: "COPY",
    }));
    logger.info("backup promoted", { tier, day });
  }

  for (const tier of Object.keys(RETENTION_LIMITS) as BackupTier[]) {
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: tierPrefix(tier) }));
    const keys = (listed.Contents ?? []).map(o => o.Key).filter((k): k is string => Boolean(k));
    const expired = selectExpired(keys, RETENTION_LIMITS[tier]);
    if (expired.length === 0) continue;

    await s3.send(new DeleteObjectsCommand({
      Bucket: config.bucket,
      Delete: { Objects: expired.map(Key => ({ Key })) },
    }));
    logger.info("expired backups deleted", { tier, count: expired.length, kept: RETENTION_LIMITS[tier] });
  }
}

/**
 * Database backup job. Runs on BACKUP_SCHEDULE (default 02:00 UTC) in the backup
 * container, and is also reachable at GET /api/cron/backup for an on-demand run.
 */
export async function runBackup(now: Date = new Date()): Promise<BackupResult> {
  const startedAt = Date.now();
  const day = now.toISOString().slice(0, 10);
  const config = s3ConfigOrNull();

  if (!config) {
    // Refusing rather than "succeeding" locally: a backup nobody stored is not a
    // backup, and the previous job reported success in exactly this case.
    const message = "S3 не настроен (S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY) — резервную копию некуда загрузить";
    logger.error("backup skipped", { reason: message });
    return { success: false, message };
  }

  let key: Buffer;
  try {
    key = parseEncryptionKey(env.backupEncryptionKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("backup skipped", { reason: message });
    return { success: false, message };
  }

  const dir = await mkdtemp(join(tmpdir(), "wp-backup-"));
  try {
    const conn = connectionFromUrl(env.databaseUrl);
    const defaultsPath = await writeDefaultsFile(dir, conn);
    const artifactPath = join(dir, `warehouse-pro-${day}.sql.gz.enc`);

    const encryption = await dumpToEncryptedFile(artifactPath, defaultsPath, conn, key);
    if (encryption.plaintextSize === 0) throw new Error("mysqldump вернул пустой дамп");

    const onDisk = await stat(artifactPath);
    if (onDisk.size !== encryption.size) {
      throw new Error(`Размер артефакта (${onDisk.size}) не совпадает с зашифрованным потоком (${encryption.size})`);
    }

    const dailyKey = backupKey("daily", day);
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = await makeS3Client(config);
    await s3.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: dailyKey,
      Body: createReadStream(artifactPath),
      ContentLength: encryption.size,
      ContentType: "application/octet-stream",
      Metadata: artifactMetadata({
        timestamp: now.toISOString(),
        database: conn.database,
        ...encryption,
      }),
    }));

    logger.info("backup uploaded", {
      key: dailyKey,
      size: encryption.size,
      plaintextSize: encryption.plaintextSize,
    });

    await fanOutAndPrune(config, day, dailyKey);

    // The restore check is part of the job, not an afterthought: an artifact nobody
    // has ever restored is an assumption, not a backup.
    const verification = await verifyBackup(dailyKey);
    const durationMs = Date.now() - startedAt;

    if (env.backupVerifyDatabaseUrl && !verification.verified) {
      logger.error("backup restore verification failed", { key: dailyKey, message: verification.message });
      return {
        success: false,
        message: `Копия загружена (${dailyKey}), но проверка восстановления не прошла: ${verification.message}`,
        key: dailyKey,
        size: encryption.size,
        plaintextSize: encryption.plaintextSize,
        durationMs,
        verified: false,
      };
    }

    return {
      success: true,
      message: `Резервная копия загружена: ${dailyKey} (${verification.message})`,
      key: dailyKey,
      size: encryption.size,
      plaintextSize: encryption.plaintextSize,
      durationMs,
      verified: verification.verified,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("backup failed", { error: message, durationMs: Date.now() - startedAt });
    return {
      success: false,
      message: `Резервное копирование не удалось: ${message}`,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    // The plaintext dump and the defaults file (which holds the password) must not
    // outlive the run.
    await rm(dir, { recursive: true, force: true });
  }
}
