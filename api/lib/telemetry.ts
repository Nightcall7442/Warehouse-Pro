import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { trace, diag, DiagConsoleLogger, DiagLogLevel, type Tracer } from "@opentelemetry/api";
import { env } from "./env";

/* ═══════════════════════════════════════════════════════════════════════════
   Трассировка запросов (OTLP → Jaeger, Tempo — что угодно принимающее OTLP).

   ── Почему здесь нет автоматической подмены ────────────────────────────────

   Раньше модуль подключал getNodeAutoInstrumentations — набор, который сам
   заворачивает http, клиент базы и Redis и выдаёт подробные промежутки без
   единой строки нашего кода. Выглядело это готовой трассировкой, но не
   работало ни одного дня, по двум причинам, и обе проверены опытом:

   1. initTelemetry() не вызывался нигде. Модуль был написан и мёртв: задавать
      OTEL_EXPORTER_OTLP_ENDPOINT можно было сколько угодно.

   2. Даже вызванный, он ничего бы не подменил. Автоматическая подмена
      перехватывает require, а сервер собирается в ESM. Проверено напрямую:
      запустить SDK и сравнить http.request до и после — функция та же самая.
      Порядок импортов не спасает, побочный импорт первой строкой тоже не
      подменяет. Для ESM нужен отдельный загрузчик, подключаемый флагом
      запуска (--import), а флаг здесь ненадёжен: railway.json переопределяет
      команду запуска, и на этом уже однажды потерялись миграции.

   Поэтому промежутки ставятся руками, в нашем собственном слое обработки
   запроса. Это не зависит ни от сборки, ни от формата модулей — тоже
   проверено: промежуток доходит до приёмника OTLP с именем и атрибутами.

   Пакет @opentelemetry/auto-instrumentations-node остался в зависимостях, но
   больше не используется — его стоит убрать отдельной правкой.

   ── Что попадает в трассировку ─────────────────────────────────────────────

   Один промежуток на запрос: шаблон маршрута, метод, ответ, длительность и
   идентификатор запроса, по которому та же история находится в журнале.
   Промежутков по обращениям к базе здесь нет: их пришлось бы расставлять
   вручную по службам, и это отдельная работа.
   ═══════════════════════════════════════════════════════════════════════════ */

let sdk: NodeSDK | null = null;

export function initTelemetry() {
  if (!env.otelExporterUrl) return;

  /**
   * Неудачную отправку трасс надо видеть.
   *
   * Без этого вывода OpenTelemetry молчит: приёмник недоступен, адрес указан
   * с ошибкой, порт не тот — а в журнале ничего, и «трассировка настроена»
   * выглядит правдой ровно до того мига, когда в Jaeger решают посмотреть.
   * Уровень WARN, а не DEBUG: обычная работа остаётся тихой.
   */
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

  sdk = new NodeSDK({
    serviceName: "warehouse-pro",
    traceExporter: new OTLPTraceExporter({ url: env.otelExporterUrl }),
  });

  sdk.start();
}

/** Включена ли трассировка. Пока адрес не задан, промежутки не создаются. */
export function isTracingEnabled(): boolean {
  return sdk !== null;
}

let tracer: Tracer | null = null;

export function getTracer(): Tracer {
  if (!tracer) tracer = trace.getTracer("warehouse-pro");
  return tracer;
}

export async function shutdownTelemetry() {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}
