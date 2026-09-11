/**
 * Выкладка не перезагружает вкладку оператора сама.
 *
 * autoUpdate + skipWaiting делали window.location.reload() на каждой новой
 * версии — при почти ежедневных выкладках оператор терял набранный приход.
 * Здесь закреплено: режим prompt, skipWaiting выключен, компонент с кнопкой
 * «Обновить» смонтирован в корне и зовёт updateServiceWorker(true).
 *
 * Нарочная поломка: верни registerType: "autoUpdate" — первая проверка падает.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf-8");

describe("обновление приложения по кнопке", () => {
  it("служебный работник в режиме prompt и без skipWaiting", () => {
    const vite = read("vite.config.ts");
    expect(vite).toMatch(/registerType:\s+"prompt"/);
    expect(vite).toMatch(/skipWaiting:\s+false/);
  });

  it("UpdatePrompt смонтирован в корне и обновляет только по действию человека", () => {
    expect(read("src/main.tsx")).toContain("<UpdatePrompt />");
    // Без комментариев: шапка файла описывает прежний reload словами.
    const cmp = read("src/components/UpdatePrompt.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^
]*/g, "");
    expect(cmp).toContain("useRegisterSW");
    expect(cmp).toContain("updateServiceWorker(true)");
    expect(cmp).not.toMatch(/location\.reload/);
  });
});
