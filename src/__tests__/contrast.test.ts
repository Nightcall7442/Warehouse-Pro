import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Читаемость надписей на заливке — счётом, а не на глаз.
 *
 * Кнопка подтверждения в ConfirmDialog была белой по золотому: 2.42:1 при
 * норме 4.5:1. Это та самая кнопка, на которой человек решает, удалять ли
 * запись. Замерено в браузере на собранных стилях; здесь то же самое считается
 * по палитре, чтобы правка цвета не сломала пары молча.
 *
 * Порог 4.5:1 — требование WCAG AA к обычному тексту.
 */
const CSS = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");

/** Значения токенов внутри одного блока правил. */
function palette(selector: string): Record<string, string> {
  const at = CSS.indexOf(selector + " {");
  if (at < 0) throw new Error(`блок «${selector}» не найден в index.css`);
  const body = CSS.slice(at, CSS.indexOf("\n  }", at));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const ch = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = ch.map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const THEMES = [
  ["светлая", palette(":root, .light")],
  ["тёмная", palette(".dark")],
] as const;

describe("надписи на цветной заливке читаются", () => {
  /** Пары «что написано» → «на чём», которые в приложении действительно есть. */
  const PAIRS: [string, string, string][] = [
    ["кнопка подтверждения", "--color-on-primary", "--color-primary"],
    ["текст на карточке", "--color-text-secondary", "--color-surface"],
    ["подписи на карточке", "--color-text-tertiary", "--color-surface"],
    ["основной текст", "--color-text-primary", "--color-surface"],
  ];

  for (const [themeName, tokens] of THEMES) {
    for (const [what, fg, bg] of PAIRS) {
      it(`${themeName} тема: ${what}`, () => {
        const ratio = contrast(tokens[fg], tokens[bg]);
        expect(
          Number(ratio.toFixed(2)),
          `${fg} (${tokens[fg]}) на ${bg} (${tokens[bg]}) даёт ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }

    it(`${themeName} тема: белый на опасной кнопке`, () => {
      // Сам --color-danger для белого текста слишком светлый: 4.15 в светлой
      // и 3.22 в тёмной. Для сплошной заливки в палитре заведён отдельный,
      // притемнённый.
      const ratio = contrast("#ffffff", tokens["--color-danger-strong"]);
      expect(
        Number(ratio.toFixed(2)),
        `белый на ${tokens["--color-danger-strong"]} даёт ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("окно подтверждения берёт цвета из палитры", () => {
  const SRC = readFileSync(join(process.cwd(), "src", "components", "ConfirmDialog.tsx"), "utf8");

  it("надпись на кнопке не зашита белым", () => {
    // Зашитый #fff и был причиной: в тёмной теме заливка золотая, а токен
    // --color-on-primary там тёмный — им кнопка и должна краситься.
    const btn = SRC.slice(SRC.indexOf("<button onClick={onConfirm}"));
    const style = btn.slice(0, btn.indexOf("}}"));
    expect(style, "цвет надписи снова зашит, мимо палитры").toContain("var(--color-on-primary");
  });

  it("опасная кнопка заливается притемнённым красным", () => {
    const btn = SRC.slice(SRC.indexOf("<button onClick={onConfirm}"));
    const style = btn.slice(0, btn.indexOf("}}"));
    expect(style, "белый текст вернулся на слишком светлый красный").toContain("var(--color-danger-strong)");
  });
});
