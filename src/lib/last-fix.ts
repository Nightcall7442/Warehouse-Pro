/*
  Где телефон курьера сейчас — для отметок доставки.

  ── Зачем ───────────────────────────────────────────────────────────────────

  Строка журнала попыток хранит точку отметки («Доставлено», «Не
  доставлено», «Перенести»), и по ней доска развоза ставит отметку на карту,
  а карточка заказа даёт ссылку «Где отмечено». Веб-приложение курьера её
  не слало: точки были только у фонового пинга (hooks/useLocationPing.ts),
  а он хранил лишь время последней отправки.

  ── Как ─────────────────────────────────────────────────────────────────────

  Последняя полученная координата лежит здесь (её кладёт и пинг, и
  warmFix). Отметка берёт её, если ей не больше FIX_MAX_AGE_MS: старая точка
  показала бы отметку там, где курьер был полчаса назад.

  warmFix — свежая точка заранее, когда курьер открывает карточку или окно
  отметки: к нажатию она уже есть, и отметка не ждёт GPS. Разрешение здесь
  НЕ запрашивается — только читается: окно браузера «разрешить доступ к
  местоположению» поверх кнопки «Доставлено» выглядит как сбой. Спрашивает
  его пинг при входе.
*/

/** Точка старше этого для отметки не годится. */
export const FIX_MAX_AGE_MS = 5 * 60_000;

let last: { lat: number; lng: number; at: number } | null = null;

export function rememberFix(pos: { coords: { latitude: number; longitude: number }; timestamp?: number }, now: number = Date.now()): void {
  const { latitude: lat, longitude: lng } = pos.coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  last = { lat, lng, at: pos.timestamp || now };
}

/** Координаты для отметки — строками, как их ждёт сервер; нет свежей точки — пусто. */
export function freshPlace(now: number = Date.now()): { lat?: string; lng?: string } {
  if (!last || now - last.at > FIX_MAX_AGE_MS) return {};
  return { lat: last.lat.toFixed(8), lng: last.lng.toFixed(8) };
}

/** Только для стенда. */
export function forgetFix(): void {
  last = null;
}

/** Взять свежую точку заранее — если доступ к местоположению уже дан. Молча. */
export function warmFix(): void {
  if (typeof navigator === "undefined" || !navigator.geolocation) return;
  const ask = () => navigator.geolocation.getCurrentPosition(
    pos => rememberFix(pos),
    () => { /* нет точки — отметка уйдёт без неё */ },
    { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
  );
  const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
  if (!perms?.query) return;
  perms.query({ name: "geolocation" as PermissionName })
    .then(st => { if (st.state === "granted") ask(); })
    .catch(() => { /* браузер не знает имени — не спрашиваем */ });
}
