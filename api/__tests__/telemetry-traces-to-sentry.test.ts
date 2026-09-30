/**
 * Трассы в Sentry — адрес и ключ из SENTRY_DSN, по одному флажку.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * 30.09.2026 свой Jaeger из боя убран: держал 1 ГБ памяти (≈ $10 в месяц),
 * v1 без исправлений безопасности. Sentry у владельца уже есть и принимает
 * трассы по OTLP, но для этого нужны адрес вида
 * `/api/<проект>/integration/otlp/v1/traces` и заголовок
 * `x-sentry-auth: sentry sentry_key=<ключ>` — вписывать ключ руками в
 * переменные значит держать его в двух местах и ошибиться в формате
 * (без слова «sentry» Sentry отвечает 401).
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   - из DSN получаются ровно адрес и заголовок Sentry; кривой DSN — ничего;
 *   - OTEL_TRACES_TO_SENTRY=1 + SENTRY_DSN → промежуток настоящим
 *     экспортёром доходит на адрес Sentry с ключом в заголовке;
 *   - без флажка DSN ничего не включает;
 *   - явный OTEL_EXPORTER_OTLP_ENDPOINT главнее флажка.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const SAVED = { ...process.env };

async function startReceiver() {
  const received: { path: string; auth: string | undefined; body: string }[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      received.push({ path: req.url ?? "", auth: req.headers["x-sentry-auth"] as string | undefined, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>(ok => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  return { port, received, close: () => new Promise<void>(ok => server.close(() => ok())) };
}

beforeEach(async () => {
  // Поставщик трасс регистрируется глобально, раз на процесс: без сброса
  // второй тест файла молча писал бы в поставщика первого, уже закрытого.
  (await import("@opentelemetry/api")).trace.disable();
  vi.resetModules();
  process.env.APP_SECRET = "секрет-для-проверки";
  process.env.DATABASE_URL = "mysql://root@127.0.0.1:3306/test";
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_TRACES_TO_SENTRY;
  delete process.env.SENTRY_DSN;
});

afterEach(() => {
  process.env = { ...SAVED };
});

describe("адрес Sentry из DSN", () => {
  it("адрес трасс и заголовок с ключом", async () => {
    const { sentryOtlpTarget } = await import("../lib/telemetry");
    expect(sentryOtlpTarget("https://abc123@o4507.ingest.us.sentry.io/4508123")).toEqual({
      url: "https://o4507.ingest.us.sentry.io/api/4508123/integration/otlp/v1/traces",
      headers: { "x-sentry-auth": "sentry sentry_key=abc123" },
    });
  });

  it("кривой DSN — никуда не слать", async () => {
    const { sentryOtlpTarget } = await import("../lib/telemetry");
    expect(sentryOtlpTarget("не адрес")).toBeNull();
    expect(sentryOtlpTarget("https://o4507.ingest.us.sentry.io/4508123")).toBeNull(); // без ключа
    expect(sentryOtlpTarget("https://abc@o4507.ingest.us.sentry.io/")).toBeNull();      // без проекта
  });
});

describe("трассы в Sentry по флажку", () => {
  it("флажок и DSN — промежуток уходит на адрес Sentry с ключом", async () => {
    const rx = await startReceiver();
    process.env.OTEL_TRACES_TO_SENTRY = "1";
    process.env.SENTRY_DSN = `http://publickey42@127.0.0.1:${rx.port}/77`;
    const telemetry = await import("../lib/telemetry");
    try {
      telemetry.initTelemetry();
      expect(telemetry.isTracingEnabled()).toBe(true);
      const span = telemetry.getTracer().startSpan("GET /api/trpc/probe.check");
      span.end();
      await telemetry.shutdownTelemetry();

      const hits = rx.received.filter(r => r.path === "/api/77/integration/otlp/v1/traces");
      expect(hits.length, "на адрес трасс Sentry не пришло ничего").toBeGreaterThan(0);
      expect(hits[0].auth).toBe("sentry sentry_key=publickey42");
      expect(hits.map(h => h.body).join("\n")).toContain("GET /api/trpc/probe.check");
    } finally {
      await telemetry.shutdownTelemetry();
      await rx.close();
    }
  });

  it("DSN без флажка трассировку не включает", async () => {
    const rx = await startReceiver();
    process.env.SENTRY_DSN = `http://publickey42@127.0.0.1:${rx.port}/77`;
    const telemetry = await import("../lib/telemetry");
    try {
      telemetry.initTelemetry();
      expect(telemetry.isTracingEnabled()).toBe(false);
      await telemetry.shutdownTelemetry();
      expect(rx.received).toEqual([]);
    } finally {
      await rx.close();
    }
  });

  it("явный адрес приёмника главнее флажка", async () => {
    const own = await startReceiver();
    const sentry = await startReceiver();
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${own.port}/v1/traces`;
    process.env.OTEL_TRACES_TO_SENTRY = "1";
    process.env.SENTRY_DSN = `http://publickey42@127.0.0.1:${sentry.port}/77`;
    const telemetry = await import("../lib/telemetry");
    try {
      telemetry.initTelemetry();
      telemetry.getTracer().startSpan("GET /probe").end();
      await telemetry.shutdownTelemetry();
      expect(own.received.some(r => r.path === "/v1/traces")).toBe(true);
      expect(sentry.received).toEqual([]);
    } finally {
      await telemetry.shutdownTelemetry();
      await own.close();
      await sentry.close();
    }
  });
});
