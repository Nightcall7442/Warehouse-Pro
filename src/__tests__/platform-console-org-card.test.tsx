// @vitest-environment jsdom
/**
 * Карточка организации в консоли: вкладки по адресу и все прежние действия.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * TenantDetail подменял страницу суперадмина через состояние: ни своей
 * ссылки, ни «назад»; подписка, приостановка, уборка журнала — одним рядом
 * кнопок, «Удалить организацию» — ниже, люди и права — стопкой. Подсказка,
 * где включить код второго фактора, проверялась чтением исходника.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · вкладка — из адреса (/super-admin/orgs/:id/:tab), ссылки вкладок ведут
 *     на свои адреса, неизвестная вкладка — на «Обзор»;
 *   · шапка: телефон tel: и почта mailto:, срок и тариф;
 *   · «Подписка»: тариф со сроком, продление пробного, «сверх тарифа» с
 *     суммой в месяц, руководство — каждое в свою ручку с верными доводами;
 *     «Продлить пробный» — только у пробной (этап 2: у платящей он продлевал
 *     пробные дни, которых у неё нет, и читался как «продлить подписку»);
 *   · «Пользователи»: смена логина и сброс пароля — в свои ручки, без
 *     годной почты и короче 8 знаков не отправляются;
 *   · «Журнал»: уборка — только с кодом и после подтверждения;
 *   · «Опасная зона»: приостановить — с подтверждением; удалить —
 *     только у приостановленной, после слова и кода; без второго фактора —
 *     подсказка со ссылкой туда, где он включается (настоящая отрисовка, а
 *     не чтение исходника, как раньше).
 *
 * Нарочная поломка (проверено): убрать `disabled={active}` у «Удалить» —
 * падает «только у приостановленной»; в SubscriptionTab слать expiryDays из
 * поля «Продлить» — «тариф со сроком»; читать вкладку из состояния, а не из
 * адреса — «вкладка из адреса»; убрать TotpHint из окна — «подсказка».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";

const h = vi.hoisted(() => {
  const state = {
    data: {} as Record<string, unknown>,
    calls: [] as Array<{ path: string; input: unknown }>,
    user: { id: 1, name: "Владелец", email: "root@system.local", role: "superadmin", totpEnabledAt: null as string | null },
  };
  const make = (path: string[]): unknown => new Proxy(() => {}, {
    get: (_t, k: string | symbol) => {
      if (typeof k === "symbol") return undefined;
      if (k === "useQuery") return () => ({ data: state.data[path.join(".")], isLoading: false, isError: false, refetch: () => {} });
      if (k === "useMutation") return () => ({ mutate: (input: unknown) => state.calls.push({ path: path.join("."), input }), isPending: false });
      if (k === "useUtils") return () => make(["utils"]);
      return make([...path, k]);
    },
  });
  return { state, trpc: make([]) };
});
vi.mock("@/providers/trpc", () => ({ trpc: h.trpc }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.state.user, isLoading: false, logout: () => {} }), hadSession: () => true }));
vi.mock("@/components/settings/OperatorAccess", () => ({ OperatorAccess: ({ tenantId }: { tenantId: number }) => <div data-testid="operator-access">права {tenantId}</div> }));

const OrgCard = (await import("@/pages/superadmin/OrgCard")).default;

const DAY = 86_400_000;
const now = Date.now();
const detail = (status: "active" | "suspended" = "active") => ({
  tenant: {
    id: 5, slug: "buxs", name: "Бухара Сок", plan: "exclusive", status, trialEndsAt: null, planExpiresAt: null,
    ownerEmail: "boss@buxs.uz", ownerPhone: "+998935554433", maxUsers: null, maxProducts: null, maxOrdersMonth: null,
    extraUsers: 2, extraProducts: 0, manualEnabledAt: null, createdAt: new Date(now - 200 * DAY), updatedAt: new Date(now - DAY),
  },
  subscription: [{ id: "s", plan: "exclusive", status: "active", trialEndsAt: null as Date | null, currentPeriodEnds: new Date(now + 9 * DAY + 3_600_000) as Date | null }],
  users: [
    { id: 50, name: "Шахноза Юсупова", email: "boss@buxs.uz", role: "ceo", status: "active", lastSignInAt: new Date(now - DAY), createdAt: new Date() },
    { id: 51, name: "Агент 1", email: "a1@buxs.uz", role: "agent", status: "active", lastSignInAt: null, createdAt: new Date() },
  ],
  stats: { orders: 31, revenue: 90_370_000, products: 1, shops: 1 },
  monthlyOrders: [{ month: "2026-09", orders: 31, revenue: 90_370_000 }],
});

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname}</output>;
}
const show = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/super-admin/orgs/:id" element={<><OrgCard /><Where /></>} />
      <Route path="/super-admin/orgs/:id/:tab" element={<><OrgCard /><Where /></>} />
      <Route path="/super-admin/orgs" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);
const call = (path: string) => h.state.calls.filter(c => c.path === path).map(c => c.input);
const confirmLast = (label: string) => { const b = screen.getAllByRole("button", { name: label }); fireEvent.click(b[b.length - 1]); };

beforeEach(() => {
  h.state.calls = [];
  h.state.user.totpEnabledAt = null;
  h.state.data = { "tenant.getDetail": detail(), "tenant.list": undefined, "tenant.featureUsage": [], "tenant.offboardPreview": { total: 120, rows: { orders: 31, users: 2 } } };
});
afterEach(cleanup);

describe("вкладки по адресу", () => {
  it("вкладка — из адреса; ссылки вкладок ведут на свои адреса", () => {
    show("/super-admin/orgs/5/subscription");
    expect(screen.getByTestId("tab-subscription").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("sub-plan")).toBeTruthy();
    const hrefs = Object.fromEntries(["overview", "subscription", "users", "access", "journal", "danger"]
      .map(k => [k, screen.getByTestId(`tab-${k}`).getAttribute("href")]));
    expect(hrefs).toEqual({
      overview: "/super-admin/orgs/5", subscription: "/super-admin/orgs/5/subscription", users: "/super-admin/orgs/5/users",
      access: "/super-admin/orgs/5/access", journal: "/super-admin/orgs/5/journal", danger: "/super-admin/orgs/5/danger",
    });
    fireEvent.click(screen.getByTestId("tab-access"));
    expect(screen.getByTestId("where").textContent).toBe("/super-admin/orgs/5/access");
    expect(screen.getByTestId("operator-access").textContent).toBe("права 5");
  });

  it("неизвестная вкладка — на «Обзор» той же карточки", () => {
    show("/super-admin/orgs/5/nonsense");
    expect(screen.getByTestId("where").textContent).toBe("/super-admin/orgs/5");
    expect(screen.getByTestId("org-activity")).toBeTruthy();
  });

  it("шапка: телефон и почта ссылками, срок и тариф", () => {
    show("/super-admin/orgs/5");
    expect(screen.getByTestId("org-phone").getAttribute("href")).toBe("tel:+998935554433");
    expect(screen.getByTestId("org-email").getAttribute("href")).toBe("mailto:boss@buxs.uz");
    const head = screen.getByTestId("org-header").textContent!;
    expect(head).toContain("Эксклюзив");
    expect(head).toContain("10 дн.");
  });
});

describe("подписка", () => {
  it("тариф со сроком, сверх тарифа с суммой, руководство; «Продлить пробный» — только пробной", () => {
    show("/super-admin/orgs/5/subscription");
    const plan = within(screen.getByTestId("sub-plan"));
    fireEvent.change(plan.getByLabelText("Дней"), { target: { value: "90" } });
    fireEvent.click(screen.getByTestId("sub-plan-save"));
    expect(call("tenant.updatePlan")).toEqual([{ tenantId: 5, plan: "exclusive", expiryDays: 90 }]);

    // Платящая (Эксклюзив, active): пробных дней у неё нет — и блока нет.
    expect(screen.queryByTestId("sub-trial")).toBeNull();

    // Поле открывается с уже докупленным, а не с нулём.
    const extra = within(screen.getByTestId("sub-extra"));
    expect((extra.getByLabelText("Мест") as HTMLInputElement).value).toBe("2");
    fireEvent.change(extra.getByLabelText("Товаров"), { target: { value: "10" } });
    expect(screen.getByTestId("sub-extra-sum").textContent).toBe("= 120 000 сум/мес");
    fireEvent.click(screen.getByTestId("sub-extra-save"));
    expect(call("tenant.setExtraLimits")).toEqual([{ tenantId: 5, extraUsers: 2, extraProducts: 10 }]);

    fireEvent.click(screen.getByTestId("sub-manual-toggle"));
    expect(call("tenant.setManualAccess")).toEqual([{ tenantId: 5, enabled: true }]);

    // Пробная — продлевается пробный, в свою ручку.
    cleanup();
    const trial = detail();
    trial.tenant.plan = "trial";
    trial.subscription = [{ id: "s", plan: "trial", status: "trialing", trialEndsAt: new Date(now + 3 * DAY), currentPeriodEnds: null }];
    h.state.data["tenant.getDetail"] = trial;
    show("/super-admin/orgs/5/subscription");
    fireEvent.change(within(screen.getByTestId("sub-trial")).getByLabelText("На сколько дней"), { target: { value: "7" } });
    fireEvent.click(screen.getByTestId("sub-trial-save"));
    expect(call("tenant.extendTrial")).toEqual([{ tenantId: 5, days: 7 }]);
  });
});

describe("пользователи", () => {
  it("смена логина и сброс пароля — в свои ручки, с проверкой ввода", () => {
    show("/super-admin/orgs/5/users");
    const rows = screen.getAllByTestId("org-user");
    expect(rows).toHaveLength(2);
    fireEvent.click(within(rows[1]).getByTestId("user-change-login"));
    const login = screen.getByLabelText("Новая почта для входа");
    fireEvent.change(login, { target: { value: "не почта" } });
    expect((screen.getByRole("button", { name: "Сменить" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(login, { target: { value: " agent@buxs.uz " } });
    fireEvent.click(screen.getByRole("button", { name: "Сменить" }));
    expect(call("tenant.changeUserLogin")).toEqual([{ tenantId: 5, userId: 51, email: "agent@buxs.uz" }]);

    fireEvent.click(within(rows[0]).getByTestId("user-reset-password"));
    const pwd = screen.getByLabelText("Новый пароль");
    fireEvent.change(pwd, { target: { value: "short" } });
    expect((screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(pwd, { target: { value: "longenough1" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(call("tenant.resetOwnerPassword")).toEqual([{ tenantId: 5, userId: 50, newPassword: "longenough1" }]);
  });
});

describe("журнал", () => {
  it("уборка — только с кодом и после подтверждения", async () => {
    show("/super-admin/orgs/5/journal");
    const submit = screen.getByTestId("purge-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("purge-totp"), { target: { value: "123456" } });
    fireEvent.click(submit);
    expect(call("audit.purge"), "ушло без подтверждения").toEqual([]);
    confirmLast("Убрать");
    await new Promise(r => setTimeout(r, 0));
    expect(call("audit.purge")).toEqual([{ tenantId: 5, retentionDays: 90, totpCode: "123456" }]);
  });
});

describe("опасная зона", () => {
  it("приостановить — с подтверждением; удалить у работающей нельзя", async () => {
    show("/super-admin/orgs/5/danger");
    expect((screen.getByTestId("danger-offboard-open") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("danger-toggle-status"));
    expect(call("tenant.setStatus")).toEqual([]);
    confirmLast("Приостановить");
    await new Promise(r => setTimeout(r, 0));
    expect(call("tenant.setStatus")).toEqual([{ tenantId: 5, status: "suspended" }]);
  });

  it("у приостановленной — удаление после слова и кода; без второго фактора — подсказка", () => {
    h.state.data["tenant.getDetail"] = detail("suspended");
    show("/super-admin/orgs/5/danger");
    fireEvent.click(screen.getByTestId("danger-offboard-open"));
    expect(screen.getByTestId("offboard-preview").textContent).toContain("Будет стёрто 120 строк");
    const hint = screen.getByTestId("offboard-totp-hint");
    expect(hint.querySelector("a")?.getAttribute("href")).toBe("/settings?section=profile&block=totp");
    const submit = screen.getByTestId("offboard-submit") as HTMLButtonElement;
    fireEvent.change(screen.getByTestId("offboard-slug"), { target: { value: "bux" } });
    fireEvent.change(screen.getByTestId("offboard-totp"), { target: { value: "654321" } });
    expect(submit.disabled, "не то слово — кнопка закрыта").toBe(true);
    fireEvent.change(screen.getByTestId("offboard-slug"), { target: { value: "buxs" } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(call("tenant.offboard")).toEqual([{ tenantId: 5, confirmSlug: "buxs", totpCode: "654321" }]);
  });

  it("второй фактор включён — подсказки нет", () => {
    h.state.user.totpEnabledAt = "2026-10-01T00:00:00Z";
    h.state.data["tenant.getDetail"] = detail("suspended");
    show("/super-admin/orgs/5/danger");
    fireEvent.click(screen.getByTestId("danger-offboard-open"));
    expect(screen.queryByTestId("offboard-totp-hint")).toBeNull();
  });
});
