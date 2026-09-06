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

/** Отношение контраста двух цветов по WCAG 2.1: от 1 (одинаковые) до 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

function toRgb(hex: string): [number, number, number] | null {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");

/**
 * Тот же цвет, но дотянутый до читаемости на заданном фоне.
 *
 * Заливка и надпись — разные роли одного цвета, и путать их нельзя. Арендатор
 * выбирает ОДИН цвет: он идёт на кнопки (там важен контраст надписи НА нём) и
 * на акцентный текст (там важен контраст самого цвета С фоном карточки). У
 * приложения для второй роли есть отдельная переменная --color-primary-text —
 * более тёмный собрат основного цвета, потому что у заливки контраст как у
 * текста ниже нормы.
 *
 * Бренд эту переменную не переопределял: заливка становилась цветом
 * арендатора, а акцентный текст оставался сине-серым цветом системы. В
 * приложении оказывалось два акцента сразу. А в тёмной теме, где
 * --color-primary-text равен самому основному цвету, тёмно-синий выбор
 * арендатора превращался в тёмно-синий текст на почти чёрной карточке.
 *
 * Здесь цвет двигается к белому или к чёрному — смотря что на этом фоне
 * читается, — пока не наберёт нужный контраст. Шаг мелкий, чтобы оттенок
 * оставался узнаваемым: цель — читаемость, а не другой цвет.
 */
export function readableOn(background: string, color: string, target = 4.5): string {
  const rgb = toRgb(color);
  if (!rgb || !toRgb(background)) return color;
  if (contrastRatio(background, color) >= target) return color;

  // Куда двигаться: к белому на тёмном фоне, к чёрному на светлом.
  const towardsWhite = luminance(background) <= 0.179;
  let [r, g, b] = rgb;

  for (let i = 0; i < 40; i++) {
    r = towardsWhite ? r + (255 - r) * 0.06 : r * 0.94;
    g = towardsWhite ? g + (255 - g) * 0.06 : g * 0.94;
    b = towardsWhite ? b + (255 - b) * 0.06 : b * 0.94;
    const candidate = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
    if (contrastRatio(background, candidate) >= target) return candidate;
  }
  // Дотянуть не вышло (бывает у очень насыщенных цветов) — отдаём чернила.
  return readableInk(background);
}
