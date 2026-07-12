import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { format, differenceInDays } from "date-fns";
import { Building2, Search, Power, Zap, RefreshCw, Users, ShoppingCart, TrendingUp, Plus, Shield, ChevronRight, BarChart3, Package, Store } from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";
import { CardDots, Card, KpiCard, PageHeader, TableContainer, thStyle, tdStyle, btnPrimary, btnSecondary, inputStyle } from "@/components/DashboardLayout";

const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}
function money(n: number): string { return new Intl.NumberFormat("ru").format(Math.round(n)); }

function PlanBadge({ plan }: { plan: string }) {
  const colors: Record<string, { fg: string; bg: string }> = {
    basic: { fg: "#60a5fa", bg: "rgba(96,165,250,.12)" },
    pro: { fg: "#4ade80", bg: "rgba(74,222,128,.12)" },
    exclusive: { fg: "#a78bfa", bg: "rgba(167,139,250,.12)" },
  };
  const c = colors[plan] ?? colors.basic;
  return <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: "20px", fontSize: "10px", fontWeight: 700, fontFamily: F.body, color: c.fg, background: c.bg, letterSpacing: "0.04em" }}>{plan.toUpperCase()}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { fg: string; bg: string }> = {
    active: { fg: "#4ade80", bg: "rgba(74,222,128,.12)" },
    suspended: { fg: "#f87171", bg: "rgba(248,113,113,.12)" },
  };
  const c = colors[status] ?? colors.active;
  return <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: "20px", fontSize: "10px", fontWeight: 700, fontFamily: F.body, color: c.fg, background: c.bg, letterSpacing: "0.04em" }}>{status.toUpperCase()}</span>;
}

export default function SuperAdmin() {
  const [search, setSearch] = useState("");
  const [filterPlan, setFilterPlan] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const { data: allTenants, isLoading, refetch } = trpc.tenant.platformStats.useQuery();
  const { data: stats } = trpc.tenant.platformStats.useQuery();
  const { confirm, dialog } = useConfirm();
  const utils = trpc.useUtils();
  const setStatus = trpc.tenant.setStatus.useMutation({ onSuccess: () => { utils.tenant.platformStats.invalidate(); notify.success("Статус обновлён"); }, onError: (e) => notify.error(e.message) });

  const tenants = (allTenants?.tenants ?? []).filter((t: any) => {
    const q = search.toLowerCase();
    return (!q || t.name?.toLowerCase().includes(q) || t.slug?.includes(q)) && (filterPlan === "all" || t.plan === filterPlan) && (filterStatus === "all" || t.status === filterStatus);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {dialog}
      <PageHeader
        title="Super Admin"
        subtitle={t("Управление платформой", "Platformani boshqarish")}
        actions={
          <>
            <button onClick={() => refetch()} style={btnSecondary}><RefreshCw size={13} /> {t("Обновить", "Yangilash")}</button>
          </>
        }
      />

      {/* KPI Cards */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
          <KpiCard label={t("ОРГАНИЗАЦИЙ", "TASHKILOTLAR")} value={String(stats.tenants ?? 0)} icon={<Building2 size={18} color="#818cf8" />} gradient="rgba(129,140,248,.10)" />
          <KpiCard label={t("ПОЛЬЗОВАТЕЛЕЙ", "FOYDALANUVCHILAR")} value={String(stats.users ?? 0)} icon={<Users size={18} color="#60a5fa" />} gradient="rgba(96,165,250,.10)" />
          <KpiCard label={t("ЗАКАЗОВ", "BUYURTMALAR")} value={fmt(stats.orders ?? 0)} icon={<ShoppingCart size={18} color="#4ade80" />} gradient="rgba(74,222,128,.10)" />
          <KpiCard label={t("ВЫРУЧКА", "TUSHUM")} value={money(stats.revenue ?? 0) + " сум"} icon={<TrendingUp size={18} color="#fbbf24" />} gradient="rgba(251,191,36,.10)" />
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #9ca3af)" }} />
          <input placeholder={t("Поиск...", "Qidirish...")} value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: "36px" }} className="input-field" />
        </div>
        <PremiumSelect value={filterPlan} onChange={setFilterPlan} options={[{ value: "all", label: t("Все тарифы", "Barcha tariflar") }, { value: "basic", label: "Basic" }, { value: "pro", label: "Pro" }, { value: "exclusive", label: "Exclusive" }]} width="140px" />
        <PremiumSelect value={filterStatus} onChange={setFilterStatus} options={[{ value: "all", label: t("Все статусы", "Barcha holatlar") }, { value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }]} width="140px" />
      </div>

      {/* Tenants Table */}
      <TableContainer>
        <table style={{ width: "100%", minWidth: "800px" }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("ОРГАНИЗАЦИЯ", "TASHKILOT")}</th>
              <th style={thStyle}>{t("ТАРИФ", "TARIF")}</th>
              <th style={thStyle}>{t("СТАТУС", "HOLAT")}</th>
              <th style={thStyle}>{t("ЮЗЕРОВ", "FOYD")}</th>
              <th style={thStyle}>{t("ЗАКАЗОВ", "BUYURTMA")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("ВЫРУЧКА", "TUSHUM")}</th>
              <th style={thStyle}>{t("СОЗДАНА", "YARATILGAN")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} style={{ padding: "32px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)" }}>...</td></tr>
            ) : tenants.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: "48px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)" }}>{t("Нет организаций", "Tashkilot yo'q")}</td></tr>
            ) : tenants.map((t: any) => (
              <tr key={t.id} style={{ cursor: "pointer", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-light, #f8f9fb)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <td style={tdStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "rgba(129,140,248,.10)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-primary, #818cf8)" }}>{t.name?.[0]?.toUpperCase()}</span>
                    </div>
                    <div><p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary, #111827)", margin: 0 }}>{t.name}</p><p style={{ fontSize: "10px", color: "var(--color-text-tertiary, #9ca3af)", margin: 0 }}>{t.slug}</p></div>
                  </div>
                </td>
                <td style={tdStyle}><PlanBadge plan={t.plan} /></td>
                <td style={tdStyle}><StatusBadge status={t.status} /></td>
                <td style={{ ...tdStyle, fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #111827)" }}>{t.userCount}</td>
                <td style={{ ...tdStyle, fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #111827)" }}>{fmt(t.orderCount ?? 0)}</td>
                <td style={{ ...tdStyle, fontSize: "13px", color: "var(--color-text-secondary, #6b7280)" }}>{money(t.orderTotal ?? 0)} сум</td>
                <td style={{ ...tdStyle, fontSize: "11px", color: "var(--color-text-tertiary, #9ca3af)" }}>{t.createdAt ? format(new Date(t.createdAt), "dd.MM.yy") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableContainer>
    </div>
  );
}

function t(ru: string, uz: string) { return ru; }
