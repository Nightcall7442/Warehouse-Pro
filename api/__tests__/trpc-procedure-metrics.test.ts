/**
 * Метрики по процедурам tRPC: какая ручка тормозит и какая падает.
 * http_request_duration_seconds видит все вызовы приложения одной строкой
 * /api/trpc/*; здесь — по имени процедуры, первым слоем, чтобы в замер
 * попали и отказы доступа, и лимиты.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { register, trpcProcedureDurationSeconds, trpcProcedureErrorsTotal } from "../prometheus-metrics";

describe("метрики процедур", () => {
  it("гистограмма и счётчик ошибок зарегистрированы с метками path/type/ok и path/code", async () => {
    trpcProcedureDurationSeconds.observe({ path: "order.create", type: "mutation", ok: "1" }, 0.12);
    trpcProcedureErrorsTotal.inc({ path: "order.create", code: "FORBIDDEN" });
    const text = await register.metrics();
    const lines = text.split("\n").filter(l => l.startsWith("trpc_procedure_duration_seconds_count") || l.startsWith("trpc_procedure_errors_total{"));
    // Реестр добавляет метку app="warehouse-pro" — проверяем свои метки, не порядок.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^trpc_procedure_duration_seconds_count\{.*path="order\.create".*type="mutation".*ok="1".*\} 1$/);
    expect(lines[1]).toMatch(/^trpc_procedure_errors_total\{.*path="order\.create".*code="FORBIDDEN".*\} 1$/);
  });

  it("слой стоит первым у публичных и у защищённых процедур; ошибка считается и летит дальше", () => {
    const src = readFileSync("api/middleware.ts", "utf-8");
    expect(src).toContain("const basePublic = t.procedure.use(withProcedureMetrics).use(withCorrelationId);");
    expect(src).toContain("export const authedQuery     = t.procedure.use(withProcedureMetrics).use(withCorrelationId)");
    const mw = src.slice(src.indexOf("const withProcedureMetrics"), src.indexOf("const withCorrelationId"));
    expect(mw).toContain("if (!result.ok) trpcProcedureErrorsTotal.inc({ path, code: result.error.code });");
    expect(mw).toContain("return result;");
  });

  it("Prometheus знает экспортёры, AlertManager — второй канал; правила по ним есть", () => {
    const prom = readFileSync("docs/observability/prometheus.yml", "utf-8");
    expect(prom).toContain("mysqld-exporter.railway.internal:9104");
    expect(prom).toContain("redis-exporter.railway.internal:9121");
    const am = readFileSync("docs/observability/alertmanager.yml", "utf-8");
    expect(am).toContain("/api/webhooks/alertmanager?secret=$ALERTMANAGER_WEBHOOK_SECRET");
    expect(am).toMatch(/- receiver: app-webhook\s+continue: true/);
    const alerts = readFileSync("docs/observability/alerts.yml", "utf-8");
    for (const name of ["ПроцедураОтказывает", "ПроцедураМедленная", "RedisНедоступен", "СоединенийСБазойПочтиПредел"]) expect(alerts).toContain(`alert: ${name}`);
    // по экспортёрам — без absent(): пока их нет, тревоги молчат
    const tail = alerts.slice(alerts.indexOf("name: mysql-redis"));
    expect(tail).not.toContain("absent(");
  });
});
