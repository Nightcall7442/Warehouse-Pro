// @vitest-environment jsdom
/**
 * Вход с iPhone — тем же логином и паролем, что в APK.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Арендатор 15.10.2026: новый агент с iPhone не может войти на сайт —
 * «неверный логин или пароль», а с теми же логином и паролем на Android в
 * APK входит.
 *
 * Сервер у обоих один (/api/login), разница — в том, что уходит из поля.
 * APK (warehouse-pro-mobile, app/(auth)/login.tsx) отключает у поля логина
 * автозаглавную и отправляет логин как email.trim().toLowerCase(). Веб слал
 * поле как есть, а у пароля ничего не отключал. На iPhone «показать пароль»
 * делает поле обычным текстом, и клавиатура iOS ставит первую букву
 * заглавной, правит «опечатки» и меняет кавычки и дефисы — на сервер уходит
 * не тот пароль, что человек видит в голове. autoComplete="email" к тому же
 * подсказывает над клавиатурой личную почту из «Контактов», а не логин.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  · у логина и пароля выключены автозаглавная, автоисправление и проверка
 *    правописания — и в скрытом, и в показанном пароле;
 *  · логин подсказывается как username — iOS предлагает сохранённые входы;
 *  · логин уходит как в APK: без пробелов по краям и строчными; пароль — как
 *    набран, его не трогаем.
 *
 * Нарочная поломка: сними autoCapitalize="none" у пароля — упадёт «показанный
 * пароль»; верни body с сырым email — упадёт «логин как в APK».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null, isLoading: false }) }));
vi.mock("@/i18n", () => ({
  useLang: () => ({ lang: "ru", t: (key: string) => key }),
  useTranslate: () => (ru: string) => ru,
}));
vi.mock("@/providers/trpc", () => ({
  trpc: { auth: { resendVerification: { useMutation: () => ({ mutate: () => {}, reset: () => {}, isPending: false, isSuccess: false }) } } },
}));
vi.mock("react-router", () => ({
  useNavigate: () => () => {},
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));
vi.mock("@/components/brand/AppBrand", () => ({ AppBrand: () => <span>Warehouse Pro</span> }));
vi.mock("@/lib/remembered-brand", () => ({ recallBrand: () => null }));

import Login from "@/pages/Login";

const fetchMock = vi.fn();
beforeEach(() => {
  cleanup();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "Неверный email или пароль" }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** Клавиатура iOS ничего не правит в поле: ни заглавной, ни автоисправления. */
function expectNoKeyboardRewrites(el: HTMLElement) {
  expect(el.getAttribute("autocapitalize"), "iOS поставит первую букву заглавной").toBe("none");
  expect(el.getAttribute("autocorrect"), "iOS «исправит» набранное").toBe("off");
  expect(el.getAttribute("spellcheck")).toBe("false");
}

describe("клавиатура iPhone не трогает логин и пароль", () => {
  it("логин — без автозаглавной и подсказывается как вход, а не как личная почта", () => {
    render(<Login />);
    const login = screen.getByTestId("login-email");
    expectNoKeyboardRewrites(login);
    expect(login.getAttribute("autocomplete")).toBe("username");
  });

  it("пароль — скрытый и показанный", () => {
    render(<Login />);
    const pw = screen.getByTestId("login-password");
    expectNoKeyboardRewrites(pw);
    // «Показать пароль» делает поле текстовым — именно тогда iOS и правит ввод.
    fireEvent.click(pw.parentElement!.querySelector("button[type='button']")!);
    const shown = screen.getByTestId("login-password");
    expect(shown.getAttribute("type")).toBe("text");
    expectNoKeyboardRewrites(shown);
  });
});

describe("логин уходит как в APK", () => {
  it("без пробелов по краям и строчными; пароль — как набран", async () => {
    render(<Login />);
    fireEvent.change(screen.getByTestId("login-email"), { target: { value: "Agent.Nur@Example.UZ" } });
    fireEvent.change(screen.getByTestId("login-password"), { target: { value: "Parol 2026 " } });
    fireEvent.click(screen.getByTestId("login-submit"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.email).toBe("agent.nur@example.uz");
    expect(body.password).toBe("Parol 2026 ");
  });
});
