import { trpc } from "@/providers/trpc";
import { useInvalidateOrderCaches } from "@/hooks/useOrderCacheSync";
import { useLang, useTranslate } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { cssVar } from "@/lib/css-var";
import { loadYandexMaps } from "@/lib/yandex-maps";
import { useState, useRef, useEffect, useMemo } from "react";
import { Truck, MapPin, CheckCircle2, Package, ArrowRight, ChevronRight, ChevronDown, CalendarClock, Hourglass } from "lucide-react";
import { useNavigate } from "react-router";
import { notify } from "@/lib/toast";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { formatQty } from "@/lib/format";
import { CARD } from "@/components/phone/tones";
import { DispatchBoard } from "@/components/delivery/DispatchBoard";
import { FailReasonDialog, RescheduleDialog } from "@/components/delivery/DeliveryDialogs";
import { ProofSheet, type ProofTarget } from "@/components/delivery/ProofSheet";
import { newEventKey } from "@/components/delivery/links";
import { balloonHtml } from "@/components/delivery/dispatch";
import { ddmm } from "@/components/delivery/plan-days";
import { bizToday } from "@/lib/business-time";
import { freshPlace, warmFix } from "@/lib/last-fix";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";

type Delivery = inferRouterOutputs<AppRouter>["courier"]["listMyDeliveries"][number];

const DELIVERY_STATUS_STYLES: Record<string, string> = {
  assigned:        "bg-info/15 text-info border-info/30",
  out_for_delivery:"bg-warning/15 text-warning border-warning/30",
  delivered:       "bg-success/15 text-success border-success/30",
  failed:          "bg-danger/15 text-danger border-danger/30",
};

/*
  Словарь общий: здесь своя копия потеряла «not_assigned», и заказ, которому
  ещё не назначили курьера, показывался словом «not_assigned».
*/
import { labelled, DELIVERY_STATUS_LABEL } from "@/lib/entity-labels";
import { errorText } from "@/lib/error-text";

/*
  Итоги месяца — ПОД маршрутом, как в мобилке (MonthTotals, app/(tabs)/
  deliveries.tsx): строка сверху отвечает «что осталось сегодня», а сколько
  довёз за месяц — отдельный вопрос. Отказ гасится: блока просто не будет.
*/
function MonthTotals() {
  const t = useTranslate();
  const navigate = useNavigate();
  const { data } = trpc.kpi.courierKpi.useQuery({ period: "month" }, { retry: false });
  if (!data) return null;
  const cells = [
    { label: t("Довезено", "Yetkazildi"), value: String(data.delivered) },
    { label: t("Сорвано", "Bajarilmadi"), value: String(data.failed) },
    // Ноль назначенных — не «ноль процентов успеха», а «мерить нечего».
    { label: t("Успешных", "Muvaffaqiyatli"), value: data.delivered + data.failed > 0 ? `${data.successRate}%` : "—" },
    { label: t("Рабочих дней", "Ish kunlari"), value: String(data.workDays) },
  ];
  return (
    <button type="button" onClick={() => navigate("/agent/kpi")} className="w-full text-left" data-testid="courier-month-totals"
      style={{ ...CARD, borderRadius: 24, padding: 20 }}>
      <span className="flex items-center justify-between mb-3">
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-tertiary)" }}>{t("Итоги месяца", "Oy yakuni")}</span>
        <ChevronRight size={16} color="var(--color-text-tertiary)" />
      </span>
      <span className="grid grid-cols-2 gap-y-3">
        {cells.map(c => (
          <span key={c.label}>
            <span className="block font-data" style={{ fontSize: 17, fontWeight: 800, color: "var(--color-text-primary)" }}>{c.value}</span>
            <span className="block" style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 2 }}>{c.label}</span>
          </span>
        ))}
      </span>
    </button>
  );
}

export default function CourierDeliveries() {
  const { user } = useAuth();
  const { fmt } = useCurrency();
  // This page is written with inline ru/uz pairs; `tKey` is for the shared dictionary.
  const t = useTranslate();
  const { lang, t: tKey } = useLang();
  const [cashInput, setCashInput] = useState<Record<number, string>>({});
  /*
    Окна курьера: почему не довёз, на какой день перенёс, подтверждение
    вручения. Ключ записи — один на открытое окно: двойное нажатие или
    повтор запроса не запишет вторую попытку (delivery_events).
  */
  const [failFor, setFailFor] = useState<{ order: Delivery; key: string } | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<{ order: Delivery; key: string } | null>(null);
  const [proofFor, setProofFor] = useState<ProofTarget | null>(null);
  /** «Перенесено» свёрнуто: эти заказы сегодня не везут. */
  const [laterOpen, setLaterOpen] = useState(false);
  const invalidateOrderCaches = useInvalidateOrderCaches();
  const isCourierUser = user?.role === "courier";

  /*
    Курьеру — и перенесённые на другие дни (includeLater): они уходят в
    свёрнутый раздел «Перенесено», а не пропадают до своего дня. Офису
    сервер и так отдаёт все открытые заказы в развозе.
  */
  const { data: deliveries, isLoading, isLoadingError, refetch } = trpc.courier.listMyDeliveries.useQuery(isCourierUser ? { includeLater: true } : undefined);

  // Точка телефона для отметок — заранее, чтобы «Доставлено» не ждало GPS
  // (lib/last-fix.ts). Разрешение здесь не спрашивается.
  useEffect(() => { if (isCourierUser) warmFix(); }, [isCourierUser]);

  const markOutForDelivery = trpc.courier.markOutForDelivery.useMutation({
    onSuccess: () => {
      invalidateOrderCaches();
      notify.success(tKey("common.success"));
    },
    onError: (e) => notify.error(errorText(e)),
  });

  const markDelivered = trpc.courier.markDelivered.useMutation({
    onSuccess: (_r, vars) => {
      invalidateOrderCaches();
      notify.success(tKey("common.success"));
      setCashInput(prev => {
        const next = { ...prev };
        delete next[vars.orderId];
        return next;
      });
      // Сразу — подтверждение вручения: магазин ещё рядом, расписаться есть кому.
      const o = deliveries?.find(d => d.id === vars.orderId);
      setProofFor({ orderId: vars.orderId, orderNumber: o?.orderNumber, shopName: o?.shopName });
    },
    onError: (e) => notify.error(errorText(e)),
  });

  const markFailed = trpc.courier.markFailed.useMutation({
    onSuccess: () => {
      invalidateOrderCaches();
      setFailFor(null);
      notify.success(t("Отмечено: не доставлено — заказ вернулся в офис", "Belgilandi: yetkazilmadi — buyurtma ofisga qaytdi"));
    },
    onError: (e) => notify.error(errorText(e)),
  });

  const reschedule = trpc.courier.reschedule.useMutation({
    // День — из запроса: повтор с тем же ключом отвечает «уже записано» без даты.
    onSuccess: (_r, vars) => {
      invalidateOrderCaches();
      setRescheduleFor(null);
      notify.success(t(`Перенесено на ${ddmm(vars.date)} — заказ остаётся за вами`, `${ddmm(vars.date)} ga ko'chirildi — buyurtma sizda qoladi`));
    },
    onError: (e) => notify.error(errorText(e)),
  });

  if (isLoadingError) return <QueryErrorFallback onRetry={refetch} />;
  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 p-4">
        <div className="h-8 w-48 bg-surface-light animate-pulse rounded" />
        <div className="h-32 bg-surface-light animate-pulse rounded" />
        <div className="h-32 bg-surface-light animate-pulse rounded" />
      </div>
    );
  }

  /*
    Страницу открывают и директор с оператором — им сервер отдаёт все доставки.
    Итоги месяца без courierId считаются по самому смотрящему (у директора
    нули), а «Выехал по всем» сервер пускает только назначенному курьеру.
  */
  const isCourier = isCourierUser;
  const openFail = (order: Delivery) => { warmFix(); setFailFor({ order, key: newEventKey() }); };
  const openReschedule = (order: Delivery) => { warmFix(); setRescheduleFor({ order, key: newEventKey() }); };
  /*
    Перенесённые на другой день — отдельно и свёрнуто. Здесь они считались в
    «Ожидают» без даты: офис видел заказ, который сегодня никто не повезёт, а
    курьер их не видел вовсе.
  */
  const today = bizToday();
  const isLater = (d: Delivery) => !!d.plannedDeliveryDate && d.plannedDeliveryDate > today;
  const current = (deliveries ?? []).filter((d) => !isLater(d));
  const later = (deliveries ?? []).filter(isLater)
    .sort((a, b) => (a.plannedDeliveryDate ?? "").localeCompare(b.plannedDeliveryDate ?? ""));
  const assigned = current.filter((d) => d.deliveryStatus === "assigned");
  const inTransit = current.filter((d) => d.deliveryStatus === "out_for_delivery");

  return (
    <div className="max-w-3xl mx-auto space-y-4 p-4">
      {/* Шапка. На телефоне — как в мобилке: одна строка «ожидают · в пути»
          вместо двух плиток (они занимали треть экрана и уталкивали первую
          точку маршрута за край); заголовок уже пишет шапка приложения. */}
      <p className="md:hidden" style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-tertiary)", margin: 0 }}>
        {t(`Ожидают ${assigned.length} · В пути ${inTransit.length}`, `Kutmoqda ${assigned.length} · Yo'lda ${inTransit.length}`)}
      </p>
      <div className="hidden md:flex items-center gap-3">
        <Truck size={24} className="text-primary" />
        <div>
          <h1 className="text-lg font-bold">{t("Мои доставки", "Mening yetkazishlarim")}</h1>
          <p className="text-sm text-secondary">{user?.name}</p>
        </div>
      </div>

      {/* Наличные на руках: курьер принимает деньги у магазинов и сдаёт вечером. */}

      <div className="hidden md:grid grid-cols-2 gap-3">
        <div className="kpi-hero" style={{ padding: "18px" }}>
          <div className="flex items-center gap-2 text-secondary text-sm mb-1">
            <Package size={16} />
            {t("Ожидают", "Kutilmoqda")}
          </div>
          <p className="text-2xl font-bold">{assigned.length}</p>
        </div>
        <div className="kpi-hero" style={{ padding: "18px" }}>
          <div className="flex items-center gap-2 text-secondary text-sm mb-1">
            <Truck size={16} />
            {t("В пути", "Yo'lda")}
          </div>
          <p className="text-2xl font-bold text-warning">{inTransit.length}</p>
        </div>
      </div>

      {/* Офису — доска развоза: курьеры, карта, порядок объезда. Курьеру —
          карта своих адресов (на телефоне её заменяет список). */}
      {isCourier
        ? <div className="hidden md:block"><MapView deliveries={current} /></div>
        : <DispatchBoard />}

      {/* In Transit */}
      {inTransit.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-semibold text-sm text-secondary flex items-center gap-2">
            <Truck size={16} className="text-warning" />
            {t("В пути", "Yo'lda")}
          </h2>
          {inTransit.map((order) => (
            <DeliveryCard
              key={order.id}
              order={order}
              fmt={fmt}
              t={t}
              cashInput={cashInput[order.id] ?? ""}
              onCashChange={(v) => setCashInput(prev => ({ ...prev, [order.id]: v }))}
              onDeliver={() => markDelivered.mutate({
                orderId: order.id,
                cashAmount: cashInput[order.id] || undefined,
                // Где нажато — на доску развоза и в карточку заказа.
                ...freshPlace(),
              })}
              onFail={() => openFail(order)}
              onReschedule={() => openReschedule(order)}
              isPending={markDelivered.isPending}
              canAct={isCourier}
              showCourier={!isCourier}
            />
          ))}
        </div>
      )}

      {/* Assigned */}
      {assigned.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-semibold text-sm text-secondary flex items-center gap-2">
            <Package size={16} className="text-info" />
            {t("Ожидают доставки", "Yetkazishni kutmoqda")}
          </h2>
          {isCourier && assigned.length > 1 && (
            <button
              type="button"
              onClick={() => assigned.forEach(o => markOutForDelivery.mutate({ orderId: o.id }))}
              disabled={markOutForDelivery.isPending}
              className="neo-btn-primary w-full flex items-center justify-center gap-2"
              style={{ minHeight: 48 }}
              data-testid="courier-take-all"
            >
              <Truck size={16} />
              {t(`Выехал по всем (${assigned.length})`, `Hammasiga yo'lga chiqdim (${assigned.length})`)}
            </button>
          )}
          {assigned.map((order) => (
            <div key={order.id} className="neo-card" style={{ padding: "16px" }}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold">{order.orderNumber}</p>
                  <p className="text-sm text-secondary">{order.shopName}</p>
                </div>
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${DELIVERY_STATUS_STYLES[order.deliveryStatus] ?? ""}`}>
                  {labelled(DELIVERY_STATUS_LABEL, order.deliveryStatus, lang)}
                </span>
              </div>
              <DeliveryTags order={order} showCourier={!isCourier} t={t} />
              {order.shopAddress && (
                <p className="text-xs text-secondary flex items-center gap-1">
                  <MapPin size={12} />{order.shopAddress}{order.shopCity ? `, ${order.shopCity}` : ""}
                </p>
              )}
              <p className="font-data text-sm">{fmt(order.total)}</p>
              <div className="flex gap-2">
                {order.shopAddress && (
                  <a
                    href={`https://yandex.ru/maps/?text=${encodeURIComponent(order.shopAddress)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="neo-btn flex items-center gap-2 text-sm flex-1 justify-center"
                  >
                    <MapPin size={14} />
                    {t("На карте", "Xaritada")}
                  </a>
                )}
                {/* «Взять в доставку» — только курьеру, по той же причине, что и «Выехал по всем». */}
                {isCourier && <button
                  onClick={() => markOutForDelivery.mutate({ orderId: order.id })}
                  disabled={markOutForDelivery.isPending}
                  className="neo-btn-primary flex items-center gap-2 text-sm flex-1 justify-center"
                >
                  <ArrowRight size={14} />
                  {t("Взять в доставку", "Yetkazishga olish")}
                </button>}
              </div>
              {/* Магазин ещё до выезда просит «привезите в пятницу» — перенос
                  прямо отсюда, не выезжая. */}
              {isCourier && (
                <button type="button" onClick={() => openReschedule(order)}
                  className="neo-btn flex items-center gap-2 text-sm w-full justify-center" data-testid="courier-reschedule">
                  <CalendarClock size={14} />
                  {t("Перенести на другой день", "Boshqa kunga ko'chirish")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Перенесённые на другие дни — свёрнуто, по дням. */}
      {later.length > 0 && (
        <div className="space-y-2" data-testid="deliveries-later">
          <button type="button" onClick={() => setLaterOpen(v => !v)} aria-expanded={laterOpen}
            className="font-semibold text-sm text-secondary flex items-center gap-2 w-full text-left" style={{ minHeight: 40, background: "transparent", border: "none", padding: 0 }}
            data-testid="deliveries-later-toggle">
            <CalendarClock size={16} className="text-info" />
            <span className="flex-1">{t(`Перенесено (${later.length})`, `Ko'chirilgan (${later.length})`)}</span>
            {laterOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          {laterOpen && later.map((order) => (
            <div key={order.id} className="neo-card" style={{ padding: "12px 16px" }} data-testid="deliveries-later-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{order.orderNumber}</p>
                  <p className="text-sm text-secondary truncate">{order.shopName}</p>
                </div>
                <span className="font-data text-sm flex-shrink-0">{fmt(order.total)}</span>
              </div>
              <DeliveryTags order={order} showCourier={!isCourier} t={t} />
            </div>
          ))}
        </div>
      )}

      {(!deliveries || deliveries.length === 0) && (
        <div className="text-center py-20 text-secondary">
          <Truck size={48} className="mx-auto mb-4 opacity-30" />
          <p>{t("Нет заказов на доставку", "Yetkazish uchun buyurtmalar yo'q")}</p>
        </div>
      )}

      {isCourier && <MonthTotals />}

      {failFor && (
        <FailReasonDialog
          orderNumber={failFor.order.orderNumber}
          shopName={failFor.order.shopName}
          busy={markFailed.isPending}
          onCancel={() => setFailFor(null)}
          onConfirm={(c) => markFailed.mutate({ orderId: failFor.order.id, ...c, idempotencyKey: failFor.key, ...freshPlace() })}
          onReschedule={() => { const o = failFor.order; setFailFor(null); openReschedule(o); }}
        />
      )}
      {rescheduleFor && (
        <RescheduleDialog
          mode="courier"
          orderNumber={rescheduleFor.order.orderNumber}
          shopName={rescheduleFor.order.shopName}
          busy={reschedule.isPending}
          onCancel={() => setRescheduleFor(null)}
          onConfirm={(c) => reschedule.mutate({ orderId: rescheduleFor.order.id, ...c, idempotencyKey: rescheduleFor.key, ...freshPlace() })}
        />
      )}
      {proofFor && <ProofSheet target={proofFor} onClose={() => setProofFor(null)} />}
    </div>
  );
}

function MapView({ deliveries }: { deliveries: Delivery[] | undefined }) {
  const t = useTranslate();
  const mapRef = useRef<YandexMap | null>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<YandexPlacemark[]>([]);
  const [ready, setReady] = useState(false);

  const allDeliveries = useMemo(() => deliveries ?? [], [deliveries]);

  const mapMarkers = useMemo(() =>
    allDeliveries
      .filter((d) => d.shopGpsLat && d.shopGpsLng)
      .map((d) => ({
        lat: Number(d.shopGpsLat),
        lng: Number(d.shopGpsLng),
        name: d.shopName ?? t("Магазин", "Do'kon"),
        status: d.deliveryStatus,
      })),
    [allDeliveries, t]
  );
  const hasMarkers = mapMarkers.length > 0;

  /*
    Карта — общим загрузчиком скрипта (lib/yandex-maps.ts). Здесь стояла
    проверка window.ymaps без загрузки: карта появлялась, только если
    скрипт уже подтянула другая страница, а открытая первой — пустой блок.
  */
  useEffect(() => {
    if (!hasMarkers) return;
    let alive = true;
    loadYandexMaps().then(ymaps => ymaps.ready(() => {
      const div = mapDivRef.current;
      if (!alive || !div || mapRef.current) return;
      mapRef.current = new ymaps.Map(div, { center: [41.2995, 69.2401], zoom: 12, controls: ["zoomControl", "fullscreenControl"] });
      setReady(true);
    })).catch(() => { /* без карты список работает */ });
    return () => { alive = false; };
  }, [hasMarkers]);

  useEffect(() => {
    const ymaps = window.ymaps;
    const map = mapRef.current;
    if (!ready || !ymaps || !map) return;
    markersRef.current.forEach((m) => map.geoObjects.remove(m));
    markersRef.current = [];
    mapMarkers.forEach((m) => {
      // Цвет читается из темы значением, а не переменной: SVG ниже уходит в
      // data:-адрес, отдельным документом, и var(--…) там не разбирается —
      // метка выходила чёрной независимо от состояния доставки.
      const color = m.status === "out_for_delivery" ? cssVar("--color-warning-text", "#7a5810")
        : m.status === "delivered" ? cssVar("--color-success-text", "#157a45")
        : cssVar("--color-primary-text", "#53637d");
      // Название магазина вводит человек: в подсказку — только экранированным.
      const b = balloonHtml(m.name);
      const placemark = new ymaps.Placemark(
        [m.lat, m.lng],
        { balloonContentHeader: b.header, hintContent: b.hint },
        {
          iconLayout: "default#imageWithContent",
          iconImageHref: `data:image/svg+xml,${encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
              <circle cx="16" cy="16" r="14" fill="${color}" stroke="white" stroke-width="2"/>
            </svg>
          `)}`,
          iconImageSize: [32, 32],
          iconImageOffset: [-16, -16],
        }
      );
      map.geoObjects.add(placemark);
      markersRef.current.push(placemark);
    });
    if (mapMarkers.length > 1) {
      const bounds = map.geoObjects.getBounds();
      if (bounds) map.setBounds(bounds, { checkZoomRange: true, zoomMargin: 40 });
    } else if (mapMarkers.length === 1) {
      map.setCenter([mapMarkers[0].lat, mapMarkers[0].lng], 14);
    }
  }, [mapMarkers, ready]);

  if (!hasMarkers) return null;

  return (
    <div className="neo-card overflow-hidden" style={{ minHeight: 300, position: "relative" }}>
      <div ref={mapDivRef} style={{ width: "100%", height: "300px", position: "relative" }} />
    </div>
  );
}

/*
  Под номером заказа — что о нём надо знать до выезда: место в маршруте
  (его ставит диспетчер), чей он (офису), на какой день перенесён и не ждёт
  ли он решения офиса. Сервер это отдавал, а карточки не показывали: офис не
  видел, у кого заказ, курьер — свой порядок объезда.
*/
function DeliveryTags({ order, showCourier, t }: { order: Delivery; showCourier: boolean; t: (ru: string, uz: string) => string }) {
  const held = order.status === "pending";
  const tags = [
    order.routeSeq != null && (
      <span key="seq" className="font-data font-bold" title={t("Место в маршруте", "Marshrutdagi o'rni")} data-testid="delivery-route-seq">
        №{order.routeSeq}
      </span>
    ),
    showCourier && order.courierName && (
      <span key="courier" className="flex items-center gap-1" data-testid="delivery-courier"><Truck size={12} />{order.courierName}</span>
    ),
    order.plannedDeliveryDate && (
      <span key="day" className="flex items-center gap-1" data-testid="delivery-planned">
        <CalendarClock size={12} />{t(`на ${ddmm(order.plannedDeliveryDate)}`, `${ddmm(order.plannedDeliveryDate)} ga`)}
      </span>
    ),
    held && (
      <span key="held" className="flex items-center gap-1" style={{ color: "var(--color-warning-text)" }}
        title={t("Заказ ждёт решения офиса — везти рано", "Buyurtma ofis qarorini kutmoqda — olib borishga erta")} data-testid="delivery-held">
        <Hourglass size={12} />{t("Ждёт офиса", "Ofis qarorini kutmoqda")}
      </span>
    ),
  ].filter(Boolean);
  if (tags.length === 0) return null;
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--color-text-secondary)" }}>{tags}</div>;
}

function DeliveryCard({
  order, fmt, t, cashInput, onCashChange, onDeliver, onFail, onReschedule, isPending, canAct, showCourier,
}: {
  order: Delivery;
  fmt: (v: string | number) => string;
  t: (ru: string, uz: string) => string;
  cashInput: string;
  onCashChange: (v: string) => void;
  onDeliver: () => void;
  onFail: () => void;
  onReschedule: () => void;
  isPending: boolean;
  /* Отметить доставку может только сам курьер: сервер ищет заказ с
     courier_id = тот, кто жмёт. Директору и оператору эти кнопки отвечали
     «Заказ не найден или не назначен на вас». */
  canAct: boolean;
  /** Офису — чей заказ. */
  showCourier: boolean;
}) {
  const { lang } = useLang();
  return (
    <div className="neo-card space-y-3" style={{ padding: "16px", borderLeft: "4px solid var(--color-warning)" }}>
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold">{order.orderNumber}</p>
          <p className="text-sm text-secondary">{order.shopName}</p>
        </div>
        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${DELIVERY_STATUS_STYLES[order.deliveryStatus] ?? ""}`}>
          {labelled(DELIVERY_STATUS_LABEL, order.deliveryStatus, lang)}
        </span>
      </div>
      <DeliveryTags order={order} showCourier={showCourier} t={t} />
      {order.shopAddress && (
        <p className="text-xs text-secondary flex items-center gap-1">
          <MapPin size={12} />{order.shopAddress}{order.shopCity ? `, ${order.shopCity}` : ""}
        </p>
      )}
      <p className="font-data text-sm">{fmt(order.total)}</p>
      {Number(order.totalWeightKg ?? 0) > 0 && (
        <p className="text-xs text-secondary flex items-center gap-1">
          <Package size={12} />
          {formatQty(order.totalWeightKg)} {t("кг", "kg")}
        </p>
      )}

      <div className="flex gap-2">
        {order.shopAddress && (
          <a
            href={`https://yandex.ru/maps/?text=${encodeURIComponent(order.shopAddress)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="neo-btn flex items-center gap-2 text-sm flex-1 justify-center"
          >
            <MapPin size={14} />
            {t("На карте", "Xaritada")}
          </a>
        )}
      </div>

      {canAct && (<>
      <div className="border-t border-border-subtle pt-3 space-y-2">
        <label className="text-xs text-secondary">
          {t("Сумма наличных (необязательно)", "Naqd pul miqdori (ixtiyoriy)")}
        </label>
        <input
          type="number"
          value={cashInput}
          onChange={(e) => onCashChange(e.target.value)}
          placeholder="0"
          className="neo-input w-full text-sm"
        />
      </div>

      <button
        onClick={onDeliver}
        disabled={isPending}
        className="w-full neo-btn-primary flex items-center justify-center gap-2 text-sm"
      >
        <CheckCircle2 size={16} />
        {isPending ? t("Отправка...", "Yuborilmoqda...") : t("Доставлено", "Yetkazildi")}
      </button>
      <div className="flex gap-2">
        <button
          onClick={onFail}
          className="flex-1 neo-btn flex items-center justify-center gap-2 text-sm text-danger border-danger/30 hover:bg-danger/10"
          data-testid="courier-fail"
        >
          {t("Не доставлено", "Yetkazilmadi")}
        </button>
        <button
          type="button"
          onClick={onReschedule}
          className="flex-1 neo-btn flex items-center justify-center gap-2 text-sm"
          data-testid="courier-reschedule"
        >
          <CalendarClock size={14} />
          {t("Перенести", "Ko'chirish")}
        </button>
      </div>
      </>)}
    </div>
  );
}
