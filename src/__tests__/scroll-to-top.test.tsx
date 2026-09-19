// @vitest-environment jsdom
/**
 * Новая страница открывается с начала; «назад» возвращает, где были; вкладка
 * на той же странице прокрутку не трогает.
 *
 * Владелец (19.09.2026): «некоторые страницы, если зайти, выйти назад и зайти
 * ещё раз, начинаются в конце, а настройки всегда открываются снизу».
 *
 * Нарочная поломка: в ScrollToTop убери `if (type === "POP") return;` —
 * упадёт «назад»; убери проверку `changed` — упадёт «вкладка»; убери
 * ScrollToTop из App — упадёт последняя проверка.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useEffect } from "react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router";
import { ScrollToTop } from "@/components/ScrollToTop";

const holder: { nav?: ReturnType<typeof useNavigate> } = {};
const nav = (to: string | number, opts?: { replace?: boolean }) => (holder.nav as unknown as (to: string | number, opts?: { replace?: boolean }) => void)(to, opts);
function Page({ name }: { name: string }) {
  const n = useNavigate();
  useEffect(() => { holder.nav = n; }, [n]);
  return <div>{name}</div>;
}
const app = () => (
  <MemoryRouter initialEntries={["/products"]}>
    <ScrollToTop />
    <Routes>
      <Route path="/products" element={<Page name="products" />} />
      <Route path="/settings" element={<Page name="settings" />} />
    </Routes>
  </MemoryRouter>
);

const scrollTo = vi.fn();
beforeEach(() => { scrollTo.mockClear(); vi.stubGlobal("scrollTo", scrollTo); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ScrollToTop", () => {
  it("переход по меню — с начала; «назад» — как вернул браузер; вкладка (?section=) — на месте", async () => {
    render(app());
    expect(scrollTo).not.toHaveBeenCalled(); // первая загрузка — дело браузера
    await act(async () => { nav("/settings"); });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
    await act(async () => { nav("/settings?section=company", { replace: true }); });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await act(async () => { nav(-1); });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    // Зашёл ещё раз — снова с начала, а не там, где кончился список.
    await act(async () => { nav("/settings"); });
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("стоит в приложении внутри маршрутов", () => {
    const src = readFileSync("src/App.tsx", "utf8");
    expect(src).toContain('import { ScrollToTop } from "@/components/ScrollToTop";');
    expect(src.indexOf("<ScrollToTop />")).toBeGreaterThan(0);
    expect(src.indexOf("<ScrollToTop />")).toBeLessThan(src.indexOf("<Routes>"));
  });
});
