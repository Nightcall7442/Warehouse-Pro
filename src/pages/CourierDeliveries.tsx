import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { useState, useRef, useEffect, useMemo } from "react";
import { Truck, MapPin, CheckCircle2, Package, ArrowRight } from "lucide-react";
import { notify } from "@/lib/toast";

const DELIVERY_STATUS_STYLES: Record<string, string> = {
  assigned:        "bg-info/15 text-info border-info/30",
  out_for_delivery:"bg-warning/15 text-warning border-warning/30",
  delivered:       "bg-success/15 text-success border-success/30",
  failed:          "bg-danger/15 text-danger border-danger/30",
};

const DELIVERY_STATUS_LABELS: Record<string, { ru: string; uz: string }> = {
  assigned:        { ru: "Назначен",    uz: "Tayinlangan" },
  out_for_delivery:{ ru: "В пути",      uz: "Yo'lda" },
  delivered:       { ru: "Доставлен",   uz: "Yetkazildi" },
  failed:          { ru: "Ошибка",      uz: "Xato" },
};

export default function CourierDeliveries() {
  const { user } = useAuth();
  const { fmt } = useCurrency();
  const { t } = useLang();
  const utils = trpc.useUtils();
  const [cashInput, setCashInput] = useState<Record<number, string>>({});

  const { data: deliveries, isLoading } = trpc.courier.listMyDeliveries.useQuery(undefined) as { data: any; isLoading: boolean };

  const markOutForDelivery = trpc.courier.markOutForDelivery.useMutation({
    onSuccess: () => {
      utils.courier.listMyDeliveries.invalidate();
      notify.success(t("common.success"));
    },
    onError: (e) => notify.error(e.message),
  });

  const markDelivered = trpc.courier.markDelivered.useMutation({
    onSuccess: () => {
      utils.courier.listMyDeliveries.invalidate();
      notify.success(t("common.success"));
      setCashInput(prev => {
        const next = { ...prev };
        delete next[markDelivered.variables?.orderId ?? 0];
        return next;
      });
    },
    onError: (e) => notify.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 p-4">
        <div className="h-8 w-48 bg-surface-light animate-pulse rounded" />
        <div className="h-32 bg-surface-light animate-pulse rounded" />
        <div className="h-32 bg-surface-light animate-pulse rounded" />
      </div>
    );
  }

  const assigned = (deliveries ?? []).filter((d: any) => d.deliveryStatus === "assigned");
  const inTransit = (deliveries ?? []).filter((d: any) => d.deliveryStatus === "out_for_delivery");

  return (
    <div className="max-w-3xl mx-auto space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Truck size={24} className="text-primary" />
        <div>
          <div style={{ display: "flex", gap: "6px", marginBottom: "4px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-pink, #c06080)", boxShadow: "var(--shadow-xs)" }} />
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-orange, #c49530)", boxShadow: "var(--shadow-xs)" }} />
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-teal, #3a9a8a)", boxShadow: "var(--shadow-xs)" }} />
          </div>
          <h1 className="text-lg font-bold">{t("Мои доставки", "Mening yetkazishlarim")}</h1>
          <p className="text-sm text-secondary">{user?.name}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
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
      {(() => {
        const YANDEX_API_KEY = import.meta.env.VITE_YANDEX_MAPS_API_KEY || "dd072e98-24e7-4b2e-b328-2989bd981fa5";
        const mapRef = useRef<any>(null);
        const mapDivRef = useRef<HTMLDivElement>(null);
        const markersRef = useRef<any[]>([]);

        const allDeliveries = useMemo(() => deliveries ?? [], [deliveries]);

        const mapMarkers = useMemo(() =>
          allDeliveries
            .filter((d: any) => d.shopGpsLat && d.shopGpsLng)
            .map((d: any) => ({
              lat: Number(d.shopGpsLat),
              lng: Number(d.shopGpsLng),
              name: d.shopName ?? "Магазин",
              status: d.deliveryStatus,
            })),
          [allDeliveries]
        );

        useEffect(() => {
          if (!mapDivRef.current || mapRef.current || !window.ymaps) return;

          window.ymaps.ready(() => {
            const center = mapMarkers.length > 0
              ? [mapMarkers.reduce((s, m) => s + m.lat, 0) / mapMarkers.length, mapMarkers.reduce((s, m) => s + m.lng, 0) / mapMarkers.length]
              : [41.2995, 69.2401];

            const map = new window.ymaps.Map(mapDivRef.current!, {
              center,
              zoom: 12,
              controls: ["zoomControl", "fullscreenControl"],
            });

            mapRef.current = map;

            mapMarkers.forEach((m) => {
              const color = m.status === "out_for_delivery" ? "#d4973a" : m.status === "delivered" ? "#34c473" : "#5b6d8a";
              const placemark = new window.ymaps.Placemark(
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
              map.setBounds(map.geoObjects.getBounds(), { checkZoomRange: true, zoomMargin: 40 });
            }
          });
        }, [mapMarkers]);

        useEffect(() => {
          if (!window.ymaps || !mapRef.current) return;
          window.ymaps.ready(() => {
            markersRef.current.forEach(m => mapRef.current!.geoObjects.remove(m));
            markersRef.current = [];
            mapMarkers.forEach((m) => {
              const color = m.status === "out_for_delivery" ? "#d4973a" : m.status === "delivered" ? "#34c473" : "#5b6d8a";
              const placemark = new window.ymaps.Placemark(
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
              mapRef.current!.geoObjects.add(placemark);
              markersRef.current.push(placemark);
            });
            if (mapMarkers.length > 1) {
              mapRef.current!.setBounds(mapRef.current!.geoObjects.getBounds(), { checkZoomRange: true, zoomMargin: 40 });
            }
          });
        }, [mapMarkers]);

        if (mapMarkers.length === 0) return null;

        return (
          <div className="neo-card overflow-hidden" style={{ minHeight: 300, position: "relative" }}>
            <div ref={mapDivRef} style={{ width: "100%", height: "300px", position: "relative" }} />
          </div>
        );
      })()}

      {/* In Transit */}
      {inTransit.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-semibold text-sm text-secondary flex items-center gap-2">
            <Truck size={16} className="text-warning" />
            {t("В пути", "Yo'lda")}
          </h2>
          {inTransit.map((order: {
            id: number;
            orderNumber: string;
            total: string;
            shopName: string | null;
            shopAddress: string | null;
            shopCity: string | null;
            deliveryStatus: string;
          }) => (
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
          {assigned.map((order: {
            id: number;
            orderNumber: string;
            total: string;
            shopName: string | null;
            shopAddress: string | null;
            shopCity: string | null;
            deliveryStatus: string;
          }) => (
            <div key={order.id} className="neo-card" style={{ padding: "16px" }}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold">{order.orderNumber}</p>
                  <p className="text-sm text-secondary">{order.shopName}</p>
                </div>
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${DELIVERY_STATUS_STYLES[order.deliveryStatus] ?? ""}`}>
                  {DELIVERY_STATUS_LABELS[order.deliveryStatus] ? t(DELIVERY_STATUS_LABELS[order.deliveryStatus].ru, DELIVERY_STATUS_LABELS[order.deliveryStatus].uz) : order.deliveryStatus}
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
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.shopAddress)}`}
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
    </div>
  );
}

function DeliveryCard({
  order, fmt, t, cashInput, onCashChange, onDeliver, isPending,
}: {
  order: {
    id: number;
    orderNumber: string;
    total: string;
    totalWeightKg: string;
    shopName: string | null;
    shopAddress: string | null;
    shopCity: string | null;
    deliveryStatus: string;
  };
  fmt: (v: string | number) => string;
  t: (key: string, fallback?: string) => string;
  cashInput: string;
  onCashChange: (v: string) => void;
  onDeliver: () => void;
  isPending: boolean;
}) {
  return (
    <div className="neo-card" style={{ padding: "16px", borderLeft: "4px solid var(--color-warning, #d4973a)" }}>
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold">{order.orderNumber}</p>
          <p className="text-sm text-secondary">{order.shopName}</p>
        </div>
        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${DELIVERY_STATUS_STYLES[order.deliveryStatus] ?? ""}`}>
          {DELIVERY_STATUS_LABELS[order.deliveryStatus] ? t(DELIVERY_STATUS_LABELS[order.deliveryStatus].ru, DELIVERY_STATUS_LABELS[order.deliveryStatus].uz) : order.deliveryStatus}
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
          {Number(order.totalWeightKg).toFixed(1)} кг
        </p>
      )}

      <div className="flex gap-2">
        {order.shopAddress && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.shopAddress)}`}
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
    </div>
  );
}
