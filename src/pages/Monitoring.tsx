import { useState, useEffect, useMemo, useCallback } from "react";
import { trpc } from "@/providers/trpc";
import {
  Activity, HardDrive, Wifi, Server, Clock,
  AlertTriangle, CheckCircle2, XCircle, RefreshCw,
  Zap, BarChart3, MemoryStick, Database,
  Gauge, Timer, AlertCircle, Layers, ChevronRight,
  Copy, Check, ExternalLink, Filter,
  ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

const REFRESH_INTERVAL = 3_000;

// ── Premium design tokens ─────────────────────────────────────────────────────
const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };
const COLORS = {
  primary: "#4b6cf6", success: "#34c473",
  warning: "#e8a830", danger: "#e85050",
  surface: "var(--color-surface, #ffffff)", surfaceLight: "var(--color-surface-light, #f0f3f8)",
  textPrimary: "var(--color-text-primary, #2b3450)", textSecondary: "var(--color-text-secondary, #6a7290)",
  textTertiary: "var(--color-text-tertiary, #98a0b8)", border: "var(--color-border, #f0f3f8)",
  info: "#60a5fa",
};
const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

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

// ── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}с назад`;
  if (sec < 3600) return `${Math.floor(sec / 60)}м назад`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}ч назад`;
  return `${Math.floor(sec / 86400)}д назад`;
}

function statusColor(code: number): string {
  if (code >= 500) return COLORS.danger;
  if (code >= 400) return COLORS.warning;
  return COLORS.success;
}

// ── Chart Tooltip ────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey?: string; name?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: COLORS.surface, border: `1px solid ${COLORS.border}`,
      borderRadius: "12px", padding: "14px 16px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
      minWidth: "160px",
    }}>
      <p style={{ fontSize: "11px", fontWeight: 600, color: COLORS.textTertiary, marginBottom: "8px", fontFamily: F.body, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {label}
      </p>
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", marginTop: "4px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: p.color ?? "#4b6cf6" }} />
            <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{p.name}</span>
          </div>
          <span style={{ fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary, fontFamily: F.display }}>
            {typeof p.value === "number" ? p.value.toLocaleString() : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Badge ────────────────────────────────────────────────────────────────────
function Badge({ status, label }: { status: string; label: string }) {
  const map: Record<string, { fg: string; bg: string }> = {
    ok: { fg: COLORS.success, bg: "rgba(74,222,128,.12)" },
    connected: { fg: COLORS.success, bg: "rgba(74,222,128,.12)" },
    degraded: { fg: COLORS.warning, bg: "rgba(251,191,36,.12)" },
    error: { fg: COLORS.danger, bg: "rgba(232,80,80,.12)" },
    disconnected: { fg: COLORS.danger, bg: "rgba(232,80,80,.12)" },
  };
  const s = map[status] ?? map.error;
  const Icon = status === "ok" || status === "connected" ? CheckCircle2 : XCircle;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px",
      borderRadius: "24px", fontSize: "11px", fontWeight: 600, fontFamily: F.body,
      color: s.fg, background: s.bg,
    }}>
      <Icon size={12} /> {label}
    </span>
  );
}

// ── KPI Card (Premium) ───────────────────────────────────────────────────────
function KpiCard({ label, value, delta, sub, icon: Icon, gradient, delay }: {
  label: string; value: string | number; delta?: number | null;
  sub?: string; icon: React.ComponentType<{ size?: number; color?: string }>; gradient: string; delay: number;
}) {
  const isPositive = delta !== null && delta !== undefined && delta > 0;
  const isNegative = delta !== null && delta !== undefined && delta < 0;
  return (
    <div className="kpi-hero" style={{
      borderRadius: "24px", padding: "24px",
      position: "relative", overflow: "hidden",
      animation: `slideUp ${0.5 + delay}s ease forwards`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>
          {label}
        </span>
        <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={20} color="#fff" />
        </div>
      </div>
      <div style={{ fontFamily: F.display, fontSize: "32px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>
        {value}
      </div>
      {delta !== null && delta !== undefined && (
        <div style={{
          display: "flex", alignItems: "center", gap: "4px", marginTop: "10px",
          fontSize: "12px", fontWeight: 600, fontFamily: F.body,
          color: isPositive ? "#34c473" : isNegative ? "#e85050" : COLORS.textTertiary,
        }}>
          {isPositive ? <ArrowUpRight size={14} /> : isNegative ? <ArrowDownRight size={14} /> : <Minus size={14} />}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
      {sub && <div style={{ fontSize: "11px", marginTop: "4px", color: COLORS.textTertiary, fontFamily: F.body }}>{sub}</div>}
    </div>
  );
}

// ── Section (Premium) ────────────────────────────────────────────────────────
function Section({ title, icon: Icon, children, className = "", actions, delay = 0 }: {
  title: string; icon: React.ComponentType<{ size?: number; color?: string }>; children: React.ReactNode; className?: string;
  actions?: React.ReactNode; delay?: number;
}) {
  return (
    <div style={{
      background: COLORS.surface, borderRadius: "24px", overflow: "hidden",
      boxShadow: SHADOW, animation: `slideUp ${0.5 + delay}s ease forwards`,
    }}>
      <div style={{
        padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: `1px solid ${COLORS.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "28px", height: "28px", borderRadius: "8px",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(75,108,246,.10)", color: COLORS.primary,
          }}>
            <Icon size={14} />
          </div>
          <h3 style={{ fontFamily: F.display, fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary }}>{title}</h3>
        </div>
        {actions}
      </div>
      <div style={{ padding: "20px" }}>{children}</div>
    </div>
  );
}

// ── Copy Button ──────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button onClick={handleCopy} style={{ padding: "4px", borderRadius: "4px", background: "none", border: "none", cursor: "pointer", color: COLORS.textTertiary }}>
      {copied ? <Check size={13} style={{ color: COLORS.success }} /> : <Copy size={13} />}
    </button>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ERROR DETAIL MODAL
// ═════════════════════════════════════════════════════════════════════════════
function ErrorDetailModal({ errorId, onClose }: { errorId: string; onClose: () => void }) {
  const { data: error, isLoading } = trpc.system.errorDetail.useQuery({ id: errorId });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} />
      <div
        style={{
          position: "relative", width: "100%", maxWidth: "640px", maxHeight: "85vh",
          background: COLORS.surface, borderRadius: "24px", border: `1px solid ${COLORS.border}`,
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)", overflow: "hidden", display: "flex", flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{
              width: "40px", height: "40px", borderRadius: "12px",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(232,80,80,.10)", color: COLORS.danger,
            }}>
              <AlertCircle size={20} />
            </div>
            <div>
              <h2 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 700, color: COLORS.textPrimary }}>Детали ошибки</h2>
              <p style={{ fontSize: "11px", color: COLORS.textTertiary, fontFamily: F.body }}>{error?.id}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ padding: "8px", borderRadius: "8px", background: "none", border: "none", cursor: "pointer", color: COLORS.textSecondary }}>
            <XCircle size={20} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
          {isLoading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 0" }}>
              <div style={{ width: "24px", height: "24px", borderRadius: "50%", border: `2px solid ${COLORS.border}`, borderTopColor: COLORS.primary, animation: "spin 1s linear infinite" }} />
            </div>
          ) : !error ? (
            <div style={{ textAlign: "center", padding: "48px 0", color: COLORS.textTertiary }}>Ошибка не найдена</div>
          ) : (
            <>
              <div style={{ padding: "16px", borderRadius: "12px", background: COLORS.surfaceLight }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "24px", fontWeight: 900, color: statusColor(error.statusCode) }}>{error.statusCode}</span>
                  <span style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary }}>{error.code}</span>
                </div>
                <p style={{ fontSize: "13px", color: COLORS.textSecondary, fontFamily: F.body }}>{error.message}</p>
              </div>

              <div style={{ borderRadius: "12px", border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
                {[
                  ["Время", new Date(error.timestamp).toLocaleString("ru")],
                  ["Прошло", timeAgo(error.timestamp)],
                  ["Метод", error.method],
                  ["Путь", error.path],
                  ["Корреляция", error.correlationId ?? "—"],
                  ["IP", error.ip ?? "—"],
                  ["Пользователь", error.userId ? String(error.userId) : "—"],
                  ["Тенант", error.tenantId ? String(error.tenantId) : "—"],
                  ["Длительность", error.duration ? `${error.duration}мс` : "—"],
                ].map(([label, value], i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 16px", fontSize: "13px", fontFamily: F.body,
                    background: i % 2 === 0 ? COLORS.surface : COLORS.surfaceLight,
                    borderTop: i > 0 ? `1px solid ${COLORS.border}` : undefined,
                  }}>
                    <span style={{ fontWeight: 500, color: COLORS.textSecondary }}>{label}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontFamily: "monospace", fontSize: "12px", color: COLORS.textPrimary }}>{value}</span>
                      {value !== "—" && <CopyButton text={String(value)} />}
                    </div>
                  </div>
                ))}
              </div>

              {error.stack && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>Stack Trace</span>
                    <CopyButton text={error.stack} />
                  </div>
                  <pre style={{
                    padding: "16px", borderRadius: "12px", fontSize: "12px", fontFamily: "monospace",
                    lineHeight: 1.6, overflowX: "auto", background: COLORS.surfaceLight,
                    color: COLORS.textSecondary, border: `1px solid ${COLORS.border}`,
                  }}>
                    {error.stack}
                  </pre>
                </div>
              )}

              {error.meta && Object.keys(error.meta).length > 0 && (
                <div>
                  <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>Meta</span>
                  <pre style={{
                    marginTop: "8px", padding: "16px", borderRadius: "12px", fontSize: "12px",
                    fontFamily: "monospace", overflowX: "auto", background: COLORS.surfaceLight,
                    color: COLORS.textSecondary, border: `1px solid ${COLORS.border}`,
                  }}>
                    {JSON.stringify(error.meta, null, 2)}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN MONITORING COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
export default function Monitoring() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedErrorId, setSelectedErrorId] = useState<string | null>(null);
  const [errorFilter, setErrorFilter] = useState<string>("");

  const { data, isLoading, refetch, isRefetching } = trpc.system.status.useQuery(undefined, {
    refetchInterval: autoRefresh ? REFRESH_INTERVAL : false,
    refetchOnWindowFocus: true,
  });

  const { data: errorData, refetch: refetchErrors } = trpc.system.errors.useQuery(
    { limit: 50, code: errorFilter || undefined },
    { refetchInterval: autoRefresh ? 5_000 : false }
  );

  const { data: errorStats } = trpc.system.errorStats.useQuery(undefined, {
    refetchInterval: autoRefresh ? 10_000 : false,
  });

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "r" && !e.ctrlKey && !e.metaKey && e.target === document.body) {
        refetch();
        refetchErrors();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [refetch, refetchErrors]);

  // Chart data
  const chartData = useMemo(() => {
    if (!data?.series) return [];
    const reqData = data.series.req_per_sec?.data ?? [];
    const respData = data.series.avg_response_ms?.data ?? [];
    const errData = data.series.errors_per_sec?.data ?? [];
    const heapData = data.series.heap_used_mb?.data ?? [];

    const tsMap = new Map<number, any>();
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

  const serverOk = data?.server.status === "ok";
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
              background: autoRefresh ? COLORS.success : "var(--color-text-tertiary, #98a0b8)",
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
        </div>
      </div>

      {/* Status Banner */}
      <div style={{
        padding: "16px", borderRadius: "16px", display: "flex", alignItems: "center", gap: "12px",
        background: serverOk && dbOk ? "rgba(74,222,128,.08)" : "rgba(251,191,36,.08)",
        border: `1px solid ${serverOk && dbOk ? "rgba(74,222,128,.15)" : "rgba(251,191,36,.15)"}`,
        boxShadow: SHADOW, animation: "slideUp 0.5s ease forwards",
      }}>
        {serverOk && dbOk ? <CheckCircle2 size={20} style={{ color: COLORS.success }} /> : <AlertTriangle size={20} style={{ color: COLORS.warning }} />}
        <div style={{ flex: 1 }}>
          <span style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 700, color: COLORS.textPrimary }}>{serverOk && dbOk ? "Все системы в норме" : "Обнаружены проблемы"}</span>
          <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
            <Badge status={data?.server.status ?? "ok"} label={`API: ${data?.server.status}`} />
            <Badge status={dbOk ? "connected" : "disconnected"} label={`БД: ${dbOk ? "OK" : "FAIL"}`} />
          </div>
        </div>
        <div style={{ fontSize: "12px", color: COLORS.textTertiary, fontFamily: F.body }}>{data?.timestamp && new Date(data.timestamp).toLocaleTimeString("ru")}</div>
      </div>

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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: "16px" }}>
        <Section title="Запросов в секунду" icon={Activity} delay={0.1}>
          <div style={{ height: "180px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradRps" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: COLORS.textTertiary }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: COLORS.textTertiary }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="rps" name="RPS" stroke={COLORS.primary} strokeWidth={2} fill="url(#gradRps)" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Section>
        <Section title="Время ответа (мс)" icon={Timer} delay={0.2}>
          <div style={{ height: "180px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradResp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.success} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={COLORS.success} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: COLORS.textTertiary }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: COLORS.textTertiary }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="response" name="мс" stroke={COLORS.success} strokeWidth={2} fill="url(#gradResp)" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Section>
        <Section title="Ошибки в секунду" icon={AlertCircle} delay={0.3}>
          <div style={{ height: "180px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: COLORS.textTertiary }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: COLORS.textTertiary }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="errors" name="Ошибки" fill={COLORS.danger} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
        <Section title="Память (MB)" icon={MemoryStick} delay={0.4}>
          <div style={{ height: "180px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradHeap" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.info} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={COLORS.info} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: COLORS.textTertiary }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: COLORS.textTertiary }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="heap" name="Heap MB" stroke={COLORS.info} strokeWidth={2} fill="url(#gradHeap)" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>

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
              ["SSE каналы", <span style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.primary }}>{data?.sse.channels}</span>],
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

      {/* ═══════════════ ERROR LOG ═══════════════ */}
      <Section
        title={`Журнал ошибок${errorData?.total ? ` (${errorData.total})` : ""}`}
        icon={AlertCircle}
        delay={0.4}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              {["", "400", "401", "403", "404", "500"].map((code) => (
                <button
                  key={code}
                  onClick={() => setErrorFilter(code)}
                  style={{
                    padding: "4px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: 600,
                    fontFamily: F.body, cursor: "pointer", transition: "all 0.2s",
                    background: errorFilter === code ? "rgba(75,108,246,.10)" : "transparent",
                    color: errorFilter === code ? COLORS.primary : COLORS.textTertiary,
                    border: `1px solid ${errorFilter === code ? "rgba(75,108,246,.20)" : COLORS.border}`,
                  }}
                >
                  {code || "Все"}
                </button>
              ))}
            </div>
          </div>
        }
      >
        {/* Error stats bar */}
        {errorStats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "16px" }}>
            <div style={{ padding: "12px", borderRadius: "12px", textAlign: "center", background: COLORS.surfaceLight }}>
              <div style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: COLORS.danger }}>{errorStats.last5m}</div>
              <div style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>За 5 мин</div>
            </div>
            <div style={{ padding: "12px", borderRadius: "12px", textAlign: "center", background: COLORS.surfaceLight }}>
              <div style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: COLORS.warning }}>{errorStats.last1h}</div>
              <div style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>За час</div>
            </div>
            <div style={{ padding: "12px", borderRadius: "12px", textAlign: "center", background: COLORS.surfaceLight }}>
              <div style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: COLORS.textPrimary }}>{errorStats.total}</div>
              <div style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>Всего</div>
            </div>
          </div>
        )}

        {/* Top error paths */}
        {errorStats && errorStats.byPath.length > 0 && (
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px", color: COLORS.textTertiary }}>Топ путей с ошибками</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {errorStats.byPath.slice(0, 5).map((p) => (
                <div key={p.path} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontFamily: F.body,
                  background: COLORS.surfaceLight,
                }}>
                  <span style={{ fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", color: COLORS.textSecondary }}>{p.path}</span>
                  <span style={{ fontFamily: F.display, fontWeight: 700, color: COLORS.danger }}>{p.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error list */}
        <div style={{ overflowX: "auto" }}>
          {(!errorData?.errors || errorData.errors.length === 0) ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: COLORS.textTertiary }}>
              <CheckCircle2 size={32} style={{ margin: "0 auto 8px", opacity: 0.3 }} />
              <p style={{ fontSize: "13px", fontFamily: F.body }}>Ошибок не обнаружено</p>
            </div>
          ) : (
            <table style={{ width: "100%", fontSize: "13px", fontFamily: F.body }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  {["Статус", "Код", "Сообщение", "Путь", "Время", ""].map((h) => (
                    <th key={h} style={{
                      fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
                      letterSpacing: "0.08em", padding: "12px 16px", textAlign: h === "Сообщение" || h === "Путь" ? "left" : h === "" ? "right" : "left",
                      color: COLORS.textTertiary,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {errorData.errors.map((err) => (
                  <tr
                    key={err.id}
                    style={{ borderBottom: `1px solid ${COLORS.border}`, cursor: "pointer", transition: "background 0.15s" }}
                    onClick={() => setSelectedErrorId(err.id)}
                    onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.surfaceLight)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "10px 16px" }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: "32px", height: "24px", borderRadius: "6px", fontSize: "10px", fontWeight: 700,
                        background: statusColor(err.statusCode) + "15", color: statusColor(err.statusCode),
                      }}>
                        {err.statusCode}
                      </span>
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      <span style={{ fontFamily: "monospace", fontSize: "12px", color: COLORS.textSecondary }}>{err.code}</span>
                    </td>
                    <td style={{ padding: "10px 16px", maxWidth: "300px" }}>
                      <span style={{ fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", color: COLORS.textPrimary }}>{err.message}</span>
                    </td>
                    <td style={{ padding: "10px 16px", maxWidth: "200px" }}>
                      <span style={{ fontFamily: "monospace", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", color: COLORS.textTertiary }}>{err.path}</span>
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      <span style={{ fontSize: "11px", color: COLORS.textTertiary }}>{timeAgo(err.timestamp)}</span>
                    </td>
                    <td style={{ padding: "10px 16px", textAlign: "right" }}>
                      <ChevronRight size={14} style={{ color: COLORS.textTertiary }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Section>

      {/* Metrics */}
      {data?.metrics && Object.keys(data.metrics).length > 0 && (
        <Section title="Метрики" icon={BarChart3} delay={0.5}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: "13px", fontFamily: F.body }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  {["Метрика", "Записей", "Значение", "Время"].map((h) => (
                    <th key={h} style={{
                      fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
                      letterSpacing: "0.08em", padding: "12px 16px",
                      textAlign: h === "Метрика" ? "left" : "right",
                      color: COLORS.textTertiary,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.metrics).map(([name, m]) => (
                  <tr key={name} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                    <td style={{ padding: "10px 16px", fontFamily: "monospace", fontSize: "12px", color: COLORS.primary }}>{name}</td>
                    <td style={{ padding: "10px 16px", textAlign: "right", color: COLORS.textSecondary }}>{m.count}</td>
                    <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600, color: COLORS.textPrimary }}>{m.lastValue}</td>
                    <td style={{ padding: "10px 16px", textAlign: "right", fontSize: "12px", color: COLORS.textTertiary }}>{new Date(m.lastTimestamp).toLocaleTimeString("ru")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <div style={{ textAlign: "center", fontSize: "12px", padding: "12px 0", color: COLORS.textTertiary, fontFamily: F.body }}>
        Обновление: {REFRESH_INTERVAL / 1000}с &middot; История: 120 точек &middot; Ошибки: 200 макс &middot;{" "}
        <kbd style={{ padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontFamily: "monospace", background: COLORS.surfaceLight, border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary }}>R</kbd> обновить
      </div>
    </div>
  );
}
