import { useState, useEffect, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import {
  Zap, Timer, Gauge, AlertCircle, Clock, RefreshCw,
  Server, Database, Layers,
} from "lucide-react";
import {
  COLORS, F,
} from "@/components/monitoring";
import { KpiCard } from "@/components/monitoring/KpiCard";
import { Section } from "@/components/monitoring/Section";
import { Badge } from "@/components/monitoring/Badge";
import { ErrorDetailModal } from "@/components/monitoring/ErrorDetailModal";
import { SystemStatusBanner } from "@/components/monitoring/SystemStatusBanner";
import { PerformanceCharts } from "@/components/monitoring/PerformanceCharts";
import { ErrorLogViewer } from "@/components/monitoring/ErrorLogViewer";
import { RealTimeMetrics } from "@/components/monitoring/RealTimeMetrics";

const REFRESH_INTERVAL = 3_000;

// ── Keyframes ─────────────────────────────────────────────────────────────────
const slideUpKeyframe = `
@keyframes slideUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;
if (typeof document !== "undefined" && !document.getElementById("monitoring-keyframes")) {
  const style = document.createElement("style");
  style.id = "monitoring-keyframes";
  style.textContent = slideUpKeyframe;
  document.head.appendChild(style);
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN MONITORING COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
export default function Monitoring() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedErrorId, setSelectedErrorId] = useState<string | null>(null);

  const { data, isLoading, refetch, isRefetching } = trpc.system.status.useQuery(undefined, {
    refetchInterval: autoRefresh ? REFRESH_INTERVAL : false,
    refetchOnWindowFocus: true,
  });

  const { data: errorStats, refetch: refetchErrorStats } = trpc.system.errorStats.useQuery(undefined, {
    refetchInterval: autoRefresh ? 10_000 : false,
  });

  const { data: groupedErrors, refetch: refetchGroupedErrors } = trpc.system.groupedErrors.useQuery(
    { minutes: 60 },
    { refetchInterval: autoRefresh ? 10_000 : false }
  );

  const { data: errorTrend, refetch: refetchErrorTrend } = trpc.system.errorTrend.useQuery(
    { minutes: 60 },
    { refetchInterval: autoRefresh ? 30_000 : false }
  );

  const refetchErrors = () => {
    refetchErrorStats();
    refetchGroupedErrors();
    refetchErrorTrend();
  };

  const clearCacheMutation = trpc.system.clearCache.useMutation({
    onSuccess: () => notify.success("Кэш очищен"),
  });

  const purgeErrorsMutation = trpc.system.purgeErrors.useMutation({
    onSuccess: (data) => notify.success(`Очищено ${data.purged} ошибок, осталось ${data.remaining}`),
  });

  const checkAlertsMutation = trpc.system.checkAlerts.useMutation({
    onSuccess: (data) => {
      if (data.alerts.length > 0) {
        notify.error(`Алерты: ${data.alerts.join(", ")}`);
      } else {
        notify.success("Все нормально — алертов нет");
      }
    },
  });

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "r" && !e.ctrlKey && !e.metaKey && e.target === document.body) {
        refetch();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [refetch]);

  // Chart data
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const chartData = useMemo(() => {
    if (!data?.series) return [];
    const reqData = data.series.req_per_sec?.data ?? [];
    const respData = data.series.avg_response_ms?.data ?? [];
    const errData = data.series.errors_per_sec?.data ?? [];
    const heapData = data.series.heap_used_mb?.data ?? [];

    const tsMap = new Map<number, unknown>();
    const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    for (const d of reqData) {
      const key = Math.floor(d.timestamp / 1000);
      const existing = tsMap.get(key) || { time: fmtTime(d.timestamp) };
      existing.rps = d.value;
      tsMap.set(key, existing);
    }
    for (const d of respData) {
      const key = Math.floor(d.timestamp / 1000);
      const existing = tsMap.get(key) || { time: fmtTime(d.timestamp) };
      existing.response = Math.round(d.value);
      tsMap.set(key, existing);
    }
    for (const d of errData) {
      const key = Math.floor(d.timestamp / 1000);
      const existing = tsMap.get(key) || { time: fmtTime(d.timestamp) };
      existing.errors = d.value;
      tsMap.set(key, existing);
    }
    for (const d of heapData) {
      const key = Math.floor(d.timestamp / 1000);
      const existing = tsMap.get(key) || { time: fmtTime(d.timestamp) };
      existing.heap = d.value;
      tsMap.set(key, existing);
    }
    return Array.from(tsMap.values()).slice(-60);
  }, [data?.series]);

  if (isLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "50vh" }}>
        <div style={{ width: "32px", height: "32px", borderRadius: "50%", border: `3px solid ${COLORS.border}`, borderTopColor: COLORS.primary, animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  const dbOk = data?.database.connected;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      {/* Error detail modal */}
      {selectedErrorId && <ErrorDetailModal errorId={selectedErrorId} onClose={() => setSelectedErrorId(null)} />}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", animation: "slideUp 0.4s ease forwards" }}>
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.02em" }}>Мониторинг системы</h1>
          <p style={{ fontSize: "13px", marginTop: "4px", color: COLORS.textSecondary, fontFamily: F.body }}>
            {data?.server.nodeVersion} &middot; PID {data?.server.pid} &middot; v{data?.server.version}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{
              display: "flex", alignItems: "center", gap: "8px", padding: "6px 12px",
              borderRadius: "8px", fontSize: "12px", fontWeight: 600, fontFamily: F.body,
              background: autoRefresh ? "rgba(74,222,128,.10)" : COLORS.surfaceLight,
              color: autoRefresh ? COLORS.success : COLORS.textSecondary,
              border: `1px solid ${autoRefresh ? "rgba(74,222,128,.20)" : COLORS.border}`,
              cursor: "pointer", transition: "all 0.2s",
            }}
          >
            <div style={{
              width: "6px", height: "6px", borderRadius: "50%",
              background: autoRefresh ? COLORS.success : "var(--color-text-tertiary, #6b6760)",
              animation: autoRefresh ? "pulse 2s infinite" : undefined,
            }} />
            {autoRefresh ? "Live" : "Paused"}
          </button>
          <button onClick={() => { refetch(); refetchErrors(); }} disabled={isRefetching} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px",
            borderRadius: "8px", fontSize: "12px", fontWeight: 600, fontFamily: F.body,
            background: COLORS.surface, color: COLORS.textSecondary,
            border: `1px solid ${COLORS.border}`, cursor: "pointer",
            opacity: isRefetching ? 0.4 : 1, transition: "all 0.2s",
          }}>
            <RefreshCw size={12} style={{ animation: isRefetching ? "spin 1s linear infinite" : undefined }} /> Обновить
          </button>
          <button onClick={() => checkAlertsMutation.mutate()} disabled={checkAlertsMutation.isPending} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px",
            borderRadius: "8px", fontSize: "12px", fontWeight: 600, fontFamily: F.body,
            background: COLORS.surface, color: COLORS.textSecondary,
            border: `1px solid ${COLORS.border}`, cursor: "pointer",
            opacity: checkAlertsMutation.isPending ? 0.4 : 1, transition: "all 0.2s",
          }}>
            <AlertCircle size={12} /> Проверить алерты
          </button>
          <button onClick={() => clearCacheMutation.mutate()} disabled={clearCacheMutation.isPending} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px",
            borderRadius: "8px", fontSize: "12px", fontWeight: 600, fontFamily: F.body,
            background: COLORS.surface, color: COLORS.textSecondary,
            border: `1px solid ${COLORS.border}`, cursor: "pointer",
            opacity: clearCacheMutation.isPending ? 0.4 : 1, transition: "all 0.2s",
          }}>
            <RefreshCw size={12} /> Очистить кэш
          </button>
        </div>
      </div>

      {/* Status Banner */}
      <SystemStatusBanner
        server={data?.server ?? {}}
        database={data?.database ?? {}}
        timestamp={data?.timestamp}
      />

      {/* KPI Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
        <KpiCard label="RPS" value={data?.requests.rps ?? "0.0"} delta={null} sub="запросов/сек" icon={Zap} gradient="linear-gradient(135deg, var(--kpi-indigo), var(--kpi-indigo))" delay={0} />
        <KpiCard label="Avg" value={`${data?.requests.avgResponseTime ?? 0}мс`} delta={null} sub="среднее время" icon={Timer} gradient="linear-gradient(135deg, var(--kpi-green), var(--kpi-green))" delay={0.1} />
        <KpiCard label="P95" value={`${data?.requests.p95 ?? 0}мс`} delta={null} sub="95-й перцентиль" icon={Gauge} gradient="linear-gradient(135deg, var(--kpi-blue), var(--kpi-blue))" delay={0.2} />
        <KpiCard label="P99" value={`${data?.requests.p99 ?? 0}мс`} delta={null} sub="99-й перцентиль" icon={Gauge} gradient="linear-gradient(135deg, var(--kpi-amber), var(--kpi-amber))" delay={0.3} />
        <KpiCard label="Ошибки" value={data?.requests.errorRate ?? "0.0%"} delta={null} sub={`${data?.requests.windowErrors ?? 0} за мин`} icon={AlertCircle} gradient={Number(data?.requests.errorRate) > 5 ? "linear-gradient(135deg, var(--kpi-red), var(--kpi-red))" : "linear-gradient(135deg, var(--kpi-green), var(--kpi-green))"} delay={0.4} />
        <KpiCard label="Uptime" value={data?.server.uptimeFormatted ?? "—"} delta={null} sub={data?.server.environment} icon={Clock} gradient="linear-gradient(135deg, var(--kpi-indigo), var(--kpi-indigo))" delay={0.5} />
      </div>

      {/* Charts */}
      <PerformanceCharts chartData={chartData} />

      {/* Detail Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px" }}>
        <Section title="Сервер" icon={Server} delay={0.1}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {[
              ["Статус", <Badge status={data?.server.status ?? "ok"} label={data?.server.status ?? "ok"} />],
              ["Версия", <span style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary }}>{data?.server.version}</span>],
              ["Node.js", <span style={{ fontFamily: "monospace", fontSize: "12px", color: COLORS.textSecondary }}>{data?.server.nodeVersion}</span>],
              ["PID", <span style={{ fontFamily: "monospace", fontSize: "12px", color: COLORS.textSecondary }}>{data?.server.pid}</span>],
              ["Окружение", <span style={{
                fontFamily: F.body, fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "12px",
                background: data?.server.environment === "production" ? "rgba(232,80,80,.10)" : "rgba(96,165,250,.10)",
                color: data?.server.environment === "production" ? COLORS.danger : COLORS.info,
              }}>{data?.server.environment}</span>],
            ].map(([label, val], i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0",
                borderTop: i > 0 ? `1px solid ${COLORS.border}` : undefined,
              }}>
                <span style={{ fontFamily: F.body, fontSize: "12px", color: COLORS.textSecondary }}>{label as string}</span>{val}
              </div>
            ))}
          </div>
        </Section>
        <Section title="База данных" icon={Database} delay={0.2}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {[
              ["Статус", <Badge status={dbOk ? "connected" : "disconnected"} label={dbOk ? "Подключена" : "Отключена"} />],
              ["Отклик", <span style={{
                fontFamily: F.display, fontSize: "14px", fontWeight: 600,
                color: (data?.database.responseTimeMs ?? 0) > 200 ? COLORS.warning : COLORS.success,
              }}>{data?.database.responseTimeMs ?? 0} мс</span>],
              ["Соединения", <span style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary }}>{data?.database.connections?.total ?? 0}</span>],
              ["Активные", <span style={{
                fontFamily: F.display, fontSize: "14px", fontWeight: 600,
                color: (data?.database.connections?.active ?? 0) > 10 ? COLORS.warning : COLORS.success,
              }}>{data?.database.connections?.active ?? 0}</span>],
              ["Ожидание", <span style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary }}>{data?.database.connections?.idle ?? 0}</span>],
            ].map(([label, val], i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0",
                borderTop: i > 0 ? `1px solid ${COLORS.border}` : undefined,
              }}>
                <span style={{ fontFamily: F.body, fontSize: "12px", color: COLORS.textSecondary }}>{label as string}</span>{val}
              </div>
            ))}
          </div>
        </Section>
        <Section title="Кэш и SSE" icon={Layers} delay={0.3}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {[
              ["Кэш hit rate", <span style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary }}>{data?.cache.hitRate}</span>],
              ["Кэш размер", <span style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textSecondary }}>{data?.cache.size} записей</span>],
              ["SSE каналы", <span style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.primaryText }}>{data?.sse.channels}</span>],
              ["SSE клиенты", <span style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.success }}>{data?.sse.totalListeners}</span>],
            ].map(([label, val], i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0",
                borderTop: i > 0 ? `1px solid ${COLORS.border}` : undefined,
              }}>
                <span style={{ fontFamily: F.body, fontSize: "12px", color: COLORS.textSecondary }}>{label as string}</span>{val}
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* Business Metrics */}
      {data?.business && (
        <Section title="Бизнес-метрики (24ч)" icon={Zap} delay={0.1}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" }}>
            {[
              { label: "Заказы", value: data.business.orders24h, icon: "📦", color: COLORS.primaryText },
              { label: "Выручка", value: `${Number(data.business.revenue24h).toLocaleString("ru")} сум`, icon: "💰", color: COLORS.success },
              { label: "Новых товаров", value: data.business.newProducts, icon: "📋", color: COLORS.info },
              { label: "Активных юзеров", value: data.business.activeUsers, icon: "👥", color: COLORS.warning },
              { label: "Магазинов", value: data.business.totalShops, icon: "🏪", color: COLORS.primaryText },
            ].map((item, i) => (
              <div key={i} style={{
                padding: "12px", borderRadius: "10px", background: COLORS.surfaceLight,
                border: `1px solid ${COLORS.border}`,
              }}>
                <div style={{ fontSize: "12px", color: COLORS.textSecondary, fontFamily: F.body, marginBottom: "4px" }}>{item.icon} {item.label}</div>
                <div style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 700, color: item.color }}>{item.value}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Error Log */}
      <ErrorLogViewer
        groupedErrors={groupedErrors ?? []}
        errorStats={errorStats}
        errorTrend={errorTrend}
        onSelectError={setSelectedErrorId}
        onPurgeErrors={() => purgeErrorsMutation.mutate()}
      />

      {/* Metrics */}
      <RealTimeMetrics metrics={data?.metrics ?? {}} />

      <div style={{ textAlign: "center", fontSize: "12px", padding: "12px 0", color: COLORS.textTertiary, fontFamily: F.body }}>
        Обновление: {REFRESH_INTERVAL / 1000}с &middot; История: 120 точек &middot; Ошибки: 200 макс &middot;{" "}
        <kbd style={{ padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontFamily: "monospace", background: COLORS.surfaceLight, border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary }}>R</kbd> обновить
      </div>
    </div>
  );
}
