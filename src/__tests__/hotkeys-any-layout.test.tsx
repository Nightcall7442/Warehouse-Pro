// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { LangProvider } from "@/i18n";

/**
 * Горячие клавиши — в любой раскладке.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Клавиши сравнивали e.key с латиницей. В офисе русская раскладка: N даёт
 * «т», Ctrl+K — «л», «/» стоит на другой клавише (на её месте «.»), — и все
 * сокращения молчали. N к тому же вела в телефонный мастер, хотя офис
 * работает быстрым заказом. А «/» искала поле по тексту подсказки
 * («Поиск», «Qidirish») и в узбекском интерфейсе, где подсказки со строчной,
 * не находила ничего.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Настоящий useHotkeys и настоящая палитра, события — такие, какие браузер
 * шлёт в русской раскладке: key «т» с code KeyN, key «л» с code KeyK и
 * Ctrl, key «.» с code Slash.
 *
 * Нарочные поломки (каждая роняет свой тест):
 *   · верни в isNewOrderKey только e.key === "n" || e.key === "N" — падают оба
 *     теста N;
 *   · верни в палитре (e.metaKey || e.ctrlKey) && e.key === "k" — падает Ctrl+K;
 *   · верни поиск поля по placeholder*="Поиск"/"Qidirish" — падает «/…какой
 *     бы ни была подсказка»;
 *   · сделай N для всех navigate("/orders/new") — падает «офис: N»;
 *   · убери takesLetters(el) из isInputFocused — падает ««т» в открытом
 *     списке»; глуши combobox и закрытым — падает «закрытый список».
 */

vi.mock("@/providers/trpc", () => ({
  trpc: {
    product: { list: { useQuery: () => ({ data: undefined }) } },
    shop: { list: { useQuery: () => ({ data: undefined }) } },
    order: { list: { useQuery: () => ({ data: undefined }) } },
    user: { list: { useQuery: () => ({ data: undefined }) } },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: "operator" } }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => String(v) }) }));

// Открытый список подкручивает активный пункт в поле зрения; в jsdom этого нет.
Element.prototype.scrollIntoView = () => {};

const { useHotkeys } = await import("@/hooks/useHotkeys");
const { CommandPalette } = await import("@/components/CommandPalette");
const { SearchInput } = await import("@/components/SearchInput");
const { PremiumSelect } = await import("@/components/PremiumSelect");
const { useQuickOrderSession, closeQuickOrder } = await import("@/lib/quick-order");

afterEach(() => { act(() => closeQuickOrder()); cleanup(); });

function Shell({ role, children }: { role: string; children?: React.ReactNode }) {
  useHotkeys(role);
  const session = useQuickOrderSession();
  const where = useLocation();
  return (
    <>
      <output data-testid="where">{where.pathname}</output>
      <output data-testid="quick-order">{session ? "open" : "closed"}</output>
      {children}
    </>
  );
}

const mount = (role: string, children?: React.ReactNode) => render(
  <LangProvider>
    <MemoryRouter initialEntries={["/shops"]}>
      <Shell role={role}>{children}</Shell>
      <CommandPalette />
    </MemoryRouter>
  </LangProvider>,
);
const press = (init: KeyboardEventInit) => act(() => {
  document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
});

describe("N — новый заказ", () => {
  it("офис: «т» на месте N открывает быстрый заказ поверх страницы", () => {
    mount("operator");
    press({ key: "т", code: "KeyN" });
    expect(screen.getByTestId("quick-order").textContent, "в русской раскладке N молчит").toBe("open");
    expect(screen.getByTestId("where").textContent, "офис увели в телефонный мастер").toBe("/shops");
  });

  it("агент: «т» на месте N — мастер заказа, как и было", () => {
    mount("agent");
    press({ key: "т", code: "KeyN" });
    expect(screen.getByTestId("where").textContent).toBe("/orders/new");
    expect(screen.getByTestId("quick-order").textContent).toBe("closed");
  });

  it("латиница по-прежнему работает", () => {
    mount("agent");
    press({ key: "n", code: "KeyN" });
    expect(screen.getByTestId("where").textContent).toBe("/orders/new");
  });
});

/*
  Открытый выпадающий список ищет пункт по первым буквам. Пока клавиши
  сравнивались с латиницей, русская «т» до N не доходила; с e.code это та же
  клавиша, и «Т», набранная, чтобы прыгнуть к «Тимуру» в фильтре агентов,
  открывала новый заказ поверх страницы.
*/
describe("выпадающий список ловит буквы сам", () => {
  const AGENTS = [{ value: "1", label: "Азиз" }, { value: "2", label: "Тимур" }];
  const pressOn = (el: Element, init: KeyboardEventInit) => act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });

  it("«т» в открытом списке — поиск пункта, а не новый заказ", () => {
    mount("operator", <PremiumSelect aria-label="Агент" options={AGENTS} value="1" onChange={() => {}} />);
    const trigger = screen.getByRole("combobox", { name: "Агент" });
    act(() => trigger.focus());
    pressOn(trigger, { key: "ArrowDown", code: "ArrowDown" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    pressOn(trigger, { key: "т", code: "KeyN" });
    expect(screen.getByTestId("quick-order").textContent, "буква в списке открыла новый заказ").toBe("closed");
    expect(screen.getByTestId("where").textContent).toBe("/shops");
    expect(screen.getByRole("option", { name: "Тимур" }).hasAttribute("data-active"), "список не нашёл «Тимура»").toBe(true);
  });

  it("закрытый список в фокусе букв не ловит — N работает", () => {
    mount("operator", <PremiumSelect aria-label="Агент" options={AGENTS} value="1" onChange={() => {}} />);
    const trigger = screen.getByRole("combobox", { name: "Агент" });
    act(() => trigger.focus());
    pressOn(trigger, { key: "т", code: "KeyN" });
    expect(screen.getByTestId("quick-order").textContent).toBe("open");
  });
});

describe("Ctrl+K — палитра", () => {
  it("«л» с Ctrl на месте K открывает палитру", () => {
    mount("operator");
    expect(screen.queryByPlaceholderText(/Поиск товаров, магазинов/)).toBeNull();
    press({ key: "л", code: "KeyK", ctrlKey: true });
    expect(screen.queryByPlaceholderText(/Поиск товаров, магазинов/), "в русской раскладке Ctrl+K молчит").not.toBeNull();
  });
});

describe("«/» — поиск страницы", () => {
  it("«.» на месте «/» ставит каретку в поле поиска, какой бы ни была подсказка", () => {
    /*
      Подсказка — та, что у поиска магазинов по-узбекски: слова «поиск» в ней
      нет ни на одном языке. Живое «Buyurtma qidirish…» здесь не годится: jsdom
      сравнивает значения атрибутов без учёта регистра и нашёл бы его по
      «Qidirish», а браузер — нет.
    */
    mount("operator", <SearchInput placeholder="Nomi, egasi, telefon…" onSearch={() => {}} />);
    press({ key: ".", code: "Slash" });
    expect(document.activeElement, "каретка не встала в поле поиска").toBe(screen.getByPlaceholderText("Nomi, egasi, telefon…"));
  });

  it("Shift + та же клавиша — «,» или «?», не поиск", () => {
    mount("operator", <SearchInput placeholder="Nomi, egasi, telefon…" onSearch={() => {}} />);
    press({ key: ",", code: "Slash", shiftKey: true });
    expect(document.activeElement).not.toBe(screen.getByPlaceholderText("Nomi, egasi, telefon…"));
  });

  it("поля поиска на странице нет — открывается палитра", () => {
    mount("operator");
    press({ key: ".", code: "Slash" });
    expect(screen.queryByPlaceholderText(/Поиск товаров, магазинов/)).not.toBeNull();
  });
});
