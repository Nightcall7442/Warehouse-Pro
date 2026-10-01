import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  Users, ShoppingCart, Package, Store, Zap, CalendarPlus, PackagePlus, BookOpen, AtSign, KeyRound,
  Power, Trash2, Eraser, ShieldCheck, ShieldAlert,
} from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../api/router";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/components/ConfirmDialog";
import { PremiumSelect } from "@/components/PremiumSelect";
import { AppModal } from "@/components/ui/AppModal";
import { OperatorAccess } from "@/components/settings/OperatorAccess";
import { offboardConfirmWord } from "@contracts/tenant-slug";
import { EXTRA_PRICES_UZS, FEATURES, type FeatureKey } from "@contracts/constants";
import { ROLE_LABEL, SUBSCRIPTION_STATUS_LABEL } from "@contracts/entity-labels";
import { describeSignupSource } from "@contracts/signup";
import { endsAt, daysLeft, statusOf, type OrgRow } from "./orgs";
import { rowFromDetail, subOf, type Detail } from "./detail";
import { ago, day, money } from "./format";
import { FieldLabel, Panel, Pill, PlanPill, Tile } from "./ui";

/* ═══════════════════════════════════════════════════════════════════════════
   Вкладки карточки организации. Всё, что делала прежняя TenantDetail, —
   на своём месте: подписка отдельно от людей, необратимое — в «Опасной
   зоне», а не ещё одной кнопкой в ряду рядом с «Изменить тариф».
   ═══════════════════════════════════════════════════════════════════════════ */

type Usage = inferRouterOutputs<AppRouter>["tenant"]["featureUsage"][number];
type Plan = "trial" | "basic" | "pro" | "exclusive";
const PLAN_OPTIONS = [{ value: "trial", label: "Пробный" }, { value: "basic", label: "Базовый" }, { value: "pro", label: "Про" }, { value: "exclusive", label: "Эксклюзив" }];


const input = { minHeight: 44, fontSize: 14 } as const;
const btn = { minHeight: 44 } as const;

function Card({ title, icon: Icon, hint, children, testId }: { title: string; icon: typeof Zap; hint?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="neo-card neo-card-static console-form" style={{ padding: 18, borderRadius: 20 }} data-testid={testId}>
      <div className="flex items-center gap-2.5" style={{ marginBottom: hint ? 4 : 12 }}>
        <span className="flex items-center justify-center flex-shrink-0" style={{ width: 32, height: 32, borderRadius: 10, background: "var(--color-primary-subtle)" }}>
          <Icon size={16} color="var(--color-primary-text)" />
        </span>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>{title}</h3>
      </div>
      {hint && <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", margin: "0 0 12px 42px", lineHeight: 1.5 }}>{hint}</p>}
      {children}
    </section>
  );
}

/* ── Обзор ─────────────────────────────────────────────────────────────── */

export function OverviewTab({ d, row, usage }: { d: Detail; row: OrgRow | undefined; usage: Usage | undefined }) {
  const months = d.monthlyOrders;
  const max = Math.max(1, ...months.map(m => m.orders));
  const source = describeSignupSource(row?.signupSource ?? null, "ru");
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
        <Tile label="Пользователей" value={d.users.length} icon={Users} tone="info" />
        <Tile label="Заказов" value={money(d.stats.orders)} hint={row ? `за 30 дней: ${money(row.orders30)}` : undefined} icon={ShoppingCart} tone="success" />
        <Tile label="Товаров" value={money(d.stats.products)} icon={Package} tone="primary" />
        <Tile label="Магазинов" value={money(d.stats.shops)} icon={Store} tone="warning" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Активность" testId="org-activity">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3" style={{ margin: 0 }}>
            <Fact k="Последний вход" v={row?.lastLoginAt ? `${day(row.lastLoginAt)} · ${ago(row.lastLoginAt)}` : "—"} />
            <Fact k="Последний заказ" v={row?.lastOrderAt ? `${day(row.lastOrderAt)} · ${ago(row.lastOrderAt)}` : "заказов нет"} />
            <Fact k="Выручка за 30 дней" v={row ? `${money(row.revenue30)} сум` : "—"} />
            <Fact k="Выручка за всё время" v={`${money(d.stats.revenue)} сум`} />
            <Fact k="Зарегистрирована" v={day(d.tenant.createdAt)} />
            <Fact k="Откуда пришла" v={source ?? "—"} />
          </dl>
        </Panel>

        <Panel title="Заказы по месяцам" testId="org-months">
          {months.length === 0 ? <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: 0 }}>За полгода заказов нет.</p> : (
            <div className="flex flex-col gap-2.5">
              {months.map(m => (
                <div key={m.month} className="flex items-center gap-3">
                  <span style={{ width: 64, fontSize: 12.5, color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>{m.month}</span>
                  <div className="flex-1" style={{ height: 8, borderRadius: 99, background: "var(--color-surface-light)", boxShadow: "var(--shadow-pressed)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.round((m.orders / max) * 100)}%`, borderRadius: 99, background: "var(--color-primary)" }} />
                  </div>
                  <span style={{ width: 44, textAlign: "right", fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{m.orders}</span>
                  <span className="hidden sm:inline" style={{ width: 130, textAlign: "right", fontSize: 12, color: "var(--color-text-tertiary)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{money(m.revenue)} сум</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Что в ходу и что даёт тариф — то, что было общим отчётом «Тарифы и что в ходу». */}
      <Panel title="Функции и тариф" testId="org-features"
        action={usage && usage.overreach.length > 0 ? <Pill tone="warning">сверх тарифа: {usage.overreach.length}</Pill> : undefined}>
        {!usage ? <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: 0 }}>Считаю…</p> : (
          <>
            <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", margin: "0 0 12px", lineHeight: 1.5 }}>
              Разграничение по тарифам пока не проверяется кодом — кроме чата поддержки и API. Здесь видно, что потеряет организация, если его включить.
            </p>
            <div className="flex flex-col gap-2">
              {usage.traces.map(tr => {
                const conflict = tr.used && !tr.allowed;
                return (
                  <div key={tr.feature} className="flex items-start gap-2.5" style={{ fontSize: 13 }}>
                    {conflict ? <ShieldAlert size={16} color="var(--color-warning-text)" style={{ flexShrink: 0, marginTop: 1 }} />
                      : <ShieldCheck size={16} color={tr.used ? "var(--color-primary-text)" : "var(--color-text-tertiary)"} style={{ flexShrink: 0, marginTop: 1 }} />}
                    <span className="min-w-0">
                      <span style={{ fontWeight: conflict ? 700 : 600, color: conflict ? "var(--color-warning-text)" : "var(--color-text-primary)" }}>
                        {FEATURES[tr.feature as FeatureKey]?.ru ?? tr.feature}
                      </span>
                      <span style={{ color: "var(--color-text-tertiary)" }}> · {tr.allowed ? "входит в тариф" : "не входит в тариф"} · {tr.evidence}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{k}</dt>
      <dd style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-text-primary)", margin: "2px 0 0", overflowWrap: "anywhere" }}>{v}</dd>
    </div>
  );
}

/* ── Подписка ──────────────────────────────────────────────────────────── */

export function SubscriptionTab({ d, onChanged }: { d: Detail; onChanged: () => void }) {
  const t = d.tenant;
  const tenantId = t.id;
  const sub = subOf(d);
  const row = rowFromDetail(d);
  const st = statusOf(row);
  const ends = endsAt(row);
  const left = daysLeft(row);

  const [plan, setPlan] = useState<Plan>((sub?.plan as Plan) ?? (t.plan as Plan) ?? "basic");
  const [planDays, setPlanDays] = useState(30);
  const [trialDays, setTrialDays] = useState(14);
  const [extraUsers, setExtraUsers] = useState(Number(t.extraUsers ?? 0));
  const [extraProducts, setExtraProducts] = useState(Number(t.extraProducts ?? 0));

  const updatePlan = trpc.tenant.updatePlan.useMutation({ onSuccess: () => { onChanged(); notify.success("Тариф обновлён"); }, onError: e => notify.error(e.message) });
  const extendTrial = trpc.tenant.extendTrial.useMutation({ onSuccess: r => { onChanged(); notify.success(`Пробный продлён до ${day(r.trialEndsAt)}`); }, onError: e => notify.error(e.message) });
  const setExtra = trpc.tenant.setExtraLimits.useMutation({ onSuccess: () => { onChanged(); notify.success("Лимиты обновлены"); }, onError: e => notify.error(e.message) });
  const setManual = trpc.tenant.setManualAccess.useMutation({
    onSuccess: r => { onChanged(); notify.success(r.manualEnabledAt ? "Руководство выдано" : "Руководство отключено"); },
    onError: e => notify.error(e.message),
  });

  const extraSum = extraUsers * EXTRA_PRICES_UZS.user + extraProducts * EXTRA_PRICES_UZS.product;

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Сейчас" testId="sub-summary">
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3" style={{ margin: 0 }}>
          <Fact k="Тариф" v={<PlanPill plan={sub?.plan ?? t.plan} />} />
          <Fact k="Состояние" v={<Pill tone={st.tone}>{st.label}</Pill>} />
          <Fact k={row.segment.trial ? "Пробный до" : "Оплачено до"} v={ends ? `${day(ends)} · ${left !== null && left <= 0 ? "истёк" : `осталось ${left} дн.`}` : "бессрочно"} />
          <Fact k="Подписка" v={sub ? (SUBSCRIPTION_STATUS_LABEL[sub.status as keyof typeof SUBSCRIPTION_STATUS_LABEL]?.ru ?? sub.status) : "нет"} />
          {(Number(t.extraUsers ?? 0) > 0 || Number(t.extraProducts ?? 0) > 0) && (
            <Fact k="Сверх тарифа" v={[Number(t.extraUsers) > 0 ? `${t.extraUsers} мест` : null, Number(t.extraProducts) > 0 ? `${t.extraProducts} товаров` : null].filter(Boolean).join(" · ")} />
          )}
          <Fact k="Лимиты тарифа" v={`${t.maxUsers ?? "∞"} польз. · ${t.maxProducts ?? "∞"} товаров`} />
        </dl>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Изменить тариф" icon={Zap} hint="Новый тариф и срок оплаты с сегодняшнего дня." testId="sub-plan">
          <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto] items-end">
            <div>
              <FieldLabel>Тариф</FieldLabel>
              <PremiumSelect value={plan} onChange={v => setPlan(v as Plan)} options={PLAN_OPTIONS} width="100%" aria-label="Тариф" />
            </div>
            <div>
              <FieldLabel htmlFor="plan-days">Дней</FieldLabel>
              <input id="plan-days" type="number" min={1} max={3650} value={planDays} onChange={e => setPlanDays(Number(e.target.value))} className="neo-input w-full" style={input} />
            </div>
            <button type="button" className="neo-btn-primary" style={btn} disabled={updatePlan.isPending || planDays < 1}
              onClick={() => updatePlan.mutate({ tenantId, plan, expiryDays: planDays })} data-testid="sub-plan-save">
              {updatePlan.isPending ? "Сохраняю…" : "Сохранить"}
            </button>
          </div>
        </Card>

        <Card title="Продлить пробный" icon={CalendarPlus} hint="Дни добавляются к концу пробного; истёкший продлевается от сегодня." testId="sub-trial">
          <div className="grid gap-3 grid-cols-[1fr_auto] items-end">
            <div>
              <FieldLabel htmlFor="trial-days">На сколько дней</FieldLabel>
              <input id="trial-days" type="number" min={1} max={365} value={trialDays} onChange={e => setTrialDays(Number(e.target.value))} className="neo-input w-full" style={input} />
            </div>
            <button type="button" className="neo-btn-primary" style={btn} disabled={extendTrial.isPending || trialDays < 1}
              onClick={() => extendTrial.mutate({ tenantId, days: trialDays })} data-testid="sub-trial-save">
              {extendTrial.isPending ? "Продлеваю…" : "Продлить"}
            </button>
          </div>
        </Card>

        {/* Итоговое число докупленного, а не «добавить ещё»: поле совпадает с тем,
            что видно выше, и повторное «Сохранить» ничего не удваивает. */}
        <Card title="Сверх тарифа" icon={PackagePlus} hint="Докупленные места и товары. Ноль возвращает к пределу тарифа." testId="sub-extra">
          <div className="grid gap-3 grid-cols-2 items-end">
            <div>
              <FieldLabel htmlFor="extra-users">Мест</FieldLabel>
              <input id="extra-users" type="number" min={0} max={1000} value={extraUsers} onChange={e => setExtraUsers(Math.max(0, Number(e.target.value)))} className="neo-input w-full" style={input} />
            </div>
            <div>
              <FieldLabel htmlFor="extra-products">Товаров</FieldLabel>
              <input id="extra-products" type="number" min={0} max={1000} value={extraProducts} onChange={e => setExtraProducts(Math.max(0, Number(e.target.value)))} className="neo-input w-full" style={input} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap" style={{ marginTop: 12 }}>
            {/* Сумма считается здесь, а не в голове: 17 мест по 35 000 в уме умножают с ошибкой. */}
            <span style={{ fontSize: 13.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }} data-testid="sub-extra-sum">= {money(extraSum)} сум/мес</span>
            <button type="button" className="neo-btn-primary" style={btn} disabled={setExtra.isPending}
              onClick={() => setExtra.mutate({ tenantId, extraUsers, extraProducts })} data-testid="sub-extra-save">
              {setExtra.isPending ? "Сохраняю…" : "Сохранить"}
            </button>
          </div>
        </Card>

        <Card title="Руководство дистрибьютора" icon={BookOpen} hint="Платная книга. Выдаётся организации по решению владельца платформы." testId="sub-manual">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span style={{ fontSize: 13.5, fontWeight: 600, color: t.manualEnabledAt ? "var(--color-success-text)" : "var(--color-text-secondary)" }}>
              {t.manualEnabledAt ? `Выдано ${day(t.manualEnabledAt)}` : "Не выдано"}
            </span>
            <button type="button" className={t.manualEnabledAt ? "neo-btn" : "neo-btn-primary"} style={btn} disabled={setManual.isPending}
              onClick={() => setManual.mutate({ tenantId, enabled: !t.manualEnabledAt })} data-testid="sub-manual-toggle">
              {t.manualEnabledAt ? "Отключить" : "Выдать руководство"}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ── Пользователи ──────────────────────────────────────────────────────── */

export function UsersTab({ d, onChanged }: { d: Detail; onChanged: () => void }) {
  const tenantId = d.tenant.id;
  const [loginEdit, setLoginEdit] = useState<{ userId: number; name: string; email: string } | null>(null);
  const [newLogin, setNewLogin] = useState("");
  const [resetPwd, setResetPwd] = useState<{ userId: number; name: string } | null>(null);
  const [newPwd, setNewPwd] = useState("");

  const changeLogin = trpc.tenant.changeUserLogin.useMutation({
    onSuccess: r => { notify.success(r.unchanged ? "Логин не изменился" : `Новый логин: ${r.email}`); setLoginEdit(null); setNewLogin(""); onChanged(); },
    onError: e => notify.error(e.message),
  });
  const resetPassword = trpc.tenant.resetOwnerPassword.useMutation({
    onSuccess: () => { notify.success("Пароль сброшен"); setResetPwd(null); setNewPwd(""); },
    onError: e => notify.error(e.message),
  });

  return (
    <>
      <Panel title="Пользователи" count={d.users.length} flush testId="org-users">
        {d.users.map((u, i) => (
          <div key={u.id} className="flex items-center gap-3 flex-wrap" style={{ padding: "12px 20px", borderTop: i > 0 ? "1px solid var(--color-border-subtle)" : undefined }} data-testid="org-user">
            <span className="flex items-center justify-center flex-shrink-0" style={{ width: 38, height: 38, borderRadius: 12, background: "var(--color-surface-light)", fontWeight: 800, color: "var(--color-text-secondary)" }}>
              {u.name.trim()[0]?.toUpperCase()}
            </span>
            <div className="min-w-0" style={{ flex: "1 1 200px" }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)" }}>{u.name}</span>
                <Pill>{ROLE_LABEL[u.role as keyof typeof ROLE_LABEL]?.ru ?? u.role}</Pill>
                {u.status !== "active" && <Pill tone="danger">отключён</Pill>}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginTop: 2, overflowWrap: "anywhere" }}>
                {u.email} · {u.lastSignInAt ? `вход ${ago(u.lastSignInAt)}` : "не входил"}
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button type="button" className="neo-btn" style={{ minHeight: 44, padding: "0 14px", fontSize: 13 }} title="Сменить логин (почту входа)"
                onClick={() => { setLoginEdit({ userId: u.id, name: u.name, email: u.email }); setNewLogin(""); }} data-testid="user-change-login">
                <AtSign size={15} /> Логин
              </button>
              <button type="button" className="neo-btn" style={{ minHeight: 44, padding: "0 14px", fontSize: 13 }} title="Сбросить пароль"
                onClick={() => setResetPwd({ userId: u.id, name: u.name })} data-testid="user-reset-password">
                <KeyRound size={15} /> Пароль
              </button>
            </div>
          </div>
        ))}
      </Panel>

      <AppModal open={!!loginEdit} onClose={() => { setLoginEdit(null); setNewLogin(""); }} title="Сменить логин"
        subtitle={loginEdit ? `${loginEdit.name} · сейчас ${loginEdit.email}` : undefined} maxWidth={440}
        footer={<>
          <button type="button" className="neo-btn flex-1" style={btn} onClick={() => { setLoginEdit(null); setNewLogin(""); }}>Отмена</button>
          <button type="button" className="neo-btn-primary flex-1" style={btn}
            disabled={!loginEdit || !/^\S+@\S+\.\S+$/.test(newLogin.trim()) || changeLogin.isPending}
            onClick={() => loginEdit && changeLogin.mutate({ tenantId, userId: loginEdit.userId, email: newLogin.trim() })}>
            {changeLogin.isPending ? "…" : "Сменить"}
          </button>
        </>}>
        <FieldLabel htmlFor="new-login">Новая почта для входа</FieldLabel>
        <input id="new-login" type="email" className="neo-input w-full" style={input} placeholder="name@company.uz" value={newLogin} onChange={e => setNewLogin(e.target.value)} />
        <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", margin: "8px 0 0" }}>Пароль остаётся прежним. Человек будет разлогинен и войдёт заново с новой почтой.</p>
      </AppModal>

      <AppModal open={!!resetPwd} onClose={() => { setResetPwd(null); setNewPwd(""); }} title="Сбросить пароль" subtitle={resetPwd?.name} maxWidth={440}
        footer={<>
          <button type="button" className="neo-btn flex-1" style={btn} onClick={() => { setResetPwd(null); setNewPwd(""); }}>Отмена</button>
          <button type="button" className="neo-btn-primary flex-1" style={btn} disabled={newPwd.length < 8 || resetPassword.isPending}
            onClick={() => resetPwd && resetPassword.mutate({ tenantId, userId: resetPwd.userId, newPassword: newPwd })}>
            {resetPassword.isPending ? "…" : "Сохранить"}
          </button>
        </>}>
        <FieldLabel htmlFor="new-pwd">Новый пароль</FieldLabel>
        <input id="new-pwd" type="password" className="neo-input w-full" style={input} placeholder="мин. 8 символов" autoComplete="new-password" value={newPwd} onChange={e => setNewPwd(e.target.value)} />
      </AppModal>
    </>
  );
}

/* ── Права ─────────────────────────────────────────────────────────────── */

/*
  Права оператора — тот же список, что у директора в настройках. Просьба
  «закройте нашему оператору удаление заказов» приходит в поддержку, а не в
  настройки: арендатор о разделе может не знать и пишет владельцу платформы.
*/
export function AccessTab({ d }: { d: Detail }) {
  return (
    <Panel title="Права оператора" testId="org-access">
      <OperatorAccess tenantId={d.tenant.id} />
    </Panel>
  );
}

/* ── Журнал ────────────────────────────────────────────────────────────── */

/*
  Уборка журнала действий. Журнал только растёт и через год у активной
  организации — самая большая таблица после заказов. Ночной работой это не
  сделано намеренно: журнал ведут ради спора, и решение «этих записей больше
  нет» принимает человек — руками, с явным сроком, подтверждением и кодом
  второго фактора.
*/
export function JournalTab({ d }: { d: Detail }) {
  const { confirm, dialog } = useConfirm();
  const [days, setDays] = useState(90);
  const [code, setCode] = useState("");
  const purge = trpc.audit.purge.useMutation({
    onSuccess: r => notify.success(r.deleted > 0 ? `Удалено записей: ${r.deleted}` : `Записей старше ${r.retentionDays} дней нет`),
    onError: e => notify.error(e.message),
  });
  return (
    <>
      {dialog}
      <Card title="Убрать старый журнал" icon={Eraser} testId="org-journal"
        hint={<>Записи действий организации старше указанного срока удаляются безвозвратно. Сам журнал организация видит у себя: «Настройки → Журнал действий» у директора.</>}>
        <div className="grid gap-3 sm:grid-cols-[140px_200px_auto] items-end">
          <div>
            <FieldLabel htmlFor="purge-days">Хранить дней</FieldLabel>
            <input id="purge-days" type="number" min={7} max={3650} value={days} onChange={e => setDays(Number(e.target.value))} className="neo-input w-full" style={input} />
          </div>
          <div>
            <FieldLabel htmlFor="purge-code">Код из приложения</FieldLabel>
            <input id="purge-code" value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" data-testid="purge-totp" className="neo-input w-full" style={input} />
          </div>
          <button type="button" className="neo-btn" style={{ ...btn, color: "var(--color-danger-text)" }} disabled={purge.isPending || code.trim().length < 6 || days < 7}
            data-testid="purge-submit"
            onClick={async () => {
              const ok = await confirm({
                title: `Убрать журнал старше ${days} дней?`,
                message: `Записи действий «${d.tenant.name}» старше ${days} дней будут удалены безвозвратно. Восстановить их будет нечем.`,
                confirmText: "Убрать", danger: true,
              });
              if (ok) { purge.mutate({ tenantId: d.tenant.id, retentionDays: days, totpCode: code.trim() }); setCode(""); }
            }}>
            <Eraser size={15} /> {purge.isPending ? "Убираю…" : "Убрать"}
          </button>
        </div>
        <TotpHint />
      </Card>
    </>
  );
}

/** Без второго фактора сервер откажет — сказать заранее и где его включить. */
function TotpHint() {
  const { user } = useAuth();
  const on = Boolean((user as { totpEnabledAt?: unknown } | null)?.totpEnabledAt);
  if (on) return null;
  return (
    <p data-testid="offboard-totp-hint" style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.6, margin: "12px 0 0" }}>
      Код появится после включения входа с кодом из приложения:{" "}
      <Link to="/settings?section=profile&block=totp" style={{ color: "var(--color-primary-text)", fontWeight: 600 }}>Настройки → Профиль</Link>.
    </p>
  );
}

/* ── Опасная зона ──────────────────────────────────────────────────────── */

/*
  Приостановить и удалить — отдельно от подписки: рядом с «Изменить тариф»
  удаление читалось бы как обратимое. Удаление открывается только у
  приостановленной: первый замок — статус, второй — слово руками, третий —
  код второго фактора. Список «что будет стёрто» — с сервера, не на глаз.
*/
export function DangerTab({ d, onChanged, onGone }: { d: Detail; onChanged: () => void; onGone: () => void }) {
  const t = d.tenant;
  const { confirm, dialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const [code, setCode] = useState("");
  const setStatus = trpc.tenant.setStatus.useMutation({ onSuccess: () => { onChanged(); notify.success("Статус обновлён"); }, onError: e => notify.error(e.message) });
  const preview = trpc.tenant.offboardPreview.useQuery({ tenantId: t.id }, { enabled: open });
  const offboard = trpc.tenant.offboard.useMutation({
    onSuccess: r => { notify.success(`Организация удалена: стёрто ${r.total} строк`); onGone(); },
    onError: e => notify.error(e.message),
  });
  const confirmWord = offboardConfirmWord(t);
  const active = t.status === "active";

  return (
    <div className="flex flex-col gap-4">
      {dialog}
      <section className="neo-card neo-card-static" style={{ padding: 18, borderRadius: 20 }} data-testid="danger-status">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, borderRadius: 11, background: active ? "var(--color-warning-subtle)" : "var(--color-success-subtle)" }}>
            <Power size={17} color={active ? "var(--color-warning-text)" : "var(--color-success-text)"} />
          </span>
          <div className="min-w-0" style={{ flex: "1 1 240px" }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{active ? "Приостановить организацию" : "Организация приостановлена"}</h3>
            <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", margin: "3px 0 0", lineHeight: 1.5 }}>
              {active ? "Все пользователи потеряют доступ. Данные остаются, вернуть можно в любой момент." : "Пользователи не могут войти. Активируйте, чтобы вернуть доступ."}
            </p>
          </div>
          <button type="button" className={active ? "neo-btn" : "neo-btn-primary"} style={{ ...btn, color: active ? "var(--color-warning-text)" : undefined }}
            disabled={setStatus.isPending} data-testid="danger-toggle-status"
            onClick={async () => {
              const next = active ? "suspended" : "active";
              const ok = await confirm({
                title: next === "suspended" ? `Приостановить «${t.name}»?` : `Активировать «${t.name}»?`,
                message: next === "suspended" ? "Все пользователи потеряют доступ." : "Пользователи снова смогут войти.",
                confirmText: next === "suspended" ? "Приостановить" : "Активировать", danger: next === "suspended",
              });
              if (ok) setStatus.mutate({ tenantId: t.id, status: next });
            }}>
            <Power size={15} /> {active ? "Приостановить" : "Активировать"}
          </button>
        </div>
      </section>

      <section className="neo-card neo-card-static" style={{ padding: 18, borderRadius: 20, background: "color-mix(in srgb, var(--color-danger) 6%, var(--color-surface))" }} data-testid="danger-offboard">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, borderRadius: 11, background: "var(--color-danger-subtle)" }}>
            <Trash2 size={17} color="var(--color-danger-text)" />
          </span>
          <div className="min-w-0" style={{ flex: "1 1 240px" }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "var(--color-danger-text)" }}>Удалить безвозвратно</h3>
            <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", margin: "3px 0 0", lineHeight: 1.5 }}>
              Стирает из базы всё, что принадлежит организации: заказы, магазины, сотрудников, остатки, GPS-следы. Обратного пути нет; резервные копии хранят данные до истечения своего срока.
              {active && <b style={{ color: "var(--color-text-primary)" }}> Сначала приостановите организацию.</b>}
            </p>
          </div>
          <button type="button" className="neo-btn" style={{ ...btn, color: "var(--color-danger-text)" }} disabled={active} data-testid="danger-offboard-open"
            onClick={() => { setWord(""); setCode(""); setOpen(true); }}>
            <Trash2 size={15} /> Удалить
          </button>
        </div>
      </section>

      <AppModal open={open} onClose={() => setOpen(false)} title={`Удалить «${t.name}»?`} subtitle="Безвозвратно. Наберите слово и код из приложения-аутентификатора." maxWidth={500}
        footer={<>
          <button type="button" className="neo-btn flex-1" style={btn} onClick={() => setOpen(false)}>Отмена</button>
          <button type="button" className="neo-btn-primary flex-1" style={{ ...btn, background: "var(--color-danger)" }} data-testid="offboard-submit"
            disabled={offboard.isPending || word.trim() !== confirmWord || code.trim().length < 6}
            onClick={() => offboard.mutate({ tenantId: t.id, confirmSlug: word.trim(), totpCode: code.trim() })}>
            {offboard.isPending ? "Удаляю…" : "Удалить безвозвратно"}
          </button>
        </>}>
        <div className="flex flex-col gap-3">
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }} data-testid="offboard-preview">
            {preview.isLoading && "Считаю строки…"}
            {preview.data && (preview.data.total === 0
              ? "В базе нет ни одной строки этой организации, кроме неё самой."
              : <>Будет стёрто <b>{preview.data.total}</b> строк: {Object.entries(preview.data.rows).map(([k, n]) => `${k} — ${n}`).join(", ")}.</>)}
          </div>
          <div>
            <FieldLabel htmlFor="offboard-word">Для подтверждения наберите: <b style={{ color: "var(--color-text-primary)" }}>{confirmWord}</b></FieldLabel>
            <input id="offboard-word" className="neo-input w-full" style={input} value={word} onChange={e => setWord(e.target.value)} autoComplete="off" data-testid="offboard-slug" />
          </div>
          <div>
            <FieldLabel htmlFor="offboard-code">Код из приложения</FieldLabel>
            <input id="offboard-code" className="neo-input w-full" style={input} value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" data-testid="offboard-totp" />
          </div>
          <TotpHint />
        </div>
      </AppModal>
    </div>
  );
}
