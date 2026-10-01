// @vitest-environment jsdom
/**
 * Суперадмин находит, где включить вход с кодом из приложения.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Удаление организации и чистка обращений требуют код второго фактора
 * (api/auth/step-up.ts). Включается он в Настройки → Профиль, но в меню
 * суперадмина «Настроек» нет, а его «Мой профиль» (AdminActions) о втором
 * факторе молчал. 01.10.2026 владелец упёрся в «сначала подключите
 * двухфактор» и не нашёл, где.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   - второй фактор не включён — «Мой профиль» так и говорит и кнопка
 *     «Включить» ведёт в /settings?section=profile;
 *   - включён — «включён», а управлять — кнопкой «Настройки профиля»,
 *     туда же (с 01.10.2026 карточка «Мой профиль» — без своей формы);
 *   - в окне удаления организации без второго фактора есть подсказка со
 *     ссылкой туда же.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const state = vi.hoisted(() => ({ totpEnabledAt: null as string | null, navigated: [] as string[] }));

vi.mock("@/providers/trpc", () => {
  const nothing = () => {};
  return {
    trpc: {
      useUtils: () => ({ user: { me: { invalidate: nothing } } }),
      user: {
        me: { useQuery: () => ({ data: { name: "Super Admin", role: "superadmin", email: "superadmin@system.local", phone: "" } }) },
        updateMe: { useMutation: () => ({ mutate: nothing, isPending: false }) },
        changePassword: { useMutation: () => ({ mutate: nothing, isPending: false }) },
      },
    },
  };
});
vi.mock("react-router", () => ({ useNavigate: () => (to: string) => state.navigated.push(to) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: "superadmin", totpEnabledAt: state.totpEnabledAt } }) }));

const { AdminActions } = await import("@/components/superadmin/AdminActions");

beforeEach(() => { state.totpEnabledAt = null; state.navigated = []; });
afterEach(cleanup);

describe("«Мой профиль» суперадмина: второй фактор", () => {
  it("не включён — сказано и кнопка «Включить» ведёт в профиль настроек", () => {
    render(<AdminActions />);
    const row = screen.getByTestId("admin-totp");
    expect(row.textContent).toContain("не включён");
    fireEvent.click(within(row).getByText("Включить"));
    expect(state.navigated).toEqual(["/settings?section=profile"]);
  });

  it("включён — «включён», лишней кнопки нет; управлять — через «Настройки профиля»", () => {
    state.totpEnabledAt = "2026-10-01T00:00:00Z";
    render(<AdminActions />);
    const row = screen.getByTestId("admin-totp");
    expect(row.textContent).toContain("включён");
    expect(row.textContent).not.toContain("не включён");
    expect(within(row).queryByRole("button")).toBeNull();
    fireEvent.click(screen.getByText("Настройки профиля"));
    expect(state.navigated).toEqual(["/settings?section=profile"]);
  });
});

describe("окно удаления организации", () => {
  it("без второго фактора подсказывает, где его включить", () => {
    // Окно удаления тянет полкарточки организации; здесь достаточно того,
    // что подсказка стоит под полем кода и зависит от totpEnabledAt.
    const src = readFileSync(resolve(__dirname, "../components/superadmin/TenantDetail.tsx"), "utf8");
    const at = src.indexOf('data-testid="offboard-totp"');
    const hint = src.indexOf('data-testid="offboard-totp-hint"');
    expect(at).toBeGreaterThan(0);
    expect(hint, "подсказки под полем кода нет").toBeGreaterThan(at);
    expect(src.slice(at, hint)).toContain("{!totpOn && (");
    expect(src.slice(hint, hint + 400)).toContain('href="/settings?section=profile"');
  });
});
