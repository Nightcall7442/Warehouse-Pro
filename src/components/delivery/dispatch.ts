import { escapeHtml } from "@/lib/export";

/*
  Чистые правила доски развоза — отдельно от карты и перетаскивания, чтобы
  их можно было проверить без браузера.
*/

/**
 * Порядок на экране: свой (перетащенный или предложенный) поверх серверного.
 *
 * Пока диспетчер двигал остановки, список мог обновиться: заказ довезли
 * (ушёл), офис назначил новый (пришёл). Ушедшие выпадают, пришедшие встают в
 * конец в серверном порядке — иначе «Сохранить» отправил бы чужой или
 * пропустил новый заказ.
 */
export function mergeOrder(serverIds: readonly number[], localIds: readonly number[] | null): number[] {
  if (!localIds) return [...serverIds];
  const present = new Set(serverIds);
  const kept = localIds.filter(id => present.has(id));
  const seen = new Set(kept);
  return [...kept, ...serverIds.filter(id => !seen.has(id))];
}

/** Порядок изменён относительно сохранённого. */
export function orderChanged(serverIds: readonly number[], shown: readonly number[]): boolean {
  return serverIds.length !== shown.length || serverIds.some((id, i) => id !== shown[i]);
}

/**
 * Подсказка метки на карте — разметкой, которую карта вставит как HTML.
 *
 * Имя магазина, номер заказа и имя курьера вводит человек; кавычка или
 * угловая скобка в названии ломали подсказку, а «<img onerror>» выполнился
 * бы на экране офиса. Поэтому каждая строка — через escapeHtml, без
 * исключений.
 */
export function balloonHtml(title: string | null | undefined, lines: ReadonlyArray<string | null | undefined> = []): { header: string; body: string; hint: string } {
  const hint = escapeHtml(title ?? "");
  const header = `<b style="font-family:Inter,sans-serif;font-size:14px">${hint}</b>`;
  const body = lines.filter((l): l is string => !!l)
    .map(l => `<div style="font-family:Inter,sans-serif;font-size:12px">${escapeHtml(l)}</div>`)
    .join("");
  return { header, body, hint };
}

/** Координаты числами; пустые и нулевые — null (незаполненное поле, а не точка в океане). */
export function latLng(lat: unknown, lng: unknown): [number, number] | null {
  const la = Number(lat), lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || la === 0 || lo === 0) return null;
  return [la, lo];
}
