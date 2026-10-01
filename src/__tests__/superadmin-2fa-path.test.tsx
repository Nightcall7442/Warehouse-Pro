// @vitest-environment jsdom
/**
 * Суперадмин находит, где включить вход с кодом из приложения.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Удаление организации, выгрузка базы и уборка журнала требуют код второго
 * фактора (api/auth/step-up.ts). Включается он в Настройки → Профиль, но
 * 01.10.2026 владелец упёрся в «сначала подключите двухфактор» и не нашёл,
 * где. Тогда появилась карточка «Мой профиль» на общей странице; с консолью
 * платформы (01.10.2026) её место — карточка «кто вошёл» в колонке и строка
 * в «Ещё» на телефоне.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   - второй фактор не включён — «Ещё» так и говорит («Выключен», и чем это
 *     грозит), строка ведёт прямо к блоку второго фактора в профиле
 *     (/settings?section=profile&block=totp);
 *   - включён — «Включён», туда же;
 *   - подсказка в окне удаления организации проверяется отрисовкой в
 *     platform-console-org-card.test.tsx (раньше — чтением исходника).
 *
 * Нарочная поломка: в More.tsx вести строку на /settings без block=totp —
 * падает «ведёт к блоку»; показывать «Включён» по любому значению — падает
 * «не включён».
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const state = vi.hoisted(() => ({ totpEnabledAt: null as string | null }));
vi.mock("@/providers/trpc", () => {
  const make = (path: string[]): unknown => new Proxy(() => {}, {
    get: (_t, k: string | symbol) => {
      if (typeof k === "symbol") return undefined;
      if (k === "useQuery") return () => ({ data: undefined, isLoading: false });
      return make([...path, k]);
    },
  });
  return { trpc: make([]) };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, name: "Владелец", email: "root@system.local", role: "superadmin", totpEnabledAt: state.totpEnabledAt }, logout: () => {} }) }));
vi.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "dark", toggle: () => {} }) }));
vi.mock("@/hooks/useNotifications", () => ({ useNotifications: () => ({ unreadCount: 0 }) }));
vi.mock("@/components/brand/AppBrand", () => ({ AppBrand: () => null }));

const More = (await import("@/pages/superadmin/More")).default;

beforeEach(() => { state.totpEnabledAt = null; });
afterEach(cleanup);
const show = () => render(<MemoryRouter><More /></MemoryRouter>);

describe("«Ещё»: второй фактор", () => {
  it("не включён — сказано, чем грозит, и строка ведёт к блоку второго фактора", () => {
    show();
    const row = screen.getByTestId("more-totp");
    expect(row.textContent).toContain("Выключен");
    expect(row.textContent).toContain("удаление организаций");
    expect(row.getAttribute("href")).toBe("/settings?section=profile&block=totp");
  });

  it("включён — «Включён», туда же", () => {
    state.totpEnabledAt = "2026-10-01T00:00:00Z";
    show();
    const row = screen.getByTestId("more-totp");
    expect(row.textContent).toContain("Включён");
    expect(row.textContent).not.toContain("Выключен");
    expect(row.getAttribute("href")).toBe("/settings?section=profile&block=totp");
  });

  it("остальные разделы и выход — тоже здесь", () => {
    show();
    expect(screen.getByTestId("more-leads").getAttribute("href")).toBe("/super-admin/leads");
    expect(screen.getByTestId("more-system").getAttribute("href")).toBe("/super-admin/system");
    expect(screen.getByTestId("more-sandboxes").getAttribute("href")).toBe("/super-admin/sandboxes");
    expect(screen.getByTestId("more-profile").getAttribute("href")).toBe("/settings?section=profile");
    expect(screen.getByTestId("more-logout")).toBeTruthy();
    expect(screen.getByTestId("more-theme").textContent).toContain("Светлая тема");
  });
});
