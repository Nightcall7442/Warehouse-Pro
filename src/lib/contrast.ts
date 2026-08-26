/**
 * Цвет текста, который будет читаться на выбранном фоне.
 *
 * Нужно там, где фон выбирает не дизайнер, а пользователь: в брендинге тенант
 * задаёт основной цвет сам, и на кнопке предпросмотра было жёстко прописано
 * белым. На тёмно-синем это нормально, а на жёлтом или салатовом — белым по
 * белому: контраст падал до 1.3:1, и надпись пропадала. Причём именно этот
 * цвет потом уезжает на кнопки всего приложения.
 *
 * Порог 0.179 — точка, где относительная яркость даёт одинаковый контраст с
 * чёрным и с белым по формуле WCAG.
 */

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Относительная яркость по WCAG 2.1. Принимает #rgb и #rrggbb. */
export function luminance(hex: string): number {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return 0;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Тёмные чернила на светлом фоне, светлые — на тёмном. */
export function readableInk(background: string): string {
  return luminance(background) > 0.179 ? "#1c1a17" : "#ffffff";
}
