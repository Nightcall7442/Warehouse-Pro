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

export const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "path", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
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

/**
 * Render all registered metrics in Prometheus exposition format.
 */
export async function getMetricsText(): Promise<string> {
  return register.metrics();
}

export const prometheusContentType = register.contentType;
