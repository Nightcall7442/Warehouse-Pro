import { useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router";
import { plural } from "@/lib/plural";
import { format } from "date-fns";
import {
  CheckCircle2, Clock, Calendar, MapPin, ChevronRight, AlertCircle, Wallet,
  Plus, ShoppingBag, Navigation, Maximize, User, Clipboard, TrendingUp,
} from "lucide-react";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import {
  ListCard, ListRow, SectionHead, Tile, CtaTile, EmptyState, RowsSkeleton, HomeGreeting, Sparkline, StatusDot,
} from "@/components/phone/kit";
import { CARD, orderTone, orderStatusWord } from "@/components/phone/tones";
import type { LucideIcon } from "lucide-react";

/*
  «Мой день» — раскладка главной мобилки v8 (Warehouse-Pro-Mobile,
  app/(tabs)/index.tsx, AgentHome). Владелец, 24–25.09.2026: «PWA точно как
  мобайл», «все сделай абсолютно».

  Порядок тот же, что на телефоне: визиты на сегодня → динамика продаж за
  неделю → главное действие («Новый заказ» жёлтой плиткой) и плитки
  быстрых переходов → долги магазинов → «Мои заказы сегодня»: плашка
  выручки и сами заказы. Подписи — обычными буквами.
*/

// ── Статусы визитов ───────────────────────────────────────────────────────────
const PLAN_STATUS: Record<string, { icon: LucideIcon; labelRu: string; labelUz: string; color: string; textColor: string }> = {
  visited: { icon: CheckCircle2, labelRu: "Посещён",      labelUz: "Borildi",          color: "var(--color-success)", textColor: "var(--color-success-text)" },
  skipped: { icon: Clock,        labelRu: "Пропущен",     labelUz: "O'tkazildi",       color: "var(--color-warning)", textColor: "var(--color-warning-text)" },
  planned: { icon: Calendar,     labelRu: "Запланирован", labelUz: "Rejalashtirilgan", color: "var(--color-info)",    textColor: "var(--color-info-text)" },
};

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
    <ListRow first={first} dim={plan.status === "visited"}>
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
    </ListRow>
  );
}

// ── Главная страница ──────────────────────────────────────────────────────────
export default function AgentDashboard() {
  const { user }    = useAuth();
  const { fmt }     = useCurrency();
  const navigate    = useNavigate();
  const { lang }    = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  // Мерчендайзер не продаёт: ни нового заказа, ни сканера, ни выручки — как в мобилке (sells).
  const sells = user?.role !== "merchandiser";

  const { data: kpis, isError: kpisFailed, isLoading: kpisLoading } = trpc.dashboard.agentDashboard.useQuery();
  const { data: plans, isLoading, isLoadingError, refetch } = trpc.agent.getPlans.useQuery({});
  const { data: trend } = trpc.dashboard.revenueTrend.useQuery({ days: 7 }, { enabled: sells, retry: false });
  const { data: mine, isLoading: mineLoading, isError: mineFailed } = trpc.order.myOrders.useQuery(undefined, { enabled: sells, retry: false });
  /*
    Долги — тем же запросом, что и страница /agent/debts: число на входе и
    список за ним считаются по одному основанию (заказы этого агента,
    orders.agent_id). Здесь стоял kpis.shopsDebt — долг магазинов,
    ЗАКРЕПЛЁННЫХ за агентом, — обычно ноль, и карточка с ним пряталась
    совсем. На планшете и ноутбуке другого входа в «Мои долги» нет (профиль
    с ним — только на телефоне), и «Принять оплату» становилось недоступно.
  */
  // Мерчендайзер денег не собирает — ни запроса, ни карточки (как sells в мобилке).
  const { data: myDebts } = trpc.agent.myDebts.useQuery(undefined, { enabled: sells, retry: false });
  const utils                          = trpc.useUtils();

  const updatePlan = trpc.agent.updatePlanStatus.useMutation({
    onSuccess: () => utils.agent.getPlans.invalidate(),
  });

  const todayVisited = plans?.filter(p => p.status === "visited").length ?? 0;
  const todayPlanned = plans?.length ?? 0;
  // undefined — ответа ещё нет или связь сбоила: суммы не рисуем, ноль бы соврал.
  const debt         = myDebts?.reduce((s, d) => s + Number(d.remaining), 0);
  const orders       = kpis?.todayOrders ?? 0;

  // «Мои заказы сегодня» — именно сегодня и не больше пяти, как в мобилке: это
  // витрина, а итог дня считает сервер (плашка выше списка).
  const todayOrders = useMemo(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    return (mine?.data ?? []).filter(o => o.createdAt && format(new Date(o.createdAt), "yyyy-MM-dd") === today).slice(0, 5);
  }, [mine]);

  if (isLoadingError) return <QueryErrorFallback onRetry={refetch} />;

  const sorted = [
    ...(plans?.filter(p => p.status === "planned") ?? []),
    ...(plans?.filter(p => p.status === "visited") ?? []),
    ...(plans?.filter(p => p.status === "skipped") ?? []),
  ];

  return (
    <div className="space-y-5 animate-fade-up">

      <HomeGreeting title={t("Мой день", "Mening kunim")} />

      {/* ── Визиты сегодня ── */}
      <section>
        <SectionHead
          icon={MapPin}
          title={t("Визиты сегодня", "Bugungi tashriflar")}
          badge={todayPlanned > 0 ? `${todayVisited} / ${todayPlanned}` : undefined}
          onMore={() => navigate("/agent/plans")}
          moreLabel={t("Все планы", "Barcha rejalar")}
        />
        <ListCard>
          {isLoading ? <RowsSkeleton /> : sorted.length === 0 ? (
            <EmptyState icon={MapPin} title={t("На сегодня визитов нет", "Bugun tashrif yo'q")} hint={t("Супервайзер ещё не назначил маршрут", "Supervisor yo'l haritasini hali tayinlamadi")} />
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
        </ListCard>
      </section>

      {/* ── Динамика продаж: выручка за неделю ── */}
      {sells && (
        <section style={{ ...CARD, borderRadius: 24, padding: 20 }} data-testid="agent-trend">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>{t("Динамика продаж", "Sotuvlar dinamikasi")}</h2>
              <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "3px 0 0" }}>{t("Выручка за 7 дней", "7 kunlik tushum")}</p>
            </div>
          </div>
          <Sparkline data={(trend ?? []).map(Number)} height={60} />
        </section>
      )}

      {/* ── Быстрые действия ── */}
      <div className="space-y-3">
        <div className="flex gap-3">
          {sells && <CtaTile icon={Plus} label={t("Новый заказ", "Yangi buyurtma")} onClick={() => navigate("/orders/new")} testId="agent-new-order" />}
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

      {/* ── Мои долги: к кому ехать собирать. Вход есть всегда, и при нуле.
          Пока ответа нет или связь сбоила — нейтрально: красный говорит «есть
          долги», а этого мы ещё не знаем. ── */}
      {sells && (
      <button
        type="button"
        onClick={() => navigate("/agent/debts")}
        className="w-full flex items-center gap-3 text-left"
        style={{ ...CARD, borderRadius: 20, padding: 16 }}
        data-testid="agent-debts-entry"
      >
        <span className="flex items-center justify-center flex-shrink-0" style={{ width: 40, height: 40, borderRadius: 12, background: debt === undefined ? "var(--color-surface-light)" : debt === 0 ? "var(--color-success-subtle)" : "var(--color-danger-subtle)" }}>
          {debt === undefined ? <Wallet size={18} color="var(--color-text-tertiary)" />
            : debt === 0 ? <CheckCircle2 size={18} color="var(--color-success-text)" /> : <AlertCircle size={18} color="var(--color-danger-text)" />}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block" style={{ fontSize: 12, fontWeight: 600, color: debt === undefined ? "var(--color-text-secondary)" : debt === 0 ? "var(--color-success-text)" : "var(--color-danger-text)" }}>{t("Мои долги", "Mening qarzlarim")}</span>
          <span className="block truncate font-data" style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", marginTop: 2 }}>
            {debt === undefined
              ? t("Кому идти собирать деньги", "Kimdan pul yig'ish kerak")
              : debt > 0
                ? `${t("Магазины должны", "Do'konlar qarzi")} · ${fmt(debt)}`
                : t("Долгов нет", "Qarz yo'q")}
          </span>
        </span>
        <ChevronRight size={16} color="var(--color-text-tertiary)" className="flex-shrink-0" />
      </button>
      )}

      {/* ── Мои заказы сегодня: плашка главной цифры и сами заказы ──
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
            className="flex items-center justify-between gap-3 mb-3"
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

          <ListCard>
            {mineLoading ? <RowsSkeleton /> : todayOrders.length === 0 ? (
              <EmptyState
                icon={Clipboard}
                title={mineFailed
                  ? t("Не удалось загрузить заказы — это сбой связи", "Buyurtmalar yuklanmadi — aloqa uzildi")
                  : (mine?.data.length ?? 0) > 0 ? t("Сегодня заказов ещё нет", "Bugun hali buyurtma yo'q") : t("Создайте первый заказ", "Birinchi buyurtmani yarating")}
              />
            ) : todayOrders.map((o, i) => {
              const tone = orderTone(o.status);
              return (
                <ListRow key={o.id} first={i === 0} onClick={() => navigate(`/orders/${o.id}`)} testId="agent-today-order">
                  <div className="flex-1 min-w-0">
                    <p className="truncate" style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>{o.shopName ?? o.orderNumber}</p>
                    <div style={{ marginTop: 2 }}><StatusDot dot={tone.dot} text="var(--color-text-tertiary)" label={orderStatusWord(o.status, lang)} /></div>
                  </div>
                  <span className="font-data flex-shrink-0" style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)" }}>{fmt(o.total)}</span>
                </ListRow>
              );
            })}
          </ListCard>
        </section>
      )}

    </div>
  );
}
