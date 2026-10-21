/*
  Ссылки и ключи экранов доставки — отдельно от компонентов (быстрая
  перезагрузка разработки требует, чтобы файл компонента отдавал только
  компоненты) и чтобы их можно было проверить без отрисовки.
*/

/** Ссылка на карту по точке отметки — только из чисел. */
export function mapLink(lat: unknown, lng: unknown): string | null {
  const la = Number(lat), lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || la === 0 || lo === 0) return null;
  return `https://yandex.ru/maps/?pt=${lo},${la}&z=17&l=map`;
}

/** Текст для пересылки ссылки магазину: на двух языках — язык магазина здесь неизвестен. */
export function trackingShareText(number: string): string {
  return `Заказ ${number}: где он сейчас / Buyurtma ${number}: hozir qayerda`;
}

export function telegramShareUrl(url: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}

/** Ключ записи попытки: повторное нажатие или повтор запроса не пишет вторую строку журнала. */
export function newEventKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
