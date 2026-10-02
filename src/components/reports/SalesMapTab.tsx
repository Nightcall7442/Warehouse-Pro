import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { addDays, format } from "date-fns";
import { CalendarPlus, Crosshair, ExternalLink, FileDown, MapPinOff, Route, Store, TrendingDown, Wallet } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUrlState, urlNumber } from "@/hooks/useUrlState";
import { exportToExcel } from "@/lib/excel";
import { notify } from "@/lib/toast";
import { canOperate } from "@/lib/permissions";
import { PremiumSelect } from "@/components/PremiumSelect";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { AppModal, modalFieldLabel } from "@/components/ui/AppModal";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import {
  areaReasonText, areaStatusLabel, areaTitle, shopStateLabel, SALES_MAP_RULES,
  type SalesArea, type SalesAreaStatus, type SalesShopState, type SilentShop,
} from "@contracts/sales-map";
import { lightColorLabel, lightReasonText } from "@contracts/shop-light";
import { isNoOrderReason, noOrderReasonText } from "@contracts/no-order-reason";
import { PeriodControls, ReportTile } from "./ReportPeriod";
import { dmy, useReportPeriod } from "./report-period";
import { SalesMapView } from "./SalesMapView";

/*
  «Карта» — раздел «Отчётов»: где покупают, где пусто, куда отправить агента.

  Сверху — карта: магазин кружком, размер — выручка за период, цвет — что с
  ним (заказывает / перестал / не заказывает). Ниже — ради чего раздел
  открывают: районы по порядку «куда ехать первым» с причиной словами и
  действием рядом (показать на карте, открыть магазины района, поставить
  визиты агенту), замолчавшие магазины со светофором и последней причиной
  «без заказа», магазины без координат — со ссылкой туда, где их ставят.

  Правила — contracts/sales-map.ts, деньги — по правилу выручки отчётов
  (services/sales-map.ts). Период, агент и территория — в адресе:
  ?tab=map&from=…&to=…&agent=…&territory=… открывается тем же.

  Визиты ставит agent.createPlans — тот же пакетный вызов, что у планов
  супервайзера; открыт директору и супервайзеру, офису кнопки нет.
*/

const STATUS_TONE: Record<SalesAreaStatus, { fg: string; bg: string }> = {
  send: { fg: "var(--color-danger-text)", bg: "var(--color-danger-subtle)" },
  watch: { fg: "var(--color-warning-text)", bg: "var(--color-warning-subtle)" },
  ok: { fg: "var(--color-success-text)", bg: "var(--color-success-subtle)" },
};
const STATE_DOT: Record<SalesShopState, string> = {
  buying: "var(--color-success)",
  silent: "var(--color-danger)",
  idle: "var(--color-text-tertiary)",
};
const LIGHT_DOT = { red: "var(--color-danger)", yellow: "var(--color-warning)", green: "var(--color-success)" } as const;

/** Поставить в план до стольких магазинов за раз — потолок agent.createPlans. */
const PLAN_MAX = 500;

const plainMoney = (n: number) => Math.round(n).toLocaleString("ru-RU");
const pctSigned = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`;
/** Изменение для столбца: от удвоения — «×52,5», а не «+5147%». */
const changeLabel = (v: number) => (v >= 100 ? `×${String(Math.round((100 + v) / 10) / 10).replace(".", ",")}` : pctSigned(v));
/** Число с валютой одной строкой: перенос между «7 522 700» и «сум» рвал сумму на телефоне. */
const nb = (s: string) => s.replace(/ /g, "\u00a0");

interface PlanTarget { title: string; agentId: number | null; silentIds: number[]; idleIds: number[] }

function StatusChip({ status, lang }: { status: SalesAreaStatus; lang: string }) {
  const tone = STATUS_TONE[status];
  return (
    <span className="inline-flex items-center gap-1.5" style={{ padding: "3px 10px", borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
      {status === "send" && <Route size={13} aria-hidden />}
      {areaStatusLabel(status, lang)}
    </span>
  );
}

function ActionBtn({ onClick, to, icon, label, testid }: { onClick?: () => void; to?: string; icon: React.ReactNode; label: string; testid?: string }) {
  const style: React.CSSProperties = { minHeight: 44, padding: "0 12px", gap: 6, fontSize: 13, whiteSpace: "nowrap" };
  return to
    ? <Link to={to} className="neo-btn tap" style={style} data-testid={testid}>{icon}{label}</Link>
    : <button type="button" onClick={onClick} className="neo-btn tap" style={style} data-testid={testid}>{icon}{label}</button>;
}

function ChangeText({ pct }: { pct: number | null }) {
  return (
    <div className="font-data" style={{ fontWeight: 700, whiteSpace: "nowrap", color: pct == null ? COLORS.textTertiary : pct < 0 ? "var(--color-danger-text)" : "var(--color-success-text)" }}>
      {pct == null ? "—" : changeLabel(pct)}
    </div>
  );
}

function SilentName({ s, lang }: { s: SilentShop; lang: string }) {
  return (
    <span className="flex items-start gap-2 min-w-0">
      <span aria-hidden title={s.light ? lightColorLabel(s.light.color, lang) : undefined}
        style={{ width: 10, height: 10, borderRadius: 999, background: s.light ? LIGHT_DOT[s.light.color] : STATE_DOT.silent, flexShrink: 0, marginTop: 5 }} />
      <span className="min-w-0">
        <span style={{ fontWeight: 600, color: COLORS.textPrimary }}>{s.name}</span>
        {s.agentName && <span style={{ color: COLORS.textTertiary, fontSize: 12 }}> · {s.agentName}</span>}
      </span>
    </span>
  );
}

/** «Магазины района» — список «Магазинов» с тем же отбором; у квартала сетки списка нет. */
function areaShopsLink(a: SalesArea): string | null {
  if (a.kind === "territory" && a.territoryId != null) return `/shops?view=list&territory=${a.territoryId}`;
  if (a.kind === "district" && a.district) {
    const q = new URLSearchParams({ view: "list", district: a.district });
    if (a.city) q.set("city", a.city);
    return `/shops?${q.toString()}`;
  }
  return null;
}

function PlanVisitsModal({ target, onClose, t }: { target: PlanTarget; onClose: () => void; t: (ru: string, uz: string) => string }) {
  const { data: agents } = trpc.agent.listAgents.useQuery();
  const [agentId, setAgentId] = useState(target.agentId != null ? String(target.agentId) : "");
  const [day, setDay] = useState(() => format(addDays(new Date(), 1), "yyyy-MM-dd"));
  const [withIdle, setWithIdle] = useState(target.silentIds.length === 0);
  const ids = [...target.silentIds, ...(withIdle ? target.idleIds : [])];
  const send = ids.slice(0, PLAN_MAX);
  const m = trpc.agent.createPlans.useMutation({
    onSuccess: res => {
      notify.success(res.skipped > 0
        ? t(`Визиты поставлены: ${res.created}, уже стояли в плане: ${res.skipped}`, `Tashriflar qo'yildi: ${res.created}, rejada bor edi: ${res.skipped}`)
        : t(`Визиты поставлены: ${res.created}`, `Tashriflar qo'yildi: ${res.created}`));
      onClose();
    },
    onError: e => notify.error(e.message),
  });
  const agentOptions = [
    { value: "", label: t("Выберите агента", "Agentni tanlang") },
    ...(agents ?? []).map(a => ({ value: String(a.id), label: a.name ?? `#${a.id}` })),
  ];
  return (
    <AppModal open onClose={onClose} title={t("Поставить визиты", "Tashrif rejalashtirish")} subtitle={target.title} maxWidth={480}
      footer={(
        <div className="flex gap-3 justify-end w-full">
          <button type="button" className="neo-btn tap" style={{ minHeight: 44, padding: "0 16px" }} onClick={onClose}>{t("Отмена", "Bekor")}</button>
          <button type="button" className="neo-btn neo-btn-primary tap" style={{ minHeight: 44, padding: "0 16px" }} data-testid="sales-map-plan-save"
            disabled={!agentId || send.length === 0 || !day || m.isPending}
            onClick={() => m.mutate({ agentId: Number(agentId), shopIds: send, planDate: day, notes: t("Карта продаж: вернуть магазин", "Savdo xaritasi: do'konni qaytarish") })}>
            {t(`Поставить визиты: ${send.length}`, `Tashriflarni qo'yish: ${send.length}`)}
          </button>
        </div>
      )}>
      <div className="space-y-4">
        <div>
          <span className={modalFieldLabel}>{t("Агент", "Agent")}</span>
          <PremiumSelect value={agentId} onChange={setAgentId} options={agentOptions} aria-label={t("Агент", "Agent")} />
        </div>
        <label className="block">
          <span className={modalFieldLabel}>{t("День визита", "Tashrif kuni")}</span>
          <input type="date" className="neo-input w-full" value={day} min={format(new Date(), "yyyy-MM-dd")} onChange={e => setDay(e.target.value)} style={{ minHeight: 44 }} />
        </label>
        <div style={{ fontSize: 14, color: COLORS.textPrimary }}>
          {target.silentIds.length > 0 && (
            <p style={{ margin: "0 0 8px" }}>{t(`Перестали заказывать: ${target.silentIds.length}`, `Buyurtmani to'xtatganlar: ${target.silentIds.length}`)}</p>
          )}
          {target.idleIds.length > 0 && (
            <label className="flex items-center gap-3" style={{ minHeight: 44 }}>
              <input type="checkbox" checked={withIdle} onChange={e => setWithIdle(e.target.checked)} style={{ width: 20, height: 20 }} />
              {t(`И те, кто не заказывает: ${target.idleIds.length}`, `Buyurtma bermaydiganlar ham: ${target.idleIds.length}`)}
            </label>
          )}
          {ids.length > PLAN_MAX && (
            <p style={{ fontSize: 12, color: "var(--color-warning-text)", margin: "8px 0 0" }}>
              {t(`За раз — не больше ${PLAN_MAX}; поставятся первые ${PLAN_MAX}`, `Bir martada ${PLAN_MAX} tadan ko'p emas; birinchi ${PLAN_MAX} tasi qo'yiladi`)}
            </p>
          )}
          <p style={{ fontSize: 12, color: COLORS.textTertiary, margin: "8px 0 0" }}>
            {t("Уже стоящие у агента на этот день пропускаются.", "Agentda shu kunga bor tashriflar o'tkazib yuboriladi.")}
          </p>
        </div>
      </div>
    </AppModal>
  );
}

export function SalesMapTab() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { user } = useAuth();
  // agent.createPlans — supervisorQuery: директор и супервайзер.
  const canPlan = user?.role === "ceo" || user?.role === "supervisor";
  // Координаты правит карточка магазина — shop.update, operatorQuery: директор и офис.
  const canFixGps = canOperate(user?.role);
  const { fmt } = useCurrency();
  const phone = useIsMobile();
  const period = useReportPeriod();
  const { from, to } = period;
  const [agentId, setAgentId] = useUrlState("agent", undefined, urlNumber);
  const [territoryId, setTerritoryId] = useUrlState("territory", undefined, urlNumber);

  const q = trpc.reports.salesMap.useQuery({ from, to, agentId, territoryId });
  const { data: agents } = trpc.agent.listAgents.useQuery();
  const { data: territories } = trpc.territory.list.useQuery();
  const r = q.data;

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ key: number; bounds: [[number, number], [number, number]] } | null>(null);
  const [plan, setPlan] = useState<PlanTarget | null>(null);
  const [areasShown, setAreasShown] = useState(phone ? 8 : 20);
  const [silentShown, setSilentShown] = useState(phone ? 6 : 12);
  const mapBox = useRef<HTMLDivElement>(null);

  const areaByKey = useMemo(() => new Map((r?.areas ?? []).map(a => [a.key, a])), [r]);
  const titleOf = (key: string) => { const a = areaByKey.get(key); return a ? areaTitle(a, lang) : "—"; };
  const selected = r && selectedId != null ? r.points.find(p => p.id === selectedId) ?? null : null;
  const selectedSilent = r && selectedId != null ? r.silent.find(s => s.id === selectedId) ?? null : null;
  const money = (n: number) => (phone ? fmt(n, true) : fmt(n));

  const agentOptions = useMemo(() => [
    { value: "", label: t("Все агенты", "Barcha agentlar") },
    ...(agents ?? []).map(a => ({ value: String(a.id), label: a.name ?? `#${a.id}` })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [agents, lang]);
  const territoryOptions = useMemo(() => [
    { value: "", label: t("Все территории", "Barcha hududlar") },
    ...(territories ?? []).map(x => ({ value: String(x.id), label: x.name })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [territories, lang]);

  const showOnMap = (a: SalesArea) => {
    if (!a.bounds) return;
    setFocus(f => ({ key: (f?.key ?? 0) + 1, bounds: a.bounds! }));
    mapBox.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  /** «На карте» у магазина: выбрать его и подвести карту к нему. */
  const showShop = (id: number) => {
    const p = r?.points.find(x => x.id === id);
    setSelectedId(id);
    if (p) setFocus(f => ({ key: (f?.key ?? 0) + 1, bounds: [[p.lat, p.lng], [p.lat, p.lng]] }));
    mapBox.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const planArea = (a: SalesArea) => setPlan({ title: areaTitle(a, lang), agentId: a.suggestedAgentId, silentIds: a.silentShopIds, idleIds: a.idleShopIds });
  const planShop = (s: { id: number; name: string; agentId: number | null }) => setPlan({ title: s.name, agentId: s.agentId, silentIds: [s.id], idleIds: [] });

  const exportAreas = () => {
    if (!r) return;
    const kindRu: Record<SalesArea["kind"], string> = { territory: "Территория", district: "Район из карточки", grid: "Квартал по координатам", none: "—" };
    void exportToExcel(r.areas.map((a, i) => ({
      "№": i + 1,
      "Район": areaTitle(a, "ru"),
      "Вид": kindRu[a.kind],
      "Агенты": a.agents.map(x => x.name).join(", "),
      "Магазинов": a.shops,
      "Заказывают": a.buying,
      "Перестали заказывать": a.silent,
      "Не заказывают": a.idle,
      "Без координат": a.noGps,
      "Выручка": a.revenue,
      "Прошлый период": a.prevRevenue,
      "Изменение, %": a.changePct ?? "",
      "Что делать": areaStatusLabel(a.status, "ru"),
      "Почему": a.reasons.map(x => areaReasonText(x, "ru", plainMoney)).join("; "),
    })), `karta-rayony-${r.from}_${r.to}`, "Районы",
    `Карта продаж: районы ${dmy(r.from)} — ${dmy(r.to)} (прошлый период ${dmy(r.prevFrom)} — ${dmy(r.prevTo)})`);
  };
  const exportSilent = () => {
    if (!r) return;
    void exportToExcel(r.silent.map((s, i) => ({
      "№": i + 1,
      "Магазин": s.name,
      "Район": areaByKey.get(s.areaKey) ? areaTitle(areaByKey.get(s.areaKey)!, "ru") : "",
      "Агент": s.agentName ?? "",
      "Выручка в прошлом периоде": s.prevRevenue,
      "Последний заказ": s.lastOrderDay ? dmy(s.lastOrderDay) : "",
      "Светофор": s.light ? lightColorLabel(s.light.color, "ru") : "",
      "Почему": s.light ? s.light.reasons.map(x => lightReasonText(x, "ru", plainMoney)).join("; ") : "",
      "Последний визит без заказа": s.lastNoOrder
        ? `${noOrderReasonText(isNoOrderReason(s.lastNoOrder.reason) ? s.lastNoOrder.reason : null, s.lastNoOrder.note, "ru")} (${dmy(s.lastNoOrder.date)})` : "",
    })), `karta-perestali-${r.from}_${r.to}`, "Перестали заказывать",
    `Перестали заказывать ${dmy(r.from)} — ${dmy(r.to)}: за ${SALES_MAP_RULES.SILENT_LOOKBACK_DAYS} дней до периода заказывали, в периоде — нет`);
  };

  /* Части строки района и магазина — общие для таблицы и карточек телефона. */
  const areaPeople = (a: SalesArea) => (
    <div style={{ fontSize: 12, color: a.agents.length ? COLORS.textTertiary : "var(--color-warning-text)", marginTop: 2 }}>
      {a.agents.length
        ? a.agents.slice(0, 2).map(x => x.name).join(", ") + (a.agents.length > 2 ? ` +${a.agents.length - 2}` : "")
        : t("Агент не закреплён", "Agent biriktirilmagan")}
      {phone && (
        <span style={{ display: "block", color: COLORS.textTertiary }}>
          {nb(t(`Магазинов ${a.shops}:`, `Do'konlar ${a.shops}:`))} {nb(t(`заказывают ${a.buying},`, `buyurtma beradi ${a.buying},`))} {nb(t(`перестали ${a.silent},`, `to'xtatgan ${a.silent},`))} {nb(t(`не заказывают ${a.idle}`, `bermaydi ${a.idle}`))}
        </span>
      )}
    </div>
  );
  const areaReasons = (a: SalesArea) => a.reasons.map((x, i) => (
    <div key={i} style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 4 }}>{areaReasonText(x, lang, n => nb(fmt(n)))}</div>
  ));
  const areaActions = (a: SalesArea) => {
    const link = areaShopsLink(a);
    const canPlanHere = canPlan && a.silentShopIds.length + a.idleShopIds.length > 0;
    if (!a.bounds && !link && !canPlanHere) return null;
    return (
      <div className="flex flex-wrap gap-2" style={{ marginTop: 10 }}>
        {a.bounds && <ActionBtn onClick={() => showOnMap(a)} icon={<Crosshair size={15} aria-hidden />} label={t("На карте", "Xaritada")} />}
        {link && <ActionBtn to={link} icon={<Store size={15} aria-hidden />} label={t("Магазины", "Do'konlar")} />}
        {canPlanHere && <ActionBtn onClick={() => planArea(a)} icon={<CalendarPlus size={15} aria-hidden />} label={t("Визиты", "Tashriflar")} testid="sales-map-plan-area" />}
      </div>
    );
  };
  const silentActions = (s: SilentShop) => (
    <>
      {s.hasGps && <ActionBtn onClick={() => showShop(s.id)} icon={<Crosshair size={15} aria-hidden />} label={t("На карте", "Xaritada")} />}
      <ActionBtn to={`/shops/${s.id}`} icon={<ExternalLink size={15} aria-hidden />} label={t("Открыть", "Ochish")} />
      {canPlan && <ActionBtn onClick={() => planShop(s)} icon={<CalendarPlus size={15} aria-hidden />} label={t("Визит", "Tashrif")} />}
    </>
  );

  const silentLine = (s: SilentShop) => (
    <>
      {s.light && s.light.reasons.length > 0 && (
        <span style={{ display: "block", fontSize: 12, color: COLORS.textTertiary }}>{s.light.reasons.map(x => lightReasonText(x, lang, n => nb(fmt(n)))).join(" · ")}</span>
      )}
      {s.lastNoOrder && (
        <span style={{ display: "block", fontSize: 12, color: COLORS.textTertiary }}>
          {t("Визит без заказа", "Buyurtmasiz tashrif")} {dmy(s.lastNoOrder.date)}: {noOrderReasonText(isNoOrderReason(s.lastNoOrder.reason) ? s.lastNoOrder.reason : null, s.lastNoOrder.note, lang)}
        </span>
      )}
    </>
  );

  return (
    <div className="space-y-4" data-testid="sales-map-report">
      {/* ── Фильтры ── */}
      <div className="neo-card report-filters" style={{ padding: 16 }}>
        <div className="flex flex-wrap items-end gap-3">
          <PeriodControls period={period} t={t} testid="sales-map" />
          <div style={{ flex: "1 1 180px", maxWidth: phone ? undefined : 240, minWidth: 0 }}>
            <PremiumSelect value={agentId != null ? String(agentId) : ""} onChange={v => { setAgentId(v ? Number(v) : undefined); setSelectedId(null); }}
              options={agentOptions} aria-label={t("Агент", "Agent")} />
          </div>
          <div style={{ flex: "1 1 180px", maxWidth: phone ? undefined : 240, minWidth: 0 }}>
            <PremiumSelect value={territoryId != null ? String(territoryId) : ""} onChange={v => { setTerritoryId(v ? Number(v) : undefined); setSelectedId(null); }}
              options={territoryOptions} aria-label={t("Территория", "Hudud")} />
          </div>
        </div>
      </div>

      {q.isError ? <QueryErrorFallback onRetry={() => void q.refetch()} /> : !r ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map(i => <div key={i} className="rounded-3xl animate-pulse" style={{ height: 112, background: "var(--color-surface-light)" }} />)}
          </div>
          <div className="rounded-3xl animate-pulse" style={{ height: phone ? 340 : 460, background: "var(--color-surface-light)" }} />
        </div>
      ) : r.totals.shops === 0 ? (
        <div className="neo-card text-center" style={{ padding: 40, color: COLORS.textSecondary, fontSize: 14 }}>
          {agentId != null || territoryId != null
            ? t("Под этот отбор не попал ни один магазин", "Bu tanlovga birorta ham do'kon tushmadi")
            : t("В справочнике пока нет магазинов", "Ma'lumotnomada hali do'konlar yo'q")}
        </div>
      ) : (
        <>
          {/* ── Итоги ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="sales-map-totals">
            <ReportTile testid="sales-map-tile-revenue" label={t("Выручка за период", "Davr tushumi")} value={money(r.totals.revenue)}
              icon={<Wallet size={phone ? 16 : 18} aria-hidden />} tone="var(--color-primary)"
              sub={r.totals.changePct != null
                ? t(`${pctSigned(r.totals.changePct)} к прошлому периоду`, `o'tgan davrga ${pctSigned(r.totals.changePct)}`)
                : t("в прошлом периоде продаж не было", "o'tgan davrda sotuv bo'lmagan")} />
            <ReportTile testid="sales-map-tile-buying" label={t("Заказывают", "Buyurtma beradi")} value={`${r.totals.buying} / ${r.totals.shops}`}
              icon={<Store size={phone ? 16 : 18} aria-hidden />} tone="var(--color-success)"
              sub={t(`не заказывают ${r.totals.idle}`, `buyurtma bermaydi: ${r.totals.idle}`)} />
            <ReportTile testid="sales-map-tile-silent" label={t("Перестали заказывать", "To'xtatganlar")} value={String(r.totals.silent)}
              icon={<TrendingDown size={phone ? 16 : 18} aria-hidden />} tone="var(--color-danger)"
              sub={r.totals.silentLost > 0
                ? t(`в прошлом периоде дали ${money(r.totals.silentLost)}`, `o'tgan davrda ${money(r.totals.silentLost)} bergan`)
                : t(`заказывали за ${SALES_MAP_RULES.SILENT_LOOKBACK_DAYS} дн. до периода`, `davrdan oldingi ${SALES_MAP_RULES.SILENT_LOOKBACK_DAYS} kunda buyurtma bergan`)} />
            <ReportTile testid="sales-map-tile-nogps" label={t("Без координат", "Koordinatasiz")} value={String(r.totals.noGps)}
              icon={<MapPinOff size={phone ? 16 : 18} aria-hidden />} tone="var(--color-warning)"
              sub={r.totals.noGps > 0 ? t("на карте их нет — список ниже", "xaritada yo'q — ro'yxat pastda") : t("все магазины на карте", "barcha do'konlar xaritada")} />
          </div>

          {/* ── Карта ── */}
          <section ref={mapBox} className="neo-card" style={{ padding: 0, overflow: "hidden", scrollMarginTop: 80 }}>
            <SalesMapView points={r.points} fitKey={`${from}|${to}|${agentId ?? ""}|${territoryId ?? ""}`} focus={focus}
              selectedId={selectedId} onSelect={setSelectedId} phone={phone} height={phone ? 340 : "clamp(380px, 56vh, 560px)"} t={t} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2" style={{ padding: "12px 16px", fontSize: 12, color: COLORS.textSecondary }} data-testid="sales-map-legend">
              {(["buying", "silent", "idle"] as const).map(s => (
                <span key={s} className="inline-flex items-center gap-2" style={{ whiteSpace: "nowrap" }}>
                  <span aria-hidden style={{ width: s === "buying" ? 14 : s === "silent" ? 12 : 8, height: s === "buying" ? 14 : s === "silent" ? 12 : 8, borderRadius: 999, background: `color-mix(in srgb, ${STATE_DOT[s]} ${s === "silent" ? 16 : 45}%, transparent)`, border: s === "idle" ? undefined : `2px solid ${STATE_DOT[s]}` }} />
                  {shopStateLabel(s, lang)}
                </span>
              ))}
              <span style={{ color: COLORS.textTertiary }}>{t("Размер кружка — выручка за период", "Doira kattaligi — davr tushumi")}</span>
              {r.points.length === 0 && (
                <span style={{ color: "var(--color-warning-text)", fontWeight: 600 }}>{t("Ни у одного магазина нет координат", "Birorta do'konda koordinata yo'q")}</span>
              )}
            </div>
            {selected && (
              <div className="flex flex-wrap items-start justify-between gap-3" style={{ padding: "14px 16px", borderTop: `1px solid ${COLORS.border}` }} data-testid="sales-map-selected">
                <div className="min-w-0" style={{ flex: "1 1 260px" }}>
                  <div className="flex items-center gap-2">
                    <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: STATE_DOT[selected.state], flexShrink: 0 }} />
                    <span style={{ fontFamily: F.display, fontWeight: 700, fontSize: 15, color: COLORS.textPrimary }}>{selected.name}</span>
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.textTertiary, marginTop: 4 }}>
                    {shopStateLabel(selected.state, lang)} · {titleOf(selected.areaKey)}{selected.agentName ? ` · ${selected.agentName}` : ""}
                  </div>
                  <div className="font-data" style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 6 }}>
                    <span style={{ whiteSpace: "nowrap" }}>{t("За период", "Davrda")}: <b style={{ color: COLORS.textPrimary }}>{fmt(selected.revenue)}</b></span>
                    {" · "}
                    <span style={{ whiteSpace: "nowrap" }}>{t("до него", "undan oldin")}: {fmt(selected.prevRevenue)}</span>
                    {selected.lastOrderDay && <>{" · "}<span style={{ whiteSpace: "nowrap" }}>{t("последний заказ", "oxirgi buyurtma")} {dmy(selected.lastOrderDay)}</span></>}
                  </div>
                  {selectedSilent && silentLine(selectedSilent)}
                </div>
                <div className="flex flex-wrap gap-2">
                  <ActionBtn to={`/shops/${selected.id}`} icon={<ExternalLink size={15} aria-hidden />} label={t("Открыть", "Ochish")} />
                  {canPlan && <ActionBtn onClick={() => planShop(selected)} icon={<CalendarPlus size={15} aria-hidden />} label={t("Визит", "Tashrif")} />}
                </div>
              </div>
            )}
          </section>

          {/* ── Куда отправить агента ── */}
          <section style={{ background: COLORS.surface, borderRadius: 24, boxShadow: "var(--shadow-raised)", overflow: "hidden" }} data-testid="sales-map-areas">
            <div className="flex flex-wrap items-center justify-between gap-3" style={{ padding: "16px 16px 8px" }}>
              <div className="min-w-0">
                <h3 style={{ fontFamily: F.display, fontSize: 16, fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>{t("Куда отправить агента", "Agentni qayerga yuborish")}</h3>
                <p style={{ fontSize: 12, color: COLORS.textTertiary, margin: "4px 0 0" }}>
                  {t(`Сначала районы, где деньги уходят. Прошлый период — с ${dmy(r.prevFrom)} по ${dmy(r.prevTo)}.`, `Avval pul ketayotgan hududlar. O'tgan davr — ${dmy(r.prevFrom)} dan ${dmy(r.prevTo)} gacha.`)}
                </p>
              </div>
              <button type="button" onClick={exportAreas} disabled={r.areas.length === 0} className="neo-btn tap disabled:opacity-40" style={{ minHeight: 44, padding: "0 16px", gap: 7 }}>
                <FileDown size={15} aria-hidden />Excel
              </button>
            </div>
            {phone ? (
              <div data-testid="sales-map-areas-table">
                {r.areas.slice(0, areasShown).map(a => (
                  <div key={a.key} data-testid="sales-map-area" data-status={a.status} style={{ padding: "14px 16px", borderTop: `1px solid ${COLORS.border}` }}>
                    <div className="flex items-center justify-between gap-3">
                      <StatusChip status={a.status} lang={lang} />
                      <ChangeText pct={a.changePct} />
                    </div>
                    <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 15, color: COLORS.textPrimary, marginTop: 8 }}>{areaTitle(a, lang)}</div>
                    {areaPeople(a)}
                    <div className="flex flex-wrap items-baseline gap-x-2" style={{ marginTop: 6 }}>
                      <span className="font-data" style={{ fontWeight: 700, fontSize: 15, whiteSpace: "nowrap", color: COLORS.textPrimary }}>{fmt(a.revenue)}</span>
                      <span style={{ fontSize: 12, color: COLORS.textTertiary, whiteSpace: "nowrap" }}>{t(`до периода ${fmt(a.prevRevenue)}`, `davrdan oldin ${fmt(a.prevRevenue)}`)}</span>
                    </div>
                    {areaReasons(a)}
                    {areaActions(a)}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }} data-testid="sales-map-areas-table">
                  <thead><tr>
                    {[t("РАЙОН", "HUDUD"), t("МАГАЗИНЫ", "DO'KONLAR"), t("ВЫРУЧКА", "TUSHUM"), t("К ПРОШЛОМУ", "O'TGANGA"), t("ЧТО ДЕЛАТЬ", "NIMA QILISH")].map((h, i) => (
                      <th key={i} style={{ ...thStyle, textAlign: i === 2 || i === 3 ? "right" : "left" }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {r.areas.slice(0, areasShown).map(a => (
                      <tr key={a.key} data-testid="sales-map-area" data-status={a.status}>
                        <td style={{ ...tdStyle, verticalAlign: "top" }}>
                          <div style={{ fontWeight: 700 }}>{areaTitle(a, lang)}</div>
                          {areaPeople(a)}
                        </td>
                        <td style={{ ...tdStyle, verticalAlign: "top" }}>
                          <div className="font-data" style={{ fontWeight: 700 }}>{a.shops}</div>
                          <div style={{ fontSize: 12, color: COLORS.textTertiary, whiteSpace: "nowrap" }} title={t("заказывают · перестали · не заказывают", "buyurtma beradi · to'xtatgan · bermaydi")}>
                            <span style={{ color: "var(--color-success-text)" }}>{a.buying}</span>
                            {" · "}<span style={{ color: a.silent ? "var(--color-danger-text)" : undefined }}>{a.silent}</span>
                            {" · "}{a.idle}
                          </div>
                        </td>
                        <td style={{ ...tdStyle, verticalAlign: "top", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(a.revenue)}</td>
                        <td style={{ ...tdStyle, verticalAlign: "top", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                          <ChangeText pct={a.changePct} />
                          <div style={{ fontSize: 12, color: COLORS.textTertiary }}>{fmt(a.prevRevenue)}</div>
                        </td>
                        <td style={{ ...tdStyle, verticalAlign: "top", minWidth: 340 }}>
                          <StatusChip status={a.status} lang={lang} />
                          {areaReasons(a)}
                          {areaActions(a)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {r.areas.length > areasShown && (
              <div style={{ padding: 16 }}>
                <button type="button" onClick={() => setAreasShown(n => n + 20)} className="neo-btn tap w-full" style={{ minHeight: 44 }}>
                  {t(`Показать ещё (осталось ${r.areas.length - areasShown})`, `Yana ko'rsatish (qoldi ${r.areas.length - areasShown})`)}
                </button>
              </div>
            )}
            <p style={{ fontSize: 12, color: COLORS.textTertiary, margin: 0, padding: "4px 16px 16px" }}>
              {t(`Магазины: заказывают · перестали · не заказывают. «Перестали» — заказывали за ${SALES_MAP_RULES.SILENT_LOOKBACK_DAYS} дней до периода, в периоде — нет. Район — территория; без неё — район из карточки магазина; без него — квартал около 2 км по координатам.`,
                 `Do'konlar: buyurtma beradi · to'xtatgan · bermaydi. «To'xtatgan» — davrdan oldingi ${SALES_MAP_RULES.SILENT_LOOKBACK_DAYS} kunda buyurtma bergan, davrda — yo'q. Hudud — hudud (territoriya); bo'lmasa — do'kon kartasidagi tuman; u ham bo'lmasa — koordinatalar bo'yicha ~2 km kvartal.`)}
            </p>
          </section>

          {/* ── Перестали заказывать ── */}
          <section style={{ background: COLORS.surface, borderRadius: 24, boxShadow: "var(--shadow-raised)", overflow: "hidden" }} data-testid="sales-map-silent">
            <div className="flex flex-wrap items-center justify-between gap-3" style={{ padding: "16px 16px 8px" }}>
              <div className="min-w-0">
                <h3 style={{ fontFamily: F.display, fontSize: 16, fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>
                  {t(`Перестали заказывать — ${r.silent.length}`, `Buyurtmani to'xtatganlar — ${r.silent.length}`)}
                </h3>
                <p style={{ fontSize: 12, color: COLORS.textTertiary, margin: "4px 0 0" }}>
                  {t("Сначала те, кто в прошлом периоде брал больше всего. Цвет — светофор магазина: долг и ритм заказов.", "Avval o'tgan davrda eng ko'p olganlar. Rang — do'kon svetofori: qarz va buyurtma ritmi.")}
                </p>
              </div>
              <button type="button" onClick={exportSilent} disabled={r.silent.length === 0} className="neo-btn tap disabled:opacity-40" style={{ minHeight: 44, padding: "0 16px", gap: 7 }}>
                <FileDown size={15} aria-hidden />Excel
              </button>
            </div>
            {r.silent.length === 0 ? (
              <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: 0, padding: "8px 16px 20px" }}>
                {t("Все, кто заказывал раньше, заказывают и сейчас", "Avval buyurtma berganlarning hammasi hozir ham buyurtma beradi")}
              </p>
            ) : (
              <>
                {phone ? (
                  <div data-testid="sales-map-silent-table">
                    {r.silent.slice(0, silentShown).map(s => (
                      <div key={s.id} data-testid="sales-map-silent-row" style={{ padding: "14px 16px", borderTop: `1px solid ${COLORS.border}` }}>
                        <div className="flex items-start justify-between gap-3">
                          <SilentName s={s} lang={lang} />
                          <span className="font-data" style={{ fontWeight: 700, whiteSpace: "nowrap", color: COLORS.textPrimary }}>{fmt(s.prevRevenue, true)}</span>
                        </div>
                        <div style={{ fontSize: 12, color: COLORS.textTertiary, marginTop: 4 }}>
                          {titleOf(s.areaKey)}{s.lastOrderDay ? ` · ${t("последний заказ", "oxirgi buyurtma")} ${dmy(s.lastOrderDay)}` : ""}
                        </div>
                        {silentLine(s)}
                        <div className="flex flex-wrap gap-2" style={{ marginTop: 10 }}>
                          {silentActions(s)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }} data-testid="sales-map-silent-table">
                      <thead><tr>
                        {[t("МАГАЗИН", "DO'KON"), t("РАЙОН", "HUDUD"), t("ДО ПЕРИОДА", "DAVRDAN OLDIN"), t("ПОСЛЕДНИЙ ЗАКАЗ", "OXIRGI BUYURTMA"), ""].map((h, i) => (
                          <th key={i} style={{ ...thStyle, textAlign: i === 2 ? "right" : "left" }}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {r.silent.slice(0, silentShown).map(s => (
                          <tr key={s.id} data-testid="sales-map-silent-row">
                            <td style={tdStyle}>
                              <SilentName s={s} lang={lang} />
                              {silentLine(s)}
                            </td>
                            <td style={{ ...tdStyle, fontSize: 13, color: COLORS.textSecondary }}>{titleOf(s.areaKey)}</td>
                            <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(s.prevRevenue)}</td>
                            <td style={{ ...tdStyle, whiteSpace: "nowrap", fontSize: 13 }}>{s.lastOrderDay ? dmy(s.lastOrderDay) : "—"}</td>
                            <td style={tdStyle}>
                              <div className="flex gap-2" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                                {silentActions(s)}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {r.silent.length > silentShown && (
                  <div style={{ padding: 16 }}>
                    <button type="button" onClick={() => setSilentShown(n => n + 20)} className="neo-btn tap w-full" style={{ minHeight: 44 }}>
                      {t(`Показать ещё (осталось ${r.silent.length - silentShown})`, `Yana ko'rsatish (qoldi ${r.silent.length - silentShown})`)}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          {/* ── Без координат ── */}
          {r.totals.noGps > 0 && (
            <section className="neo-card" style={{ padding: 16 }} data-testid="sales-map-nogps">
              <div className="flex items-start gap-3" style={{ padding: "12px 14px", borderRadius: 16, background: "var(--color-warning-subtle)" }}>
                <MapPinOff size={18} color="var(--color-warning-text)" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
                <span style={{ fontSize: 13, color: COLORS.textPrimary }}>
                  {t(`Магазинов без координат: ${r.totals.noGps}. На карте их нет, в районах и списках выше они есть.`, `Koordinatasiz do'konlar: ${r.totals.noGps}. Xaritada ular yo'q, yuqoridagi hududlar va ro'yxatlarda bor.`)}
                  {" "}
                  {canFixGps
                    ? t("Координаты ставят в карточке магазина: «Изменить» → «Координаты» (точка или ссылка на карту).", "Koordinata do'kon kartasida qo'yiladi: «O'zgartirish» → «Koordinatalar» (nuqta yoki xarita havolasi).")
                    : t("Координаты ставит директор или офис в карточке магазина.", "Koordinatani direktor yoki ofis do'kon kartasida qo'yadi.")}
                </span>
              </div>
              <div style={{ marginTop: 8 }}>
                {r.noGps.slice(0, phone ? 6 : 10).map(s => (
                  <div key={s.id} className="flex flex-wrap items-center justify-between gap-2" style={{ padding: "8px 2px", borderBottom: `1px solid ${COLORS.border}` }} data-testid="sales-map-nogps-row">
                    <span className="min-w-0" style={{ fontSize: 13 }}>
                      <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: STATE_DOT[s.state], marginRight: 8 }} />
                      <span style={{ fontWeight: 600, color: COLORS.textPrimary }}>{s.name}</span>
                      <span style={{ color: COLORS.textTertiary }}> · {titleOf(s.areaKey)} · </span>
                      <span className="font-data" style={{ whiteSpace: "nowrap", color: COLORS.textSecondary }}>{fmt(s.revenue)}</span>
                    </span>
                    {canFixGps
                      ? <ActionBtn to={`/shops/${s.id}?edit=gps`} icon={<MapPinOff size={15} aria-hidden />} label={t("Указать координаты", "Koordinata kiritish")} testid="sales-map-fix-gps" />
                      : <ActionBtn to={`/shops/${s.id}`} icon={<ExternalLink size={15} aria-hidden />} label={t("Открыть", "Ochish")} />}
                  </div>
                ))}
                {r.totals.noGps > Math.min(r.noGps.length, phone ? 6 : 10) && (
                  <p style={{ fontSize: 12, color: COLORS.textTertiary, margin: "8px 0 0" }}>
                    {t(`Показаны самые денежные; всего без координат — ${r.totals.noGps}`, `Eng daromadlilari ko'rsatilgan; jami koordinatasiz — ${r.totals.noGps}`)}
                  </p>
                )}
              </div>
            </section>
          )}

          {r.outside && (
            <p style={{ fontSize: 12, color: COLORS.textTertiary, margin: 0 }} data-testid="sales-map-outside">
              {t(`Ещё ${nb(fmt(r.outside.revenue))} за период — продажи магазинов, убранных в архив; на карте их нет, в P&L они есть.`,
                 `Davrda yana ${nb(fmt(r.outside.revenue))} — arxivga olingan do'konlar savdosi; xaritada yo'q, P&L da bor.`)}
            </p>
          )}
        </>
      )}

      {plan && <PlanVisitsModal target={plan} onClose={() => setPlan(null)} t={t} />}
    </div>
  );
}
