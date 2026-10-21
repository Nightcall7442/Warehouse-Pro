// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import { readFileSync } from "node:fs";
import { LangProvider, UrlLang, PreferLang, useLang, currentLang, tt } from "@/i18n";
import { uiLang, uiText } from "@/lib/ui-text";
import { sitePath, stripUzPrefix } from "@/lib/site-paths";
import { linkProps } from "@/components/landing/landing-tokens";
import UzSite from "@/components/landing/UzSite";

/**
 * Язык сайта из адреса: /uz, /uz/compare.
 *
 * ── Что обещано ─────────────────────────────────────────────────────────────
 *
 *   · адрес сильнее сохранённого выбора: /uz открывается по-узбекски у того,
 *     кто когда-то переключал приложение на русский;
 *   · заход по ссылке — не выбор: «lang» в хранилище не пишется;
 *   · язык адреса видят и помощники вне React — заголовок x-lang и errorText
 *     (uiLang), тосты (tt, currentLang): иначе форма заявки на /uz слала бы
 *     x-lang: ru и отвечала по-русски;
 *   · нажатие «Ру» на /uz — явный выбор: сохраняется и ведёт на русскую
 *     страницу того же раздела, с теми же метками в адресе;
 *   · страница с собственным умолчанием (сравнение — русское) под /uz
 *     говорит по-узбекски;
 *   · своя страница сайта (/register, /demo) открывается в той же вкладке:
 *     в новой пропали бы метки рекламы из sessionStorage.
 *
 * Нарочная поломка: убрать pageLangOverride() из uiLang — падает «помощники
 * вне React»; писать lang в UrlLang при монтировании — «не выбор»; снять
 * outer.fromUrl в PreferLang — «умолчание страницы»; вернуть linkProps
 * «всё, кроме якоря, — в новой вкладке» — «своя страница».
 */

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); localStorage.clear(); document.documentElement.lang = ""; });

function Probe() {
  const { lang, setLang } = useLang();
  const where = useLocation();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="where">{where.pathname + where.search}</span>
      <button type="button" onClick={() => setLang("ru")}>ru</button>
      <button type="button" onClick={() => setLang("uz")}>uz</button>
    </div>
  );
}

const site = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <LangProvider>
        <Routes>
          <Route path="/" element={<Probe />} />
          <Route path="/compare" element={<Probe />} />
          <Route path="/uz" element={<UzSite path="/"><Probe /></UzSite>} />
          <Route path="/uz/compare" element={<UzSite path="/compare"><Probe /></UzSite>} />
        </Routes>
      </LangProvider>
    </MemoryRouter>,
  );

describe("адреса сайта на двух языках", () => {
  it("русская страница без приставки, узбекская — под /uz; якорь и чужой сайт не трогаются", () => {
    expect(sitePath("uz", "/")).toBe("/uz");
    expect(sitePath("uz", "/compare")).toBe("/uz/compare");
    expect(sitePath("uz", "/compare#otish")).toBe("/uz/compare#otish");
    expect(sitePath("uz", "/?utm_source=tg")).toBe("/uz?utm_source=tg");
    expect(sitePath("ru", "/uz/compare")).toBe("/compare");
    expect(sitePath("ru", "/uz")).toBe("/");
    expect(sitePath("uz", "/uz/compare")).toBe("/uz/compare");
    expect(sitePath("uz", "#faq")).toBe("#faq");
    expect(sitePath("uz", "https://t.me/x")).toBe("https://t.me/x");
    // /uzum — не узбекская версия чего-то, а другой адрес.
    expect(stripUzPrefix("/uzum")).toBe("/uzum");
  });

  it("App.tsx знает /uz и /uz/compare и не отдаёт им «Страница не найдена»", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toMatch(/<Route path="\/uz"\s+element=\{<UzSite path="\/"><Landing \/><\/UzSite>\}/);
    expect(app).toMatch(/<Route path="\/uz\/compare"\s+element=\{<UzSite path="\/compare"><Compare \/><\/UzSite>\}/);
    expect(app).toMatch(/<Route path="\/uz\/\*"\s+element=\{<Navigate to="\/uz" replace \/>\}/);
    // Сайт — до оболочки приложения: его открывают без входа.
    expect(app.indexOf('<Route path="/uz"')).toBeLessThan(app.indexOf("<Route element={<AppLayout />}>"));
  });
});

describe("язык из адреса", () => {
  it("/uz — по-узбекски поверх сохранённого русского, и <html lang> тоже", () => {
    localStorage.setItem("lang", "ru");
    site("/uz");
    expect(screen.getByTestId("lang").textContent).toBe("uz");
    expect(document.documentElement.lang).toBe("uz");
  });

  it("заход по ссылке — не выбор: хранилище не тронуто", () => {
    site("/uz/compare");
    expect(screen.getByTestId("lang").textContent).toBe("uz");
    expect(localStorage.getItem("lang")).toBeNull();
  });

  it("помощники вне React отвечают языком адреса, пока страница открыта", () => {
    localStorage.setItem("lang", "ru");
    const view = site("/uz");
    expect(uiLang()).toBe("uz");
    expect(uiText("Да", "Ha")).toBe("Ha");
    expect(currentLang()).toBe("uz");
    expect(tt("Да", "Ha")).toBe("Ha");
    view.unmount();
    // Ушёл со страницы — снова сохранённый выбор.
    expect(uiLang()).toBe("ru");
    expect(currentLang()).toBe("ru");
  });

  it("«Ру» на /uz — сохранённый выбор и та же страница по-русски, метки в адресе сохраняются", () => {
    site("/uz/compare?utm_source=tg_oct");
    fireEvent.click(screen.getByText("ru"));
    expect(localStorage.getItem("lang")).toBe("ru");
    expect(screen.getByTestId("where").textContent).toBe("/compare?utm_source=tg_oct");
    expect(screen.getByTestId("lang").textContent).toBe("ru");
    expect(uiLang()).toBe("ru");
  });

  it("переход /uz → /uz/compare не теряет язык: уборка старой страницы не стирает язык новой", () => {
    const view = render(
      <LangProvider>
        <UrlLang lang="uz"><span>a</span></UrlLang>
      </LangProvider>,
    );
    view.rerender(
      <LangProvider>
        <UrlLang key="next" lang="uz"><span>b</span></UrlLang>
      </LangProvider>,
    );
    expect(uiLang()).toBe("uz");
    view.unmount();
    expect(uiLang()).toBe("ru");
  });

  it("умолчание страницы (сравнение по-русски) уступает языку адреса", () => {
    render(
      <MemoryRouter>
        <LangProvider>
          <UrlLang lang="uz">
            <PreferLang lang="ru"><Probe /></PreferLang>
          </UrlLang>
        </LangProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("lang").textContent).toBe("uz");
  });
});

describe("ссылки лендинга: в новой вкладке — только чужой сайт", () => {
  it("свои страницы и якоря — в той же вкладке, Telegram — в новой", () => {
    expect(linkProps("/register?utm_source=tg")).toEqual({});
    expect(linkProps("/demo?lang=ru")).toEqual({});
    expect(linkProps("#product")).toEqual({});
    expect(linkProps("mailto:a@b.uz")).toEqual({});
    expect(linkProps("https://t.me/warehouse")).toEqual({ target: "_blank", rel: "noreferrer" });
    expect(linkProps("//t.me/warehouse")).toEqual({ target: "_blank", rel: "noreferrer" });
  });
});
