import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, GripVertical, Hourglass, MapPin, RefreshCw, Route, Save, Truck, Wand2 } from "lucide-react";
import {
  DndContext, PointerSensor, KeyboardSensor, closestCenter,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { trpc } from "@/providers/trpc";
import { useLang, type Lang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useCan } from "@/hooks/useCan";
import { useInvalidateOrderCaches } from "@/hooks/useOrderCacheSync";
import { bizToday } from "@/lib/business-time";
import { notify } from "@/lib/toast";
import { errorText } from "@/lib/error-text";
import { cssVar } from "@/lib/css-var";
import { loadYandexMaps } from "@/lib/yandex-maps";
import { STATE_TINT, timeAgo } from "@/components/tracking/agent-roster";
import { deliveryFailLabel, RESCHEDULE_MAX_DAYS, type DeliveryFailReason } from "@contracts/delivery-fail-reason";
import { labelled, DELIVERY_STATUS_LABEL } from "@/lib/entity-labels";
import { balloonHtml, latLng, mergeOrder, orderChanged } from "./dispatch";
import { RescheduleDialog } from "./DeliveryDialogs";
import { ddmm, planDayChoices, planDayLabel } from "./plan-days";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../api/router";

type Board = inferRouterOutputs<AppRouter>["courier"]["board"];
type Stop = Board["stops"][number];

/*
  Доска развоза — для директора и оператора.

  ── Что было ────────────────────────────────────────────────────────────────

  «Доставки» у офиса — плоский список заказов с курьерами. Где сейчас
  машина, сколько у кого осталось, в каком порядке он их объедет — не видно
  нигде: курьер ехал как придётся, а на вопрос магазина «когда привезут?»
  офис звонил курьеру.

  ── Как теперь ──────────────────────────────────────────────────────────────

  Слева курьеры: последняя точка, сколько в машине, довёз, сорвал, перенёс.
  Справа карта выбранного: где он, его остановки по номерам, пунктиром —
  план объезда, сплошной — пройденный за день след. Ниже — остановки списком:
  их можно перетащить, попросить «Предложить порядок» (ближайший сосед от
  того места, где курьер сейчас) и «Сохранить» — курьер получит список в
  этом порядке.

  След здесь — только курьерский: ручки доски отказывают на номер агента
  (services/dispatch-board.ts), чужой маршрут оператору не показывается.

  ── День ────────────────────────────────────────────────────────────────────

  Порядок на завтра собирают с вечера: выбор дня сверху (сегодня … +14).
  Будущий день — заказы, перенесённые ровно на него; их порядок сохраняется
  отдельно и сегодняшний не трогает.

  Заказ «ждёт офиса» (скидка выше порога, просрочка магазина) помечен: везти
  его рано, и «Предложить порядок» ставит его в конец. Остановку можно
  перенести на другой день прямо отсюда — магазин позвонил в офис.
*/

export function DispatchBoard() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { fmt } = useCurrency();
  const can = useCan();
  const canEdit = can("orders.edit");
  const utils = trpc.useUtils();
  const invalidateOrderCaches = useInvalidateOrderCaches();
  // Сегодня — один раз на экран: доска, открытая в 23:59, не сдвигает выбор под рукой.
  const [today] = useState(() => bizToday());
  /** Выбранный день; null — сегодня (запрос без даты, как у прежних вкладок). */
  const [day, setDay] = useState<string | null>(null);
  const dayInput = day && day !== today ? { date: day } : {};
  const board = trpc.courier.board.useQuery(day && day !== today ? { date: day } : undefined, { refetchInterval: 60_000 });
  const [picked, setPicked] = useState<number | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<Stop | null>(null);
  /** Порядок, который диспетчер собрал, но ещё не сохранил; null — как на сервере. */
  const [localOrder, setLocalOrder] = useState<{ courierId: number; ids: number[] } | null>(null);
  const [suggestion, setSuggestion] = useState<{ km: number; noGps: number; held: number; fromCourier: boolean; startAt: Date | string | null } | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const data = board.data;
  // Выбран — тот, на кого нажали; не нажимали — первый, у кого есть остановки.
  const selected = picked ?? data?.couriers.find(c => c.open > 0)?.id ?? data?.couriers[0]?.id ?? null;
  const courier = data?.couriers.find(c => c.id === selected) ?? null;

  const serverStops = useMemo(() => (data?.stops ?? []).filter(s => s.courierId === selected), [data, selected]);
  const serverIds = useMemo(() => serverStops.map(s => s.orderId), [serverStops]);
  const localIds = localOrder?.courierId === selected ? localOrder.ids : null;
  // Одним memo: карта перерисовывает метки по ссылке на список, и новый
  // массив на каждой отрисовке дёргал бы её без причины.
  const { shownIds, shown } = useMemo(() => {
    const ids = mergeOrder(serverIds, localIds);
    const byId = new Map(serverStops.map(s => [s.orderId, s]));
    return { shownIds: ids, shown: ids.map(id => byId.get(id)).filter((s): s is Stop => !!s) };
  }, [serverIds, serverStops, localIds]);
  const dirty = orderChanged(serverIds, shownIds);

  // След — только у сегодняшнего дня: у завтрашнего его ещё нет.
  const track = trpc.courier.dayTrack.useQuery(
    { courierId: selected ?? 0, day: data?.day ?? "" },
    { enabled: selected != null && !!data?.day && data.day === today, refetchInterval: 60_000 },
  );

  const setRouteOrder = trpc.courier.setRouteOrder.useMutation({
    onSuccess: (r) => {
      notify.success(t(`Порядок сохранён: ${r.stops} адресов`, `Tartib saqlandi: ${r.stops} manzil`));
      setLocalOrder(null);
      setSuggestion(null);
      void utils.courier.board.invalidate();
    },
    onError: (e) => notify.error(errorText(e)),
  });

  const officeReschedule = trpc.courier.officeReschedule.useMutation({
    onSuccess: (_r, vars) => {
      setRescheduleFor(null);
      invalidateOrderCaches();
      void utils.courier.board.invalidate();
      notify.success(t(`День доставки: ${ddmm(vars.date)}. Курьер получит уведомление`, `Yetkazish kuni: ${ddmm(vars.date)}. Kuryerga xabar boradi`));
    },
    onError: (e) => notify.error(errorText(e)),
  });

  const pick = (id: number) => {
    setPicked(id);
    setSuggestion(null);
  };

  const pickDay = (d: string) => {
    setDay(d === today ? null : d);
    setLocalOrder(null);
    setSuggestion(null);
  };

  const suggest = async () => {
    if (selected == null) return;
    setSuggesting(true);
    try {
      const r = await utils.courier.suggestRoute.fetch({ courierId: selected, ...dayInput });
      setLocalOrder({ courierId: selected, ids: r.orderIds });
      setSuggestion({ km: r.km, noGps: r.noGps, held: r.held ?? 0, fromCourier: r.fromCourier, startAt: r.startAt ?? null });
    } catch (e) {
      notify.error(errorText(e));
    } finally {
      setSuggesting(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (selected == null || !e.over || e.active.id === e.over.id) return;
    const from = shownIds.indexOf(Number(e.active.id));
    const to = shownIds.indexOf(Number(e.over.id));
    if (from < 0 || to < 0) return;
    setLocalOrder({ courierId: selected, ids: arrayMove(shownIds, from, to) });
  };

  const shownDay = day ?? today;
  const header = (
    <div className="flex items-center gap-2 flex-wrap">
      <Route size={20} className="text-primary" />
      <h2 className="text-lg font-bold flex-1">{shownDay === today ? t("Развоз сегодня", "Bugungi yetkazish") : t(`Развоз: ${planDayLabel(shownDay, today, lang)}`, `Yetkazish: ${planDayLabel(shownDay, today, lang)}`)}</h2>
      <label className="flex items-center gap-1.5 text-sm" style={{ color: "var(--color-text-secondary)" }}>
        <CalendarClock size={14} aria-hidden />
        <select value={shownDay} onChange={e => pickDay(e.target.value)} className="neo-input text-sm" style={{ minHeight: 40, padding: "0 10px" }}
          aria-label={t("День развоза", "Yetkazish kuni")} data-testid="dispatch-day">
          {planDayChoices(today, 0, RESCHEDULE_MAX_DAYS).map(d => <option key={d} value={d}>{planDayLabel(d, today, lang)}</option>)}
        </select>
      </label>
    </div>
  );

  if (board.isLoading) {
    return (
      <section className="space-y-3" data-testid="dispatch-board">
        {header}
        <div className="neo-card h-40 animate-pulse" />
      </section>
    );
  }
  /*
    Доска не пришла — так и сказать, с кнопкой. Здесь стояло «нет данных —
    ничего не рисуем»: при сбое запроса доска просто пропадала, и диспетчер
    не понимал, сломалось что-то или курьеров нет.
  */
  if (!data) {
    return (
      <section className="space-y-3" data-testid="dispatch-board">
        {header}
        <div className="neo-card flex items-center gap-3 flex-wrap" style={{ padding: 16 }} role="alert" data-testid="dispatch-error">
          <p className="text-sm flex-1" style={{ color: "var(--color-text-secondary)" }}>
            {t("Доска развоза не загрузилась.", "Yetkazish doskasi yuklanmadi.")}{board.error ? ` ${errorText(board.error)}` : ""}
          </p>
          <button type="button" onClick={() => void board.refetch()} className="neo-btn tap flex items-center gap-1.5 text-sm" style={{ minHeight: 40, padding: "0 12px" }}
            data-testid="dispatch-retry">
            <RefreshCw size={14} />{t("Повторить", "Qayta urinish")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3" data-testid="dispatch-board">
      {header}

      {data.couriers.length === 0 ? (
        <p className="neo-card text-sm text-secondary" style={{ padding: 16 }}>
          {t("В организации нет курьеров — добавьте их в разделе «Сотрудники».", "Tashkilotda kuryer yo'q — ularni «Xodimlar» bo'limida qo'shing.")}
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-[260px_1fr]">
          <ul className="space-y-2" aria-label={t("Курьеры", "Kuryerlar")}>
            {data.couriers.map(c => {
              const on = c.id === selected;
              const ping = c.lastPing ? new Date(c.lastPing.at) : null;
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => pick(c.id)} aria-pressed={on}
                    className="tap w-full text-left rounded-xl border p-3"
                    style={{ borderColor: on ? "var(--color-primary)" : "var(--color-border-subtle)", background: on ? "var(--color-primary-subtle)" : "var(--color-surface)" }}
                    data-testid={`dispatch-courier-${c.id}`}>
                    <span className="flex items-center gap-2">
                      <Truck size={16} className="text-primary flex-shrink-0" />
                      <span className="font-semibold text-sm truncate flex-1">{c.name}</span>
                    </span>
                    <span className="block text-xs mt-1" style={{ color: "var(--color-text-tertiary)" }}>
                      {ping ? `${t("Точка", "Nuqta")}: ${timeAgo(ping, lang)}` : t("Нет точки GPS за сутки", "Sutka davomida GPS nuqtasi yo'q")}
                    </span>
                    <span className="block text-xs mt-1 font-data" style={{ color: "var(--color-text-secondary)" }}>
                      {t(`В машине ${c.open} · довёз ${c.delivered} · сорвано ${c.failed} · перенесено ${c.rescheduled}`,
                         `Mashinada ${c.open} · yetkazdi ${c.delivered} · bajarilmadi ${c.failed} · ko'chirildi ${c.rescheduled}`)}
                    </span>
                    {(c.held ?? 0) > 0 && (
                      <span className="block text-xs mt-1" style={{ color: "var(--color-warning-text)" }}>
                        {t(`Ждут офиса: ${c.held}`, `Ofis qarorini kutmoqda: ${c.held}`)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="space-y-3 min-w-0">
            <DispatchMap
              fitKey={`${selected ?? ""}:${data.day}`}
              courierName={courier?.name ?? null}
              ping={courier?.lastPing ?? null}
              stops={shown}
              track={track.data?.points ?? NO_POINTS}
              events={track.data?.events ?? NO_EVENTS}
              lang={lang}
            />

            {courier && (
              <div className="neo-card space-y-2" style={{ padding: 16 }}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="font-semibold text-sm">{t(`Остановки: ${shown.length}`, `To'xtashlar: ${shown.length}`)}</h3>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" onClick={suggest} disabled={suggesting || shown.length < 2}
                      className="neo-btn tap flex items-center gap-1.5 text-sm disabled:opacity-40" style={{ minHeight: 40, padding: "0 12px" }}
                      data-testid="dispatch-suggest">
                      <Wand2 size={14} />{t("Предложить порядок", "Tartib taklif qilish")}
                    </button>
                    {canEdit && <button type="button" onClick={() => setRouteOrder.mutate({ courierId: courier.id, orderIds: shownIds, ...dayInput })}
                      disabled={!dirty || setRouteOrder.isPending || shownIds.length === 0}
                      className="neo-btn-primary tap flex items-center gap-1.5 text-sm disabled:opacity-40" style={{ minHeight: 40, padding: "0 12px" }}
                      data-testid="dispatch-save">
                      <Save size={14} />{t("Сохранить", "Saqlash")}
                    </button>}
                  </div>
                </div>
                {suggestion && (
                  <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }} role="status" data-testid="dispatch-suggestion">
                    {t(`Около ${suggestion.km} км`, `Taxminan ${suggestion.km} km`)}
                    {suggestion.fromCourier && suggestion.startAt
                      ? t(` — от точки курьера (${timeAgo(new Date(suggestion.startAt), lang)})`, ` — kuryer nuqtasidan (${timeAgo(new Date(suggestion.startAt), lang)})`)
                      : t(" — от первого адреса: свежей точки курьера нет", " — birinchi manzildan: kuryerning yangi nuqtasi yo'q")}
                    {suggestion.noGps > 0 ? t(` · без координат: ${suggestion.noGps}, они в конце`, ` · koordinatasiz: ${suggestion.noGps}, ular oxirida`) : ""}
                    {suggestion.held > 0 ? t(` · ждут офиса: ${suggestion.held}, они в конце`, ` · ofis qarorini kutmoqda: ${suggestion.held}, ular oxirida`) : ""}
                  </p>
                )}
                {shown.length === 0 ? (
                  <p className="text-sm text-secondary">{shownDay === today
                    ? t("На сегодня у курьера нет открытых заказов.", "Bugun kuryerda ochiq buyurtma yo'q.")
                    : t("На этот день у курьера заказов нет — сюда попадают перенесённые на него.", "Bu kunga kuryerda buyurtma yo'q — bu yerga shu kunga ko'chirilganlar tushadi.")}</p>
                ) : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                    <SortableContext items={shownIds} strategy={verticalListSortingStrategy}>
                      <ol className="space-y-1.5">
                        {shown.map((s, i) => (
                          <StopRow key={s.orderId} stop={s} n={i + 1} fmt={fmt} lang={lang} t={t}
                            onReschedule={canEdit ? () => setRescheduleFor(s) : undefined} />
                        ))}
                      </ol>
                    </SortableContext>
                  </DndContext>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {rescheduleFor && (
        <RescheduleDialog
          mode="office"
          orderNumber={rescheduleFor.orderNumber}
          shopName={rescheduleFor.shopName}
          current={rescheduleFor.plannedDeliveryDate}
          busy={officeReschedule.isPending}
          onCancel={() => setRescheduleFor(null)}
          onConfirm={(c) => officeReschedule.mutate({ orderId: rescheduleFor.orderId, ...c })}
        />
      )}
    </section>
  );
}

function StopRow({ stop, n, fmt, lang, t, onReschedule }: {
  stop: Stop; n: number; fmt: (v: string | number) => string; lang: Lang; t: (ru: string, uz: string) => string;
  /** Есть — у остановки кнопка «Перенести» (офис с правом править заказы). */
  onReschedule?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stop.orderId });
  const noGps = !latLng(stop.lat, stop.lng);
  const held = stop.status === "pending";
  return (
    <li ref={setNodeRef}
      className="flex items-center gap-2 rounded-xl border p-2"
      style={{ transform: CSS.Transform.toString(transform), transition, borderColor: "var(--color-border-subtle)",
               background: isDragging ? "var(--color-surface-light)" : "var(--color-surface)", opacity: isDragging ? 0.9 : 1 }}
      data-testid="dispatch-stop">
      <button type="button" {...attributes} {...listeners} aria-label={t("Переместить остановку", "To'xtashni ko'chirish")}
        className="flex items-center justify-center" style={{ width: 28, minHeight: 36, cursor: "grab", touchAction: "none", color: "var(--color-text-tertiary)", background: "transparent", border: "none" }}>
        <GripVertical size={16} />
      </button>
      <span className="font-data font-bold text-sm flex-shrink-0" style={{ width: 22, textAlign: "right" }}>{n}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium truncate">{stop.shopName ?? t("Магазин", "Do'kon")}</span>
        <span className="block text-xs truncate" style={{ color: "var(--color-text-tertiary)" }}>
          {stop.orderNumber} · {labelled(DELIVERY_STATUS_LABEL, stop.deliveryStatus, lang)} · {fmt(stop.total)}
          {stop.shopAddress ? ` · ${stop.shopAddress}` : ""}
        </span>
      </span>
      {held && (
        <span className="flex items-center gap-1 text-[10px] flex-shrink-0" style={{ color: "var(--color-warning-text)" }}
          title={t("Заказ ждёт решения офиса — везти рано", "Buyurtma ofis qarorini kutmoqda — olib borishga erta")} data-testid="dispatch-held">
          <Hourglass size={11} />{t("ждёт офиса", "ofisni kutmoqda")}
        </span>
      )}
      {noGps && (
        <span className="flex items-center gap-1 text-[10px] flex-shrink-0" style={{ color: "var(--color-warning-text)" }} title={t("У магазина нет координат", "Do'konda koordinata yo'q")}>
          <MapPin size={11} />{t("нет GPS", "GPS yo'q")}
        </span>
      )}
      {onReschedule && (
        <button type="button" onClick={onReschedule} className="neo-btn tap flex items-center justify-center flex-shrink-0"
          style={{ width: 36, minHeight: 36, padding: 0 }} aria-label={t(`Перенести ${stop.orderNumber} на другой день`, `${stop.orderNumber} ni boshqa kunga ko'chirish`)}
          title={t("Перенести на другой день", "Boshqa kunga ko'chirish")} data-testid="dispatch-reschedule">
          <CalendarClock size={14} />
        </button>
      )}
    </li>
  );
}

type TrackPoint = { lat: string | number | null; lng: string | number | null };
type TrackEvent = {
  kind: string; orderNumber: string | null; shopName: string | null; reasonCode: DeliveryFailReason | null;
  lat: string | number | null; lng: string | number | null;
  /** Точка магазина — для отметки без своей точки (старая сборка, GPS выключен). */
  shopLat?: string | number | null; shopLng?: string | number | null;
};
const NO_POINTS: TrackPoint[] = [];
const NO_EVENTS: TrackEvent[] = [];

/** Карта выбранного курьера: он сам, его остановки, план и пройденный след. */
function DispatchMap({ fitKey, courierName, ping, stops, track, events, lang }: {
  /** Курьер и день: карта подгоняется под них при смене, а не на каждом обновлении. */
  fitKey: string;
  courierName: string | null;
  ping: { lat: string; lng: string; at: Date | string } | null;
  stops: Stop[];
  track: TrackPoint[];
  events: TrackEvent[];
  lang: string;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<YandexMap | null>(null);
  const objectsRef = useRef<Array<YandexPlacemark | YandexPolyline>>([]);
  /** Под что карта подогнана в последний раз — см. fitKey. */
  const fittedRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadYandexMaps().then(ymaps => ymaps.ready(() => {
      if (!alive || !divRef.current || mapRef.current) return;
      mapRef.current = new ymaps.Map(divRef.current, { center: [41.2995, 69.2401], zoom: 11, controls: ["zoomControl", "fullscreenControl"] });
      setReady(true);
    })).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const ymaps = window.ymaps;
    const map = mapRef.current;
    if (!ready || !ymaps || !map) return;
    const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
    objectsRef.current.forEach(o => map.geoObjects.remove(o));
    objectsRef.current = [];
    const add = (o: YandexPlacemark | YandexPolyline) => { map.geoObjects.add(o); objectsRef.current.push(o); };

    // Пройденный за день след — сплошной линией.
    const trail = track.map(p => latLng(p.lat, p.lng)).filter((p): p is [number, number] => !!p);
    if (trail.length > 1) {
      add(new ymaps.Polyline(trail, {}, { strokeColor: cssVar(...STATE_TINT.stale), strokeWidth: 3, strokeOpacity: 0.7, zIndex: 1 }));
    }

    // План: от курьера по остановкам в показанном порядке — пунктиром.
    const here = ping ? latLng(ping.lat, ping.lng) : null;
    const plan = [here, ...stops.map(s => latLng(s.lat, s.lng))].filter((p): p is [number, number] => !!p);
    if (plan.length > 1) {
      add(new ymaps.Polyline(plan, {}, { strokeColor: cssVar(...STATE_TINT.online), strokeWidth: 3, strokeOpacity: 0.85, strokeStyle: "shortdash", zIndex: 2 }));
    }

    stops.forEach((s, i) => {
      const at = latLng(s.lat, s.lng);
      if (!at) return;
      const b = balloonHtml(s.shopName, [s.orderNumber, s.shopAddress]);
      add(new ymaps.Placemark(at, { iconContent: String(i + 1), balloonContentHeader: b.header, balloonContentBody: b.body, hintContent: b.hint },
        { preset: s.deliveryStatus === "out_for_delivery" ? "islands#orangeIcon" : "islands#blueIcon", zIndex: 3 }));
    });

    events.forEach(ev => {
      // Своя точка отметки — где нажали; нет её — у магазина, с пометкой.
      const own = latLng(ev.lat, ev.lng);
      const at = own ?? latLng(ev.shopLat, ev.shopLng);
      if (!at) return;
      const kind = ev.kind === "delivered" ? t("Доставлен", "Yetkazildi") : ev.kind === "failed" ? t("Не доставлен", "Yetkazilmadi") : t("Перенесён", "Ko'chirildi");
      const reason = ev.kind !== "delivered" && ev.reasonCode ? deliveryFailLabel(ev.reasonCode, lang) : null;
      const where = own ? null : t("Отмечено без точки — показано у магазина", "Nuqtasiz belgilangan — do'kon yonida ko'rsatilgan");
      const b = balloonHtml(ev.shopName, [ev.orderNumber, kind, reason, where]);
      add(new ymaps.Placemark(at, { balloonContentHeader: b.header, balloonContentBody: b.body, hintContent: b.hint },
        { preset: ev.kind === "delivered" ? "islands#greenCircleDotIcon" : ev.kind === "failed" ? "islands#redCircleDotIcon" : "islands#blueCircleDotIcon", zIndex: 4 }));
    });

    if (here) {
      const b = balloonHtml(courierName, [t("Курьер", "Kuryer")]);
      add(new ymaps.Placemark(here, { balloonContentHeader: b.header, balloonContentBody: b.body, hintContent: b.hint },
        { preset: "islands#violetAutoIcon", zIndex: 5 }));
    }

    /*
      Подгонка — при смене курьера или дня, а не на каждом обновлении.
      Доска перечитывается раз в минуту, и здесь каждый раз стоял setBounds:
      диспетчера, который приблизил район, через минуту выбрасывало обратно
      на весь город. Пустую карту (данные ещё не пришли) подгонкой не
      считаем — подгоним, когда придут.
    */
    if (fittedRef.current === fitKey || objectsRef.current.length === 0) return;
    fittedRef.current = fitKey;
    const bounds = map.geoObjects.getBounds();
    if (bounds && objectsRef.current.length > 1) map.setBounds(bounds, { checkZoomRange: true, zoomMargin: 40 });
    else if (here) map.setCenter(here, 13);
  }, [ready, fitKey, ping, stops, track, events, courierName, lang]);

  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  return (
    <div className="neo-card overflow-hidden relative" style={{ minHeight: 320 }}>
      <div ref={divRef} style={{ width: "100%", height: 320 }} data-testid="dispatch-map" />
      {failed && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-secondary" style={{ padding: 16, textAlign: "center" }}>
          {t("Карта не загрузилась — список остановок ниже работает", "Xarita yuklanmadi — pastdagi ro'yxat ishlaydi")}
        </p>
      )}
    </div>
  );
}
