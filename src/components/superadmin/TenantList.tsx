import { useState } from "react";
import { format } from "date-fns";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { Search, Power, Building2, ChevronRight } from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";
import { F, COLORS, SHADOW, fmt, money, planStatus } from "./types";

import { PlanBadge, StatusBadge } from "./ui";

interface TenantListProps {
  onSelect: (id: number) => void;
}

/** Столбцы таблицы. `numeric` решает выравнивание — вправо, как в бухгалтерии. */
const COLUMNS = [
  { key: "org",     label: "Организация",   numeric: false },
  { key: "plan",    label: "Тариф",         numeric: false },
  { key: "status",  label: "Статус",        numeric: false },
  { key: "left",    label: "Осталось",      numeric: false },
  { key: "users",   label: "Пользователей", numeric: true },
  { key: "orders",  label: "Заказов",       numeric: true },
  { key: "revenue", label: "Выручка",       numeric: true },
  { key: "created", label: "Создана",       numeric: false },
  { key: "actions", label: "",              numeric: false },
];

/** Ячейка с числом: вправо, цифрами одной ширины, без переноса. */
const NUM: React.CSSProperties = {
  padding: "12px 16px", textAlign: "right",
  fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
};

/** Кнопка-значок в строке: проявляется подложкой, а не стоит в рамке. */
const ICON_BTN: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: "30px", height: "30px", borderRadius: "9px",
  background: "transparent", border: "none", cursor: "pointer",
  transition: "background 0.15s",
};

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
          <table style={{ width: "100%", minWidth: "900px", fontSize: "13px", fontFamily: F.body, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                {/*
                  Числовые столбцы прижаты вправо и набраны цифрами одной
                  ширины. Слева они стояли рваной лесенкой: «1», «13», «1.4K» —
                  и сравнить две строки глазами было нельзя, хотя таблица
                  существует ровно для сравнения.

                  «Юзеров» переименовано в «Пользователей»: жаргон в заголовке
                  столбца — та самая дешевизна, из-за которой страница читается
                  как черновик.
                */}
                {COLUMNS.map(c => (
                  <th key={c.key} style={{
                    fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
                    letterSpacing: "0.08em", padding: "14px 16px", color: COLORS.textTertiary,
                    textAlign: c.numeric ? "right" : "left", whiteSpace: "nowrap",
                  }}>{c.label}</th>
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
                    {/* Столбцу с названием отдана ширина: без неё «Олтин Йўл
                        Дистрибуция М·ДК» ломалось на три строки, а числовые
                        столбцы рядом стояли полупустыми. */}
                    <td style={{ padding: "12px 16px", width: "34%", minWidth: "240px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "color-mix(in srgb, var(--color-primary) 10%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><span style={{ fontSize: "14px", fontWeight: 700, color: COLORS.primaryText }}>{t.name[0].toUpperCase()}</span></div>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={t.name}>{t.name}</p>
                          <p style={{ fontSize: "10px", color: COLORS.textTertiary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }}><PlanBadge plan={t.plan} /></td>
                    <td style={{ padding: "12px 16px" }}><StatusBadge status={t.status} /></td>
                    <td style={{ padding: "12px 16px", fontSize: "12px", fontWeight: 600, color: ts.color, whiteSpace: "nowrap" }}>{ts.label}</td>
                    <td style={{ ...NUM, fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary }}>{t.userCount}</td>
                    <td style={{ ...NUM, fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary }}>{fmt(t.orderCount)}</td>
                    <td style={{ ...NUM, fontSize: "13px", color: COLORS.textSecondary }}>
                      {money(t.orderTotal)} <span style={{ fontSize: "10px", color: COLORS.textTertiary }}>сум</span>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: "11px", color: COLORS.textTertiary, whiteSpace: "nowrap" }}>{format(new Date(t.createdAt), "dd.MM.yy")}</td>
                    <td style={{ padding: "12px 16px" }} onClick={e => e.stopPropagation()}>
                      {/* Кнопки без обводки: два серых квадратика в конце каждой
                          строки притягивали взгляд сильнее самих данных. Теперь
                          они проявляются подложкой при наведении. */}
                      <div style={{ display: "flex", gap: "4px", justifyContent: "flex-end" }}>
                        <button onClick={async e => { e.stopPropagation(); const next = t.status === "active" ? "suspended" : "active"; const ok = await confirm({ title: next === "suspended" ? `Приостановить "${t.name}"?` : `Активировать "${t.name}"?`, message: next === "suspended" ? "Все пользователи потеряют доступ." : "Пользователи снова смогут войти.", confirmText: next === "suspended" ? "Приостановить" : "Активировать", danger: next === "suspended" }); if (ok) setStatus.mutate({ tenantId: t.id, status: next }); }} style={{ ...ICON_BTN, color: t.status === "active" ? COLORS.danger : COLORS.success }} onMouseEnter={e => (e.currentTarget.style.background = COLORS.border)} onMouseLeave={e => (e.currentTarget.style.background = "transparent")} title={t.status === "active" ? "Приостановить" : "Активировать"}><Power size={14} /></button>
                        <button onClick={e => { e.stopPropagation(); onSelect(t.id); }} style={{ ...ICON_BTN, color: COLORS.textTertiary }} onMouseEnter={e => (e.currentTarget.style.background = COLORS.border)} onMouseLeave={e => (e.currentTarget.style.background = "transparent")} title="Подробнее"><ChevronRight size={14} /></button>
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
