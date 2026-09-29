/**
 * Трассы доходят до приёмника, когда задан OTEL_EXPORTER_OTLP_ENDPOINT.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Из четырёх пакетов OpenTelemetry в dependencies один —
 * auto-instrumentations-node — не импортировался нигде и тянул в боевой образ
 * сотню пакетов. 29.09.2026 его убрали. Три оставшихся (sdk-node, экспортёр
 * OTLP по http и api) — ровно то, чем api/lib/telemetry.ts пишет трассы, и
 * убрать «лишнее» здесь легко вместе с нужным: трассировка при этом молчит,
 * сервер работает, и пропажу замечают, только когда открывают Jaeger.
 *
 * До этой проверки путь «адрес задан → промежуток ушёл» не проверялся ничем:
 * соседние проверки читают исходник boot.ts, а не отправку.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Настоящий модуль трассировки с настоящим экспортёром шлёт промежуток на
 * настоящий HTTP-приёмник, поднятый здесь же, — с именем и атрибутом. Без
 * адреса трассировка выключена и не шлёт ничего.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const SAVED = { ...process.env };

/** Приёмник OTLP: запоминает, что пришло, и отвечает «принято». */
async function startReceiver() {
  const received: { path: string; body: string }[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      received.push({ path: req.url ?? "", body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>(ok => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1/traces`,
    received,
    close: () => new Promise<void>(ok => server.close(() => ok())),
  };
}

beforeEach(() => {
  vi.resetModules();
  process.env.APP_SECRET = "секрет-для-проверки";
  process.env.DATABASE_URL = "mysql://root@127.0.0.1:3306/test";
});

afterEach(() => {
  process.env = { ...SAVED };
});

describe("трассировка", () => {
  it("с заданным адресом промежуток доходит до приёмника", async () => {
    const rx = await startReceiver();
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = rx.url;
    const telemetry = await import("../lib/telemetry");
    try {
      telemetry.initTelemetry();
      expect(telemetry.isTracingEnabled()).toBe(true);

      const span = telemetry.getTracer().startSpan("GET /api/trpc/probe.check");
      span.setAttribute("http.route", "/api/trpc/probe.check");
      span.end();
      // Отправка пакетная: shutdown досылает накопленное и ждёт ответа.
      await telemetry.shutdownTelemetry();

      const traces = rx.received.filter(r => r.path === "/v1/traces");
      expect(traces.length, "на адрес трасс не пришло ни одного запроса").toBeGreaterThan(0);
      const body = traces.map(r => r.body).join("\n");
      expect(body).toContain("GET /api/trpc/probe.check");
      expect(body).toContain("http.route");
      // Именно атрибут службы, а не просто строка: имя трассировщика тоже
      // «warehouse-pro», и без serviceName Jaeger показал бы «unknown_service».
      expect(body, "имя службы потерялось — в Jaeger трассы не найти")
        .toMatch(/"key":"service\.name","value":\{"stringValue":"warehouse-pro"\}/);
    } finally {
      await telemetry.shutdownTelemetry();
      await rx.close();
    }
  });

  it("без адреса трассировка выключена и ничего не шлёт", async () => {
    const rx = await startReceiver();
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
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
});
