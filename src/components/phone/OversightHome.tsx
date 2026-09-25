import { useState } from "react";
import { useNavigate } from "react-router";
import { format } from "date-fns";
import { AlertCircle, TrendingDown, TrendingUp, ChevronRight, PieChart, MapPin, Calendar, ShoppingBag, User, Clipboard } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import {
  ListCard, ListRow, SectionHead, Tile, CtaTile, EmptyState, HomeGreeting, Segmented, Sparkline, Donut,
} from "./kit";
import { CARD, orderTone, orderStatusWord } from "./tones";

/*
  Главная надзорных ролей на телефоне — SupervisorHome мобилки v8
  (Warehouse-Pro-Mobile, app/(tabs)/index.tsx): подсказки → долги магазинов
  → динамика продаж → статусы заказов → быстрые действия («Трекинг» —
  главное действие) → последние заказы.

  Владелец, 25.09.2026: «все сделай абсолютно». Настольная главная директора
  остаётся для большого экрана; на телефоне рисуется эта.

  Запросы те же, что у мобилки и у настольной главной: dashboard.trends /
  statusBreakdown / activity (директор и супервайзер), shop.receivablesAging,
  notification.smartAlerts. Сюда приходят только директор и супервайзер —
  /dashboard закрыт остальным (RoleGuard), оператору сервер эти отчёты не
  отдаёт.
*/
type Range = "7d" | "30d" | "month";

const ALERT_TONE: Record<string, { fill: string; text: string }> = {
  info:    { fill: "var(--color-info)",    text: "var(--color-info-text)" },
  warning: { fill: "var(--color-warning)", text: "var(--color-warning-text)" },
  danger:  { fill: "var(--color-danger)",  text: "var(--color-danger-text)" },
};

export function OversightHome() {
  const navigate = useNavigate();
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const [range, setRange] = useState<Range>("7d");

  const { data: trends } = trpc.dashboard.trends.useQuery({ range });
  const { data: statusData } = trpc.dashboard.statusBreakdown.useQuery();
  const { data: activity } = trpc.dashboard.activity.useQuery();
  const { data: alerts } = trpc.notification.smartAlerts.useQuery({ lang });
  const { data: aging } = trpc.shop.receivablesAging.useQuery(undefined, { retry: false });

  const revenue = (trends ?? []).map(r => Number(r.revenue));
  const ordersCount = (trends ?? []).map(r => Number(r.orderCount));
  const segments = (statusData ?? []).map(s => ({ status: s.status, value: Number(s.count), color: orderTone(s.status).dot }));
  const statusTotal = segments.reduce((a, s) => a + s.value, 0);
  const overdue = aging ? aging.buckets.d31_60 + aging.buckets.d60plus : 0;

  return (
    <div className="space-y-5 animate-fade-up" data-testid="oversight-home">
      <HomeGreeting title={t("Главная", "Bosh sahifa")} />

      {/* ── Подсказки: лента вбок ── */}
      {alerts && alerts.length > 0 && (
        <div className="flex gap-2 overflow-x-auto -mx-5 px-5 pb-1" style={{ scrollbarWidth: "none" }}>
          {alerts.slice(0, 4).map((a, i) => {
            const tone = ALERT_TONE[a.severity] ?? ALERT_TONE.info;
            const Icon = a.severity === "danger" ? AlertCircle : a.severity === "warning" ? TrendingDown : TrendingUp;
            return (
              <div key={i} className="flex items-center gap-2.5 flex-shrink-0" style={{ ...CARD, borderRadius: 20, padding: 14, minWidth: 220, maxWidth: 280, borderLeft: `3px solid ${tone.fill}` }}>
                <span className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `color-mix(in srgb, ${tone.fill} 14%, transparent)` }}>
                  <Icon size={14} color={tone.text} />
                </span>
                <div className="min-w-0">
                  <p className="truncate" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>{a.title}</p>
                  <p className="line-clamp-2" style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>{a.message}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Долги магазинов — выше графиков: это «что делать сегодня» ── */}
      {aging && aging.totalDebt > 0 && (
        <button type="button" onClick={() => navigate("/reports?tab=debts")} className="w-full text-left" style={{ ...CARD, borderRadius: 24, padding: 20 }} data-testid="oversight-debts">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle size={16} color="var(--color-warning-text)" />
            <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>{t("Долги магазинов", "Do'konlar qarzi")}</span>
            <span className="flex-1" />
            <ChevronRight size={18} color="var(--color-text-tertiary)" />
          </div>
          <div className="flex items-end gap-5">
            <div className="flex-1 min-w-0">
              <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: 0 }}>{t("всего", "jami")}</p>
              <p className="font-data truncate" style={{ fontSize: 17, fontWeight: 800, color: "var(--color-text-primary)", margin: 0 }}>{fmt(aging.totalDebt)}</p>
            </div>
            <div className="flex-1 min-w-0">
              <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: 0 }}>{t("магазинов", "do'kon")}</p>
              <p className="font-data" style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>{aging.debtorCount}</p>
            </div>
          </div>
          {overdue > 0 && (
            <p className="flex items-center gap-1.5" style={{ fontSize: 13, fontWeight: 500, color: "var(--color-danger-text)", margin: "10px 0 0" }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-danger)" }} />
              {t("старше месяца", "bir oydan eski")}: {fmt(overdue)}
            </p>
          )}
        </button>
      )}

      {/* ── Динамика продаж ── */}
      <section style={{ ...CARD, borderRadius: 24, padding: 20 }}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>{t("Динамика продаж", "Sotuvlar dinamikasi")}</h2>
            <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>{t("Выручка и заказы", "Tushum va buyurtmalar")}</p>
          </div>
          <Segmented<Range>
            value={range}
            onChange={setRange}
            options={[{ key: "7d", label: t("7д", "7 k") }, { key: "30d", label: t("30д", "30 k") }, { key: "month", label: t("Месяц", "Oy") }]}
          />
        </div>
        <div className="mb-3"><Sparkline data={revenue} height={50} /></div>
        <Sparkline data={ordersCount} height={40} color="var(--color-success-text)" />
        <div className="flex justify-center gap-5 mt-3">
          {[[t("Выручка", "Tushum"), "var(--color-primary-text)"], [t("Заказы", "Buyurtmalar"), "var(--color-success-text)"]].map(([label, c]) => (
            <span key={label} className="flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-tertiary)" }}>
              <span className="w-2 h-2 rounded-full" style={{ background: c }} />{label}
            </span>
          ))}
        </div>
      </section>

      {/* ── Статусы заказов (только открытые) ── */}
      <section style={{ ...CARD, borderRadius: 24, padding: 20 }}>
        <div className="flex items-center gap-2 mb-4">
          <PieChart size={16} color="var(--color-primary-text)" />
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>{t("Статусы заказов", "Buyurtma holatlari")}</h2>
        </div>
        <div className="flex items-center gap-5">
          <Donut segments={segments} center={String(statusTotal)} sub={t("заказов", "buyurtma")} />
          <div className="flex-1 min-w-0 space-y-2">
            {segments.length === 0 && <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: 0 }}>{t("Открытых заказов нет", "Ochiq buyurtma yo'q")}</p>}
            {segments.map(s => (
              <div key={s.status} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0" style={{ background: s.color }} />
                <span className="flex-1 truncate" style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)" }}>{orderStatusWord(s.status, lang)}</span>
                <span className="font-data" style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-primary)" }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Быстрые действия: без «нового заказа» — это работа агента ── */}
      <div className="space-y-3">
        <div className="flex gap-3">
          <CtaTile icon={MapPin} label={t("Трекинг", "Kuzatuv")} onClick={() => navigate("/supervisor")} testId="oversight-tracking" />
          <Tile big icon={Calendar} label={t("Планы", "Rejalar")} tint="var(--color-primary-text)" onClick={() => navigate("/supervisor/plans")} />
        </div>
        <div className="flex gap-3">
          <Tile icon={ShoppingBag} label={t("Магазины", "Do'konlar")} tint="var(--color-primary-text)" onClick={() => navigate("/shops")} />
          <Tile icon={User} label={t("Профиль", "Profil")} tint="var(--color-info-text)" onClick={() => navigate("/settings")} />
        </div>
      </div>

      {/* ── Последние заказы ── */}
      <section>
        <SectionHead
          icon={Clipboard}
          title={t("Последние заказы", "So'nggi buyurtmalar")}
          aside={<span className="flex-shrink-0" style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-tertiary)" }}>{activity?.length ?? 0} {t("заказов", "ta buyurtma")}</span>}
        />
        <ListCard>
          {!activity?.length ? (
            <EmptyState icon={Clipboard} title={t("Заказов пока нет", "Hali buyurtma yo'q")} />
          ) : activity.slice(0, 10).map((o, i) => (
            <ListRow key={o.id} first={i === 0} onClick={() => navigate(`/orders/${o.id}`)}>
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: orderTone(o.status).dot }} title={orderStatusWord(o.status, lang)} />
              <div className="flex-1 min-w-0">
                <p className="truncate" style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>{o.shopName ?? o.agentName ?? "—"}</p>
                <p className="truncate" style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>
                  {o.orderNumber}{o.agentName ? ` · ${o.agentName}` : ""}{o.createdAt ? ` · ${format(new Date(o.createdAt), "HH:mm")}` : ""}
                </p>
              </div>
              <span className="font-data flex-shrink-0" style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)" }}>{fmt(o.total)}</span>
            </ListRow>
          ))}
        </ListCard>
      </section>
    </div>
  );
}
