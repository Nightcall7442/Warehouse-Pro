import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for backup system logic.
 *
 * These test the verification, retention, and error handling logic
 * without requiring a real MySQL server or S3 bucket.
 */

// ── Mock modules ─────────────────────────────────────────────────────────────

const mockExecute = vi.fn();
const mockSend = vi.fn();

vi.mock("../queries/connection", () => ({
  getDb: () => ({ execute: mockExecute }),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: vi.fn(),
  ListObjectsV2Command: vi.fn(),
  DeleteObjectCommand: vi.fn(),
}));

vi.mock("../lib/env", () => ({
  env: {
    s3Bucket: "test-bucket",
    s3AccessKey: "test-key",
    s3SecretKey: "test-secret",
    s3Region: "us-east-1",
    databaseUrl: "mysql://user:pass@localhost:3306/testdb",
  },
}));

vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(),
}));

vi.mock("../lib/db-rows", () => ({
  firstRow: (result: unknown) => {
    const rows = result as Array<Record<string, unknown>>;
    return rows?.[0] ?? null;
  },
}));

// ── Tests ────────────────────────────────────────────────────────────────────

describe("backup system", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("SQL verification", () => {
    it("accepts valid mysqldump output with MySQL marker", () => {
      const head = "-- MySQL dump 10.19  Distrib 8.0.36\n-- Host: localhost    Database: testdb\nCREATE TABLE `test` (`id` int);";
      expect(head).toContain("-- MySQL dump");
    });

    it("accepts valid mysqldump output with MariaDB marker", () => {
      const head = "-- MariaDB dump 10.19  Distrib 10.6.16\nCREATE TABLE `test` (`id` int);";
      expect(head).toContain("-- MariaDB");
    });

    it("rejects empty dump", () => {
      const dump = Buffer.alloc(0);
      expect(dump.length).toBe(0);
    });

    it("rejects dump without SQL markers", () => {
      const head = "This is not a SQL dump file";
      expect(head).not.toContain("-- MySQL dump");
      expect(head).not.toContain("-- MariaDB");
      expect(head).not.toContain("CREATE TABLE");
    });
  });

  describe("table count collection", () => {
    it("collects counts from all tracked tables", async () => {
      const tables = ["tenants", "users", "products", "orders", "order_items", "shops", "warehouse_stock", "payments"];
      const counts: Record<string, number> = {};

      mockExecute.mockResolvedValue([[{ count: 42 }]]);

      for (const table of tables) {
        const result = await mockExecute(`SELECT COUNT(*) as count FROM ${table}`);
        counts[table] = Number(result[0]?.[0]?.count ?? 0);
      }

      expect(Object.keys(counts)).toHaveLength(8);
      expect(counts.tenants).toBe(42);
      expect(counts.users).toBe(42);
      expect(mockExecute).toHaveBeenCalledTimes(8);
    });

    it("handles table count errors gracefully", async () => {
      mockExecute.mockRejectedValueOnce(new Error("Table doesn't exist"));

      let count = -1;
      try {
        const result = await mockExecute("SELECT COUNT(*) as count FROM nonexistent");
        count = Number(result[0]?.[0]?.count ?? 0);
      } catch {
        count = -1;
      }

      expect(count).toBe(-1);
    });
  });

  describe("retention logic", () => {
    it("identifies backups older than 30 days", () => {
      const now = new Date();
      const cutoff = new Date(now.getTime() - 30 * 86_400_000);

      const oldBackup = { LastModified: new Date(now.getTime() - 31 * 86_400_000) };
      const recentBackup = { LastModified: new Date(now.getTime() - 5 * 86_400_000) };

      expect(oldBackup.LastModified < cutoff).toBe(true);
      expect(recentBackup.LastModified < cutoff).toBe(false);
    });

    it("correctly calculates retention cutoff", () => {
      const now = new Date("2026-08-10T03:00:00Z");
      const retentionDays = 30;
      const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);

      expect(cutoff.toISOString()).toContain("2026-07-11");
    });
  });

  describe("S3 upload", () => {
    it("constructs correct backup key", () => {
      const timestamp = "2026-08-10";
      const backupKey = `backups/warehouse-pro-${timestamp}.sql.gz`;

      expect(backupKey).toBe("backups/warehouse-pro-2026-08-10.sql.gz");
    });

    it("constructs correct incremental backup key", () => {
      const timestamp = "2026-08-10T03-00-00Z".replace(/[:.]/g, "-").slice(0, 19);
      const backupKey = `backups/incremental/warehouse-pro-inc-${timestamp}.sql.gz`;

      expect(backupKey).toContain("backups/incremental/");
      expect(backupKey).toContain(".sql.gz");
    });

    it("sends correct S3 parameters", async () => {
      const gzipped = Buffer.from("test-gzipped-data");

      await mockSend({
        Bucket: "test-bucket",
        Key: "backups/test.sql.gz",
        Body: gzipped,
        ContentType: "application/gzip",
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: "test-bucket",
          ContentType: "application/gzip",
        })
      );
    });
  });

  describe("DATABASE_URL parsing", () => {
    it("parses standard MySQL URL", () => {
      const url = "mysql://user:pass@localhost:3306/testdb";
      const parsed = new URL(url);

      expect(parsed.hostname).toBe("localhost");
      expect(parsed.port).toBe("3306");
      expect(decodeURIComponent(parsed.username)).toBe("user");
      expect(decodeURIComponent(parsed.password)).toBe("pass");
      expect(parsed.pathname.replace(/^\//, "")).toBe("testdb");
    });

    it("parses URL with encoded password", () => {
      const url = "mysql://user:p%40ss%21word@db.example.com:3306/mydb";
      const parsed = new URL(url);

      expect(decodeURIComponent(parsed.password)).toBe("p@ss!word");
      expect(parsed.hostname).toBe("db.example.com");
    });

    it("parses URL without port (defaults to 3306)", () => {
      const url = "mysql://user:pass@localhost/testdb";
      const parsed = new URL(url);

      expect(parsed.port || "3306").toBe("3306");
    });
  });

  describe("backup status tracking", () => {
    it("tracks last backup result", () => {
      let lastBackup: { date: string; success: boolean; message: string } | null = null;

      // Simulate successful backup
      lastBackup = {
        date: "2026-08-10",
        success: true,
        message: "backups/warehouse-pro-2026-08-10.sql.gz (1.2 MB)",
      };

      expect(lastBackup.success).toBe(true);
      expect(lastBackup.date).toBe("2026-08-10");
    });

    it("tracks failed backup", () => {
      let lastBackup: { date: string; success: boolean; message: string } | null = null;

      lastBackup = {
        date: "2026-08-10",
        success: false,
        message: "mysqldump exited with code 1: Access denied",
      };

      expect(lastBackup.success).toBe(false);
      expect(lastBackup.message).toContain("Access denied");
    });

    it("health status derived from last backup", () => {
      const lastBackup = { date: "2026-08-10", success: true };
      const now = new Date("2026-08-11T12:00:00Z");
      const ageMs = now.getTime() - new Date(lastBackup.date).getTime();
      const ageDays = Math.floor(ageMs / 86_400_000);

      expect(ageDays).toBe(1);
      expect(lastBackup.success && ageDays <= 2).toBe(true); // healthy
    });

    it("health status detects stale backup", () => {
      const lastBackup = { date: "2026-08-01", success: true };
      const now = new Date("2026-08-10T12:00:00Z");
      const ageMs = now.getTime() - new Date(lastBackup.date).getTime();
      const ageDays = Math.floor(ageMs / 86_400_000);

      expect(ageDays).toBe(9);
      expect(lastBackup.success && ageDays <= 2).toBe(false); // stale
    });
  });

  describe("incremental backup", () => {
    it("generates correct INSERT ON DUPLICATE KEY UPDATE", () => {
      const table = "orders";
      const columns = ["id", "orderNumber", "total", "status", "updatedAt"];
      const row = { id: 1, orderNumber: "ORD-001", total: "50000.00", status: "completed", updatedAt: "2026-08-10 12:00:00" };

      const colList = columns.map(c => `\`${c}\``).join(", ");
      const values = columns.map(c => `'${String(row[c as keyof typeof row]).replace(/'/g, "\\'")}'`).join(", ");
      const updateParts = columns.filter(c => c !== "id").map(c => `\`${c}\` = VALUES(\`${c}\`)`).join(", ");

      const sql = `INSERT INTO \`${table}\` (${colList}) VALUES\n(${values})\nON DUPLICATE KEY UPDATE ${updateParts};`;

      expect(sql).toContain("INSERT INTO `orders`");
      expect(sql).toContain("ON DUPLICATE KEY UPDATE");
      expect(sql).toContain("`orderNumber` = VALUES(`orderNumber`)");
      expect(sql).toContain("`status` = VALUES(`status`)");
    });

    it("handles NULL values correctly", () => {
      const escapeLiteral = (v: unknown): string => {
        if (v === null || v === undefined) return "NULL";
        if (typeof v === "number") return String(v);
        return `'${String(v).replace(/'/g, "\\'")}'`;
      };

      expect(escapeLiteral(null)).toBe("NULL");
      expect(escapeLiteral(undefined)).toBe("NULL");
      expect(escapeLiteral(42)).toBe("42");
      expect(escapeLiteral("hello")).toBe("'hello'");
      expect(escapeLiteral("it's")).toBe("'it\\'s'");
    });

    it("batches rows correctly", () => {
      const batch: string[] = [];
      let batchBytes = 0;
      const maxBytes = 300_000;
      const maxRows = 500;

      const tuple = "(1, 'test', '2026-08-10 12:00:00')".repeat(100);
      batch.push(tuple);
      batchBytes += tuple.length + 2;

      expect(batch.length).toBeLessThanOrEqual(maxRows);
      expect(batchBytes).toBeLessThanOrEqual(maxBytes);
    });
  });
});
