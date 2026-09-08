import { env } from "../lib/env";
import { register } from "../prometheus-metrics";

/* ═══════════════════════════════════════════════════════════════════════════
   Служебные приборы: где они, живы ли, и что горит прямо сейчас.

   ── Зачем это на странице мониторинга ───────────────────────────────────────

   У проекта восемь служб — Prometheus, Grafana, Loki, Jaeger, AlertManager,
   Redis, MySQL, само приложение. Страница мониторинга не знала ни об одной:
   она показывала свои числа и молчала о том, что рядом стоит целая обвязка.
   Владелец держал адреса в закладках и в голове, а «что сейчас горит» узнавал
   из телеграма.

   Задача этой страницы — не подменить Grafana, а быть входом: сказать, что не
   так, и увести в тот прибор, где лежат подробности.

   ── Публичный адрес и внутренний — разные вещи ──────────────────────────────

   У Loki публичного домена НЕТ намеренно: своей авторизации у него нет вовсе,
   и с доменом боевые журналы читались из интернета обычным curl. Поэтому
   ссылка в браузер для него невозможна, а проверка доступности — возможна, она
   идёт из приложения по внутренней сети.

   Отсюда два поля вместо одного: `url` — куда можно нажать, `internalUrl` —
   куда стучится проверка. У службы может быть только второе, и это не изъян
   настройки, а осознанное решение. К журналам ведёт Grafana, у которой вход
   есть.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Состояние прибора.
 *
 * `configured` стоит особняком: так помечена служба, которую мы намеренно не
 * проверяем, но про свою связь с ней знаем всё. Раньше на её месте стояло
 * «не проверяем» серым — рядом с пятью зелёными это читалось как поломка,
 * хотя означало ровно обратное.
 */
export type ServiceState = "ok" | "down" | "unknown" | "not_configured" | "configured";

export interface ObservabilityService {
  key: string;
  title: string;
  /** Что этот прибор отвечает человеку. */
  purpose: string;
  /** Куда нажать. Пусто — наружу служба не открыта. */
  url: string | null;
  /** Открыта ли она вообще снаружи. */
  publicAccess: boolean;
  state: ServiceState;
  /** Сколько миллисекунд отвечала проверка. */
  latencyMs: number | null;
  note?: string;
}

/**
 * Описание служб.
 *
 * Адреса берутся из переменных окружения: они разные у боевой среды и у
 * стенда, а зашитые в код однажды уведут владельца не туда. Не заданная
 * переменная — это «не настроено», а не «сломано», и на экране это разные
 * состояния.
 */
interface ServiceDef {
  key: string;
  title: string;
  purpose: string;
  /** Куда нажать. Пусто — наружу служба не открыта. */
  url: string | null;
  /** Куда стучится проверка. Пусто — не проверяем. */
  internal: string;
  probePath: string;
  /** Готовое состояние: для службы, которую мы намеренно не проверяем. */
  state?: ServiceState;
  note?: string;
}

function describe(): ServiceDef[] {
  return [
    {
      key: "grafana",
      title: "Grafana",
      purpose: "Графики и журналы: сюда идут за подробностями",
      url: env.grafanaUrl || null,
      internal: env.grafanaUrl,
      probePath: "/api/health",
    },
    {
      key: "prometheus",
      title: "Prometheus",
      purpose: "Хранит метрики приложения — источник графиков и тревог",
      url: env.prometheusUrl || null,
      internal: env.prometheusInternalUrl || env.prometheusUrl,
      probePath: "/-/healthy",
    },
    {
      key: "loki",
      title: "Loki",
      purpose: "Журналы приложения. Читать — через Grafana",
      // Наружу не открыт намеренно: своей авторизации у Loki нет.
      url: null,
      internal: env.lokiUrl.replace(/\/loki\/api\/v1\/push$/, ""),
      probePath: "/ready",
      note: "Наружу закрыт намеренно: своей защиты у Loki нет",
    },
    {
      key: "jaeger",
      title: "Jaeger",
      purpose: "Трассировки запросов: где именно ушло время",
      url: env.jaegerUrl || null,
      internal: env.jaegerUrl,
      probePath: "/",
    },
    {
      key: "alertmanager",
      title: "AlertManager",
      purpose: "Тревоги и их отправка в Telegram",
      url: env.alertmanagerUrl || null,
      internal: env.alertmanagerInternalUrl || env.alertmanagerUrl,
      probePath: "/-/healthy",
    },
    {
      key: "sentry",
      title: "Sentry",
      purpose: "Падения со стеком и версией выкладки",
      url: env.sentryUrl || null,
      // Проверять чужое облако незачем: оно живо и без нас, а лишний запрос
      // наружу с каждого открытия страницы — плохая привычка.
      internal: "",
      probePath: "",
      /*
        Поэтому вместо доступности показывается то, что действительно стоит
        знать и что знаем только мы: настроена ли отправка и уходят ли карты
        кода. Без карт стек в Sentry минифицированный, и по нему искать нечего
        — а по одному «отвечает» этого было бы не видно никогда.
      */
      state: (env.sentryDsn ? "configured" : "not_configured") as ServiceState,
      note: sentryNote(),
    },
  ];
}

/** Что мы знаем про свою связь с Sentry. */
function sentryNote(): string {
  if (!env.sentryDsn) return "Не задан SENTRY_DSN — падения никуда не уходят";
  const release = env.sentryRelease ? ` · выпуск ${env.sentryRelease.slice(0, 7)}` : "";
  return env.sentryMapsUploaded
    ? `Доступность не проверяем — это чужое облако. Карты кода загружаются${release}`
    : `Доступность не проверяем — это чужое облако. Карты кода НЕ загружаются: не задан SENTRY_AUTH_TOKEN, стек останется минифицированным${release}`;
}

/**
 * Жива ли служба.
 *
 * Тайм-аут короткий: страница мониторинга не должна ждать ту самую службу,
 * которая как раз и легла. Любой ответ считается признаком жизни, включая 401
 * и 404 — нам важно, что на том конце кто-то есть, а не что он нам рад.
 */
async function probe(url: string, timeoutMs = 1500): Promise<{ state: ServiceState; latencyMs: number | null }> {
  if (!url) return { state: "not_configured", latencyMs: null };
  const started = Date.now();
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  try {
    await fetch(url, { signal: control.signal, redirect: "manual" });
    return { state: "ok", latencyMs: Date.now() - started };
  } catch {
    return { state: "down", latencyMs: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function observabilityServices(): Promise<ObservabilityService[]> {
  const defs = describe();
  return Promise.all(defs.map(async d => {
    const target = d.internal ? d.internal.replace(/\/+$/, "") + d.probePath : "";
    const { state, latencyMs } = d.state
      // Состояние задано заранее — эту службу мы не проверяем по замыслу.
      ? { state: d.state, latencyMs: null }
      : target
        ? await probe(target)
        : { state: (d.url ? "unknown" : "not_configured") as ServiceState, latencyMs: null };
    return {
      key: d.key,
      title: d.title,
      purpose: d.purpose,
      url: d.url,
      publicAccess: Boolean(d.url),
      state,
      latencyMs,
      ...(d.note ? { note: d.note } : {}),
    };
  }));
}

export interface FiringAlert {
  name: string;
  severity: string;
  summary: string;
  since: string | null;
}

export interface AlertsResult {
  /** Удалось ли вообще спросить AlertManager. */
  reachable: boolean;
  alerts: FiringAlert[];
}

/**
 * Что горит прямо сейчас — из того же AlertManager, что пишет в Telegram.
 *
 * Отдельного списка тревог заводить нельзя: два источника правды о том, что
 * сломано, разойдутся, и разойдутся молча. Здесь только чтение.
 *
 * ── Почему возвращается не просто список ────────────────────────────────────
 *
 * Пустой список и недоступный источник — разные вещи, а выглядели одинаково:
 * любая неудача запроса давала [], и страница уверенно писала «Ничего не
 * горит». То есть ровно в тот момент, когда наблюдение сломано, экран
 * успокаивал сильнее всего. Отсюда отдельный признак: не знаем — так и
 * говорим.
 */
export async function firingAlerts(): Promise<AlertsResult> {
  const base = (env.alertmanagerInternalUrl || env.alertmanagerUrl).replace(/\/+$/, "");
  if (!base) return { reachable: false, alerts: [] };
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), 2000);
  try {
    const res = await fetch(`${base}/api/v2/alerts?active=true&silenced=false&inhibited=false`, { signal: control.signal });
    if (!res.ok) return { reachable: false, alerts: [] };
    const raw = await res.json() as Array<{
      labels?: Record<string, string>;
      annotations?: Record<string, string>;
      startsAt?: string;
    }>;
    return {
      reachable: true,
      alerts: raw.map(a => ({
        name: a.labels?.alertname ?? "—",
        severity: a.labels?.severity ?? "warning",
        summary: a.annotations?.summary ?? a.annotations?.description ?? "",
        since: a.startsAt ?? null,
      })),
    };
  } catch {
    return { reachable: false, alerts: [] };
  } finally {
    clearTimeout(timer);
  }
}

export interface EndpointStat {
  method: string;
  path: string;
  requests: number;
  errors: number;
  errorRate: number;
  /** Среднее время ответа, мс. */
  avgMs: number;
  /** Оценка 95-го перцентиля по корзинам гистограммы, мс. */
  p95Ms: number;
}

/**
 * Трафик, ошибки и время по каждой ручке.
 *
 * Считается из того же реестра, который отдаётся Prometheus, — второго
 * измерения не заводится. Прибор снаружи покажет то же самое; ценность
 * страницы в том, что она отвечает сразу и без Grafana.
 *
 * p95 — ОЦЕНКА по корзинам гистограммы, а не точное значение: точного из
 * гистограммы не получить в принципе. Названо это на экране так же прямо.
 */
export async function endpointStats(limit = 12): Promise<EndpointStat[]> {
  const metrics = await register.getMetricsAsJSON();
  const byKey = new Map<string, EndpointStat & { sumSeconds: number; buckets: Map<number, number> }>();

  const keyOf = (l: Record<string, string>) => `${l.method ?? "?"} ${l.path ?? "?"}`;
  const ensure = (l: Record<string, string>) => {
    const key = keyOf(l);
    let row = byKey.get(key);
    if (!row) {
      row = {
        method: l.method ?? "?", path: l.path ?? "?",
        requests: 0, errors: 0, errorRate: 0, avgMs: 0, p95Ms: 0,
        sumSeconds: 0, buckets: new Map(),
      };
      byKey.set(key, row);
    }
    return row;
  };

  for (const m of metrics) {
    if (m.name === "http_requests_total") {
      for (const v of m.values) ensure(v.labels as Record<string, string>).requests += v.value;
    }
    if (m.name === "http_request_errors_total") {
      for (const v of m.values) ensure(v.labels as Record<string, string>).errors += v.value;
    }
    if (m.name === "http_request_duration_seconds") {
      for (const v of m.values) {
        const labels = v.labels as Record<string, string> & { le?: string };
        const row = ensure(labels);
        /*
          Гистограмма prom-client отдаёт три вида точек: _sum, _count и корзины
          с ярлыком le. Различать их по имени точки нельзя — в типах его нет,
          — но различать и не нужно: корзина узнаётся по наличию le, а сумма и
          счётчик отличаются друг от друга по имени, которое всё же приходит
          рядом. Берём сумму по отсутствию le и по имени с окончанием _sum.
        */
        const pointName = (v as { metricName?: string }).metricName ?? "";
        if (labels.le === undefined && pointName.endsWith("_sum")) row.sumSeconds += v.value;
        else if (labels.le !== undefined) {
          const le = Number(labels.le);
          row.buckets.set(le, (row.buckets.get(le) ?? 0) + v.value);
        }
      }
    }
  }

  const rows: EndpointStat[] = [...byKey.values()].map(r => {
    const total = r.requests || 0;
    const avgMs = total > 0 ? Math.round((r.sumSeconds / total) * 1000) : 0;

    // Корзины кумулятивные: ищем первую, за которой лежит 95% обращений.
    const edges = [...r.buckets.keys()].filter(Number.isFinite).sort((a, b) => a - b);
    const target = total * 0.95;
    let p95 = 0;
    for (const le of edges) {
      if ((r.buckets.get(le) ?? 0) >= target) { p95 = le; break; }
    }

    return {
      method: r.method, path: r.path,
      requests: total,
      errors: r.errors,
      errorRate: total > 0 ? (r.errors / total) * 100 : 0,
      avgMs,
      p95Ms: Math.round(p95 * 1000),
    };
  });

  /*
    Сначала то, что болит: сперва ручки с отказами, потом самые медленные.
    Список по алфавиту или по трафику пришлось бы читать целиком, а он для
    того и нужен, чтобы не читать целиком.
  */
  return rows
    .filter(r => r.requests > 0)
    .sort((a, b) => (b.errors - a.errors) || (b.p95Ms - a.p95Ms))
    .slice(0, limit);
}
