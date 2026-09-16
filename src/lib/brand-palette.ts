import { contrastRatio, readableInk } from "./contrast";

/*
  Палитра бренда из ОДНОГО цвета.

  ── Что было ────────────────────────────────────────────────────────────────

  Цвет арендатора шёл в обе темы как есть: hex на кнопки, второй hex (тоже
  выбранный руками) на наведение. Тёмно-синий на тёмной карточке — грязь,
  жёлтый на светлой — вырви глаз, а «вторичный» цвет никогда не был родным
  первому: два независимых выбора почти всегда спорят. Директор прав: какой
  цвет ни поставь — не сочетается.

  ── Что теперь ──────────────────────────────────────────────────────────────

  Один цвет — оттенок. Всё остальное считается в OKLCH, где светлота и
  насыщенность отделены от тона: тон арендатора остаётся, а светлота и
  насыщенность подгоняются под тему. В светлой теме заливка — средней
  светлоты, текст — темнее до контраста 4.5:1 с карточкой; в тёмной — заливка
  светлая и чуть приглушённая (светится, а не режет), текст — светлее до того
  же контраста. Наведение и нажатие — шаг светлоты, не второй цвет.

  Так любой оттенок садится на обе темы, и «сочетается» становится
  свойством системы, а не удачей выбора.
*/

export type Theme = "light" | "dark";
export interface BrandPalette {
  /** Заливка кнопок, активный пункт меню. */
  primary: string;
  hover: string;
  active: string;
  /** Надпись НА заливке. */
  onPrimary: string;
  /** Акцентный текст на карточке — ссылки, роль, подписи. */
  text: string;
  /** Приглушённый: рамки, вторичные метки. */
  muted: string;
  /** Подложка 10–12 %: фон активного пункта, чипов. */
  subtle: string;
}

/* Фон карточки в каждой теме — из index.css (--color-surface). */
export const CARD: Record<Theme, string> = { light: "#efedea", dark: "#221f1c" };
/* Поверхности предпросмотра обеих тем разом — токены темы одну тему дают, а показать надо две. */
export const PREVIEW: Record<Theme, { bg: string; ink: string; sub: string }> = {
  light: { bg: "#f6f4f1", ink: "#1c1a17", sub: "#6b665f" },
  dark:  { bg: "#171513", ink: "#f3efe8", sub: "#a39d93" },
};

/* ── OKLCH ─────────────────────────────────────────────────────────────── */
type Oklch = { L: number; C: number; H: number };

const toLin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function parseHex(hex: string): [number, number, number] | null {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

export function hexToOklch(hex: string): Oklch | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  const C = Math.hypot(a, bb);
  const H = C < 1e-4 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { L, C, H };
}

function oklchToRgb({ L, C, H }: Oklch): [number, number, number] {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

/** В hex; цвет вне sRGB теряет насыщенность, пока не войдёт — тон и светлота остаются. */
export function oklchToHex(c: Oklch): string {
  let { C } = c;
  let rgb = oklchToRgb({ ...c, C });
  const inGamut = (v: number[]) => v.every(x => x >= -0.0005 && x <= 1.0005);
  for (let i = 0; i < 24 && !inGamut(rgb); i++) { C *= 0.85; rgb = oklchToRgb({ ...c, C }); }
  return "#" + rgb.map(v => Math.round(clamp(toSrgb(clamp(v, 0, 1)), 0, 1) * 255).toString(16).padStart(2, "0")).join("");
}

const rgba = (hex: string, alpha: number) => {
  const [r, g, b] = parseHex(hex) ?? [0, 0, 0];
  return `rgba(${r},${g},${b},${alpha})`;
};

/** Текст того же тона: светлота двигается от фона, пока не наберёт контраст. */
function readableText(card: string, base: Oklch, from: number, dir: 1 | -1, target = 4.5): string {
  const C = Math.min(base.C, 0.14);
  for (let L = from; L >= 0.15 && L <= 0.97; L += 0.01 * dir) {
    const hex = oklchToHex({ L, C, H: base.H });
    if (contrastRatio(card, hex) >= target) return hex;
  }
  return readableInk(card);
}

/** Заливка, на которой читается надпись: если чернила не набирают 4.5:1 — светлота уходит от них. */
function readableFill(base: Oklch, dir: 1 | -1): { fill: string; ink: string } {
  let L = base.L;
  for (let i = 0; i < 20; i++) {
    const fill = oklchToHex({ ...base, L });
    const ink = readableInk(fill);
    if (contrastRatio(fill, ink) >= 4.5) return { fill, ink };
    L = clamp(L + 0.02 * dir, 0.2, 0.95);
  }
  const fill = oklchToHex({ ...base, L });
  return { fill, ink: readableInk(fill) };
}

export function derivePalette(brand: string, theme: Theme): BrandPalette | null {
  const base = hexToOklch(brand);
  if (!base) return null;
  const card = CARD[theme];
  if (theme === "light") {
    const b = { L: clamp(base.L, 0.42, 0.60), C: Math.min(base.C, 0.16), H: base.H };
    const { fill, ink } = readableFill(b, -1);
    const L = hexToOklch(fill)!.L;
    return {
      primary: fill, onPrimary: ink,
      hover: oklchToHex({ ...b, L: L - 0.05 }), active: oklchToHex({ ...b, L: L - 0.09 }),
      text: readableText(card, b, Math.min(L, 0.50), -1),
      muted: oklchToHex({ L: 0.72, C: b.C * 0.45, H: b.H }),
      subtle: rgba(fill, 0.10),
    };
  }
  // Серый остаётся серым: минимальная насыщенность — только для цветных, иначе чёрный бренд розовеет.
  const grey = base.C < 0.02;
  const b = { L: clamp(base.L, 0.70, 0.80), C: grey ? 0 : clamp(base.C, 0.05, 0.14), H: base.H };
  const { fill, ink } = readableFill(b, 1);
  const L = hexToOklch(fill)!.L;
  return {
    primary: fill, onPrimary: ink,
    hover: oklchToHex({ ...b, L: Math.min(0.92, L + 0.05) }), active: oklchToHex({ ...b, L: Math.min(0.95, L + 0.09) }),
    text: readableText(card, b, Math.max(L, 0.72), 1),
    muted: oklchToHex({ L: 0.36, C: b.C * 0.6, H: b.H }),
    subtle: rgba(fill, 0.12),
  };
}
