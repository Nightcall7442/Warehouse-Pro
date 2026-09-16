/**
 * Бренд: из одного цвета — палитра, которая сочетается в обеих темах.
 *
 * Директор: «какой цвет ни поставь — не сочетается». Цвет шёл в обе темы как
 * есть, наведение — вторым цветом, выбранным руками. Теперь тон — его, а
 * светлота и насыщенность подгоняются под тему в OKLCH.
 *
 *   · тон сохраняется: заливка, наведение и текст — того же оттенка;
 *   · светлая тема: заливка средней светлоты, белая или тёмная надпись 4.5:1;
 *     тёмная тема: заливка светлее, чем в светлой, и не неоновая;
 *   · акцентный текст читается на карточке своей темы;
 *   · наведение — шаг светлоты, не второй цвет; серый остаётся серым;
 *   · в настройках один выбор цвета; вторичный больше не спрашивается;
 *   · hex туда-обратно не плывёт.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { derivePalette, hexToOklch, oklchToHex, CARD } from "../lib/brand-palette";
import { contrastRatio } from "../lib/contrast";
import { brandCss } from "../hooks/useBranding";

const ROOT = join(__dirname, "..", "..");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\r\n]*\/\/.*$/gm, "");
const read = (p: string) => strip(readFileSync(join(ROOT, p), "utf8"));

const hueDiff = (a: string, b: string) => {
  const d = Math.abs(hexToOklch(a)!.H - hexToOklch(b)!.H) % 360;
  return Math.min(d, 360 - d);
};

const BRANDS = { "жёлтый": "#e6c700", "тёмно-синий": "#12204a", "красный": "#ff0000", "фиолетовый": "#7c3aed", "бирюзовый": "#00b8a9", "латунь": "#c9a227" };

describe("палитра из одного цвета", () => {
  for (const [name, hex] of Object.entries(BRANDS)) {
    it(`${name} ${hex}: тон свой, читается в обеих темах, тёмная светлее светлой`, () => {
      const light = derivePalette(hex, "light")!, dark = derivePalette(hex, "dark")!;
      for (const [theme, p] of [["light", light], ["dark", dark]] as const) {
        for (const k of ["primary", "hover", "text"] as const) expect(hueDiff(hex, p[k]), `${theme}.${k} ушёл от тона`).toBeLessThanOrEqual(12);
        expect(contrastRatio(p.primary, p.onPrimary), `${theme}: надпись на заливке`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(CARD[theme], p.text), `${theme}: текст на карточке`).toBeGreaterThanOrEqual(4.5);
        expect(p.hover, `${theme}: наведение равно заливке`).not.toBe(p.primary);
        expect(hueDiff(p.primary, p.hover)).toBeLessThanOrEqual(3);
      }
      const lL = hexToOklch(light.primary)!.L, dL = hexToOklch(dark.primary)!.L;
      expect(lL).toBeGreaterThanOrEqual(0.40); expect(lL).toBeLessThanOrEqual(0.62);
      expect(dL).toBeGreaterThanOrEqual(0.68); expect(dL).toBeLessThanOrEqual(0.84);
      expect(hexToOklch(dark.primary)!.C, "тёмная тема: неон").toBeLessThanOrEqual(0.145);
    });
  }

  it("серый и чёрный не розовеют: насыщенность остаётся нулевой", () => {
    for (const hex of ["#808080", "#000000", "#ffffff"]) {
      expect(hexToOklch(derivePalette(hex, "dark")!.primary)!.C).toBeLessThan(0.01);
      expect(hexToOklch(derivePalette(hex, "light")!.primary)!.C).toBeLessThan(0.01);
    }
  });

  it("латунь тёмной темы — как в таблице стилей: свой цвет продукта система не портит", () => {
    expect(derivePalette("#c9a227", "dark")!.primary).toBe("#c9a227");
  });

  it("hex → OKLCH → hex не плывёт; цвет вне охвата теряет насыщенность, а не тон", () => {
    for (const hex of ["#e6c700", "#12204a", "#2563eb", "#7c3aed"]) expect(oklchToHex(hexToOklch(hex)!)).toBe(hex);
    const wild = oklchToHex({ L: 0.6, C: 0.4, H: 150 });
    expect(wild).toMatch(/^#[0-9a-f]{6}$/);
    expect(hueDiff(wild, oklchToHex({ L: 0.6, C: 0.1, H: 150 }))).toBeLessThanOrEqual(6);
    expect(derivePalette("не цвет", "light")).toBeNull();
  });
});

describe("правила бренда в таблице", () => {
  it("обе темы, все роли; вторичного цвета нет", () => {
    const css = brandCss("#12204a");
    const [light, dark] = css.split("\n");
    for (const block of [light, dark]) {
      for (const v of ["--color-primary:", "--color-primary-hover:", "--color-primary-subtle:", "--color-primary-muted:", "--color-on-primary:", "--color-primary-text:", "--primary:", "--primary-foreground:", "--ring:"]) expect(block).toContain(v);
    }
    expect(light).not.toBe(dark);
    const hook = read("src/hooks/useBranding.ts");
    expect(hook).toContain("export function brandCss(primary: string): string");
    expect(hook).toContain("el.textContent = brandCss(primary);");
  });

  it("в настройках — один выбор цвета и предпросмотр обеих тем", () => {
    const page = read("src/components/settings/BrandingSettings.tsx");
    expect((page.match(/type="color"/g) ?? []).length).toBe(1);
    expect(page).not.toContain("Вторичный");
    expect(page).toContain('data-testid="brand-preview"');
    expect(page).toContain('(["light", "dark"] as Theme[]).map');
    // Вторичный цвет в базу уходит производным, не выбранным.
    expect(page).toContain('derivePalette(f.primaryColor, "light")?.hover');
  });
});
