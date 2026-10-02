import { useEffect, useRef, useState } from "react";
import { Hand, Check, MapPin } from "lucide-react";
import { cssVar } from "@/lib/css-var";
import { escapeHtml } from "@/lib/export";
import { loadYandexMaps } from "@/lib/yandex-maps";
import { boundsOf } from "@/components/tracking/map-declutter";
import type { SalesPoint, SalesShopState } from "@contracts/sales-map";

/*
  Карта продаж: магазин — кружок, размер — выручка за период, цвет — что с
  ним. Перекрывающиеся полупрозрачные кружки в плотных кварталах и дают ту
  самую «тепловую» картину: где густо и ярко — покупают, где красные кольца —
  перестали, где серые точки — есть магазины, но не берут.

  Почему кружки, а не слой тепла Яндекса: тепловой слой — отдельный модуль со
  своим скриптом с другого адреса, а кружки рисуются тем же API 2.1, что уже
  работает на карте супервайзера, и по каждому можно нажать.

  ── Прокрутка на телефоне ──────────────────────────────────────────────────

  Карта на телефоне ловила палец: страница не листалась, пока палец над
  картой. Поэтому на телефоне карта сначала накрыта прозрачной подложкой —
  страница под ней листается как обычно; нажатие «Работать с картой» убирает
  подложку, «Готово» возвращает. На компьютере колесо мыши листает страницу,
  а масштаб — кнопками и двойным щелчком.
*/

interface IconOptions {
  iconLayout: "default#image";
  iconImageHref: string;
  iconImageSize: [number, number];
  iconImageOffset: [number, number];
  zIndex: number;
}
interface Feature {
  type: "Feature";
  id: number;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { hintContent: string };
  options: IconOptions;
}
interface ObjectManager {
  add(data: { type: "FeatureCollection"; features: Feature[] }): void;
  removeAll(): void;
  objects: {
    events: { add(type: "click", handler: (e: { get(name: "objectId"): number }) => void): void };
    setObjectOptions(id: number, options: Partial<IconOptions>): void;
  };
}
interface SalesYmap {
  geoObjects: { add(o: ObjectManager): void };
  behaviors: { disable(b: string[]): void };
  setBounds(bounds: number[][], options?: { checkZoomRange?: boolean; zoomMargin?: number }): unknown;
  setCenter(center: number[], zoom?: number): void;
  destroy(): void;
}
/** Та часть API 2.1, которую зовёт эта карта (общие объявления — у карты супервайзера). */
interface SalesYmaps {
  ready(cb: () => void): void;
  Map: new (el: HTMLElement, state: { center: number[]; zoom: number; controls: string[] }, options?: { suppressMapOpenBlock?: boolean }) => SalesYmap;
  ObjectManager: new (options: { clusterize: boolean; geoObjectOpenBalloonOnClick: boolean }) => ObjectManager;
}

const TASHKENT = [41.2995, 69.2401];

/** Диаметр кружка, пикселей: не заказывал — точка, перестал — кольцо, заказывает — по выручке. */
const SIZE: Record<SalesShopState, (grade: number) => number> = {
  idle: () => 10,
  silent: () => 18,
  buying: grade => [14, 14, 20, 28, 38][grade] ?? 14,
};

function icon(state: SalesShopState, grade: number, selected: boolean): IconOptions {
  const d = SIZE[state](grade) + (selected ? 8 : 0);
  const r = d / 2;
  const color = state === "buying" ? cssVar("--color-success", "#22a861")
    : state === "silent" ? cssVar("--color-danger", "#e05050")
    : cssVar("--color-text-tertiary", "#8a8680");
  const ring = selected ? cssVar("--color-primary", "#3b6ea5") : color;
  const fillOpacity = state === "buying" ? 0.42 : state === "silent" ? 0.16 : 0.55;
  const stroke = state === "idle" && !selected ? 0 : selected ? 3 : 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}" viewBox="0 0 ${d} ${d}">`
    + `<circle cx="${r}" cy="${r}" r="${Math.max(1, r - stroke / 2 - 0.5)}" fill="${color}" fill-opacity="${fillOpacity}"`
    + (stroke ? ` stroke="${ring}" stroke-width="${stroke}" stroke-opacity="0.95"` : "") + "/></svg>";
  return {
    iconLayout: "default#image",
    iconImageHref: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    iconImageSize: [d, d],
    iconImageOffset: [-r, -r],
    // Перестали — поверх: красное кольцо под зелёным пятном не увидеть.
    zIndex: selected ? 1000 : state === "silent" ? 300 : state === "buying" ? 200 + grade : 100,
  };
}

export function SalesMapView({ points, fitKey, focus, selectedId, onSelect, phone, height, t }: {
  points: SalesPoint[];
  /** Сменился период или фильтр — карта заново подгоняется под точки. */
  fitKey: string;
  /** «Показать на карте» у района: key растёт с каждым нажатием. */
  focus: { key: number; bounds: [[number, number], [number, number]] } | null;
  selectedId: number | null;
  onSelect: (id: number) => void;
  phone: boolean;
  height: number | string;
  t: (ru: string, uz: string) => string;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<SalesYmap | null>(null);
  const omRef = useRef<ObjectManager | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(false);
  const fittedFor = useRef<string | null>(null);
  const pointsRef = useRef<Map<number, SalesPoint>>(new Map());
  const shownSelected = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadYandexMaps().then(raw => {
      const ymaps = raw as unknown as SalesYmaps;
      ymaps.ready(() => {
        const div = divRef.current;
        if (cancelled || !div || mapRef.current) return;
        const map = new ymaps.Map(div, { center: TASHKENT, zoom: 11, controls: ["zoomControl"] }, { suppressMapOpenBlock: true });
        map.behaviors.disable(["scrollZoom"]);
        const om = new ymaps.ObjectManager({ clusterize: false, geoObjectOpenBalloonOnClick: false });
        om.objects.events.add("click", e => onSelectRef.current(Number(e.get("objectId"))));
        map.geoObjects.add(om);
        mapRef.current = map;
        omRef.current = om;
        setReady(true);
      });
    }, () => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      mapRef.current?.destroy();
      mapRef.current = null;
      omRef.current = null;
    };
  }, []);

  // Точки целиком — только когда сменились данные; выбор меняет одну-две метки.
  useEffect(() => {
    const om = omRef.current;
    if (!ready || !om) return;
    pointsRef.current = new Map(points.map(p => [p.id, p]));
    shownSelected.current = selectedId;
    om.removeAll();
    om.add({
      type: "FeatureCollection",
      features: points.map(p => ({
        type: "Feature", id: p.id,
        geometry: { type: "Point", coordinates: [p.lat, p.lng] },
        properties: { hintContent: escapeHtml(p.name) },
        options: icon(p.state, p.grade, p.id === selectedId),
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- выбор рисует эффект ниже
  }, [points, ready]);

  useEffect(() => {
    const om = omRef.current;
    if (!ready || !om || shownSelected.current === selectedId) return;
    const prev = shownSelected.current != null ? pointsRef.current.get(shownSelected.current) : undefined;
    if (prev) om.objects.setObjectOptions(prev.id, icon(prev.state, prev.grade, false));
    const next = selectedId != null ? pointsRef.current.get(selectedId) : undefined;
    if (next) om.objects.setObjectOptions(next.id, icon(next.state, next.grade, true));
    shownSelected.current = selectedId;
  }, [selectedId, ready]);

  // Подгон под точки — при открытии и при смене периода или фильтра, не на каждом ответе.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || fittedFor.current === fitKey || points.length === 0) return;
    const fit = boundsOf(points.map(p => [p.lat, p.lng]));
    if (!fit) return;
    if ("center" in fit) map.setCenter(fit.center, 15);
    else map.setBounds(fit.bounds, { checkZoomRange: true, zoomMargin: 32 });
    fittedFor.current = fitKey;
  }, [fitKey, points, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus) return;
    const fit = boundsOf(focus.bounds);
    if (!fit) return;
    if ("center" in fit) map.setCenter(fit.center, 15);
    else map.setBounds(fit.bounds, { checkZoomRange: true, zoomMargin: 40 });
  }, [focus, ready]);

  if (failed) {
    return (
      <div className="flex flex-col items-center justify-center text-center p-6" style={{ height }} data-testid="sales-map-failed">
        <MapPin size={32} className="mb-3 opacity-30" style={{ color: "var(--color-text-tertiary)" }} aria-hidden />
        <p className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>{t("Карта не загрузилась", "Xarita yuklanmadi")}</p>
        <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary)" }}>
          {t("Проверьте интернет и обновите страницу — районы и магазины ниже работают и без карты", "Internetni tekshiring va sahifani yangilang — quyidagi hududlar va do'konlar xaritasiz ham ishlaydi")}
        </p>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", height }}>
      {/* zIndex: 0 запирает слои Яндекса внутри карты — их панели идут с z-index в сотни. */}
      <div ref={divRef} style={{ width: "100%", height: "100%", position: "relative", zIndex: 0 }} data-testid="sales-map" />
      {phone && !active && (
        <div style={{ position: "absolute", inset: 0, zIndex: 1, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 12 }}>
          <button type="button" onClick={() => setActive(true)} className="neo-btn tap" style={{ minHeight: 44, padding: "0 16px", gap: 8 }} data-testid="sales-map-activate">
            <Hand size={16} aria-hidden />{t("Работать с картой", "Xarita bilan ishlash")}
          </button>
        </div>
      )}
      {phone && active && (
        <button type="button" onClick={() => setActive(false)} className="neo-btn tap" style={{ position: "absolute", left: 10, top: 10, zIndex: 1, minHeight: 44, padding: "0 14px", gap: 6 }} data-testid="sales-map-done">
          <Check size={16} aria-hidden />{t("Готово", "Tayyor")}
        </button>
      )}
    </div>
  );
}
