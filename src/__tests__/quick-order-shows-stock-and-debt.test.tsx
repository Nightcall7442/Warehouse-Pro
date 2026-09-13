// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LangProvider } from "@/i18n";

/**
 * Быстрый заказ показывает, чего нет, и с кем разговор другой.
 *
 * listAll давно отдаёт свободный остаток, а окно его не показывало: оператор
 * клал в корзину то, чего нет, и узнавал об этом отказом сервера — уже после
 * разговора с магазином. Долг магазина в списке точек тоже не показывался.
 * И слово «сум» стояло в разметке, хотя валюта — настройка организации.
 *
 * Здесь окно поднимается с поддельными ручками и проверяется то, что видит
 * человек: подпись «свободно N», глухой «+» при нуле, долг у магазина и
 * символ валюты из настроек.
 */
afterEach(cleanup);

const trpcStub = vi.hoisted(() => ({
  agent: { myShops: { useQuery: () => ({ data: undefined }) } },
  shop: { list: { useQuery: () => ({ data: { data: [
    { id: 1, name: "Хумо", ownerName: "Алишер", district: "Юнусабад", city: "Ташкент", debt: "150000.00" },
    { id: 2, name: "Барака", ownerName: null, district: null, city: null, debt: "0.00" },
  ] } }) } },
  product: { listAll: { useQuery: () => ({ data: [
    { id: 1, code: "A-1", barcode: null, name: "Печенье", unitPrice: "12000.00", available: "50" },
    { id: 2, code: "A-2", barcode: null, name: "Сок", unitPrice: "8000.00", available: "0" },
  ] }) } },
  order: { create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
}));
vi.mock("@/providers/trpc", () => ({ trpc: trpcStub }));
vi.mock("@/hooks/useOrderCacheSync", () => ({ useInvalidateOrderCaches: () => () => {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: "operator" } }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ symbol: "UZS", fmt: (v: unknown) => String(v) }) }));
vi.mock("@/lib/toast", () => ({ notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const { QuickOrderModal } = await import("@/components/orders/QuickOrderModal");

function поднять() {
  return render(
    <LangProvider>
      <QuickOrderModal open onOpenChange={() => {}} />
    </LangProvider>,
  );
}

describe("быстрый заказ: остаток и долг видны до выбора", () => {
  it("в строке товара — «свободно N», при нуле кнопка глухая", () => {
    поднять();
    const есть = screen.getByRole("button", { name: /Печенье/ });
    const нет = screen.getByRole("button", { name: /Сок/ });
    expect(есть.textContent).toContain("свободно 50");
    expect(нет.textContent).toContain("свободно 0");
    expect((есть as HTMLButtonElement).disabled).toBe(false);
    expect((нет as HTMLButtonElement).disabled, "товар с нулевым остатком всё ещё кладётся в корзину").toBe(true);

    fireEvent.click(нет);
    expect(screen.getByText(/Корзина|Savat/).textContent).toContain("(0)");
    fireEvent.click(есть);
    expect(screen.getByText(/Корзина|Savat/).textContent).toContain("(1)");
  });

  it("у магазина с долгом — сумма долга, у чистого — ничего", () => {
    поднять();
    expect(screen.getByRole("button", { name: /Хумо/ }).textContent).toMatch(/долг\s150\s?000/);
    expect(screen.getByRole("button", { name: /Барака/ }).textContent).not.toContain("долг");
  });

  it("валюта — символ из настроек, а не «сум» в разметке", () => {
    поднять();
    expect(screen.getByRole("button", { name: /Печенье/ }).textContent).toMatch(/12\s000 UZS/);
    expect(screen.getByRole("button", { name: /Печенье/ }).textContent).not.toContain("сум");
  });
});
