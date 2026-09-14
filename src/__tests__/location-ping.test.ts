import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PING_MS, PING_MIN, shouldPing } from "@/hooks/useLocationPing";

// Комментарии снимаются: пояснение «переключателя больше нет» само содержит это слово.
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\r\n]*\/\/.*$/gm, "");

/**
 * Веб: никакого «авто-слежения» — точка уходит сама раз в десять минут, пока
 * приложение открыто (решение владельца). Настоящий фоновый след — у мобилки.
 */
describe("точка из браузера раз в десять минут", () => {
  it("десять минут — и число в подписи экрана берётся из той же константы", () => {
    expect(PING_MS).toBe(10 * 60 * 1000);
    expect(PING_MIN).toBe(10);
    const page = readFileSync(resolve(__dirname, "../pages/AgentGps.tsx"), "utf8");
    expect(page).toContain("PING_MIN");
    expect(page).not.toMatch(/10 минут|раз в 10/); // число не вписано руками
  });

  it("первая точка — сразу; следующая — не раньше, чем через десять минут", () => {
    const now = Date.parse("2026-09-14T10:00:00Z");
    expect(shouldPing(null, now)).toBe(true);
    expect(shouldPing(now - PING_MS + 1, now)).toBe(false);
    expect(shouldPing(now - PING_MS, now)).toBe(true);
  });

  it("переключателя «Авто-трекинг» и watchPosition в вебе больше нет; хук стоит в Layout для полевых ролей", () => {
    const page = strip(readFileSync(resolve(__dirname, "../pages/AgentGps.tsx"), "utf8"));
    expect(page).not.toMatch(/autoTrack|watchPosition|Авто-трекинг/);
    const layout = readFileSync(resolve(__dirname, "../components/Layout.tsx"), "utf8");
    expect(layout).toContain('useLocationPing(user?.role === "agent" || user?.role === "merchandiser")');
    const hook = readFileSync(resolve(__dirname, "../hooks/useLocationPing.ts"), "utf8");
    // Грубая точность и кэш позиции: батарею веб не трогает.
    expect(hook).toContain("enableHighAccuracy: false");
    expect(hook).toMatch(/maximumAge: 5 \* 60_000/);
    // Спрятанная вкладка молчит: в фоне браузер всё равно не даст.
    expect(hook).toContain("document.hidden");
  });
});
