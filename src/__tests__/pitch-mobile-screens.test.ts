/**
 * /pitch показывает экраны мобильного приложения — те, что сняты для App Store.
 * Каждый кадр лежит в public (ссылка не мёртвая), подписи на двух языках.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MOBILE_SCREENS } from "@/components/pitch/mobile-screens";

describe("экраны мобилки на /pitch", () => {
  it("семь кадров, каждый файл на месте и лёгкий", () => {
    expect(MOBILE_SCREENS.length).toBe(7);
    for (const s of MOBILE_SCREENS) {
      const file = path.resolve(__dirname, "../../public", s.src.replace(/^\//, ""));
      expect(fs.existsSync(file), s.src).toBe(true);
      expect(fs.statSync(file).size).toBeLessThan(120_000);
    }
  });

  it("подписи на узбекском и русском, узбекская — латиницей", () => {
    for (const s of MOBILE_SCREENS) {
      expect(s.uz && s.ru && s.noteUz && s.noteRu).toBeTruthy();
      expect(s.uz + s.noteUz).not.toMatch(/[А-Яа-яЁё]/);
    }
  });

  it("раздел стоит на странице /pitch", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../pages/Pitch.tsx"), "utf8");
    expect(src).toMatch(/<MobileScreens \/>/);
  });
});
