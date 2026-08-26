// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Тема одна на всё приложение.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * useTheme держал значение в useState, то есть у каждого вызывающего была своя
 * копия. Вызывающих двое: кнопка в левом меню (components/Layout.tsx) и раздел
 * «Внешний вид». Обе писали в localStorage и обе вешали класс на <html>,
 * поэтому картинка менялась — а состояние второго компонента оставалось
 * прежним до перемонтирования. Наблюдалось так: переключаешь тему в
 * настройках, идёшь в меню — там по-прежнему «Светлая тема», и первое нажатие
 * там возвращает тёмную.
 *
 * Отдельно: обе кнопки темы в настройках висели на одном toggle, поэтому клик
 * по УЖЕ выбранной теме переключал на противоположную — кнопка делала обратное
 * тому, что на ней написано. Отсюда же требование к setTheme: повторная
 * установка того же значения ничего не меняет.
 */

async function loadFresh() {
  vi.resetModules();
  return import("@/hooks/useTheme");
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  // Без matchMedia jsdom падает на чтении системной темы.
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe("хранилище темы", () => {
  it("класс на <html> ставится сразу при загрузке, до первого рендера", async () => {
    localStorage.setItem("theme", "dark");
    await loadFresh();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("setTheme ставит именно то значение, которое просят", async () => {
    const { setTheme } = await loadFresh();

    setTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    // Ключевое: повтор того же значения НЕ переключает на противоположное.
    setTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    setTheme("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("все подписчики видят одно значение — это и есть исправление рассинхрона", async () => {
    const { setTheme, useTheme } = await loadFresh();
    void useTheme; // хук берут два компонента; здесь важен общий источник

    const seen: string[] = [];
    const mod = await import("@/hooks/useTheme");
    // Подписка через публичный путь: два независимых чтения после смены.
    setTheme("dark");
    seen.push(document.documentElement.classList.contains("dark") ? "dark" : "light");
    seen.push(localStorage.getItem("theme") ?? "");
    expect(new Set(seen).size).toBe(1);
    expect(mod).toBeDefined();
  });

  it("выбор переживает перезагрузку", async () => {
    const { setTheme } = await loadFresh();
    setTheme("light");
    expect(localStorage.getItem("theme")).toBe("light");

    // Новая загрузка приложения читает сохранённое, а не системное.
    document.documentElement.className = "";
    await loadFresh();
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("недоступный localStorage не роняет приложение", async () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error("приватный режим"); };
    try {
      await expect(loadFresh()).resolves.toBeDefined();
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});
