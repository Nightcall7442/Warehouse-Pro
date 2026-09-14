import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { WEB_SHOTS, MOBILE_SHOTS, MANUAL_PAGES, WEB_ASPECT, MOBILE_ASPECT, MAP_CROP_ASPECT } from "@/components/landing/shots";

/**
 * Лендинг показывает настоящую программу.
 *
 * Владелец зачеркнул нарисованные окна, карту из квадратиков и стоковое
 * фото: покупатель должен видеть ту программу, которую купит. Снимки делает
 * CI (scripts/screenshots.mjs на ветках docs/landing-*), scripts/landing_shots.py
 * приводит их к весу и пишет manifest.json с размерами.
 *
 * Что стережётся:
 *   · каждый кадр из манифеста shots.ts лежит в public/landing на обоих языках;
 *   · пропорции в shots.ts совпадают с файлами — иначе телефон в оправе
 *     выходит приземистым («жирным», по слову владельца) или обрезанным;
 *   · на лендинге нет Ташкента — засев и тексты переведены в Ургенч;
 *   · anime.js грузится лениво и уважает «уменьшить движение»;
 *   · глава о справке не называет цену.
 */
const ROOT = process.cwd();
const LANDING = path.join(ROOT, "src", "components", "landing");
const PUBLIC = path.join(ROOT, "public", "landing");
const read = (p: string) => readFileSync(p, "utf8");
const manifest = JSON.parse(read(path.join(PUBLIC, "manifest.json"))) as Record<string, Record<string, [number, number]>>;

const ratio = (aspect: string) => { const [w, h] = aspect.split("/").map(s => Number(s.trim())); return w / h; };
const close = (a: number, b: number) => Math.abs(a - b) / b < 0.015;

describe("кадры на месте", () => {
  for (const lang of ["ru", "uz"] as const) {
    it(`${lang}: каждый кадр из манифеста есть в public/landing`, () => {
      for (const name of [...Object.values(WEB_SHOTS), ...Object.values(MOBILE_SHOTS), "map-crop"]) {
        expect(existsSync(path.join(PUBLIC, lang, `${name}.webp`)), `нет public/landing/${lang}/${name}.webp — прогоните CI на docs/landing-* и scripts/landing_shots.py`).toBe(true);
        expect(manifest[lang]?.[name], `${name} нет в manifest.json — прогоните scripts/landing_shots.py`).toBeTruthy();
      }
      for (const name of Object.values(MANUAL_PAGES)) {
        expect(existsSync(path.join(PUBLIC, "manual", lang, `${name}.webp`)), `нет страницы руководства ${lang}/${name}`).toBe(true);
      }
    });
  }

  it("пропорции в shots.ts совпадают с файлами", () => {
    const m = manifest.ru;
    const [ww, wh] = m["web-ceo-dashboard"];
    expect(close(ww / wh, ratio(WEB_ASPECT)), `WEB_ASPECT ${WEB_ASPECT}, а кадр ${ww}×${wh}`).toBe(true);
    const [pw, ph] = m["mobile-agent-home"];
    expect(close(pw / ph, ratio(MOBILE_ASPECT)), `MOBILE_ASPECT ${MOBILE_ASPECT}, а кадр ${pw}×${ph} — телефон в оправе будет обрезан или приземист`).toBe(true);
    const [cw, ch] = m["map-crop"];
    expect(close(cw / ch, ratio(MAP_CROP_ASPECT)), `MAP_CROP_ASPECT ${MAP_CROP_ASPECT}, а вырезка ${cw}×${ch}`).toBe(true);
  });

  it("все кадры одного вида — одной пропорции на обоих языках", () => {
    for (const lang of ["ru", "uz"] as const) {
      const m = manifest[lang];
      for (const name of Object.values(MOBILE_SHOTS)) {
        const [w, h] = m[name];
        expect(close(w / h, ratio(MOBILE_ASPECT)), `${lang}/${name}: ${w}×${h}`).toBe(true);
      }
      for (const name of Object.values(WEB_SHOTS)) {
        const [w, h] = m[name];
        expect(close(w / h, ratio(WEB_ASPECT)), `${lang}/${name}: ${w}×${h}`).toBe(true);
      }
    }
  });
});

describe("Ургенч, а не Ташкент", () => {
  const files = [
    ...readdirSync(LANDING).filter(f => f.endsWith(".tsx")).map(f => path.join(LANDING, f)),
    path.join(ROOT, "src", "pages", "Landing.tsx"),
  ];
  it("на лендинге нет Ташкента и его районов", () => {
    for (const f of files) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(code, path.basename(f)).not.toMatch(/Ташкент|Toshkent|Tashkent|Юнусабад|Чиланзар|Мирзо-Улугбек|Chilonzor|Yunusobod/);
    }
  });
  it("в засеве главный склад и агент — в Ургенче", () => {
    const seed = read(path.join(ROOT, "db", "seed.ts"));
    expect(seed).toContain('city: "Urgench", isDefault: true');
    expect(seed).toContain("agent-urgench@demo-uz.uz");
    expect(seed.replace(/Asia\/Tashkent/g, "")).not.toMatch(/Tashkent|Ташкент|Тошкент/);
  });
});

describe("anime.js — лениво и с уважением к reduced-motion", () => {
  const files = readdirSync(LANDING).filter(f => f.endsWith(".tsx") || f.endsWith(".ts")).map(f => path.join(LANDING, f));
  it("ни одного статического импорта animejs в главах", () => {
    for (const f of files) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, " ");
      expect(code, `${path.basename(f)}: статический import утяжелит первый экран`).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+["']animejs["']/m);
    }
  });
  it("каждая глава с анимацией проверяет prefers-reduced-motion", () => {
    for (const f of files) {
      const code = read(f);
      if (!/import\("animejs"\)/.test(code)) continue;
      expect(code, `${path.basename(f)}: есть import("animejs"), но нет проверки reduced-motion`).toMatch(/prefers-reduced-motion|reducedMotion\(\)/);
    }
  });
  it("главы с анимацией не прячут элементы разметкой", () => {
    for (const f of files) {
      const code = read(f);
      expect(code, path.basename(f)).not.toMatch(/style=\{\{[^}]*opacity:\s*0[,\s}]/);
    }
  });
});

describe("справка рекламируется без цены", () => {
  it("в главе о руководстве нет ни суммы, ни валюты", () => {
    const code = read(path.join(LANDING, "ManualSection.tsx")).replace(/\/\*[\s\S]*?\*\//g, " ");
    // Число рядом с валютой и слова про цену или платность. Одиночный `$` не
    // ловим — это шаблонные строки.
    expect(code).not.toMatch(/\d\s*(\$|USD|сум\b|so'm|руб)|\$\s*\d|долл|стоимост|стоит\b|narx|бесплатн|платн/i);
  });
});

describe("страница собирается из настоящих глав", () => {
  it("Landing.tsx подключает все новые главы по порядку", () => {
    const code = read(path.join(ROOT, "src", "pages", "Landing.tsx"));
    const order = ["<ProductWindow", "<FeaturesSection", "<OrdersSection", "<WarehouseSection", "<MoneySection", "<SetupSection", "<MobileShowcase", "<ManualSection", "<PricingSection"];
    let last = -1;
    for (const tag of order) {
      const at = code.indexOf(tag);
      expect(at, `${tag} не подключён`).toBeGreaterThan(-1);
      expect(at, `${tag} стоит не по порядку`).toBeGreaterThan(last);
      last = at;
    }
    expect(code, "стоковая фотография вернулась").not.toContain("<PhotoStrip");
    expect(existsSync(path.join(LANDING, "CityMap.tsx")), "нарисованная карта вернулась").toBe(false);
  });
});
