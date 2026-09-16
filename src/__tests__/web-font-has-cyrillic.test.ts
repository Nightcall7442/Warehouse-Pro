/**
 * Гарнитура веба умеет кириллицу.
 *
 * Веб был набран DM Sans — у него только latin и latin-ext. Каждое русское
 * слово браузер молча набирал системным шрифтом: «Serena Trade» — геометрикой,
 * «Касса» рядом — Segoe UI. Это и читалось как «дёшево». Решение владельца от
 * 07.09.2026 для мобилки — Manrope + JetBrains Mono — теперь и на вебе.
 *
 *   · DM Sans / DM Mono нигде не упоминаются как гарнитура;
 *   · Google Fonts грузит Manrope и JetBrains Mono — и в index.html, и в css;
 *   · body, tailwind и токены F набраны Manrope, моно — JetBrains Mono;
 *   · цифры данных — табличные, чтобы суммы вставали по разрядам.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__" && name !== "node_modules") walk(p); }
    else if (/\.(tsx?|css|svg|html)$/.test(name)) files.push(p);
  }
};
walk(join(ROOT, "src"));
files.push(join(ROOT, "index.html"), join(ROOT, "tailwind.config.js"));

describe("гарнитура веба", () => {
  it("DM Sans и DM Mono не остались нигде как гарнитура", () => {
    const offenders = files
      .filter(f => /['"]DM (Sans|Mono)['"]|DM\+(Sans|Mono)/.test(readFileSync(f, "utf8")))
      .map(f => f.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  it("грузятся Manrope и JetBrains Mono — в html и в css", () => {
    for (const src of [read("index.html"), read("src/index.css")]) {
      expect(src).toMatch(/fonts\.googleapis\.com\/css2\?family=Manrope:wght@400;500;600;700;800&family=JetBrains\+Mono/);
    }
  });

  it("тело, tailwind и токены F — Manrope; моно — JetBrains Mono; цифры данных табличные", () => {
    expect(read("src/index.css")).toMatch(/body \{[^}]*font-family: 'Manrope'/);
    const tw = read("tailwind.config.js");
    expect(tw).toMatch(/display: \['"Manrope"'/);
    expect(tw).toMatch(/mono: {4}\['"JetBrains Mono"'/);
    expect(read("src/components/users/types.ts")).toContain("display: \"'Manrope'");
    expect(read("src/index.css")).toMatch(/\.font-data \{\s*font-variant-numeric: tabular-nums;/);
  });
});
