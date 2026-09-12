// Prometheus metrics collection.
//
// Exposes counters/histograms/gauges for HTTP traffic, plus prom-client's
// built-in Node.js process metrics (memory, heap, event loop lag, GC), so
// Prometheus can scrape `/metrics` and Grafana can chart both request-level
// and runtime-level health from one place.
import client from "prom-client";
import { env } from "./lib/env";

// A dedicated registry (rather than the global default one) keeps this
// module's metrics isolated from anything else that might import prom-client.
export const register = new client.Registry();

register.setDefaultLabels({ app: "warehouse-pro" });

// Node.js process metrics: nodejs_heap_*, nodejs_eventloop_lag_seconds,
// process_cpu_*, etc. `nodejs_heap_size_used_bytes` is what we surface as
// memory usage; `nodejs_heap_space_size_used_bytes` covers heap objects by
// space (old/new/large object space).
if (env.prometheusEnabled) {
  client.collectDefaultMetrics({ register, prefix: "" });
}

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "path", "status"] as const,
  registers: [register],
});

/*
  Кто и какой версией ходит. Заголовок x-client-version ставят веб
  (сборка) и мобилка (app.json); без него — «unknown». По этой метрике видно,
  сколько телефонов ещё на старой сборке — до этого о версиях в поле не
  знал никто, и ошибка «у агента не работает» не привязывалась к сборке.
  Версия — из заголовка, но ограниченной формы (см. boot.ts): произвольная
  строка от клиента раздула бы набор меток.
*/
export const clientRequestsTotal = new client.Counter({
  name: "client_requests_total",
  help: "Requests by client kind and version (x-client-version header)",
  labelNames: ["client", "version"] as const,
  registers: [register],
});

/** Фото с сессионным токеном в адресе (?token=) — сколько и какие сборки ещё так ходят. */
export const legacyPhotoTokenTotal = new client.Counter({
  name: "legacy_photo_query_token_total",
  help: "Photo requests that still pass the session token in the URL, by client version",
  labelNames: ["client", "version"] as const,
  registers: [register],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "path", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

/*
  По процедурам tRPC, а не по HTTP-пути: все вызовы приложения идут через
  /api/trpc/*, и http_request_duration_seconds видит их одной строкой.
  Какая именно ручка тормозит или сыплет отказами — только отсюда.
  Метка path — имя процедуры (order.create), их конечное число.
*/
export const trpcProcedureDurationSeconds = new client.Histogram({
  name: "trpc_procedure_duration_seconds",
  help: "tRPC procedure duration in seconds, by procedure path and outcome",
  labelNames: ["path", "type", "ok"] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});
export const trpcProcedureErrorsTotal = new client.Counter({
  name: "trpc_procedure_errors_total",
  help: "tRPC procedure errors by path and tRPC error code",
  labelNames: ["path", "code"] as const,
  registers: [register],
});

export const httpRequestsActive = new client.Gauge({
  name: "http_requests_active",
  help: "Number of HTTP requests currently being processed",
  registers: [register],
});

export const httpRequestErrorsTotal = new client.Counter({
  name: "http_request_errors_total",
  help: "Total number of HTTP requests that resulted in an error (5xx or thrown exception)",
  labelNames: ["method", "path", "status"] as const,
  registers: [register],
});

/*
  Возраст последней удачной копии. Ночная копия «отрабатывала» отказом в
  журнал, который никто не читает, — и о том, что копий нет, узнали через
  месяцы. Правило в docs/observability/alerts.yml тревожит, когда метрики
  нет 26 часов или она старше 26 часов. Значение живёт в памяти процесса:
  после перезапуска метрика отсутствует до следующей копии — поэтому у
  правила `for: 26h`, а не мгновенное срабатывание.
*/
export const backupLastSuccessTimestamp = new client.Gauge({
  name: "backup_last_success_timestamp_seconds",
  help: "Unix time of the last successful database backup upload",
  registers: [register],
});
export const restoreDrillLastSuccessTimestamp = new client.Gauge({
  name: "backup_restore_drill_last_success_timestamp_seconds",
  help: "Unix time of the last successful restore drill (latest backup restored into a scratch database and verified)",
  registers: [register],
});
export const backupLastSizeBytes = new client.Gauge({
  name: "backup_last_size_bytes",
  help: "Gzipped size of the last successful database backup",
  registers: [register],
});

/**
 * Render all registered metrics in Prometheus exposition format.
 */
export async function getMetricsText(): Promise<string> {
  return register.metrics();
}

export const prometheusContentType = register.contentType;
