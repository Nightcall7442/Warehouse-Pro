// @vitest-environment jsdom
/**
 * Экран блокировки: продлить можно прямо на нём.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Подписка кончилась → сервер отказывает рабочим ручкам → клиент уводит на
 * /subscription-blocked. Единственная кнопка там вела на /settings/billing,
 * внутрь общего Layout, а Layout сразу спрашивает notification.unreadCount,
 * support.unread и tenant.manualAccess. Они закрыты подпиской, отказ снова
 * уводил на экран блокировки — круг. Ни тарифов, ни кнопки заявки: клиент,
 * который хотел заплатить, не мог.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · директор видит тарифы на самом экране и подаёт заявку, не уходя с него;
 *     ответ виден тут же;
 *   · у истёкшего платного тарифа — «Продлить» на тот же тариф;
 *   · не директор тарифов не видит (заявка — только ему) и знает, к кому идти;
 *   · всё, что экран спрашивает у сервера, открыто при истёкшей подписке —
 *     по тому же списку, по которому сервер решает (api/middleware.ts).
 *     Спроси экран хоть одну закрытую ручку — отказ вернёт сюда же, и круг
 *     начнётся заново.
 *
 * Нарочная поломка: вернуть кнопку `navigate("/settings/billing")` вместо
 * тарифов — падают первые два (и сам рендер: вне роутера useNavigate
 * бросает); добавить на экран trpc.notification.unreadCount — падает страж.
 * Настоящий путь (вход истёкшей организации → заявка → строка в leads)
 * проверяет e2e/subscription-renewal.spec.ts.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const state = vi.hoisted(() => ({
  role: "ceo",
  plan: "trial",
  statusEnabled: [] as Array<boolean | undefined>,
  asked: [] as Array<{ plan: string }>,
  notified: false,
}));

vi.mock("@/providers/trpc", () => {
  const plans = (["basic", "pro", "exclusive"] as const).map(key => ({
    key, name: key[0].toUpperCase() + key.slice(1), nameUz: key, price: 0,
    maxUsers: 5, maxProducts: 50, maxOrdersMonth: null,
  }));
  return {
    trpc: {
      billing: {
        status: {
          useQuery: (_i: unknown, o?: { enabled?: boolean }) => {
            state.statusEnabled.push(o?.enabled);
            return { data: o?.enabled === false ? undefined : { plan: state.plan, plans, usage: { users: 1, products: 1, orders: 1 } } };
          },
        },
        requestUpgrade: {
          useMutation: (o: { onSuccess: (d: { notified: boolean }) => void }) => ({
            isPending: false,
            mutate: (v: { plan: string }) => { state.asked.push(v); o.onSuccess({ notified: state.notified }); },
          }),
        },
      },
    },
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: state.role }, logout: () => {} }) }));
vi.mock("@/i18n", () => ({
  useLang: () => ({ lang: "ru", t: (k: string) => k }),
  useTranslate: () => (ru: string) => ru,
}));
vi.mock("@/lib/toast", () => ({ notify: { success: () => {}, error: () => {} } }));

const { default: SubscriptionBlocked } = await import("@/pages/SubscriptionBlocked");

beforeEach(() => {
  state.role = "ceo"; state.plan = "trial"; state.statusEnabled = []; state.asked = []; state.notified = false;
});
afterEach(cleanup);

describe("экран блокировки: заявка на месте", () => {
  it("директор выбирает тариф и видит ответ, не уходя с экрана", () => {
    render(<SubscriptionBlocked />);
    for (const k of ["basic", "pro", "exclusive"]) expect(screen.getByTestId(`plan-request-${k}`)).toBeTruthy();

    fireEvent.click(screen.getByTestId("plan-request-basic"));
    expect(state.asked).toEqual([{ plan: "basic" }]);
    // Уведомление не ушло — ответ говорит «записана», а не обещает звонок.
    expect(screen.getByTestId("plan-request-sent").textContent).toContain("Заявка записана");
  });

  it("истёк платный — «Продлить» на тот же тариф", () => {
    state.plan = "pro";
    state.notified = true;
    render(<SubscriptionBlocked />);
    const renew = screen.getByTestId("plan-request-pro");
    expect(renew.textContent).toContain("Продлить");
    expect(screen.getByTestId("plan-request-basic").textContent).toContain("Подключить");

    fireEvent.click(renew);
    expect(state.asked).toEqual([{ plan: "pro" }]);
    expect(screen.getByTestId("plan-request-sent").textContent).toContain("Заявка отправлена");
  });

  it("не директор тарифов не видит и знает, к кому идти", () => {
    state.role = "agent";
    render(<SubscriptionBlocked />);
    expect(screen.queryByTestId("plan-request-basic")).toBeNull();
    expect(state.statusEnabled.every(e => e === false)).toBe(true);
    expect(screen.getByText(/может руководитель организации/)).toBeTruthy();
  });
});

describe("экран блокировки не зовёт закрытых ручек", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("каждая ручка экрана — из списка открытых при истёкшей подписке", () => {
    const mw = read("api/middleware.ts");
    const block = mw.slice(mw.indexOf("SUBSCRIPTION_EXEMPT_PREFIXES = ["), mw.indexOf("];", mw.indexOf("SUBSCRIPTION_EXEMPT_PREFIXES = [")));
    const exempt = [...block.matchAll(/"(\w+)\.",/g)].map(m => m[1]);
    expect(exempt, "список открытых ручек не найден").toContain("billing");

    const files = [
      "src/pages/SubscriptionBlocked.tsx",
      "src/components/billing/SubscriptionPlanCard.tsx",
      "src/components/billing/usePlanRequest.ts",
      "src/hooks/useAuth.ts",
    ];
    const called = files.flatMap(f => [...read(f).matchAll(/trpc\.(\w+)\.\w+\.use(?:Query|Mutation)/g)].map(m => `${m[1]} (${f})`));
    expect(called.length, "экран ничего не спрашивает — страж ослеп").toBeGreaterThan(1);
    for (const c of called) {
      expect(exempt, `экран блокировки зовёт закрытую ручку ${c}`).toContain(c.split(" ")[0]);
    }
  });
});
