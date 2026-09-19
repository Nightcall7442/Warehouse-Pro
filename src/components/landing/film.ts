/*
  Плёнки лендинга: сколько кадров и какого размера лежит в
  public/landing/film/<name>/w<width>/NNN.webp — по папке на ширину, холст
  берёт ту, что по экрану (телефону незачем тянуть 1920). Файл пишет
  scripts/landing-film.mjs — руками не править, иначе холст попросит кадр,
  которого нет.

  warehouse — Kling 3.0 pro, 8 с, 1080p, без звука
  (job c6dd6e96-fc96-4d40-9fc6-27b8dcfb924d, 19.09.2026; 14 кредитов за
  дубль, второй дубль 992a3a6b… — холоднее по свету, не взят); 8 к/с, webp
  q66/q70 — 64 кадра, 5,6 МБ в 1920 и 2,6 МБ в 960. Промпт: непрерывный
  медленный проезд по проходу склада напитков на рассвете к открытым воротам
  и машине у рампы, без людей, надписей и склеек.
*/
export const FILM = {
  warehouse: { count: 64, width: 1920, height: 1080, fps: 8, widths: [960, 1920] },
} as const;

/** Первая ширина, которой хватает на экран (в физических точках); шире всех — последняя. */
export function pickFilmWidth(widths: readonly number[], screenPx: number): number {
  return widths.find(w => w >= screenPx) ?? widths[widths.length - 1];
}
