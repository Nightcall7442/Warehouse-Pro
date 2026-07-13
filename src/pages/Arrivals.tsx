import { useState, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { format } from "date-fns";
import { Search, Plus, Truck, CheckCircle2, Clock, Package, FileDown, FileText, ChevronRight, X } from "lucide-react";
import { exportToExcel } from "@/lib/excel";
import { CardDots, Card, KpiCard, PageHeader, TableContainer, thStyle, tdStyle, btnPrimary, btnSecondary, inputStyle } from "@/components/DashboardLayout";

const STATUS: Record<string, { ru: string; uz: string; color: string }> = {
  pending:    { ru: "Ожидание", uz: "Kutilmoqda", color: "#fbbf24" },
  unloading:  { ru: "Разгрузка", uz: "Tushirilmoqda", color: "#60a5fa" },
  completed:  { ru: "Завершён", uz: "Tugallangan", color: "#4ade80" },
};

export default function Arrivals() {
  const [showCreate, setShowCreate] = useState(false);
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data, isLoading } = trpc.arrival.list.useQuery({ page: 1, pageSize: 1000 }) as { data: any; isLoading: boolean };
  const arrivals = Array.isArray(data?.data) ? data.data : [];
  const totalCount = arrivals.length;
  const completedCount = arrivals.filter((a: any) => a.status === "completed").length;
  const pendingCount = arrivals.filter((a: any) => a.status === "pending" || a.status === "unloading").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader
        title={t("Приходы", "Kirimlar")}
        subtitle={t("Поступление товаров на склад", "Omborga mahsulot kiritish")}
        actions={
          <>
            <button style={btnSecondary}><FileDown size={14} /> Excel</button>
            <button onClick={() => setShowCreate(true)} style={btnPrimary}><Plus size={14} /> {t("Новый приход", "Yangi kirim")}</button>
          </>
        }
      />

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
        <KpiCard label={t("ВСЕГО ПРИХОДОВ", "JAMI KIRIM")} value={String(totalCount)} icon={<Truck size={18} color="#818cf8" />} gradient="rgba(129,140,248,.10)" />
        <KpiCard label={t("ОЖИДАНИЕ", "KUTILMOQDA")} value={String(pendingCount)} icon={<Clock size={18} color="#fbbf24" />} gradient="rgba(251,191,36,.10)" />
        <KpiCard label={t("ЗАВЕРШЕНЫ", "TUGALLANGAN")} value={String(completedCount)} icon={<CheckCircle2 size={18} color="#4ade80" />} gradient="rgba(74,222,128,.10)" />
        <KpiCard label={t("ТОВАРОВ", "MAHSULOT")} value={String(arrivals.reduce((s: number, a: any) => s + Number(a.totalUnits ?? 0), 0))} icon={<Package size={18} color="#fbbf24" />} gradient="rgba(251,191,36,.10)" />
      </div>

      {/* Table */}
      <TableContainer>
        <table style={{ width: "100%", minWidth: "600px" }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("ПРИХОД", "KIRIM")}</th>
              <th style={thStyle}>{t("ДАТА", "SANA")}</th>
              <th style={thStyle}>{t("СТАТУС", "HOLAT")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("РАСХОДЫ", "XARAJAT")}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} style={{ padding: "32px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)" }}>...</td></tr>
            ) : arrivals.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: "48px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)" }}>{t("Нет приходов", "Kirim yo'q")}</td></tr>
            ) : arrivals.map((a: any) => {
              const s = STATUS[a.status] ?? STATUS.pending;
              return (
                <tr key={a.id} style={{ cursor: "pointer", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-light, #f8f9fb)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{a.arrivalNumber}</td>
                  <td style={{ ...tdStyle, color: "var(--color-text-secondary, #6b7280)" }}>{a.arrivalDate ? format(new Date(a.arrivalDate), "dd.MM.yyyy") : "—"}</td>
                  <td style={tdStyle}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "3px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, background: `${s.color}15`, color: s.color }}>
                      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: s.color }} />
                      {s[lang as "ru" | "uz"]}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>{fmt(Number(a.totalExpense ?? 0))}</td>
                  <td style={tdStyle}><ChevronRight size={14} color="var(--color-text-tertiary, #9ca3af)" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableContainer>

      {/* Create Arrival Modal */}
      {showCreate && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }} onClick={() => setShowCreate(false)} />
          <div style={{ position: "relative", width: "100%", maxWidth: "500px", background: "var(--color-surface, #ffffff)", borderRadius: "20px", padding: "24px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
              <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px", fontWeight: 700, color: "var(--color-text-primary, #111827)", margin: 0 }}>{t("Новый приход", "Yangi kirim")}</h2>
              <button onClick={() => setShowCreate(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary, #9ca3af)" }}><X size={20} /></button>
            </div>
            <p style={{ fontSize: "13px", color: "var(--color-text-secondary, #6b7280)", textAlign: "center", padding: "32px 0" }}>
              {t("Форма создания прихода будет доступна в ближайшее время.", "Kirim yaratish formasi tez orada mavjud bo'ladi.")}
            </p>
            <button onClick={() => setShowCreate(false)} style={{ ...btnPrimary, width: "100%" }}>{t("Закрыть", "Yopish")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
