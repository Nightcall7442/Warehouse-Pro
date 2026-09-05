import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router";
import { getGreeting } from "@/lib/utils";
import { format } from "date-fns";
import { ru as dateRu } from "date-fns/locale";
import {
  ClipboardList, Store, PlusCircle,
  CheckCircle2, Clock, Calendar, MapPin,
  ChevronRight, AlertCircle, Navigation,
  Wallet,
} from "lucide-react";
import { ProgressRing } from "@/components/ProgressRing";
import { KpiIcon } from "@/components/KpiIcon";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import type { KpiColor } from "@/components/KpiIcon";
import type { LucideIcon } from "lucide-react";

// ── Статусы визитов ───────────────────────────────────────────────────────────
const PLAN_STATUS: Record<string, {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  labelRu: string; labelUz: string;
  dotColor: string; textClass: string;
}> = {
  visited: { icon: CheckCircle2, labelRu: "Посещён",  labelUz: "Borildi",    dotColor: "var(--color-success)", textClass: "text-success" },
  skipped: { icon: Clock,        labelRu: "Пропущен", labelUz: "O'tkazildi", dotColor: "var(--color-warning)", textClass: "text-warning" },
  planned: { icon: Calendar,     labelRu: "Запланирован", labelUz: "Rejalashtirilgan", dotColor: "#60a5fa", textClass: "text-info" },
};

// ── KPI карточка ──────────────────────────────────────────────────────────────
/*
  Карточка сводки. С onTo становится кнопкой и ведёт на свой разбор.

  Долг — единственная цифра здесь, за которой стоит действие: агент едет его
  собирать. Раньше карточка была просто числом, а список долгов лежал в
  отчёте, куда агента не пускают, — то есть увидеть сумму он мог, а понять,
  из чего она сложилась и к кому ехать, нет.
*/
function AgentKpi({ label, value, icon: Icon, color = "indigo", onTo }: {
  label: string; value: string | number;
  icon: LucideIcon;
  color?: KpiColor;
  onTo?: () => void;
}) {
  const body = (
    <>
      <KpiIcon icon={Icon} color={color} />
      <div>
        <p className="font-data text-2xl font-bold leading-none text-primary">
          {value}
        </p>
        <p className="font-label text-[10px] tracking-wider mt-1.5" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
          {label}
        </p>
      </div>
    </>
  );

  if (onTo) {
    return (
      <button
        type="button"
        onClick={onTo}
        className="kpi-hero stagger-children flex flex-col gap-3 hover-lift text-left"
        style={{ width: "100%" }}
      >
        {body}
      </button>
    );
  }

  return (
    <div className="kpi-hero stagger-children flex flex-col gap-3 hover-lift">
      {body}
    </div>
  );
}

// ── Карточка визита ───────────────────────────────────────────────────────────
function PlanCard({ plan, onDone, onSkip, isPending }: {
  plan: { id: number; status: string; shopName: string | null; shopDebt: string | null; shopAddress: string | null; shopCity: string | null };
  onDone: () => void;
  onSkip: () => void;
  isPending: boolean;
}) {
  const { fmt }  = useCurrency();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const s = PLAN_STATUS[plan.status] ?? PLAN_STATUS.planned;
  const Icon = s.icon;
  const hasDebt = Number(plan.shopDebt ?? 0) > 0;

  return (
    <div className={`px-4 py-3.5 flex items-center gap-3 transition-colors ${
      plan.status === "visited" ? "opacity-60" : "hover:bg-surface-light/40"
    }`}>
      {/* Status icon */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: `color-mix(in srgb, ${s.dotColor} 15%, transparent)` }}
      >
        <Icon size={15} className={s.textClass} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-primary truncate">
            {plan.shopName ?? t("Неизвестный магазин", "Noma'lum do'kon")}
          </p>
          {hasDebt && (
            <span
              className="flex items-center gap-1 text-[10px] font-data font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
              style={{ background: "var(--color-danger-subtle, rgba(232,80,80,.10))", color: "var(--color-danger-text)" }}
            >
              <AlertCircle size={9} />
              {fmt(plan.shopDebt)}
            </span>
          )}
        </div>
        {(plan.shopAddress || plan.shopCity) && (
          <div className="flex items-center gap-1 mt-0.5">
            <MapPin size={10} style={{ color: "var(--color-text-tertiary, #6b6760)" }} className="flex-shrink-0" />
            <p className="text-xs truncate" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
              {[plan.shopAddress, plan.shopCity].filter(Boolean).join(", ")}
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      {plan.status === "planned" && (
        <div className="flex gap-1.5 flex-shrink-0">
          <button
            onClick={onSkip}
            disabled={isPending}
            className="btn-ghost py-1 px-2 text-xs min-w-[44px] min-h-[44px] flex items-center justify-center"
            style={{ color: "var(--color-text-secondary, #5e5b54)" }}
            title={t("Пропустить", "O'tkazib yuborish")}
          >
            <Clock size={13} />
          </button>
          <button
            onClick={onDone}
            disabled={isPending}
            className="neo-btn-primary py-1 px-3 text-xs min-w-[44px] min-h-[44px]"
          >
            {t("Готово", "Bajarildi")}
          </button>
        </div>
      )}

      {plan.status === "visited" && (
        <CheckCircle2 size={16} className="text-success flex-shrink-0" />
      )}
      {plan.status === "skipped" && (
        <Clock size={16} className="text-warning flex-shrink-0" />
      )}
    </div>
  );
}

// ── Главная страница ──────────────────────────────────────────────────────────
export default function AgentDashboard() {
  const { user }    = useAuth();
  const { fmt }     = useCurrency();
  const navigate    = useNavigate();
  const { lang }    = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: kpis }                 = trpc.dashboard.agentDashboard.useQuery();
  const { data: plans, isLoading, isLoadingError, refetch } = trpc.agent.getPlans.useQuery({});
  const utils                          = trpc.useUtils();

  const updatePlan = trpc.agent.updatePlanStatus.useMutation({
    onSuccess: () => utils.agent.getPlans.invalidate(),
  });

  const todayVisited = plans?.filter(p => p.status === "visited").length ?? 0;
  const todaySkipped = plans?.filter(p => p.status === "skipped").length ?? 0;
  const todayPlanned = plans?.length ?? 0;
  const pct          = todayPlanned > 0 ? Math.round((todayVisited / todayPlanned) * 100) : 0;
  const progressColor = pct >= 80 ? "var(--color-success)" : pct >= 40 ? "var(--color-warning)" : "var(--color-primary)";

  const greeting = getGreeting(t);

  const firstName = user?.name?.split(" ")[0] ?? "";

  if (isLoadingError) return <QueryErrorFallback onRetry={refetch} />;

  return (
    <div className="space-y-4 animate-fade-up">

      {/* ── Шапка ── */}
      <div className="flex items-start justify-between">
        <div>
          <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-pink, #c06080)", boxShadow: "var(--shadow-xs)" }} />
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-orange, #c49530)", boxShadow: "var(--shadow-xs)" }} />
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-teal, #3a9a8a)", boxShadow: "var(--shadow-xs)" }} />
          </div>
          <p className="text-xs font-medium mb-0.5" style={{ color: "var(--color-primary-text)" }}>
            {greeting}{firstName ? `, ${firstName}` : ""}
          </p>
          <h1 className="font-display text-2xl font-bold text-primary tracking-tight">
            {t("Мой день", "Mening kunim")}
          </h1>
          <p className="text-xs mt-0.5 capitalize" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
            {format(new Date(), "EEEE, d MMMM", { locale: lang === "ru" ? dateRu : undefined })}
          </p>
        </div>
        {/* GPS кнопка */}
        <button
          onClick={() => navigate("/agent/gps")}
          className="neo-btn flex items-center gap-1.5 text-sm py-2"
        >
          <Navigation size={14} />
          GPS
        </button>
      </div>

      {/* ── KPI карточки ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <AgentKpi
          label={t("ЗАКАЗОВ", "BUYURTMA")}
          value={kpis?.todayOrders ?? 0}
          icon={ClipboardList}
          color="orange"
        />
        <AgentKpi
          label={t("ВЫРУЧКА", "TUSHUM")}
          value={fmt(kpis?.todayRevenue ?? 0, true)}
          icon={PlusCircle}
          color="green"
        />
        <AgentKpi
          label={t("МАГАЗИНОВ", "DO'KON")}
          value={kpis?.assignedShops ?? 0}
          icon={Store}
          color="purple"
        />
        {/* Четвёртая карточка — долг закреплённых магазинов.
            Карточек было три, а сетка на телефоне двухколоночная: нижняя
            правая клетка стояла пустой. Заполнено не ради симметрии: долг —
            это то, за чем агент и едет, и до сих пор его приходилось искать
            по карточкам магазинов поодиночке.
            Считается тем же запросом, что и число магазинов (SUM по тем же
            строкам), лишнего обращения к базе не добавилось. */}
        <AgentKpi
          label={t("ДОЛГ МАГАЗИНОВ", "DO'KONLAR QARZI")}
          value={fmt(kpis?.shopsDebt ?? 0, true)}
          icon={Wallet}
          color={Number(kpis?.shopsDebt ?? 0) > 0 ? "red" : "green"}
          onTo={() => navigate("/agent/debts")}
        />
      </div>

      {/* ── Прогресс плана ── */}
      <div className="neo-card p-4">
        <div className="flex items-center justify-between mb-3.5">
          <span className="font-label text-[10px] tracking-wider" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
            {t("ПЛАН ВИЗИТОВ", "TASHRIF REJASI")}
          </span>
          {todaySkipped > 0 && (
            <span className="text-xs font-data" style={{ color: "var(--color-warning-text)" }}>
              {todaySkipped} {t("пропущено", "o'tkazildi")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          <ProgressRing value={pct} color={progressColor} label={`${pct}%`} />
          <div>
            <p className="font-data text-lg font-bold text-primary leading-none">
              {todayVisited} / {todayPlanned}
            </p>
            <p className="text-xs mt-1.5" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
              {todayPlanned === 0
                ? t("На сегодня визитов нет", "Bugun tashrif yo'q")
                : pct === 100
                ? t("Все визиты выполнены", "Barcha tashriflar bajarildi")
                : t(`Осталось ${todayPlanned - todayVisited}`, `${todayPlanned - todayVisited} ta qoldi`)}
            </p>
          </div>
        </div>
      </div>

      {/* ── Быстрые действия ── */}
      <div className="grid grid-cols-2 gap-3">
        {user?.role !== "merchandiser" && (
          <button
            onClick={() => navigate("/orders/new")}
            className="neo-btn-primary py-4 flex flex-col items-center gap-2"
          >
            <PlusCircle size={22} />
            <span className="text-xs font-label tracking-wider">
              {t("НОВЫЙ ЗАКАЗ", "YANGI BUYURTMA")}
            </span>
          </button>
        )}
        <button
          onClick={() => navigate("/agent/shops")}
          className="neo-btn py-4 flex flex-col items-center gap-2"
        >
          <Store size={22} />
          <span className="text-xs font-label tracking-wider">
            {t("МОИ МАГАЗИНЫ", "MENING DO'KONLARIM")}
          </span>
        </button>
      </div>

      {/* ── Список визитов сегодня ── */}
      <div className="neo-card" style={{ padding: "20px" }}>
        {/* Заголовок */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <div>
            <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary, #2b2a28)", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
              <ClipboardList size={16} color="var(--color-primary-text)" />
              {t("Сегодняшние визиты", "Bugungi tashriflar")}
            </h2>
            <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #6b6760)", margin: "3px 0 0" }}>
              {todayPlanned} {t("запланировано", "rejalashtirilgan")}{todaySkipped > 0 ? `, ${todaySkipped} ${t("пропущено", "o'tkazildi")}` : ""}
            </p>
          </div>
          {todayPlanned > 0 && (
            <button
              onClick={() => navigate("/agent/plans")}
              className="flex items-center gap-1 text-xs"
              style={{ color: "var(--color-primary-text)", fontWeight: 600 }}
            >
              {t("Все планы", "Barcha rejalar")}
              <ChevronRight size={12} />
            </button>
          )}
        </div>

        {/* Контент */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-surface-light animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 bg-surface-light animate-pulse rounded w-2/3" />
                  <div className="h-3 bg-surface-light animate-pulse rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : plans?.length === 0 ? (
          <div className="text-center py-12">
            <Calendar size={32} className="mx-auto mb-3 opacity-20 text-secondary" />
            <p className="text-sm text-secondary">
              {t("На сегодня визитов нет", "Bugun tashrif yo'q")}
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
              {t("Супервайзер ещё не назначил маршрут", "Supervisor yo'l haritasini hali tayinlamadi")}
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {/* Сначала запланированные, потом остальные */}
            {[
              ...( plans?.filter(p => p.status === "planned") ?? []),
              ...( plans?.filter(p => p.status === "visited") ?? []),
              ...( plans?.filter(p => p.status === "skipped") ?? []),
            ].map(plan => (
              <div key={plan.id} className="neo-card-sm" style={{ padding: "12px 16px" }}>
                <PlanCard
                  plan={plan}
                  isPending={updatePlan.isPending}
                  onDone={() => updatePlan.mutate({ planId: plan.id, status: "visited" })}
                  onSkip={() => updatePlan.mutate({ planId: plan.id, status: "skipped" })}
                />
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
