import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { format, differenceInDays } from "date-fns";
import {
  Building2, Search, Power, Zap, RefreshCw,
  Users, ShoppingCart, TrendingUp, ArrowLeft,
  Plus, Calendar, Lock, ChevronRight, BarChart3, Package,
  Store, Shield, XCircle, User, Key, Save, Loader2,
} from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";

// ── Premium design tokens ─────────────────────────────────────────────────────
const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };
const COLORS = {
  primary: "var(--color-primary)", success: "var(--color-success)",
  warning: "var(--color-warning)", danger: "var(--color-danger)",
  surface: "var(--color-surface)", surfaceLight: "var(--color-surface-light)",
  textPrimary: "var(--color-text-primary)", textSecondary: "var(--color-text-secondary)",
  textTertiary: "var(--color-text-tertiary)", border: "var(--color-border-subtle)",
  info: "var(--color-info)",
};
const SHADOW = "0 8px 24px -6px rgba(180,175,165,.25)";

// ── Types ─────────────────────────────────────────────────────────────────────
type TenantRow = {
  id: number; name: string; slug: string;
  plan: string; status: string; createdAt: Date;
  trialEndsAt?: Date | null; planExpiresAt?: Date | null;
  ownerEmail?: string | null;
  userCount: number; orderCount: number; orderTotal: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}
function money(n: number): string {
  return new Intl.NumberFormat("ru").format(Math.round(n));
}
function planStatus(t: TenantRow): { label: string; color: string } {
  if (t.trialEndsAt) {
    const d = differenceInDays(new Date(t.trialEndsAt), new Date());
    if (d < 0) return { label: "Trial истёк", color: COLORS.danger };
    return { label: `Trial ${d}д.`, color: d < 3 ? COLORS.warning : COLORS.info };
  }
  const expires = t.planExpiresAt ? new Date(t.planExpiresAt) : null;
  if (!expires) return { label: "Без лимита", color: COLORS.textSecondary };
  const d = differenceInDays(expires, new Date());
  if (d < 0) return { label: "Истёк", color: COLORS.danger };
  return { label: `${d} дн.`, color: d < 7 ? COLORS.warning : COLORS.success };
}

const PLAN_COLORS: Record<string, { fg: string; bg: string }> = {
  basic:     { fg: COLORS.info,    bg: "rgba(37,99,235,0.12)" },
  pro:       { fg: COLORS.success, bg: "rgba(22,163,74,0.12)" },
  exclusive: { fg: "var(--color-primary-muted)",      bg: "rgba(167,139,250,0.12)" },
};
const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  active:    { fg: COLORS.success, bg: "rgba(22,163,74,0.12)" },
  suspended: { fg: COLORS.danger,  bg: "rgba(220,38,38,0.12)" },
};

function PlanBadge({ plan }: { plan: string }) {
  const c = PLAN_COLORS[plan] ?? PLAN_COLORS.basic;
  return <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: "24px", fontSize: "10px", fontWeight: 700, fontFamily: F.body, color: c.fg, background: c.bg, letterSpacing: "0.04em" }}>{plan.toUpperCase()}</span>;
}
function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.active;
  return <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: "24px", fontSize: "10px", fontWeight: 700, fontFamily: F.body, color: c.fg, background: c.bg, letterSpacing: "0.04em" }}>{status.toUpperCase()}</span>;
}

// ── Premium KPI Card ──────────────────────────────────────────────────────────
function KpiCard({ label, value, icon: Icon, gradient, loading }: {
  label: string; value: string | number; icon: any; gradient: string; loading?: boolean;
}) {
  return (
    <div style={{ background: COLORS.surface, borderRadius: "24px", padding: "24px", boxShadow: SHADOW, position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>{label}</span>
        <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={20} color="#fff" />
        </div>
      </div>
      {loading
        ? <div style={{ height: "32px", borderRadius: "8px", background: COLORS.surfaceLight, animation: "pulse 1.5s infinite" }} />
        : <div style={{ fontFamily: F.display, fontSize: "32px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>{value}</div>
      }
    </div>
  );
}

// ── Premium Section ───────────────────────────────────────────────────────────
function Section({ title, icon: Icon, children, delay = 0 }: {
  title: string; icon: any; children: React.ReactNode; delay?: number;
}) {
  return (
    <div style={{ background: COLORS.surface, borderRadius: "24px", boxShadow: SHADOW }}>
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: "10px", borderBottom: `1px solid ${COLORS.border}` }}>
        <div style={{ width: "28px", height: "28px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(124,127,245,0.1)", color: COLORS.primary }}>
          <Icon size={14} />
        </div>
        <h3 style={{ fontFamily: F.display, fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary }}>{title}</h3>
      </div>
      <div style={{ padding: "20px" }}>{children}</div>
    </div>
  );
}

// ── Premium Modal ─────────────────────────────────────────────────────────────
function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "relative", width: "100%", maxWidth: "480px", background: COLORS.surface, borderRadius: "24px", border: `1px solid ${COLORS.border}`, boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function Input({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label style={{ fontFamily: F.body, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary, display: "block", marginBottom: "6px" }}>{label}</label>
      <input {...props} style={{ width: "100%", padding: "10px 14px", borderRadius: "12px", border: `1px solid ${COLORS.border}`, background: COLORS.surfaceLight, color: COLORS.textPrimary, fontFamily: F.body, fontSize: "13px", outline: "none", transition: "border-color 0.2s", ...props.style }} />
    </div>
  );
}

function BtnPrimary({ children, disabled, onClick, style: s }: { children: React.ReactNode; disabled?: boolean; onClick?: () => void; style?: React.CSSProperties }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "10px 20px", borderRadius: "12px", fontSize: "13px", fontWeight: 600, fontFamily: F.body, color: "#fff", background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))", border: "none", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, transition: "all 0.2s", ...s }}>
      {children}
    </button>
  );
}

function BtnSecondary({ children, onClick, style: s }: { children: React.ReactNode; onClick?: () => void; style?: React.CSSProperties }) {
  return (
    <button onClick={onClick} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "10px 20px", borderRadius: "12px", fontSize: "13px", fontWeight: 600, fontFamily: F.body, color: COLORS.textSecondary, background: COLORS.surface, border: `1px solid ${COLORS.border}`, cursor: "pointer", transition: "all 0.2s", ...s }}>
      {children}
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Platform Stats
// ══════════════════════════════════════════════════════════════════════════════
function PlatformStats() {
  const { data: stats, isLoading } = trpc.tenant.platformStats.useQuery();
  const cards = [
    { label: "Организаций", value: stats?.tenants ?? 0, icon: Building2, gradient: "linear-gradient(135deg, #6366F1, #8B5CF6)" },
    { label: "Пользователей", value: stats?.users ?? 0, icon: Users, gradient: "linear-gradient(135deg, #3B82F6, #2563EB)" },
    { label: "Заказов", value: fmt(stats?.orders ?? 0), icon: ShoppingCart, gradient: "linear-gradient(135deg, #22C55E, #16A34A)" },
    { label: "Выручка", value: money(stats?.revenue ?? 0) + " сум", icon: TrendingUp, gradient: "linear-gradient(135deg, #F59E0B, #D97706)" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
      {cards.map(c => <KpiCard key={c.label} label={c.label} value={c.value} icon={c.icon} gradient={c.gradient} loading={isLoading} />)}
      {stats && (
        <Section title="По тарифам" icon={BarChart3}>
          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "center" }}>
            {(["basic", "pro", "exclusive"] as const).map(plan => (
              <div key={plan} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <PlanBadge plan={plan} />
                <span style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: COLORS.textPrimary }}>{stats.byPlan[plan] ?? 0}</span>
              </div>
            ))}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "10px" }}>
              <StatusBadge status="suspended" />
              <span style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: COLORS.textPrimary }}>{stats.byStatus.suspended ?? 0}</span>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Create Tenant Modal
// ══════════════════════════════════════════════════════════════════════════════
function CreateTenantModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ orgName: "", ownerName: "", ownerEmail: "", ownerPassword: "", plan: "basic" as "basic" | "pro" | "exclusive", trialDays: 14 });
  const create = trpc.tenant.create.useMutation({
    onSuccess: (d) => { notify.success(`Создан: ${d.slug}`); onCreated(); onClose(); },
    onError: (e) => notify.error(e.message),
  });
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <Modal onClose={onClose}>
      <div style={{ padding: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "40px", height: "40px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(124,127,245,0.1)", color: COLORS.primary }}><Plus size={20} /></div>
            <div>
              <h2 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 700, color: COLORS.textPrimary }}>Новая организация</h2>
              <p style={{ fontSize: "12px", color: COLORS.textTertiary }}>Создайте тенант и владельца</p>
            </div>
          </div>
          <button onClick={onClose} style={{ padding: "8px", borderRadius: "8px", background: "none", border: "none", cursor: "pointer", color: COLORS.textSecondary }}><XCircle size={20} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <Input label="Название компании" placeholder="ООО Ромашка" value={form.orgName} onChange={f("orgName")} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Input label="Имя владельца" placeholder="Иван Петров" value={form.ownerName} onChange={f("ownerName")} />
            <Input label="Email" type="email" placeholder="owner@..." value={form.ownerEmail} onChange={f("ownerEmail")} />
          </div>
          <Input label="Пароль" type="password" placeholder="мин. 8 символов" value={form.ownerPassword} onChange={f("ownerPassword")} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label style={{ fontFamily: F.body, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary, display: "block", marginBottom: "6px" }}>Тариф</label>
              <PremiumSelect value={form.plan} onChange={v => setForm(p => ({ ...p, plan: v as any }))} options={[{ value: "basic", label: "Basic" }, { value: "pro", label: "Pro" }, { value: "exclusive", label: "Exclusive" }]} width="100%" />
            </div>
            <Input label="Trial дней" type="number" min="0" max="365" value={String(form.trialDays)} onChange={e => setForm(p => ({ ...p, trialDays: Number(e.target.value) }))} />
          </div>
        </div>
        <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
          <BtnSecondary onClick={onClose} style={{ flex: 1 }}>Отмена</BtnSecondary>
          <BtnPrimary onClick={() => create.mutate(form)} disabled={create.isPending || !form.orgName || !form.ownerEmail || !form.ownerPassword} style={{ flex: 1 }}>
            {create.isPending ? "Создаём…" : "Создать"}
          </BtnPrimary>
        </div>
      </div>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Tenant Detail
// ══════════════════════════════════════════════════════════════════════════════
function TenantDetail({ tenantId, onBack }: { tenantId: number; onBack: () => void }) {
  const { data, isLoading, refetch } = trpc.tenant.getDetail.useQuery({ tenantId });
  const utils = trpc.useUtils();
  const { confirm, dialog } = useConfirm();
  const [resetPwd, setResetPwd] = useState<{ userId: number; name: string } | null>(null);
  const [newPwd, setNewPwd] = useState("");
  const [extDays, setExtDays] = useState(14);
  const [showExt, setShowExt] = useState(false);
  const [planDays, setPlanDays] = useState(30);
  const [showPlan, setShowPlan] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<"basic" | "pro" | "exclusive">("basic");

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
    { label: "Пользователей", value: tenantUsers.length, icon: Users, gradient: "linear-gradient(135deg, #3B82F6, #2563EB)" },
    { label: "Заказов", value: fmt(stats.orders), icon: ShoppingCart, gradient: "linear-gradient(135deg, #22C55E, #16A34A)" },
    { label: "Товаров", value: fmt(stats.products), icon: Package, gradient: "linear-gradient(135deg, #6366F1, #8B5CF6)" },
    { label: "Магазинов", value: fmt(stats.shops), icon: Store, gradient: "linear-gradient(135deg, #F59E0B, #D97706)" },
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
        <div style={{ width: "44px", height: "44px", borderRadius: "14px", background: "rgba(124,127,245,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
              <PremiumSelect value={selectedPlan} onChange={v => setSelectedPlan(v as any)} options={[{ value: "basic", label: "Basic" }, { value: "pro", label: "Pro" }, { value: "exclusive", label: "Exclusive" }]} width="120px" />
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
                  <div style={{ height: "100%", borderRadius: "3px", background: "linear-gradient(90deg, var(--color-primary), var(--color-primary-hover))", width: `${Math.min(100, ((m.orders ?? 0) / Math.max(1, ...monthlyOrders.map(x => x.orders ?? 0))) * 100)}%` }} />
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

// ══════════════════════════════════════════════════════════════════════════════
// Admin Profile
// ══════════════════════════════════════════════════════════════════════════════
function AdminProfile() {
  const { data: user } = trpc.user.me.useQuery();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPwSection, setShowPwSection] = useState(false);
  const [initialized, setInitialized] = useState(false);
  if (user && !initialized) { setName(user.name ?? ""); setPhone(user.phone ?? ""); setInitialized(true); }

  const updateProfile = trpc.user.updateMe.useMutation({ onSuccess: () => { utils.user.me.invalidate(); notify.success("Профиль обновлён"); }, onError: (e) => notify.error(e.message) });
  const changePassword = trpc.user.changePassword.useMutation({ onSuccess: () => { notify.success("Пароль изменён"); setCurrentPw(""); setNewPw(""); setConfirmPw(""); setShowPwSection(false); }, onError: (e) => notify.error(e.message) });

  return (
    <Section title="Мой профиль" icon={User}>
      <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "24px" }}>
        <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "rgba(124,127,245,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}><User size={22} style={{ color: COLORS.primary }} /></div>
        <div>
          <p style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary }}>{user?.name}</p>
          <p style={{ fontSize: "12px", color: COLORS.textTertiary }}>{user?.role} · {user?.email}</p>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <Input label="Имя" value={name} onChange={e => setName(e.target.value)} />
        <Input label="Телефон" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+998..." />
      </div>
      <BtnPrimary onClick={() => { if (!name.trim()) { notify.error("Имя обязательно"); return; } updateProfile.mutate({ name: name.trim(), phone: phone.trim() || undefined }); }} disabled={updateProfile.isPending} style={{ marginTop: "16px" }}>
        {updateProfile.isPending ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={14} />} Сохранить
      </BtnPrimary>
      <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: `1px solid ${COLORS.border}` }}>
        <button onClick={() => setShowPwSection(!showPwSection)} style={{ display: "flex", alignItems: "center", gap: "8px", background: "none", border: "none", cursor: "pointer", color: COLORS.textSecondary, fontSize: "13px", fontWeight: 500, fontFamily: F.body }}>
          <Key size={16} /> {showPwSection ? "Скрыть" : "Изменить пароль"}
        </button>
        {showPwSection && (
          <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "12px", maxWidth: "400px" }}>
            <Input label="Текущий пароль" type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
            <Input label="Новый пароль" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} minLength={8} />
            <Input label="Подтвердите" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
            <BtnPrimary onClick={() => { if (!currentPw) { notify.error("Введите текущий пароль"); return; } if (newPw.length < 8) { notify.error("Пароль минимум 8 символов"); return; } if (newPw !== confirmPw) { notify.error("Пароли не совпадают"); return; } changePassword.mutate({ currentPassword: currentPw, newPassword: newPw }); }} disabled={changePassword.isPending}>
              {changePassword.isPending ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Key size={14} />} Изменить пароль
            </BtnPrimary>
          </div>
        )}
      </div>
    </Section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Main SuperAdmin Page
// ══════════════════════════════════════════════════════════════════════════════
export default function SuperAdmin() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filterPlan, setFilterPlan] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const { data: allTenants, isLoading, refetch } = trpc.tenant.list.useQuery();
  const utils = trpc.useUtils();
  const { confirm, dialog } = useConfirm();
  const invalidate = () => { utils.tenant.list.invalidate(); utils.tenant.platformStats.invalidate(); };
  const setStatus = trpc.tenant.setStatus.useMutation({ onSuccess: () => { invalidate(); notify.success("Статус обновлён"); }, onError: (e) => notify.error(e.message) });

  if (selectedId !== null) return <TenantDetail tenantId={selectedId} onBack={() => setSelectedId(null)} />;

  const tenants = (allTenants ?? []).filter(t => {
    const q = search.toLowerCase();
    return (!q || t.name.toLowerCase().includes(q) || t.slug.includes(q) || (t.ownerEmail ?? "").toLowerCase().includes(q)) && (filterPlan === "all" || t.plan === filterPlan) && (filterStatus === "all" || t.status === filterStatus);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {dialog}
      {showCreate && <CreateTenantModal onClose={() => setShowCreate(false)} onCreated={invalidate} />}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "44px", height: "44px", borderRadius: "14px", background: "linear-gradient(135deg, #6366F1, #8B5CF6)", display: "flex", alignItems: "center", justifyContent: "center" }}><Zap size={22} color="#fff" /></div>
          <div>
            <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.02em" }}>Super Admin</h1>
            <p style={{ fontSize: "13px", color: COLORS.textSecondary }}>Управление платформой</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <BtnSecondary onClick={() => refetch()} style={{ padding: "8px 16px", fontSize: "12px" }}><RefreshCw size={13} /> Обновить</BtnSecondary>
          <BtnPrimary onClick={() => setShowCreate(true)} style={{ padding: "8px 16px", fontSize: "12px" }}><Plus size={13} /> Создать</BtnPrimary>
        </div>
      </div>

      {/* Stats */}
      <PlatformStats />

      {/* Profile */}
      <AdminProfile />

      {/* Filters */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: COLORS.textTertiary }} />
          <input placeholder="Поиск по имени, slug, email…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: "100%", padding: "10px 14px 10px 38px", borderRadius: "12px", border: `1px solid ${COLORS.border}`, background: COLORS.surfaceLight, color: COLORS.textPrimary, fontFamily: F.body, fontSize: "13px", outline: "none" }} />
        </div>
        <PremiumSelect value={filterPlan} onChange={setFilterPlan} options={[{ value: "all", label: "Все тарифы" }, { value: "basic", label: "Basic" }, { value: "pro", label: "Pro" }, { value: "exclusive", label: "Exclusive" }]} width="140px" />
        <PremiumSelect value={filterStatus} onChange={setFilterStatus} options={[{ value: "all", label: "Все статусы" }, { value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }]} width="140px" />
        <span style={{ fontSize: "12px", color: COLORS.textTertiary, marginLeft: "auto" }}>{tenants.length} из {allTenants?.length ?? 0}</span>
      </div>

      {/* Table */}
      <div style={{ background: COLORS.surface, borderRadius: "24px", boxShadow: SHADOW, overflow: "hidden" }}>
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
                  <tr key={t.id} style={{ borderBottom: `1px solid ${COLORS.border}`, cursor: "pointer", transition: "background 0.15s" }} onClick={() => setSelectedId(t.id)} onMouseEnter={e => (e.currentTarget.style.background = COLORS.surfaceLight)} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "rgba(124,127,245,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><span style={{ fontSize: "14px", fontWeight: 700, color: COLORS.primary }}>{t.name[0].toUpperCase()}</span></div>
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
                        <button onClick={e => { e.stopPropagation(); setSelectedId(t.id); }} style={{ padding: "6px", borderRadius: "8px", background: "none", border: `1px solid ${COLORS.border}`, cursor: "pointer", color: COLORS.textTertiary }} title="Подробнее"><ChevronRight size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
