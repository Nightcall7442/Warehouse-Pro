import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { format } from "date-fns";
import { ru as dateRu } from "date-fns/locale";
import {
  Shield, Filter, Loader2, ChevronLeft, ChevronRight,
  User, Package, Settings, AlertTriangle, Key,
  RefreshCw, ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";

// ── Premium design tokens ─────────────────────────────────────────────────────
const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };
const COLORS = {
  primary: "#818cf8", success: "#4ade80",
  warning: "#fbbf24", danger: "#f87171",
  surface: "var(--color-surface, #ffffff)", surfaceLight: "var(--color-surface-light, #f8f9fb)",
  textPrimary: "var(--color-text-primary, #111827)", textSecondary: "var(--color-text-secondary, #6b7280)",
  textTertiary: "var(--color-text-tertiary, #9ca3af)", border: "var(--color-border, #f3f4f6)",
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
if (typeof document !== "undefined" && !document.getElementById("auditlog-keyframes")) {
  const style = document.createElement("style");
  style.id = "auditlog-keyframes";
  style.textContent = slideUpKeyframe;
  document.head.appendChild(style);
}

// ── KpiCard ───────────────────────────────────────────────────────────────────
function KpiCard({ label, value, delta, icon, gradient, delay }: {
  label: string; value: string; delta?: number | null;
  icon: React.ReactNode; gradient: string; delay: number;
}) {
  const isPositive = delta !== null && delta !== undefined && delta > 0;
  const isNegative = delta !== null && delta !== undefined && delta < 0;
  return (
    <div style={{
      background: COLORS.surface, borderRadius: "24px", padding: "24px",
      boxShadow: SHADOW, position: "relative", overflow: "hidden",
      animation: `slideUp ${0.5 + delay}s ease forwards`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>
          {label}
        </span>
        <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon}
        </div>
      </div>
      <div style={{ fontFamily: F.display, fontSize: "32px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>
        {value}
      </div>
      {delta !== null && delta !== undefined && (
        <div style={{
          display: "flex", alignItems: "center", gap: "4px", marginTop: "10px",
          fontSize: "12px", fontWeight: 600, fontFamily: F.body,
          color: isPositive ? "#4ade80" : isNegative ? "#f87171" : COLORS.textTertiary,
        }}>
          {isPositive ? <ArrowUpRight size={14} /> : isNegative ? <ArrowDownRight size={14} /> : <Minus size={14} />}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

// ── Action config ─────────────────────────────────────────────────────────────
const ACTION_CONFIG: Record<string, {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  gradient: string;
  label: { ru: string; uz: string };
}> = {
  "user.updated":                    { icon: User,         gradient: "linear-gradient(135deg, #818cf8, #6366f1)", label: { ru: "Обновлён пользователь", uz: "Foydalanuvchi yangilandi" } },
  "user.deactivated":                { icon: User,         gradient: "linear-gradient(135deg, #ef4444, #f87171)", label: { ru: "Пользователь деактивирован", uz: "Foydalanuvchi o'chirildi" } },
  "user.password_reset_by_admin":    { icon: Key,          gradient: "linear-gradient(135deg, #fb923c, #f97316)", label: { ru: "Сброс пароля", uz: "Parol tiklandi" } },
  "stock.adjusted":                  { icon: Package,      gradient: "linear-gradient(135deg, #fbbf24, #f59e0b)", label: { ru: "Корректировка склада", uz: "Ombor tahrirlandi" } },
  "integration.onec_secret_rotated": { icon: Settings,     gradient: "linear-gradient(135deg, #10B981, #059669)", label: { ru: "Ротация ключа 1C", uz: "1C kalit almashtirildi" } },
  "tenant.updated":                  { icon: AlertTriangle, gradient: "linear-gradient(135deg, #f87171, #ef4444)", label: { ru: "Обновлён тенант", uz: "Tench yangilandi" } },
};

const ACTION_FILTERS = [
  { key: "all",      label: { ru: "Все",           uz: "Hammasi" } },
  { key: "user",     label: { ru: "Пользователи",  uz: "Foydalanuvchilar" } },
  { key: "stock",    label: { ru: "Склад",          uz: "Ombor" } },
  { key: "tenant",   label: { ru: "Тенант",         uz: "Tench" } },
];

function formatTime(date: Date | string, lang: string): string {
  const d = new Date(date);
  return format(d, "dd MMM yyyy HH:mm", { locale: lang === "ru" ? dateRu : undefined });
}

function timeAgo(date: Date | string, lang: string): string {
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return lang === "uz" ? "Hozirgina" : "Только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} ${lang === "uz" ? "daq" : "мин"}`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ${lang === "uz" ? "soat" : "ч"}`;
  return `${Math.floor(diff / 86400)} ${lang === "uz" ? "kun" : "дн"}`;
}

// ── Meta detail panel ─────────────────────────────────────────────────────────
function MetaDetail({ meta }: { meta: Record<string, unknown> | null }) {
  if (!meta || Object.keys(meta).length === 0) return null;

  return (
    <div style={{
      marginTop: "12px", padding: "14px 16px", borderRadius: "12px",
      background: COLORS.surfaceLight, border: `1px solid ${COLORS.border}`,
    }}>
      <div style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px", color: COLORS.textTertiary, fontFamily: F.body }}>
        Детали
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {Object.entries(meta).map(([key, value]) => (
          <div key={key} style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "12px" }}>
            <span style={{ fontFamily: "monospace", fontWeight: 600, minWidth: "80px", color: COLORS.textSecondary, fontSize: "11px" }}>{key}:</span>
            <span style={{ fontFamily: "monospace", wordBreak: "break-all", color: COLORS.textPrimary, fontSize: "12px" }}>
              {typeof value === "object" ? JSON.stringify(value) : String(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AuditLog() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [actionFilter, setActionFilter] = useState("");
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const limit = 50;

  const { data, isLoading, refetch, isRefetching } = trpc.audit.list.useQuery({
    action: actionFilter || undefined,
    limit,
    offset: page * limit,
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.025em", margin: 0, display: "flex", alignItems: "center", gap: "10px" }}>
            <Shield size={24} style={{ color: COLORS.primary }} />
            {t("Аудит-лог", "Audit jurnali")}
          </h1>
          <p style={{ fontSize: "13px", color: COLORS.textSecondary, margin: "4px 0 0" }}>
            {t("История чувствительных действий", "Hassas harakatlar tarixi")}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
            border: `1px solid ${COLORS.border}`, cursor: "pointer",
            background: COLORS.surface, color: COLORS.textSecondary,
            opacity: isRefetching ? 0.6 : 1,
          }}
        >
          <RefreshCw size={14} style={{ animation: isRefetching ? "spin 1s linear infinite" : undefined }} />
          {t("Обновить", "Yangilash")}
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", overflowX: "auto", paddingBottom: "4px" }}>
        {ACTION_FILTERS.map((f) => {
          const active = (f.key === "all" && !actionFilter) || actionFilter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => { setActionFilter(f.key === "all" ? "" : f.key); setPage(0); }}
              style={{
                display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
                fontSize: "12px", fontWeight: 600, fontFamily: F.body, borderRadius: "10px",
                border: "none", cursor: "pointer", transition: "all 0.2s", whiteSpace: "nowrap" as const,
                background: active ? COLORS.primary : COLORS.surfaceLight,
                color: active ? "#fff" : COLORS.textSecondary,
                boxShadow: active ? "0 2px 8px rgba(129,140,248,0.25)" : "none",
              }}
            >
              {f.key === "all" && <Filter size={12} />}
              {t(f.label.ru, f.label.uz)}
            </button>
          );
        })}
      </div>

      {/* KPI Stats Row */}
      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
          <KpiCard
            label={t("ВСЕГО ЗАПИСЕЙ", "JAMI YOZUVLAR")}
            value={String(data.total)}
            icon={<Shield size={20} color="#fff" />}
            gradient="linear-gradient(135deg, #818cf8, #6366f1)"
            delay={0}
          />
          <KpiCard
            label={t("СТРАНИЦА", "SAHIFA")}
            value={`${page + 1} / ${totalPages}`}
            icon={<Filter size={20} color="#fff" />}
            gradient="linear-gradient(135deg, #10B981, #059669)"
            delay={0.05}
          />
          {data.data && (
            <KpiCard
              label={t("НА ЭТОЙ СТРАНИЦE", "SHU SAHIFADA")}
              value={String(data.data.length)}
              icon={<Package size={20} color="#fff" />}
              gradient="linear-gradient(135deg, #fb923c, #f97316)"
              delay={0.1}
            />
          )}
        </div>
      )}

      {/* Log entries */}
      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{
              height: "72px", borderRadius: "24px", background: COLORS.surfaceLight,
              animation: `slideUp ${0.4 + i * 0.05}s ease forwards`,
            }} />
          ))}
        </div>
      ) : !data?.data || data.data.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "80px 0",
          background: COLORS.surface, borderRadius: "24px", boxShadow: SHADOW,
        }}>
          <Shield size={40} style={{ margin: "0 auto 14px", opacity: 0.15, color: COLORS.textTertiary }} />
          <p style={{ fontSize: "14px", color: COLORS.textSecondary, fontFamily: F.body }}>
            {t("Нет записей", "Yozuvlar yo'q")}
          </p>
        </div>
      ) : (
        <div style={{ background: COLORS.surface, borderRadius: "24px", boxShadow: SHADOW, overflow: "hidden" }}>
          {data.data.map((entry, i) => {
            const config = ACTION_CONFIG[entry.action] ?? {
              icon: Shield, gradient: "linear-gradient(135deg, #6B7280, #9CA3AF)",
              label: { ru: entry.action, uz: entry.action },
            };
            const Icon = config.icon;
            const isLast = i === data.data.length - 1;
            const isExpanded = expandedId === entry.id;

            return (
              <div
                key={entry.id}
                style={{
                  borderBottom: isLast ? "none" : `1px solid ${COLORS.border}`,
                  animation: `slideUp ${0.4 + i * 0.03}s ease forwards`,
                }}
              >
                <div
                  style={{
                    display: "flex", alignItems: "flex-start", gap: "14px", padding: "16px 20px",
                    cursor: "pointer", transition: "background 0.15s",
                  }}
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(129,140,248,0.02)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  {/* Gradient icon */}
                  <div style={{
                    width: "40px", height: "40px", borderRadius: "12px",
                    background: config.gradient, display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <Icon size={16} color="#fff" />
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
                      <div>
                        <p style={{ fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary, fontFamily: F.display, margin: 0 }}>
                          {t(config.label.ru, config.label.uz)}
                        </p>
                        {entry.targetType && entry.targetId && (
                          <p style={{ fontSize: "12px", color: COLORS.textTertiary, margin: "2px 0 0" }}>
                            {entry.targetType} #{entry.targetId}
                          </p>
                        )}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <p style={{ fontSize: "11px", color: COLORS.textTertiary, margin: 0 }}>
                          {entry.createdAt ? timeAgo(entry.createdAt, lang) : ""}
                        </p>
                      </div>
                    </div>

                    {/* Actor + metadata */}
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px", flexWrap: "wrap" }}>
                      {entry.actorName && (
                        <span style={{
                          fontSize: "11px", fontWeight: 600, padding: "3px 8px", borderRadius: "6px",
                          background: COLORS.surfaceLight, color: COLORS.textSecondary, fontFamily: F.body,
                        }}>
                          {entry.actorName}
                        </span>
                      )}
                      {entry.ip && (
                        <span style={{ fontSize: "10px", fontFamily: "monospace", color: COLORS.textTertiary }}>
                          {entry.ip}
                        </span>
                      )}
                      <span style={{ fontSize: "10px", color: COLORS.textTertiary, fontFamily: F.body }}>
                        {entry.createdAt ? formatTime(entry.createdAt, lang) : ""}
                      </span>
                    </div>

                    {/* Expanded meta */}
                    {isExpanded && <MetaDetail meta={entry.meta as Record<string, unknown> | null} />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {data && data.total > limit && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: "12px",
          background: COLORS.surface, borderRadius: "16px", padding: "16px", boxShadow: SHADOW,
        }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{
              display: "flex", alignItems: "center", gap: "4px", padding: "8px 14px",
              fontSize: "12px", fontWeight: 600, fontFamily: F.body, borderRadius: "10px",
              border: `1px solid ${COLORS.border}`, cursor: "pointer",
              background: COLORS.surface, color: COLORS.textSecondary,
              opacity: page === 0 ? 0.4 : 1,
            }}
          >
            <ChevronLeft size={14} /> {t("Назад", "Orqaga")}
          </button>
          <span style={{ fontSize: "12px", fontWeight: 600, color: COLORS.textSecondary, fontFamily: F.display }}>
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={{
              display: "flex", alignItems: "center", gap: "4px", padding: "8px 14px",
              fontSize: "12px", fontWeight: 600, fontFamily: F.body, borderRadius: "10px",
              border: `1px solid ${COLORS.border}`, cursor: "pointer",
              background: COLORS.surface, color: COLORS.textSecondary,
              opacity: page >= totalPages - 1 ? 0.4 : 1,
            }}
          >
            {t("Далее", "Keyingi")} <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
