// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";

/**
 * Посадочная страница: то, что держит редизайн.
 *
 * ── Почему проверяется целиком, а не по кускам ───────────────────────────────
 *
 * У страницы ровно одна внешняя зависимость — trpc.lead.create для формы
 * заявки. Всё остальное это разметка и вычисления, поэтому её можно собрать
 * в jsdom как есть. Так проверяются не отдельные компоненты, а решения,
 * ради которых страницу переделывали, — и ни одно из них нельзя отменить
 * молча.
 *
 * ── Что именно стережётся ───────────────────────────────────────────────────
 *
 * 1. НИ ОДНОГО ВЫДУМАННОГО ЧИСЛА. До переделки на странице стояло
 *    «40+ дистрибьюторов» при тринадцати организациях в базе. Покупатель
 *    здесь — человек, который двадцать лет сверял накладные; одна
 *    непроверяемая величина обнуляет доверие вернее плохой типографики.
 * 2. ОДИН громкий призыв в первом экране. Две одинаковые кнопки — это
 *    отсутствие иерархии, а не выбор.
 * 3. Форма заявки ОСТАЁТСЯ в первом экране. За десять секунд с телефона поле
 *    «оставьте номер» и есть вся конверсия.
 * 4. Ведомость — таблица, а не восемь одинаковых строк: шапка столбцов,
 *    восемь позиций, итог.
 * 5. Тик разрежённого моно не возвращается: трекинг 0.16em и шире означал,
 *    что подпись документа снова расползлась по странице.
 */

// Страница собирается целиком, а в ней одно только поле ячеек — 1536 узлов
// SVG. В jsdom под замером покрытия первая отрисовка не укладывается в пять
// секунд по умолчанию. Предел поднят под честную тяжесть, а не под медленный
// тест: если отрисовка перестанет укладываться и в двадцать, это уже разговор
// о самой странице.
vi.setConfig({ testTimeout: 20_000 });

const leadMutate = vi.fn();
vi.mock("@/providers/trpc", () => ({
  trpc: {
    lead: { create: { useMutation: () => ({ mutate: leadMutate, isPending: false, isSuccess: false, error: null }) } },
  },
}));

import Landing from "@/pages/Landing";
import { LangProvider } from "@/i18n";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  // jsdom не знает наблюдателя пересечений, а на нём держится всё появление.
  // Заглушка ничего не показывает: проверяется разметка, а не анимация.
  vi.stubGlobal("IntersectionObserver", class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
    root = null; rootMargin = ""; thresholds = [];
  });
  // Плёнка «от заказа до денег» рисует на холсте; jsdom холста не знает и
  // ругается в консоль. Под холстом лежит картинка — проверяется разметка.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const draw = () =>
  render(
    <MemoryRouter>
      <LangProvider>
        <Landing />
      </LangProvider>
    </MemoryRouter>,
  );

describe("лендинг: страница собирается", () => {
  it("рисуются все главы по порядку", () => {
    draw();
    const ids = ["audience", "loss", "product", "features", "map", "orders", "warehouse", "money", "setup", "mobile", "manual", "promises", "pricing", "start", "faq"];
    for (const id of ids) {
      expect(document.getElementById(id), `главы #${id} нет на странице`).toBeTruthy();
    }
    // По порядку — буквально: «Для кого» стоит сразу за первым экраном,
    // раньше потерь и функций (21.10.2026).
    const at = ids.map(id => document.getElementById(id)!);
    for (let i = 1; i < at.length; i++) {
      const before = at[i - 1].compareDocumentPosition(at[i]) & Node.DOCUMENT_POSITION_FOLLOWING;
      expect(before, `#${ids[i]} стоит раньше #${ids[i - 1]}`).toBeTruthy();
    }
  });

  it("заголовок первого экрана на месте и не прячется сценарием", () => {
    draw();
    // Первый экран помечен data-first-screen: движение внутри него ничего не
    // прячет (lib/landing-motion). Прежняя пометка data-hero-title звала
    // разбор заголовка по словам — от него отказались сознательно.
    const hero = document.querySelector("[data-first-screen]");
    expect(hero, "первый экран не помечен data-first-screen — движение спрячет его").toBeTruthy();
    const h1 = hero!.querySelector("h1");
    expect(h1).toBeTruthy();
    // Заголовок называет, ради чего покупают: агенты, долги магазинов,
    // доставка (21.10.2026; был «Учёт склада и доставки без разрывов»).
    expect(h1!.textContent).toMatch(/Агенты/);
    expect(h1!.textContent).toMatch(/долги магазинов/);
    expect(h1!.textContent).toMatch(/доставка/);
  });

  it("первый экран называет, для кого программа", () => {
    draw();
    const hero = document.querySelector("[data-first-screen]") as HTMLElement;
    expect(within(hero).getByTestId("hero-audience").textContent).toMatch(/дистрибьютор/i);
    expect(within(hero).getByTestId("hero-audience").textContent).toMatch(/агент/i);
  });
});

describe("лендинг: ни одного выдуманного числа", () => {
  /**
   * Величины, которые проверяются в боевой базе на 2 сентября 2026:
   * организаций 13, точек 3358, заказов за 30 дней 1121, бесплатных дней 14.
   * Если цифра на странице меняется — она обязана меняться вместе с базой.
   */
  it("полоса фактов показывает проверяемые величины", () => {
    draw();
    const counters = Array.from(document.querySelectorAll("[data-count]")).map(n => n.getAttribute("data-count"));
    for (const v of ["13", "3358", "1121", "14"]) {
      expect(counters, `величины ${v} нет среди счётчиков полосы фактов`).toContain(v);
    }
  });

  it("прежнего «40+ дистрибьюторов» на странице нет", () => {
    draw();
    // Организаций в базе тринадцать. «40+» было ложью, и вернуться оно не
    // должно. Само слово «дистрибьюторы» при этом законно — оно стоит в
    // подвале как описание, кому программа предназначена, и числа не несёт.
    expect(document.body.textContent).not.toMatch(/40\s*\+/);
    expect(document.body.textContent).not.toMatch(/\d+\s*\+\s*дистрибьютор/i);
  });

  it("демо-данные подписаны как демо", () => {
    draw();
    expect(screen.getAllByText(/демо-данные/i).length).toBeGreaterThan(0);
  });
});

describe("лендинг: первый экран просит один раз", () => {
  it("громкая кнопка одна, вторая — текстовая ссылка", () => {
    draw();
    const hero = document.querySelector("section");
    expect(hero).toBeTruthy();
    const buttons = within(hero as HTMLElement).getAllByRole("button", { name: /Начать бесплатно/ });
    expect(buttons.length, "в первом экране больше одной кнопки «Начать бесплатно»").toBe(1);
    // Второе действие — демо без регистрации: текстовая ссылка, а не второй
    // прямоугольник, и на языке страницы (у /demo по умолчанию узбекский).
    const demo = within(hero as HTMLElement).getByTestId("hero-demo");
    expect(demo.tagName, "«Демо» стала кнопкой").toBe("A");
    expect(demo.getAttribute("href")).toBe("/demo?lang=ru");
  });

  it("по-узбекски ссылка на демо несёт ?lang=uz", () => {
    localStorage.setItem("lang", "uz");
    draw();
    expect(screen.getByTestId("hero-demo").getAttribute("href")).toBe("/demo?lang=uz");
  });

  it("в тарифах — ссылка на демо на языке страницы", () => {
    draw();
    const demo = screen.getByTestId("pricing-demo");
    expect(demo.tagName).toBe("A");
    expect(demo.getAttribute("href")).toBe("/demo?lang=ru");
    expect(demo.hasAttribute("target"), "своя страница открылась бы в новой вкладке").toBe(false);
  });

  it("поле телефона стоит в первом экране", () => {
    draw();
    const hero = document.querySelector("section") as HTMLElement;
    expect(within(hero).getAllByPlaceholderText(/\+998/).length).toBeGreaterThan(0);
  });

  it("панель дня показывает продукт строками, а не картинкой", () => {
    draw();
    const rows = document.querySelectorAll("[data-reveal='day']");
    expect(rows.length, "панель «Склад · сегодня» пуста").toBe(6);
    expect(document.body.textContent).toMatch(/Частичная приёмка/);
    expect(document.body.textContent).toMatch(/Нет связи/);
  });
});

describe("лендинг: ведомость вместо восьми одинаковых строк", () => {
  it("восемь позиций, шапка столбцов и итог", () => {
    draw();
    const features = document.getElementById("features") as HTMLElement;
    expect(within(features).getByText(/Что делает/i)).toBeTruthy();
    expect(within(features).getByText(/Где это в программе/i)).toBeTruthy();
    expect(within(features).getByText(/8\s+позиций/)).toBeTruthy();
  });

  it("две позиции развёрнуты во врезки — скачок масштаба внутри секции", () => {
    draw();
    const features = document.getElementById("features") as HTMLElement;
    expect(within(features).getByText(/отгружено/)).toBeTruthy();
    expect(within(features).getByText(/вернулось/)).toBeTruthy();
  });

  it("итог отчёркнут двойной чертой", () => {
    draw();
    // Линия 2px, зазор, линия 1px — бухгалтерский приём и смысловой замок.
    expect(document.querySelectorAll("[data-rule]").length).toBeGreaterThanOrEqual(2);
  });

  it("секция ролей из шести плиток удалена", () => {
    draw();
    for (const code of ["ДИР", "ОПР", "АГТ"]) {
      expect(document.body.textContent, `плитка роли ${code} вернулась`).not.toContain(code);
    }
  });
});

describe("лендинг: главы пронумерованы подряд", () => {
  it("ни одного повтора и ни одного пропуска", () => {
    draw();
    // Раздел ролей удалили — шестёрка освободилась, и тарифы с FAQ оба
    // оказались седьмыми. Читатель нумерацию замечает: это документ.
    const nums = Array.from(document.querySelectorAll("[data-reveal=\"head\"]"))
      .map(el => /^(\d{2})\s*·/.exec(el.textContent ?? "")?.[1])
      .filter(Boolean) as string[];
    expect(nums.length, "рубрики глав не найдены").toBeGreaterThan(4);
    expect(new Set(nums).size, `номера глав повторяются: ${nums.join(", ")}`).toBe(nums.length);
    const asInt = nums.map(Number).sort((a, b) => a - b);
    for (let i = 1; i < asInt.length; i++) {
      expect(asInt[i] - asInt[i - 1], `между главами ${asInt[i - 1]} и ${asInt[i]} пропуск`).toBe(1);
    }
  });
});

describe("лендинг: тик разрежённого моно не возвращается", () => {
  it("нигде нет трекинга 0.16em и шире", () => {
    draw();
    const wide = Array.from(document.querySelectorAll<HTMLElement>("[style*='letter-spacing']"))
      .filter(el => {
        const m = /letter-spacing:\s*([0-9.]+)em/.exec(el.getAttribute("style") ?? "");
        return m && Number(m[1]) >= 0.16;
      })
      .map(el => (el.textContent ?? "").slice(0, 40));
    expect(wide, "разрежённое моно снова расползлось по странице").toEqual([]);
  });
});

/*
  Контакт поддержки. App Store проверяет, что по «Support URL» (главная) можно
  связаться; политика конфиденциальности отсылает за контактом сюда же. Без
  контакта на главной обе ссылки вели в пустоту (10.10.2026).
*/
describe("лендинг: контакт поддержки", () => {
  it("в подвале — почта поддержки ссылкой mailto", () => {
    draw();
    const a = screen.getByTestId("footer-support-email");
    expect(a.getAttribute("href")).toMatch(/^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
    expect(a.textContent).toContain("@");
  });
});
