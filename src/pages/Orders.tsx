import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { useNavigate } from "react-router";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Search, Plus, FileDown, ChevronRight, Store, User,
  ShoppingCart, Clock, CheckCircle2, XCircle, DollarSign,
  ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";
import { format } from "date-fns";
import { exportToExcel, formatOrdersForExport } from "@/lib/excel";
import { PremiumSelect } from "@/components/PremiumSelect";

/* ─── Premium Design Constants ─── */
const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };
const COLORS = {
  primary: "#4b6cf6", success: "#34c473",
  warning: "#e8a830", danger: "#e85050",
  surface: "var(--color-surface, #ffffff)", surfaceLight: "var(--color-surface-light, #f0f3f8)",
  textPrimary: "var(--color-text-primary, #2b3450)", textSecondary: "var(--color-text-secondary, #6a7290)",
  textTertiary: "var(--color-text-tertiary, #98a0b8)", border: "var(--color-border, #f0f3f8)",
};
const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

/* ─── Status Config ─── */
const STATUS: Record<string, { ru: string; uz: string; dot: string; bg: string; text: string; border: string }> = {
  new:        { ru: "Новый",       uz: "Yangi",         dot: "#4b6cf6", bg: "bg-info/10",    text: "text-info",    border: "border-info/25" },
  processing: { ru: "В обработке", uz: "Jarayonda",     dot: "#e8a830", bg: "bg-warning/10", text: "text-warning", border: "border-warning/25" },
  completed:  { ru: "Выполнен",    uz: "Bajarildi",     dot: "#34c473", bg: "bg-success/10", text: "text-success", border: "border-success/25" },
  cancelled:  { ru: "Отменён",     uz: "Bekor qilindi", dot: "#e85050", bg: "bg-danger/10",  text: "text-danger",  border: "border-danger/25" },
};

/* ─── Payment Method Config ─── */
const PAYMENT_METHODS: Record<string, { ru: string; uz: string; color: string }> = {
  cash:     { ru: "Наличные",     uz: "Naqd",       color: "#34c473" },
  transfer: { ru: "Перечисление", uz: "O'tkazma",   color: "#4b6cf6" },
  debt:     { ru: "Долг",         uz: "Qarz",       color: "#e8a830" },
  card:     { ru: "Карта",        uz: "Plastik",    color: "#9b59b6" },
};

/* ─── Premium KpiCard Component ─── */
function PaymentMethodBadge({ method, lang }: { method?: string; lang: "ru" | "uz" }) {
  const m = PAYMENT_METHODS[method ?? "cash"];
  if (!m) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      padding: "2px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 600,
      background: `${m.color}15`, color: m.color,
    }}>
      {lang === "uz" ? m.uz : m.ru}
    </span>
  );
}

function KpiCard({ label, value, delta, icon, gradient, delay }: {
  label: string; value: string; delta: number | null;
  icon: React.ReactNode; gradient: string; delay: number;
}) {
  const isPositive = delta !== null && delta > 0;
  const isNegative = delta !== null && delta < 0;
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
          {icon}
        </div>
      </div>
      <div style={{ fontFamily: F.display, fontSize: "32px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>
        {value}
      </div>
      {delta !== null && (
        <div style={{
          display: "flex", alignItems: "center", gap: "4px", marginTop: "10px",
          fontSize: "12px", fontWeight: 600, fontFamily: F.body,
          color: isPositive ? "#34c473" : isNegative ? "#e85050" : COLORS.textTertiary,
        }}>
          {isPositive ? <ArrowUpRight size={14} /> : isNegative ? <ArrowDownRight size={14} /> : <Minus size={14} />}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

/* ─── Status Badge ─── */
const StatusBadge = memo(function StatusBadge({ status, lang }: { status: string; lang: "ru" | "uz" }) {
  const s = STATUS[status] ?? STATUS.new;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "6px",
      padding: "4px 10px", borderRadius: "9999px", fontSize: "11px", fontWeight: 500,
      fontFamily: F.body, border: `1px solid ${s.dot}25`,
      background: `${s.dot}15`, color: s.dot,
    }}>
      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: s.dot, flexShrink: 0 }} />
      {lang === "uz" ? s.uz : s.ru}
    </span>
  );
});

export default function Orders() {
  const [page, setPage]     = useState(1);
  const { fmt }             = useCurrency();
  const { lang }            = useLang();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const isMobile            = useIsMobile();
  const navigate            = useNavigate();
  const utils               = trpc.useUtils();

  const { data, isLoading } = trpc.order.list.useQuery({
    page, pageSize: 25,
    search: search || undefined,
    status: (status || undefined) as "new" | "processing" | "completed" | "cancelled" | undefined,
  });

  // Only fetch all orders when user clicks export — not on every mount
  const [showExport, setShowExport] = useState(false);
  const { data: allOrders } = trpc.order.list.useQuery(
    { page: 1, pageSize: 1000 },
    { enabled: showExport, staleTime: 60_000 }
  );

  const updateStatus = trpc.order.updateStatus.useMutation({
    onSuccess: () => { utils.order.list.invalidate(); notify.success("Заказ обновлён"); },
    onError:   (e) => notify.error(e.message),
  });

  const handleExport = useCallback(() => {
    if (allOrders?.data) {
      exportToExcel(formatOrdersForExport(allOrders.data), "orders-export");
      setShowExport(false);
    } else {
      setShowExport(true);
    }
  }, [allOrders?.data]);

  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);

  const handleNewOrder = useCallback(() => navigate("/orders/new"), [navigate]);

  /* ─── Compute KPI stats from allOrders ─── */
  const stats = useMemo(() => {
    const orders = allOrders?.data ?? [];
    const total = orders.length;
    const newCount = orders.filter(o => o.status === "new").length;
    const processingCount = orders.filter(o => o.status === "processing").length;
    const completedCount = orders.filter(o => o.status === "completed").length;
    const cancelledCount = orders.filter(o => o.status === "cancelled").length;
    const totalRevenue = orders.reduce((sum, o) => sum + (o.total ?? 0), 0);
    return { total, newCount, processingCount, completedCount, cancelledCount, totalRevenue };
  }, [allOrders?.data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* ─── Header ─── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.025em", margin: 0 }}>
            {t("Заказы", "Buyurtmalar")}
          </h1>
          <p style={{ fontSize: "13px", color: COLORS.textSecondary, margin: "4px 0 0" }}>
            {t("Управление заказами и отслеживание статусов", "Buyurtmalarni boshqarish va holatni kuzatish")}
            {data && (
              <span style={{ marginLeft: "8px", fontSize: "12px", color: COLORS.textTertiary }}>
                {data.total} {t("всего", "jami")}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button onClick={handleExport} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
            border: `1px solid ${COLORS.border}`, cursor: "pointer",
            background: COLORS.surface, color: COLORS.textSecondary,
          }}>
            <FileDown size={14} /> Excel
          </button>
          <button onClick={handleNewOrder} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "13px", fontWeight: 600, fontFamily: F.body, borderRadius: "10px",
            border: "none", cursor: "pointer", transition: "all 0.2s",
            background: "linear-gradient(135deg, #4b6cf6, #4b6cf6)",
            color: "#fff", boxShadow: "0 2px 8px rgba(75,108,246,0.3)",
          }}>
            <Plus size={16} />
            <span>{t("Новый заказ", "Yangi buyurtma")}</span>
          </button>
        </div>
      </div>

      {/* ─── KPI Cards ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        <KpiCard
          label={t("ВСЕГО ЗАКАЗОВ", "JAMI BUYURTMA")}
          value={stats.total.toLocaleString()}
          delta={null}
          icon={<ShoppingCart size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #4b6cf6, #4b6cf6)"
          delay={0}
        />
        <KpiCard
          label={t("НОВЫЕ", "YANGI")}
          value={stats.newCount.toLocaleString()}
          delta={null}
          icon={<Clock size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #60a5fa, #3b82f6)"
          delay={0.05}
        />
        <KpiCard
          label={t("В РАБОТЕ", "JARAYONDA")}
          value={stats.processingCount.toLocaleString()}
          delta={null}
          icon={<Clock size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #e8a830, #f59e0b)"
          delay={0.1}
        />
        <KpiCard
          label={t("ВЫПОЛНЕНЫ", "BAJARILDI")}
          value={stats.completedCount.toLocaleString()}
          delta={null}
          icon={<CheckCircle2 size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #10B981, #059669)"
          delay={0.15}
        />
        <KpiCard
          label={t("ОТМЕНЕНЫ", "BEKOR QILINDI")}
          value={stats.cancelledCount.toLocaleString()}
          delta={null}
          icon={<XCircle size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #e85050, #e85050)"
          delay={0.2}
        />
        <KpiCard
          label={t("ВЫРУЧКА", "TUSHUM")}
          value={fmt(stats.totalRevenue)}
          delta={null}
          icon={<DollarSign size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #16a34a, #22c47a)"
          delay={0.25}
        />
      </div>

      {/* ─── Filters ─── */}
      <div style={{
        display: "flex", gap: "12px", flexWrap: "wrap",
        background: COLORS.surface, borderRadius: "16px", padding: "16px 20px",
        boxShadow: SHADOW,
      }}>
        <div style={{ position: "relative", flex: "1 1 160px" }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: COLORS.textSecondary }} />
          <input
            style={{
              width: "100%", padding: "10px 12px 10px 36px", fontSize: "13px", fontFamily: F.body,
              borderRadius: "10px", border: `1px solid ${COLORS.border}`,
              background: COLORS.surfaceLight, color: COLORS.textPrimary, outline: "none",
            }}
            placeholder={t("Поиск заказов…", "Buyurtma qidirish…")}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <PremiumSelect value={status} onChange={v => { setStatus(v); setPage(1); }}
          options={[{value:"",label:t("Все статусы","Barcha holatlar")},...Object.entries(STATUS).map(([k,v])=>({value:k,label:lang==="uz"?v.uz:v.ru}))]}
          width="180px" />
      </div>

      {/* ─── Mobile Cards ─── */}
      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ height: "88px", borderRadius: "16px", background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease forwards` }} />
              ))
            : data?.data.length === 0
            ? <p style={{ textAlign: "center", color: COLORS.textSecondary, padding: "56px 0", fontSize: "13px", fontFamily: F.body }}>{t("Нет заказов", "Buyurtma yo'q")}</p>
            : data?.data.map(o => {
                const s = STATUS[o.status] ?? STATUS.new;
                return (
                  <div
                    key={o.id}
                    style={{
                      background: COLORS.surface, borderRadius: "16px", overflow: "hidden",
                      cursor: "pointer", boxShadow: SHADOW, transition: "transform 0.15s",
                      animation: `slideUp ${0.4 + 0.02}s ease forwards`,
                    }}
                    onClick={() => navigate(`/orders/${o.id}`)}
                  >
                    <div style={{ display: "flex" }}>
                      <div style={{ width: "4px", flexShrink: 0, borderRadius: "16px 0 0 16px", background: s.dot }} />
                      <div style={{ flex: 1, padding: "14px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                          <span style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary }}>
                            {o.orderNumber}
                          </span>
                          <StatusBadge status={o.status} lang={lang} />
                        </div>
                        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <Store size={12} style={{ color: COLORS.textSecondary, flexShrink: 0 }} />
                              <span style={{ fontSize: "13px", color: COLORS.textPrimary, maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {o.shopName ?? "—"}
                              </span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <User size={12} style={{ color: COLORS.textSecondary, flexShrink: 0 }} />
                              <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>
                                {o.agentName ?? "—"} · {o.createdAt ? format(new Date(o.createdAt), "d MMM") : ""}
                              </span>
                            </div>
                            <PaymentMethodBadge method={o.paymentMethod} lang={lang} />
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 700, color: COLORS.textPrimary }}>
                              {fmt(o.total)}
                            </span>
                            <ChevronRight size={15} style={{ color: COLORS.textSecondary }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
        </div>
      ) : (
        /* ─── Desktop Table ─── */
        <div style={{
          background: COLORS.surface, borderRadius: "24px", overflow: "hidden",
          boxShadow: SHADOW,
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: COLORS.surfaceLight }}>
                {[
                  t("ЗАКАЗ",  "BUYURTMA"),
                  t("ДАТА",   "SANA"),
                  t("МАГАЗИН","DO'KON"),
                  t("АГЕНТ",  "AGENT"),
                  t("ОПЛАТА", "TO'LOV"),
                  t("ИТОГО",  "JAMI"),
                  t("СТАТУС", "HOLAT"),
                  t("ДЕЙСТВИЯ","AMALLAR"),
                ].map(h => (
                  <th key={h} style={{
                    textAlign: "left", padding: "12px 16px",
                    fontFamily: F.display, fontSize: "10px", fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: "0.08em",
                    color: COLORS.textTertiary, borderBottom: `1px solid ${COLORS.border}`,
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                      <td colSpan={8} style={{ padding: "16px" }}>
                        <div style={{ height: "16px", borderRadius: "6px", background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease forwards` }} />
                      </td>
                    </tr>
                  ))
                : data?.data.length === 0
                ? <tr><td colSpan={8} style={{ padding: "56px 16px", textAlign: "center", color: COLORS.textSecondary, fontSize: "13px", fontFamily: F.body }}>{t("Нет заказов", "Buyurtma yo'q")}</td></tr>
                : data?.data.map(o => (
                    <tr
                      key={o.id}
                      style={{
                        borderBottom: `1px solid ${COLORS.border}`,
                        cursor: "pointer", transition: "background 0.15s",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = `${COLORS.surfaceLight}80`)}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      onClick={() => navigate(`/orders/${o.id}`)}
                    >
                      <td style={{ padding: "14px 16px", fontFamily: F.display, fontSize: "13px", fontWeight: 600, color: COLORS.primary }}>{o.orderNumber}</td>
                      <td style={{ padding: "14px 16px", fontSize: "13px", color: COLORS.textSecondary }}>
                        {o.createdAt ? format(new Date(o.createdAt), "dd.MM.yyyy") : ""}
                      </td>
                      <td style={{ padding: "14px 16px", fontSize: "13px", color: COLORS.textPrimary }}>{o.shopName ?? "—"}</td>
                      <td style={{ padding: "14px 16px", fontSize: "13px", color: COLORS.textSecondary }}>{o.agentName ?? "—"}</td>
                      <td style={{ padding: "14px 16px" }}><PaymentMethodBadge method={o.paymentMethod} lang={lang} /></td>
                      <td style={{ padding: "14px 16px", fontFamily: F.display, fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary }}>{fmt(o.total)}</td>
                      <td style={{ padding: "14px 16px" }}>
                        <StatusBadge status={o.status} lang={lang} />
                      </td>
                      <td style={{ padding: "14px 16px" }} onClick={e => e.stopPropagation()}>
                        {o.status === "new" && (
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button
                              onClick={() => updateStatus.mutate({ id: o.id, status: "processing" })}
                              style={{
                                padding: "4px 10px", fontSize: "11px", fontWeight: 500, fontFamily: F.body,
                                borderRadius: "8px", border: `1px solid ${COLORS.border}`, cursor: "pointer",
                                background: COLORS.surface, color: COLORS.textSecondary,
                              }}
                            >
                              {t("В работу", "Jarayonga")}
                            </button>
                            <button
                              onClick={() => updateStatus.mutate({ id: o.id, status: "completed" })}
                              style={{
                                padding: "4px 10px", fontSize: "11px", fontWeight: 600, fontFamily: F.body,
                                borderRadius: "8px", border: "none", cursor: "pointer",
                                background: "linear-gradient(135deg, #4b6cf6, #4b6cf6)",
                                color: "#fff",
                              }}
                            >
                              {t("Выполнен", "Bajarildi")}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Pagination ─── */}
      {data && data.total > 25 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "13px", color: COLORS.textSecondary, fontFamily: F.body }}>{data.total} {t("всего", "jami")}</span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{
              padding: "6px 12px", fontSize: "13px", fontFamily: F.body, borderRadius: "8px",
              border: `1px solid ${COLORS.border}`, cursor: "pointer",
              background: COLORS.surface, color: COLORS.textSecondary,
              opacity: page === 1 ? 0.4 : 1,
            }}>
              {t("Назад", "Orqaga")}
            </button>
            <button onClick={() => setPage(p => p + 1)} disabled={page * 25 >= data.total} style={{
              padding: "6px 12px", fontSize: "13px", fontFamily: F.body, borderRadius: "8px",
              border: `1px solid ${COLORS.border}`, cursor: "pointer",
              background: COLORS.surface, color: COLORS.textSecondary,
              opacity: page * 25 >= data.total ? 0.4 : 1,
            }}>
              {t("Далее", "Keyingi")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
