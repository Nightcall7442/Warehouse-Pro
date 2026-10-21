// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router";
import type { ReactElement } from "react";
import { LangProvider } from "@/i18n";
import LandingHeader from "@/components/landing/LandingHeader";
import { PitchShell } from "@/components/pitch/pitch-ui";
import { useDisclosure } from "@/components/landing/use-disclosure";

/**
 * Меню шапки на телефоне — лендинг и страницы сайта (/compare).
 *
 *   · кнопка говорит, открыто ли меню и чем управляет: aria-expanded и
 *     aria-controls → id панели;
 *   · Esc закрывает и возвращает фокус на кнопку;
 *   · касание мимо меню закрывает, касание внутри — нет;
 *   · переход по адресу закрывает;
 *   · у сравнения на телефоне есть меню: разделы, «Войти», «Начать».
 *
 * Нарочная поломка: убрать слушатель keydown в use-disclosure — падают оба
 * «Esc»; убрать проверку panelRef.contains — «касание внутри»; вернуть
 * PitchHeader без кнопки меню — «у сравнения на телефоне есть меню».
 */

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const inRouter = (el: ReactElement) => render(<MemoryRouter><LangProvider>{el}</LangProvider></MemoryRouter>);

describe("меню лендинга", () => {
  const toggle = () => screen.getByRole("button", { name: /Открыть меню|Закрыть меню/ });

  it("кнопка связана с панелью и говорит, открыто ли меню", () => {
    inRouter(<LandingHeader />);
    const btn = toggle();
    expect(btn.getAttribute("aria-controls")).toBe("lx-menu");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById("lx-menu")!;
    expect(panel, "панели с id lx-menu нет").toBeTruthy();
    expect(panel.hasAttribute("inert"), "закрытая панель доступна табу").toBe(true);
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hasAttribute("inert")).toBe(false);
  });

  it("Esc закрывает и возвращает фокус на кнопку", () => {
    inRouter(<LandingHeader />);
    fireEvent.click(toggle());
    const link = within(document.getElementById("lx-menu")!).getAllByRole("link")[0];
    link.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle());
  });

  it("касание мимо меню закрывает, касание внутри — нет", () => {
    inRouter(<LandingHeader />);
    fireEvent.click(toggle());
    fireEvent.pointerDown(document.getElementById("lx-menu")!);
    expect(toggle().getAttribute("aria-expanded"), "меню закрылось от касания внутри себя").toBe("true");
    fireEvent.pointerDown(document.body);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });
});

describe("меню сравнения (/compare) на телефоне", () => {
  const nav = [{ href: "#bolimlar", label: { ru: "По разделам", uz: "Bo'limlar" } }];
  const shell = () => inRouter(<PitchShell site lang="ru" nav={nav} title={{ ru: "Сравнение", uz: "Taqqoslash" }}><p>текст</p></PitchShell>);

  it("у сравнения на телефоне есть меню: разделы, «Войти», «Начать»", () => {
    shell();
    const btn = screen.getByTestId("pitch-menu-toggle");
    expect(btn.getAttribute("aria-controls")).toBe("p-menu");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    const panel = screen.getByTestId("pitch-menu");
    expect(panel.id).toBe("p-menu");
    expect(within(panel).getByText("По разделам").getAttribute("href")).toBe("#bolimlar");
    expect(within(panel).getByText("Войти").closest("a")!.getAttribute("href")).toBe("/login");
    expect(within(panel).getByText("Начать").closest("a")!.getAttribute("href")).toMatch(/^\/register/);
  });

  it("Esc закрывает меню сравнения и возвращает фокус", () => {
    shell();
    const btn = screen.getByTestId("pitch-menu-toggle");
    fireEvent.click(btn);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(btn);
  });

  it("на страницах конкурса без разделов меню нет — нечего открывать", () => {
    inRouter(<PitchShell title={{ ru: "Демо", uz: "Demo" }}><p>текст</p></PitchShell>);
    expect(screen.queryByTestId("pitch-menu-toggle")).toBeNull();
  });
});

describe("переход закрывает меню", () => {
  function Probe() {
    const m = useDisclosure("probe");
    const navigate = useNavigate();
    return (
      <>
        <button type="button" {...m.toggleProps}>menu</button>
        <div {...m.panelProps}><button type="button" onClick={() => navigate("/elsewhere")}>go</button></div>
      </>
    );
  }
  it("смена адреса закрывает открытое меню", () => {
    render(<MemoryRouter><Probe /></MemoryRouter>);
    fireEvent.click(screen.getByText("menu"));
    expect(screen.getByText("menu").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByText("go"));
    expect(screen.getByText("menu").getAttribute("aria-expanded")).toBe("false");
  });
});
