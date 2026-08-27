import { trpc } from "@/providers/trpc";
import { useEffect, useRef, useState } from "react";
import { useLang } from "@/i18n";
import { format } from "date-fns";
import { Radio, RefreshCw, MapPin, Wifi, WifiOff, Store } from "lucide-react";
import { TIER_COLOR, TIER_LABEL, TIER_ORDER, money, type ShopTier } from "@/lib/shop-tier";

// Yandex Maps API key
const YANDEX_MAPS_API_KEY = import.meta.env.VITE_YANDEX_MAPS_API_KEY || "dd072e98-24e7-4b2e-b328-2989bd981fa5";

function timeAgo(date: Date, lang: string): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)    return lang === "uz" ? "Hozir"             : "Только что";
  if (diff < 3600)  return lang === "uz" ? `${Math.floor(diff/60)} daq`  : `${Math.floor(diff/60)} мин назад`;
  if (diff < 86400) return lang === "uz" ? `${Math.floor(diff/3600)} soat` : `${Math.floor(diff/3600)} ч назад`;
  return format(date, "dd.MM");
}

function isOnline(createdAt: string | Date | null | undefined): boolean {
  if (!createdAt) return false;
  const diff = (Date.now() - new Date(createdAt).getTime()) / 1000;
  return diff < 600;
}

export default function SupervisorTracking() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: locations, isLoading, refetch, dataUpdatedAt } = trpc.agent.getLocations.useQuery(
    undefined, { refetchInterval: 30_000 }
  );
  // Магазины на той же карте: супервайзер смотрит, где люди, и тут же видит,
  // к каким точкам они едут и что это за точки. Отдельная карта заставляла бы
  // держать две картинки в голове.
  //
  // Своя тысяча — потолок запроса; больше на карту всё равно не помещается
  // осмысленно, а на мобильном канале это уже мегабайты.
  const [showShops, setShowShops] = useState(true);
  const { data: shopScores } = trpc.shop.scores.useQuery({ limit: 1000 }, {
    // Оценка меняется от оплат и заказов, то есть медленно: чаще раза в пять
    // минут её перечитывать незачем, а карта обновляется каждые 30 секунд.
    staleTime: 5 * 60_000,
  });
  const shopMarkersRef = useRef<YandexPlacemark[]>([]);

  const mapRef     = useRef<YandexMap | null>(null);
  const mapDivRef  = useRef<HTMLDivElement>(null);
  const markersMapRef = useRef<Map<number, YandexPlacemark>>(new Map());
  const [selected, setSelected] = useState<number | null>(null);
  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  const [mapError, setMapError] = useState(!YANDEX_MAPS_API_KEY);

  // Initialize map
  function initMap() {
    const div = mapDivRef.current;
    const ymaps = window.ymaps;
    if (!div || mapRef.current) return;
    if (!ymaps) return;

    ymaps.ready(() => {
      const map = new ymaps.Map(div, {
        center: [41.2995, 69.2401],
        zoom: 11,
        controls: ["zoomControl", "fullscreenControl", "geolocationControl"],
      });

      // Style controls
      map.controls.get("zoomControl")?.options.set({ position: { right: 10, top: 10 } });
      map.controls.get("fullscreenControl")?.options.set({ position: { right: 10, top: 50 } });

      mapRef.current = map;
    });
  }

  // Load Yandex Maps API
  useEffect(() => {
    if (!YANDEX_MAPS_API_KEY) return;
    if (window.ymaps) { initMap(); return; }

    const script = document.createElement("script");
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${YANDEX_MAPS_API_KEY}&lang=ru_RU`;
    script.onload = () => initMap();
    script.onerror = () => setMapError(true);
    document.head.appendChild(script);
     
  }, []);

  // Update markers when locations change
  useEffect(() => {
    const ymaps = window.ymaps;
    const map = mapRef.current;
    if (!ymaps || !map || !locations) return;

    ymaps.ready(() => {
      // Remove old markers
      markersMapRef.current.forEach(m => map.geoObjects.remove(m));
      markersMapRef.current = new Map();

      const coords: number[][] = [];

      locations.forEach((loc) => {
        const lat = Number(loc.lat);
        const lng = Number(loc.lng);
        if (!lat || !lng) return;

        const online = isOnline(loc.createdAt);
        const color = online ? "var(--color-success-text)" : "var(--color-text-tertiary, #6b6760)";
        const initial = (loc.agentName ?? "A")[0].toUpperCase();

        const placemark = new ymaps.Placemark(
          [lat, lng],
          {
            balloonContentHeader: `<b style="font-family:Inter,sans-serif;font-size:14px">${loc.agentName ?? t("Агент","Agent")}</b>`,
            balloonContentBody: `
              <div style="font-family:Inter,sans-serif;font-size:12px;color:#666;padding:4px 0">
                ${online ? t("Онлайн","Onlayn") : t("Не в сети","Oflayn")}
                <br/>${Number(loc.lat).toFixed(5)}, ${Number(loc.lng).toFixed(5)}
                ${loc.batteryLevel != null ? `<br/>🔋 ${loc.batteryLevel}%` : ""}
              </div>
            `,
            hintContent: loc.agentName ?? t("Агент","Agent"),
          },
          {
            iconLayout: "default#imageWithContent",
            iconImageHref: `data:image/svg+xml,${encodeURIComponent(`
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
                <circle cx="20" cy="20" r="18" fill="${color}" stroke="white" stroke-width="3"/>
                <circle cx="20" cy="20" r="18" fill="none" stroke="${color}" stroke-width="1" opacity="0.3">
                  <animate attributeName="r" from="18" to="24" dur="2s" repeatCount="indefinite"/>
                  <animate attributeName="opacity" from="0.3" to="0" dur="2s" repeatCount="indefinite"/>
                </circle>
                <text x="20" y="25" text-anchor="middle" fill="white" font-family="Inter,sans-serif" font-weight="700" font-size="15">${initial}</text>
              </svg>
            `)}`,
            iconImageSize: [40, 40],
            iconImageOffset: [-20, -20],
            balloonPanelMaxMapArea: 0,
          }
        );

        map.geoObjects.add(placemark);
        markersMapRef.current.set(loc.agentId, placemark);
        coords.push([lat, lng]);
      });

      // Fit bounds
      if (coords.length > 1) {
        const bounds = map.geoObjects.getBounds();
        if (bounds) {
          map.setBounds(bounds, {
            checkZoomRange: true,
            zoomMargin: 40,
          });
        }
      } else if (coords.length === 1) {
        map.setCenter(coords[0], 14);
      }
    });
  }, [locations]);

  // Магазины отдельным эффектом: они меняются раз в пять минут, а метки
  // агентов — каждые тридцать секунд. В одном эффекте пришлось бы
  // перерисовывать всё вместе, и карта дёргалась бы на каждом опросе.
  useEffect(() => {
    const ymaps = window.ymaps;
    const map = mapRef.current;
    if (!ymaps || !map) return;

    ymaps.ready(() => {
      shopMarkersRef.current.forEach(m => map.geoObjects.remove(m));
      shopMarkersRef.current = [];
      if (!showShops || !shopScores) return;

      shopScores.forEach((shop) => {
        if (shop.lat == null || shop.lng == null) return;
        const color = TIER_COLOR[shop.tier as ShopTier] ?? TIER_COLOR.new;

        const placemark = new ymaps.Placemark(
          [shop.lat, shop.lng],
          {
            balloonContentHeader: `<b style="font-family:Inter,sans-serif;font-size:14px">${shop.name}</b>`,
            balloonContentBody: `
              <div style="font-family:Inter,sans-serif;font-size:12px;color:#666;padding:4px 0;line-height:1.6">
                <div><b style="color:${color}">${TIER_LABEL[shop.tier as ShopTier].ru}</b> — ${shop.reason}</div>
                <div>Принёс за всё время: <b>${money(shop.ltv)}</b></div>
                <div>Заказов: ${shop.orderCount}${shop.debt > 0 ? ` · долг ${money(shop.debt)}` : ""}</div>
              </div>
            `,
            hintContent: `${shop.name} — ${money(shop.ltv)}`,
          },
          {
            // Квадрат со скруглением, а не круг: круги на этой карте уже
            // заняты агентами, и две роли не должны выглядеть одинаково.
            iconLayout: "default#imageWithContent",
            iconImageHref: `data:image/svg+xml,${encodeURIComponent(`
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
                <rect x="2" y="2" width="16" height="16" rx="5" fill="${color}" stroke="white" stroke-width="2"/>
              </svg>
            `)}`,
            iconImageSize: [20, 20],
            iconImageOffset: [-10, -10],
            balloonPanelMaxMapArea: 0,
            // Ниже меток агентов: люди важнее точек, их метка не должна
            // оказаться под магазином.
            zIndex: 100,
          }
        );

        map.geoObjects.add(placemark);
        shopMarkersRef.current.push(placemark);
      });
    });
  }, [shopScores, showShops]);

  // Focus on agent when selected from list
  useEffect(() => {
    const map = mapRef.current;
    if (!selected || !map || !locations) return;
    const loc = locations.find((l) => l.agentId === selected);
    if (loc && Number(loc.lat) && Number(loc.lng)) {
      map.setCenter([Number(loc.lat), Number(loc.lng)], 15);
      // Open balloon
      const pm = markersMapRef.current.get(selected);
      if (pm) pm.balloon.open();
    }
  }, [selected]);

  const onlineCount  = locations?.filter((l) => isOnline(l.createdAt)).length ?? 0;
  const offlineCount = (locations?.length ?? 0) - onlineCount;

  return (
    <div className="space-y-4 animate-fade-up">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-pink, #c06080)", boxShadow: "var(--shadow-xs)" }} />
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-orange, #c49530)", boxShadow: "var(--shadow-xs)" }} />
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-teal, #3a9a8a)", boxShadow: "var(--shadow-xs)" }} />
          </div>
          <h1 className="font-display text-2xl font-bold text-primary tracking-tight">{t("Слежение за агентами", "Agentlarni kuzatish")}</h1>
          {lastUpdate && (
            <p className="text-xs mt-0.5" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
              {t("Обновлено:", "Yangilangan:")} {format(lastUpdate, "HH:mm:ss")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Radio size={13} className="text-success animate-pulse" />
            <span className="font-label text-xs" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
              {t("ПРЯМОЙ ЭФИР · 30 сек", "JONLI · 30 sek")}
            </span>
          </div>
          <button onClick={() => refetch()} className="neo-btn py-1.5 px-3 text-xs flex items-center gap-1.5">
            <RefreshCw size={12} />{t("Обновить", "Yangilash")}
          </button>
        </div>
      </div>

      {/* Mini KPI */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { labelRu: "ОНЛАЙН",    labelUz: "ONLAYN",   value: onlineCount,  icon: Wifi,    color: "green" },
          { labelRu: "НЕ В СЕТИ", labelUz: "OFLAYN",   value: offlineCount, icon: WifiOff, color: "amber" },
          { labelRu: "ВСЕГО",     labelUz: "JAMI",      value: locations?.length ?? 0, icon: MapPin, color: "indigo" },
        ].map((k, idx) => {
          const Icon = k.icon;
          return (
            <div key={k.labelRu} className="kpi-hero stagger-children hover-lift" style={{ animationDelay: `${idx * 60}ms`, padding: "18px" }}>
              <div className={`kpi-icon-box kpi-icon-${k.color} mb-3`}>
                <Icon size={16} />
              </div>
              <p className="font-data text-2xl font-bold text-primary">{k.value}</p>
              <p className="font-label text-[10px] tracking-wider mt-1" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
                {lang === "uz" ? k.labelUz : k.labelRu}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Agent list */}
        <div className="neo-card p-4 lg:col-span-1 order-2 lg:order-1">
          <p className="font-label text-[10px] text-primary tracking-wider mb-3">
            {t("АГЕНТЫ", "AGENTLAR")}
          </p>
          <div className="space-y-2 max-h-[440px] overflow-y-auto">
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 bg-surface-light animate-pulse rounded-xl" />)
              : locations?.length === 0
              ? (
                <div className="text-center py-10">
                  <MapPin size={28} className="mx-auto mb-2 opacity-20 text-secondary" />
                  <p className="text-sm text-secondary">{t("Нет данных о локации", "Joylashuv ma'lumoti yo'q")}</p>
                  <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
                    {t("Агенты делятся геолокацией со страницы GPS", "Agentlar GPS sahifasidan joylashuv ulashadi")}
                  </p>
                </div>
              )
              : locations?.map((loc) => {
                  const online = isOnline(loc.createdAt);
                  return (
                    <div
                      key={loc.id}
                      onClick={() => setSelected(loc.agentId)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all ${
                        selected === loc.agentId
                          ? "border-primary bg-primary/5"
                          : "border-border-custom hover:border-border-strong hover:bg-surface-light/40"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
                          style={{ background: online ? "var(--color-success)" : "var(--color-text-tertiary, #6b6760)" }}>
                          {(loc.agentName ?? "A")[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-primary truncate">
                            {loc.agentName ?? `Agent #${loc.agentId}`}
                          </p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <div className={`w-1.5 h-1.5 rounded-full ${online ? "bg-success" : "bg-warning"}`} />
                            <span className="text-[11px]" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
                              {online
                                ? t("Онлайн", "Onlayn")
                                : loc.createdAt
                                  ? timeAgo(new Date(loc.createdAt), lang)
                                  : t("Нет данных", "Ma'lumot yo'q")}
                            </span>
                            {loc.batteryLevel != null && (
                              <span className="ml-auto text-[10px] font-data flex items-center gap-0.5" style={{ color: loc.batteryLevel < 20 ? "var(--color-danger-text)" : "var(--color-text-tertiary, #6b6760)" }}>
                                🔋 {loc.batteryLevel}%
                              </span>
                            )}
                            {loc.accuracy && (
                              <span className="text-[10px] font-data" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
                                ±{Math.round(Number(loc.accuracy))}м
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {(Number(loc.lat) && Number(loc.lng)) && (
                        <p className="font-data text-[10px] mt-1.5 pl-[46px]" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
                          {Number(loc.lat).toFixed(5)}, {Number(loc.lng).toFixed(5)}
                        </p>
                      )}
                    </div>
                  );
                })}
          </div>
        </div>

        {/* Map */}
        <div className="neo-card lg:col-span-2 order-1 lg:order-2" style={{ minHeight: 480, position: "relative" }}>
          {/* Легенда магазинов.
              Цвет без подписи — ребус: красная точка на карте может означать
              что угодно, от долга до отсутствия связи. */}
          <div className="flex items-center gap-3 flex-wrap px-4 pt-3 pb-1">
            <button onClick={() => setShowShops(v => !v)}
              className="neo-btn neo-btn-sm"
              aria-pressed={showShops}
              style={showShops ? { color: "var(--color-primary)" } : undefined}>
              <Store size={13} />
              {showShops ? t("Магазины на карте", "Xaritada do'konlar") : t("Показать магазины", "Do'konlarni ko'rsatish")}
            </button>
            {showShops && TIER_ORDER.map(tier => {
              const count = shopScores?.filter(sc => sc.tier === tier).length ?? 0;
              if (count === 0) return null;
              return (
                <span key={tier} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-text-secondary)" }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: TIER_COLOR[tier], flexShrink: 0 }} />
                  {t(TIER_LABEL[tier].ru, TIER_LABEL[tier].uz)}
                  <b style={{ color: "var(--color-text-primary)" }}>{count}</b>
                </span>
              );
            })}
          </div>
          {mapError ? (
            <div className="flex flex-col items-center justify-center h-[480px] text-center p-6">
              <MapPin size={32} className="mb-3 opacity-30" style={{ color: "var(--color-text-tertiary)" }} />
              <p className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
                {t("Карта недоступна", "Xarita mavjud emas")}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary)" }}>
                {t("Настройте VITE_YANDEX_MAPS_API_KEY", "VITE_YANDEX_MAPS_API_KEY ni sozlang")}
              </p>
            </div>
          ) : (
            <div ref={mapDivRef} style={{ width: "100%", height: "480px", position: "relative" }} />
          )}
        </div>
      </div>
    </div>
  );
}

// Yandex Maps type declarations — only the surface this app actually calls.
declare global {
  interface YandexPlacemark {
    balloon: { open(): void };
  }

  interface YandexMap {
    geoObjects: {
      add(object: YandexPlacemark): void;
      remove(object: YandexPlacemark): void;
      /** null while the map holds no geo objects. */
      getBounds(): number[][] | null;
    };
    controls: {
      get(name: string): {
        options: { set(options: { position: { left?: number; right?: number; top?: number; bottom?: number } }): void };
      } | undefined;
    };
    setBounds(bounds: number[][], options?: { checkZoomRange?: boolean; zoomMargin?: number }): void;
    setCenter(center: number[], zoom?: number): void;
  }

  interface YandexMaps {
    ready(callback: () => void): void;
    Map: new (element: HTMLElement, options: { center: number[]; zoom: number; controls?: string[] }) => YandexMap;
    Placemark: new (
      geometry: number[],
      properties: { balloonContentHeader?: string; balloonContentBody?: string; hintContent?: string },
      options: {
        iconLayout?: string;
        iconImageHref?: string;
        iconImageSize?: number[];
        iconImageOffset?: number[];
        balloonPanelMaxMapArea?: number;
        /** Метки магазинов уводятся под метки агентов: люди важнее точек. */
        zIndex?: number;
      },
    ) => YandexPlacemark;
  }

  interface Window {
    // Absent until the api-maps.yandex.ru script has loaded.
    ymaps?: YandexMaps;
  }
}
