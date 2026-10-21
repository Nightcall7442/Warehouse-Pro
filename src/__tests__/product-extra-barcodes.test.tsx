// @vitest-environment jsdom
/**
 * Дополнительные штрих-коды в форме нового товара и в правке карточки.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Штрих-код у товара был один, и только при заведении: в правке карточки
 * поля не было вовсе, а сервер молча отбрасывал его схемой. Вторую этикетку
 * того же товара (другой поставщик, блок и пачка) вписать было некуда.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   • форма нового товара: «Ещё штрих-код» добавляет поле, пустые поля не
 *     уходят, крестик убирает код;
 *   • карточка: дополнительные коды видны рядом с основным; в правке —
 *     основной штрих-код и список дополнительных; уходит весь список, а не
 *     только добавленный; без правки кодов — их нет в запросе (сервер их не
 *     трогает).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { LangProvider } from "@/i18n";
import { ProductForm } from "@/components/products/ProductForm";

Element.prototype.scrollIntoView = () => {};
afterEach(cleanup);

const update = vi.hoisted(() => vi.fn());
const trpcStub = vi.hoisted(() => {
  const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, refetch: vi.fn() });
  return {
    product: {
      getById: { useQuery: query({
        id: 7, code: "A-100", name: "Сок", category: null, barcode: "4870000000017", barcodes: ["4870000000024", "4870000000031"],
        unit: "pcs", unitPrice: "12000.00", costPrice: "9000.00", unitWeight: "1.000", reorderPoint: "10.00",
        description: "", photoUrl: null, stock: null, movements: [],
      }) },
      categories: { useQuery: query([]) },
      update: { useMutation: () => ({ mutate: update, isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      uploadPhoto: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    auth: { me: { useQuery: query({ id: 1, name: "Оператор", role: "operator" }) } },
    warehouseReports: { productBatches: { useQuery: query({ onHand: 0, inBatches: 0, untracked: 0, batches: [] }) } },
    // Правка карточки спрашивает список поставщиков (поставщик по умолчанию).
    supplier: { list: { useQuery: query([]) } },
    useUtils: () => ({ product: { getById: { invalidate: vi.fn() } } }),
  };
});
vi.mock("@/providers/trpc", () => ({ trpc: trpcStub }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => String(v) }) }));

const { default: ProductDetail } = await import("@/pages/ProductDetail");
const click = (el: HTMLElement) => act(() => { fireEvent.click(el); });
const type = (el: HTMLElement, value: string) => act(() => { fireEvent.change(el, { target: { value } }); });

describe("форма нового товара", () => {
  it("«Ещё штрих-код» добавляет поле; пустые не уходят; крестик убирает код", () => {
    const onSave = vi.fn();
    render(<ProductForm onSave={onSave} onCancel={() => {}} isPending={false} lang="ru" />);
    type(screen.getByTestId("product-code"), "W-1");
    type(screen.getByTestId("product-name"), "Вода");
    type(screen.getByTestId("product-price"), "4500");

    for (let i = 0; i < 3; i++) click(screen.getByTestId("product-extra-barcode-add"));
    type(screen.getByTestId("product-extra-barcode-0"), " 111 ");
    type(screen.getByTestId("product-extra-barcode-2"), "333");
    click(screen.getAllByRole("button", { name: "Убрать штрих-код" })[2]);
    type(screen.getByTestId("product-extra-barcode-1"), "222");
    click(screen.getByTestId("product-save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ code: "W-1", extraBarcodes: ["111", "222"] }));
  });

  it("по-узбекски", () => {
    render(<ProductForm onSave={vi.fn()} onCancel={() => {}} isPending={false} lang="uz" />);
    expect(screen.getByText("Qo'shimcha shtrix-kodlar")).toBeTruthy();
    expect(screen.getByText("Yana shtrix-kod")).toBeTruthy();
  });
});

describe("карточка товара", () => {
  const renderPage = () => render(
    <LangProvider>
      <MemoryRouter initialEntries={["/products/7"]}>
        <Routes><Route path="/products/:id" element={<ProductDetail />} /></Routes>
      </MemoryRouter>
    </LangProvider>,
  );

  it("дополнительные коды видны рядом с основным", () => {
    renderPage();
    expect(screen.getByTestId("product-extra-barcodes-view").textContent).toBe("+ 4870000000024, 4870000000031");
  });

  it("правка: основной и дополнительные; уходит весь список", () => {
    update.mockClear();
    renderPage();
    click(screen.getByRole("button", { name: /Изменить/ }));
    expect((screen.getByTestId("product-edit-barcode") as HTMLInputElement).value).toBe("4870000000017");
    expect((screen.getByTestId("product-extra-barcode-1") as HTMLInputElement).value).toBe("4870000000031");

    click(screen.getAllByRole("button", { name: "Убрать штрих-код" })[0]);
    click(screen.getByTestId("product-extra-barcode-add"));
    type(screen.getByTestId("product-extra-barcode-1"), "4870000000048");
    type(screen.getByTestId("product-edit-barcode"), "4870000000055");
    click(screen.getByRole("button", { name: "Сохранить" }));
    expect(update).toHaveBeenCalledWith({ id: 7, barcode: "4870000000055", extraBarcodes: ["4870000000031", "4870000000048"] });
  });

  it("без правки кодов — их нет в запросе: сервер их не трогает", () => {
    update.mockClear();
    renderPage();
    click(screen.getByRole("button", { name: /Изменить/ }));
    type(screen.getByPlaceholderText("Название"), "Сок яблочный");
    click(screen.getByRole("button", { name: "Сохранить" }));
    expect(update).toHaveBeenCalledWith({ id: 7, name: "Сок яблочный" });
  });
});
