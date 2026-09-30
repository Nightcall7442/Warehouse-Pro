// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter } from "react-router";
import { LangProvider } from "@/i18n";

/**
 * Возврат от магазина из веба — экран.
 *
 * Что было: оформить возврат после доставки из веба было нельзя — ни в
 * карточке заказа, ни в карточке магазина кнопки не было. Офис обходил это
 * корректировкой остатка и сторно платежа и ломал долг и выручку.
 *
 * Что проверяется:
 *   · кнопка «Оформить возврат» есть у доставленного заказа и у ролей, которым
 *     сервер разрешает returns.create; у недоставленного, удалённого заказа и
 *     у курьера — нет;
 *   · окно не даёт вписать больше, чем осталось к возврату (остаток — от
 *     сервера), строку без остатка — вовсе;
 *   · без причины отправить нельзя; отправка уходит в returns.create ровно с
 *     вписанными строками, итог — целыми по ценам заказа;
 *   · после отправки — ссылка на возврат в «Возвратах» (офису);
 *   · в карточке заказа — «Возврат №… — ждёт проведения»;
 *   · в карточке магазина — выбор из ДОСТАВЛЕННЫХ заказов этого магазина,
 *     затем то же окно.
 */
const stub = vi.hoisted(() => {
  const state = {
    role: "operator",
    order: {
      id: 77, orderNumber: "ORD-77", shopId: 5, status: "delivered", deletedAt: null, shop: { name: "Магазин Бахор" },
      items: [
        { id: 1, productId: 11, productName: "Йогурт", unit: "pcs", unitPrice: "12500.00", quantity: "10.000", deliveredQuantity: null },
        { id: 2, productId: 12, productName: "Кефир", unit: "pcs", unitPrice: "9000.50", quantity: "4.000", deliveredQuantity: "4.000" },
        { id: 3, productId: 13, productName: "Сметана", unit: "pcs", unitPrice: "15000.00", quantity: "2.000", deliveredQuantity: null },
      ],
    },
    returnable: [
      { productId: 11, shipped: 10, returned: 7, left: 3, unitPrice: 12500 },
      { productId: 12, shipped: 4, returned: 0, left: 4, unitPrice: 9000.5 },
      { productId: 13, shipped: 2, returned: 2, left: 0, unitPrice: 15000 },
    ],
    returnsList: [] as Array<{ id: number; returnNumber: string; status: string }>,
    shopOrders: [
      { id: 77, orderNumber: "ORD-77", total: "150000.00", createdAt: "2026-09-28T09:00:00.000Z", deliveredAt: "2026-09-29T09:00:00.000Z" },
    ],
    create: vi.fn(),
    orderListInput: null as unknown,
    invalidate: vi.fn(),
  };
  const q = (get: () => unknown, onInput?: (i: unknown) => void) => (input?: unknown, opts?: { enabled?: boolean }) => {
    if (opts?.enabled !== false) onInput?.(input);
    return { data: opts?.enabled === false ? undefined : get(), isLoading: false, isError: false, error: null, refetch: vi.fn() };
  };
  const mut = (fn: (v: unknown) => unknown) => (opts?: { onSuccess?: (r: unknown, v: unknown) => void }) => ({ mutate: (v: unknown) => { const r = fn(v); opts?.onSuccess?.(r, v); }, isPending: false });
  return {
    state,
    trpc: {
      settings: { get: { useQuery: q(() => ({ currency: "UZS", currencySymbol: "сум" })) } },
      order: {
        getById: { useQuery: q(() => state.order) },
        list: { useQuery: q(() => ({ data: state.shopOrders, total: state.shopOrders.length }), i => { state.orderListInput = i; }) },
      },
      returns: {
        returnable: { useQuery: q(() => state.returnable) },
        list: { useQuery: q(() => ({ data: state.returnsList, total: state.returnsList.length })) },
        create: { useMutation: mut(v => { state.create(v); return { id: 901, returnNumber: "RET-ABC123" }; }) },
      },
      useUtils: () => ({ returns: { list: { invalidate: state.invalidate }, returnable: { invalidate: state.invalidate } } }),
    },
  };
});
vi.mock("@/providers/trpc", () => ({ trpc: stub.trpc }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: stub.state.role, name: "Дилноза" } }) }));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const { OrderReturnButton, OrderReturnMarks, ShopReturnButton } = await import("@/components/returns/WebReturn");

const wrap = (ui: React.ReactNode) => render(<MemoryRouter><LangProvider>{ui}</LangProvider></MemoryRouter>);
const qty = (pid: number) => screen.getByTestId(`return-qty-${pid}`) as HTMLInputElement;
const submit = () => screen.getByTestId("return-submit") as HTMLButtonElement;
const openDialog = () => { wrap(<OrderReturnButton orderId={77} status="delivered" deleted={false} />); fireEvent.click(screen.getByTestId("order-return")); };

beforeEach(() => { stub.state.role = "operator"; stub.state.create.mockReset(); stub.state.returnsList = []; stub.state.orderListInput = null; });
afterEach(cleanup);

describe("кнопка «Оформить возврат» в карточке заказа", () => {
  it("есть у доставленного заказа — офису и полю (roles returns.create)", () => {
    for (const role of ["ceo", "operator", "supervisor", "agent", "merchandiser"]) {
      stub.state.role = role;
      wrap(<OrderReturnButton orderId={77} status="delivered" deleted={false} />);
      expect(screen.queryByTestId("order-return"), role).not.toBeNull();
      cleanup();
    }
  });
  it("нет у недоставленного, удалённого заказа и у курьера", () => {
    for (const status of ["new", "processing", "shipped", "pending", "cancelled", "returned"]) {
      wrap(<OrderReturnButton orderId={77} status={status} deleted={false} />);
      expect(screen.queryByTestId("order-return"), status).toBeNull();
      cleanup();
    }
    wrap(<OrderReturnButton orderId={77} status="delivered" deleted />);
    expect(screen.queryByTestId("order-return")).toBeNull();
    cleanup();
    stub.state.role = "courier";
    wrap(<OrderReturnButton orderId={77} status="delivered" deleted={false} />);
    expect(screen.queryByTestId("order-return")).toBeNull();
  });
});

describe("окно возврата", () => {
  it("больше остатка вписать нельзя; строку, вернувшуюся целиком, — вовсе", () => {
    openDialog();
    fireEvent.change(qty(11), { target: { value: "99" } });
    expect(qty(11).value).toBe("3");
    fireEvent.change(qty(12), { target: { value: "2,5" } });
    expect(qty(12).value).toBe("2.5");
    expect(qty(13).disabled).toBe(true);
    expect(screen.getByTestId("return-line-13").textContent).toContain("уже возвращено всё");
  });

  it("без причины не отправить; отправка — ровно вписанные строки, итог целыми по ценам заказа", () => {
    openDialog();
    fireEvent.change(qty(11), { target: { value: "2" } });
    fireEvent.change(qty(12), { target: { value: "1" } });
    expect(submit().disabled).toBe(true);
    fireEvent.click(screen.getByTestId("return-reason-expired"));
    expect(submit().disabled).toBe(false);
    // 2 × 12 500 + 1 × 9 000,50 = 34 000,5 → 34 001 целыми.
    expect(submit().textContent).toMatch(/34\s001/);
    fireEvent.change(screen.getByTestId("return-notes"), { target: { value: "вздутые банки" } });
    fireEvent.click(submit());
    expect(stub.state.create).toHaveBeenCalledTimes(1);
    expect(stub.state.create).toHaveBeenCalledWith({
      orderId: 77, shopId: 5, reason: "expired", notes: "вздутые банки",
      items: [
        { productId: 11, quantity: 2, unitPrice: 12500 },
        { productId: 12, quantity: 1, unitPrice: 9000.5 },
      ],
    });
  });

  it("ничего не вписано — не отправить, даже с причиной", () => {
    openDialog();
    fireEvent.click(screen.getByTestId("return-reason-defect"));
    expect(submit().disabled).toBe(true);
  });

  it("после отправки — номер и ссылка на возврат в «Возвратах»", () => {
    openDialog();
    fireEvent.change(qty(11), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("return-reason-defect"));
    fireEvent.click(submit());
    expect(screen.getByTestId("return-created").textContent).toContain("RET-ABC123");
    expect(screen.getByTestId("return-created-link").getAttribute("href")).toBe("/returns?open=901");
  });

  it("агенту «Возвраты» закрыты — ссылки нет, номер есть", () => {
    stub.state.role = "agent";
    openDialog();
    fireEvent.change(qty(11), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("return-reason-defect"));
    fireEvent.click(submit());
    expect(screen.getByTestId("return-created").textContent).toContain("RET-ABC123");
    expect(screen.queryByTestId("return-created-link")).toBeNull();
  });
});

describe("пометка в карточке заказа", () => {
  it("«Возврат №… — ждёт проведения» со ссылкой в «Возвраты»", () => {
    stub.state.returnsList = [{ id: 901, returnNumber: "RET-ABC123", status: "pending" }];
    wrap(<OrderReturnMarks orderId={77} />);
    const mark = screen.getByTestId("order-return-mark-901");
    expect(mark.textContent).toBe("Возврат №RET-ABC123 — ждёт проведения");
    expect(mark.querySelector("a")?.getAttribute("href")).toBe("/returns?open=901");
  });
  it("возвратов нет — строки нет", () => {
    wrap(<OrderReturnMarks orderId={77} />);
    expect(screen.queryByTestId("order-return-marks")).toBeNull();
  });
  it("полю — пометка без ссылки: «Возвраты» ему не открываются", () => {
    stub.state.role = "agent";
    stub.state.returnsList = [{ id: 901, returnNumber: "RET-ABC123", status: "approved" }];
    wrap(<OrderReturnMarks orderId={77} />);
    const mark = screen.getByTestId("order-return-mark-901");
    expect(mark.textContent).toContain("ждёт проведения");
    expect(mark.querySelector("a")).toBeNull();
  });
});

describe("карточка магазина", () => {
  it("выбор из доставленных заказов этого магазина, новые сверху, → то же окно", () => {
    wrap(<ShopReturnButton shopId={5} shopName="Магазин Бахор" />);
    fireEvent.click(screen.getByTestId("shop-return"));
    expect(stub.state.orderListInput).toMatchObject({ shopId: 5, status: "delivered", sortBy: "createdAt", sortDir: "desc" });
    fireEvent.click(screen.getByTestId("shop-return-order-77"));
    fireEvent.change(qty(11), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("return-reason-wrong_item"));
    fireEvent.click(submit());
    expect(stub.state.create).toHaveBeenCalledWith(expect.objectContaining({ orderId: 77, shopId: 5, reason: "wrong_item" }));
  });
  it("курьеру кнопки нет", () => {
    stub.state.role = "courier";
    wrap(<ShopReturnButton shopId={5} shopName="Магазин Бахор" />);
    expect(screen.queryByTestId("shop-return")).toBeNull();
  });
});

describe("страницы подключены", () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  it("карточка заказа — кнопка и пометка; карточка магазина — кнопка", () => {
    const order = read("src/pages/OrderDetail.tsx");
    expect(order).toContain("<OrderReturnButton orderId={order.id} status={order.status} deleted={!!order.deletedAt} />");
    expect(order).toContain("<OrderReturnMarks orderId={order.id} />");
    expect(read("src/pages/ShopDetail.tsx")).toContain("<ShopReturnButton shopId={shop.id} shopName={shop.name} />");
  });
  it("«Возвраты» раскрывают возврат по ссылке ?open= и показывают, кто завёл", () => {
    const page = read("src/pages/Returns.tsx");
    expect(page).toContain('Number(params.get("open"))');
    expect(page).toContain("useState<number | null>(linked)");
    expect(page).toContain("return-author-");
  });
});
