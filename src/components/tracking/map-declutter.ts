/**
 * Сколько булавок магазинов помещается на экран, не налезая друг на друга.
 *
 * ── Зачем разводить ─────────────────────────────────────────────────────────
 *
 * Магазины в городе стоят вплотную — на соседних улицах, а то и в одном доме.
 * Все булавки подряд превращают карту в кашу: не разобрать ни где какая, ни
 * сколько их. Поэтому на каждом масштабе показывается столько, сколько
 * помещается; остальные ждут приближения, и под картой написано, сколько
 * сейчас видно.
 *
 * ── Что было сломано ────────────────────────────────────────────────────────
 *
 * Окно, за краем которого метку считать незачем, бралось из
 * `map.container.getSize()` — то есть от левого верхнего угла КОНТЕЙНЕРА, — а
 * координаты самих меток приходили из `map.converter.globalToPage()`, то есть
 * от левого верхнего угла СТРАНИЦЫ. Две разные системы отсчёта в одном
 * сравнении.
 *
 * На этой странице карта начиналась примерно с 440-й точки по горизонтали и
 * с 330-й по вертикали, а прокрутка добавляла ещё. Метка в правой нижней
 * части карты получала координаты заведомо больше ширины и высоты
 * контейнера, объявлялась «за краем экрана» и пряталась — хотя лежала на
 * самом видном месте. Отсюда и «видно 0 из 73» при полной карте магазинов.
 *
 * Поэтому окно теперь передаётся снаружи и ОБЯЗАНО быть в той же системе
 * координат, что и точки. Проверять это в бою нечем, зато можно тестом — он
 * рядом, в tracking.test.ts.
 */

/** Видимый след булавки в пикселях, считая от точки привязки. */
export interface PinFootprint {
  halfWidth: number;
  above: number;
  below: number;
}

/** Окно карты в той же системе координат, что и точки. */
export interface MapViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Запас за краем окна.
 *
 * Метка, чей значок наполовину заехал за край, всё равно видна человеку —
 * обрезать её ровно по границе значит мигать ею при каждом сдвиге карты.
 */
const MARGIN = 80;

/**
 * Сетка размером примерно с булавку: метка сверяется только с соседними
 * клетками, а не со всеми уже расставленными. Иначе на тысяче магазинов
 * каждый сдвиг карты стоил бы полумиллиона сравнений.
 */
const CELL = 64;

/**
 * Какие точки показывать.
 *
 * Порядок входного списка — это приоритет: кто раньше, тот занимает место.
 * Вызывающий сортирует его так, чтобы проблемный магазин не оказался тем,
 * кого заслонили.
 *
 * Возвращается массив той же длины и в том же порядке.
 */
export function visiblePins(
  points: readonly { x: number; y: number }[],
  view: MapViewport,
  footprint: PinFootprint,
): boolean[] {
  const grid = new Map<string, number[][]>();
  const result: boolean[] = [];

  const minX = view.left - MARGIN;
  const minY = view.top - MARGIN;
  const maxX = view.left + view.width + MARGIN;
  const maxY = view.top + view.height + MARGIN;

  for (const p of points) {
    if (p.x < minX || p.y < minY || p.x > maxX || p.y > maxY) {
      // За краем окна место не занимается: оно нужно тем, кто на виду.
      result.push(false);
      continue;
    }

    const box = [
      p.x - footprint.halfWidth, p.y - footprint.above,
      p.x + footprint.halfWidth, p.y + footprint.below,
    ];
    const cx = Math.floor(p.x / CELL);
    const cy = Math.floor(p.y / CELL);

    let free = true;
    for (let i = cx - 1; i <= cx + 1 && free; i++) {
      for (let j = cy - 1; j <= cy + 1 && free; j++) {
        for (const other of grid.get(`${i}:${j}`) ?? []) {
          if (box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1]) {
            free = false;
            break;
          }
        }
      }
    }

    result.push(free);
    if (!free) continue;

    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cy - 1; j <= cy + 1; j++) {
        const key = `${i}:${j}`;
        const cell = grid.get(key);
        if (cell) cell.push(box);
        else grid.set(key, [box]);
      }
    }
  }

  return result;
}

/**
 * Границы, в которые вписываются все точки.
 *
 * null — вписывать нечего. Отдельный ответ для случая, когда точки совпали
 * или она одна: у таких «границ» нулевой размер, и карта, которой их отдать,
 * уезжает на предельное приближение — вместо города остаётся один двор.
 */
export function boundsOf(points: readonly number[][]): { bounds: number[][] } | { center: number[] } | null {
  if (points.length === 0) return null;

  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  // Порог в сотую долю градуса — примерно километр. Меньше — рамка уже не
  // несёт смысла, и честнее просто встать в центр.
  if (maxLat - minLat < 0.01 && maxLng - minLng < 0.01) {
    return { center: [(minLat + maxLat) / 2, (minLng + maxLng) / 2] };
  }
  return { bounds: [[minLat, minLng], [maxLat, maxLng]] };
}
