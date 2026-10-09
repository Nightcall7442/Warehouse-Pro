// @vitest-environment jsdom
/**
 * Продление видно на экране: полоса по дате и кнопка «Продлить».
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * После оплаты подписка становилась active, и с этого момента экран молчал:
 *   · полоса выходила только у пробного — у оплаченного ни за неделю, ни в
 *     последний день; о конце срока узнавали по запертому входу;
 *   · карточка текущего тарифа на /billing показывала неживое «Активен» без
 *     кнопки — и после конца срока тоже; продлить было нечем;
 *   · список суперадмина при отсутствии подписки судил по trial_ends_at и
 *     показывал платящему «Trial истёк».
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · оплаченный (не Stripe) — полоса за 7 дней и в день конца, с «Продлить»
 *     на /billing; за 10 дней — тишина; Stripe продлевает сам — тишина;
 *   · у текущего тарифа — «Продлить», и оно просит тот же тариф;
 *   · срок в консоли платформы (statusOf/daysLeft, бывший planStatus) без
 *     подписки: платный — по оплаченному сроку, а не по давнему пробному.
 *
 * Нарочная поломка: вернуть в полосе `if (sub.status === "active") return
 * null` — падает первый; вернуть «Активен» без кнопки — второй; вернуть
 * planStatus на trialEndsAt первым делом — третий.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { statusOf, daysLeft, type OrgRow } from "@/components/superadmin/console/orgs";
import { FieldPlanCard } from "@/components/billing/FieldPlanCard";
import { GrandfatherNotice } from "@/components/billing/GrandfatherNotice";
import { priceForTenant } from "@contracts/pricing";

const state = vi.hoisted(() => ({ navigated: [] as string[], sub: {} as Record<string, unknown> }));
vi.mock("@/providers/trpc", () => ({
  trpc: { stripe: { getSubscription: { useQuery: () => ({ data: state.sub }) } } },
}));
vi.mock("react-router", () => ({ useNavigate: () => (to: string) => state.navigated.push(to) }));
vi.mock("@/i18n", () => ({ useTranslate: () => (ru: string) => ru, useLang: () => ({ lang: "ru" }) }));

const { TrialBanner } = await import("@/components/TrialBanner");

const DAY = 86_400_000;
const paid = (days: number, stripe = false) => ({
  plan: "basic", status: "active", isTrialing: false, isActive: true, isPastDue: false, isCanceled: false,
  daysLeft: days, currentPeriodEnds: new Date(Date.now() + days * DAY), trialEndsAt: new Date(Date.now() - 40 * DAY),
  stripeSubscriptionId: stripe ? "sub_x" : null,
});

beforeEach(() => { state.navigated = []; });
afterEach(cleanup);

describe("полоса у оплаченного", () => {
  it("за неделю — «заканчивается через N дн.» и «Продлить» на /billing", () => {
    state.sub = paid(5);
    render(<TrialBanner />);
    expect(screen.getByText("Оплаченный срок заканчивается через 5 дн.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Продлить/ }));
    expect(state.navigated).toEqual(["/billing"]);
  });

  it("в день конца — «Подписка неактивна»", () => {
    state.sub = paid(0);
    render(<TrialBanner />);
    expect(screen.getByText(/Подписка неактивна/)).toBeTruthy();
  });

  it("за 10 дней и у Stripe — тишина", () => {
    state.sub = paid(10);
    const { container } = render(<TrialBanner />);
    expect(container.textContent).toBe("");
    cleanup();

    state.sub = paid(2, true);
    const again = render(<TrialBanner />);
    expect(again.container.textContent).toBe("");
  });
});

/*
  Что было: оплаченный без даты конца (current_period_ends пуст) калитка
  пускает как бессрочный, а полоса читала пустые дни как ноль и вешала
  «Подписка неактивна» красным, без крестика, на каждом экране.
  Что проверяется: у такого — тишина; с датой в прошлом (ноль дней) —
  по-прежнему «неактивна».
  Нарочная поломка: убрать `sub.daysLeft === null` из условия тишины.
*/
describe("полоса у бессрочного оплаченного", () => {
  it("нет даты конца — нет полосы", () => {
    state.sub = { ...paid(0), daysLeft: null, currentPeriodEnds: null };
    const { container } = render(<TrialBanner />);
    expect(container.textContent).toBe("");
  });
});

describe("карточка текущего тарифа", () => {
  it("«Стандарт»: «Продлить» на месяц или на год, а не неживое «Активен»", () => {
    const asked: string[] = [];
    render(
      <FieldPlanCard fieldUsers={7} byRole={{ agent: 5, courier: 2, merchandiser: 0 }} mode="renew"
        isPending={false} onRequest={p => asked.push(p)} t={ru => ru} />,
    );
    expect(screen.queryByText("Активен")).toBeNull();
    fireEvent.click(screen.getByTestId("plan-request-standard"));
    fireEvent.click(screen.getByTestId("plan-request-standard-year"));
    expect(asked).toEqual(["month", "year"]);
    expect(screen.getByTestId("plan-request-standard").textContent).toMatch(/Продлить/);
  });

  it("прежний тариф: «Продлить Pro» просит тот же тариф по прежней цене", () => {
    let renewed = 0;
    render(
      <GrandfatherNotice planName="Pro" pricing={priceForTenant("pro", 7, new Date("2026-10-05T09:00:00Z"))}
        isPending={false} onRenew={() => renewed++} t={ru => ru} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Продлить Pro/ }));
    expect(renewed).toBe(1);
  });
});

describe("метка срока у суперадмина (консоль платформы)", () => {
  const row = (o: Record<string, unknown>) => ({
    id: 1, name: "Орг", slug: "org", status: "active", isSandbox: false, createdAt: new Date(), userCount: 1, orderCount: 1, orderTotal: 1,
    trialEndsAt: null, planExpiresAt: null, subscription: null,
    segment: { client: true, paying: false, trial: false, trialLive: false, renewalDays: null, silentDays: null, active7: true, price: 0 }, ...o,
  }) as unknown as OrgRow;

  it("платный без строки подписки — по оплаченному, не по давнему пробному", () => {
    const r = row({ plan: "basic", trialEndsAt: new Date(Date.now() - 40 * DAY), planExpiresAt: new Date(Date.now() + 20 * DAY + 3_600_000) });
    expect(daysLeft(r)).toBe(21);
    expect(statusOf(r).label).toBe("Платит");
  });

  it("с подпиской — по ней: пробный по концу пробного, отменённая — «Не оплачена»", () => {
    const trial = row({ plan: "basic", subscription: { status: "trialing", trialEndsAt: new Date(Date.now() + 5 * DAY + 3_600_000), currentPeriodEnds: null } });
    expect(daysLeft(trial)).toBe(6);
    expect(statusOf(trial).label).toBe("Пробный");
    const canceled = row({ plan: "pro", subscription: { status: "canceled", trialEndsAt: null, currentPeriodEnds: new Date(Date.now() + DAY) } });
    expect(statusOf(canceled).label).toBe("Не оплачена");
  });
});
