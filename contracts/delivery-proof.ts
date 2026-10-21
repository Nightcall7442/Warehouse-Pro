/**
 * Подтверждение вручения — пределы и подпись числами.
 *
 * Одно правило для сервера (courier.saveProof проверяет), веба (курьер
 * расписывается на экране, карточка заказа рисует подпись) и мобилки
 * следующим шагом. Держать копии порознь значит однажды получить подпись,
 * которую экран сохранил, а сервер отверг: «распишитесь ещё раз» у прилавка,
 * когда магазин уже ушёл.
 *
 * ── Подпись — только числа ──────────────────────────────────────────────────
 *
 * Рамка w×h (бо́льшая сторона — SIGNATURE_SCALE) и штрихи плоскими парами
 * x,y внутри неё. Ни картинки, ни разметки: из чисел экран сам собирает
 * ломаную, и выполнить в подписи нечего — ни на сервере, ни в карточке
 * заказа у офиса.
 */

/** Снимков к одной доставке. */
export const PROOF_MAX_PHOTOS = 3;
/** Сколько дней после доставки принимается подтверждение. */
export const PROOF_WINDOW_DAYS = 7;
/** Длина data:-строки одного снимка: сжатое на телефоне фото — около полумегабайта, запас вдвое. */
export const PROOF_PHOTO_MAX_CHARS = 1_500_000;
/** Подпись: штрихов и точек — с запасом на неторопливую роспись, но не на картину. */
export const SIGNATURE_MAX_STROKES = 50;
export const SIGNATURE_MAX_POINTS = 3000;
/** Точек в одном штрихе (вход ручки — до 2000 чисел на штрих). */
export const SIGNATURE_STROKE_MAX_POINTS = 1000;
export const SIGNATURE_SCALE = 1000;

export interface Signature { w: number; h: number; strokes: number[][] }

/** Что не так с подписью; null — всё в порядке. */
export function signatureProblem(s: Signature): string | null {
  const isInt = (n: unknown) => typeof n === "number" && Number.isInteger(n);
  if (!isInt(s.w) || !isInt(s.h) || s.w < 1 || s.h < 1 || s.w > SIGNATURE_SCALE || s.h > SIGNATURE_SCALE) return "frame";
  if (!Array.isArray(s.strokes) || s.strokes.length === 0 || s.strokes.length > SIGNATURE_MAX_STROKES) return "strokes";
  let points = 0;
  for (const st of s.strokes) {
    if (!Array.isArray(st) || st.length < 2 || st.length % 2 !== 0) return "stroke";
    if (st.length / 2 > SIGNATURE_STROKE_MAX_POINTS) return "stroke";
    for (let i = 0; i < st.length; i += 2) {
      const x = st[i], y = st[i + 1];
      if (!isInt(x) || !isInt(y) || x < 0 || y < 0 || x > s.w || y > s.h) return "point";
    }
    points += st.length / 2;
  }
  return points > SIGNATURE_MAX_POINTS ? "points" : null;
}

export interface RawPoint { x: number; y: number }

/**
 * Росчерки с экрана (в точках холста) — в подпись для сервера.
 *
 * Бо́льшая сторона холста становится SIGNATURE_SCALE, координаты — целыми
 * внутри рамки. Повторы подряд выкидываются; если точек больше предела,
 * штрихи прореживаются равномерно (первая и последняя точка штриха
 * остаются — иначе буквы теряют концы). Пустая роспись — null.
 */
export function normalizeSignature(strokes: readonly (readonly RawPoint[])[], width: number, height: number): Signature | null {
  if (!(width > 0) || !(height > 0)) return null;
  const k = SIGNATURE_SCALE / Math.max(width, height);
  const w = Math.max(1, Math.min(SIGNATURE_SCALE, Math.round(width * k)));
  const h = Math.max(1, Math.min(SIGNATURE_SCALE, Math.round(height * k)));
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)));

  let cleaned: number[][] = [];
  for (const stroke of strokes) {
    const flat: number[] = [];
    for (const p of stroke) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const x = clamp(p.x * k, w), y = clamp(p.y * k, h);
      const n = flat.length;
      if (n >= 2 && flat[n - 2] === x && flat[n - 1] === y) continue;
      flat.push(x, y);
    }
    if (flat.length >= 2) cleaned.push(flat);
  }
  if (cleaned.length === 0) return null;
  // Лишние штрихи — последние: обычно это случайные касания после росписи.
  cleaned = cleaned.slice(0, SIGNATURE_MAX_STROKES);

  // Шаг прореживания — наименьший, при котором влезают оба предела. Оценка
  // делением ошибается на единицу (последняя точка штриха добавляется сверху),
  // поэтому шаг подбирается, а не вычисляется.
  const fits = (list: number[][]) =>
    list.reduce((s, st) => s + st.length / 2, 0) <= SIGNATURE_MAX_POINTS
    && list.every(st => st.length / 2 <= SIGNATURE_STROKE_MAX_POINTS);
  let thinned = cleaned;
  for (let step = 2; !fits(thinned); step++) thinned = cleaned.map(st => thin(st, step));
  return { w, h, strokes: thinned };
}

/** Каждая step-я точка штриха, первая и последняя — всегда. */
function thin(flat: number[], step: number): number[] {
  const n = flat.length / 2;
  if (n <= 2) return flat;
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(flat[2 * i], flat[2 * i + 1]);
  if ((n - 1) % step !== 0) out.push(flat[2 * (n - 1)], flat[2 * (n - 1) + 1]);
  return out;
}

/**
 * Штрихи подписи — строками для `<polyline points>`.
 *
 * Строка собирается ТОЛЬКО из конечных чисел: подпись приходит из базы, и
 * если в ней окажется что-то кроме чисел (старая запись, правка руками),
 * такой штрих выпадает целиком, а не попадает в разметку.
 */
export function signaturePolylines(s: { w?: unknown; h?: unknown; strokes?: unknown } | null | undefined): { w: number; h: number; lines: string[] } | null {
  if (!s) return null;
  const w = Number(s.w), h = Number(s.h);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0 || !Array.isArray(s.strokes)) return null;
  const lines: string[] = [];
  for (const st of s.strokes) {
    if (!Array.isArray(st) || st.length < 2) continue;
    if (!st.every(v => typeof v === "number" && Number.isFinite(v))) continue;
    const pairs: string[] = [];
    for (let i = 0; i + 1 < st.length; i += 2) pairs.push(`${st[i]},${st[i + 1]}`);
    // Одна точка — тоже росчерк: рисуем её крошечным отрезком.
    if (pairs.length === 1) pairs.push(`${st[0] + 1},${st[1]}`);
    lines.push(pairs.join(" "));
  }
  return lines.length ? { w, h, lines } : null;
}
