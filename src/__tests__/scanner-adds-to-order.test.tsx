// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useState } from "react";
import { LangProvider } from "@/i18n";

/**
 * Сканер в заказе и на приёмке: код → товар → плюс единица.
 *
 * Сканер на вебе жил только на своей странице «Штрих-коды» и находил товар
 * для просмотра. Оформить заказ или принять поставку по нему было нельзя —
 * агент искал каждый товар по названию. Здесь: скан штрих-кода поставщика
 * или кода товара добавляет строку в корзину, повтор — ещё единицу,
 * незнакомый код — отказ вслух. Сам компонент камеры подменён: в jsdom нет
 * ни камеры, ни BarcodeDetector, а проверяется связка, а не камера.
 */
afterEach(cleanup);

const trpcStub = vi.hoisted(() => ({
  product: { listAll: { useQuery: () => ({ data: [
    { id: 1, code: "A-1", barcode: "4870001234567", name: "Печенье", unitPrice: "12000.00", unit: "pcs", available: "50", unitWeight: 1, photoUrl: null },
    { id: 2, code: "A-2", barcode: null, name: "Сок", unitPrice: "8000.00", unit: "pcs", available: "5", unitWeight: 1, photoUrl: null },
  ], isLoading: false }) } },
}));
vi.mock("@/providers/trpc", () => ({ trpc: trpcStub }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => String(v) }) }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/toast", () => ({ notify: toast }));
// Подделка сканера: кнопки «сканируют» заданный код.
vi.mock("@/components/BarcodeScanner", () => ({
  BarcodeScanner: ({ onScan, lastResult }: { onScan: (c: string) => void; lastResult?: string | null }) => (
    <div data-testid="fake-scanner">
      <button onClick={() => onScan("4870001234567")}>scan-barcode</button>
      <button onClick={() => onScan("a-2")}>scan-code</button>
      <button onClick={() => onScan("0000")}>scan-unknown</button>
      <span data-testid="fake-last">{lastResult ?? ""}</span>
    </div>
  ),
}));

const { ProductSelector } = await import("@/components/orders/ProductSelector");

function Harness() {
  const [items, setItems] = useState<never[]>([]);
  return (
    <LangProvider>
      <ProductSelector items={items} onChange={setItems as never} />
      <pre data-testid="cart-json">{JSON.stringify(items)}</pre>
    </LangProvider>
  );
}

describe("сканер добавляет в корзину заказа", () => {
  it("штрих-код поставщика — строка; повтор — ещё единица; код товара без регистра", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("product-scan"));
    fireEvent.click(screen.getByText("scan-barcode"));
    fireEvent.click(screen.getByText("scan-barcode"));
    fireEvent.click(screen.getByText("scan-code"));
    const cart = JSON.parse(screen.getByTestId("cart-json").textContent ?? "[]") as Array<{ productId: number; quantity: string }>;
    expect(cart).toEqual([
      expect.objectContaining({ productId: 1, quantity: "2" }),
      expect.objectContaining({ productId: 2, quantity: "1" }),
    ]);
    expect(screen.getByTestId("fake-last").textContent).toBe("Сок");
  });

  it("незнакомый код — отказ вслух, корзина не меняется", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("product-scan"));
    fireEvent.click(screen.getByText("scan-unknown"));
    expect(toast.error).toHaveBeenCalled();
    expect(JSON.parse(screen.getByTestId("cart-json").textContent ?? "[]")).toEqual([]);
    expect(screen.getByTestId("fake-last").textContent).toContain("0000");
  });
});

describe("сканер-клавиатура: код + Enter", () => {
  it("в поиске заказа точное совпадение по Enter — в корзину, поле пустеет", () => {
    render(<Harness />);
    const input = screen.getByTestId("product-search") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "4870001234567" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(JSON.parse(screen.getByTestId("cart-json").textContent ?? "[]")).toEqual([expect.objectContaining({ productId: 1, quantity: "1" })]);
    expect(input.value).toBe("");
    // обычный поиск по части названия Enter не трогает
    fireEvent.change(input, { target: { value: "Печ" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("Печ");
  });

  it("на приёмке есть поле «штрих-код + Enter»", () => {
    const src = readFileSync("src/pages/Arrivals.tsx", "utf-8");
    expect(src).toContain('data-testid="arrival-wedge"');
    expect(src).toContain('if (e.key === "Enter" && wedge.trim()) { e.preventDefault(); onScanned(wedge); setWedge(""); }');
  });
});

describe("сканер на приёмке и режим «много подряд»", () => {
  it("приёмка: кнопка, поиск по штрих-коду и коду, +1 к строке", () => {
    const src = readFileSync("src/pages/Arrivals.tsx", "utf-8");
    expect(src).toContain('data-testid="arrival-scan"');
    expect(src).toContain("(p.barcode ?? \"\").toLowerCase() === norm || (p.code ?? \"\").toLowerCase() === norm");
    expect(src).toContain("quantity: String(Number(it.quantity || 0) + 1)");
    expect(src).toMatch(/<BarcodeScanner\s+continuous/);
  });

  it("сканер не закрывается после первого кода и не считает одну коробку дважды", () => {
    const src = readFileSync("src/components/BarcodeScanner.tsx", "utf-8");
    expect(src).toContain("continuous?: boolean;");
    expect(src).toContain("REPEAT_COOLDOWN_MS");
    expect(src).toContain("if (!continuous) return;");
  });

  it("каталог заказа отдаёт штрих-код — сканер работает и по копии без сети", () => {
    const src = readFileSync("api/product-router.ts", "utf-8");
    const i = src.indexOf("listAll: fieldSalesQuery");
    expect(src.slice(i, i + 3000)).toContain("barcode:      products.barcode");
  });
});
