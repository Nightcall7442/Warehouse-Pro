import { useMemo } from "react";
import { Link } from "react-router";
import {
  Wallet, TrendingUp, Activity, FlaskConical, PhoneOff, CalendarClock, Inbox, LifeBuoy,
  AlertTriangle, Database, ShieldAlert, Building2, ChevronRight, RefreshCw,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { describeSignupSource } from "@contracts/signup";
import { CallList } from "@/components/superadmin/console/CallList";
import { backupState } from "@/components/superadmin/console/jobs";
import { Count, Group, Line, PageHead, Panel, PlanPill, Row, Tile, type Tone } from "@/components/superadmin/console/ui";
import { STAGE_LABEL, ago, day, money } from "@/components/superadmin/console/format";

/* ═══════════════════════════════════════════════════════════════════════════
   «Обзор» — первый экран консоли платформы (/super-admin).

   С чем владелец открывает консоль каждое утро: сколько платят и сколько
   это в месяц, кто работает, кто замолчал, кому продлевать, где застряли
   пробные, что сломалось за ночь. Каждый пункт ведёт туда, где с ним
   работают: число «Молчат» — в список организаций с этим фильтром, новые
   заявки — в «Заявки», ошибки и копия базы — в «Систему».

   Числа плиток — панель владельца (tenant.ownerPanel, правила в
   api/services/owner-panel.ts); «Пробные» и последние регистрации — список
   организаций (tenant.list), сегменты в нём посчитаны тем же правилом.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function Overview() {
  const panel = trpc.tenant.ownerPanel.useQuery();
  const list = trpc.tenant.list.useQuery();
  const leads = trpc.lead.list.useQuery({ onlyNew: true });
  const inbox = trpc.support.inbox.useQuery(undefined, { refetchInterval: 60_000 });
  const errors = trpc.system.groupedErrors.useQuery({ minutes: 24 * 60 });
  const jobs = trpc.system.jobs.useQuery(undefined, { refetchInterval: 5 * 60_000 });
  const usage = trpc.tenant.featureUsage.useQuery();
  const utils = trpc.useUtils();
  // «Обновить» — как было в шапке прежней страницы: все числа обзора разом.
  const refresh = () => {
    for (const q of [panel, list, leads, inbox, errors, jobs, usage]) void q.refetch();
    void utils.tenant.platformStats.invalidate();
  };

  const p = panel.data;
  const orgs = list.data;
  const trials = orgs?.filter(o => o.segment.trialLive).length ?? 0;
  const trialsExpired = orgs?.filter(o => o.segment.trial && !o.segment.trialLive).length ?? 0;
  const recent = useMemo(
    () => [...(orgs ?? [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 6),
    [orgs],
  );
  const waiting = (inbox.data ?? []).filter(t => t.unread > 0).length;
  const errors24 = (errors.data ?? []).reduce((s, g) => s + g.count, 0);
  const backup = backupState(jobs.data?.jobs);
  const overreach = (usage.data ?? []).filter(r => r.overreach.length > 0).length;
  const stages = p?.funnel.stages ?? [];
  const top = Math.max(1, stages[0]?.reached ?? 1);

  const t = (n: number, warn: Tone = "warning"): Tone => (n > 0 ? warn : "neutral");

  return (
    <div data-testid="owner-panel">
      <PageHead title="Обзор" subtitle="Деньги, клиенты и что требует внимания. Без системной организации и песочниц интеграторов."
        actions={<button type="button" className="neo-btn" onClick={refresh} data-testid="overview-refresh" style={{ minHeight: 44, padding: "0 14px", fontSize: 13 }}><RefreshCw size={15} /> Обновить</button>} />

      {panel.isError ? (
        <p style={{ fontSize: 13, color: "var(--color-danger-text)" }}>Не удалось собрать панель. Обновите страницу.</p>
      ) : (
        <>
          <div className="grid gap-3 md:gap-4 grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" data-testid="overview-tiles">
            <Tile label="Платят сейчас" value={p?.paying.count ?? 0} icon={Wallet} tone="success" loading={panel.isLoading}
              to="/super-admin/orgs?f=paying" testId="tile-paying" />
            <Tile label="MRR по цене тарифа" value={money(p?.paying.mrr ?? 0)} suffix="сум" icon={TrendingUp} tone="primary" loading={panel.isLoading}
              to="/super-admin/orgs?f=paying&sort=plan" testId="tile-mrr" />
            <Tile label="Активны за 7 дней" value={p?.activeLast7 ?? 0} suffix={p ? `из ${p.clients}` : undefined} icon={Activity} tone="info" loading={panel.isLoading}
              to="/super-admin/orgs?sort=activity" testId="tile-active" />
            <Tile label="Пробные" value={trials} icon={FlaskConical} tone="info" loading={list.isLoading}
              hint={trialsExpired > 0 ? `ещё ${trialsExpired} с истёкшим сроком` : undefined}
              to="/super-admin/orgs?f=trial" testId="tile-trials" />
            <Tile label="Молчат 5+ дней" value={p?.silent.length ?? 0} icon={PhoneOff} tone={t(p?.silent.length ?? 0)} loading={panel.isLoading}
              to="/super-admin/orgs?f=silent" testId="tile-silent" />
            <Tile label="Продления в 14 дней" value={p?.renewals.length ?? 0} icon={CalendarClock} tone={t(p?.renewals.length ?? 0)} loading={panel.isLoading}
              to="/super-admin/orgs?f=expiring&sort=ends&dir=asc" testId="tile-renewals" />
          </div>
          {/* Подпись к MRR честная: это прайс, а не деньги на счёте. */}
          <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "10px 4px 0", lineHeight: 1.5 }} data-testid="owner-mrr-note">
            MRR — сумма месячных цен тарифов у платящих, по прайсу: без скидок и без докупленных мест. «Активны» — был заказ или вход.
          </p>

          <div className="grid gap-4 lg:grid-cols-2 items-start" style={{ marginTop: 20 }}>
            {/* ── Требует внимания ─────────────────────────────────────────── */}
            <section data-testid="attention">
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", margin: "0 0 10px 4px" }}>Требует внимания</h2>
              <Group>
                <Row icon={CalendarClock} tone={t(p?.renewals.length ?? 0)} title="Истекают ≤14 дней" subtitle="Оплаченный срок кончается — продлить"
                  right={<Count n={p?.renewals.length ?? "…"} tone={t(p?.renewals.length ?? 0)} />} to="/super-admin/orgs?f=expiring&sort=ends&dir=asc" testId="attn-expiring" />
                <Line />
                <Row icon={PhoneOff} tone={t(p?.silent.length ?? 0)} title="Молчат 5+ дней" subtitle="Ни заказа, ни входа — позвонить"
                  right={<Count n={p?.silent.length ?? "…"} tone={t(p?.silent.length ?? 0)} />} to="/super-admin/orgs?f=silent" testId="attn-silent" />
                <Line />
                <Row icon={Inbox} tone={t(leads.data?.length ?? 0, "primary")} title="Новые заявки с сайта" subtitle="Оставили телефон и ждут звонка"
                  right={<Count n={leads.data?.length ?? "…"} tone={t(leads.data?.length ?? 0, "primary")} />} to="/super-admin/leads" testId="attn-leads" />
                <Line />
                <Row icon={LifeBuoy} tone={t(waiting, "danger")} title="Обращения ждут ответа" subtitle="Непрочитанные сообщения в поддержку"
                  right={<Count n={inbox.data ? waiting : "…"} tone={t(waiting, "danger")} />} to="/super-admin/support" testId="attn-support" />
                <Line />
                <Row icon={AlertTriangle} tone={t(errors24, "danger")} title="Ошибки за сутки" subtitle="Журнал ошибок сервера"
                  right={<Count n={errors.data ? errors24 : "…"} tone={t(errors24, "danger")} />} to="/super-admin/system" testId="attn-errors" />
                <Line />
                <Row icon={Database} tone={jobs.data ? (backup.stale ? "danger" : "success") : "neutral"} title="Резервная копия базы"
                  subtitle={!jobs.data ? "…" : backup.at ? `Последняя удачная — ${day(backup.at)} ${backup.at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}, ${ago(backup.at)}` : "Удачных копий нет"}
                  right={jobs.data && backup.stale ? <Count n="старше 26 ч" tone="danger" testId="attn-backup-stale" /> : undefined}
                  to="/super-admin/system?tab=jobs" testId="attn-backup" />
                <Line />
                <Row icon={ShieldAlert} tone={t(overreach)} title="Пользуются сверх тарифа"
                  subtitle={overreach > 0 ? "Если включить проверку тарифа сейчас, они потеряют это без предупреждения" : "Проверку тарифов можно включать безопасно"}
                  right={<Count n={usage.data ? `${overreach} из ${usage.data.length}` : "…"} tone={t(overreach)} />} to="/super-admin/orgs?f=overreach" testId="attn-overreach" />
              </Group>
            </section>

            {/* ── Воронка пробных ──────────────────────────────────────────── */}
            <section data-testid="owner-funnel">
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", margin: "0 0 10px 4px" }}>Воронка пробных</h2>
              <Group>
                <div style={{ padding: "14px 18px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
                  {stages.map((s, i) => (
                    <div key={s.key} data-testid={`owner-stage-${s.key}`}>
                      <div className="flex items-baseline justify-between gap-3" style={{ marginBottom: 6 }}>
                        <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{i + 1}. {STAGE_LABEL[s.key] ?? s.key}</span>
                        <span style={{ fontSize: 15, fontWeight: 800, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>{s.reached}</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 99, background: "var(--color-surface-light)", boxShadow: "var(--shadow-pressed)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.round((s.reached / top) * 100)}%`, minWidth: s.reached > 0 ? 8 : 0, borderRadius: 99,
                          background: s.key === "paid" ? "var(--color-success)" : "var(--color-primary)" }} />
                      </div>
                    </div>
                  ))}
                  {panel.isLoading && <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: 0 }}>Считаю…</p>}
                </div>
                <Line inset={0} />
                <Link to="/super-admin/orgs?f=trial" className="console-row flex items-center justify-between"
                  style={{ minHeight: 48, padding: "0 18px", fontSize: 13.5, fontWeight: 600, color: "var(--color-primary-text)", textDecoration: "none" }}>
                  Все пробные <ChevronRight size={17} />
                </Link>
              </Group>
            </section>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start" style={{ marginTop: 20 }}>
            {p ? <CallList data={p} /> : <Panel title="Кому позвонить"><p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: 0 }}>Считаю…</p></Panel>}

            <Panel title="Последние регистрации" testId="recent-signups" flush
              action={<Link to="/super-admin/orgs?sort=activity" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-primary-text)", textDecoration: "none", minHeight: 44, display: "inline-flex", alignItems: "center" }}>Все</Link>}>
              {recent.length === 0 && !list.isLoading
                ? <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: 0, padding: "4px 20px 14px" }}>Организаций пока нет.</p>
                : recent.map((o, i) => {
                  const source = describeSignupSource(o.signupSource, "ru");
                  return (
                    <div key={o.id}>
                      {i > 0 && <Line inset={64} />}
                      <Row icon={Building2} tone="primary" title={o.name}
                        subtitle={[day(o.createdAt), o.isSandbox ? "песочница" : null, source].filter(Boolean).join(" · ")}
                        right={<PlanPill plan={o.subscription?.plan ?? o.plan} />} to={`/super-admin/orgs/${o.id}`} />
                    </div>
                  );
                })}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
