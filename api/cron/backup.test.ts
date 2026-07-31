import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `env` is a frozen object built at import time, so it is mocked rather than
 * poked at through process.env. Only the keys the backup job reads are provided.
 */
const mockEnv = {
  databaseUrl: "mysql://warehouse:s3cr3t@mysql:3306/warehouse_pro",
  s3Bucket: "",
  s3Region: "",
  s3AccessKey: "",
  s3SecretKey: "",
  backupEncryptionKey: "",
  backupVerifyDatabaseUrl: "",
  mysqldumpPath: "mysqldump",
  mysqlClientPath: "mysql",
  isProduction: false,
};

vi.mock("../lib/env", () => ({ env: mockEnv }));

const {
  connectionFromUrl,
  defaultsFileContents,
  mysqldumpArgs,
  artifactMetadata,
  runBackup,
  verifyBackup,
} = await import("./backup");

const KEY_HEX = "a".repeat(64);

beforeEach(() => {
  Object.assign(mockEnv, {
    databaseUrl: "mysql://warehouse:s3cr3t@mysql:3306/warehouse_pro",
    s3Bucket: "",
    s3Region: "",
    s3AccessKey: "",
    s3SecretKey: "",
    backupEncryptionKey: "",
    backupVerifyDatabaseUrl: "",
    mysqldumpPath: "mysqldump",
    mysqlClientPath: "mysql",
  });
});

describe("connectionFromUrl", () => {
  it("parses host, port, credentials and database", () => {
    expect(connectionFromUrl("mysql://user:pass@db.internal:3307/warehouse")).toEqual({
      host: "db.internal",
      port: 3307,
      user: "user",
      password: "pass",
      database: "warehouse",
    });
  });

  it("defaults the port to 3306", () => {
    expect(connectionFromUrl("mysql://user:pass@db.internal/warehouse").port).toBe(3306);
  });

  it("decodes percent-escaped credentials", () => {
    const conn = connectionFromUrl("mysql://us%40er:p%40ss%3Aword@db/warehouse_pro");
    expect(conn.user).toBe("us@er");
    expect(conn.password).toBe("p@ss:word");
  });

  it("accepts the mysql2 scheme variants", () => {
    expect(connectionFromUrl("mysql2://user:pass@db/warehouse").database).toBe("warehouse");
  });

  it("rejects a URL without a database name", () => {
    expect(() => connectionFromUrl("mysql://user:pass@db")).toThrow(/не содержит имя базы данных/);
    expect(() => connectionFromUrl("mysql://user:pass@db/")).toThrow(/не содержит имя базы данных/);
  });

  it("rejects a non-mysql scheme and unparseable input", () => {
    expect(() => connectionFromUrl("postgres://user:pass@db/warehouse")).toThrow(/Ожидался mysql/);
    expect(() => connectionFromUrl("not a url")).toThrow(/не удалось разобрать/);
  });
});

describe("credentials handling", () => {
  const conn = connectionFromUrl("mysql://warehouse:s3cr3t@mysql:3306/warehouse_pro");

  it("puts the password in a [client] defaults file", () => {
    const contents = defaultsFileContents(conn);
    expect(contents.startsWith("[client]\n")).toBe(true);
    expect(contents).toContain("password=s3cr3t");
    expect(contents).toContain("host=mysql");
    expect(contents).toContain("port=3306");
    expect(contents).toContain("user=warehouse");
  });

  it("keeps the password out of argv, where any process could read it via ps", () => {
    const args = mysqldumpArgs("/tmp/x/my.cnf", conn);
    expect(args.join(" ")).not.toContain("s3cr3t");
    expect(args.some(a => a.startsWith("--password"))).toBe(false);
    expect(args[0]).toBe("--defaults-extra-file=/tmp/x/my.cnf");
  });

  it("dumps consistently and without CREATE DATABASE, so a restore can target any schema", () => {
    const args = mysqldumpArgs("/tmp/x/my.cnf", conn);
    expect(args).toContain("--single-transaction");
    expect(args).toContain("--routines");
    expect(args).toContain("--triggers");
    expect(args).toContain("--default-character-set=utf8mb4");
    expect(args).not.toContain("--databases");
    expect(args[args.length - 1]).toBe("warehouse_pro");
  });
});

describe("artifactMetadata", () => {
  const meta = artifactMetadata({
    timestamp: "2026-07-31T02:00:00.000Z",
    iv: "0".repeat(24),
    authTag: "1".repeat(32),
    checksum: "2".repeat(64),
    size: 1234,
    plaintextChecksum: "3".repeat(64),
    plaintextSize: 98765,
    database: "warehouse_pro",
  });

  it("carries everything a restore needs", () => {
    expect(meta.iv).toBe("0".repeat(24));
    expect(meta.authtag).toBe("1".repeat(32));
    expect(meta.checksum).toBe("2".repeat(64));
    expect(meta["plaintext-checksum"]).toBe("3".repeat(64));
    expect(meta.algorithm).toBe("aes-256-gcm");
    expect(meta.compression).toBe("gzip");
    expect(meta.database).toBe("warehouse_pro");
    expect(meta.tenant).toBe("all");
  });

  it("uses lower-case keys and string values, as S3 stores them", () => {
    for (const [key, value] of Object.entries(meta)) {
      expect(key).toBe(key.toLowerCase());
      expect(typeof value).toBe("string");
    }
    expect(meta.size).toBe("1234");
    expect(meta["plaintext-size"]).toBe("98765");
  });

  it("never carries the encryption key or a password", () => {
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain("s3cr3t");
    expect(serialized).not.toContain(KEY_HEX);
  });
});

describe("runBackup guards", () => {
  it("fails when S3 is not configured instead of reporting success", async () => {
    // The previous implementation logged "Backup verified (no S3 configured)" and
    // returned success — a green cron job with no artifact anywhere.
    const result = await runBackup(new Date("2026-07-31T02:00:00Z"));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/S3 не настроен/);
    expect(result.key).toBeUndefined();
  });

  it("fails when the encryption key is missing rather than uploading plaintext", async () => {
    Object.assign(mockEnv, { s3Bucket: "b", s3AccessKey: "k", s3SecretKey: "s" });

    const result = await runBackup(new Date("2026-07-31T02:00:00Z"));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/BACKUP_ENCRYPTION_KEY не задан/);
  });

  it("fails when the key is the wrong length", async () => {
    Object.assign(mockEnv, { s3Bucket: "b", s3AccessKey: "k", s3SecretKey: "s", backupEncryptionKey: "abc" });

    const result = await runBackup(new Date("2026-07-31T02:00:00Z"));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/32 байт в hex/);
  });

  it("reports a missing mysqldump binary clearly", async () => {
    Object.assign(mockEnv, {
      s3Bucket: "b",
      s3AccessKey: "k",
      s3SecretKey: "s",
      backupEncryptionKey: KEY_HEX,
      mysqldumpPath: "/nonexistent/mysqldump",
    });

    const result = await runBackup(new Date("2026-07-31T02:00:00Z"));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Не найден исполняемый файл \/nonexistent\/mysqldump/);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("surfaces a non-zero exit from the dump, with stderr", async () => {
    Object.assign(mockEnv, {
      s3Bucket: "b",
      s3AccessKey: "k",
      s3SecretKey: "s",
      backupEncryptionKey: KEY_HEX,
      // `false` exits 1 without output — stands in for a dump that fails on connect.
      mysqldumpPath: "false",
    });

    const result = await runBackup(new Date("2026-07-31T02:00:00Z"));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/завершился с кодом 1/);
  });

  it("rejects an empty dump instead of uploading it", async () => {
    Object.assign(mockEnv, {
      s3Bucket: "b",
      s3AccessKey: "k",
      s3SecretKey: "s",
      backupEncryptionKey: KEY_HEX,
      // `true` exits 0 with no output — an "empty backup" that must not be trusted.
      mysqldumpPath: "true",
    });

    const result = await runBackup(new Date("2026-07-31T02:00:00Z"));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/пустой дамп/);
  });
});

describe("verifyBackup guards", () => {
  it("reports skipped when S3 is not configured", async () => {
    await expect(verifyBackup("backups/daily/warehouse-pro-2026-07-31.sql.gz.enc")).resolves.toEqual({
      verified: false,
      message: expect.stringMatching(/S3 не настроен/),
    });
  });

  it("reports skipped when no scratch database is configured", async () => {
    Object.assign(mockEnv, { s3Bucket: "b", s3AccessKey: "k", s3SecretKey: "s", backupEncryptionKey: KEY_HEX });

    await expect(verifyBackup("backups/daily/warehouse-pro-2026-07-31.sql.gz.enc")).resolves.toEqual({
      verified: false,
      message: expect.stringMatching(/BACKUP_VERIFY_DATABASE_URL не задан/),
    });
  });
});
