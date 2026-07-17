import { useState } from "react";
import { format } from "date-fns";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  ArrowLeft, Users, ShoppingCart, Package, Store, Shield, Lock,
  BarChart3, Zap, Calendar, Power,
} from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";
import { F, COLORS, TenantRow, fmt, money, planStatus } from "./types";
import { KpiCard, Section, PlanBadge, StatusBadge, Modal, Input, BtnPrimary, BtnSecondary } from "./ui";

interface TenantDetailProps {
  tenantId: number;
  onBack: () => void;
}

export function TenantDetail({ tenantId, onBack }: TenantDetailProps) {
  const { data, isLoading, refetch } = trpc.tenant.getDetail.useQuery({ tenantId });
  const utils = trpc.useUtils();
  const { confirm, dialog } = useConfirm();
  const [resetPwd, setResetPwd] = useState<{ userId: number; name: string } | null>(null);
  const [newPwd, setNewPwd] = useState("");
  const [extDays, setExtDays] = useState(14);
  const [showExt, setShowExt] = useState(false);
  const [planDays, setPlanDays] = useState(30);
  const [showPlan, setShowPlan] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<"trial" | "basic" | "pro" | "exclusive">("basic");

  const invalidate = () => { refetch(); utils.tenant.list.invalidate(); utils.tenant.platformStats.invalidate(); };
  const updatePlan = trpc.tenant.updatePlan.useMutation({ onSuccess: () => { invalidate(); notify.success("Тариф обновлён"); setShowPlan(false); }, onError: (e) => notify.error(e.message) });
  const setStatus = trpc.tenant.setStatus.useMutation({ onSuccess: () => { invalidate(); notify.success("Статус обновлён"); }, onError: (e) => notify.error(e.message) });
  const extendTrial = trpc.tenant.extendTrial.useMutation({ onSuccess: (r) => { invalidate(); notify.success(`Trial продлён до ${format(new Date(r.trialEndsAt), "dd.MM.yyyy")}`); setShowExt(false); }, onError: (e) => notify.error(e.message) });
  const resetPassword = trpc.tenant.resetOwnerPassword.useMutation({ onSuccess: () => { notify.success("Пароль сброшен"); setResetPwd(null); setNewPwd(""); }, onError: (e) => notify.error(e.message) });

  if (isLoading) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "40vh" }}><div style={{ width: "32px", height: "32px", borderRadius: "50%", border: `3px solid ${COLORS.border}`, borderTopColor: COLORS.primary, animation: "spin 1s linear infinite" }} /></div>;
  if (!data) return <div style={{ padding: "48px", textAlign: "center", color: COLORS.textTertiary }}>Тенант не найден</div>;

  const { tenant, subscription: subArr, users: tenantUsers, stats, monthlyOrders } = data;
  const subscription = Array.isArray(subArr) ? subArr[0] : subArr;
  const ts = planStatus({ ...tenant, userCount: 0, orderCount: 0, orderTotal: 0 } as TenantRow);

  const metricCards = [
    { label: "Пользователей", value: tenantUsers.length, icon: Users, gradient: "linear-gradient(135deg, #60a5fa, #3b82f6)" },
    { label: "Заказов", value: fmt(stats.orders), icon: ShoppingCart, gradient: "linear-gradient(135deg, #34c473, #16a34a)" },
    { label: "Товаров", value: fmt(stats.products), icon: Package, gradient: "linear-gradient(135deg, #5b6d8a, #5b6d8a)" },
    { label: "Магазинов", value: fmt(stats.shops), icon: Store, gradient: "linear-gradient(135deg, #d4973a, #d97706)" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {dialog}
      {resetPwd && (
        <Modal onClose={() => { setResetPwd(null); setNewPwd(""); }}>
          <div style={{ padding: "24px" }}>
            <h3 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 700, color: COLORS.textPrimary, display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}><Lock size={16} style={{ color: COLORS.warning }} /> Сбросить пароль — {resetPwd.name}</h3>
            <Input label="Новый пароль" type="password" placeholder="мин. 8 символов" value={newPwd} onChange={e => setNewPwd(e.target.value)} />
            <div style={{ display: "flex", gap: "12px", marginTop: "20px" }}>
              <BtnSecondary onClick={() => { setResetPwd(null); setNewPwd(""); }} style={{ flex: 1 }}>Отмена</BtnSecondary>
              <BtnPrimary onClick={() => resetPassword.mutate({ tenantId, userId: resetPwd.userId, newPassword: newPwd })} disabled={newPwd.length < 8 || resetPassword.isPending} style={{ flex: 1 }}>{resetPassword.isPending ? "…" : "Сохранить"}</BtnPrimary>
            </div>
          </div>
        </Modal>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <button onClick={onBack} style={{ padding: "8px", borderRadius: "10px", background: COLORS.surface, border: `1px solid ${COLORS.border}`, cursor: "pointer", color: COLORS.textSecondary }}><ArrowLeft size={16} /></button>
        <div style={{ width: "44px", height: "44px", borderRadius: "14px", background: "rgba(75,108,246,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "18px", fontWeight: 700, color: COLORS.primary }}>{tenant.name[0].toUpperCase()}</span>
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 700, color: COLORS.textPrimary }}>{tenant.name}</h2>
          <p style={{ fontSize: "12px", color: COLORS.textTertiary }}>{tenant.slug} · {tenant.ownerEmail}</p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}><PlanBadge plan={tenant.plan} /><StatusBadge status={tenant.status} /></div>
      </div>

      {/* Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
        {metricCards.map(c => <KpiCard key={c.label} label={c.label} value={c.value} icon={c.icon} gradient={c.gradient} />)}
      </div>

      {/* Subscription */}
      <Section title="Подписка" icon={Shield}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "20px" }}>
          {[
            { label: "Тариф", value: tenant.plan.toUpperCase(), color: ts.color },
            { label: "Осталось", value: ts.label, color: ts.color },
            tenant.trialEndsAt ? { label: "Trial до", value: format(new Date(tenant.trialEndsAt), "dd.MM.yyyy"), color: COLORS.textPrimary } : null,
            tenant.planExpiresAt ? { label: "Тариф до", value: format(new Date(tenant.planExpiresAt), "dd.MM.yyyy"), color: COLORS.textPrimary } : null,
            subscription ? { label: "Stripe", value: subscription.status, color: COLORS.textPrimary } : null,
          ].filter(Boolean).map((item, i) => item && (
            <div key={i}>
              <p style={{ fontSize: "11px", color: COLORS.textTertiary, marginBottom: "4px" }}>{item.label}</p>
              <p style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: item.color }}>{item.value}</p>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "20px", paddingTop: "16px", borderTop: `1px solid ${COLORS.border}` }}>
          {showPlan ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <PremiumSelect value={selectedPlan} onChange={v => setSelectedPlan(v as any)} options={[{ value: "trial", label: "Trial" }, { value: "basic", label: "Basic" }, { value: "pro", label: "Pro" }, { value: "exclusive", label: "Exclusive" }]} width="120px" />
              <input type="number" min="1" max="3650" value={planDays} onChange={e => setPlanDays(Number(e.target.value))} style={{ width: "80px", padding: "6px 10px", borderRadius: "8px", border: `1px solid ${COLORS.border}`, background: COLORS.surfaceLight, color: COLORS.textPrimary, fontSize: "12px" }} />
              <BtnPrimary onClick={() => updatePlan.mutate({ tenantId, plan: selectedPlan, expiryDays: planDays })} disabled={updatePlan.isPending} style={{ padding: "6px 14px", fontSize: "12px" }}>{updatePlan.isPending ? "…" : "Сохранить"}</BtnPrimary>
              <BtnSecondary onClick={() => setShowPlan(false)} style={{ padding: "6px 10px", fontSize: "12px" }}>✕</BtnSecondary>
            </div>
          ) : (
            <BtnSecondary onClick={() => setShowPlan(true)} style={{ padding: "6px 14px", fontSize: "12px" }}><Zap size={13} /> Изменить тариф</BtnSecondary>
          )}
          {showExt ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input type="number" min="1" max="365" value={extDays} onChange={e => setExtDays(Number(e.target.value))} style={{ width: "80px", padding: "6px 10px", borderRadius: "8px", border: `1px solid ${COLORS.border}`, background: COLORS.surfaceLight, color: COLORS.textPrimary, fontSize: "12px" }} />
              <BtnPrimary onClick={() => extendTrial.mutate({ tenantId, days: extDays })} disabled={extendTrial.isPending} style={{ padding: "6px 14px", fontSize: "12px" }}>{extendTrial.isPending ? "…" : "Продлить"}</BtnPrimary>
              <BtnSecondary onClick={() => setShowExt(false)} style={{ padding: "6px 10px", fontSize: "12px" }}>✕</BtnSecondary>
            </div>
          ) : (
            <BtnSecondary onClick={() => setShowExt(true)} style={{ padding: "6px 14px", fontSize: "12px" }}><Calendar size={13} /> Продлить trial</BtnSecondary>
          )}
          <BtnSecondary onClick={async () => {
            const next = tenant.status === "active" ? "suspended" : "active";
            const ok = await confirm({ title: next === "suspended" ? `Приостановить "${tenant.name}"?` : `Активировать "${tenant.name}"?`, message: next === "suspended" ? "Все пользователи потеряют доступ." : "Пользователи снова смогут войти.", confirmText: next === "suspended" ? "Приостановить" : "Активировать", danger: next === "suspended" });
            if (ok) setStatus.mutate({ tenantId, status: next });
          }} style={{ padding: "6px 14px", fontSize: "12px", color: tenant.status === "active" ? COLORS.danger : COLORS.success, borderColor: tenant.status === "active" ? "rgba(220,38,38,0.3)" : "rgba(22,163,74,0.3)" }}>
            <Power size={13} /> {tenant.status === "active" ? "Приостановить" : "Активировать"}
          </BtnSecondary>
        </div>
      </Section>

      {/* Users */}
      <Section title={`Пользователи (${tenantUsers.length})`} icon={Users}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {tenantUsers.map((u, i) => (
            <div key={u.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 0", borderTop: i > 0 ? `1px solid ${COLORS.border}` : undefined }}>
              <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: COLORS.surfaceLight, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: COLORS.textSecondary }}>{u.name[0]}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: "13px", fontWeight: 500, color: COLORS.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</p>
                <p style={{ fontSize: "11px", color: COLORS.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                <span style={{ fontSize: "10px", color: COLORS.textTertiary, padding: "2px 8px", borderRadius: "6px", background: COLORS.surfaceLight }}>{u.role}</span>
                <StatusBadge status={u.status} />
                <button onClick={() => setResetPwd({ userId: u.id, name: u.name })} style={{ padding: "6px", borderRadius: "6px", background: "none", border: `1px solid ${COLORS.border}`, cursor: "pointer", color: COLORS.warning }} title="Сбросить пароль"><Lock size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Monthly Orders */}
      {monthlyOrders.length > 0 && (
        <Section title="Заказы по месяцам" icon={BarChart3}>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {monthlyOrders.map(m => (
              <div key={m.month} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ width: "72px", fontSize: "12px", color: COLORS.textSecondary, fontFamily: F.body }}>{m.month}</span>
                <div style={{ flex: 1, height: "6px", borderRadius: "3px", background: COLORS.surfaceLight, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: "3px", background: "linear-gradient(90deg, #5b6d8a, #5b6d8a)", width: `${Math.min(100, ((m.orders ?? 0) / Math.max(1, ...monthlyOrders.map(x => x.orders ?? 0))) * 100)}%` }} />
                </div>
                <span style={{ width: "40px", textAlign: "right", fontSize: "12px", fontWeight: 600, color: COLORS.textPrimary }}>{m.orders ?? 0}</span>
                <span style={{ width: "100px", textAlign: "right", fontSize: "11px", color: COLORS.textTertiary }}>{money(Number(m.revenue ?? 0))} сум</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
