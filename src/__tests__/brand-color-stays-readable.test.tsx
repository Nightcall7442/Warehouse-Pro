// @vitest-environment jsdom
/**
 * Цвет арендатора не должен делать надписи нечитаемыми.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Бренд задавал ровно шесть переменных: саму заливку, её оттенки и токены
 * shadcn. Двух самых важных для чтения среди них не было.
 *
 *   --color-on-primary — цвет надписи НА заливке. В светлой теме он белый.
 *     Арендатор выбирает светло-жёлтый — и надпись на каждой кнопке
 *     приложения становится белой по светло-жёлтому.
 *
 *   --color-primary-text — цвет акцентного ТЕКСТА. У заливки контраст как у
 *     текста ниже нормы, поэтому у приложения для этой роли отдельный, более
 *     тёмный собрат. Бренд его не трогал: заливка становилась цветом
 *     арендатора, а акцентный текст оставался цветом системы — два акцента
 *     сразу. В тёмной теме эта переменная равна самой заливке, и тёмный выбор
 *     арендатора превращался в тёмный текст на почти чёрной карточке.
 *
 * ── Почему проверка именно такая ────────────────────────────────────────────
 *
 * Здесь не сверяются строки, а считается контраст по WCAG — тот самый, ради
 * которого всё и делается. Правило переживёт и смену способа применения
 * (инлайн, таблица стилей), и смену формулы подбора.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { contrastRatio } from "@/lib/contrast";

/** Что отдаёт сервер в этом прогоне. */
let branding: Record<string, unknown> | null = null;

vi.mock("@/providers/trpc", () => ({
  trpc: { branding: { get: { useQuery: () => ({ data: branding }) } } },
}));

vi.mock("@/lib/remembered-brand", () => ({ rememberBrand: vi.fn() }));

import { useBranding } from "@/hooks/useBranding";

function Harness() { useBranding(); return null; }

afterEach(() => {
  cleanup();
  document.getElementById("tenant-brand-vars")?.remove();
  document.documentElement.classList.remove("dark");
});

/** Значения, которые применились бы к теме: светлой (:root) или тёмной (.dark). */
function appliedVars(theme: "light" | "dark"): Record<string, string> {
  const css = document.getElementById("tenant-brand-vars")?.textContent ?? "";
  const block = theme === "dark"
    ? css.slice(css.indexOf(":root.dark"))
    : css.slice(0, css.indexOf(":root.dark") === -1 ? css.length : css.indexOf(":root.dark"));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const LIGHT_CARD = "#efedea";
const DARK_CARD = "#221f1c";

/* Светло-жёлтый — тот самый случай, ради которого всё это писалось. */
const PALE_YELLOW = "#f2e34a";
/* Тёмно-синий ломает тёмную тему: там акцентный текст равен самой заливке. */
const DEEP_NAVY = "#12204a";

describe("надпись на заливке арендатора читается", () => {
  for (const [name, color] of [["светло-жёлтый", PALE_YELLOW], ["тёмно-синий", DEEP_NAVY]] as const) {
    it(`${name}: --color-on-primary набирает контраст с заливкой`, () => {
      branding = { primaryColor: color, secondaryColor: null };
      render(<Harness />);

      for (const theme of ["light", "dark"] as const) {
        const ink = appliedVars(theme)["--color-on-primary"];
        expect(ink, `${theme}: цвет надписи на заливке не задан`).toBeTruthy();
        expect(
          contrastRatio(color, ink),
          `${theme}: надпись ${ink} на заливке ${color} — контраст ниже нормы`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

describe("акцентный текст арендатора читается на карточке", () => {
  for (const [name, color] of [["светло-жёлтый", PALE_YELLOW], ["тёмно-синий", DEEP_NAVY]] as const) {
    it(`${name}: --color-primary-text подобран под фон каждой темы`, () => {
      branding = { primaryColor: color, secondaryColor: null };
      render(<Harness />);

      const light = appliedVars("light")["--color-primary-text"];
      const dark = appliedVars("dark")["--color-primary-text"];
      expect(light, "светлая тема: акцентный текст не задан").toBeTruthy();
      expect(dark, "тёмная тема: акцентный текст не задан").toBeTruthy();

      expect(contrastRatio(LIGHT_CARD, light), `${light} на светлой карточке`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(DARK_CARD, dark), `${dark} на тёмной карточке`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("у тем разные значения — иначе одно из них нечитаемо", () => {
    branding = { primaryColor: DEEP_NAVY, secondaryColor: null };
    render(<Harness />);
    expect(appliedVars("light")["--color-primary-text"])
      .not.toBe(appliedVars("dark")["--color-primary-text"]);
  });
});

describe("бренд снимается", () => {
  it("пустой цвет убирает правила, а не оставляет прежние", () => {
    branding = { primaryColor: PALE_YELLOW, secondaryColor: null };
    const first = render(<Harness />);
    expect(document.getElementById("tenant-brand-vars")).not.toBeNull();
    first.unmount();

    branding = { primaryColor: null, secondaryColor: null };
    render(<Harness />);
    expect(
      document.getElementById("tenant-brand-vars"),
      "цвет убрали в настройках, а он остался висеть до перезагрузки",
    ).toBeNull();
  });
});
