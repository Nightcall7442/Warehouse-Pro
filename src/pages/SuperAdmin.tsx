import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { format, differenceInDays } from "date-fns";
import {
  Building2, Search, Power, Zap, RefreshCw,
  Users, ShoppingCart, TrendingUp, ArrowLeft,
  Plus, Calendar, Lock, ChevronRight, BarChart3, Package,
  Store, Shield, XCircle, User, Mail, Key, Save, Loader2,
} from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";

// ── Типы ─────────────────────────────────────────────────────────────────────
type TenantRow = {
  id: number; name: string; slug: string;
  plan: string; status: string; createdAt: Date;
  trialEndsAt?: Date | null; planExpiresAt?: Date | null;
  ownerEmail?: string | null;
  userCount: number; orderCount: number; orderTotal: number;
};

// ── Утилиты ──────────────────────────────────────────────────────────────────
const PLAN_STYLE: Record<string, string> = {
  basic:     "bg-info/15 text-info border-info/30",
  pro:       "bg-success/15 text-success border-success/30",
  exclusive: "bg-purple-100 text-purple-700 border-purple-300",
};
const STATUS_STYLE: Record<string, string> = {
  active:    "bg-success/15 text-success border-success/30",
  suspended: "bg-danger/15 text-danger border-danger/30",
};

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return String(n);
}
function money(n: number): string {
  return new Intl.NumberFormat("ru").format(Math.round(n));
}
function planStatus(t: TenantRow): { label: string; color: string } {
  // Показываем статус trial-периода если есть trialEndsAt
  if (t.trialEndsAt) {
    const d = differenceInDays(new Date(t.trialEndsAt), new Date());
    if (d < 0) return { label: "Trial истёк", color: "text-danger" };
    return { label: `Trial ${d}д.`, color: d < 3 ? "text-warning" : "text-info" };
  }
  // Показываем статус плана
  const expires = t.planExpiresAt ? new Date(t.planExpiresAt) : null;
  if (!expires) return { label: "Без лимита", color: "text-text-secondary" };
  const d = differenceInDays(expires, new Date());
  if (d < 0) return { label: "Истёк", color: "text-danger" };
  return { label: `${d} дн.`, color: d < 7 ? "text-warning" : "text-success" };
}

// ══════════════════════════════════════════════════════════════════════════════
// Статистика платформы
// ══════════════════════════════════════════════════════════════════════════════
function PlatformStats() {
  const { data: stats, isLoading } = trpc.tenant.platformStats.useQuery();

  const cards = [
    { label: "Всего организаций", value: stats?.tenants ?? 0,              icon: Building2,    color: "indigo" },
    { label: "Пользователей",     value: stats?.users   ?? 0,              icon: Users,        color: "blue"   },
    { label: "Заказов",           value: stats?.orders  ?? 0,              icon: ShoppingCart, color: "green"  },
    { label: "Выручка (total)",   value: money(stats?.revenue ?? 0) + " сум", icon: TrendingUp,  color: "amber",  raw: true as boolean },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(c => (
        <div key={c.label} className="kpi-card">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-text-secondary font-label">{c.label}</span>
            <div className={`kpi-icon-box kpi-icon-${c.color}`}>
              <c.icon size={16} />
            </div>
          </div>
          {isLoading
            ? <div className="h-7 bg-surface-light animate-pulse rounded" />
            : <p className="font-data text-2xl font-bold text-text-primary">
                {(c as { raw?: boolean }).raw ? c.value : fmt(c.value as unknown as number)}
              </p>
          }
        </div>
      ))}
      {/* По тарифам */}
      {stats && (
        <div className="panel p-4 col-span-2 lg:col-span-4">
          <p className="text-xs text-text-secondary font-label mb-3">По тарифам</p>
          <div className="flex gap-4 flex-wrap">
            {(["basic", "pro", "exclusive"] as const).map(plan => (
              <div key={plan} className="flex items-center gap-2">
                <span className={`status-badge ${PLAN_STYLE[plan]}`}>{plan.toUpperCase()}</span>
                <span className="font-data text-lg font-bold text-text-primary">
                  {stats.byPlan[plan] ?? 0}
                </span>
              </div>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <span className={`status-badge ${STATUS_STYLE.suspended}`}>Suspended</span>
              <span className="font-data text-lg font-bold text-text-primary">
                {stats.byStatus.suspended ?? 0}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Модальное окно создания тенанта
// ══════════════════════════════════════════════════════════════════════════════
function CreateTenantModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    orgName: "", ownerName: "", ownerEmail: "",
    ownerPassword: "", plan: "basic" as "basic" | "pro" | "exclusive", trialDays: 14,
  });

  const create = trpc.tenant.create.useMutation({
    onSuccess: (d) => { notify.success(`Создан: ${d.slug}`); onCreated(); onClose(); },
    onError:   (e) => notify.error(e.message),
  });

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="panel p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-text-primary flex items-center gap-2">
            <Plus size={18} className="text-primary" /> Новая организация
          </h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <XCircle size={20} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-text-secondary font-label mb-1 block">Название компании</label>
            <input className="input-field w-full" placeholder="ООО Ромашка" value={form.orgName} onChange={f("orgName")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-secondary font-label mb-1 block">Имя владельца</label>
              <input className="input-field w-full" placeholder="Иван Петров" value={form.ownerName} onChange={f("ownerName")} />
            </div>
            <div>
              <label className="text-xs text-text-secondary font-label mb-1 block">Email</label>
              <input className="input-field w-full" type="email" placeholder="owner@..." value={form.ownerEmail} onChange={f("ownerEmail")} />
            </div>
          </div>
          <div>
            <label className="text-xs text-text-secondary font-label mb-1 block">Пароль</label>
            <input className="input-field w-full" type="password" placeholder="мин. 8 символов" value={form.ownerPassword} onChange={f("ownerPassword")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-secondary font-label mb-1 block">Тариф</label>
              <PremiumSelect value={form.plan} onChange={v => setForm(p => ({ ...p, plan: v as "basic" | "pro" | "exclusive" }))}
                options={[{value:"basic",label:"Basic"},{value:"pro",label:"Pro"},{value:"exclusive",label:"Exclusive"}]}
                width="100%" />
            </div>
            <div>
              <label className="text-xs text-text-secondary font-label mb-1 block">Trial дней</label>
              <input className="input-field w-full" type="number" min="0" max="365"
                value={form.trialDays} onChange={e => setForm(p => ({ ...p, trialDays: Number(e.target.value) }))} />
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="btn-secondary flex-1">Отмена</button>
          <button
            onClick={() => create.mutate(form)}
            disabled={create.isPending || !form.orgName || !form.ownerEmail || !form.ownerPassword}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {create.isPending ? "Создаём…" : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Детальная страница тенанта
// ══════════════════════════════════════════════════════════════════════════════
function TenantDetail({ tenantId, onBack }: { tenantId: number; onBack: () => void }) {
  const { data, isLoading, refetch } = trpc.tenant.getDetail.useQuery({ tenantId });
  const utils    = trpc.useUtils();
  const { confirm, dialog } = useConfirm();
  const [resetPwd,  setResetPwd]  = useState<{ userId: number; name: string } | null>(null);
  const [newPwd,    setNewPwd]    = useState("");
  const [extDays,   setExtDays]   = useState(14);
  const [showExt,   setShowExt]   = useState(false);
  const [planDays,  setPlanDays]  = useState(30);
  const [showPlan,  setShowPlan]  = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<"basic"|"pro"|"exclusive">("basic");

  const invalidate = () => { refetch(); utils.tenant.list.invalidate(); utils.tenant.platformStats.invalidate(); };

  const updatePlan = trpc.tenant.updatePlan.useMutation({
    onSuccess: () => { invalidate(); notify.success("Тариф обновлён"); setShowPlan(false); },
    onError:   (e) => notify.error(e.message),
  });
  const setStatus = trpc.tenant.setStatus.useMutation({
    onSuccess: () => { invalidate(); notify.success("Статус обновлён"); },
    onError:   (e) => notify.error(e.message),
  });
  const extendTrial = trpc.tenant.extendTrial.useMutation({
    onSuccess: (r) => {
      invalidate();
      notify.success(`Trial продлён до ${format(new Date(r.trialEndsAt), "dd.MM.yyyy")}`);
      setShowExt(false);
    },
    onError: (e) => notify.error(e.message),
  });
  const resetPassword = trpc.tenant.resetOwnerPassword.useMutation({
    onSuccess: () => { notify.success("Пароль сброшен"); setResetPwd(null); setNewPwd(""); },
    onError:   (e) => notify.error(e.message),
  });

  if (isLoading) return (
    <div className="space-y-4">
      {[...Array(4)].map((_, i) => <div key={i} className="panel p-5 h-20 animate-pulse bg-surface-light" />)}
    </div>
  );

  if (!data) return <div className="panel p-8 text-center text-text-secondary">Тенант не найден</div>;

  const { tenant, subscription: subArr, users: tenantUsers, stats, monthlyOrders } = data;
  const subscription = Array.isArray(subArr) ? subArr[0] : subArr;
  const ts = planStatus({ ...tenant, userCount: 0, orderCount: 0, orderTotal: 0 } as TenantRow);

  return (
    <div className="space-y-5">
      {dialog}

      {/* Сброс пароля модалка */}
      {resetPwd && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="panel p-6 w-full max-w-sm space-y-4">
            <h3 className="font-display text-base font-bold text-text-primary flex items-center gap-2">
              <Lock size={16} className="text-warning" /> Сбросить пароль — {resetPwd.name}
            </h3>
            <input
              className="input-field w-full"
              type="password"
              placeholder="Новый пароль (мин. 8)"
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
            />
            <div className="flex gap-2">
              <button onClick={() => { setResetPwd(null); setNewPwd(""); }} className="btn-secondary flex-1">Отмена</button>
              <button
                disabled={newPwd.length < 8 || resetPassword.isPending}
                onClick={() => resetPassword.mutate({ tenantId, userId: resetPwd.userId, newPassword: newPwd })}
                className="btn-primary flex-1 disabled:opacity-50"
              >
                {resetPassword.isPending ? "…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Шапка */}
      <div className="panel p-5">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-secondary p-2">
            <ArrowLeft size={16} />
          </button>
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <span className="text-lg font-bold text-primary">{tenant.name[0].toUpperCase()}</span>
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-text-primary">{tenant.name}</h2>
            <p className="text-xs text-text-secondary font-data">{tenant.slug} · {tenant.ownerEmail}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className={`status-badge ${PLAN_STYLE[tenant.plan]}`}>{tenant.plan.toUpperCase()}</span>
            <span className={`status-badge ${STATUS_STYLE[tenant.status]}`}>{tenant.status.toUpperCase()}</span>
          </div>
        </div>
      </div>

      {/* Метрики */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Пользователей",  value: tenantUsers.length,  icon: Users,        color: "text-info"    },
          { label: "Заказов",        value: stats.orders,         icon: ShoppingCart, color: "text-success" },
          { label: "Товаров",        value: stats.products,       icon: Package,      color: "text-primary" },
          { label: "Магазинов",      value: stats.shops,          icon: Store,        color: "text-warning" },
        ].map(c => (
          <div key={c.label} className="panel p-4 text-center">
            <c.icon size={18} className={`mx-auto mb-1 ${c.color}`} />
            <p className="font-data text-2xl font-bold text-text-primary">{fmt(c.value)}</p>
            <p className="text-[10px] text-text-secondary font-label">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Подписка */}
      <div className="panel p-5 space-y-4">
        <h3 className="font-h2 text-sm font-semibold text-text-primary flex items-center gap-2">
          <Shield size={15} className="text-primary" /> Подписка
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-text-secondary">Тариф</p>
            <p className={`font-semibold mt-0.5 ${ts.color}`}>{tenant.plan.toUpperCase()}</p>
          </div>
          <div>
            <p className="text-xs text-text-secondary">Осталось</p>
            <p className={`font-semibold mt-0.5 ${ts.color}`}>{ts.label}</p>
          </div>
          {tenant.trialEndsAt && (
            <div>
              <p className="text-xs text-text-secondary">Trial до</p>
              <p className="font-semibold mt-0.5 text-text-primary">
                {format(new Date(tenant.trialEndsAt), "dd.MM.yyyy")}
              </p>
            </div>
          )}
          {tenant.planExpiresAt && (
            <div>
              <p className="text-xs text-text-secondary">Тариф до</p>
              <p className="font-semibold mt-0.5 text-text-primary">
                {format(new Date(tenant.planExpiresAt), "dd.MM.yyyy")}
              </p>
            </div>
          )}
          {subscription && (
            <>
              <div>
                <p className="text-xs text-text-secondary">Stripe статус</p>
                <p className="font-semibold mt-0.5 text-text-primary">{subscription.status}</p>
              </div>
              <div>
                <p className="text-xs text-text-secondary">Customer ID</p>
                <p className="font-data text-xs mt-0.5 text-text-secondary truncate">
                  {(subscription as any)?.stripeCustomerId ?? "—"}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Действия с подпиской */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-border-subtle">
          {/* Изменить план */}
          {showPlan ? (
            <div className="flex items-center gap-2">
              <PremiumSelect value={selectedPlan} onChange={v => setSelectedPlan(v as unknown as "basic" | "pro" | "exclusive")}
                options={[{value:"basic",label:"Basic"},{value:"pro",label:"Pro"},{value:"exclusive",label:"Exclusive"}]}
                width="120px" />
              <input type="number" min="1" max="3650" value={planDays}
                onChange={e => setPlanDays(Number(e.target.value))}
                className="input-field py-1.5 text-xs w-24" placeholder="дней" />
              <button
                onClick={() => updatePlan.mutate({ tenantId, plan: selectedPlan, expiryDays: planDays })}
                disabled={updatePlan.isPending}
                className="btn-primary py-1.5 px-3 text-xs disabled:opacity-50"
              >
                {updatePlan.isPending ? "…" : "Сохранить"}
              </button>
              <button onClick={() => setShowPlan(false)} className="btn-secondary py-1.5 px-3 text-xs">✕</button>
            </div>
          ) : (
            <button onClick={() => setShowPlan(true)} className="btn-secondary py-1.5 px-3 text-xs flex items-center gap-1.5">
              <Zap size={13} /> Изменить тариф
            </button>
          )}

          {/* Продлить trial */}
          {showExt ? (
            <div className="flex items-center gap-2">
              <input type="number" min="1" max="365" value={extDays}
                onChange={e => setExtDays(Number(e.target.value))}
                className="input-field py-1.5 text-xs w-24" placeholder="дней" />
              <button
                onClick={() => extendTrial.mutate({ tenantId, days: extDays })}
                disabled={extendTrial.isPending}
                className="btn-primary py-1.5 px-3 text-xs disabled:opacity-50"
              >
                {extendTrial.isPending ? "…" : "Продлить"}
              </button>
              <button onClick={() => setShowExt(false)} className="btn-secondary py-1.5 px-3 text-xs">✕</button>
            </div>
          ) : (
            <button onClick={() => setShowExt(true)} className="btn-secondary py-1.5 px-3 text-xs flex items-center gap-1.5">
              <Calendar size={13} /> Продлить trial
            </button>
          )}

          {/* Suspend/Activate */}
          <button
            onClick={async () => {
              const next = tenant.status === "active" ? "suspended" : "active";
              const ok = await confirm({
                title:   next === "suspended" ? `Приостановить "${tenant.name}"?` : `Активировать "${tenant.name}"?`,
                message: next === "suspended" ? "Все пользователи потеряют доступ." : "Пользователи снова смогут войти.",
                confirmText: next === "suspended" ? "Приостановить" : "Активировать",
                danger: next === "suspended",
              });
              if (ok) setStatus.mutate({ tenantId, status: next });
            }}
            className={`py-1.5 px-3 text-xs btn-secondary flex items-center gap-1.5
              ${tenant.status === "active" ? "text-danger border-danger/30" : "text-success border-success/30"}`}
          >
            <Power size={13} />
            {tenant.status === "active" ? "Приостановить" : "Активировать"}
          </button>
        </div>
      </div>

      {/* Пользователи */}
      <div className="panel overflow-hidden">
        <div className="px-5 py-3 border-b border-border-subtle">
          <h3 className="font-h2 text-sm font-semibold text-text-primary flex items-center gap-2">
            <Users size={15} className="text-info" /> Пользователи ({tenantUsers.length})
          </h3>
        </div>
        <div className="divide-y divide-border-subtle">
          {tenantUsers.map(u => (
            <div key={u.id} className="px-5 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-surface-light flex items-center justify-center">
                <span className="text-xs font-bold text-text-secondary">{u.name[0]}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{u.name}</p>
                <p className="text-xs text-text-secondary truncate">{u.email}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-text-secondary font-label px-2 py-0.5 bg-surface-light rounded">
                  {u.role}
                </span>
                <span className={`status-badge text-[10px] py-0.5 ${STATUS_STYLE[u.status]}`}>
                  {u.status}
                </span>
                <button
                  onClick={() => setResetPwd({ userId: u.id, name: u.name })}
                  className="btn-secondary p-1.5 text-warning border-warning/30"
                  title="Сбросить пароль"
                >
                  <Lock size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* История заказов по месяцам */}
      {monthlyOrders.length > 0 && (
        <div className="panel p-5">
          <h3 className="font-h2 text-sm font-semibold text-text-primary flex items-center gap-2 mb-3">
            <BarChart3 size={15} className="text-success" /> Заказы по месяцам
          </h3>
          <div className="space-y-2">
            {monthlyOrders.map(m => (
              <div key={m.month} className="flex items-center gap-3 text-sm">
                <span className="w-20 font-data text-text-secondary text-xs">{m.month}</span>
                <div className="flex-1 h-1.5 bg-surface-light rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${Math.min(100, (m.orders / Math.max(...monthlyOrders.map(x => x.orders))) * 100)}%` }}
                  />
                </div>
                <span className="w-10 text-right font-data text-text-primary text-xs">{m.orders}</span>
                <span className="w-24 text-right font-data text-text-secondary text-xs">{money(m.revenue)} сум</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Профиль суперадмина — изменение логина и пароля
// ══════════════════════════════════════════════════════════════════════════════
function AdminProfile() {
  const { data: user } = trpc.user.me.useQuery();
  const utils = trpc.useUtils();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPwSection, setShowPwSection] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Инициализация полей из данных пользователя
  if (user && !initialized) {
    setName(user.name ?? "");
    setEmail(user.email ?? "");
    setPhone(user.phone ?? "");
    setInitialized(true);
  }

  const updateProfile = trpc.user.updateMe.useMutation({
    onSuccess: () => { utils.user.me.invalidate(); notify.success("Профиль обновлён"); },
    onError: (e) => notify.error(e.message),
  });

  const changePassword = trpc.user.changePassword.useMutation({
    onSuccess: () => { notify.success("Пароль изменён"); setCurrentPw(""); setNewPw(""); setConfirmPw(""); setShowPwSection(false); },
    onError: (e) => notify.error(e.message),
  });

  const handleProfileSave = () => {
    if (!name.trim()) { notify.error("Имя обязательно"); return; }
    updateProfile.mutate({ name: name.trim(), phone: phone.trim() || undefined });
  };

  const handlePasswordChange = () => {
    if (!currentPw) { notify.error("Введите текущий пароль"); return; }
    if (newPw.length < 8) { notify.error("Пароль минимум 8 символов"); return; }
    if (newPw !== confirmPw) { notify.error("Пароли не совпадают"); return; }
    changePassword.mutate({ currentPassword: currentPw, newPassword: newPw });
  };

  return (
    <div className="panel p-5 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <User size={20} className="text-primary" />
        </div>
        <div>
          <h2 className="font-semibold text-text-primary">Мой профиль</h2>
          <p className="text-xs text-text-secondary">{user?.role} · {user?.email}</p>
        </div>
      </div>

      {/* Основная информация */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">ИМЯ *</label>
          <input className="input-field w-full" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">EMAIL</label>
          <input className="input-field w-full" value={email} disabled style={{ opacity: 0.6 }} />
          <p className="text-[10px] text-text-tertiary mt-1">Email нельзя изменить</p>
        </div>
        <div>
          <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">ТЕЛЕФОН</label>
          <input className="input-field w-full" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+998..." />
        </div>
      </div>

      <button
        onClick={handleProfileSave}
        disabled={updateProfile.isPending}
        className="btn-primary flex items-center gap-2 text-sm py-2"
      >
        {updateProfile.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        Сохранить
      </button>

      {/* Смена пароля */}
      <div className="border-t pt-5" style={{ borderColor: "var(--color-border-subtle)" }}>
        <button
          onClick={() => setShowPwSection(!showPwSection)}
          className="flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
        >
          <Key size={16} />
          {showPwSection ? "Скрыть" : "Изменить пароль"}
        </button>

        {showPwSection && (
          <div className="mt-4 space-y-3 max-w-md">
            <div>
              <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">ТЕКУЩИЙ ПАРОЛЬ</label>
              <input type="password" className="input-field w-full" value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
            </div>
            <div>
              <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">НОВЫЙ ПАРОЛЬ</label>
              <input type="password" className="input-field w-full" value={newPw} onChange={e => setNewPw(e.target.value)} minLength={8} />
            </div>
            <div>
              <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">ПОДТВЕРДИТЕ</label>
              <input type="password" className="input-field w-full" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
            </div>
            <button
              onClick={handlePasswordChange}
              disabled={changePassword.isPending}
              className="btn-primary flex items-center gap-2 text-sm py-2"
            >
              {changePassword.isPending ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
              Изменить пароль
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Главная страница SuperAdmin
// ══════════════════════════════════════════════════════════════════════════════
export default function SuperAdmin() {
  const [search,       setSearch]       = useState("");
  const [selectedId,   setSelectedId]   = useState<number | null>(null);
  const [showCreate,   setShowCreate]   = useState(false);
  const [filterPlan,   setFilterPlan]   = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const { data: allTenants, isLoading, refetch } = trpc.tenant.list.useQuery();
  const utils = trpc.useUtils();
  const { confirm, dialog } = useConfirm();

  const invalidate = () => {
    utils.tenant.list.invalidate();
    utils.tenant.platformStats.invalidate();
  };

  const setStatus = trpc.tenant.setStatus.useMutation({
    onSuccess: () => { invalidate(); notify.success("Статус обновлён"); },
    onError:   (e) => notify.error(e.message),
  });

  // Если открыт детальный вид
  if (selectedId !== null) {
    return <TenantDetail tenantId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  const tenants = (allTenants ?? []).filter(t => {
    const q = search.toLowerCase();
    const matchSearch = !q || t.name.toLowerCase().includes(q) || t.slug.includes(q) || (t.ownerEmail ?? "").toLowerCase().includes(q);
    const matchPlan   = filterPlan   === "all" || t.plan   === filterPlan;
    const matchStatus = filterStatus === "all" || t.status === filterStatus;
    return matchSearch && matchPlan && matchStatus;
  });

  return (
    <div className="space-y-5">
      {dialog}
      {showCreate && (
        <CreateTenantModal
          onClose={() => setShowCreate(false)}
          onCreated={invalidate}
        />
      )}

      {/* Заголовок */}
      <div className="panel p-5 border-l-4 border-primary">
        <div className="flex items-center gap-3">
          <Zap size={22} className="text-primary" />
          <div>
            <h1 className="font-display text-xl font-bold text-text-primary">Super Admin</h1>
            <p className="text-sm text-text-secondary">Управление платформой</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => refetch()} className="btn-secondary py-1.5 px-3 text-xs flex items-center gap-1.5">
              <RefreshCw size={13} /> Обновить
            </button>
            <button onClick={() => setShowCreate(true)} className="btn-primary py-1.5 px-3 text-xs flex items-center gap-1.5">
              <Plus size={13} /> Создать
            </button>
          </div>
        </div>
      </div>

      {/* Глобальная статистика */}
      <PlatformStats />

      {/* Профиль суперадмина */}
      <AdminProfile />

      {/* Фильтры */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            className="input-field pl-9 w-full"
            placeholder="Поиск по имени, slug, email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <PremiumSelect value={filterPlan} onChange={setFilterPlan}
          options={[{value:"all",label:"Все тарифы"},{value:"basic",label:"Basic"},{value:"pro",label:"Pro"},{value:"exclusive",label:"Exclusive"}]}
          width="140px" />
        <PremiumSelect value={filterStatus} onChange={setFilterStatus}
          options={[{value:"all",label:"Все статусы"},{value:"active",label:"Active"},{value:"suspended",label:"Suspended"}]}
          width="140px" />
        <span className="text-xs text-text-secondary font-label ml-auto">
          {tenants.length} из {allTenants?.length ?? 0}
        </span>
      </div>

      {/* Таблица */}
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="bg-surface-light border-b border-border-subtle">
              {["Организация", "Тариф", "Статус", "Осталось", "Юзеров", "Заказов", "Выручка", "Создана", ""].map(h => (
                <th key={h} className="text-left px-4 py-3 font-label text-text-secondary text-xs tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b border-border-subtle">
                    <td colSpan={9} className="px-4 py-4">
                      <div className="h-4 bg-surface-light animate-pulse rounded" />
                    </td>
                  </tr>
                ))
              : tenants.length === 0
                ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-16 text-center text-text-secondary text-sm">
                      <Building2 size={32} className="mx-auto mb-2 opacity-30" />
                      Нет организаций
                    </td>
                  </tr>
                )
                : tenants.map(t => {
                    const ts = planStatus(t);
                    return (
                      <tr key={t.id}
                        className="border-b border-border-subtle hover:bg-surface-light/40 cursor-pointer"
                        onClick={() => setSelectedId(t.id)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                              <span className="text-sm font-bold text-primary">{t.name[0].toUpperCase()}</span>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-text-primary">{t.name}</p>
                              <p className="text-[10px] text-text-secondary font-data">{t.slug}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`status-badge ${PLAN_STYLE[t.plan]}`}>{t.plan.toUpperCase()}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`status-badge ${STATUS_STYLE[t.status]}`}>{t.status.toUpperCase()}</span>
                        </td>
                        <td className={`px-4 py-3 text-xs font-semibold ${ts.color}`}>{ts.label}</td>
                        <td className="px-4 py-3 font-data text-sm text-text-primary">{t.userCount}</td>
                        <td className="px-4 py-3 font-data text-sm text-text-primary">{fmt(t.orderCount)}</td>
                        <td className="px-4 py-3 font-data text-sm text-text-primary">{money(t.orderTotal)} сум</td>
                        <td className="px-4 py-3 text-xs text-text-secondary">
                          {format(new Date(t.createdAt), "dd.MM.yy")}
                        </td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                const next = t.status === "active" ? "suspended" : "active";
                                const ok = await confirm({
                                  title: next === "suspended" ? `Приостановить "${t.name}"?` : `Активировать "${t.name}"?`,
                                  message: next === "suspended" ? "Все пользователи потеряют доступ." : "Пользователи снова смогут войти.",
                                  confirmText: next === "suspended" ? "Приостановить" : "Активировать",
                                  danger: next === "suspended",
                                });
                                if (ok) setStatus.mutate({ tenantId: t.id, status: next });
                              }}
                              className={`btn-secondary p-1.5 ${t.status === "active" ? "text-danger border-danger/30" : "text-success border-success/30"}`}
                              title={t.status === "active" ? "Приостановить" : "Активировать"}
                            >
                              <Power size={13} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setSelectedId(t.id); }}
                              className="btn-secondary p-1.5"
                              title="Подробнее"
                            >
                              <ChevronRight size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}
