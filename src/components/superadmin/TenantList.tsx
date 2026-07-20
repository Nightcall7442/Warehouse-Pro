import { useState } from "react";
import { format } from "date-fns";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { Search, Power, Building2, ChevronRight } from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";
import { F, COLORS, SHADOW, fmt, money, planStatus } from "./types";
import type { TenantRow } from "./types";
import { PlanBadge, StatusBadge } from "./ui";

interface TenantListProps {
  onSelect: (id: number) => void;
}

export function TenantList({ onSelect }: TenantListProps) {
  const [search, setSearch] = useState("");
  const [filterPlan, setFilterPlan] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const { data: allTenants, isLoading } = trpc.tenant.list.useQuery();
  const utils = trpc.useUtils();
  const { confirm, dialog } = useConfirm();
  const invalidate = () => { utils.tenant.list.invalidate(); utils.tenant.platformStats.invalidate(); };
  const setStatus = trpc.tenant.setStatus.useMutation({ onSuccess: () => { invalidate(); notify.success("Статус обновлён"); }, onError: (e) => notify.error(e.message) });

  const tenants = (allTenants ?? []).filter(t => {
    const q = search.toLowerCase();
    return (!q || t.name.toLowerCase().includes(q) || t.slug.includes(q) || (t.ownerEmail ?? "").toLowerCase().includes(q)) && (filterPlan === "all" || t.plan === filterPlan) && (filterStatus === "all" || t.status === filterStatus);
  });

  return (
    <>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {dialog}

      {/* Filters */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: COLORS.textTertiary }} />
          <input placeholder="Поиск по имени, slug, email…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: "100%", padding: "10px 14px 10px 38px", borderRadius: "12px", border: `1px solid ${COLORS.border}`, background: COLORS.surfaceLight, color: COLORS.textPrimary, fontFamily: F.body, fontSize: "13px", outline: "none" }} />
        </div>
        <PremiumSelect value={filterPlan} onChange={setFilterPlan} options={[{ value: "all", label: "Все тарифы" }, { value: "trial", label: "Trial" }, { value: "basic", label: "Basic" }, { value: "pro", label: "Pro" }, { value: "exclusive", label: "Exclusive" }]} width="140px" />
        <PremiumSelect value={filterStatus} onChange={setFilterStatus} options={[{ value: "all", label: "Все статусы" }, { value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }]} width="140px" />
        <span style={{ fontSize: "12px", color: COLORS.textTertiary, marginLeft: "auto" }}>{tenants.length} из {allTenants?.length ?? 0}</span>
      </div>

      {/* Table */}
      <div style={{ background: COLORS.surface, borderRadius: "20px", boxShadow: SHADOW, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: "900px", fontSize: "13px", fontFamily: F.body }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                {["Организация", "Тариф", "Статус", "Осталось", "Юзеров", "Заказов", "Выручка", "Создана", ""].map(h => (
                  <th key={h} style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", padding: "14px 16px", textAlign: "left", color: COLORS.textTertiary }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? [...Array(5)].map((_, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <td colSpan={9} style={{ padding: "16px" }}><div style={{ height: "16px", borderRadius: "8px", background: COLORS.surfaceLight, animation: "pulse 1.5s infinite" }} /></td>
                </tr>
              )) : tenants.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: "64px 16px", textAlign: "center", color: COLORS.textTertiary }}><Building2 size={32} style={{ margin: "0 auto 8px", opacity: 0.3 }} /><p style={{ fontSize: "13px" }}>Нет организаций</p></td></tr>
              ) : tenants.map(t => {
                const ts = planStatus(t);
                return (
                  <tr key={t.id} style={{ borderBottom: `1px solid ${COLORS.border}`, cursor: "pointer", transition: "background 0.15s" }} onClick={() => onSelect(t.id)} onMouseEnter={e => (e.currentTarget.style.background = COLORS.surfaceLight)} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "rgba(75,108,246,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><span style={{ fontSize: "14px", fontWeight: 700, color: COLORS.primary }}>{t.name[0].toUpperCase()}</span></div>
                        <div><p style={{ fontSize: "13px", fontWeight: 500, color: COLORS.textPrimary }}>{t.name}</p><p style={{ fontSize: "10px", color: COLORS.textTertiary }}>{t.slug}</p></div>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }}><PlanBadge plan={t.plan} /></td>
                    <td style={{ padding: "12px 16px" }}><StatusBadge status={t.status} /></td>
                    <td style={{ padding: "12px 16px", fontSize: "12px", fontWeight: 600, color: ts.color }}>{ts.label}</td>
                    <td style={{ padding: "12px 16px", fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary }}>{t.userCount}</td>
                    <td style={{ padding: "12px 16px", fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary }}>{fmt(t.orderCount)}</td>
                    <td style={{ padding: "12px 16px", fontSize: "13px", color: COLORS.textSecondary }}>{money(t.orderTotal)} сум</td>
                    <td style={{ padding: "12px 16px", fontSize: "11px", color: COLORS.textTertiary }}>{format(new Date(t.createdAt), "dd.MM.yy")}</td>
                    <td style={{ padding: "12px 16px" }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button onClick={async e => { e.stopPropagation(); const next = t.status === "active" ? "suspended" : "active"; const ok = await confirm({ title: next === "suspended" ? `Приостановить "${t.name}"?` : `Активировать "${t.name}"?`, message: next === "suspended" ? "Все пользователи потеряют доступ." : "Пользователи снова смогут войти.", confirmText: next === "suspended" ? "Приостановить" : "Активировать", danger: next === "suspended" }); if (ok) setStatus.mutate({ tenantId: t.id, status: next }); }} style={{ padding: "6px", borderRadius: "8px", background: "none", border: `1px solid ${COLORS.border}`, cursor: "pointer", color: t.status === "active" ? COLORS.danger : COLORS.success }} title={t.status === "active" ? "Приостановить" : "Активировать"}><Power size={13} /></button>
                        <button onClick={e => { e.stopPropagation(); onSelect(t.id); }} style={{ padding: "6px", borderRadius: "8px", background: "none", border: `1px solid ${COLORS.border}`, cursor: "pointer", color: COLORS.textTertiary }} title="Подробнее"><ChevronRight size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
