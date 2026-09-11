/**
 * Ночная копия уходит и за пределы площадки, и об удаче остаётся метрика.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Единственное S3 — MinIO в том же проекте Railway, что и база; снимки тома
 * — там же. Потеря доступа к проекту (спор об оплате, компрометация, ошибка
 * поставщика) означала потерю данных 13 организаций: копии «вне Railway» не
 * существовало, кроме задачи Windows на ноутбуке владельца. А о том, что
 * копия не снималась, никто не узнавал: работа «отрабатывала» отказом в
 * журнал, который не читают.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. Без BACKUP_S3_* — одна загрузка (как раньше), метрика выставлена.
 * 2. С BACKUP_S3_* — две загрузки с одним ключом и бакетом, вторая — через
 *    клиент с адресом зеркала.
 * 3. Отказ зеркала — отказ всей работы: копия только на площадке базы
 *    успехом не считается.
 * 4. В alerts.yml есть правило о возрасте копии с выдержкой не меньше 26 ч.
 *
 * Нарочная поломка: убери `await offsite.send(put())` — вторая проверка
 * падает (одна загрузка вместо двух).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envState: Record<string, unknown> = {
  isProduction: true,
  databaseUrl: "mysql://wp:secret@db-host:3306/warehouse",
  s3Bucket: "photos", s3Region: "auto", s3AccessKey: "k", s3SecretKey: "s",
  s3Endpoint: "http://minio.railway.internal:9000",
  backupS3Endpoint: "", backupS3Region: "auto", backupS3AccessKey: "", backupS3SecretKey: "", backupS3ForcePathStyle: false,
};
vi.mock("../lib/env", () => ({ env: envState }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../queries/connection", () => ({ getDb: () => ({}) }));
vi.mock("../services/db-dump", () => ({
  startDump: async () => ({
    stream: (await import("node:stream")).Readable.from([Buffer.from("gzipped-dump-bytes")]),
    filename: "warehouse-pro-2026-09-12.sql.gz",
    counts: { orders: 1 },
  }),
  DumpUnavailableError: class DumpUnavailableError extends Error {},
}));

/** Каждая загрузка помнит, через какой адрес входа она ушла. */
const puts: Array<{ endpoint: string; input: Record<string, unknown> }> = [];
let failEndpoint: string | null = null;
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    endpoint: string;
    constructor(cfg: { endpoint?: string }) { this.endpoint = cfg.endpoint ?? "aws"; }
    async send(command: { input: Record<string, unknown> }) {
      if (failEndpoint && this.endpoint === failEndpoint) throw new Error("offsite: connect ETIMEDOUT");
      puts.push({ endpoint: this.endpoint, input: command.input });
      return {};
    }
  },
  PutObjectCommand: class {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) { this.input = input; }
  },
}));

const { runBackup } = await import("../cron/backup");
const { backupLastSuccessTimestamp } = await import("../prometheus-metrics");

beforeEach(() => {
  puts.length = 0;
  failEndpoint = null;
  envState.backupS3Endpoint = "";
  envState.backupS3AccessKey = "";
  envState.backupS3SecretKey = "";
  backupLastSuccessTimestamp.set(0);
});

const offsite = () => {
  envState.backupS3Endpoint = "https://acc.r2.cloudflarestorage.com";
  envState.backupS3AccessKey = "r2-key";
  envState.backupS3SecretKey = "r2-secret";
};

const gaugeValue = async () => (await backupLastSuccessTimestamp.get()).values[0]?.value ?? 0;

describe("ночная копия и её зеркало", () => {
  it("без зеркала — одна загрузка, метрика выставлена", async () => {
    const r = await runBackup();
    expect(r.success).toBe(true);
    expect(puts).toHaveLength(1);
    expect(puts[0].endpoint).toBe("http://minio.railway.internal:9000");
    expect(await gaugeValue()).toBeGreaterThan(1_700_000_000);
  });

  it("с зеркалом — две загрузки одного файла, вторая через адрес зеркала", async () => {
    offsite();
    const r = await runBackup();
    expect(r.success).toBe(true);
    expect(r.message).toContain("mirrored offsite");
    expect(puts.map(p => p.endpoint)).toEqual(["http://minio.railway.internal:9000", "https://acc.r2.cloudflarestorage.com"]);
    expect(puts[0].input.Key).toBe(puts[1].input.Key);
    expect(puts[0].input.Bucket).toBe(puts[1].input.Bucket);
  });

  it("отказ зеркала — отказ работы, метрика не обновляется", async () => {
    offsite();
    failEndpoint = "https://acc.r2.cloudflarestorage.com";
    const r = await runBackup();
    expect(r.success).toBe(false);
    expect(r.message).toContain("ETIMEDOUT");
    expect(await gaugeValue()).toBe(0);
  });

  it("правило тревоги о возрасте копии есть и терпит перезапуск", () => {
    const alerts = readFileSync(resolve(__dirname, "../../docs/observability/alerts.yml"), "utf-8");
    const at = alerts.indexOf("КопияБазыУстарела");
    expect(at).toBeGreaterThan(0);
    const rule = alerts.slice(at, at + 900);
    expect(rule).toContain("backup_last_success_timestamp_seconds");
    expect(rule).toMatch(/for:\s*2[6-9]h|for:\s*[3-9]\dh/);
  });
});
