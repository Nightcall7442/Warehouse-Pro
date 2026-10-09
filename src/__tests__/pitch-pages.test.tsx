// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactElement } from "react";
import { readFileSync } from "node:fs";

/**
 * Сайт конкурса Pitch Day 3.0: /pitch и /demo.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. Оба адреса публичные: в App.tsx они стоят среди открытых маршрутов, до
 *    оболочки приложения (AppLayout, RoleGuard) — открыть ссылку может
 *    человек без учётной записи.
 * 2. Все разделы конкурса на месте и не пустые: 1 Муаммо → Ечим, 2 Жамоа
 *    (имя, роль, навыки, ссылки), 3 почему мы (числа), 4 дорожная карта с
 *    отметкой «мы здесь» на «запущен», 5 этапы, технологии и ИИ, 6 — /demo
 *    (ролик, описание, вход в прототип), плюс API.
 * 3. Язык: узбекский по умолчанию, явный выбор сильнее; переключатель
 *    сохраняет выбор.
 * 4. /demo: плеер с обложкой без автозапуска; сцены описания по времени
 *    переносят в плеер; не открылся ролик — обложка и ссылка. Кнопки входа —
 *    по ролям, которые сервер назвал; выключено — честный блок с регистрацией.
 * 5. API на странице — тот, что есть: каждый путь существует в
 *    api/public-api.ts (или в смонтированном там orders-v1).
 * 6. Ни одного заполнителя вроде {{customers}} и ни одной пустой ссылки
 *    (Telegram без адреса не рисуется).
 */

vi.setConfig({ testTimeout: 20_000 });

import Pitch from "@/pages/Pitch";
import PitchDemo from "@/pages/PitchDemo";
import { LangProvider } from "@/i18n";
import { API_ENDPOINTS, TEAM, ENGINEERING, VIDEO_SRC, VIDEO_POSTER, VIDEO_DESCRIPTION, VIDEO_SECONDS, PROBLEMS, TRACTION, HIRING, MARKET_PROOF, ALTERNATIVES, PARITY, IDEAS, GAPS } from "@/components/pitch/pitch-content";
import { FIELD_PRICE_UZS, formatSum } from "@contracts/pricing";

type Status = { enabled: boolean; roles: string[]; apiKey: string | null };
let status: Status;
let loginStatus: number;
const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
  if (url === "/api/demo/status") return new Response(JSON.stringify(status), { status: 200, headers: { "content-type": "application/json" } });
  if (url === "/api/demo/login") return new Response(JSON.stringify({}), { status: loginStatus });
  return new Response("{}", { status: 404 });
});

const assign = vi.fn();

beforeEach(() => {
  status = { enabled: true, roles: ["ceo", "agent", "supervisor"], apiKey: null };
  loginStatus = 200;
  fetchMock.mockClear();
  assign.mockClear();
  localStorage.clear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const draw = (el: ReactElement) => render(<MemoryRouter><LangProvider>{el}</LangProvider></MemoryRouter>);

describe("маршруты публичные", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  it.each(["/pitch", "/demo"])("%s — среди открытых маршрутов, до оболочки приложения", (path) => {
    const at = app.indexOf(`<Route path="${path}"`);
    expect(at, path).toBeGreaterThan(0);
    expect(at).toBeLessThan(app.indexOf("<Route element={<AppLayout />}>"));
    const line = app.slice(at, app.indexOf("\n", at));
    expect(line).not.toMatch(/RoleGuard|AppLayout|Navigate/);
  });

  it("карта сайта знает оба адреса, robots их не закрывает", () => {
    const sitemap = readFileSync("public/sitemap.xml", "utf8");
    expect(sitemap).toContain("https://www.warehouse-pro.uz/pitch</loc>");
    expect(sitemap).toContain("https://www.warehouse-pro.uz/demo</loc>");
    const robots = readFileSync("public/robots.txt", "utf8");
    expect(robots).not.toMatch(/Disallow:\s*\/(pitch|demo)\b/);
  });
});

describe("/pitch: разделы конкурса", () => {
  it("все главы на месте, по порядку", () => {
    draw(<Pitch />);
    const ids = ["muammo", "natijalar", "bozor", "jamoa", "nega-biz", "yol-xaritasi", "amalga-oshirish", "demo", "api"];
    const order = ids.map(id => document.getElementById(id));
    order.forEach((el, i) => expect(el, ids[i]).not.toBeNull());
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, ids[i]).toBeTruthy();
    }
    for (const id of ids) expect(within(document.getElementById(id)!).getByRole("heading", { level: 2 })).toBeTruthy();
  });

  it("1 · Muammo → Yechim: все задачи, которые решает продукт, а не пять", () => {
    /*
      09.10.2026 владелец: «проблемы как будто мало — наш продукт многое решает».
      Было пять пар; теперь каждая, за которой стоит работающая функция.
    */
    draw(<Pitch />);
    const rows = within(screen.getByTestId("pitch-problems")).getAllByRole("listitem");
    expect(rows).toHaveLength(PROBLEMS.length);
    expect(rows.length).toBeGreaterThanOrEqual(13);
    expect(document.getElementById("muammo")!.textContent).toContain("Muammo → Yechim");
    // Число в подводке — то же, что строк в таблице.
    expect(document.getElementById("muammo")!.textContent).toContain(`${PROBLEMS.length} ta muammo`);
    for (const p of PROBLEMS) {
      for (const l of [p.topic, p.problem, p.solution]) {
        expect(l.uz.trim(), l.ru).not.toBe("");
        expect(l.ru.trim(), l.uz).not.toBe("");
      }
    }
    expect(new Set(PROBLEMS.map(p => p.topic.uz)).size, "темы повторяются").toBe(PROBLEMS.length);
  });

  it("результаты: платящие, выручка, люди в поле, магазины, заказы — из TRACTION", () => {
    draw(<Pitch />);
    const t = screen.getByTestId("pitch-traction").textContent!.replace(/\s/g, "");
    for (const n of [TRACTION.paying, TRACTION.fieldStaff, TRACTION.shops, TRACTION.deliveredOrders30d]) expect(t).toContain(String(n));
    expect(t).toContain((TRACTION.mrrUzs / 1_000_000).toFixed(2).replace(".", ","));
    expect(document.getElementById("natijalar")!.textContent).toContain(TRACTION.asOf);
    expect(TRACTION.paying).toBeLessThanOrEqual(TRACTION.organizations);
  });

  it("рынок: источник со ссылкой, альтернативы, цена — из модуля цен", () => {
    draw(<Pitch />);
    const src = screen.getByTestId("pitch-market-source");
    expect(src.getAttribute("href")).toBe(MARKET_PROOF.source.href);
    expect(src.getAttribute("href")).toMatch(/^https:\/\//);
    expect(within(screen.getByTestId("pitch-alternatives")).getAllByRole("term")).toHaveLength(ALTERNATIVES.length);
    expect(screen.getByTestId("pitch-price").textContent).toBe(formatSum(FIELD_PRICE_UZS));
  });

  it("функции наравне, свои находки и честные пробелы — на обоих языках", () => {
    /*
      «Не отстаём от Smartup и Sales Doctor» — утверждение, за которое страница
      отвечает: список того, что закрыто, свои находки и то, чего пока нет.
      Пустой список пробелов означал бы, что мы перестали говорить прямо, —
      маркировку жюри спросит первой.
    */
    draw(<Pitch />);
    expect(within(screen.getByTestId("pitch-parity-list")).getAllByRole("listitem")).toHaveLength(PARITY.length);
    expect(within(screen.getByTestId("pitch-ideas")).getAllByRole("listitem")).toHaveLength(IDEAS.length);
    expect(PARITY.length).toBeGreaterThanOrEqual(12);
    expect(GAPS.length).toBeGreaterThan(0);
    expect(screen.getByTestId("pitch-gaps").textContent).toContain("Asl Belgisi");
    expect(screen.getByTestId("pitch-parity").textContent).toMatch(/Smartup.*Sales Doctor/);
    for (const l of [...PARITY, ...GAPS, ...IDEAS.flatMap(i => [i.t, i.d])]) {
      expect(l.uz.trim(), l.ru).not.toBe("");
      expect(l.ru.trim(), l.uz).not.toBe("");
    }
  });

  it("план найма: кто первый и зачем", () => {
    draw(<Pitch />);
    const items = within(screen.getByTestId("pitch-hiring")).getAllByRole("listitem");
    expect(items).toHaveLength(HIRING.length);
    expect(items[0].textContent).toContain(HIRING[0].role.uz);
  });

  it("имён клиентов в открытом коде страницы нет", () => {
    /*
      Репозиторий публичный. Числа о клиентах — можно (решение владельца
      09.10.2026), названия организаций — нет: «MCHJ», «МЧЖ», «ООО» в тексте
      страницы означали бы, что кто-то вписал клиента.
    */
    const src = readFileSync("src/components/pitch/pitch-content.ts", "utf8");
    expect(src).not.toMatch(/\bM[Cc][Hh][Jj]\b|МЧЖ|\bООО\b/);
  });

  it("2 · Jamoa: имя, роль, возраст, навыки и только живые ссылки", () => {
    draw(<Pitch />);
    const m = screen.getByTestId("pitch-team-member");
    expect(m.textContent).toContain("Bobur Yusupov");
    expect(m.textContent).toContain("Asoschi, full-stack muhandis");
    expect(m.textContent).toContain("27 yosh");
    for (const s of ["React", "TypeScript", "Expo / React Native", "1C OData"]) expect(m.textContent).toContain(s);
    const links = within(m).getAllByTestId("pitch-team-link").map(a => a.getAttribute("href"));
    expect(links).toEqual(TEAM[0].links.filter(l => l.href).map(l => l.href));
    expect(links).toContain("https://github.com/Nightcall7442/Warehouse-Pro");
    expect(links.every(h => h && /^https:\/\//.test(h))).toBe(true);
    // Слот Telegram пуст — ни пустой ссылки, ни слова «Telegram» в ссылках.
    expect(within(m).queryByText(/Telegram ↗/)).toBeNull();
  });

  it("3 · почему мы: проверяемые числа", () => {
    draw(<Pitch />);
    const t = screen.getByTestId("pitch-why-numbers").textContent!.replace(/\s/g, "");
    for (const n of [ENGINEERING.commits, ENGINEERING.prsWeb, ENGINEERING.prsMobile, ENGINEERING.tests]) expect(t).toContain(String(n));
  });

  it("4 · дорожная карта: четыре стадии, «мы здесь» — на запуске", () => {
    draw(<Pitch />);
    const stages = within(screen.getByTestId("pitch-roadmap")).getAllByRole("listitem");
    expect(stages.map(s => s.getAttribute("data-stage"))).toEqual(["idea", "prototype", "mvp", "launched"]);
    const here = stages.filter(s => s.getAttribute("aria-current") === "step");
    expect(here.map(s => s.getAttribute("data-stage"))).toEqual(["launched"]);
    expect(within(here[0]).getByTestId("pitch-roadmap-here").textContent).toBe("Biz shu yerdamiz");
  });

  it("5 · внедрение: этапы с состоянием, технологии, ИИ-инструменты и планы", () => {
    draw(<Pitch />);
    const stages = within(screen.getByTestId("pitch-stages")).getAllByRole("listitem");
    expect(stages.length).toBeGreaterThanOrEqual(5);
    expect(screen.getByTestId("pitch-tech").textContent).toMatch(/React.*Hono.*MySQL.*Expo.*Railway.*Vitest/s);
    const ai = screen.getByTestId("pitch-ai").textContent!;
    expect(ai).toContain("Claude Code");
    expect(ai).toContain("Higgsfield");
    expect(ai).toMatch(/AI emas/); // правила честно названы правилами
    expect(ai).toMatch(/Rejada/);
  });

  it("6 · ссылка на /demo и на демо из первого экрана", () => {
    draw(<Pitch />);
    expect(screen.getByTestId("pitch-demo-link").getAttribute("href")).toBe("/demo");
    expect(screen.getByTestId("pitch-cta-demo").getAttribute("href")).toBe("/demo");
  });

  it("ни одного заполнителя на странице", () => {
    draw(<Pitch />);
    expect(document.body.textContent).not.toMatch(/\{\{|\}\}|TODO|undefined|NaN/);
  });
});

describe("/pitch: API", () => {
  const api = readFileSync("api/public-api.ts", "utf8");
  const orders = readFileSync("api/public/orders-v1.ts", "utf8");
  const exists = (path: string) => {
    if (path === "/orders") return api.includes('app.route("/orders", ordersV1)') && orders.includes('ordersV1.get("/",');
    if (path.startsWith("/orders/") && !path.includes(":")) return api.includes('app.route("/orders", ordersV1)') && orders.includes(`ordersV1.get("${path.slice("/orders".length)}"`);
    return api.includes(`app.get("${path}",`);
  };

  it.each(API_ENDPOINTS.map(e => e.path))("%s существует в публичном API", (path) => {
    expect(exists(path)).toBe(true);
  });

  it("страница показывает ровно этот список, каждый — GET", () => {
    draw(<Pitch />);
    const shown = [...screen.getByTestId("pitch-api-endpoints").querySelectorAll("[data-endpoint]")].map(e => e.getAttribute("data-endpoint"));
    expect(shown).toEqual(API_ENDPOINTS.map(e => e.path));
  });

  it("API только на чтение — на странице так и сказано, и в коде так", () => {
    expect(api).toMatch(/c\.req\.method !== "GET" && c\.req\.method !== "HEAD"/);
    draw(<Pitch />);
    expect(document.getElementById("api")!.textContent).toContain("405");
  });

  it("ключ не настроен — честный текст и пример с заглушкой", async () => {
    draw(<Pitch />);
    await screen.findByTestId("pitch-api-key-missing");
    expect(screen.getByTestId("pitch-api-curl").textContent).toContain("Authorization: Bearer wp_test_…");
  });

  it("ключ настроен — показан, подставлен в curl, «Запустить» шлёт его заголовком", async () => {
    status.apiKey = "wp_test_" + "f".repeat(48);
    draw(<Pitch />);
    expect((await screen.findByTestId("pitch-api-key-value")).textContent).toBe(status.apiKey);
    expect(screen.getByTestId("pitch-api-curl").textContent).toContain(`Bearer ${status.apiKey}`);
    fireEvent.click(screen.getByTestId("pitch-api-run"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => u === "/api/v1/orders?limit=1"
      && (i?.headers as Record<string, string>)?.Authorization === `Bearer ${status.apiKey}`)).toBe(true));
  });
});

describe("язык", () => {
  it("без выбора — узбекский, и выбор не записывается сам", () => {
    draw(<Pitch />);
    expect(screen.getByTestId("pitch-lang-uz").getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.lang).toBe("uz");
    expect(localStorage.getItem("lang")).toBeNull();
  });

  it("явный выбор сильнее: сохранённый ru — страница по-русски", () => {
    localStorage.setItem("lang", "ru");
    draw(<Pitch />);
    expect(screen.getByTestId("pitch-lang-ru").getAttribute("aria-pressed")).toBe("true");
    expect(document.getElementById("muammo")!.textContent).toContain("Проблема → Решение");
  });

  it("переключатель сохраняет выбор", () => {
    draw(<Pitch />);
    fireEvent.click(screen.getByTestId("pitch-lang-ru"));
    expect(localStorage.getItem("lang")).toBe("ru");
    expect(screen.getByTestId("pitch-lang-ru").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("/demo", () => {
  it("6.1–6.3 на месте", async () => {
    draw(<PitchDemo />);
    for (const id of ["pitch-demo-video", "pitch-demo-description", "pitch-demo-prototype"]) expect(screen.getByTestId(id)).toBeTruthy();
  });

  it("6.1 плеер: ролик, обложка, управление, без автозапуска, тянет только заголовок файла", () => {
    draw(<PitchDemo />);
    const v = screen.getByTestId("pitch-demo-player") as HTMLVideoElement;
    expect(v.tagName).toBe("VIDEO");
    expect(v.getAttribute("src")).toBe(VIDEO_SRC);
    expect(v.getAttribute("poster")).toBe(VIDEO_POSTER);
    expect(v.hasAttribute("controls")).toBe(true);
    expect(v.hasAttribute("playsinline")).toBe(true);
    expect(v.getAttribute("preload")).toBe("metadata");
    expect(v.hasAttribute("autoplay")).toBe(false);
  });

  it("6.2 описание: сцены по времени, по порядку, до конца ролика; время совпадает с секундами перехода", () => {
    draw(<PitchDemo />);
    const seeks = screen.getAllByTestId("pitch-demo-scene-seek");
    expect(seeks.map(b => b.textContent)).toEqual(VIDEO_DESCRIPTION.scenes.map(s => s.at));
    expect(seeks[0].textContent).toBe("0:00");
    const secs = VIDEO_DESCRIPTION.scenes.map(s => {
      const [m, sec] = s.at.split(":").map(Number);
      expect(s.start, s.at).toBe(m * 60 + sec);
      return s.start;
    });
    for (let i = 1; i < secs.length; i++) expect(secs[i]).toBeGreaterThan(secs[i - 1]);
    expect(secs[secs.length - 1]).toBeLessThan(VIDEO_SECONDS);
    for (const s of VIDEO_DESCRIPTION.scenes) expect(s.text.uz.length, s.at).toBeGreaterThan(20);
  });

  it("время сцены переносит в плеер и запускает его", () => {
    draw(<PitchDemo />);
    const v = screen.getByTestId("pitch-demo-player") as HTMLVideoElement;
    const play = vi.fn(() => Promise.resolve());
    Object.defineProperty(v, "play", { configurable: true, value: play });
    // jsdom не умеет ни прокрутку к элементу, ни перемотку медиа — даём им простые заглушки.
    let at = 0;
    Object.defineProperty(v, "currentTime", { configurable: true, get: () => at, set: (x: number) => { at = x; } });
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const director = VIDEO_DESCRIPTION.scenes.find(s => s.at === "1:42")!;
    fireEvent.click(screen.getAllByTestId("pitch-demo-scene-seek").find(b => b.textContent === "1:42")!);
    expect(v.currentTime).toBe(director.start);
    expect(play).toHaveBeenCalled();
    expect(scroll).toHaveBeenCalled();
  });

  it("ролик не открылся — обложка и прямая ссылка, а не сломанный плеер", () => {
    draw(<PitchDemo />);
    fireEvent.error(screen.getByTestId("pitch-demo-player"));
    expect(screen.queryByTestId("pitch-demo-player")).toBeNull();
    const box = screen.getByTestId("pitch-demo-video-broken");
    expect(within(box).getByRole("link").getAttribute("href")).toBe(VIDEO_SRC);
  });

  it("кнопки входа — по ролям сервера; вход шлёт роль и уводит в приложение на языке страницы", async () => {
    status.roles = ["ceo", "agent"];
    draw(<PitchDemo />);
    const ceo = await screen.findByTestId("pitch-demo-login-ceo");
    await waitFor(() => expect(ceo.hasAttribute("disabled")).toBe(false));
    expect(ceo.textContent).toContain("Direktor sifatida kirish");
    expect(screen.getByTestId("pitch-demo-login-agent").textContent).toContain("Agent sifatida kirish");
    expect(screen.queryByTestId("pitch-demo-login-supervisor")).toBeNull();
    fireEvent.click(screen.getByTestId("pitch-demo-login-agent"));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
    const call = fetchMock.mock.calls.find(([u]) => u === "/api/demo/login")!;
    expect(call[1]?.method).toBe("POST");
    expect(JSON.parse(String(call[1]?.body))).toEqual({ role: "agent" });
    expect(localStorage.getItem("lang")).toBe("uz");
  });

  it("слишком много входов — понятный текст, без перехода", async () => {
    loginStatus = 429;
    draw(<PitchDemo />);
    const ceo = await screen.findByTestId("pitch-demo-login-ceo");
    await waitFor(() => expect(ceo.hasAttribute("disabled")).toBe(false));
    fireEvent.click(ceo);
    expect((await screen.findByRole("alert")).textContent).toMatch(/10 daqiqadan/);
    expect(assign).not.toHaveBeenCalled();
  });

  it("демо выключено — честный блок с регистрацией вместо мёртвых кнопок", async () => {
    status = { enabled: false, roles: [], apiKey: null };
    draw(<PitchDemo />);
    const box = await screen.findByTestId("pitch-demo-unavailable");
    expect(within(box).getByRole("link").getAttribute("href")).toBe("/register");
    expect(screen.queryByTestId("pitch-demo-login-ceo")).toBeNull();
  });
});
