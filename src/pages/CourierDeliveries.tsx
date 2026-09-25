import { trpc } from "@/providers/trpc";
import { useInvalidateOrderCaches } from "@/hooks/useOrderCacheSync";
import { useLang, useTranslate } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { cssVar } from "@/lib/css-var";
import { useState, useRef, useEffect, useMemo } from "react";
import { Truck, MapPin, CheckCircle2, Package, ArrowRight, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router";
import { notify } from "@/lib/toast";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { formatQty } from "@/lib/format";
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
      style={{ background: "var(--color-surface)", boxShadow: "var(--shadow-raised)", borderRadius: 24, padding: 20 }}>
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
  const invalidateOrderCaches = useInvalidateOrderCaches();

  const { data: deliveries, isLoading, isLoadingError, refetch } = trpc.courier.listMyDeliveries.useQuery(undefined);

  const markOutForDelivery = trpc.courier.markOutForDelivery.useMutation({
    onSuccess: () => {
      invalidateOrderCaches();
      notify.success(tKey("common.success"));
    },
    onError: (e) => notify.error(e.message),
  });

  const markDelivered = trpc.courier.markDelivered.useMutation({
    onSuccess: () => {
      invalidateOrderCaches();
      notify.success(tKey("common.success"));
      setCashInput(prev => {
        const next = { ...prev };
        delete next[markDelivered.variables?.orderId ?? 0];
        return next;
      });
    },
    onError: (e) => notify.error(e.message),
  });

  const markFailed = trpc.courier.markFailed.useMutation({
    onSuccess: () => {
      invalidateOrderCaches();
      notify.success(t("Доставка отменена", "Yetkazish bekor qilindi"));
    },
    onError: (e) => notify.error(e.message),
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

  const assigned = (deliveries ?? []).filter((d) => d.deliveryStatus === "assigned");
  const inTransit = (deliveries ?? []).filter((d) => d.deliveryStatus === "out_for_delivery");

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

      {/* Map with delivery locations */}
      <div className="hidden md:block"><MapView deliveries={deliveries} /></div>

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
              })}
              onFail={() => markFailed.mutate({ orderId: order.id })}
              isPending={markDelivered.isPending}
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
          {assigned.length > 1 && (
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
                <button
                  onClick={() => markOutForDelivery.mutate({ orderId: order.id })}
                  disabled={markOutForDelivery.isPending}
                  className="neo-btn-primary flex items-center gap-2 text-sm flex-1 justify-center"
                >
                  <ArrowRight size={14} />
                  {t("Взять в доставку", "Yetkazishga olish")}
                </button>
              </div>
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

      <MonthTotals />
    </div>
  );
}

function MapView({ deliveries }: { deliveries: Delivery[] | undefined }) {
  const t = useTranslate();
  const mapRef = useRef<YandexMap | null>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<YandexPlacemark[]>([]);

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

  useEffect(() => {
    const div = mapDivRef.current;
    const ymaps = window.ymaps;
    if (!div || mapRef.current || !ymaps) return;

    ymaps.ready(() => {
      const center = mapMarkers.length > 0
        ? [mapMarkers.reduce((s, m) => s + m.lat, 0) / mapMarkers.length, mapMarkers.reduce((s, m) => s + m.lng, 0) / mapMarkers.length]
        : [41.2995, 69.2401];

      const map = new ymaps.Map(div, {
        center,
        zoom: 12,
        controls: ["zoomControl", "fullscreenControl"],
      });

      mapRef.current = map;

      mapMarkers.forEach((m) => {
        // Цвет читается из темы значением, а не переменной: SVG ниже уходит в
        // data:-адрес, отдельным документом, и var(--…) там не разбирается —
        // метка выходила чёрной независимо от состояния доставки.
        const color = m.status === "out_for_delivery" ? cssVar("--color-warning-text", "#7a5810")
          : m.status === "delivered" ? cssVar("--color-success-text", "#157a45")
          : cssVar("--color-primary-text", "#53637d");
        const placemark = new ymaps.Placemark(
          [m.lat, m.lng],
          {
            balloonContentHeader: `<b style="font-family:Inter,sans-serif;font-size:14px">${m.name}</b>`,
            hintContent: m.name,
          },
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
      }
    });
  }, [mapMarkers]);

  useEffect(() => {
    const ymaps = window.ymaps;
    const map = mapRef.current;
    if (!ymaps || !map) return;
    ymaps.ready(() => {
      markersRef.current.forEach((m) => map.geoObjects.remove(m));
      markersRef.current = [];
      mapMarkers.forEach((m) => {
        const color = m.status === "out_for_delivery" ? "var(--color-warning-text)" : m.status === "delivered" ? "var(--color-success-text)" : "var(--color-primary-text)";
        const placemark = new ymaps.Placemark(
          [m.lat, m.lng],
          {
            balloonContentHeader: `<b style="font-family:Inter,sans-serif;font-size:14px">${m.name}</b>`,
            hintContent: m.name,
          },
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
      }
    });
  }, [mapMarkers]);

  if (mapMarkers.length === 0) return null;

  return (
    <div className="neo-card overflow-hidden" style={{ minHeight: 300, position: "relative" }}>
      <div ref={mapDivRef} style={{ width: "100%", height: "300px", position: "relative" }} />
    </div>
  );
}

function DeliveryCard({
  order, fmt, t, cashInput, onCashChange, onDeliver, onFail, isPending,
}: {
  order: Delivery;
  fmt: (v: string | number) => string;
  t: (ru: string, uz: string) => string;
  cashInput: string;
  onCashChange: (v: string) => void;
  onDeliver: () => void;
  onFail: () => void;
  isPending: boolean;
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
      <button
        onClick={onFail}
        className="w-full neo-btn flex items-center justify-center gap-2 text-sm text-danger border-danger/30 hover:bg-danger/10"
      >
        {t("Не доставлено", "Yetkazilmadi")}
      </button>
    </div>
  );
}
