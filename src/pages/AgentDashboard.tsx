import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router";
import { getGreeting } from "@/lib/utils";
import { plural } from "@/lib/plural";
import { format } from "date-fns";
import { dateLocale } from "@/lib/date-locale";
import {
  CheckCircle2, Clock, Calendar, MapPin, ArrowRight, ChevronRight, AlertCircle,
  Plus, ShoppingBag, Navigation, Maximize, User, Clipboard, TrendingUp,
} from "lucide-react";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import type { LucideIcon } from "lucide-react";

/*
  «Мой день» — раскладка главной мобилки v8 (Warehouse-Pro-Mobile,
  app/(tabs)/index.tsx). Владелец, 24.09.2026: «PWA точно как мобайл».

  Порядок тот же, что на телефоне: визиты на сегодня → главное действие
  («Новый заказ» жёлтой плиткой) и плитки быстрых переходов → долги
  магазинов → «Мои заказы сегодня» с плашкой выручки. Подписи — обычными
  буквами: КАПС в десять пунктов и был тем, что читалось дёшево.

  Кольца плана здесь больше нет: в мобилке прогресс — счётчик «3 / 8» у
  заголовка визитов, и он читается быстрее кольца.
*/

// ── Статусы визитов ───────────────────────────────────────────────────────────
const PLAN_STATUS: Record<string, { icon: LucideIcon; labelRu: string; labelUz: string; color: string; textColor: string }> = {
  visited: { icon: CheckCircle2, labelRu: "Посещён",      labelUz: "Borildi",          color: "var(--color-success)", textColor: "var(--color-success-text)" },
  skipped: { icon: Clock,        labelRu: "Пропущен",     labelUz: "O'tkazildi",       color: "var(--color-warning)", textColor: "var(--color-warning-text)" },
  planned: { icon: Calendar,     labelRu: "Запланирован", labelUz: "Rejalashtirilgan", color: "var(--color-info)",    textColor: "var(--color-info-text)" },
};

const CARD: React.CSSProperties = { background: "var(--color-surface)", boxShadow: "var(--shadow-raised)" };

// ── Строка визита ─────────────────────────────────────────────────────────────
function PlanRow({ plan, first, onDone, onSkip, isPending }: {
  plan: { id: number; status: string; shopName: string | null; shopDebt: string | null; shopAddress: string | null; shopCity: string | null };
  first: boolean;
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
  const address = [plan.shopAddress, plan.shopCity].filter(Boolean).join(", ");

  return (
    <div
      className="flex items-center gap-3 px-4 py-3.5"
      style={{ borderTop: first ? "none" : "1px solid var(--color-border-subtle)", opacity: plan.status === "visited" ? 0.6 : 1 }}
    >
      <span
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: `color-mix(in srgb, ${s.color} 15%, transparent)` }}
      >
        <Icon size={14} color={s.textColor} />
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <p className="truncate" style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>
            {plan.shopName ?? t("Магазин", "Do'kon")}
          </p>
          {hasDebt && (
            <span
              className="flex items-center gap-1 flex-shrink-0 font-data rounded-full px-2 py-0.5"
              style={{ fontSize: 10, fontWeight: 600, background: "var(--color-danger-subtle)", color: "var(--color-danger-text)" }}
            >
              <AlertCircle size={9} />
              {fmt(plan.shopDebt)}
            </span>
          )}
        </div>
        {address && (
          <p className="truncate" style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>{address}</p>
        )}
      </div>

      {plan.status === "planned" ? (
        <div className="flex gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={onSkip}
            disabled={isPending}
            className="btn-ghost min-w-[44px] min-h-[44px]"
            title={t("Пропустить", "O'tkazib yuborish")}
            aria-label={t("Пропустить", "O'tkazib yuborish")}
          >
            <Clock size={15} />
          </button>
          <button
            type="button"
            onClick={onDone}
            disabled={isPending}
            className="neo-btn-primary min-w-[44px] min-h-[44px] px-3"
            style={{ fontSize: 12 }}
          >
            {t("Готово", "Bajarildi")}
          </button>
        </div>
      ) : (
        <span className="flex-shrink-0" style={{ fontSize: 11, fontWeight: 600, color: s.textColor }}>
          {lang === "uz" ? s.labelUz : s.labelRu}
        </span>
      )}
    </div>
  );
}

/** Заголовок раздела с переходом «→», как SectionTitle мобилки. */
function SectionHead({ icon: Icon, title, badge, onMore, moreLabel }: {
  icon: LucideIcon; title: string; badge?: string; onMore?: () => void; moreLabel: string;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2 min-w-0">
        <Icon size={16} color="var(--color-primary-text)" className="flex-shrink-0" />
        <h2 className="truncate" style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>{title}</h2>
        {badge && (
          <span className="rounded-full px-2 py-0.5 flex-shrink-0" style={{ fontSize: 11, fontWeight: 700, background: "var(--color-primary-subtle)", color: "var(--color-primary-text)" }}>
            {badge}
          </span>
        )}
      </div>
      {onMore && (
        <button type="button" onClick={onMore} className="btn-ghost w-11 h-11 flex-shrink-0" aria-label={moreLabel}>
          <ArrowRight size={16} color="var(--color-text-tertiary)" />
        </button>
      )}
    </div>
  );
}

/** Плитка быстрого перехода: белая карточка, значок на мягкой подложке. */
function Tile({ icon: Icon, label, tint, onClick, big }: {
  icon: LucideIcon; label: string; tint: string; onClick: () => void; big?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 min-w-0 flex flex-col items-center justify-center active:scale-[0.98] transition-transform"
      style={{ ...CARD, borderRadius: big ? 20 : 16, padding: big ? "20px 8px" : "16px 8px", gap: big ? 10 : 8 }}
    >
      <span
        className="flex items-center justify-center"
        style={{ width: big ? 40 : 36, height: big ? 40 : 36, borderRadius: big ? 12 : 10, background: `color-mix(in srgb, ${tint} 12%, transparent)` }}
      >
        <Icon size={big ? 20 : 16} color={tint} />
      </span>
      <span className="max-w-full truncate" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>{label}</span>
    </button>
  );
}

// ── Главная страница ──────────────────────────────────────────────────────────
export default function AgentDashboard() {
  const { user }    = useAuth();
  const { fmt }     = useCurrency();
  const navigate    = useNavigate();
  const { lang }    = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: kpis, isError: kpisFailed, isLoading: kpisLoading } = trpc.dashboard.agentDashboard.useQuery();
  const { data: plans, isLoading, isLoadingError, refetch } = trpc.agent.getPlans.useQuery({});
  const utils                          = trpc.useUtils();

  const updatePlan = trpc.agent.updatePlanStatus.useMutation({
    onSuccess: () => utils.agent.getPlans.invalidate(),
  });

  // Мерчендайзер не продаёт: ни нового заказа, ни сканера, ни выручки — как в мобилке (sells).
  const sells        = user?.role !== "merchandiser";
  const todayVisited = plans?.filter(p => p.status === "visited").length ?? 0;
  const todayPlanned = plans?.length ?? 0;
  const debt         = Number(kpis?.shopsDebt ?? 0);
  const orders       = kpis?.todayOrders ?? 0;

  const greeting  = getGreeting(t);
  const firstName = user?.name?.split(" ")[0] ?? "";

  if (isLoadingError) return <QueryErrorFallback onRetry={refetch} />;

  const sorted = [
    ...(plans?.filter(p => p.status === "planned") ?? []),
    ...(plans?.filter(p => p.status === "visited") ?? []),
    ...(plans?.filter(p => p.status === "skipped") ?? []),
  ];

  return (
    <div className="space-y-5 animate-fade-up">

      {/* ── Шапка ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p style={{ fontSize: 13, fontWeight: 500, color: "var(--color-primary-text)", margin: 0 }}>
            {greeting}{firstName ? `, ${firstName}` : ""}
          </p>
          {/* На телефоне «Мой день» уже написан в шапке приложения — второй раз не повторяем. */}
          <h1 className="hidden md:block font-display" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-text-primary)", margin: "4px 0 0" }}>
            {t("Мой день", "Mening kunim")}
          </h1>
          <p className="capitalize" style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "4px 0 0" }}>
            {format(new Date(), "EEEE, d MMMM", { locale: dateLocale(lang) })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/settings")}
          aria-label={t("Профиль", "Profil")}
          className="flex-shrink-0 flex items-center justify-center rounded-full"
          style={{ width: 44, height: 44, background: "var(--color-primary-subtle)", border: "2px solid var(--color-primary)", color: "var(--color-primary-text)", fontSize: 18, fontWeight: 700 }}
        >
          {(firstName || "?").charAt(0).toUpperCase()}
        </button>
      </div>

      {/* ── Визиты сегодня ── */}
      <section>
        <SectionHead
          icon={MapPin}
          title={t("Визиты сегодня", "Bugungi tashriflar")}
          badge={todayPlanned > 0 ? `${todayVisited} / ${todayPlanned}` : undefined}
          onMore={() => navigate("/agent/plans")}
          moreLabel={t("Все планы", "Barcha rejalar")}
        />
        <div style={{ ...CARD, borderRadius: 20, overflow: "hidden" }}>
          {isLoading ? (
            <div className="p-4 space-y-2.5">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-11 rounded-xl animate-pulse" style={{ background: "var(--color-surface-light)" }} />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-6 text-center">
              <span className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "var(--color-canvas)" }}>
                <MapPin size={20} color="var(--color-text-tertiary)" />
              </span>
              <p style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)", margin: 0 }}>{t("На сегодня визитов нет", "Bugun tashrif yo'q")}</p>
              <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: 0 }}>
                {t("Супервайзер ещё не назначил маршрут", "Supervisor yo'l haritasini hali tayinlamadi")}
              </p>
            </div>
          ) : (
            sorted.map((plan, i) => (
              <PlanRow
                key={plan.id}
                plan={plan}
                first={i === 0}
                isPending={updatePlan.isPending}
                onDone={() => updatePlan.mutate({ planId: plan.id, status: "visited" })}
                onSkip={() => updatePlan.mutate({ planId: plan.id, status: "skipped" })}
              />
            ))
          )}
        </div>
      </section>

      {/* ── Быстрые действия ── */}
      <div className="space-y-3">
        <div className="flex gap-3">
          {sells && (
            <button
              type="button"
              onClick={() => navigate("/orders/new")}
              className="flex-1 min-w-0 flex flex-col items-center justify-center active:scale-[0.98] transition-transform"
              style={{ background: "var(--color-cta)", color: "var(--color-on-cta)", borderRadius: 20, padding: "20px 8px", gap: 10 }}
            >
              <span className="flex items-center justify-center" style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(0,0,0,0.08)" }}>
                <Plus size={22} color="var(--color-on-cta)" />
              </span>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{t("Новый заказ", "Yangi buyurtma")}</span>
            </button>
          )}
          <Tile big icon={ShoppingBag} label={t("Магазины", "Do'konlar")} tint="var(--color-primary-text)" onClick={() => navigate("/agent/shops")} />
        </div>
        <div className="flex gap-3">
          {/* GPS открыт только агенту (RoleGuard /agent/gps) — мерчендайзеру плитку не рисуем. */}
          {user?.role !== "merchandiser" && (
            <Tile icon={Navigation} label="GPS" tint="var(--color-success-text)" onClick={() => navigate("/agent/gps")} />
          )}
          {sells && (
            <Tile icon={Maximize} label={t("Штрих-код", "Shtrix-kod")} tint="var(--color-primary-text)" onClick={() => navigate("/barcode")} />
          )}
          <Tile icon={User} label={t("Профиль", "Profil")} tint="var(--color-info-text)" onClick={() => navigate("/settings")} />
        </div>
      </div>

      {/* ── Долги: к кому ехать собирать ── */}
      {debt > 0 && (
        <button
          type="button"
          onClick={() => navigate("/agent/debts")}
          className="w-full flex items-center gap-3 text-left"
          style={{ ...CARD, borderRadius: 20, padding: 16 }}
        >
          <span className="flex items-center justify-center flex-shrink-0" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--color-danger-subtle)" }}>
            <AlertCircle size={18} color="var(--color-danger-text)" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block" style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", color: "var(--color-danger-text)" }}>{t("ДОЛГИ", "QARZLAR")}</span>
            <span className="block truncate font-data" style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", marginTop: 2 }}>
              {t("Магазины должны", "Do'konlar qarzi")} · {fmt(debt)}
            </span>
          </span>
          <ChevronRight size={16} color="var(--color-text-tertiary)" className="flex-shrink-0" />
        </button>
      )}

      {/* ── Мои заказы сегодня: плашка главной цифры ──
          Сбой связи НЕ рисуется нулём: «0 сум» и «не пришёл ответ» на экране
          выглядят одинаково, и агент решил бы, что день пустой. */}
      {sells && (
        <section>
          <SectionHead
            icon={Clipboard}
            title={t("Мои заказы сегодня", "Bugungi buyurtmalarim")}
            onMore={() => navigate("/orders")}
            moreLabel={t("Мои заказы", "Buyurtmalarim")}
          />
          <div
            className="flex items-center justify-between gap-3"
            style={{ background: "var(--color-hero)", borderRadius: 24, padding: 20, boxShadow: "var(--shadow-lg)" }}
            data-testid="agent-hero"
          >
            <div className="min-w-0">
              <p style={{ fontSize: 13, fontWeight: 500, color: "var(--color-on-hero-soft)", margin: 0 }}>{t("Выручка за сегодня", "Bugungi tushum")}</p>
              {kpisFailed ? (
                <>
                  <p style={{ fontSize: 22, fontWeight: 700, color: "var(--color-on-hero)", margin: "4px 0 0" }}>—</p>
                  <p style={{ fontSize: 13, color: "var(--color-on-hero-soft)", margin: "2px 0 0" }}>{t("Нет связи — обновите страницу", "Aloqa yo'q — sahifani yangilang")}</p>
                </>
              ) : kpisLoading ? (
                <div className="h-8 w-40 mt-1.5 rounded-lg animate-pulse" style={{ background: "color-mix(in srgb, var(--color-on-hero) 14%, transparent)" }} />
              ) : (
                <>
                  <p className="font-data truncate" style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15, color: "var(--color-on-hero)", margin: "4px 0 0" }}>
                    {fmt(kpis?.todayRevenue ?? 0)}
                  </p>
                  <p style={{ fontSize: 13, color: "var(--color-on-hero-soft)", margin: "2px 0 0" }}>
                    {orders === 0
                      ? t("заказов ещё нет", "hali buyurtma yo'q")
                      : t(`${orders} ${plural(orders, "заказ", "заказа", "заказов")}`, `${orders} ta buyurtma`)}
                  </p>
                </>
              )}
            </div>
            <span className="flex items-center justify-center flex-shrink-0" style={{ width: 44, height: 44, borderRadius: 14, background: "color-mix(in srgb, var(--color-on-hero) 12%, transparent)" }}>
              <TrendingUp size={20} color="var(--color-on-hero)" />
            </span>
          </div>
        </section>
      )}

    </div>
  );
}
