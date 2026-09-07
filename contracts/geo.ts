/**
 * Расстояние между двумя точками на земле.
 *
 * ── Почему в contracts, а не в api/lib ──────────────────────────────────────
 *
 * Считать его понадобилось обеим сторонам. Сервер меряет, далеко ли агент от
 * магазина при отметке визита, и складывает дневной пробег; экран слежения
 * складывает тот же пробег по тем же точкам, чтобы показать его рядом с
 * маршрутом на карте.
 *
 * Формула, посчитанная на сервере и на экране по-разному, — это два разных
 * километража на одну поездку, и объяснить, какой верный, будет нечем. В
 * api/services/anti-fraud.ts своя копия под именем haversineDistance уже
 * появилась однажды; третьей быть не должно.
 *
 * Файл нарочно без единой зависимости — ни от базы, ни от окружения браузера:
 * contracts читают оба проекта проверки типов, и лишний импорт сломал бы тот
 * из них, где такого окружения нет.
 */

/** Радиус Земли, километры. Средний: разница полюс-экватор здесь несущественна. */
const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Расстояние по большому кругу между двумя точками, километры. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Длина ломаной по точкам GPS, километры.
 *
 * Точек меньше двух — пути нет, и это не ноль: ноль означал бы «стоял на
 * месте», а на деле мы просто не знаем, где он был.
 */
export function pathLengthKm(points: Array<readonly [number, number]>): number | null {
  if (points.length < 2) return null;
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    km += haversineKm(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }
  return km;
}
