/**
 * Порядок обхода точек: «ближайший сосед».
 *
 * ── Зачем общий ─────────────────────────────────────────────────────────────
 *
 * Маршрут агента по плану визитов (agent.getOptimizedRoute) считал его прямо
 * в ручке, своим циклом. Курьеру понадобилось то же самое — «Предложить
 * порядок» в развозе (courier.suggestRoute). Две копии одного цикла
 * расходятся при первой правке: агент и курьер, стоящие в одной точке,
 * получили бы разный порядок одних и тех же магазинов.
 *
 * Эвристика простая и честная: из текущей точки — в ближайшую из
 * оставшихся. Это не лучший маршрут (задача коммивояжёра), но предсказуемый,
 * и человек всегда может перетащить остановку руками.
 *
 * ── Точки без координат ─────────────────────────────────────────────────────
 *
 * Магазин без GPS на карте не стоит, и угадывать его место нельзя. Такие
 * точки идут В КОНЕЦ, в том порядке, в каком пришли. Ноль в координате тоже
 * считается «нет координат»: точка (0, 0) — Гвинейский залив, а не магазин;
 * так её понимал и прежний цикл агента.
 *
 * Файл без зависимостей, кроме соседнего geo.ts: его читают и сервер, и экран.
 */
import { haversineKm } from "./geo";

export interface RoutePoint {
  lat: number | string | null | undefined;
  lng: number | string | null | undefined;
}

export interface LatLng { lat: number; lng: number }

/** Координаты точки числами — или null, если их нет. */
export function coordsOf(p: RoutePoint | null | undefined): LatLng | null {
  if (!p) return null;
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!lat || !lng || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Точки в порядке обхода.
 *
 * start — откуда выезжаем. Нет его — из первой точки с координатами (она и
 * становится первой остановкой). Исходный массив не меняется.
 */
export function nearestNeighbour<T extends RoutePoint>(points: readonly T[], start?: LatLng | null): T[] {
  const located: Array<{ p: T; c: LatLng }> = [];
  const unlocated: T[] = [];
  for (const p of points) {
    const c = coordsOf(p);
    if (c) located.push({ p, c });
    else unlocated.push(p);
  }

  const out: T[] = [];
  let here: LatLng | null = start ?? null;
  while (located.length > 0) {
    let best = 0;
    if (here) {
      let bestKm = Infinity;
      for (let i = 0; i < located.length; i++) {
        const km = haversineKm(here.lat, here.lng, located[i].c.lat, located[i].c.lng);
        // Строго меньше: при равных расстояниях выигрывает пришедшая раньше —
        // порядок не прыгает от запуска к запуску.
        if (km < bestKm) { bestKm = km; best = i; }
      }
    }
    const [next] = located.splice(best, 1);
    out.push(next.p);
    here = next.c;
  }
  return [...out, ...unlocated];
}

/**
 * Длина маршрута по порядку, километры: от start (если есть) через все точки
 * с координатами. Точки без координат пропускаются — расстояния до них мы не
 * знаем, и ноль за них был бы выдумкой.
 */
export function routeKm(points: readonly RoutePoint[], start?: LatLng | null): number {
  let km = 0;
  let prev: LatLng | null = start ?? null;
  for (const p of points) {
    const c = coordsOf(p);
    if (!c) continue;
    if (prev) km += haversineKm(prev.lat, prev.lng, c.lat, c.lng);
    prev = c;
  }
  return km;
}
