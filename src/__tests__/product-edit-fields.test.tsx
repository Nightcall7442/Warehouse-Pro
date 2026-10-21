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

const update = vi.hoisted(() => vi.fn());
const baseProduct = vi.hoisted(() => ({
  id: 7, code: "A-100", name: "Печенье", category: "Кондитерские",
  unit: "block", unitPrice: "12000.00", costPrice: "9000.00",
  unitWeight: "8.000", reorderPoint: "10.00", reorderMax: "40.00" as string | null, description: "", photoUrl: null,
  defaultSupplierId: null as number | null,
  defaultSupplier: null as { id: number; name: string; active: boolean } | null,
}));
// Карточку товара отдельные проверки подменяют: поставщик по умолчанию,
// максимум не задан.
const state = vi.hoisted(() => ({ product: {} as Record<string, unknown> }));
const trpcStub = vi.hoisted(() => {
  const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, refetch: vi.fn() });
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    // Учёт тары выключен: блок тары в карточке не рисуется.,
    product: {
      getById: { useQuery: () => ({ data: { ...baseProduct, ...state.product }, isLoading: false, isError: false, refetch: vi.fn() }) },
      categories: { useQuery: query(["Кондитерские", "Напитки", "Бакалея"]) },
      update: { useMutation: () => ({ mutate: update, isPending: false }) },
      delete: { useMutation: mutation },
      uploadPhoto: { useMutation: mutation },
    },
    // Роль решает, показывать ли «Изменить»: правка товара — operatorQuery,
    // и полевым эти кнопки не рисуют вовсе (src/__tests__/field-roles.test.ts).
    // Здесь проверяется сама форма, поэтому смотрим её глазами оператора.
    auth: { me: { useQuery: query({ id: 1, name: "Оператор", role: "operator" }) } },
    /*
      Партии карточка спрашивает отдельным запросом. Здесь проверяется форма
      правки, и партий у этого товара нет — но заглушка обязана ОТВЕТИТЬ:
      без неё страница падает на чтении несуществующего пространства имён, и
      две проверки формы сообщают о партиях, к которым не имеют отношения.
    */
    warehouseReports: {
      productBatches: { useQuery: query({ onHand: 0, inBatches: 0, untracked: 0, batches: [] }) },
    },
    // Поставщик по умолчанию выбирается из своих контрагентов.
    supplier: { list: { useQuery: query([{ id: 5, name: "Завод" }, { id: 6, name: "Мельница" }]) } },
    useUtils: () => ({ product: { getById: { invalidate: vi.fn() } } }),
  };
});

vi.mock("@/providers/trpc", () => ({ trpc: trpcStub }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => String(v) }) }));

const click = (el: HTMLElement) => act(() => { fireEvent.click(el); });
afterEach(() => { state.product = {}; });

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

  it("поставщик по умолчанию — из своих контрагентов, уходит номером", () => {
    update.mockClear();
    renderPage();
    startEditing();

    const supplier = screen.getByRole("combobox", { name: "Поставщик по умолчанию" });
    expect(supplier.textContent).toContain("нет");
    click(supplier);
    click(within(screen.getByRole("listbox")).getByRole("option", { name: "Мельница" }));
    click(screen.getByRole("button", { name: /Сохранить/ }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 7, defaultSupplierId: 6 }));
  });

  it("максимум запаса: показан сохранённый, пустое поле уходит пустым — сервер снимает максимум", () => {
    update.mockClear();
    renderPage();
    startEditing();

    const max = screen.getByTestId("product-edit-reorder-max") as HTMLInputElement;
    expect(max.value).toBe("40.00");
    fireEvent.change(max, { target: { value: "60" } });
    click(screen.getByRole("button", { name: /Сохранить/ }));
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ id: 7, reorderMax: "60" }));

    fireEvent.change(max, { target: { value: "" } });
    click(screen.getByRole("button", { name: /Сохранить/ }));
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ id: 7, reorderMax: "" }));
  });

  it("максимум ниже порога — подсказка и «Сохранить» недоступна, как в форме нового товара", () => {
    update.mockClear();
    renderPage();
    startEditing();

    const max = screen.getByTestId("product-edit-reorder-max") as HTMLInputElement;
    fireEvent.change(max, { target: { value: "5" } });
    expect(screen.getByRole("alert").textContent).toContain("Максимум не может быть меньше порога");
    const save = screen.getByRole("button", { name: /Сохранить/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    click(save);
    expect(update).not.toHaveBeenCalled();

    // Порог подняли выше сохранённого максимума (40) — то же самое.
    fireEvent.change(max, { target: { value: "40" } });
    expect(save.disabled).toBe(false);
    fireEvent.change(screen.getByPlaceholderText("Порог дозаказа"), { target: { value: "50" } });
    expect(save.disabled).toBe(true);
  });

  it("выключенный поставщик по умолчанию виден в правке с пометкой, а не «нет»", () => {
    state.product = { defaultSupplierId: 9, defaultSupplier: { id: 9, name: "Старый завод", active: false } };
    renderPage();
    startEditing();
    const supplier = screen.getByRole("combobox", { name: "Поставщик по умолчанию" });
    expect(supplier.textContent).toContain("Старый завод (выключен)");
  });

  it("в просмотре видно, до скольких дозаказывать и у кого", () => {
    state.product = { defaultSupplierId: 5, defaultSupplier: { id: 5, name: "Завод", active: true } };
    renderPage();
    expect(screen.getByTestId("product-reorder-range").textContent).toMatch(/Дозаказ: порог 10, до 40/);
    expect(screen.getByTestId("product-default-supplier").textContent).toBe("Завод");
    cleanup();

    // Без максимума — цель «Дозаказа» 2 × порог; поставщика нет — строки нет.
    state.product = { reorderMax: null };
    renderPage();
    expect(screen.getByTestId("product-reorder-range").textContent).toMatch(/до 20 \(2 × порог\)/);
    expect(screen.queryByTestId("product-default-supplier")).toBeNull();
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
