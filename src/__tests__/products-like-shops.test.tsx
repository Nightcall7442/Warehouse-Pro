// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import fs from "node:fs";
import path from "node:path";
import { LangProvider } from "@/i18n";
import { productInitials, shopInitials } from "@/lib/shop-avatar";

/**
 * Товары — как магазины.
 *
 * Владелец положил рядом два списка. У магазинов: плашка 96 точек с тенью,
 * цветная заглушка по номеру, строка «кто · итог · действие» на .neo-card.
 * У товаров: плашка 80 с обводкой, своя тень, четыре чипа вперемешку с
 * корзинкой. Здесь закреплено, что списки и карточки построены из одного и
 * того же — и что это не откатится молча при следующей правке одной из
 * сторон.
 */

Element.prototype.scrollIntoView = () => {};
afterEach(cleanup);

const trpcStub = vi.hoisted(() => {
  const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, refetch: vi.fn() });
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    product: {
      getById: { useQuery: query({
        id: 7, code: "THS1-03", barcode: "4780000000001", name: "1.35кг Täç «Восстановление» для белого белья (Белый)",
        category: "Жидкие средства для стирки", unit: "pcs", unitPrice: "28000.00", costPrice: "23871.00",
        unitWeight: "1.350", reorderPoint: "10.00", packSize: "12.00", packLabel: "коробка", description: "", photoUrl: null,
        stock: { available: "3.000", reserved: "5.000", currentStock: "8.000" }, movements: [],
      }) },
      categories: { useQuery: query([]) },
      update: { useMutation: mutation },
      delete: { useMutation: mutation },
      uploadPhoto: { useMutation: mutation },
      list: { invalidate: vi.fn() },
    },
    auth: { me: { useQuery: query({ id: 1, name: "Оператор", role: "operator" }) } },
    warehouseReports: {
      productBatches: { useQuery: query({ onHand: 8, inBatches: 8, untracked: 0, batches: [{ batchId: 1, batchNumber: "П-1", expiresAt: "2026-12-01", daysLeft: 77, quantity: "8.000" }] }) },
    },
    useUtils: () => ({ product: { getById: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } }),
  };
});
vi.mock("@/providers/trpc", () => ({ trpc: trpcStub }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${Number(v).toLocaleString("ru")} сум` }) }));

const { ProductCard } = await import("@/components/products/ProductCard");
const { default: ProductDetail } = await import("@/pages/ProductDetail");

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const fmt = (v: string | number) => `${Number(v).toLocaleString("ru")} сум`;

const product = (over: Record<string, unknown> = {}) => ({
  id: 7, code: "THS1-03", name: "1.35кг Täç «Восстановление» для белого белья (Белый)",
  category: "Жидкие средства для стирки", unit: "pcs", unitPrice: "28000.00", costPrice: "23871.00",
  unitWeight: "1.350", reorderPoint: "10.00", packSize: "12.00", packLabel: "коробка", available: "134.000", photoUrl: null,
  ...over,
});

function row(over: Record<string, unknown> = {}, opts: { onDelete?: (id: number) => void } = {}) {
  render(
    <LangProvider>
      <MemoryRouter>
        <ProductCard p={product(over)} onClick={() => {}} lang="ru" fmt={fmt} onDelete={opts.onDelete} onToggleSelect={() => {}} />
      </MemoryRouter>
    </LangProvider>,
  );
  return screen.getByTestId("product-row");
}

describe("строка товара — как строка магазина", () => {
  it("лежит на .neo-card, плашка 96 точек с тенью и без обводки", () => {
    const r = row();
    expect(r.className).toContain("neo-card");
    // Плашка — первый квадрат 96×96 внутри строки.
    const tile = Array.from(r.querySelectorAll("div")).find(d => d.style.width === "96px" && d.style.height === "96px") as HTMLElement | undefined;
    expect(tile, "плашки 96×96 нет — снова 80 с обводкой?").toBeTruthy();
    expect(tile!.style.boxShadow).toContain("var(--shadow-sm)");
    expect(tile!.style.border).toBe("");
    expect(tile!.style.borderRadius).toBe("27px"); // 96 × 0.28 — как у магазина
  });

  it("без фото — цветная заглушка с инициалами товара, а не серый кубик", () => {
    const r = row();
    expect(within(r).getByText("TВ")).toBeTruthy();
  });

  it("сведения строчкой: категория, упаковка, вес", () => {
    const r = row();
    expect(within(r).getByText("Жидкие средства для стирки")).toBeTruthy();
    expect(within(r).getByText(/1 коробка = 12 шт/)).toBeTruthy();
    expect(within(r).getByText(/1 шт = 1[.,]35 кг/)).toBeTruthy();
  });

  it("справа один край: цена, себестоимость, остаток — в этом порядке", () => {
    const r = row();
    // toLocaleString("ru") ставит неразрывный пробел — сравниваем без него.
    const text = (r.textContent ?? "").replace(/\u00a0/g, " ");
    const price = text.indexOf("28 000 сум");
    const cost = text.indexOf("себест. 23 871 сум");
    const stock = text.indexOf("134 шт");
    expect(price).toBeGreaterThan(0);
    expect(cost).toBeGreaterThan(price);
    expect(stock).toBeGreaterThan(cost);
  });

  it("обычный остаток — тихая цифра, без плашки и значка", () => {
    const r = row();
    const stock = within(r).getByText("134 шт");
    expect(stock.style.background).toBe("");
    expect(r.querySelector("svg.lucide-alert-circle, svg.lucide-circle-alert")).toBeNull();
  });

  it("ниже точки дозаказа — красная плашка «мало», при нуле — «нет на складе»", () => {
    const low = row({ available: "3.000" });
    const pill = within(low).getByText(/3 шт · мало/);
    expect(pill.style.background).toContain("--color-danger-subtle");
    cleanup();
    const empty = row({ available: "0.000" });
    expect(within(empty).getByText("нет на складе")).toBeTruthy();
  });

  it("корзинка — последняя в строке, за итогом, только когда её позволили", () => {
    const r = row({}, { onDelete: () => {} });
    const last = r.lastElementChild as HTMLElement;
    expect(last.tagName).toBe("BUTTON");
    expect(last.getAttribute("aria-label")).toBe("Удалить");
    cleanup();
    expect(screen.queryByLabelText("Удалить")).toBeNull();
    const noDelete = row();
    expect(within(noDelete).queryByLabelText("Удалить")).toBeNull();
  });
});

describe("инициалы товара", () => {
  it("пропускают вес и единицу в начале названия", () => {
    expect(productInitials("1.35кг Täç «Восстановление» для белого белья")).toBe("TВ");
    expect(productInitials("0,5 л Coca-Cola")).toBe("CC");
    expect(productInitials("Вода «Орол» 1,5 л")).toBe("ВО");
  });

  it("одни цифры — пусто, рисуется коробка", () => {
    expect(productInitials("12345")).toBe("");
  });

  it("дефис не режет латиницу", () => {
    // Дефис посередине класса символов задавал диапазон «\»–«"» и накрывал
    // всю строчную латиницу: слова из строчных букв исчезали целиком, и
    // «eco vodka Premium» давало «P» вместо «EV». Заглавные при этом
    // выживали, поэтому «Coca-Cola» и «Nescafe» этой ошибки не показывают.
    expect(productInitials("eco vodka Premium")).toBe("EV");
    expect(productInitials("Nescafe Classic 100г")).toBe("NC");
    expect(shopInitials("mini market")).toBe("MM");
  });
});

describe("карточка товара — как карточка магазина", () => {
  function page() {
    render(
      <LangProvider>
        <MemoryRouter initialEntries={["/products/7"]}>
          <Routes><Route path="/products/:id" element={<ProductDetail />} /></Routes>
        </MemoryRouter>
      </LangProvider>,
    );
  }

  it("«← Товары» вместо безликого «Назад»; фотография крупно — 288 на большом экране, во всю ширину на телефоне", () => {
    page();
    expect(screen.getByRole("button", { name: /Товары/ })).toBeTruthy();
    // Владелец: «очень маленький фото товара, сделай очень большой». Плашка
    // в 96 осталась списку; здесь квадрат во всю ширину своей колонки.
    const col = document.querySelector(".sm\\:w-72") as HTMLElement | null;
    expect(col, "колонки фото в 288 нет").toBeTruthy();
    const tile = col!.querySelector(".aspect-square") as HTMLElement | null;
    expect(tile, "квадрат фото пропал").toBeTruthy();
    expect(tile!.className).toContain("w-full");
    expect(tile!.style.boxShadow).toContain("var(--shadow-sm)");
    expect(read("src/pages/ProductDetail.tsx")).toContain("size={288} icon={Package}");
    expect(screen.getByText("TВ")).toBeTruthy();
  });

  it("остаток — отдельным блоком по образцу долга: подпись, большое число, красный ниже точки дозаказа", () => {
    page();
    const label = screen.getByText("СВОБОДНЫЙ ОСТАТОК");
    expect(label.style.color).toContain("--color-danger-text");
    expect(screen.getByText(/Ниже точки дозаказа/)).toBeTruthy();
    expect(screen.getByText("РЕЗЕРВ")).toBeTruthy();
    expect(screen.getByText("ВСЕГО")).toBeTruthy();
    expect(screen.getByText("ВЕС НА СКЛАДЕ")).toBeTruthy();
    // Партии живут внутри блока остатка, а не среди сведений.
    const src = read("src/pages/ProductDetail.tsx");
    expect(src.indexOf("ПАРТИИ И СРОКИ")).toBeGreaterThan(src.indexOf("СВОБОДНЫЙ ОСТАТОК"));
  });

  it("штрих-код, упаковка и вес — строчкой со значками, не плашками", () => {
    page();
    expect(screen.getByText("4780000000001")).toBeTruthy();
    const pack = screen.getByTestId("product-pack");
    expect(pack.className).not.toContain("rounded-full");
    expect(pack.textContent).toContain("1 коробка = 12 шт");
  });
});

describe("одни детали на обе стороны", () => {
  const productPhoto = read("src/components/products/ProductPhoto.tsx");
  const shopCard = read("src/components/shops/ShopCard.tsx");
  const productCard = read("src/components/products/ProductCard.tsx");

  it("размеры и скругление плашки те же, что у ShopPhoto", () => {
    for (const src of [productPhoto, shopCard]) {
      expect(src).toContain('const px = size === "sm" ? 52 : size === "lg" ? 96 : 72;');
      expect(src).toContain("Math.round(px * 0.28)");
      expect(src).toContain('boxShadow: "var(--shadow-sm)"');
    }
  });

  it("заглушка одна — ShopAvatar с коробкой и инициалами товара", () => {
    expect(productPhoto).toContain("<ShopAvatar id={productId} name={productName} size={px} icon={Package} initials={productInitials(productName)} />");
    expect(fs.existsSync(path.resolve(process.cwd(), "src/components/products/ProductAvatar.tsx"))).toBe(false);
  });

  it("строка без цветов числом — только переменные темы", () => {
    expect(productCard).not.toMatch(/rgba?\(|#[0-9a-fA-F]{3,6}\b/);
  });

  it("фильтры товаров лежат на той же панели, что фильтры магазинов", () => {
    const filters = read("src/components/products/ProductFilters.tsx");
    expect(filters).toContain('background: COLORS.surface, borderRadius: "16px", padding: "16px 20px"');
    expect(filters).toContain("boxShadow: SHADOW");
  });
});
