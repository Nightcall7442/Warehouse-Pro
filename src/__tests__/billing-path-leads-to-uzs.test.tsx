// @vitest-environment jsdom
/**
 * Все дороги «заплатить» ведут к тарифам в сумах, а не к Stripe.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Полоса «пробный кончается через 3 дня», письмо и экран блокировки вели на
 * /settings/billing. Там «Подключить» звало stripe.createCheckoutSession и
 * получало либо ошибку («STRIPE_SECRET_KEY is not configured» / «Plan not
 * configured»), либо оплату в долларах. Единственный путь, по которому
 * клиенту в Узбекистане можно заплатить, — заявка на /billing — оттуда не
 * был виден.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · кнопка полосы ведёт на /billing;
 *   · /settings/billing без настроенного Stripe сразу уводит на /billing, а с
 *     настроенным — показывает себя (ручки stripe.* живы, храповик мёртвых
 *     ручек не трогается);
 *   · ни один экран не ведёт на /settings/billing — адрес остаётся только
 *     маршрутом для старых закладок.
 *
 * Нарочная поломка: вернуть в полосе navigate("/settings/billing") — падают
 * первый и третий; убрать уход при !stripeReady — второй.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const state = vi.hoisted(() => ({
  navigated: [] as string[],
  sub: {} as Record<string, unknown>,
}));

vi.mock("@/providers/trpc", () => {
  const mutation = () => ({ mutate: () => {}, isPending: false });
  return {
    trpc: {
      stripe: {
        getSubscription: { useQuery: () => ({ data: state.sub, isLoading: false, refetch: () => {} }) },
        getPlans: { useQuery: () => ({ data: [] }) },
        createCheckoutSession: { useMutation: mutation },
        createBillingPortalSession: { useMutation: mutation },
      },
    },
  };
});
vi.mock("react-router", () => ({
  useNavigate: () => (to: string) => state.navigated.push(to),
  useSearchParams: () => [new URLSearchParams()],
  Navigate: ({ to }: { to: string }) => { state.navigated.push(to); return null; },
}));
vi.mock("@/i18n", () => ({
  useLang: () => ({ lang: "ru", t: (k: string) => k }),
  useTranslate: () => (ru: string) => ru,
}));
vi.mock("@/lib/toast", () => ({ notify: { success: () => {}, error: () => {}, info: () => {} } }));

const { TrialBanner } = await import("@/components/TrialBanner");
const { default: BillingSettings } = await import("@/pages/BillingSettings");

const trialing = (days: number) => ({
  plan: "trial", status: "trialing", isTrialing: true, isActive: true, isPastDue: false, isCanceled: false,
  daysLeft: days, trialEndsAt: new Date(Date.now() + days * 86_400_000), currentPeriodEnds: null,
  stripeSubscriptionId: null, stripeReady: false,
});

beforeEach(() => { state.navigated = []; state.sub = trialing(2); });
afterEach(cleanup);

describe("дороги к оплате", () => {
  it("полоса «пробный кончается» ведёт на тарифы в сумах", () => {
    render(<TrialBanner />);
    fireEvent.click(screen.getByRole("button", { name: /Подключить/ }));
    expect(state.navigated).toEqual(["/billing"]);
  });

  it("/settings/billing без Stripe уводит на /billing, со Stripe — показывает себя", () => {
    render(<BillingSettings />);
    expect(state.navigated).toEqual(["/billing"]);
    expect(screen.queryByText("ТАРИФЫ")).toBeNull();
    cleanup();

    state.navigated = [];
    state.sub = { ...trialing(2), stripeReady: true };
    render(<BillingSettings />);
    expect(state.navigated).toEqual([]);
    expect(screen.getByText("ТАРИФЫ")).toBeTruthy();
  });

  it("ни один экран не ведёт на /settings/billing", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) { if (n !== "__tests__") walk(p); }
        else if (/\.tsx?$/.test(n)) files.push(p);
      }
    };
    walk(join(process.cwd(), "src"));
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const offenders = files
      .filter(f => !f.endsWith("App.tsx"))
      .filter(f => strip(readFileSync(f, "utf8")).includes("/settings/billing"));
    expect(files.length).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });
});
