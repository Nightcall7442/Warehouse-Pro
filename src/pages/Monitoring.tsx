import { useState, useEffect, useMemo, useCallback } from "react";
import { trpc } from "@/providers/trpc";
import {
  Activity, HardDrive, Wifi, Server, Clock,
  AlertTriangle, CheckCircle2, XCircle, RefreshCw,
  Zap, BarChart3, MemoryStick, Database,
  Gauge, Timer, AlertCircle, Layers, ChevronRight,
  Copy, Check, ExternalLink, Filter,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

const REFRESH_INTERVAL = 3_000;

// ── Theme CSS vars ───────────────────────────────────────────────────────────
const css = (v: string) => `var(--color-${v})`;
const S = {
  bg: css("canvas"), surface: css("surface"), raised: css("surface-raised"),
  light: css("surface-light"), hover: css("surface-hover"),
  border: css("border"), borderSub: css("border-subtle"), borderStr: css("border-strong"),
  text: css("text-primary"), textSec: css("text-secondary"), textTer: css("text-tertiary"),
  primary: css("primary"), primarySub: css("primary-subtle"),
  success: css("success"), successSub: css("success-subtle"),
  warning: css("warning"), warningSub: css("warning-subtle"),
  danger: css("danger"), dangerSub: css("danger-subtle"),
  info: css("info"), infoSub: css("info-subtle"),
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}с назад`;
  if (sec < 3600) return `${Math.floor(sec / 60)}м назад`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}ч назад`;
  return `${Math.floor(sec / 86400)}д назад`;
}

function statusColor(code: number): string {
  if (code >= 500) return S.danger;
  if (code >= 400) return S.warning;
  return S.success;
}

// ── Chart Tooltip ────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-xs shadow-lg border" style={{ background: S.surface, borderColor: S.border }}>
      <div className="font-medium mb-1" style={{ color: S.textSec }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span style={{ color: S.textSec }}>{p.name}:</span>
          <span className="font-semibold" style={{ color: S.text }}>{typeof p.value === "number" ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Badge ────────────────────────────────────────────────────────────────────
function Badge({ status, label }: { status: string; label: string }) {
  const map: Record<string, { fg: string; bg: string }> = {
    ok: { fg: S.success, bg: S.successSub }, connected: { fg: S.success, bg: S.successSub },
    degraded: { fg: S.warning, bg: S.warningSub }, error: { fg: S.danger, bg: S.dangerSub },
    disconnected: { fg: S.danger, bg: S.dangerSub },
  };
  const s = map[status] ?? map.error;
  const Icon = status === "ok" || status === "connected" ? CheckCircle2 : XCircle;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold" style={{ color: s.fg, background: s.bg }}>
      <Icon size={12} /> {label}
    </span>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string; icon: any; color: string;
}) {
  return (
    <div className="rounded-xl p-4 border" style={{ background: S.surface, borderColor: S.border }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium" style={{ color: S.textSec }}>{label}</span>
        <Icon size={14} style={{ color }} />
      </div>
      <div className="text-2xl font-bold tracking-tight" style={{ color: S.text }}>{value}</div>
      {sub && <div className="text-[11px] mt-0.5" style={{ color: S.textTer }}>{sub}</div>}
    </div>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────
function Section({ title, icon: Icon, children, className = "", actions }: {
  title: string; icon: any; children: React.ReactNode; className?: string; actions?: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border overflow-hidden ${className}`} style={{ background: S.surface, borderColor: S.border }}>
      <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: `1px solid ${S.borderSub}` }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: S.primarySub, color: S.primary }}>
            <Icon size={14} />
          </div>
          <h3 className="font-semibold text-sm" style={{ color: S.text }}>{title}</h3>
        </div>
        {actions}
      </div>
      <div className="p-5">{children}</div>
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
    <button onClick={handleCopy} className="p-1 rounded hover:opacity-70 transition-opacity" style={{ color: S.textTer }}>
      {copied ? <Check size={13} style={{ color: S.success }} /> : <Copy size={13} />}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      {/* Modal */}
      <div
        className="relative w-full max-w-2xl max-h-[85vh] rounded-2xl border shadow-2xl overflow-hidden flex flex-col"
        style={{ background: S.surface, borderColor: S.border }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${S.borderSub}` }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: S.dangerSub }}>
              <AlertCircle size={20} style={{ color: S.danger }} />
            </div>
            <div>
              <h2 className="font-bold text-base" style={{ color: S.text }}>Детали ошибки</h2>
              <p className="text-xs" style={{ color: S.textTer }}>{error?.id}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:opacity-70 transition-opacity" style={{ color: S.textSec }}>
            <XCircle size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor: S.primary }} />
            </div>
          ) : !error ? (
            <div className="text-center py-12" style={{ color: S.textTer }}>Ошибка не найдена</div>
          ) : (
            <>
              {/* Status code + message */}
              <div className="p-4 rounded-xl" style={{ background: S.light }}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl font-black font-mono" style={{ color: statusColor(error.statusCode) }}>{error.statusCode}</span>
                  <span className="text-sm font-semibold" style={{ color: S.text }}>{error.code}</span>
                </div>
                <p className="text-sm" style={{ color: S.textSec }}>{error.message}</p>
              </div>

              {/* Key-Value pairs */}
              <div className="space-y-0 rounded-xl border overflow-hidden" style={{ borderColor: S.border }}>
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
                  <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm" style={{ background: i % 2 === 0 ? S.surface : S.light, borderTop: i > 0 ? `1px solid ${S.borderSub}` : undefined }}>
                    <span className="font-medium" style={{ color: S.textSec }}>{label}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs" style={{ color: S.text }}>{value}</span>
                      {value !== "—" && <CopyButton text={String(value)} />}
                    </div>
                  </div>
                ))}
              </div>

              {/* Stack trace */}
              {error.stack && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: S.textTer }}>Stack Trace</span>
                    <CopyButton text={error.stack} />
                  </div>
                  <pre className="p-4 rounded-xl text-xs font-mono leading-relaxed overflow-x-auto" style={{ background: S.light, color: S.textSec, border: `1px solid ${S.borderSub}` }}>
                    {error.stack}
                  </pre>
                </div>
              )}

              {/* Meta */}
              {error.meta && Object.keys(error.meta).length > 0 && (
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: S.textTer }}>Meta</span>
                  <pre className="mt-2 p-4 rounded-xl text-xs font-mono overflow-x-auto" style={{ background: S.light, color: S.textSec, border: `1px solid ${S.borderSub}` }}>
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
      <div className="flex items-center justify-center h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: S.primary }} />
      </div>
    );
  }

  const serverOk = data?.server.status === "ok";
  const dbOk = data?.database.connected;

  return (
    <div className="space-y-5">
      {/* Error detail modal */}
      {selectedErrorId && <ErrorDetailModal errorId={selectedErrorId} onClose={() => setSelectedErrorId(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: S.text }}>Мониторинг системы</h1>
          <p className="text-sm mt-0.5" style={{ color: S.textSec }}>
            {data?.server.nodeVersion} &middot; PID {data?.server.pid} &middot; v{data?.server.version}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
            style={{ background: autoRefresh ? S.successSub : S.light, color: autoRefresh ? S.success : S.textSec, borderColor: autoRefresh ? S.success + "30" : S.border }}
          >
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: autoRefresh ? S.success : "#9ca3af", animation: autoRefresh ? "pulse 2s infinite" : undefined }} />
            {autoRefresh ? "Live" : "Paused"}
          </button>
          <button onClick={() => { refetch(); refetchErrors(); }} disabled={isRefetching} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-40" style={{ background: S.surface, color: S.textSec, borderColor: S.border }}>
            <RefreshCw size={12} className={isRefetching ? "animate-spin" : ""} /> Обновить
          </button>
        </div>
      </div>

      {/* Status Banner */}
      <div className="rounded-xl border p-4 flex items-center gap-3" style={{ background: serverOk && dbOk ? S.successSub : S.warningSub, borderColor: serverOk && dbOk ? S.success + "25" : S.warning + "25" }}>
        {serverOk && dbOk ? <CheckCircle2 size={20} style={{ color: S.success }} /> : <AlertTriangle size={20} style={{ color: S.warning }} />}
        <div className="flex-1">
          <span className="font-bold text-sm" style={{ color: S.text }}>{serverOk && dbOk ? "Все системы в норме" : "Обнаружены проблемы"}</span>
          <div className="flex gap-3 mt-1">
            <Badge status={data?.server.status ?? "ok"} label={`API: ${data?.server.status}`} />
            <Badge status={dbOk ? "connected" : "disconnected"} label={`БД: ${dbOk ? "OK" : "FAIL"}`} />
          </div>
        </div>
        <div className="text-xs" style={{ color: S.textTer }}>{data?.timestamp && new Date(data.timestamp).toLocaleTimeString("ru")}</div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <KpiCard label="RPS" value={data?.requests.rps ?? "0.0"} sub="запросов/сек" icon={Zap} color={S.primary} />
        <KpiCard label="Avg" value={`${data?.requests.avgResponseTime ?? 0}мс`} sub="среднее время" icon={Timer} color={S.success} />
        <KpiCard label="P95" value={`${data?.requests.p95 ?? 0}мс`} sub="95-й перцентиль" icon={Gauge} color={S.info} />
        <KpiCard label="P99" value={`${data?.requests.p99 ?? 0}мс`} sub="99-й перцентиль" icon={Gauge} color={S.warning} />
        <KpiCard label="Ошибки" value={data?.requests.errorRate ?? "0.0%"} sub={`${data?.requests.windowErrors ?? 0} за мин`} icon={AlertCircle} color={Number(data?.requests.errorRate) > 5 ? S.danger : S.success} />
        <KpiCard label="Uptime" value={data?.server.uptimeFormatted ?? "—"} sub={data?.server.environment} icon={Clock} color={S.primary} />
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Запросов в секунду" icon={Activity}>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradRps" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={S.primary} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={S.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={S.borderSub} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: S.textTer }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: S.textTer }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="rps" name="RPS" stroke={S.primary} strokeWidth={2} fill="url(#gradRps)" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Section>
        <Section title="Время ответа (мс)" icon={Timer}>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradResp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={S.success} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={S.success} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={S.borderSub} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: S.textTer }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: S.textTer }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="response" name="мс" stroke={S.success} strokeWidth={2} fill="url(#gradResp)" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Section>
        <Section title="Ошибки в секунду" icon={AlertCircle}>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={S.borderSub} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: S.textTer }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: S.textTer }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="errors" name="Ошибки" fill={S.danger} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
        <Section title="Память (MB)" icon={MemoryStick}>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradHeap" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={S.info} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={S.info} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={S.borderSub} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: S.textTer }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: S.textTer }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="heap" name="Heap MB" stroke={S.info} strokeWidth={2} fill="url(#gradHeap)" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>

      {/* Detail Grid */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Section title="Сервер" icon={Server}>
          <div className="space-y-3">
            {[
              ["Статус", <Badge status={data?.server.status ?? "ok"} label={data?.server.status ?? "ok"} />],
              ["Версия", <span className="text-sm font-semibold" style={{ color: S.text }}>{data?.server.version}</span>],
              ["Node.js", <span className="text-xs font-mono" style={{ color: S.textSec }}>{data?.server.nodeVersion}</span>],
              ["PID", <span className="text-xs font-mono" style={{ color: S.textSec }}>{data?.server.pid}</span>],
              ["Окружение", <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: data?.server.environment === "production" ? S.dangerSub : S.infoSub, color: data?.server.environment === "production" ? S.danger : S.info }}>{data?.server.environment}</span>],
            ].map(([label, val], i) => (
              <div key={i} className="flex items-center justify-between py-1.5" style={i > 0 ? { borderTop: `1px solid ${S.borderSub}` } : undefined}>
                <span className="text-xs" style={{ color: S.textSec }}>{label as string}</span>{val}
              </div>
            ))}
          </div>
        </Section>
        <Section title="База данных" icon={Database}>
          <div className="space-y-3">
            {[
              ["Статус", <Badge status={dbOk ? "connected" : "disconnected"} label={dbOk ? "Подключена" : "Отключена"} />],
              ["Отклик", <span className="text-sm font-semibold" style={{ color: (data?.database.responseTimeMs ?? 0) > 200 ? S.warning : S.success }}>{data?.database.responseTimeMs ?? 0} мс</span>],
            ].map(([label, val], i) => (
              <div key={i} className="flex items-center justify-between py-1.5" style={i > 0 ? { borderTop: `1px solid ${S.borderSub}` } : undefined}>
                <span className="text-xs" style={{ color: S.textSec }}>{label as string}</span>{val}
              </div>
            ))}
          </div>
        </Section>
        <Section title="Кэш и SSE" icon={Layers}>
          <div className="space-y-3">
            {[
              ["Кэш hit rate", <span className="text-sm font-semibold" style={{ color: S.text }}>{data?.cache.hitRate}</span>],
              ["Кэш размер", <span className="text-sm" style={{ color: S.textSec }}>{data?.cache.size} записей</span>],
              ["SSE каналы", <span className="text-sm font-semibold" style={{ color: S.primary }}>{data?.sse.channels}</span>],
              ["SSE клиенты", <span className="text-sm font-semibold" style={{ color: S.success }}>{data?.sse.totalListeners}</span>],
            ].map(([label, val], i) => (
              <div key={i} className="flex items-center justify-between py-1.5" style={i > 0 ? { borderTop: `1px solid ${S.borderSub}` } : undefined}>
                <span className="text-xs" style={{ color: S.textSec }}>{label as string}</span>{val}
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* ═══════════════ ERROR LOG ═══════════════ */}
      <Section
        title={`Журнал ошибок${errorData?.total ? ` (${errorData.total})` : ""}`}
        icon={AlertCircle}
        actions={
          <div className="flex items-center gap-2">
            {/* Filter */}
            <div className="flex items-center gap-1">
              {["", "400", "401", "403", "404", "500"].map((code) => (
                <button
                  key={code}
                  onClick={() => setErrorFilter(code)}
                  className="px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors"
                  style={{
                    background: errorFilter === code ? S.primarySub : "transparent",
                    color: errorFilter === code ? S.primary : S.textTer,
                    borderColor: errorFilter === code ? S.primary + "30" : S.borderSub,
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
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="p-3 rounded-xl text-center" style={{ background: S.light }}>
              <div className="text-xl font-bold" style={{ color: S.danger }}>{errorStats.last5m}</div>
              <div className="text-[10px] font-medium uppercase tracking-wider" style={{ color: S.textTer }}>За 5 мин</div>
            </div>
            <div className="p-3 rounded-xl text-center" style={{ background: S.light }}>
              <div className="text-xl font-bold" style={{ color: S.warning }}>{errorStats.last1h}</div>
              <div className="text-[10px] font-medium uppercase tracking-wider" style={{ color: S.textTer }}>За час</div>
            </div>
            <div className="p-3 rounded-xl text-center" style={{ background: S.light }}>
              <div className="text-xl font-bold" style={{ color: S.text }}>{errorStats.total}</div>
              <div className="text-[10px] font-medium uppercase tracking-wider" style={{ color: S.textTer }}>Всего</div>
            </div>
          </div>
        )}

        {/* Top error paths */}
        {errorStats && errorStats.byPath.length > 0 && (
          <div className="mb-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: S.textTer }}>Топ путей с ошибками</div>
            <div className="space-y-1">
              {errorStats.byPath.slice(0, 5).map((p) => (
                <div key={p.path} className="flex items-center justify-between px-3 py-1.5 rounded-lg text-xs" style={{ background: S.light }}>
                  <span className="font-mono truncate" style={{ color: S.textSec }}>{p.path}</span>
                  <span className="font-bold" style={{ color: S.danger }}>{p.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error list */}
        <div className="overflow-x-auto">
          {(!errorData?.errors || errorData.errors.length === 0) ? (
            <div className="text-center py-8" style={{ color: S.textTer }}>
              <CheckCircle2 size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Ошибок не обнаружено</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: `1px solid ${S.borderSub}` }}>
                  {["Статус", "Код", "Сообщение", "Путь", "Время", ""].map((h) => (
                    <th key={h} className={`text-[10px] font-semibold uppercase tracking-wider py-2 ${h === "Сообщение" || h === "Путь" ? "text-left" : h === "" ? "text-right" : "text-left"}`} style={{ color: S.textTer }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {errorData.errors.map((err) => (
                  <tr
                    key={err.id}
                    className="cursor-pointer transition-colors"
                    style={{ borderBottom: `1px solid ${S.borderSub}` }}
                    onClick={() => setSelectedErrorId(err.id)}
                    onMouseEnter={(e) => (e.currentTarget.style.background = S.hover)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td className="py-2.5 pr-3">
                      <span className="inline-flex items-center justify-center w-8 h-6 rounded text-[10px] font-bold" style={{ background: statusColor(err.statusCode) + "15", color: statusColor(err.statusCode) }}>
                        {err.statusCode}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="text-xs font-mono" style={{ color: S.textSec }}>{err.code}</span>
                    </td>
                    <td className="py-2.5 pr-3 max-w-[300px]">
                      <span className="text-xs truncate block" style={{ color: S.text }}>{err.message}</span>
                    </td>
                    <td className="py-2.5 pr-3 max-w-[200px]">
                      <span className="text-xs font-mono truncate block" style={{ color: S.textTer }}>{err.path}</span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="text-[11px]" style={{ color: S.textTer }}>{timeAgo(err.timestamp)}</span>
                    </td>
                    <td className="py-2.5 text-right">
                      <ChevronRight size={14} style={{ color: S.textTer }} />
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
        <Section title="Метрики" icon={BarChart3}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: `1px solid ${S.borderSub}` }}>
                  {["Метрика", "Записей", "Значение", "Время"].map((h) => (
                    <th key={h} className={`text-[10px] font-semibold uppercase tracking-wider py-2 ${h === "Метрика" ? "text-left" : "text-right"}`} style={{ color: S.textTer }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.metrics).map(([name, m]) => (
                  <tr key={name} style={{ borderBottom: `1px solid ${S.borderSub}` }}>
                    <td className="py-2 font-mono text-xs" style={{ color: S.primary }}>{name}</td>
                    <td className="py-2 text-right" style={{ color: S.textSec }}>{m.count}</td>
                    <td className="py-2 text-right font-semibold" style={{ color: S.text }}>{m.lastValue}</td>
                    <td className="py-2 text-right text-xs" style={{ color: S.textTer }}>{new Date(m.lastTimestamp).toLocaleTimeString("ru")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <div className="text-center text-xs py-3" style={{ color: S.textTer }}>
        Обновление: {REFRESH_INTERVAL / 1000}с &middot; История: 120 точек &middot; Ошибки: 200 макс &middot;{" "}
        <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background: S.light, border: `1px solid ${S.border}`, color: S.textSec }}>R</kbd> обновить
      </div>
    </div>
  );
}
