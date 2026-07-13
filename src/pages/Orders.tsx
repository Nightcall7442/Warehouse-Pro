import { memo, useCallback, useMemo, useState } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { useNavigate } from "react-router";
import { Search, Plus, FileDown, ChevronRight, ShoppingCart, Clock, CheckCircle2, DollarSign } from "lucide-react";
import { format } from "date-fns";
import { exportToExcel, formatOrdersForExport } from "@/lib/excel";
import { PremiumSelect } from "@/components/PremiumSelect";
import { CardDots, Card, KpiCard, PageHeader, TableContainer, thStyle, tdStyle, btnPrimary, btnSecondary } from "@/components/DashboardLayout";

const STATUS: Record<string, { ru: string; uz: string; color: string }> = {
  new:        { ru: "Новый",       uz: "Yangi",         color: "#818cf8" },
  processing: { ru: "В обработке", uz: "Jarayonda",     color: "#fbbf24" },
  completed:  { ru: "Выполнен",    uz: "Bajarildi",     color: "#4ade80" },
  cancelled:  { ru: "Отменён",     uz: "Bekor qilindi", color: "#f87171" },
};

export default function Orders() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const navigate = useNavigate();
  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);

  const { data, isLoading } = trpc.order.list.useQuery({ page: 1, pageSize: 1000, search, status: statusFilter === "all" ? undefined : statusFilter }) as { data: any; isLoading: boolean };

  const orders = data?.data ?? [];
  const totalCount = data?.total ?? 0;

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { new: 0, processing: 0, completed: 0, cancelled: 0 };
    orders.forEach((o: any) => { if (counts[o.status] !== undefined) counts[o.status]++; });
    return counts;
  }, [orders]);

  const totalRevenue = useMemo(() => orders.reduce((s: number, o: any) => s + Number(o.total ?? 0), 0), [orders]);

  const handleExport = () => {
    exportToExcel(formatOrdersForExport(orders), "orders-export", t("Заказы", "Buyurtmalar"));
    notify.success(t("Экспортировано", "Eksport qilindi"));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader
        title={t("Заказы", "Buyurtmalar")}
        subtitle={`${t("Управление заказами и отслеживание статусов", "Buyurtmalarni boshqarish va holatni kuzatish")} · ${totalCount} ${t("всего", "jami")}`}
        actions={
          <>
            <button onClick={handleExport} style={btnSecondary}><FileDown size={14} /> Excel</button>
            <button onClick={() => navigate("/orders/new")} style={btnPrimary}><Plus size={14} /> {t("Новый заказ", "Yangi buyurtma")}</button>
          </>
        }
      />

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
        <KpiCard label={t("ВСЕГО ЗАКАЗОВ", "JAMI BUYURTMA")} value={String(totalCount)} icon={<ShoppingCart size={18} color="#818cf8" />} gradient="rgba(129,140,248,.10)" />
        <KpiCard label={t("НОВЫЕ", "YANGI")} value={String(statusCounts.new)} icon={<Clock size={18} color="#60a5fa" />} gradient="rgba(96,165,250,.10)" />
        <KpiCard label={t("ВЫПОЛНЕНЫ", "BAJARILDI")} value={String(statusCounts.completed)} icon={<CheckCircle2 size={18} color="#4ade80" />} gradient="rgba(74,222,128,.10)" />
        <KpiCard label={t("ВЫРУЧКА", "TUSHUM")} value={fmt(totalRevenue)} icon={<DollarSign size={18} color="#4ade80" />} gradient="rgba(74,222,128,.10)" />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #9ca3af)" }} />
          <input placeholder={t("Поиск заказов...", "Buyurtma qidirish...")} value={search} onChange={e => setSearch(e.target.value)} style={{ ...{ paddingLeft: "36px" } }} className="input-field" />
        </div>
        <PremiumSelect value={statusFilter} onChange={setStatusFilter} options={[
          { value: "all", label: t("Все статусы", "Barcha holatlar") },
          { value: "new", label: t("Новые", "Yangi") },
          { value: "processing", label: t("В обработке", "Jarayonda") },
          { value: "completed", label: t("Выполнены", "Bajarildi") },
          { value: "cancelled", label: t("Отменены", "Bekor qilindi") },
        ]} width="160px" />
      </div>

      {/* Table */}
      <TableContainer>
        <table style={{ width: "100%", minWidth: "700px" }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("ЗАКАЗ", "BUYURTMA")}</th>
              <th style={thStyle}>{t("ДАТА", "SANA")}</th>
              <th style={thStyle}>{t("МАГАЗИН", "DO'KON")}</th>
              <th style={thStyle}>{t("АГЕНТ", "AGENT")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("ИТОГО", "JAMI")}</th>
              <th style={thStyle}>{t("СТАТУС", "HOLAT")}</th>
              <th style={{ ...thStyle, width: "40px" }}></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} style={{ padding: "32px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)" }}>...</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: "48px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)" }}>{t("Нет заказов", "Buyurtma yo'q")}</td></tr>
            ) : orders.map((o: any) => {
              const s = STATUS[o.status] ?? STATUS.new;
              return (
                <tr key={o.id} onClick={() => navigate(`/orders/${o.id}`)} style={{ cursor: "pointer", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-light, #f8f9fb)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <td style={{ ...tdStyle, fontWeight: 500, color: "var(--color-primary, #818cf8)" }}>{o.orderNumber}</td>
                  <td style={{ ...tdStyle, color: "var(--color-text-secondary, #6b7280)" }}>{o.createdAt ? format(new Date(o.createdAt), "dd.MM.yyyy") : "—"}</td>
                  <td style={{ ...tdStyle }}>{o.shopName ?? "—"}</td>
                  <td style={{ ...tdStyle }}>{o.agentName ?? "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>{fmt(o.total)}</td>
                  <td style={tdStyle}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "3px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, background: `${s.color}15`, color: s.color }}>
                      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: s.color }} />
                      {s[lang as "ru" | "uz"] ?? s.ru}
                    </span>
                  </td>
                  <td style={{ ...tdStyle }}><ChevronRight size={14} color="var(--color-text-tertiary, #9ca3af)" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableContainer>
    </div>
  );
}
