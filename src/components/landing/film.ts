/*
  Плёнки лендинга: сколько кадров и какого размера лежит в
  public/landing/film/<name>/NNN.webp. Файл пишет scripts/landing-film.mjs —
  руками не править, иначе холст попросит кадр, которого нет.

  warehouse — Higgsfield Seedance 2.0, 5 с, 1080p, без звука
  (job 58a638cd-8fd1-45ec-bf8b-0c78539d9948, 16.09.2026); 14 к/с, 1280 px,
  webp q76 — 71 кадр, 3,3 МБ. Промпт: медленный проезд по складу на
  рассвете к машине у рампы, без людей и надписей.
*/
export const FILM = {
  warehouse: { count: 71, width: 1280, height: 720, fps: 14 },
} as const;
