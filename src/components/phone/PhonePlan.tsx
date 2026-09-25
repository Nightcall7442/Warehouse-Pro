import { useNavigate } from "react-router";
import { format } from "date-fns";
import { Calendar, Check, CheckCircle2, ChevronRight, Circle, Clock, DollarSign, MapPin, ShoppingCart, AlertCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { dateLocale } from "@/lib/date-locale";
import { Donut, ProgressBar, EmptyState, StatusPill } from "./kit";
import { CARD } from "./tones";

/*
  «План» на телефоне — экран мобилки v8 (Warehouse-Pro-Mobile,
  app/(tabs)/plan.tsx): норма месяца, визиты на сегодня с полосой, карточки
  визитов «Отложить / Готово», долги магазинов маршрута и показатели месяца
  с зарплатой. Владелец, 25.09.2026: «все сделай абсолютно».

  «Готово» у мерчендайзера — не отметка, а отчёт о визите (фото полки,
  чек-лист): кнопка ведёт на него, как в мобилке.
*/
const tone = (pct: number) => pct >= 100 ? "var(--color-success-text)" : pct >= 70 ? "var(--color-warning-text)" : "var(--color-danger-text)";
const fill = (pct: number) => pct >= 100 ? "var(--color-success)" : pct >= 70 ? "var(--color-warning)" : "var(--color-danger)";

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ ...CARD, borderRadius: 24, padding: 20 }}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-tertiary)" }}>{title}</span>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Bar({ label, pct, color, width = 64 }: { label: string; pct: number; color: string; width?: number }) {
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <span className="truncate flex-shrink-0" style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-tertiary)", width }}>{label}</span>
      <div className="flex-1"><ProgressBar value={pct} height={6} color={color} /></div>
      <span className="font-data text-right flex-shrink-0" style={{ fontSize: 11, fontWeight: 700, color, width: 34 }}>{Math.round(pct)}%</span>
    </div>
  );
}

/** Норма месяца — QuotaCard мобилки; её же показывает профиль полевых ролей. */
export function QuotaCard() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { data: quota, isLoading } = trpc.salesTarget.myQuota.useQuery(undefined, { retry: false });
  if (isLoading) return <div className="h-40 rounded-3xl animate-pulse" style={{ background: "var(--color-surface-light)" }} />;
  if (!quota) return null;
  const overall = Math.round(quota.revenue.pct * 0.5 + quota.orders.pct * 0.3 + quota.visits.pct * 0.2);
  const metrics: Array<{ icon: LucideIcon; label: string; actual: string; target: string; pct: number }> = [
    { icon: DollarSign, label: t("Выручка", "Tushum"), actual: `${(quota.revenue.actual / 1000).toFixed(0)}K`, target: `${(quota.revenue.target / 1000).toFixed(0)}K`, pct: quota.revenue.pct },
    { icon: ShoppingCart, label: t("Заказы", "Buyurtmalar"), actual: String(quota.orders.actual), target: String(quota.orders.target), pct: quota.orders.pct },
    { icon: MapPin, label: t("Визиты", "Tashriflar"), actual: `${Math.round(quota.visits.actual)}%`, target: `${Math.round(quota.visits.target)}%`, pct: quota.visits.pct },
  ];
  return (
    <Section title={t("План месяца", "Oylik reja")} aside={<span className="font-data" style={{ fontSize: 14, fontWeight: 700, color: tone(overall) }}>{overall}%</span>}>
      <div className="flex items-center gap-5 mb-3">
        <Donut size={64} stroke={6} segments={[{ value: Math.min(100, overall), color: fill(overall) }, { value: Math.max(0, 100 - overall), color: "transparent" }]} center={`${overall}%`} />
        <div className="flex-1 flex gap-2">
          {metrics.map(m => (
            <div key={m.label} className="flex-1 flex flex-col items-center">
              <m.icon size={14} color={tone(m.pct)} />
              <span className="font-data" style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)", marginTop: 2 }}>{m.actual}</span>
              <span className="font-data" style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>/{m.target}</span>
            </div>
          ))}
        </div>
      </div>
      {metrics.map(m => <Bar key={m.label} label={m.label} pct={Math.min(100, m.pct)} color={fill(m.pct)} />)}
    </Section>
  );
}

function KpiCard() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const navigate = useNavigate();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { data: kpi, isLoading } = trpc.kpi.agentKpi.useQuery({ period: "month" }, { retry: false });
  // Зарплата — своей ручкой: агентский KPI её не содержит. Нет настройки — строки нет.
  const { data: salary } = trpc.kpi.salary.useQuery({ period: "month" }, { retry: false });
  if (isLoading) return <div className="h-32 rounded-3xl animate-pulse" style={{ background: "var(--color-surface-light)" }} />;
  if (!kpi) return null;
  const GRADE: Record<string, string> = { A: "var(--color-success-text)", B: "var(--color-info-text)", C: "var(--color-warning-text)", D: "var(--color-danger-text)", F: "var(--color-danger-text)" };
  const gradeColor = GRADE[kpi.kpiGrade] ?? "var(--color-text-tertiary)";
  const rows = [
    { label: `${t("Визиты", "Tashriflar")} (30%)`, pct: kpi.visitCompletionRate, color: "var(--color-primary)" },
    { label: `${t("Выручка", "Tushum")} (25%)`, pct: Math.min(100, (kpi.revenue / 10_000_000) * 100), color: "var(--color-info)" },
    { label: `${t("Конверсия", "Konversiya")} (20%)`, pct: kpi.orderCount > 0 && kpi.totalPlans > 0 ? Math.min(100, (kpi.orderCount / kpi.totalPlans) * 100) : 0, color: "var(--color-warning)" },
    { label: `${t("Без возвратов", "Qaytarishsiz")} (15%)`, pct: Math.max(0, 100 - kpi.returnRate), color: "var(--color-success)" },
    { label: `${t("Долги", "Qarz")} (10%)`, pct: kpi.debtCollectionRate, color: "var(--color-danger)" },
  ];
  const total = salary && typeof salary === "object" && "totalSalary" in salary ? Number(salary.totalSalary) : null;
  return (
    <Section
      title={t("Показатели", "Ko'rsatkichlar")}
      aside={
        <span className="flex items-center gap-1.5">
          <span className="flex items-center justify-center" style={{ width: 28, height: 28, borderRadius: 8, background: `color-mix(in srgb, ${gradeColor} 14%, transparent)`, color: gradeColor, fontSize: 14, fontWeight: 800 }}>{kpi.kpiGrade}</span>
          <span className="font-data" style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>{kpi.kpiScore}/100</span>
        </span>
      }
    >
      {rows.map(r => <Bar key={r.label} label={r.label} pct={r.pct} color={r.color} width={124} />)}
      {total != null && (
        <button type="button" onClick={() => navigate("/agent/kpi")} className="w-full flex items-center justify-between mt-3 pt-3" style={{ borderTop: "1px solid var(--color-border-subtle)" }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)" }}>{t("Зарплата", "Oylik")}</span>
          <span className="flex items-center gap-1.5">
            <span className="font-data" style={{ fontSize: 17, fontWeight: 800, color: "var(--color-text-primary)" }}>{fmt(total)}</span>
            <ChevronRight size={16} color="var(--color-text-tertiary)" />
          </span>
        </button>
      )}
    </Section>
  );
}

export function PhonePlan() {
  const { lang } = useLang();
  const { user } = useAuth();
  const { fmt } = useCurrency();
  const navigate = useNavigate();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const isMerch = user?.role === "merchandiser";
  const utils = trpc.useUtils();

  const today = format(new Date(), "yyyy-MM-dd");
  const { data: plans, isLoading, isError, refetch } = trpc.agent.getPlans.useQuery({ date: today });
  const update = trpc.agent.updatePlanStatus.useMutation({
    onSuccess: () => { utils.agent.getPlans.invalidate(); utils.salesTarget.myQuota.invalidate(); },
    // Отметка не должна пропадать молча: агент жмёт ещё раз и бросает.
    onError: e => notify.error(t(`Отметка не сохранена: ${e.message}`, `Belgi saqlanmadi: ${e.message}`)),
  });

  const visited = plans?.filter(p => p.status === "visited").length ?? 0;
  const total = plans?.length ?? 0;
  const pct = total > 0 ? Math.round((visited / total) * 100) : 0;
  const debtShops = (plans ?? []).filter(p => Number(p.shopDebt ?? 0) > 0);
  const totalDebt = debtShops.reduce((s, p) => s + Number(p.shopDebt ?? 0), 0);

  const done = (p: NonNullable<typeof plans>[number]) => {
    if (isMerch) {
      navigate(`/agent/visit/${p.id}?shopId=${p.shopId ?? ""}&shopName=${encodeURIComponent(p.shopName ?? "")}`);
      return;
    }
    update.mutate({ planId: p.id, status: "visited" });
  };

  return (
    <div className="space-y-4 animate-fade-up" data-testid="phone-plan">
      <p className="capitalize" style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>
        {format(new Date(), "LLLL yyyy", { locale: dateLocale(lang) })}
      </p>

      <QuotaCard />

      {/* ── Визиты на сегодня ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-tertiary)" }}>{t("Визиты на сегодня", "Bugungi tashriflar")}</span>
          <span className="font-data" style={{ fontSize: 13, fontWeight: 700, color: pct >= 80 ? "var(--color-success-text)" : "var(--color-primary-text)" }}>{visited}/{total} · {pct}%</span>
        </div>
        <ProgressBar value={pct} height={6} color={pct >= 80 ? "var(--color-success)" : "var(--color-primary)"} />
      </div>

      <div className="space-y-2">
        {isLoading ? [0, 1, 2].map(i => <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: "var(--color-surface-light)" }} />)
          : isError ? (
            <div style={{ ...CARD, borderRadius: 20 }}>
              <EmptyState icon={AlertCircle} title={t("Не удалось загрузить план", "Rejani yuklab bo'lmadi")} hint={t("Это сбой связи, а не пустой день", "Bu aloqa xatosi, bo'sh kun emas")} />
              <div className="flex justify-center pb-5"><button type="button" onClick={() => refetch()} className="neo-btn-primary">{t("Повторить", "Qayta urinish")}</button></div>
            </div>
          ) : !plans?.length ? (
            <div style={{ ...CARD, borderRadius: 20 }}>
              <EmptyState icon={Calendar} title={t("На сегодня визитов нет", "Bugun tashrif yo'q")} hint={t("Планы визитов появятся здесь", "Tashrif rejalari shu yerda chiqadi")} />
            </div>
          ) : plans.map(p => {
            const meta = p.status === "visited"
              ? { icon: CheckCircle2, fill: "var(--color-success)", text: "var(--color-success-text)", label: t("Посещён", "Tashrif qilindi") }
              : p.status === "skipped"
              ? { icon: Clock, fill: "var(--color-warning)", text: "var(--color-warning-text)", label: t("Пропущен", "O'tkazildi") }
              : { icon: Circle, fill: "var(--color-info)", text: "var(--color-info-text)", label: t("Запланирован", "Rejalangan") };
            const hasDebt = Number(p.shopDebt ?? 0) > 0;
            const busy = update.isPending && update.variables?.planId === p.id;
            return (
              <div key={p.id} className="flex items-center gap-2.5" style={{ ...CARD, borderRadius: 16, padding: 12, opacity: p.status === "visited" ? 0.6 : 1 }} data-testid="phone-plan-visit">
                <span className="flex items-center justify-center flex-shrink-0 rounded-full" style={{ width: 36, height: 36, background: `color-mix(in srgb, ${meta.fill} 14%, transparent)` }}>
                  <meta.icon size={16} color={meta.text} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="truncate" style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>{p.shopName ?? t("Магазин", "Do'kon")}</p>
                  <p className="truncate" style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "1px 0 0" }}>{p.shopAddress ?? t("Адрес не указан", "Manzil ko'rsatilmagan")}</p>
                  {hasDebt && <p className="font-data" style={{ fontSize: 11, fontWeight: 500, color: "var(--color-danger-text)", margin: "2px 0 0" }}>{t("Долг", "Qarz")}: {fmt(p.shopDebt)}</p>}
                </div>
                {p.status === "planned" ? (
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button type="button" disabled={busy} onClick={() => update.mutate({ planId: p.id, status: "skipped" })}
                      className="flex items-center gap-1 rounded-lg" style={{ minHeight: 36, padding: "6px 10px", background: "var(--color-surface-light)", color: "var(--color-warning-text)", fontSize: 11, fontWeight: 600 }}>
                      <Clock size={14} />{t("Отложить", "Keyinga")}
                    </button>
                    <button type="button" disabled={busy} onClick={() => done(p)}
                      className="flex items-center gap-1 rounded-lg" style={{ minHeight: 36, padding: "6px 12px", background: "var(--color-success-text)", color: "var(--color-surface)", fontSize: 11, fontWeight: 600 }}>
                      <Check size={14} />{t("Готово", "Tayyor")}
                    </button>
                  </div>
                ) : (
                  <StatusPill dot={meta.fill} text={meta.text} label={meta.label} />
                )}
              </div>
            );
          })}
      </div>

      {/* ── Долги магазинов маршрута ── */}
      <Section
        title={t("Долги", "Qarzlar")}
        aside={debtShops.length > 0
          ? <span className="font-data" style={{ fontSize: 13, fontWeight: 700, color: "var(--color-danger-text)" }}>{t(`${debtShops.length} маг.`, `${debtShops.length} ta do'kon`)} · {fmt(totalDebt)}</span>
          : <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-success-text)" }}>{t("Нет долгов", "Qarz yo'q")}</span>}
      >
        {debtShops.length > 0 ? debtShops.slice(0, 5).map((p, i) => (
          <div key={p.id} className="flex items-center justify-between py-2" style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-border-subtle)" }}>
            <span className="truncate" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>{p.shopName ?? t("Магазин", "Do'kon")}</span>
            <span className="font-data flex-shrink-0" style={{ fontSize: 13, fontWeight: 700, color: "var(--color-danger-text)" }}>{fmt(p.shopDebt)}</span>
          </div>
        )) : (
          <p className="flex items-center gap-2" style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: 0 }}>
            <CheckCircle2 size={16} color="var(--color-success-text)" />{t("Все магазины без задолженности", "Hech bir do'konda qarz yo'q")}
          </p>
        )}
      </Section>

      <KpiCard />
    </div>
  );
}
