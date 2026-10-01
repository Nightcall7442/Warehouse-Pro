// @vitest-environment jsdom
/**
 * Адреса консоли платформы — на настоящих маршрутах App.tsx.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * У суперадмина было два адреса: /super-admin (всё стопкой) и /monitoring.
 * Карточка организации открывалась состоянием страницы — ни ссылки, ни
 * «назад», ни обновления страницы без потери места.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · /super-admin по-прежнему открывается — это «Обзор»;
 *   · у каждого раздела свой адрес, у карточки — /orgs/:id и /orgs/:id/:tab;
 *   · старый /monitoring ведёт в «Систему» (/super-admin/system);
 *   · неизвестный /super-admin/… — на «Обзор», а не в «страница не найдена»;
 *   · директору консоль закрыта (нет доступа), как и прежняя страница;
 *   · у суперадмина нет палитры склада по Ctrl+K — её место занял поиск
 *     организации в оболочке консоли.
 *
 * Нарочная поломка (проверено): убрать <Route path="/monitoring" …Navigate> —
 * падает «старый адрес»; убрать маршрут /super-admin/orgs/:id/:tab —
 * «вкладка карточки»; вернуть <CommandPalette /> суперадмину — «палитра».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";

const state = vi.hoisted(() => ({ role: "superadmin" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: state.role, name: "X" }, isLoading: false }), hadSession: () => true }));
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/ScrollToTop", () => ({ ScrollToTop: () => null }));
vi.mock("@/components/CommandPalette", () => ({ CommandPalette: () => <div data-testid="command-palette" /> }));
vi.mock("@/components/orders/QuickOrderHost", () => ({ QuickOrderHost: () => null }));
vi.mock("@/hooks/useHotkeys", () => ({ useHotkeys: () => {} }));
vi.mock("@/hooks/useBranding", () => ({ useBranding: () => {} }));
vi.mock("@/hooks/useKeyboardInset", () => ({ useKeyboardInset: () => {} }));
vi.mock("@/hooks/useOfflineSync", () => ({ useOfflineSync: () => {} }));
vi.mock("@/components/NoAccess", () => ({ NoAccess: () => <div data-testid="page">нет доступа</div> }));
const stub = (name: string) => ({ default: () => <div data-testid="page">{name}</div> });
// Страницы, которые App грузит сразу (не лениво), — заглушками: здесь важны маршруты, а не они.
vi.mock("@/pages/Login", () => stub("Login"));
vi.mock("@/pages/Register", () => stub("Register"));
vi.mock("@/pages/ForgotPassword", () => stub("ForgotPassword"));
vi.mock("@/pages/ResetPassword", () => stub("ResetPassword"));
vi.mock("@/pages/VerifyEmail", () => stub("VerifyEmail"));
vi.mock("@/pages/NotFound", () => stub("NotFound"));
vi.mock("@/pages/Home", () => stub("Home"));
vi.mock("@/pages/SubscriptionBlocked", () => stub("SubscriptionBlocked"));
vi.mock("@/pages/AcceptInvite", () => stub("AcceptInvite"));
vi.mock("@/pages/Onboarding", () => stub("Onboarding"));
vi.mock("@/pages/superadmin/Overview", () => stub("Обзор"));
vi.mock("@/pages/superadmin/Orgs", () => stub("Организации"));
vi.mock("@/pages/superadmin/OrgCard", async () => {
  const { useParams } = await import("react-router");
  function OrgCardStub() {
    const p = useParams();
    return <div data-testid="page">Карточка {p.id} {p.tab ?? "overview"}</div>;
  }
  return { default: OrgCardStub };
});
vi.mock("@/pages/superadmin/Leads", () => stub("Заявки"));
vi.mock("@/pages/superadmin/Support", () => stub("Обращения"));
vi.mock("@/pages/superadmin/System", () => stub("Система"));
vi.mock("@/pages/superadmin/Sandboxes", () => stub("Интеграторы"));
vi.mock("@/pages/superadmin/More", () => stub("Ещё"));

const App = (await import("@/App")).default;

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname}</output>;
}
const open = async (path: string) => {
  render(<MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter>);
  return (await screen.findByTestId("page")).textContent;
};

beforeEach(() => { state.role = "superadmin"; });
afterEach(cleanup);

describe("адреса консоли", () => {
  it("/super-admin — по-прежнему открывается, это «Обзор»", async () => {
    expect(await open("/super-admin")).toBe("Обзор");
  });

  it("у каждого раздела свой адрес", async () => {
    const map: Array<[string, string]> = [
      ["/super-admin/orgs", "Организации"], ["/super-admin/leads", "Заявки"], ["/super-admin/support", "Обращения"],
      ["/super-admin/system", "Система"], ["/super-admin/sandboxes", "Интеграторы"], ["/super-admin/more", "Ещё"],
    ];
    for (const [path, page] of map) {
      expect(await open(path), path).toBe(page);
      cleanup();
    }
  });

  it("вкладка карточки — в адресе", async () => {
    expect(await open("/super-admin/orgs/12")).toBe("Карточка 12 overview");
    cleanup();
    expect(await open("/super-admin/orgs/12/danger")).toBe("Карточка 12 danger");
  });

  it("старый адрес /monitoring ведёт в «Систему»", async () => {
    expect(await open("/monitoring")).toBe("Система");
    expect(screen.getByTestId("where").textContent).toBe("/super-admin/system");
  });

  it("неизвестный раздел консоли — на «Обзор»", async () => {
    expect(await open("/super-admin/whatever")).toBe("Обзор");
    expect(screen.getByTestId("where").textContent).toBe("/super-admin");
  });

  it("директору консоль закрыта", async () => {
    state.role = "ceo";
    expect(await open("/super-admin/orgs")).toBe("нет доступа");
    cleanup();
    expect(await open("/monitoring")).toBe("нет доступа");
  });
});

describe("палитра склада", () => {
  it("суперадмину не ставится, директору — на месте", async () => {
    await open("/super-admin");
    expect(screen.queryByTestId("command-palette")).toBeNull();
    cleanup();
    state.role = "ceo";
    await open("/super-admin");
    expect(screen.getByTestId("command-palette")).toBeTruthy();
  });
});
