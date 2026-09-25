import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Шапка лендинга нажимается на iPhone.
 *
 * 25.09.2026 владелец: «Ру/Uz» и меню «в браузере телефона не нажимаются,
 * особенно в айфонах». Причина: в index.html стоит viewport-fit=cover, и
 * страница уходит под часы и Dynamic Island, а шапка стояла на top: 0 без
 * отступа. Кнопки оказывались под строкой состояния, касание забирала
 * система. Вторая половина: h-11 при базовом шрифте 14px — это 38.5 точки,
 * а не 44.
 *
 * jsdom не хранит env() в стилях, поэтому стережётся исходник. Настоящий
 * размер на ширине телефона меряет e2e/phone.spec.ts («шапка лендинга»).
 *
 * Нарочная поломка: убери paddingTop у <nav> — падает первый; верни первому
 * экрану pt-24 — второй; верни кнопке h-11 — третий.
 */
const read = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const header = read("src/components/landing/LandingHeader.tsx");
const hero = read("src/components/landing/HeroSection.tsx");

describe("шапка лендинга на iPhone", () => {
  it("шапка опускается под строку состояния", () => {
    expect(read("index.html")).toContain("viewport-fit=cover");
    expect(header).toMatch(/<nav[\s\S]*?paddingTop: "env\(safe-area-inset-top/);
  });

  it("первый экран не прячется под опустившейся шапкой", () => {
    expect(hero).toContain("pt-[calc(6rem+env(safe-area-inset-top,0px))]");
    expect(hero).toContain("md:pt-[calc(8rem+env(safe-area-inset-top,0px))]");
  });

  it("цели касания в точках, а не h-11/w-11 (38.5 при шрифте 14px)", () => {
    const small = header.match(/(?<![:\w-])[hw]-11(?![\w\]])/g) ?? [];
    expect(small, "мелкие цели касания в шапке").toEqual([]);
    expect(header).toContain("h-[44px] min-w-[44px]");
    expect(header).toContain("w-[44px] h-[44px]");
  });
});
