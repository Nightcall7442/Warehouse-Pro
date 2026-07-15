import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { env } from "./env";

let sdk: NodeSDK | null = null;

export function initTelemetry() {
  if (!env.otelExporterUrl) {
    diag.info("OpenTelemetry disabled — no OTEL_EXPORTER_OTLP_ENDPOINT configured");
    return;
  }

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

  sdk = new NodeSDK({
    serviceName: "warehouse-pro",
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-http": { enabled: true },
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
    traceExporter: new OTLPTraceExporter({
      url: env.otelExporterUrl,
    }),
  });

  sdk.start();
  diag.info("OpenTelemetry SDK started");
}

export async function shutdownTelemetry() {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}
