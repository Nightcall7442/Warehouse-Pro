import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { format } from "date-fns";
import { ru as dateRu } from "date-fns/locale";
import {
  Shield, Filter, Loader2, ChevronLeft, ChevronRight,
  User, Package, Settings, AlertTriangle, Key,
  RefreshCw,
} from "lucide-react";

// ── Action config ────────────────────────────────────────────────────────────
const ACTION_CONFIG: Record<string, {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
  bg: string;
  label: { ru: string; uz: string };
}> = {
  "user.updated":                    { icon: User,         color: "text-info",    bg: "bg-info/10",    label: { ru: "Обновлён пользователь", uz: "Foydalanuvchi yangilandi" } },
  "user.deactivated":                { icon: User,         color: "text-danger",  bg: "bg-danger/10",  label: { ru: "Пользователь деактивирован", uz: "Foydalanuvchi o'chirildi" } },
  "user.password_reset_by_admin":    { icon: Key,          color: "text-warning", bg: "bg-warning/10", label: { ru: "Сброс пароля", uz: "Parol tiklandi" } },
  "stock.adjusted":                  { icon: Package,      color: "text-warning", bg: "bg-warning/10", label: { ru: "Корректировка склада", uz: "Ombor tahrirlandi" } },
  "integration.onec_secret_rotated": { icon: Settings,     color: "text-primary", bg: "bg-primary/10", label: { ru: "Ротация ключа 1C", uz: "1C kalit almashtirildi" } },
  "tenant.updated":                  { icon: AlertTriangle, color: "text-danger", bg: "bg-danger/10",  label: { ru: "Обновлён тенант", uz: "Tench yangilandi" } },
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

// ── Meta detail panel ────────────────────────────────────────────────────────
function MetaDetail({ meta }: { meta: Record<string, unknown> | null }) {
  if (!meta || Object.keys(meta).length === 0) return null;

  return (
    <div className="mt-3 p-3 rounded-lg" style={{ background: "var(--color-surface-light)" }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-tertiary)" }}>
        Детали
      </div>
      <div className="space-y-1.5">
        {Object.entries(meta).map(([key, value]) => (
          <div key={key} className="flex items-start gap-2 text-xs">
            <span className="font-mono font-medium min-w-[80px]" style={{ color: "var(--color-text-secondary)" }}>{key}:</span>
            <span className="font-mono break-all" style={{ color: "var(--color-text-primary)" }}>
              {typeof value === "object" ? JSON.stringify(value) : String(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
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
    <div className="space-y-5 animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary tracking-tight flex items-center gap-3">
            <Shield size={24} style={{ color: "var(--color-primary)" }} />
            {t("Аудит-лог", "Audit jurnali")}
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
            {t("История чувствительных действий", "Hassas harakatlar tarixi")}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="btn-secondary flex items-center gap-1.5 text-xs py-1.5"
        >
          <RefreshCw size={13} className={isRefetching ? "animate-spin" : ""} />
          {t("Обновить", "Yangilash")}
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {ACTION_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => { setActionFilter(f.key === "all" ? "" : f.key); setPage(0); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap"
            style={{
              background: (f.key === "all" && !actionFilter) || actionFilter === f.key
                ? "var(--color-primary-subtle)" : "var(--color-surface-light)",
              color: (f.key === "all" && !actionFilter) || actionFilter === f.key
                ? "var(--color-primary)" : "var(--color-text-secondary)",
              border: `1px solid ${(f.key === "all" && !actionFilter) || actionFilter === f.key
                ? "var(--color-primary-muted)" : "var(--color-border-subtle)"}`,
            }}
          >
            {f.key === "all" && <Filter size={12} />}
            {t(f.label.ru, f.label.uz)}
          </button>
        ))}
      </div>

      {/* Stats */}
      {data && (
        <div className="flex items-center gap-4 text-xs" style={{ color: "var(--color-text-tertiary)" }}>
          <span>{t(`Всего: ${data.total}`, `Jami: ${data.total}`)}</span>
          <span>{t(`Страница ${page + 1} из ${totalPages}`, `${page + 1}/${totalPages} sahifa`)}</span>
        </div>
      )}

      {/* Log entries */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 bg-surface-light animate-pulse rounded-xl" />
          ))}
        </div>
      ) : !data?.data || data.data.length === 0 ? (
        <div className="text-center py-20 panel">
          <Shield size={32} className="mx-auto mb-3 opacity-20" style={{ color: "var(--color-text-tertiary)" }} />
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            {t("Нет записей", "Yozuvlar yo'q")}
          </p>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          {data.data.map((entry, i) => {
            const config = ACTION_CONFIG[entry.action] ?? {
              icon: Shield, color: "text-text-secondary", bg: "bg-surface-light",
              label: { ru: entry.action, uz: entry.action },
            };
            const Icon = config.icon;
            const isLast = i === data.data.length - 1;
            const isExpanded = expandedId === entry.id;

            return (
              <div
                key={entry.id}
                style={{ borderBottom: isLast ? "none" : "1px solid var(--color-border-subtle)" }}
              >
                <div
                  className="flex items-start gap-3 px-4 py-3.5 cursor-pointer transition-colors hover:bg-surface-light/50"
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                >
                  {/* Icon */}
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${config.bg}`}>
                    <Icon size={16} className={config.color} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
                          {t(config.label.ru, config.label.uz)}
                        </p>
                        {entry.targetType && entry.targetId && (
                          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
                            {entry.targetType} #{entry.targetId}
                          </p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[11px]" style={{ color: "var(--color-text-tertiary)" }}>
                          {entry.createdAt ? timeAgo(entry.createdAt, lang) : ""}
                        </p>
                      </div>
                    </div>

                    {/* Actor + timestamp */}
                    <div className="flex items-center gap-3 mt-1.5">
                      {entry.actorName && (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded" style={{ background: "var(--color-surface-light)", color: "var(--color-text-secondary)" }}>
                          {entry.actorName}
                        </span>
                      )}
                      {entry.ip && (
                        <span className="text-[10px] font-mono" style={{ color: "var(--color-text-tertiary)" }}>
                          {entry.ip}
                        </span>
                      )}
                      <span className="text-[10px]" style={{ color: "var(--color-text-tertiary)" }}>
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
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="btn-secondary flex items-center gap-1 text-xs py-1.5 px-3 disabled:opacity-40"
          >
            <ChevronLeft size={14} /> {t("Назад", "Orqaga")}
          </button>
          <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="btn-secondary flex items-center gap-1 text-xs py-1.5 px-3 disabled:opacity-40"
          >
            {t("Далее", "Keyingi")} <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
