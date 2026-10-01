// @vitest-environment jsdom
/**
 * Профиль аккаунта — отдельными блоками, и второй фактор можно включить с
 * телефона.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * 01.10.2026 владелец с iPhone: «смешал всё… нет кнопки скопировать». Профиль
 * был одной лентой (имя, логин, пароль, второй фактор, выход вперемешку),
 * у суперадмина — подсказка «имя видят коллеги», которых у него нет. Ключ
 * второго фактора — в поле только для чтения, без «Скопировать» и без QR, и
 * user.totpEnable не был вызван ни разу. Под кнопкой выхода было написано
 * «кроме этого устройства», а выходит и это.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   - четыре блока в одном порядке — «Имя и телефон», «Логин и пароль»,
 *     «Вход с кодом из приложения», «Сеансы», — у каждого своя кнопка и своё
 *     сообщение; строки профиля на телефоне — в том же порядке и ведут к
 *     своему блоку (?block=…), а ?block= прокручивает к нему;
 *   - у суперадмина нигде нет «коллег», у директора подсказка про коллег есть;
 *   - смена логина и смена пароля раскрываются по отдельности, не вместе;
 *   - мастер: «Скопировать ключ» кладёт ключ в буфер и пишет «Скопировано»;
 *     без navigator.clipboard — запасной путь; не вышло и так — просьба
 *     скопировать руками; ключ показан группами по четыре;
 *   - QR рисуется из той же строки otpauth://, что у кнопки «Открыть в
 *     приложении-аутентификаторе»;
 *   - шесть цифр уходят в user.totpEnable (лишнее отрезается), неверный код
 *     объяснён словами про 30 секунд; выданный ключ переживает перезагрузку
 *     страницы и стирается после включения;
 *   - текст про выход на всех устройствах честный: выходит и это устройство.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, act, waitFor } from "@testing-library/react";
import { LangProvider } from "@/i18n";

type TestUser = { id: number; name: string; email: string; phone: string; role: string; totpEnabledAt: string | null };
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const URL_ = `otpauth://totp/Warehouse%20Pro:superadmin%40system.local?secret=${SECRET}&issuer=Warehouse%20Pro&algorithm=SHA1&digits=6&period=30`;

const h = vi.hoisted(() => {
  const state = {
    user: null as unknown as { id: number; role: string; totpEnabledAt?: string | null },
    navigated: [] as string[],
    calls: [] as Array<{ path: string; input: unknown }>,
    // Ответ мутации по пути: значение → onSuccess, Error с data.code → onError.
    replies: {} as Record<string, unknown>,
  };
  type Opts = { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void };
  const make = (path: string[]): unknown => new Proxy(() => {}, {
    get: (_t, k: string | symbol) => {
      if (typeof k === "symbol") return undefined;
      if (k === "useQuery") return () => ({ data: undefined, isLoading: false, isError: false, refetch: () => {} });
      if (k === "useMutation") return (opts: Opts = {}) => ({
        isPending: false,
        mutate: (input: unknown) => {
          const p = path.join(".");
          state.calls.push({ path: p, input });
          const r = state.replies[p];
          if (r instanceof Error) opts.onError?.(r); else opts.onSuccess?.(r);
        },
      });
      if (k === "useUtils") return () => make(["utils"]);
      if (k === "invalidate") return () => {};
      return make([...path, k]);
    },
  });
  return { state, trpc: make([]) };
});

vi.mock("@/providers/trpc", () => ({ trpc: h.trpc }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.state.user, isLoading: false, logout: () => {} }) }));
vi.mock("react-router", () => ({ useNavigate: () => (to: string) => h.state.navigated.push(to) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light", toggle: () => {} }) }));
vi.mock("@/hooks/useAppBrand", () => ({ useAppBrand: () => ({ name: "Warehouse Pro" }) }));
vi.mock("@/components/phone/PhonePlan", () => ({ QuotaCard: () => null }));
const qr = vi.hoisted(() => ({ toString: vi.fn(async (text: string) => `<svg xmlns="http://www.w3.org/2000/svg"><desc>${text}</desc></svg>`) }));
vi.mock("qrcode", () => ({ default: qr }));

const { ProfileSettings } = await import("@/components/settings/ProfileSettings");
const { PhoneProfile } = await import("@/components/phone/PhoneProfile");

const superadmin: TestUser = { id: 1, name: "Владелец платформы", email: "superadmin@system.local", phone: "", role: "superadmin", totpEnabledAt: null };
const ceo: TestUser = { id: 10, name: "Каримов Акбар", email: "ceo@demo-uz.uz", phone: "+998901112233", role: "ceo", totpEnabledAt: null };

const trpcError = (code: string, message: string) => Object.assign(new Error(message), { data: { code } });
const show = (node: React.ReactNode) => render(<LangProvider>{node}</LangProvider>);
const blockIds = () => [...document.querySelectorAll<HTMLElement>('[data-testid^="profile-block-"]')].map(e => e.dataset.testid);
const startWizard = async () => {
  h.state.replies["user.totpSetup"] = { secret: SECRET, url: URL_ };
  fireEvent.click(screen.getByTestId("totp-start"));
  await screen.findByTestId("totp-qr");
};

beforeEach(() => {
  h.state.user = superadmin;
  h.state.navigated = [];
  h.state.calls = [];
  h.state.replies = {};
  qr.toString.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

describe("блоки профиля", () => {
  it("четыре блока в одном порядке, у каждого своя кнопка", () => {
    show(<ProfileSettings />);
    expect(blockIds()).toEqual(["profile-block-name", "profile-block-login", "profile-block-totp", "profile-block-sessions"]);

    const own = (block: string, testId: string) => within(screen.getByTestId(`profile-block-${block}`)).getByTestId(testId);
    expect(own("name", "name-save").textContent).toBe("Сохранить");
    expect(own("login", "change-password-toggle")).toBeTruthy();
    expect(own("totp", "totp-start").textContent).toBe("Включить");
    expect(own("sessions", "logout-all").textContent).toBe("Выйти на всех устройствах");

    // Сохранение имени шлёт только имя и телефон и отвечает в своём блоке.
    h.state.replies["user.updateMe"] = { success: true };
    fireEvent.click(screen.getByTestId("name-save"));
    expect(h.state.calls).toEqual([{ path: "user.updateMe", input: { name: "Владелец платформы", phone: "" } }]);
    expect(within(screen.getByTestId("profile-block-name")).getByTestId("name-note").textContent).toBe("Сохранено");
  });

  it("у директора — те же блоки в том же порядке", () => {
    h.state.user = ceo;
    show(<ProfileSettings />);
    expect(blockIds()).toEqual(["profile-block-name", "profile-block-login", "profile-block-totp", "profile-block-sessions"]);
  });

  it("у суперадмина нет «коллег», у директора подсказка про коллег осталась", () => {
    show(<ProfileSettings />);
    expect(document.body.textContent).not.toMatch(/коллег/i);
    expect(screen.getByText("Как вас подписывать в журнале действий и уведомлениях")).toBeTruthy();
    cleanup();

    h.state.user = ceo;
    show(<ProfileSettings />);
    expect(screen.getByText("Имя видят коллеги в заказах и отчётах")).toBeTruthy();
  });

  it("смена логина и смена пароля раскрываются по отдельности", () => {
    show(<ProfileSettings />);
    const login = within(screen.getByTestId("profile-block-login"));
    expect(login.queryByTestId("my-login-email")).toBeNull();
    expect(login.queryByTestId("password-current")).toBeNull();

    fireEvent.click(login.getByTestId("my-login-toggle"));
    expect(login.getByTestId("my-login-email")).toBeTruthy();
    expect(login.queryByTestId("password-current"), "два поля «текущий пароль» сразу").toBeNull();

    fireEvent.click(login.getByTestId("change-password-toggle"));
    expect(login.getByTestId("password-current")).toBeTruthy();
    expect(login.queryByTestId("my-login-email")).toBeNull();
  });

  it("текст про выход на всех устройствах честный: выходит и это устройство", () => {
    show(<ProfileSettings />);
    const text = screen.getByTestId("sessions-text").textContent ?? "";
    expect(text).not.toMatch(/кроме этого/);
    expect(text).toContain("на этом устройстве тоже");
  });

  it("?block=… прокручивает к своему блоку", () => {
    const seen: string[] = [];
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) { seen.push(this.id); };
    try {
      window.history.replaceState(null, "", "/settings?section=profile&block=sessions");
      show(<ProfileSettings />);
      expect(seen).toEqual(["profile-sessions"]);
    } finally {
      Element.prototype.scrollIntoView = orig;
    }
  });
});

describe("мастер второго фактора", () => {
  it("три шага; ключ группами по четыре; «Скопировать ключ» кладёт ключ в буфер и пишет «Скопировано»", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    show(<ProfileSettings />);
    await startWizard();

    expect(screen.getByTestId("totp-step-1").textContent).toContain("Установите приложение-аутентификатор");
    expect(screen.getByTestId("totp-step-2").textContent).toContain("Добавьте ключ в приложение");
    expect(screen.getByTestId("totp-step-3").textContent).toContain("Введите 6 цифр из приложения");
    expect(screen.getByTestId("totp-secret").textContent?.replace(/\s+/g, " ").trim())
      .toBe("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP");

    const copy = screen.getByTestId("totp-copy");
    expect(copy.textContent).toBe("Скопировать ключ");
    await act(async () => { fireEvent.click(copy); });
    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(screen.getByTestId("totp-copy").textContent).toBe("Скопировано");
  });

  it("без navigator.clipboard — запасной путь через выделение; не вышло и так — просим скопировать руками", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    show(<ProfileSettings />);
    await startWizard();
    await act(async () => { fireEvent.click(screen.getByTestId("totp-copy")); });
    expect(exec).toHaveBeenCalledWith("copy");
    expect(screen.getByTestId("totp-copy").textContent).toBe("Скопировано");

    exec.mockReturnValue(false);
    cleanup();
    show(<ProfileSettings />);
    await screen.findByTestId("totp-qr"); // ключ из sessionStorage — мастер на месте
    await act(async () => { fireEvent.click(screen.getByTestId("totp-copy")); });
    expect(screen.getByTestId("totp-copy-failed").textContent).toContain("скопируйте сами");
  });

  it("QR-код — из той же строки otpauth://, что у кнопки «Открыть в приложении-аутентификаторе»", async () => {
    show(<ProfileSettings />);
    await startWizard();
    const open = screen.getByTestId("totp-open-app") as HTMLAnchorElement;
    expect(open.getAttribute("href")).toBe(URL_);
    expect(open.textContent).toContain("Открыть в приложении-аутентификаторе");
    expect(qr.toString).toHaveBeenCalledWith(URL_, expect.objectContaining({ type: "svg" }));
    const img = screen.getByTestId("totp-qr") as HTMLImageElement;
    expect(decodeURIComponent(img.src)).toContain(`<desc>${URL_}</desc>`);
  });

  it("шесть цифр уходят в totpEnable; неверный код объяснён; после включения ключ стёрт", async () => {
    show(<ProfileSettings />);
    await startWizard();
    const enable = screen.getByTestId("totp-enable") as HTMLButtonElement;
    expect(enable.disabled, "без кода кнопка не жмёт").toBe(true);

    fireEvent.change(screen.getByTestId("totp-code"), { target: { value: " 12-34 56 7" } });
    expect((screen.getByTestId("totp-code") as HTMLInputElement).value).toBe("123456");

    h.state.replies["user.totpEnable"] = trpcError("BAD_REQUEST", "Неверный код — проверьте время на телефоне");
    fireEvent.click(enable);
    expect(h.state.calls.at(-1)).toEqual({ path: "user.totpEnable", input: { code: "123456" } });
    expect(screen.getByTestId("totp-note").textContent).toContain("коды меняются каждые 30 секунд");
    expect(sessionStorage.getItem("wp.totp-pending"), "ключ должен пережить перезагрузку, пока не включён").toContain(SECRET);

    h.state.replies["user.totpEnable"] = { success: true };
    fireEvent.change(screen.getByTestId("totp-code"), { target: { value: "654321" } });
    fireEvent.click(screen.getByTestId("totp-enable"));
    expect(h.state.calls.at(-1)).toEqual({ path: "user.totpEnable", input: { code: "654321" } });
    expect(screen.getByTestId("totp-enabled")).toBeTruthy();
    expect(screen.getByTestId("totp-state").textContent).toBe("Включён");
    expect(screen.getByTestId("totp-note").textContent).toContain("включён");
    expect(sessionStorage.getItem("wp.totp-pending")).toBeNull();
  });

  it("выданный ключ переживает перезагрузку страницы — повторное «Включить» не нужно", async () => {
    show(<ProfileSettings />);
    await startWizard();
    cleanup();
    show(<ProfileSettings />);
    await waitFor(() => expect(screen.getByTestId("totp-setup")).toBeTruthy());
    expect(screen.getByTestId("totp-secret").textContent?.replace(/\s+/g, "")).toBe(SECRET);
    expect(h.state.calls.filter(c => c.path === "user.totpSetup")).toHaveLength(1);
  });

  it("включён — выключение отдельным шагом и по коду", () => {
    h.state.user = { ...superadmin, totpEnabledAt: "2026-10-01T00:00:00Z" };
    show(<ProfileSettings />);
    expect(screen.queryByTestId("totp-off-code")).toBeNull();
    fireEvent.click(screen.getByTestId("totp-disable-open"));
    fireEvent.change(screen.getByTestId("totp-off-code"), { target: { value: "111222" } });
    h.state.replies["user.totpDisable"] = { success: true };
    fireEvent.click(screen.getByTestId("totp-disable"));
    expect(h.state.calls.at(-1)).toEqual({ path: "user.totpDisable", input: { code: "111222" } });
    expect(screen.getByTestId("totp-state").textContent).toBe("Выключен");
  });
});

describe("профиль на телефоне ведёт в те же блоки", () => {
  it("строки «Аккаунта» — в порядке блоков, каждая к своему", () => {
    show(<PhoneProfile />);
    const rows = ["profile-name-row", "profile-login-row", "profile-totp-row", "profile-sessions-row"];
    const order = [...document.querySelectorAll<HTMLElement>("[data-testid$='-row']")].map(e => e.dataset.testid).filter(id => rows.includes(id!));
    expect(order).toEqual(rows);
    for (const id of rows) fireEvent.click(screen.getByTestId(id));
    expect(h.state.navigated).toEqual(["name", "login", "totp", "sessions"].map(b => `/settings?section=profile&block=${b}`));
    // Форм на телефонной странице больше нет — правится только в блоках.
    expect(document.querySelectorAll("input:not([type=file])").length).toBe(0);
  });
});
