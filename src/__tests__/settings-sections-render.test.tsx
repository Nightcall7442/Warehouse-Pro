// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LangProvider } from "@/i18n";

/**
 * Каждый из семи разделов настроек должен просто отрисоваться.
 *
 * Звучит скромно, но именно это и ломается при переделке вёрстки: пропущенный
 * импорт, переименованное поле формы, обращение к данным, которых ещё нет.
 * Проверка типов такое не ловит — она молчит, если поле объявлено, но приходит
 * пустым; падает всё в браузере, у человека, на белом экране.
 *
 * Данные подменяются целиком: смысл теста не в них, а в том, что разметка
 * собирается без исключений и показывает то, что обещает.
 */

const trpcStub = vi.hoisted(() => {
  const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, refetch: vi.fn() });
  const mutation = () => ({ mutate: vi.fn(), isPending: false });

  return {
    settings: { get: { useQuery: query({
      companyName: "SERENA TRADE", companyAddress: "Urganch", companyInn: "306064304",
      companyDirector: "Xudayberganov Sirojbek", companyPhone: "+998942222022",
      companyBank: "", companyBankAccount: "", companyMfo: "", currency: "UZS", logoUrl: "",
    }) }, update: { useMutation: mutation } },
    branding: {
      get: { useQuery: query({ primaryColor: "#5b6d8a", secondaryColor: "#4a5c78", accentColor: "#3b82f6", companyName: "", appName: "Warehouse Pro", logoUrl: "" }) },
      update: { useMutation: mutation },
      cssVariables: { invalidate: vi.fn() },
    },
    warehouseMulti: {
      list: { useQuery: query([{ id: 1, name: "Основной склад", address: "Ургенч", city: "Хорезм", isDefault: true }]) },
      create: { useMutation: mutation }, update: { useMutation: mutation }, setDefault: { useMutation: mutation },
    },
    telegram: {
      myStatus: { useQuery: query({ connected: false }) },
      deepLink: { useQuery: query({ url: "https://t.me/bot?start=1" }) },
      saveChatId: { useMutation: mutation }, removeChatId: { useMutation: mutation },
    },
    onec: {
      health: { useQuery: query({ healthy: false }) },
      status: { useQuery: query({ errors: 0, lastProductSync: null }) },
      syncProducts: { useMutation: mutation },
      testSavedConnection: { useMutation: () => ({ ...mutation(), data: undefined }) },
    },
    user: { updateMe: { useMutation: mutation }, changePassword: { useMutation: mutation } },
    auth: { me: { invalidate: vi.fn() } },
    useUtils: () => ({
      settings: { get: { invalidate: vi.fn() } },
      branding: { get: { invalidate: vi.fn() }, cssVariables: { invalidate: vi.fn() } },
      warehouseMulti: { list: { invalidate: vi.fn() } },
      telegram: { myStatus: { invalidate: vi.fn() } },
      onec: { health: { invalidate: vi.fn() }, status: { invalidate: vi.fn() } },
      auth: { me: { invalidate: vi.fn() } },
    }),
  };
});

vi.mock("@/providers/trpc", () => ({ trpc: trpcStub }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 10, name: "Xudayberganov Sirojbek", email: "suraj2022@mail.ru", phone: "+998942222022", role: "ceo" },
    isLoading: false,
  }),
}));

import { ProfileSettings } from "@/components/settings/ProfileSettings";
import { CompanySettings } from "@/components/settings/CompanySettings";
import { BrandingSettings } from "@/components/settings/BrandingSettings";
import { WarehouseSettings } from "@/components/settings/WarehouseSettings";
import { TelegramSettings } from "@/components/settings/TelegramSettings";
import { OneCSettings } from "@/components/settings/OneCSettings";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const show = (node: React.ReactNode) => render(<LangProvider>{node}</LangProvider>);

describe("разделы настроек отрисовываются", () => {
  it("профиль — имя и телефон редактируются, адрес показан как значение", () => {
    show(<ProfileSettings />);

    expect((screen.getByLabelText("Имя") as HTMLInputElement).value).toBe("Xudayberganov Sirojbek");
    expect((screen.getByLabelText("Телефон") as HTMLInputElement).value).toBe("+998942222022");

    // Адрес — логин, и правка его молча не сохранялась. Теперь это не поле.
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.getByText("suraj2022@mail.ru")).toBeTruthy();
  });

  it("компания — реквизиты подставлены, банковские поля есть", () => {
    show(<CompanySettings />);

    expect((screen.getByLabelText("Название компании") as HTMLInputElement).value).toBe("SERENA TRADE");
    // Эти три печатаются в счёте, а ввести их раньше было негде.
    expect(screen.getByLabelText("Банк")).toBeTruthy();
    expect(screen.getByLabelText("Расчётный счёт")).toBeTruthy();
    expect(screen.getByLabelText("МФО")).toBeTruthy();
  });

  it("брендинг — три цвета, у каждого одно поле значения", () => {
    show(<BrandingSettings />);

    for (const label of ["Основной", "Вторичный", "Акцент"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
      expect(screen.getByLabelText(`${label} — HEX`)).toBeTruthy();
    }
    // Раньше hex выводился в строке дважды — полем и неизменяемым <code>.
    expect(screen.getAllByDisplayValue("#5b6d8a").length).toBe(2); // выбор цвета + поле
  });

  it("склады — список и кнопки с доступными именами", () => {
    show(<WarehouseSettings />);

    expect(screen.getByText("Основной склад")).toBeTruthy();
    expect(screen.getByLabelText("Редактировать склад")).toBeTruthy();
  });

  it("telegram — подключение и список уведомлений без эмодзи", () => {
    show(<TelegramSettings />);

    expect(screen.getByLabelText("Ваш Telegram chat ID")).toBeTruthy();
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    expect(emoji.test(document.body.textContent ?? "")).toBe(false);
  });

  it("1С — раздел собирается без данных о подключении", () => {
    expect(() => show(<OneCSettings />)).not.toThrow();
  });

  it("внешний вид — обе группы переключателей на месте", () => {
    show(<AppearanceSettings />);
    expect(screen.getAllByRole("radiogroup").length).toBe(2);
  });
});
