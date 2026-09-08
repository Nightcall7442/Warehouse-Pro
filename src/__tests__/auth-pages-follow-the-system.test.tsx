// @vitest-environment jsdom
/**
 * Экраны входа — часть приложения, а не отдельный продукт.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Вход был собран мимо системы оформления: тридцать шесть цветов, вписанных
 * числом, из палитры, которой в приложении нет (бирюза #0d9488 у кнопки и синяя
 * тень от неё же — остаток ещё более раннего вида), шрифт Inter, который даже
 * не подключён и подставлялся системным, тёмной темы нет вовсе. У сброса пароля
 * была своя обводка #dde2ec, у регистрации — своя сетка #2b3450. Первое, что
 * видит человек в системе, выглядело чужим, а переход между этими экранами —
 * переходом между разными продуктами.
 *
 * Приветствие «Добро пожаловать» стояло ДВАЖДЫ: крупно слева и ещё раз в
 * карточке.
 *
 * Отдельно жаловались на жёлтые полосы вокруг поля при вводе логина — Chrome
 * красит автозаполненное поле своим фоном поверх нашего.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const AUTH_PAGES = ["Login", "Register", "ForgotPassword", "ResetPassword", "AcceptInvite"];

/** Текст файла без комментариев: пояснения сами называют прежние цвета. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("цвета берутся из системы оформления", () => {
  it.each(AUTH_PAGES)("%s не красит ничего числом", (page) => {
    /*
      Разрешён единственный вид числа — запасное значение внутри var(): токен
      может не подгрузиться, и запасной цвет там уместен. Всё остальное — цвет,
      который не знает про тему, то есть светлая полоса на тёмном экране.
    */
    const withoutFallbacks = code(join(SRC, "pages", `${page}.tsx`)).replace(/var\([^)]*\)/g, "");
    const hex = [...withoutFallbacks.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]);
    expect(hex).toEqual([]);
  });

  it("общая оболочка тоже без цветов числом", () => {
    const shell = code(join(SRC, "components", "auth", "AuthShell.tsx")).replace(/var\([^)]*\)/g, "");
    expect([...shell.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0])).toEqual([]);
  });

  it("шрифт входа — тот же, что у приложения", () => {
    // Inter в проекте не подключён: он подставлялся системным, и вход набирался
    // не тем шрифтом, что всё остальное.
    expect(code(join(SRC, "pages", "Login.tsx"))).not.toContain("Inter");
  });
});

describe("жёлтое от автозаполнения погашено", () => {
  it("правило есть и оно общее для приложения", () => {
    /*
      Отменить заливку Chrome свойством background нельзя: браузер рисует её
      отдельно и с большим приоритетом. Работает только бесконечный переход —
      смена цвета формально начинается и не доходит до конца никогда.
    */
    const css = readFileSync(join(SRC, "index.css"), "utf8");
    expect(css).toContain("input:-webkit-autofill");
    expect(css).toMatch(/transition:\s*background-color\s+100000s/);
    // Цвет текста на автозаполненном поле обычным color не перебить.
    expect(css).toContain("-webkit-text-fill-color");
  });
});

// ── Отрисовка ───────────────────────────────────────────────────────────────

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null, isLoading: false }) }));
vi.mock("@/i18n", () => ({
  useLang: () => ({
    lang: "ru",
    t: (key: string) => ({
      "auth.login.title": "Добро пожаловать",
      "auth.login.subtitle": "Войдите в свой аккаунт",
      "auth.login.email": "Email",
      "auth.login.password": "Пароль",
      "auth.login.submit": "Войти",
      "auth.login.submitting": "Вход…",
      "auth.login.forgotPassword": "Забыли пароль?",
      "auth.login.noAccount": "Нет аккаунта?",
      "auth.login.createAccount": "Создать",
    }[key] ?? key),
  }),
}));
vi.mock("react-router", () => ({
  useNavigate: () => () => {},
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));
vi.mock("@/components/brand/AppBrand", () => ({ AppBrand: () => <span>Warehouse Pro</span> }));
vi.mock("@/lib/remembered-brand", () => ({ recallBrand: () => null }));

import Login from "@/pages/Login";

beforeEach(cleanup);

describe("экран входа", () => {
  it("рисует поля и кнопку", () => {
    render(<Login />);
    expect(screen.getByTestId("login-email")).toBeTruthy();
    expect(screen.getByTestId("login-password")).toBeTruthy();
    expect(screen.getByTestId("login-submit")).toBeTruthy();
  });

  it("приветствие стоит один раз, а не дважды", () => {
    /*
      Раньше «Добро пожаловать» было и слева крупно, и в карточке. Одна и та же
      фраза в двух местах одного экрана читается как недоделка.
    */
    render(<Login />);
    expect(screen.getAllByText("Добро пожаловать")).toHaveLength(1);
    expect(screen.getAllByText("Войдите в свой аккаунт")).toHaveLength(1);
  });

  it("слева говорит о системе, а не повторяет приветствие", () => {
    render(<Login />);
    expect(screen.getByText(/Склад, заказы и долги/)).toBeTruthy();
  });

  it("поля вдавлены общим классом, а не своей обводкой", () => {
    render(<Login />);
    expect(screen.getByTestId("login-email").className).toContain("auth-input");
    expect(screen.getByTestId("login-submit").className).toContain("neo-btn-primary");
  });
});
