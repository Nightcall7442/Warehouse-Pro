import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { format, isToday, isYesterday } from "date-fns";
import { ru as dateRu } from "date-fns/locale";
import {
  Bell, ShoppingCart, AlertTriangle, Package,
  Users, CheckCheck, Loader2, ExternalLink,
  Filter, Warehouse, CreditCard, Zap, Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Type config aligned with DB enum: order | payment | stock | system ────────
const TYPE_CONFIG: Record<string, {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
  bg: string;
  label: { ru: string; uz: string };
}> = {
  order:   { icon: ShoppingCart,  color: "text-primary", bg: "bg-primary/10",   label: { ru: "Заказ",       uz: "Buyurtma" } },
  payment: { icon: CreditCard,    color: "text-success", bg: "bg-success/10",  label: { ru: "Платёж",      uz: "To'lov" } },
  stock:   { icon: Warehouse,     color: "text-warning", bg: "bg-warning/10",  label: { ru: "Склад",       uz: "Ombor" } },
  system:  { icon: Settings,      color: "text-info",    bg: "bg-info/10",     label: { ru: "Система",     uz: "Tizim" } },
};

const FILTERS = [
  { key: "all",    label: { ru: "Все",      uz: "Hammasi" } },
  { key: "order",  label: { ru: "Заказы",   uz: "Buyurtmalar" } },
  { key: "stock",  label: { ru: "Склад",    uz: "Ombor" } },
  { key: "payment",label: { ru: "Платежи",  uz: "To'lovlar" } },
  { key: "system", label: { ru: "Система",  uz: "Tizim" } },
];

// ── Time formatting ──────────────────────────────────────────────────────────
function formatTime(date: Date, lang: string): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return lang === "uz" ? "Hozirgina" : "Только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} ${lang === "uz" ? "daq" : "мин"}`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ${lang === "uz" ? "soat" : "ч"}`;
  return format(date, "d MMM", { locale: lang === "ru" ? dateRu : undefined });
}

function formatDateGroup(date: Date, lang: string): string {
  if (isToday(date)) return lang === "uz" ? "Bugun" : "Сегодня";
  if (isYesterday(date)) return lang === "uz" ? "Kecha" : "Вчера";
  return format(date, "d MMMM yyyy", { locale: lang === "ru" ? dateRu : undefined });
}

function groupByDate(items: Array<{ createdAt: Date | string }>): Map<string, typeof items> {
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const date = new Date(item.createdAt);
    const key = date.toISOString().split("T")[0];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return groups;
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function Notifications() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState("all");

  const { data: notifications, isLoading } = trpc.notification.list.useQuery();
  const { data: countData } = trpc.notification.unreadCount.useQuery();

  const markAllRead = trpc.notification.markAllRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate();
      utils.notification.unreadCount.invalidate();
    },
  });

  const markRead = trpc.notification.markRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate();
      utils.notification.unreadCount.invalidate();
    },
  });

  const unreadCount = countData?.count ?? 0;

  // Filter notifications
  const filtered = notifications?.filter((n) => filter === "all" || n.type === filter) ?? [];
  const grouped = groupByDate(filtered);

  const handleClick = (n: typeof filtered[0]) => {
    if (!n.isRead) markRead.mutate({ id: n.id });
    if (n.link) navigate(n.link);
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-surface-light animate-pulse rounded" />
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-8 w-20 bg-surface-light animate-pulse rounded-lg" />)}
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 bg-surface-light animate-pulse rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5 animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-primary tracking-tight">
            {t("Уведомления", "Bildirishnomalar")}
          </h1>
          {unreadCount > 0 && (
            <p className="text-xs mt-0.5" style={{ color: "#5b6d8a" }}>
              {unreadCount} {t("непрочитанных", "o'qilmagan")}
            </p>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="neo-btn flex items-center gap-2 text-sm py-2"
          >
            {markAllRead.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}
            {t("Прочитать все", "Hammasini o'qish")}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap"
            style={{
              background: filter === f.key ? "var(--color-primary-subtle, rgba(75,108,246,.10))" : "var(--color-surface-light, #f0f3f8)",
              color: filter === f.key ? "#5b6d8a" : "var(--color-text-secondary, #6a7290)",
              border: `1px solid ${filter === f.key ? "#c7c9f8" : "var(--color-border, #f0f3f8)"}`,
            }}
          >
            {f.key === "all" && <Filter size={12} />}
            {t(f.label.ru, f.label.uz)}
          </button>
        ))}
      </div>

      {/* Notification list */}
      {!notifications || notifications.length === 0 ? (
        <div className="text-center py-20 panel">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
            <Bell size={28} style={{ color: "var(--color-text-tertiary, #98a0b8)" }} />
          </div>
          <p className="text-secondary text-sm font-medium mb-1">
            {t("Нет уведомлений", "Bildirishnomalar yo'q")}
          </p>
          <p className="text-xs" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
            {t("Новые уведомления появятся здесь", "Yangi bildirishnomalar bu yerda paydo bo'ladi")}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 panel">
          <Filter size={28} className="mx-auto mb-3 opacity-20" style={{ color: "var(--color-text-tertiary, #98a0b8)" }} />
          <p className="text-secondary text-sm">
            {t("Нет уведомлений в этой категории", "Bu turkumda bildirishnomalar yo'q")}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from(grouped.entries()).map(([dateKey, items]) => {
            const date = new Date(dateKey + "T12:00:00");
            return (
              <div key={dateKey}>
                {/* Date group header */}
                <div className="flex items-center gap-3 mb-2 px-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
                    {formatDateGroup(date, lang)}
                  </span>
                  <div className="flex-1 h-px" style={{ background: "var(--color-border, #f0f3f8)" }} />
                  <span className="text-[10px] font-medium" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
                    {items.length}
                  </span>
                </div>

                {/* Notifications in this group */}
                <div className="neo-card overflow-hidden">
                  {items.map((n, i) => {
                    const typeKey = n.type ?? "system";
                    const style = TYPE_CONFIG[typeKey] ?? TYPE_CONFIG.system;
                    const Icon = style.icon;
                    const isLast = i === items.length - 1;

                    return (
                      <div
                        key={n.id}
                        className={cn(
                          "flex items-start gap-3 px-4 py-3.5 transition-all duration-200",
                          n.link ? "cursor-pointer" : "cursor-default",
                          !n.isRead ? "bg-primary/[0.03] hover:bg-primary/[0.06]" : "hover:bg-surface-light/50",
                        )}
                        style={{ borderBottom: isLast ? "none" : "1px solid #f0f3f8" }}
                        onClick={() => handleClick(n)}
                      >
                        {/* Icon */}
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${style.bg}`}>
                          <Icon size={16} className={style.color} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-sm leading-snug ${!n.isRead ? "font-semibold" : ""}`} style={{ color: "var(--color-text-primary, #2b3450)" }}>
                              {n.title}
                            </p>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {n.link && (
                                <ExternalLink size={12} style={{ color: "var(--color-text-tertiary, #98a0b8)" }} />
                              )}
                              {!n.isRead && (
                                <span className="w-2 h-2 rounded-full" style={{ background: "#5b6d8a" }} />
                              )}
                            </div>
                          </div>
                          {n.message && (
                            <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--color-text-secondary, #6a7290)" }}>
                              {n.message}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-[10px] font-medium" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
                              {formatTime(new Date(n.createdAt), lang)}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: "var(--color-surface-light, #f0f3f8)", color: "var(--color-text-tertiary, #98a0b8)" }}>
                              {style.label[lang as "ru" | "uz"]}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Stats footer */}
      {notifications && notifications.length > 0 && (
        <div className="text-center text-[11px] py-2" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
          {t(`Показано ${notifications.length} уведомлений`, `${notifications.length} ta bildirishnoma ko'rsatilgan`)}
        </div>
      )}
    </div>
  );
}
