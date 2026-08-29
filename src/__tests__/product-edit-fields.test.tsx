// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, fireEvent, act, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { LangProvider } from "@/i18n";

/**
 * Правка товара: единица измерения и категория.
 *
 * Оба поля были сломаны у живых пользователей, и оба — тихо, без ошибки в
 * журнале, поэтому ни проверка типов, ни линтер их не видели.
 *
 * 1. Единица читалась из сохранённого товара (`product.unit`), а выбор
 *    записывался в черновик правки (`editData.unit`). Значение на экране
 *    поэтому не менялось никогда: человек выбирал «кг», поле продолжало
 *    показывать прежнее, и выглядело это как «единицу нельзя изменить».
 *
 * 2. Категория была обычным полем ввода — без списка уже заведённых.
 *    Название приходилось угадывать вслепую, а опечатка молча заводила
 *    новую категорию.
 */

Element.prototype.scrollIntoView = () => {};
afterEach(cleanup);

const trpcStub = vi.hoisted(() => {
  const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, refetch: vi.fn() });
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    product: {
      getById: { useQuery: query({
        id: 7, code: "A-100", name: "Печенье", category: "Кондитерские",
        unit: "block", unitPrice: "12000.00", costPrice: "9000.00",
        unitWeight: "8.000", reorderPoint: "10.00", description: "", photoUrl: null,
      }) },
      categories: { useQuery: query(["Кондитерские", "Напитки", "Бакалея"]) },
      update: { useMutation: mutation },
      delete: { useMutation: mutation },
      uploadPhoto: { useMutation: mutation },
    },
    useUtils: () => ({ product: { getById: { invalidate: vi.fn() } } }),
  };
});

vi.mock("@/providers/trpc", () => ({ trpc: trpcStub }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => String(v) }) }));

const click = (el: HTMLElement) => act(() => { fireEvent.click(el); });

function renderPage() {
  return render(
    <LangProvider>
      <MemoryRouter initialEntries={["/products/7"]}>
        <Routes>
          <Route path="/products/:id" element={<ProductDetail />} />
        </Routes>
      </MemoryRouter>
    </LangProvider>,
  );
}

// require после vi.mock — иначе страница подхватит настоящий trpc.
const { default: ProductDetail } = await import("@/pages/ProductDetail");

/** Перейти в режим правки. */
function startEditing() {
  click(screen.getByRole("button", { name: /Изменить/ }));
}

describe("Правка товара", () => {
  it("показывает выбранную единицу, а не сохранённую", () => {
    renderPage();
    startEditing();

    const unit = screen.getAllByRole("combobox").find(c => /бл/i.test(c.textContent ?? ""));
    expect(unit, "поле единицы должно показывать сохранённое «бл»").toBeTruthy();

    click(unit!);
    click(within(screen.getByRole("listbox")).getByRole("option", { name: "кг" }));

    // До правки здесь оставалось «бл»: выбор уходил в черновик, а поле
    // читало сохранённое значение.
    expect(unit!.textContent).toContain("кг");
  });

  it("предлагает уже заведённые категории", () => {
    renderPage();
    startEditing();

    const input = screen.getByPlaceholderText("Категория") as HTMLInputElement;
    expect(input.value).toBe("Кондитерские");

    act(() => { fireEvent.focus(input); });

    // Раньше это было обычное поле ввода — списка не существовало вовсе.
    expect(screen.getByText("Напитки")).toBeTruthy();
    expect(screen.getByText("Бакалея")).toBeTruthy();
  });
});
