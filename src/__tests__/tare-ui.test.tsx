// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, within, fireEvent, cleanup, act } from "@testing-library/react";
import { LangProvider } from "@/i18n";

/**
 * Экраны тары: настройки (тумблер под тарифом, виды с залогом и без),
 * вкладка «Тара» (плитки, склады и машины, магазины, приём, списание в долг,
 * пересчёт склада, Excel), карточка магазина и карточка товара.
 *
 * Данные подменены; смысл — что каждая кнопка зовёт свою ручку с теми
 * данными, что человек ввёл, и что залог ноль показывается как «только
 * штуками», а не как ноль денег.
 */
const stub = vi.hoisted(() => {
  const state = {
    enabled: true, planAllows: true,
    types: [{ id: 1, name: "Кега 50 л", depositPrice: 50000, isActive: true }, { id: 2, name: "Ящик", depositPrice: 0, isActive: true }],
    overview: {
      types: [] as Array<{ id: number; name: string; depositPrice: number; isActive: boolean }>,
      warehouses: [
        { id: 10, name: "Основной", van: false, lines: [{ tareTypeId: 1, name: "Кега 50 л", qty: 5, deposit: 0 }], units: 5, deposit: 0 },
        { id: 11, name: "Газель", van: true, lines: [{ tareTypeId: 1, name: "Кега 50 л", qty: 2, deposit: 0 }, { tareTypeId: 2, name: "Ящик", qty: 1, deposit: 0 }], units: 3, deposit: 0 },
      ],
      shops: [{ id: 7, name: "Магазин Альфа", van: false, lines: [{ tareTypeId: 1, name: "Кега 50 л", qty: 4, deposit: 200000 }, { tareTypeId: 2, name: "Ящик", qty: 1, deposit: 0 }], units: 5, deposit: 200000 }],
      totals: { atShops: 5, depositAtShops: 200000 },
    },
    shopHeld: [{ tareTypeId: 1, name: "Кега 50 л", qty: 4, depositPrice: 50000, deposit: 200000 }, { tareTypeId: 2, name: "Ящик", qty: 1, depositPrice: 0, deposit: 0 }],
    movements: [{ id: 1, tareTypeId: 1, tareName: "Кега 50 л", holderKind: "shop", holderId: 7, delta: 4, reason: "follow", referenceId: 3, note: "order_delivery", createdAt: "2026-09-16T10:00:00.000Z", by: "Курьер" }],
    role: "ceo",
    setEnabled: vi.fn(), saveType: vi.fn(), setProductTare: vi.fn(), returnFromShop: vi.fn(), charge: vi.fn(), count: vi.fn(),
    exportToExcel: vi.fn(), invalidate: vi.fn(),
  };
  const q = (get: () => unknown) => (_input?: unknown, _opts?: unknown) => ({ data: get(), isLoading: false, isError: false, refetch: vi.fn() });
  const m = (fn: (input: unknown) => void, result: (input: unknown) => unknown) => (opts?: { onSuccess?: (r: unknown, v: unknown) => void }) => ({
    mutate: (input: unknown) => { fn(input); opts?.onSuccess?.(result(input), input); }, isPending: false,
  });
  const inv = () => ({ invalidate: state.invalidate });
  return {
    state,
    trpc: {
      settings: { get: { useQuery: q(() => ({ currency: "UZS" })) } },
      warehouseMulti: { list: { useQuery: q(() => [{ id: 10, name: "Основной", isDefault: true }, { id: 11, name: "Газель", isDefault: false }]) } },
      tare: {
        status: { useQuery: q(() => ({ enabled: state.enabled, planAllows: state.planAllows })) },
        types: { useQuery: q(() => state.types) },
        overview: { useQuery: q(() => ({ ...state.overview, types: state.types })) },
        shop: { useQuery: q(() => state.shopHeld) },
        movements: { useQuery: q(() => state.movements) },
        setEnabled: { useMutation: m(state.setEnabled, () => ({ ok: true })) },
        saveType: { useMutation: m(state.saveType, () => ({ id: 3 })) },
        setProductTare: { useMutation: m(state.setProductTare, () => ({ ok: true })) },
        returnFromShop: { useMutation: m(state.returnFromShop, () => ({ units: 1 })) },
        charge: { useMutation: m(state.charge, (i) => ({ amount: (i as { tareTypeId: number }).tareTypeId === 1 ? 200000 : 0 })) },
        count: { useMutation: m(state.count, () => ({ lines: [{ diff: -1 }], shortage: 0 })) },
      },
      useUtils: () => ({
        tare: { status: inv(), types: inv(), overview: inv(), shop: inv(), movements: inv() },
        shop: { getById: inv() }, product: { getById: inv() },
      }),
    },
  };
});
vi.mock("@/providers/trpc", () => ({ trpc: stub.trpc }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, name: "Директор", role: stub.state.role } }) }));
vi.mock("@/components/ConfirmDialog", () => ({ useConfirm: () => ({ confirm: async () => true, dialog: null }) }));
vi.mock("@/lib/export", () => ({ exportToExcel: (...a: unknown[]) => stub.state.exportToExcel(...a) }));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { TareSettings } = await import("@/components/settings/TareSettings");
const { TareTab } = await import("@/components/tare/TareTab");
const { ShopTare } = await import("@/components/shops/ShopTare");
const { ProductTare } = await import("@/components/tare/ProductTare");

const show = (node: React.ReactNode) => render(<LangProvider>{node}</LangProvider>);

beforeEach(() => {
  stub.state.enabled = true; stub.state.planAllows = true; stub.state.role = "ceo";
  for (const k of ["setEnabled", "saveType", "setProductTare", "returnFromShop", "charge", "count", "exportToExcel", "invalidate"] as const) stub.state[k].mockReset();
});
afterEach(cleanup);

describe("настройки: тумблер и виды", () => {
  it("тариф Basic — тумблер выключен с подсказкой; Pro — включается и зовёт ручку", () => {
    stub.state.planAllows = false; stub.state.enabled = false;
    const { unmount } = show(<TareSettings />);
    const box = screen.getByTestId("tare-enabled") as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByText(/Pro и Exclusive/)).toBeTruthy();
    expect(screen.queryByText("Виды тары")).toBeNull();
    unmount();

    stub.state.planAllows = true;
    show(<TareSettings />);
    fireEvent.click(screen.getByTestId("tare-enabled"));
    expect(stub.state.setEnabled).toHaveBeenCalledWith({ enabled: true });
  });

  it("залог ноль показан как «только штуками»; новый вид уходит с залогом числом", () => {
    show(<TareSettings />);
    expect(within(screen.getByTestId("tare-type-1")).getByText(/залог/)).toBeTruthy();
    expect(within(screen.getByTestId("tare-type-2")).getByText("только штуками")).toBeTruthy();
    fireEvent.click(screen.getByTestId("tare-add"));
    fireEvent.change(screen.getByTestId("tare-name"), { target: { value: "Бутылка 0,5" } });
    fireEvent.change(screen.getByTestId("tare-deposit"), { target: { value: "1500" } });
    fireEvent.click(screen.getByText("Добавить вид"));
    expect(stub.state.saveType).toHaveBeenCalledWith({ id: undefined, name: "Бутылка 0,5", depositPrice: 1500, isActive: true });
    // Карандаш открывает тот же вид на правку с его залогом.
    fireEvent.click(screen.getAllByLabelText("Редактировать вид тары")[0]);
    expect((screen.getByTestId("tare-name") as HTMLInputElement).value).toBe("Кега 50 л");
  });
});

describe("вкладка «Тара»", () => {
  it("плитки, склады с пересчётом, машина без него, магазины с залогом; Excel по-русски", () => {
    show(<TareTab />);
    expect(screen.getByText("штук тары на руках у магазинов")).toBeTruthy();
    expect(screen.getByTestId("tare-count-10")).toBeTruthy();
    expect(screen.queryByTestId("tare-count-11")).toBeNull();
    const shop = screen.getByTestId("tare-shop-7");
    expect(within(shop).getByText("Магазин Альфа")).toBeTruthy();
    expect(within(shop).getByText(/200/)).toBeTruthy();
    fireEvent.click(screen.getByText("Excel"));
    const [sheets, name] = stub.state.exportToExcel.mock.calls[0] as [Array<{ name: string; data: unknown[]; columns: Array<{ header: string }> }>, string];
    expect(name).toBe("tare-shops");
    expect(sheets[0].name).toBe("Тара у магазинов");
    expect(sheets[0].columns.map(c => c.header)).toEqual(["Магазин", "Тара", "Штук", "Залог"]);
    expect(sheets[0].data).toHaveLength(2);
    expect(screen.getByText(/Движения за 30 дней/)).toBeTruthy();
    expect(screen.getByText("с товаром · Курьер")).toBeTruthy();
  });

  it("списание в долг: причина короче трёх знаков — молчит; с причиной — ручка с полным количеством", async () => {
    const prompt = vi.spyOn(window, "prompt");
    show(<TareTab />);
    prompt.mockReturnValueOnce("ок");
    await act(async () => { fireEvent.click(screen.getByTestId("tare-charge-7-1")); });
    expect(stub.state.charge).not.toHaveBeenCalled();
    prompt.mockReturnValueOnce("  разбили  ");
    await act(async () => { fireEvent.click(screen.getByTestId("tare-charge-7-1")); });
    expect(stub.state.charge).toHaveBeenCalledWith({ shopId: 7, tareTypeId: 1, quantity: 4, reason: "разбили" });
    prompt.mockReturnValueOnce("потеряли");
    await act(async () => { fireEvent.click(screen.getByTestId("tare-charge-7-2")); });
    expect(stub.state.charge).toHaveBeenLastCalledWith({ shopId: 7, tareTypeId: 2, quantity: 1, reason: "потеряли" });
    prompt.mockRestore();
  });

  it("оператор списывать в долг не может — кнопки нет; принять тару — может", () => {
    stub.state.role = "operator";
    show(<TareTab />);
    expect(screen.queryByTestId("tare-charge-7-1")).toBeNull();
    expect(screen.getByTestId("tare-return-7")).toBeTruthy();
  });

  it("приём тары: пустая форма не отправляется; введённое уходит на выбранный склад по умолчанию", () => {
    show(<TareTab />);
    fireEvent.click(screen.getByTestId("tare-return-7"));
    const submit = screen.getByTestId("tare-return-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("tare-return-1"), { target: { value: "2x" } });
    expect((screen.getByTestId("tare-return-1") as HTMLInputElement).value).toBe("2");
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(stub.state.returnFromShop).toHaveBeenCalledWith({ shopId: 7, warehouseId: 10, items: [{ tareTypeId: 1, quantity: 2 }], note: undefined });
    expect(stub.state.invalidate).toHaveBeenCalled();
  });

  it("пересчёт склада: по умолчанию — по системе; поправленное уходит числом", () => {
    show(<TareTab />);
    fireEvent.click(screen.getByTestId("tare-count-10"));
    fireEvent.change(screen.getByLabelText("Кега 50 л"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("tare-count-submit"));
    expect(stub.state.count).toHaveBeenCalledWith({ warehouseId: 10, counted: [{ tareTypeId: 1, quantity: 3 }] });
  });

  it("без видов — подсказка в настройки, таблиц нет", () => {
    stub.state.types = [];
    show(<TareTab />);
    expect(screen.getByText(/Виды тары не заведены/)).toBeTruthy();
    expect(screen.queryByTestId("tare-shop-7")).toBeNull();
    stub.state.types = [{ id: 1, name: "Кега 50 л", depositPrice: 50000, isActive: true }, { id: 2, name: "Ящик", depositPrice: 0, isActive: true }];
  });
});

describe("карточки магазина и товара", () => {
  it("магазин: строки, итог залога, «Принять тару» открывает приём; учёт выключен — ничего", () => {
    const { unmount } = show(<ShopTare shopId={7} shopName="Магазин Альфа" />);
    expect(screen.getByText("Залог, если не вернут")).toBeTruthy();
    fireEvent.click(screen.getByTestId("shop-tare-return"));
    expect(screen.getByText("Принять тару от «Магазин Альфа»")).toBeTruthy();
    unmount();
    stub.state.enabled = false;
    show(<ShopTare shopId={7} shopName="Магазин Альфа" />);
    expect(screen.queryByTestId("shop-tare")).toBeNull();
  });

  it("товар: без тары / с тарой; правка сохраняет вид и штуки на единицу; без права — без карандаша", () => {
    const { unmount } = show(<ProductTare productId={5} tareTypeId={null} perUnit={1} canEdit={false} />);
    expect(screen.getByText("без тары")).toBeTruthy();
    expect(screen.queryByLabelText("Задать тару")).toBeNull();
    unmount();
    show(<ProductTare productId={5} tareTypeId={1} perUnit={2} canEdit />);
    expect(screen.getByText(/Кега 50 л × 2/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Задать тару"));
    fireEvent.change(screen.getByLabelText("Тары на единицу"), { target: { value: "3" } });
    fireEvent.click(screen.getByLabelText("Сохранить"));
    expect(stub.state.setProductTare).toHaveBeenCalledWith({ productId: 5, tareTypeId: 1, perUnit: 3 });
  });
});
