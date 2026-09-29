// @vitest-environment jsdom
/**
 * Форма регистрации спрашивает телефон — на экране.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Название, имя, почта, пароль — и всё. Вход закрыт до ссылки из письма:
 * письмо ушло в спам — человек потерян, а номера, чтобы позвонить, нет.
 * Откуда он пришёл, форма не спрашивала и метки из адреса не брала.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Настоящая страница Register:
 *   · без телефона и с кривым номером — отказ до отправки, текстом на языке
 *     экрана; сервер не зовётся;
 *   · поле с маской: вставленный целиком номер становится девятью цифрами
 *     группами, «+998» не удваивается; уходит +998XXXXXXXXX;
 *   · «откуда узнали» и utm_source/ref из адреса уходят вместе с формой, а
 *     если ничего нет — не уходят вовсе;
 *   · отказ сервера по телефону (по-русски) показывается на языке экрана.
 *
 * Нарочная поломка: убрать проверку normalizeUzPhone перед mutate — падает
 * «без телефона»; поставить в onChange голое значение вместо маски — «маска»;
 * не читать адрес страницы — «метки из адреса»; убрать перевод отказа
 * сервера в onError — «отказ сервера».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { PHONE_ERROR } from "@contracts/signup";

const state = vi.hoisted(() => ({
  lang: "ru" as "ru" | "uz",
  calls: [] as Array<Record<string, unknown>>,
  opts: null as null | { onError?: (e: { message: string }) => void; onSuccess?: () => void },
}));

vi.mock("@/providers/trpc", () => ({
  trpc: {
    tenant: {
      register: {
        useMutation: (opts: typeof state.opts) => {
          state.opts = opts;
          return { mutate: (input: Record<string, unknown>) => state.calls.push(input), isPending: false };
        },
      },
    },
    auth: { resendVerification: { useMutation: () => ({ mutate: () => {}, isPending: false, isSuccess: false }) } },
  },
}));
vi.mock("@/i18n", () => ({
  useLang: () => ({ lang: state.lang, t: (k: string) => k }),
  useTranslate: () => (ru: string, uz: string) => (state.lang === "uz" ? uz : ru),
}));
vi.mock("react-router", () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));
vi.mock("@/components/brand/Logo", () => ({ LogoMark: () => <span /> }));

import Register from "@/pages/Register";

beforeEach(() => {
  state.lang = "ru";
  state.calls = [];
  state.opts = null;
  window.history.pushState({}, "", "/register");
});
afterEach(cleanup);

function fillBasics() {
  fireEvent.change(screen.getByTestId("register-name"), { target: { value: "Дилноза" } });
  fireEvent.change(screen.getByTestId("register-companyName"), { target: { value: "Ферганский сок" } });
  fireEvent.change(screen.getByTestId("register-email"), { target: { value: "dilnoza@sok.uz" } });
  fireEvent.change(screen.getByTestId("register-password"), { target: { value: "пароль-восемь" } });
}
const submit = () => fireEvent.click(screen.getByTestId("register-submit"));

describe("телефон обязателен", () => {
  it("без телефона — отказ до отправки, по-узбекски в узбекском интерфейсе", () => {
    state.lang = "uz";
    render(<Register />);
    fillBasics();
    submit();

    expect(screen.getByTestId("register-error").textContent).toContain(PHONE_ERROR.uz);
    expect(state.calls).toHaveLength(0);
  });

  it("кривой номер — тот же отказ по-русски, сервер не зовётся", () => {
    render(<Register />);
    fillBasics();
    fireEvent.change(screen.getByTestId("register-phone"), { target: { value: "01 234 56 78" } });
    submit();

    expect(screen.getByTestId("register-error").textContent).toContain(PHONE_ERROR.ru);
    expect(state.calls).toHaveLength(0);
  });
});

describe("маска и источник", () => {
  it("вставленный номер — девять цифр группами; уходит +998XXXXXXXXX с ответом и метками из адреса", () => {
    window.history.pushState({}, "", "/register?utm_source=ig_sept&ref=bekzod");
    render(<Register />);
    fillBasics();
    const phone = screen.getByTestId("register-phone") as HTMLInputElement;
    fireEvent.change(phone, { target: { value: "+998 90 123 45 67" } });
    expect(phone.value).toBe("90 123 45 67");
    fireEvent.change(screen.getByTestId("register-source"), { target: { value: "telegram" } });
    submit();

    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({
      orgName: "Ферганский сок", email: "dilnoza@sok.uz", phone: "+998901234567",
      source: { answer: "telegram", utmSource: "ig_sept", ref: "bekzod" },
    });
  });

  it("ни ответа, ни меток — источник не отправляется", () => {
    render(<Register />);
    fillBasics();
    fireEvent.change(screen.getByTestId("register-phone"), { target: { value: "901234567" } });
    submit();

    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].phone).toBe("+998901234567");
    expect(state.calls[0].source).toBeUndefined();
  });

  it("варианты ответа — на языке экрана, вопрос необязательный", () => {
    state.lang = "uz";
    render(<Register />);
    const options = [...(screen.getByTestId("register-source") as HTMLSelectElement).options].map(o => o.textContent);
    expect(options).toEqual([
      "Tanlanmagan", "Telegram", "Instagram", "Tanishlar, tavsiya", "1C integratori yoki buxgalter", "Google yoki Yandex qidiruvi", "Boshqa",
    ]);
  });
});

describe("отказ сервера", () => {
  it("сервер отверг телефон по-русски — на экране по-узбекски", () => {
    state.lang = "uz";
    render(<Register />);
    fillBasics();
    fireEvent.change(screen.getByTestId("register-phone"), { target: { value: "901234567" } });
    submit();
    act(() => state.opts?.onError?.({ message: PHONE_ERROR.ru }));

    expect(screen.getByTestId("register-error").textContent).toContain(PHONE_ERROR.uz);
  });
});
