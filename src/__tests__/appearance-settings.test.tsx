// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LangProvider } from "@/i18n";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";

/**
 * Раздел «Внешний вид» — тот случай, когда кнопка делала обратное написанному.
 *
 * Обе кнопки темы висели на одном toggle:
 *
 *     <button key={opt.val} onClick={toggle}>
 *
 * Пока выбрана тёмная, нажатие на «Тёмную» включало светлую. Заметить это на
 * глаз трудно: человек нажимает на подсвеченную кнопку редко, а когда всё-таки
 * нажимает — думает, что промахнулся.
 *
 * Поэтому проверка идёт именно на повторное нажатие по уже выбранному
 * варианту: тест, который жмёт только на невыбранный, был бы зелёным и на
 * сломанном коде.
 */

function renderSection() {
  return render(
    <LangProvider>
      <AppearanceSettings />
    </LangProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("theme", "light");
  document.documentElement.className = "";
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  vi.resetModules();
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("внешний вид: тема", () => {
  it("нажатие на уже выбранную тему её не переключает", () => {
    renderSection();

    const light = screen.getByRole("radio", { name: "Светлая" });
    expect(light.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(light);

    expect(light.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("нажатие на другую тему переключает и отмечает её выбранной", () => {
    renderSection();

    fireEvent.click(screen.getByRole("radio", { name: "Тёмная" }));

    expect(screen.getByRole("radio", { name: "Тёмная" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Светлая" }).getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("выбор темы читается вспомогательными технологиями как группа переключателей", () => {
    renderSection();
    const groups = screen.getAllByRole("radiogroup");
    expect(groups.length).toBe(2); // тема и язык
    expect(groups[0].getAttribute("aria-label")).toBeTruthy();
  });
});

describe("внешний вид: язык", () => {
  it("языки названы на самих себе, без флагов стран", () => {
    renderSection();

    expect(screen.getByRole("radio", { name: "Русский" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "O'zbek" })).toBeTruthy();

    // Флаг — это страна, а не язык; на Windows флаговые эмодзи вдобавок
    // рисуются как две буквы.
    const flags = /[\u{1F1E6}-\u{1F1FF}]/u;
    expect(flags.test(document.body.textContent ?? "")).toBe(false);
  });

  it("выбранный язык отмечен, другой — нет", () => {
    renderSection();

    expect(screen.getByRole("radio", { name: "Русский" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "O'zbek" }).getAttribute("aria-checked")).toBe("false");
  });
});
