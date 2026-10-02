// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { LangProvider } from "@/i18n";

/**
 * Просроченный долг на экранах: настройка, карточка магазина, заказ.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Задать, что просрочка держит заказ, было негде; своей отсрочки у магазина
 * не было; агент узнавал об удержании только после отправки и со словами
 * «скидка выше порога», а узбекский экран показывал причину по-русски.
 * Форма правки магазина к тому же открывалась с пустым кредитным лимитом:
 * карточка его не отдавала.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. Настройки организации: переключатель выключен по умолчанию, отсрочка
 *    видна; сохранение шлёт переключатель и отсрочку ЧИСЛОМ; не число — отказ
 *    словами, до сервера.
 * 2. Карточка магазина: поле своей отсрочки подписано, показывает то, что
 *    стоит, и уходит в shop.update; кредитный лимит тоже подставлен.
 * 3. Подсказка на шаге выбора магазина: агенту — «встанет на подтверждение»,
 *    офису — «не встанет»; без просрочки — ничего.
 * 4. Причина удержания на заказе видна на обоих языках.
 *
 * Нарочные поломки: убрать `overdueGraceDays: days === "" ? undefined : Number(days)`
 * из save() в CompanySettings — падает 1 (уходит строка); убрать строку
 * paymentGraceDays из полей ShopDetail — падает 2.
 */

const h = vi.hoisted(() => ({
  settingsSave: vi.fn(),
  shopUpdate: vi.fn(),
  overdue: null as null | { amount: number; oldestDays: number; graceDays: number },
  role: "agent",
}));

vi.mock("@/providers/trpc", () => {
  const query = (data: unknown) => () => ({ data, isLoading: false, isLoadingError: false, isError: false, refetch: vi.fn() });
  const mutation = (fn?: (v: unknown) => void) => () => ({ mutate: (v: unknown) => fn?.(v), isPending: false });
  const shop = {
    id: 5, name: "Магазин Альфа", ownerName: null, phone: null, address: null, city: null, district: null,
    photoUrl: null, gpsLat: null, gpsLng: null, debt: "0.00", status: "active", agentId: null, notes: null,
    createdAt: "2026-09-01T00:00:00.000Z", taxId: null, vatPayer: false, creditLimit: "5000000.00", paymentGraceDays: 30,
    agent: null, recentOrders: [], paymentHistory: [],
  };
  return {
    trpc: {
      settings: {
        get: { useQuery: query({ companyName: "SERENA TRADE", currency: "UZS", overdueHoldEnabled: false, overdueGraceDays: 14 }) },
        update: { useMutation: mutation(v => h.settingsSave(v)) },
      },
      shop: {
        getById: { useQuery: query(shop) },
        trace: { useQuery: query(null) },
        update: { useMutation: mutation(v => h.shopUpdate(v)) },
        uploadPhoto: { useMutation: mutation() }, archive: { useMutation: mutation() },
        restore: { useMutation: mutation() }, deleteForever: { useMutation: mutation() },
        addPayment: { useMutation: mutation() },
        // Светофор карточки (components/shops/ShopLight) — здесь не проверяется.
        light: { useQuery: query(null) },
      },
      user: { list: { useQuery: query({ data: [] }) } },
      order: { shopOverdue: { useQuery: () => ({ data: h.overdue }) } },
      useUtils: () => ({ settings: { get: { invalidate: vi.fn() } }, shop: { getById: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } }),
    },
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, name: "Кто-то", role: h.role }, isLoading: false }) }));
vi.mock("@/hooks/useCan", () => ({ useCan: () => () => true }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${Number(v)} сум` }) }));
vi.mock("@/components/ConfirmDialog", () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock("@/components/plans/VisitReports", () => ({ ShopVisitReports: () => null }));
vi.mock("@/components/shops/ShopStatement", () => ({ ShopStatement: () => null }));
vi.mock("@/components/shops/ShopMoney", () => ({ ShopMoney: () => null }));
vi.mock("@/components/shops/ShopPriceList", () => ({ ShopPriceList: () => null }));
vi.mock("@/components/orders/RepeatOrderButtons", () => ({ ShopOrderButtons: () => null }));
vi.mock("@/components/returns/WebReturn", () => ({ ShopReturnButton: () => null }));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { CompanySettings } from "@/components/settings/CompanySettings";
import ShopDetail from "@/pages/ShopDetail";
import { OverdueNotice } from "@/components/orders/OverdueNotice";
import { HoldReasonBanner } from "@/components/orders/HoldReasonBanner";
import { notify } from "@/lib/toast";

beforeEach(() => {
  localStorage.clear();
  h.settingsSave.mockReset(); h.shopUpdate.mockReset(); h.overdue = null; h.role = "agent";
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const show = (node: React.ReactNode) => render(<LangProvider>{node}</LangProvider>);

describe("настройка организации", () => {
  it("выключена по умолчанию; сохраняется переключатель и отсрочка числом", () => {
    show(<CompanySettings />);
    const toggle = screen.getByTestId("overdue-hold-enabled") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    const days = screen.getByLabelText("Отсрочка оплаты по умолчанию, дней") as HTMLInputElement;
    expect(days.value).toBe("14");

    fireEvent.click(toggle);
    fireEvent.change(days, { target: { value: "21" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(h.settingsSave).toHaveBeenCalledTimes(1);
    expect(h.settingsSave.mock.calls[0][0]).toMatchObject({ overdueHoldEnabled: true, overdueGraceDays: 21 });
  });

  it("не число — отказ словами, на сервер не уходит", () => {
    show(<CompanySettings />);
    fireEvent.change(screen.getByLabelText("Отсрочка оплаты по умолчанию, дней"), { target: { value: "две недели" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(h.settingsSave).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith("Отсрочка — целое число дней от 0 до 365");
  });
});

describe("карточка магазина", () => {
  it("своя отсрочка подписана, показывает стоящее и уходит в shop.update; лимит подставлен", () => {
    h.role = "ceo"; // правит карточку офис
    show(
      <MemoryRouter initialEntries={["/shops/5"]}>
        <Routes><Route path="/shops/:id" element={<ShopDetail />} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Изменить/ }));
    const grace = screen.getByLabelText("Отсрочка оплаты, дней (пусто — как у организации)") as HTMLInputElement;
    expect(grace.value).toBe("30");
    expect((screen.getByLabelText("Кредитный лимит (пусто — без лимита)") as HTMLInputElement).value).toBe("5000000.00");

    fireEvent.change(grace, { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: /Сохранить/ }));
    expect(h.shopUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 5, paymentGraceDays: "45" }));
  });
});

describe("подсказка на шаге выбора магазина", () => {
  it("агенту — заказ встанет на подтверждение; офису — не встанет; без просрочки — ничего", () => {
    const { rerender } = show(<OverdueNotice shopId={5} />);
    expect(screen.queryByTestId("overdue-notice")).toBeNull();

    h.overdue = { amount: 1_200_000, oldestDays: 45, graceDays: 14 };
    rerender(<LangProvider><OverdueNotice shopId={5} /></LangProvider>);
    const note = screen.getByTestId("overdue-notice");
    expect(note.textContent).toContain("У магазина просрочка 1200000 сум");
    expect(note.textContent).toContain("самый старый долг — 45 дн.");
    expect(note.textContent).toContain("Заказ встанет на подтверждение офиса.");

    h.role = "operator";
    rerender(<LangProvider><OverdueNotice shopId={5} /></LangProvider>);
    expect(screen.getByTestId("overdue-notice").textContent).toContain("заказ не встанет на ожидание");
  });
});

describe("причина удержания на заказе", () => {
  const reason = "Просроченный долг: 1 200 000 сум, самый старый — 45 дн.";

  it("по-русски — как есть; по-узбекски — переведена; офису — как подтвердить", () => {
    const { rerender } = render(<HoldReasonBanner status="pending" holdReason={reason} lang="ru" canConfirm />);
    expect(screen.getByTestId("order-hold-reason").textContent)
      .toBe(`Ждёт подтверждения офиса: ${reason} — чтобы подтвердить, переведите в «новый»`);

    rerender(<HoldReasonBanner status="pending" holdReason={reason} lang="uz" canConfirm={false} />);
    expect(screen.getByTestId("order-hold-reason").textContent)
      .toBe("Ofis tasdig'ini kutmoqda: Muddati o'tgan qarz: 1 200 000 сум, eng eskisi — 45 kun");

    rerender(<HoldReasonBanner status="new" holdReason={reason} lang="ru" canConfirm />);
    expect(screen.queryByTestId("order-hold-reason")).toBeNull();
  });
});
