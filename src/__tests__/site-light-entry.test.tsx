// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { MemoryRouter } from "react-router";

/**
 * Лёгкий вход сайта: кто его получает и что в нём работает.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. Выбор во входе (src/main.tsx): гость на готовой странице сайта (метка
 *    <meta name="wp-site">) — сайт; тот, кто входил в этом браузере
 *    (wp.hadSession), — приложение, как раньше; оболочка без метки (её
 *    отдают вошедшему по куке и service worker без связи) — приложение.
 * 2. Голый клиент сайта (lib/public-api): заявка уходит тем же запросом
 *    lead.create, с версией сборки и языком страницы — на /uz отказ должен
 *    прийти по-узбекски.
 * 3. Форма заявки без react-query: «Отправляем…», «Заявка принята», текст
 *    отказа и повторная отправка после него; второй щелчок, пока первая
 *    заявка в пути, второй заявки не шлёт.
 * 4. Маршруты сайта: узбекская страница по-узбекски и с <html lang="uz">;
 *    адрес не сайта (/register) — полной загрузкой с теми же метками.
 *
 * Нарочная поломка: в main.tsx грузить сайт без проверки hadSession —
 * падает «входивший получает приложение»; убрать x-lang из lib/client-fetch
 * — «язык страницы в заголовке»; убрать проверку pending в submit — «вторая
 * заявка не уходит».
 */

const flags = { site: 0, app: 0 };

const lead = vi.hoisted(() => ({ calls: [] as unknown[], next: null as null | { resolve: (v: unknown) => void; reject: (e: unknown) => void } }));
const leaveSite = vi.hoisted(() => vi.fn());
vi.mock("@/site/leave-site", () => ({ leaveSite }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("вход выбирает между сайтом и приложением", () => {
  const boot = async ({ meta, session }: { meta: boolean; session: boolean }) => {
    vi.resetModules();
    flags.site = 0; flags.app = 0;
    // Оба входа подменены: проверяется только выбор, а не запуск страницы.
    vi.doMock("@/site/site-main", () => { flags.site++; return {}; });
    vi.doMock("@/app-main", () => { flags.app++; return {}; });
    document.head.innerHTML = meta ? '<meta name="wp-site" content="home">' : "";
    localStorage.clear();
    if (session) localStorage.setItem("wp.hadSession", "1");
    await import("@/main");
    // import() во входе — отложенный: дождаться, пока он выполнится.
    await vi.waitFor(() => expect(flags.site + flags.app).toBe(1));
  };

  it("гость на готовой странице сайта — лёгкий сайт", async () => {
    await boot({ meta: true, session: false });
    expect(flags).toEqual({ site: 1, app: 0 });
  });

  it("входивший в этом браузере — приложение, даже на странице сайта", async () => {
    await boot({ meta: true, session: true });
    expect(flags).toEqual({ site: 0, app: 1 });
  });

  it("оболочка без метки (вошедший по куке, PWA без связи, /login) — приложение", async () => {
    await boot({ meta: false, session: false });
    expect(flags).toEqual({ site: 0, app: 1 });
  });
});

describe("голый клиент сайта: заявка", () => {
  beforeEach(() => { localStorage.clear(); });

  const capture = () => {
    const seen: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), method: init.method ?? "GET", headers: new Headers(init.headers), body: String(init.body) });
      return new Response(JSON.stringify({ result: { data: { json: { ok: true } } } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    return seen;
  };

  it("lead.create — POST с версией сборки и языком интерфейса, тело — superjson", async () => {
    const seen = capture();
    const { createLead } = await vi.importActual<typeof import("@/lib/public-api")>("@/lib/public-api");
    await createLead({ name: "Иван", phone: "+998 90 123 45 67", source: "hero" });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toMatch(/\/api\/trpc\/lead\.create$/);
    expect(seen[0].method).toBe("POST");
    expect(seen[0].headers.get("x-client-version")).toMatch(/^web\//);
    expect(seen[0].headers.get("x-lang")).toBe("ru");
    expect(JSON.parse(seen[0].body)).toEqual({ json: { name: "Иван", phone: "+998 90 123 45 67", source: "hero" } });
  });

  it("язык страницы в заголовке: на /uz отказ придёт по-узбекски", async () => {
    const seen = capture();
    const { createLead } = await vi.importActual<typeof import("@/lib/public-api")>("@/lib/public-api");
    const { claimPageLang, releasePageLang } = await import("@/i18n/page-lang");
    const owner = {};
    claimPageLang(owner, "uz");
    try {
      await createLead({ name: "Ivan", phone: "+998 90 123 45 67", source: "cta" });
    } finally {
      releasePageLang(owner);
    }
    expect(seen[0].headers.get("x-lang")).toBe("uz");
  });
});

vi.mock("@/lib/public-api", () => ({
  createLead: (input: unknown) => {
    lead.calls.push(input);
    return new Promise((resolve, reject) => { lead.next = { resolve, reject }; });
  },
}));

describe("форма заявки без react-query", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); lead.calls = []; lead.next = null; });

  const draw = async () => {
    const { default: LeadForm } = await import("@/components/landing/LeadForm");
    const { LangProvider } = await import("@/i18n");
    render(<MemoryRouter><LangProvider><LeadForm source="hero" /></LangProvider></MemoryRouter>);
    fireEvent.change(screen.getByTestId("lead-name"), { target: { value: "Иван" } });
    fireEvent.change(screen.getByTestId("lead-phone"), { target: { value: "+998 90 123 45 67" } });
  };
  const submit = () => fireEvent.submit(screen.getByTestId("lead-name").closest("form")!);

  it("в пути — «Отправляем…», кнопка выключена; ответ — «Заявка принята»", async () => {
    await draw();
    submit();
    expect(screen.getByTestId("lead-submit").textContent).toMatch(/Отправляем/);
    expect((screen.getByTestId("lead-submit") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { lead.next!.resolve({ ok: true }); });
    expect(screen.getByText("Заявка принята")).toBeTruthy();
    expect(screen.queryByTestId("lead-submit")).toBeNull();
  });

  it("вторая заявка не уходит, пока первая в пути", async () => {
    await draw();
    submit();
    submit();
    expect(lead.calls).toHaveLength(1);
  });

  it("отказ — его текст под формой, поля на месте, можно отправить снова", async () => {
    await draw();
    submit();
    // Ответ сервера с пометкой языка (data.lang) — errorText показывает его слова.
    await act(async () => { lead.next!.reject({ message: "Слишком много заявок с этого номера", data: { lang: "ru", code: "TOO_MANY_REQUESTS" } }); });
    expect(screen.getByTestId("lead-error").textContent).toBe("Слишком много заявок с этого номера");
    expect((screen.getByTestId("lead-name") as HTMLInputElement).value).toBe("Иван");
    submit();
    expect(lead.calls).toHaveLength(2);
  });
});

describe("маршруты сайта", () => {
  beforeEach(() => { localStorage.clear(); leaveSite.mockClear(); });

  const draw = async (at: string) => {
    const { default: SiteApp } = await import("@/site/SiteApp");
    const { LangProvider, useLang } = await import("@/i18n");
    const Page = ({ name }: { name: string }) => { const { lang } = useLang(); return <p data-testid="page">{name}:{lang}</p>; };
    render(
      <MemoryRouter initialEntries={[at]}>
        <LangProvider>
          <SiteApp pages={{ home: () => <Page name="home" />, compare: () => <Page name="compare" />, privacy: () => <Page name="privacy" /> }} />
        </LangProvider>
      </MemoryRouter>,
    );
  };

  it.each([
    ["/", "home:ru"],
    ["/compare", "compare:ru"],
    ["/privacy", "privacy:ru"],
    ["/uz", "home:uz"],
    ["/uz/compare", "compare:uz"],
  ])("%s → %s", async (at, expected) => {
    await draw(at);
    expect(screen.getByTestId("page").textContent).toBe(expected);
    expect(leaveSite).not.toHaveBeenCalled();
  });

  it("узбекская страница ставит <html lang=\"uz\">, выбор не сохраняет", async () => {
    await draw("/uz/compare");
    expect(document.documentElement.lang).toBe("uz");
    expect(localStorage.getItem("lang")).toBeNull();
  });

  it("адрес не сайта — полной загрузкой, с метками в адресе", async () => {
    await draw("/register?utm_source=ig#top");
    expect(screen.queryByTestId("page")).toBeNull();
    expect(leaveSite).toHaveBeenCalledWith("/register?utm_source=ig#top");
  });
});
